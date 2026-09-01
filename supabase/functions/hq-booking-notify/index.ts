// Notifica una reserva nueva en hq_appointments (formulario público /agendar):
// confirma al cliente y avisa a Sebastián. Invocada fire-and-forget desde el
// frontend justo después del INSERT — la reserva ya quedó guardada en DB
// aunque este paso falle, así que todo acá es best-effort con logging real.
//
// El email es el canal primario (Resend, probado y estable). WhatsApp vía
// YCloud del HQ (+56993089185) es secundario: ese número tiene historial de
// fallar en silencio (sesión 74, cron-system-health quedó ~semanas sin poder
// avisar por WhatsApp por un 403 de registro). Nunca depender solo de él.

import { createClient } from "npm:@supabase/supabase-js@2";
import { sendWhatsApp } from "../_shared/diagnostics.ts";

const HQ_ID = "00000000-0000-0000-0000-000000000000";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
// Sala fija de Google Meet (evento recurrente en el Calendar de Sebastián,
// nunca se borra). No es un link único por reserva -- ver decisión de sesión
// 2026-08-26: la integración real con Calendar API para links dinámicos
// existe a medias en el repo (create-google-event) pero la tabla que
// necesita ni siquiera está creada en producción. Un link fijo cubre la
// necesidad real (videollamadas de activación, una a la vez) sin ese riesgo.
const MEET_LINK = "https://meet.google.com/crh-jujw-fch";
// WhatsApp del HQ (Andrés) -- mismo número que hq-generate-prospect-email,
// se ofrece como vía concreta para reagendar/cancelar (no solo "escríbeme").
const HQ_WHATSAPP_LINK = "https://wa.me/56993089185";
// Mismo mapeo que BookOnboardingCall.tsx / cron-hq-appointment-reminders --
// mantener sincronizado si se agrega un país nuevo.
const COUNTRY_TIMEZONES: Record<string, string> = {
    "México": "America/Mexico_City",
    "Colombia": "America/Bogota",
    "Perú": "America/Lima",
    "Argentina": "America/Argentina/Buenos_Aires",
    "Ecuador": "America/Guayaquil",
    "Bolivia": "America/La_Paz",
};

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logIssue = async (sb: ReturnType<typeof createClient>, message: string, payload: unknown) => {
    try {
        await sb.from("debug_logs").insert({ message, payload });
    } catch {
        // El logging nunca debe tumbar la función.
    }
};

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

    const sb = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    try {
        const { appointment_id } = await req.json();
        if (!appointment_id) {
            return new Response(JSON.stringify({ error: "Missing appointment_id" }), {
                status: 400,
                headers: { ...CORS, "Content-Type": "application/json" },
            });
        }

        const { data: appt, error: apptErr } = await sb
            .from("hq_appointments")
            .select("id, contact_name, contact_email, contact_phone, contact_country, plan, scheduled_at, duration_minutes")
            .eq("id", appointment_id)
            .maybeSingle();

        if (apptErr || !appt) {
            await logIssue(sb, "[hq-booking-notify] Appointment not found", { appointment_id, apptErr });
            return new Response(JSON.stringify({ error: "Appointment not found" }), {
                status: 404,
                headers: { ...CORS, "Content-Type": "application/json" },
            });
        }

        const { data: hq } = await sb
            .from("clinic_settings")
            .select("ycloud_api_key, ycloud_phone_number, hq_escalation_phone, hq_escalation_email")
            .eq("id", HQ_ID)
            .maybeSingle();

        const scheduled = new Date(appt.scheduled_at as string);
        const fmt = new Intl.DateTimeFormat("es-CL", {
            timeZone: "America/Santiago",
            weekday: "long",
            day: "numeric",
            month: "long",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        });
        const dateTimeStr = fmt.format(scheduled);
        const firstName = String(appt.contact_name || "").split(" ")[0] || appt.contact_name;

        const localTz = COUNTRY_TIMEZONES[(appt.contact_country as string) || ""];
        const localDateTimeStr = localTz
            ? new Intl.DateTimeFormat("es", {
                timeZone: localTz, weekday: "long", day: "numeric", month: "long",
                hour: "2-digit", minute: "2-digit", hour12: false,
            }).format(scheduled)
            : null;
        const whenLine = localDateTimeStr
            ? `${dateTimeStr} hrs (Chile) — ${localDateTimeStr} hrs (${appt.contact_country})`
            : `${dateTimeStr} hrs (Chile)`;

        // --- Email de confirmación (canal primario) ---
        if (RESEND_API_KEY) {
            try {
                const emailRes = await fetch("https://api.resend.com/emails", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${RESEND_API_KEY}`,
                    },
                    body: JSON.stringify({
                        from: "Sebastián · Vetly <hola@vetly.pro>",
                        to: appt.contact_email,
                        subject: `¡Listo, ${firstName}! Quedó agendada nuestra videollamada`,
                        html: `
                            <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #2E2E2E;">
                                <p style="font-size:15px; line-height:1.6;">¡Hola ${firstName}!</p>
                                <p style="font-size:15px; line-height:1.6;">Soy Sebastián, fundador de Vetly. Te escribo para confirmarte que quedó agendada nuestra videollamada — vamos a conversar sobre cómo podemos mejorar la gestión de tu clínica con Vetly.</p>
                                <div style="background:#F5F3FF; border:1px solid #DDD6FE; border-radius:12px; padding:20px; margin:24px 0;">
                                    <p style="margin:0; font-size:15px;"><strong>📅 Cuándo:</strong> ${whenLine}</p>
                                    <p style="margin:8px 0 0; font-size:15px;"><strong>⏱️ Duración:</strong> ~${appt.duration_minutes} minutos</p>
                                </div>
                                <div style="text-align:center; margin:28px 0;">
                                    <a href="${MEET_LINK}" style="display:inline-block; background-color:#7C3AED; color:#ffffff; font-size:16px; font-weight:700; text-decoration:none; padding:14px 32px; border-radius:10px;">
                                        📹 Unirme a la videollamada
                                    </a>
                                    <p style="margin:10px 0 0; font-size:13px; color:#888;">${MEET_LINK}</p>
                                </div>
                                <p style="font-size:15px; line-height:1.6;">Guarda este link, es el mismo que vamos a usar el día de la reunión.</p>
                                <p style="font-size:15px; line-height:1.6;">Si algo cambia, puedes responder este correo o escribirme directo por <a href="${HQ_WHATSAPP_LINK}" style="color:#7C3AED;">WhatsApp</a> para reagendar o avisarme que no vas a poder asistir — sin ningún problema.</p>
                                <p style="font-size:15px; line-height:1.6;">¡Nos vemos pronto!</p>
                                <p style="color:#888; font-size:13px; margin-top:24px;">— Sebastián</p>
                            </div>
                        `,
                    }),
                });
                if (!emailRes.ok) {
                    await logIssue(sb, "[hq-booking-notify] Email send failed", {
                        appointment_id,
                        status: emailRes.status,
                        body: await emailRes.text(),
                    });
                }
            } catch (e) {
                await logIssue(sb, "[hq-booking-notify] Email send threw", { appointment_id, error: String(e) });
            }

            // --- Email de confirmación al founder (antes solo llegaba por WhatsApp) ---
            if (hq?.hq_escalation_email) {
                try {
                    const founderEmailRes = await fetch("https://api.resend.com/emails", {
                        method: "POST",
                        headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
                        body: JSON.stringify({
                            from: "Vetly AI <hola@vetly.pro>",
                            to: hq.hq_escalation_email,
                            subject: `Nueva videollamada agendada: ${appt.contact_name} — ${dateTimeStr}`,
                            html: `
                                <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #2E2E2E;">
                                    <h2 style="color: #7C3AED;">📅 Nueva videollamada agendada</h2>
                                    <div style="background:#F5F3FF; border:1px solid #DDD6FE; border-radius:12px; padding:20px; margin:24px 0;">
                                        <p style="margin:0 0 6px; font-size:15px;"><strong>👤 Nombre:</strong> ${appt.contact_name}</p>
                                        <p style="margin:0 0 6px; font-size:15px;"><strong>📱 Teléfono:</strong> ${appt.contact_phone || "sin teléfono"}</p>
                                        <p style="margin:0 0 6px; font-size:15px;"><strong>✉️ Correo:</strong> ${appt.contact_email}</p>
                                        <p style="margin:0 0 6px; font-size:15px;"><strong>💳 Plan:</strong> ${appt.plan || "sin especificar"}</p>
                                        <p style="margin:0 0 6px; font-size:15px;"><strong>🌎 País:</strong> ${appt.contact_country || "sin especificar"}</p>
                                        <p style="margin:0; font-size:15px;"><strong>🗓️ Cuándo:</strong> ${whenLine}</p>
                                    </div>
                                    <div style="text-align:center; margin:28px 0;">
                                        <a href="${MEET_LINK}" style="display:inline-block; background-color:#7C3AED; color:#ffffff; font-size:16px; font-weight:700; text-decoration:none; padding:14px 32px; border-radius:10px;">
                                            📹 Unirme a la videollamada
                                        </a>
                                    </div>
                                </div>
                            `,
                        }),
                    });
                    if (!founderEmailRes.ok) {
                        await logIssue(sb, "[hq-booking-notify] Founder email send failed", {
                            appointment_id,
                            status: founderEmailRes.status,
                            body: await founderEmailRes.text(),
                        });
                    }
                } catch (e) {
                    await logIssue(sb, "[hq-booking-notify] Founder email send threw", { appointment_id, error: String(e) });
                }
            }
        }

        // --- WhatsApp al cliente + a Sebastián (secundario, best-effort) ---
        if (hq?.ycloud_api_key && hq?.ycloud_phone_number) {
            const clientMsg =
                `¡Hola ${firstName}! 👋 Soy Andrés de Vetly.\n\n` +
                `Tu videollamada de activación quedó agendada para el *${whenLine}*.\n\n` +
                `📹 Link de la reunión: ${MEET_LINK}\n\n` +
                `Si necesitas cambiar el horario, respóndeme cuando quieras.`;

            if (appt.contact_phone) {
                try {
                    await sendWhatsApp(hq.ycloud_api_key as string, hq.ycloud_phone_number as string, appt.contact_phone as string, clientMsg);
                } catch (e) {
                    await logIssue(sb, "[hq-booking-notify] Client WhatsApp failed", { appointment_id, error: String(e) });
                }
            }

            if (hq.hq_escalation_phone) {
                const founderMsg =
                    `📅 *Nueva videollamada agendada*\n\n` +
                    `👤 ${appt.contact_name}\n` +
                    `📱 ${appt.contact_phone || "sin teléfono"}\n` +
                    `✉️ ${appt.contact_email}\n` +
                    `💳 Plan: ${appt.plan || "sin especificar"}\n` +
                    `🌎 País: ${appt.contact_country || "sin especificar"}\n` +
                    `🗓️ ${dateTimeStr} hrs (Chile)`;
                try {
                    await sendWhatsApp(hq.ycloud_api_key as string, hq.ycloud_phone_number as string, hq.hq_escalation_phone as string, founderMsg);
                } catch (e) {
                    await logIssue(sb, "[hq-booking-notify] Founder WhatsApp failed", { appointment_id, error: String(e) });
                }
            }
        }

        await sb.from("hq_appointments").update({ client_notified_at: new Date().toISOString() }).eq("id", appointment_id);

        return new Response(JSON.stringify({ ok: true }), {
            headers: { ...CORS, "Content-Type": "application/json" },
        });
    } catch (error) {
        await logIssue(sb, "[hq-booking-notify] Unhandled error", { error: String(error) });
        return new Response(JSON.stringify({ error: "Internal error" }), {
            status: 500,
            headers: { ...CORS, "Content-Type": "application/json" },
        });
    }
});
