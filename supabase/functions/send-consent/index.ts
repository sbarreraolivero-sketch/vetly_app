// Envía el consentimiento al tutor como ENLACE a /consentimiento/:token.
// Dos canales: WhatsApp y correo. Clon de send-prescription.
//
// Auth: JWT + membresía activa en la clínica del consentimiento.
//
// ⚠️ WhatsApp: texto libre. Fuera de la ventana de 24h, Meta/YCloud rechazan
// free-form → se sugiere el correo.

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
        const { consent_id, channel } = await req.json();
        if (!consent_id || (channel !== "whatsapp" && channel !== "email")) {
            return json({ success: false, error: "Missing consent_id or invalid channel" }, 200);
        }

        // --- Auth ---
        const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
        if (!jwt) return json({ error: "Unauthorized" }, 401);
        const sbUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
            global: { headers: { Authorization: `Bearer ${jwt}` } },
        });
        const { data: { user } } = await sbUser.auth.getUser();
        if (!user) return json({ error: "Unauthorized" }, 401);

        const { data: rec } = await supabase
            .from("consent_records")
            .select("id, clinic_id, patient_id, tutor_id, public_token, template_title")
            .eq("id", consent_id)
            .maybeSingle();
        if (!rec) return json({ success: false, error: "Consentimiento no encontrado" }, 200);

        const { data: member } = await supabase
            .from("clinic_members")
            .select("id")
            .eq("user_id", user.id)
            .eq("clinic_id", rec.clinic_id)
            .eq("status", "active")
            .maybeSingle();
        if (!member) return json({ error: "Forbidden" }, 403);

        const { data: patient } = await supabase
            .from("patients")
            .select("name, tutor_id")
            .eq("id", rec.patient_id)
            .maybeSingle();

        const tutorId = rec.tutor_id || patient?.tutor_id;
        const { data: tutor } = tutorId
            ? await supabase.from("tutors").select("phone_number, email").eq("id", tutorId).maybeSingle()
            : { data: null };

        const { data: clinic } = await supabase
            .from("clinic_settings")
            .select("clinic_name, name, whatsapp_provider, ycloud_api_key, ycloud_phone_number, meta_phone_number_id, meta_access_token")
            .eq("id", rec.clinic_id)
            .maybeSingle();

        const { data: owner } = await supabase
            .from("clinic_members")
            .select("email")
            .eq("clinic_id", rec.clinic_id)
            .eq("role", "owner")
            .eq("status", "active")
            .limit(1)
            .maybeSingle();

        const clinicName = clinic?.clinic_name || clinic?.name || "tu veterinaria";
        const patientName = patient?.name || "tu mascota";
        const title = rec.template_title || "Consentimiento";
        const link = `https://www.vetly.pro/consentimiento/${rec.public_token}`;

        // --- Canal WhatsApp ---
        if (channel === "whatsapp") {
            const rawPhone = String(tutor?.phone_number || "").replace(/\D/g, "");
            if (!rawPhone) return json({ success: false, error: "El tutor no tiene teléfono registrado." }, 200);
            const to = rawPhone.startsWith("56") ? rawPhone : `56${rawPhone}`;

            const text = [
                `🐾 *${title} — ${clinicName}*`,
                ``,
                `Para *${patientName}*.`,
                ``,
                `Por favor lee y firma el consentimiento en este enlace (toma menos de un minuto):`,
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
                message: `[send-consent] whatsapp → ${to}`,
                payload: { consent_id, ok: result.ok, status: result.status, body: result.body },
            });

            if (!result.ok) {
                return json({
                    success: false,
                    error: "No se pudo enviar por WhatsApp. Puede que el tutor no tenga una conversación abierta con la clínica en las últimas 24 horas. Prueba enviarlo por correo.",
                }, 200);
            }
            return json({ success: true, channel: "whatsapp", link });
        }

        // --- Canal correo ---
        const email = String(tutor?.email || "").trim();
        if (!email) return json({ success: false, error: "El tutor no tiene correo registrado." }, 200);
        if (!RESEND_API_KEY) return json({ success: false, error: "El envío de correo no está configurado." }, 200);

        const html = `
            <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #2E2E2E;">
                <h2 style="color: #0d9488;">${title} — ${clinicName}</h2>
                <p>Antes de la atención de <strong>${patientName}</strong> necesitamos que leas y firmes este consentimiento. Toma menos de un minuto y no necesitas imprimir nada.</p>
                <div style="background:#F0FDFA; border:1px solid #99F6E4; border-radius:12px; padding:20px; margin:24px 0; text-align:center;">
                    <a href="${link}" style="display:inline-block; background:#0d9488; color:#fff; text-decoration:none; font-weight:700; padding:12px 24px; border-radius:10px;">Leer y firmar</a>
                </div>
                <p style="color:#888; font-size:13px;">Si el botón no funciona, copia este enlace: ${link}</p>
                <p style="color:#888; font-size:13px; margin-top:32px;">— ${clinicName}, vía Vetly</p>
            </div>
        `;

        const emailPayload: Record<string, unknown> = {
            from: "Vetly AI <hola@vetly.pro>",
            to: email,
            subject: `${title} — ${clinicName}`,
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
            message: `[send-consent] email → ${email}`,
            payload: { consent_id, ok: res.ok, status: res.status },
        });

        if (!res.ok) {
            return json({ success: false, error: "No se pudo enviar el correo. Intenta de nuevo en unos minutos." }, 200);
        }
        return json({ success: true, channel: "email", link });
    } catch (e) {
        return json({ error: "Internal server error", detail: (e as Error).message }, 500);
    }
});
