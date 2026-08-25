// Recordatorio de videollamadas HQ agendadas vía /agendar: un día antes, al
// cliente y al número personal de Sebastián (hq_escalation_phone).
//
// Corre cada hora (pg_cron, ver migración 20260826000002). Ventana de 2h para
// que una corrida perdida no deje una cita sin recordatorio — mismo patrón que
// auto_open_daily_cajas (sesión 80).

import { createClient } from "npm:@supabase/supabase-js@2";
import { sendWhatsApp } from "../_shared/diagnostics.ts";

const HQ_ID = "00000000-0000-0000-0000-000000000000";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

Deno.serve(async () => {
    const sb = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const now = Date.now();
    const windowStart = new Date(now + 23 * 60 * 60 * 1000).toISOString();
    const windowEnd = new Date(now + 25 * 60 * 60 * 1000).toISOString();

    const { data: appts, error } = await sb
        .from("hq_appointments")
        .select("id, contact_name, contact_email, contact_phone, scheduled_at")
        .eq("status", "scheduled")
        .is("reminder_sent_at", null)
        .gte("scheduled_at", windowStart)
        .lte("scheduled_at", windowEnd);

    if (error) {
        console.error("[hq-appointment-reminders] fetch error:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    const { data: hq } = await sb
        .from("clinic_settings")
        .select("ycloud_api_key, ycloud_phone_number, hq_escalation_phone")
        .eq("id", HQ_ID)
        .maybeSingle();

    let sent = 0;
    for (const appt of appts || []) {
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

        if (RESEND_API_KEY && appt.contact_email) {
            try {
                await fetch("https://api.resend.com/emails", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
                    body: JSON.stringify({
                        from: "Vetly AI <hola@vetly.pro>",
                        to: appt.contact_email,
                        subject: `Recordatorio: tu videollamada es mañana (${dateTimeStr})`,
                        html: `
                            <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #2E2E2E;">
                                <h2 style="color: #7C3AED;">¡Nos vemos mañana, ${firstName}!</h2>
                                <p>Este es un recordatorio de tu videollamada de activación con el equipo de Vetly.</p>
                                <div style="background:#F5F3FF; border:1px solid #DDD6FE; border-radius:12px; padding:20px; margin:24px 0;">
                                    <p style="margin:0; font-size:15px;"><strong>📅 Cuándo:</strong> ${dateTimeStr} hrs (Chile)</p>
                                    <p style="margin:8px 0 0; font-size:15px;"><strong>📱 Cómo:</strong> Te contactamos por WhatsApp a la hora agendada.</p>
                                </div>
                                <p style="color:#888; font-size:13px; margin-top:32px;">— El equipo de Vetly</p>
                            </div>
                        `,
                    }),
                });
            } catch (e) {
                console.error(`[hq-appointment-reminders] email failed for ${appt.id}:`, e);
            }
        }

        if (hq?.ycloud_api_key && hq?.ycloud_phone_number) {
            if (appt.contact_phone) {
                try {
                    await sendWhatsApp(
                        hq.ycloud_api_key as string,
                        hq.ycloud_phone_number as string,
                        appt.contact_phone as string,
                        `¡Hola ${firstName}! 👋 Te recuerdo que mañana tenemos nuestra videollamada de activación, *${dateTimeStr} hrs* (Chile). Te escribo por acá a esa hora. ¡Nos vemos!`,
                    );
                } catch (e) {
                    console.error(`[hq-appointment-reminders] client WA failed for ${appt.id}:`, e);
                }
            }
            if (hq.hq_escalation_phone) {
                try {
                    await sendWhatsApp(
                        hq.ycloud_api_key as string,
                        hq.ycloud_phone_number as string,
                        hq.hq_escalation_phone as string,
                        `⏰ *Recordatorio: videollamada mañana*\n\n👤 ${appt.contact_name}\n📱 ${appt.contact_phone || "sin teléfono"}\n✉️ ${appt.contact_email}\n🗓️ ${dateTimeStr} hrs`,
                    );
                } catch (e) {
                    console.error(`[hq-appointment-reminders] founder WA failed for ${appt.id}:`, e);
                }
            }
        }

        await sb.from("hq_appointments").update({ reminder_sent_at: new Date().toISOString() }).eq("id", appt.id);
        sent++;
    }

    return new Response(JSON.stringify({ checked: (appts || []).length, reminded: sent }), {
        headers: { "Content-Type": "application/json" },
    });
});
