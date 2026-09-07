// Envía el reporte de estética al tutor como ENLACE a /estetica/:token.
// Dos canales: WhatsApp y correo. Clon de send-consent / send-prescription.

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

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const sendMetaMessage = async (phoneNumberId: string, accessToken: string, to: string, text: string) => {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body: text } }),
    });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
};

const sendYCloudMessage = async (apiKey: string, from: string, to: string, text: string) => {
    const res = await fetch("https://api.ycloud.com/v2/whatsapp/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify({ from, to: `+${to}`, type: "text", text: { body: text } }),
    });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
};

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

    try {
        const { session_id, channel } = await req.json();
        if (!session_id || (channel !== "whatsapp" && channel !== "email")) {
            return json({ success: false, error: "Missing session_id or invalid channel" }, 200);
        }

        const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
        if (!jwt) return json({ error: "Unauthorized" }, 401);
        const sbUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
            global: { headers: { Authorization: `Bearer ${jwt}` } },
        });
        const { data: { user } } = await sbUser.auth.getUser();
        if (!user) return json({ error: "Unauthorized" }, 401);

        const { data: sess } = await supabase
            .from("grooming_sessions")
            .select("id, clinic_id, patient_id, public_token")
            .eq("id", session_id)
            .maybeSingle();
        if (!sess) return json({ success: false, error: "Reporte no encontrado" }, 200);

        const { data: member } = await supabase
            .from("clinic_members")
            .select("id")
            .eq("user_id", user.id)
            .eq("clinic_id", sess.clinic_id)
            .eq("status", "active")
            .maybeSingle();
        if (!member) return json({ error: "Forbidden" }, 403);

        const { data: patient } = await supabase
            .from("patients")
            .select("name, tutor_id")
            .eq("id", sess.patient_id)
            .maybeSingle();

        const { data: tutor } = patient?.tutor_id
            ? await supabase.from("tutors").select("phone_number, email").eq("id", patient.tutor_id).maybeSingle()
            : { data: null };

        const { data: clinic } = await supabase
            .from("clinic_settings")
            .select("clinic_name, name, whatsapp_provider, ycloud_api_key, ycloud_phone_number, meta_phone_number_id, meta_access_token")
            .eq("id", sess.clinic_id)
            .maybeSingle();

        const { data: owner } = await supabase
            .from("clinic_members")
            .select("email")
            .eq("clinic_id", sess.clinic_id)
            .eq("role", "owner")
            .eq("status", "active")
            .limit(1)
            .maybeSingle();

        const clinicName = clinic?.clinic_name || clinic?.name || "tu veterinaria";
        const patientName = patient?.name || "tu mascota";
        const link = `https://www.vetly.pro/estetica/${sess.public_token}`;

        if (channel === "whatsapp") {
            const rawPhone = String(tutor?.phone_number || "").replace(/\D/g, "");
            if (!rawPhone) return json({ success: false, error: "El tutor no tiene teléfono registrado." }, 200);
            const to = rawPhone.startsWith("56") ? rawPhone : `56${rawPhone}`;

            const text = [
                `✂️ *${patientName} quedó lista — ${clinicName}*`,
                ``,
                `Aquí puedes ver el reporte de su sesión de estética, con fotos y la recomendación para la próxima visita:`,
                link,
            ].join("\n");

            const isMeta = clinic?.whatsapp_provider === "meta" || (!clinic?.ycloud_api_key && clinic?.meta_phone_number_id);
            let result;
            if (isMeta) {
                if (!clinic?.meta_phone_number_id || !clinic?.meta_access_token) {
                    return json({ success: false, error: "La clínica no tiene WhatsApp configurado." }, 200);
                }
                result = await sendMetaMessage(clinic.meta_phone_number_id, clinic.meta_access_token, to, text);
            } else {
                if (!clinic?.ycloud_api_key || !clinic?.ycloud_phone_number) {
                    return json({ success: false, error: "La clínica no tiene WhatsApp configurado." }, 200);
                }
                result = await sendYCloudMessage(clinic.ycloud_api_key, clinic.ycloud_phone_number, to, text);
            }

            await supabase.from("debug_logs").insert({
                message: `[send-grooming-report] whatsapp → ${to}`,
                payload: { session_id, ok: result.ok, status: result.status, body: result.body },
            });

            if (!result.ok) {
                return json({
                    success: false,
                    error: "No se pudo enviar por WhatsApp. Puede que el tutor no tenga una conversación abierta con la clínica en las últimas 24 horas. Prueba enviarlo por correo.",
                }, 200);
            }
            return json({ success: true, channel: "whatsapp", link });
        }

        const email = String(tutor?.email || "").trim();
        if (!email) return json({ success: false, error: "El tutor no tiene correo registrado." }, 200);
        if (!RESEND_API_KEY) return json({ success: false, error: "El envío de correo no está configurado." }, 200);

        const html = `
            <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #2E2E2E;">
                <h2 style="color: #0d9488;">${patientName} quedó lista ✂️</h2>
                <p>Aquí está el reporte de la sesión de estética de <strong>${patientName}</strong> en ${clinicName}, con fotos y la recomendación para su próxima visita.</p>
                <div style="background:#F0FDFA; border:1px solid #99F6E4; border-radius:12px; padding:20px; margin:24px 0; text-align:center;">
                    <a href="${link}" style="display:inline-block; background:#0d9488; color:#fff; text-decoration:none; font-weight:700; padding:12px 24px; border-radius:10px;">Ver reporte</a>
                </div>
                <p style="color:#888; font-size:13px;">Si el botón no funciona, copia este enlace: ${link}</p>
                <p style="color:#888; font-size:13px; margin-top:32px;">— ${clinicName}, vía Vetly</p>
            </div>
        `;

        const emailPayload: Record<string, unknown> = {
            from: "Vetly AI <hola@vetly.pro>",
            to: email,
            subject: `Reporte de estética de ${patientName} — ${clinicName}`,
            html,
        };
        const replyTo = String(owner?.email || "").trim();
        if (replyTo) emailPayload.reply_to = replyTo;

        const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
            body: JSON.stringify(emailPayload),
        });

        await supabase.from("debug_logs").insert({
            message: `[send-grooming-report] email → ${email}`,
            payload: { session_id, ok: res.ok, status: res.status },
        });

        if (!res.ok) {
            return json({ success: false, error: "No se pudo enviar el correo. Intenta de nuevo en unos minutos." }, 200);
        }
        return json({ success: true, channel: "email", link });
    } catch (e) {
        return json({ error: "Internal server error", detail: (e as Error).message }, 500);
    }
});
