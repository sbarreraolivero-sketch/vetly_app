// Firma pública de un consentimiento — la llama la página /consentimiento/:token
// SIN sesión. El token ES la autenticación (hex de 128 bits, no adivinable).
//
// verify_jwt: false — la persona que firma es anónima. Ver config.toml.
//
// Captura el rastro de auditoría server-side (IP, user agent, hora) porque un
// RPC del cliente no puede verlos de forma fiable. La firma dibujada (PNG) se
// sube al bucket clinic-branding con service_role (bypassa la RLS del bucket,
// que exige membresía).

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

    const fail = async (status: number, error: string, ctx?: Record<string, unknown>) => {
        if (status >= 400) {
            await supabase.from("debug_logs").insert({
                message: `[sign-consent] ${status} — ${error}`,
                payload: ctx ?? {},
            }).then(() => {}, () => {});
        }
        return json({ success: false, error }, status >= 500 ? 500 : 200);
    };

    try {
        const body = await req.json().catch(() => null);
        if (!body || typeof body.token !== "string") {
            return fail(400, "Falta el token.");
        }
        const {
            token,
            acceptance_method,
            signer_name,
            signer_relationship,
            checkbox_responses,
            signature_png_base64,
        } = body as Record<string, unknown>;

        const name = String(signer_name ?? "").trim();
        if (!name) return fail(400, "Escribe tu nombre completo para firmar.");
        if (name.length > 120) return fail(400, "El nombre es demasiado largo.");

        const { data: rec } = await supabase
            .from("consent_records")
            .select("id, clinic_id, status, required_signature_mode, checkboxes")
            .eq("public_token", token)
            .maybeSingle();

        if (!rec) return fail(404, "Este enlace no existe o el consentimiento fue eliminado.");
        if (rec.status !== "pending") {
            return fail(409, rec.status === "signed" ? "Este consentimiento ya fue firmado." : "Este consentimiento ya no está disponible.");
        }

        const required = rec.required_signature_mode as string;
        const method = String(acceptance_method ?? "").trim();
        const validMethods = ["one_click", "typed", "drawn"];
        if (!validMethods.includes(method)) return fail(400, "Método de firma inválido.");

        // 'drawn' es más fuerte que 'typed' y que 'one_click' → siempre se acepta.
        // 'typed' se acepta si se pedía 'typed' o 'one_click'.
        // 'one_click' solo si se pedía 'one_click'.
        const rank: Record<string, number> = { one_click: 0, typed: 1, drawn: 2 };
        if (rank[method] < rank[required]) {
            return fail(400, "Este consentimiento requiere una firma más completa.");
        }
        if (method === "drawn" && typeof signature_png_base64 !== "string") {
            return fail(400, "Falta la firma dibujada.");
        }

        // Checkboxes obligatorios del snapshot.
        const responses = (checkbox_responses && typeof checkbox_responses === "object")
            ? checkbox_responses as Record<string, boolean>
            : {};
        const defs = Array.isArray(rec.checkboxes) ? rec.checkboxes as Array<Record<string, unknown>> : [];
        for (const d of defs) {
            if (d.required && !responses[String(d.key)]) {
                return fail(400, `Debes marcar: "${d.label}"`);
            }
        }

        // Rastro de auditoría.
        const xff = req.headers.get("x-forwarded-for") ?? "";
        const signer_ip = (xff.split(",")[0] || req.headers.get("cf-connecting-ip") || "").trim() || null;
        const signer_user_agent = (req.headers.get("user-agent") ?? "").slice(0, 400) || null;

        // Firma dibujada → clinic-branding/{clinic_id}/consents/{record_id}.png
        let signature_url: string | null = null;
        if (method === "drawn" && typeof signature_png_base64 === "string") {
            const b64 = signature_png_base64.replace(/^data:image\/png;base64,/, "");
            let bytes: Uint8Array;
            try {
                bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
            } catch {
                return fail(400, "La firma no se pudo procesar.");
            }
            if (bytes.length > 1_500_000) return fail(400, "La firma es demasiado grande.");
            const path = `${rec.clinic_id}/consents/${rec.id}.png`;
            const { error: upErr } = await supabase.storage
                .from("clinic-branding")
                .upload(path, bytes, { contentType: "image/png", upsert: true });
            if (upErr) return fail(500, "No se pudo guardar la firma.", { upErr: upErr.message });
            const { data: pub } = supabase.storage.from("clinic-branding").getPublicUrl(path);
            signature_url = pub.publicUrl;
        }

        const { error: updErr } = await supabase
            .from("consent_records")
            .update({
                status: "signed",
                signed_at: new Date().toISOString(),
                signer_name: name,
                signer_relationship: signer_relationship ? String(signer_relationship).slice(0, 40) : null,
                signer_ip,
                signer_user_agent,
                acceptance_method: method,
                signature_url,
                checkbox_responses: responses,
            })
            .eq("id", rec.id)
            .eq("status", "pending");   // idempotencia — no re-firmar una carrera

        if (updErr) return fail(500, "No se pudo registrar la firma.", { updErr: updErr.message });

        return json({ success: true });
    } catch (e) {
        return fail(500, "Error interno.", { detail: (e as Error).message });
    }
});
