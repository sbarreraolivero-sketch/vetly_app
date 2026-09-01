// Recordatorio de videollamadas HQ agendadas vía /agendar: PART 1 un día
// antes, PART 2 dos horas antes — al cliente y al founder (WhatsApp +
// correo, hq_escalation_phone / hq_escalation_email).
//
// Corre cada hora (pg_cron, ver migración 20260826000002). Cada PART usa su
// propia ventana ancha (≥ 1h, el intervalo del cron) para que una corrida
// perdida no deje una cita sin recordatorio, y su propia columna de
// idempotencia — mismo patrón que auto_open_daily_cajas (sesión 80) y que
// PART 1/PART 2 de cron-process-reminders (24h/2h de citas de clínica).

import { createClient } from "npm:@supabase/supabase-js@2";
import { sendWhatsApp } from "../_shared/diagnostics.ts";

const HQ_ID = "00000000-0000-0000-0000-000000000000";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
// Misma sala fija que hq-booking-notify -- mantener sincronizado si cambia.
const MEET_LINK = "https://meet.google.com/crh-jujw-fch";
// Mismo número que hq-booking-notify -- vía concreta para reagendar/cancelar.
const HQ_WHATSAPP_LINK = "https://wa.me/56993089185";
// Mismo mapeo que BookOnboardingCall.tsx / hq-booking-notify -- mantener
// sincronizado si se agrega un país nuevo.
const COUNTRY_TIMEZONES: Record<string, string> = {
    "México": "America/Mexico_City",
    "Colombia": "America/Bogota",
    "Perú": "America/Lima",
    "Argentina": "America/Argentina/Buenos_Aires",
    "Ecuador": "America/Guayaquil",
    "Bolivia": "America/La_Paz",
};

type HqSettings = {
    ycloud_api_key: string | null;
    ycloud_phone_number: string | null;
    hq_escalation_phone: string | null;
    hq_escalation_email: string | null;
};

type Appt = {
    id: string;
    contact_name: string | null;
    contact_email: string | null;
    contact_phone: string | null;
    contact_country: string | null;
    plan?: string | null;
    scheduled_at: string;
};

// deno-lint-ignore no-explicit-any
async function remindPart(
    sb: any,
    hq: HqSettings | null,
    // deno-lint-ignore no-explicit-any
    logIssue: (message: string, payload: unknown) => Promise<void>,
    opts: {
        label: "1día" | "2h";
        windowHours: [number, number];
        sentAtColumn: "reminder_sent_at" | "reminder_2h_sent_at";
        founderTag: string; // "mañana" | "en 2 horas" -- solo para el correo/WA interno del founder
        clientSubject: (firstName: string, dateTimeStr: string) => string;
        clientIntroHtml: (firstName: string) => string;
        clientClosingHtml: string;
        clientWhatsApp: (firstName: string, whenLine: string) => string;
    },
): Promise<{ checked: number; reminded: number }> {
    const now = Date.now();
    const windowStart = new Date(now + opts.windowHours[0] * 60 * 60 * 1000).toISOString();
    const windowEnd = new Date(now + opts.windowHours[1] * 60 * 60 * 1000).toISOString();

    const { data: appts, error } = await sb
        .from("hq_appointments")
        .select("id, contact_name, contact_email, contact_phone, contact_country, plan, scheduled_at")
        .eq("status", "scheduled")
        .is(opts.sentAtColumn, null)
        .gte("scheduled_at", windowStart)
        .lte("scheduled_at", windowEnd);

    if (error) {
        console.error(`[hq-appointment-reminders/${opts.label}] fetch error:`, error);
        return { checked: 0, reminded: 0 };
    }

    let sent = 0;
    for (const appt of (appts || []) as Appt[]) {
        const scheduled = new Date(appt.scheduled_at);
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

        const localTz = COUNTRY_TIMEZONES[appt.contact_country || ""];
        const localDateTimeStr = localTz
            ? new Intl.DateTimeFormat("es", {
                timeZone: localTz, weekday: "long", day: "numeric", month: "long",
                hour: "2-digit", minute: "2-digit", hour12: false,
            }).format(scheduled)
            : null;
        const whenLine = localDateTimeStr
            ? `${dateTimeStr} hrs (Chile) — ${localDateTimeStr} hrs (${appt.contact_country})`
            : `${dateTimeStr} hrs (Chile)`;

        // --- Email al cliente ---
        if (RESEND_API_KEY && appt.contact_email) {
            try {
                const res = await fetch("https://api.resend.com/emails", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
                    body: JSON.stringify({
                        from: "Sebastián · Vetly <hola@vetly.pro>",
                        to: appt.contact_email,
                        subject: opts.clientSubject(firstName, dateTimeStr),
                        html: `
                            <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #2E2E2E;">
                                <p style="font-size:15px; line-height:1.6;">¡Hola ${firstName}!</p>
                                ${opts.clientIntroHtml(firstName)}
                                <div style="background:#F5F3FF; border:1px solid #DDD6FE; border-radius:12px; padding:20px; margin:24px 0;">
                                    <p style="margin:0; font-size:15px;"><strong>📅 Cuándo:</strong> ${whenLine}</p>
                                </div>
                                <div style="text-align:center; margin:28px 0;">
                                    <a href="${MEET_LINK}" style="display:inline-block; background-color:#7C3AED; color:#ffffff; font-size:16px; font-weight:700; text-decoration:none; padding:14px 32px; border-radius:10px;">
                                        📹 Unirme a la videollamada
                                    </a>
                                    <p style="margin:10px 0 0; font-size:13px; color:#888;">${MEET_LINK}</p>
                                </div>
                                ${opts.clientClosingHtml}
                                <p style="color:#888; font-size:13px; margin-top:24px;">— Sebastián</p>
                            </div>
                        `,
                    }),
                });
                if (!res.ok) await logIssue(`[hq-appointment-reminders/${opts.label}] Client email failed`, { appt_id: appt.id, status: res.status, body: await res.text() });
            } catch (e) {
                console.error(`[hq-appointment-reminders/${opts.label}] client email threw for ${appt.id}:`, e);
            }
        }

        // --- Email al founder (antes solo llegaba por WhatsApp) ---
        if (RESEND_API_KEY && hq?.hq_escalation_email) {
            try {
                const res = await fetch("https://api.resend.com/emails", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
                    body: JSON.stringify({
                        from: "Vetly AI <hola@vetly.pro>",
                        to: hq.hq_escalation_email,
                        subject: `Recordatorio: videollamada ${opts.founderTag} — ${appt.contact_name}`,
                        html: `
                            <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #2E2E2E;">
                                <h2 style="color: #7C3AED;">⏰ Videollamada ${opts.founderTag}</h2>
                                <div style="background:#F5F3FF; border:1px solid #DDD6FE; border-radius:12px; padding:20px; margin:24px 0;">
                                    <p style="margin:0 0 6px; font-size:15px;"><strong>👤 Nombre:</strong> ${appt.contact_name}</p>
                                    <p style="margin:0 0 6px; font-size:15px;"><strong>📱 Teléfono:</strong> ${appt.contact_phone || "sin teléfono"}</p>
                                    <p style="margin:0 0 6px; font-size:15px;"><strong>✉️ Correo:</strong> ${appt.contact_email}</p>
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
                if (!res.ok) await logIssue(`[hq-appointment-reminders/${opts.label}] Founder email failed`, { appt_id: appt.id, status: res.status, body: await res.text() });
            } catch (e) {
                console.error(`[hq-appointment-reminders/${opts.label}] founder email threw for ${appt.id}:`, e);
            }
        }

        // --- WhatsApp al cliente + al founder (secundario, best-effort) ---
        if (hq?.ycloud_api_key && hq?.ycloud_phone_number) {
            if (appt.contact_phone) {
                try {
                    await sendWhatsApp(
                        hq.ycloud_api_key, hq.ycloud_phone_number, appt.contact_phone,
                        opts.clientWhatsApp(firstName, whenLine),
                    );
                } catch (e) {
                    console.error(`[hq-appointment-reminders/${opts.label}] client WA failed for ${appt.id}:`, e);
                }
            }
            if (hq.hq_escalation_phone) {
                try {
                    await sendWhatsApp(
                        hq.ycloud_api_key, hq.ycloud_phone_number, hq.hq_escalation_phone,
                        `⏰ *Recordatorio: videollamada ${opts.founderTag}*\n\n👤 ${appt.contact_name}\n📱 ${appt.contact_phone || "sin teléfono"}\n✉️ ${appt.contact_email}\n🗓️ ${dateTimeStr} hrs`,
                    );
                } catch (e) {
                    console.error(`[hq-appointment-reminders/${opts.label}] founder WA failed for ${appt.id}:`, e);
                }
            }
        }

        await sb.from("hq_appointments").update({ [opts.sentAtColumn]: new Date().toISOString() }).eq("id", appt.id);
        sent++;
    }

    return { checked: (appts || []).length, reminded: sent };
}

Deno.serve(async () => {
    const sb = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const logIssue = async (message: string, payload: unknown) => {
        try {
            await sb.from("debug_logs").insert({ message, payload });
        } catch {
            // El logging nunca debe tumbar la función.
        }
    };

    const { data: hq } = await sb
        .from("clinic_settings")
        .select("ycloud_api_key, ycloud_phone_number, hq_escalation_phone, hq_escalation_email")
        .eq("id", HQ_ID)
        .maybeSingle();

    // PART 1: 1 día antes — ventana 23h-25h (2h de ancho, igual que antes).
    const part1 = await remindPart(sb, hq as HqSettings | null, logIssue, {
        label: "1día",
        windowHours: [23, 25],
        sentAtColumn: "reminder_sent_at",
        founderTag: "mañana",
        clientSubject: (firstName) => `Nos vemos mañana, ${firstName} 👋`,
        clientIntroHtml: () =>
            `<p style="font-size:15px; line-height:1.6;">Quise tomarme el atrevimiento de escribirte para recordarte nuestra llamada de mañana, en la que vamos a conversar sobre cómo podemos mejorar la gestión de tu clínica por medio de nuestro software.</p>`,
        clientClosingHtml:
            `<p style="font-size:15px; line-height:1.6;">Si por algún motivo no vas a poder asistir o prefieres cambiar el horario, solo respóndeme este correo o escríbeme por <a href="${HQ_WHATSAPP_LINK}" style="color:#7C3AED;">WhatsApp</a> y lo reagendamos sin problema.</p>` +
            `<p style="font-size:15px; line-height:1.6;">¡Nos vemos mañana!</p>`,
        clientWhatsApp: (firstName, whenLine) =>
            `¡Hola ${firstName}! 👋 Te recuerdo que mañana tenemos nuestra videollamada de activación, *${whenLine}*.\n\n📹 Link: ${MEET_LINK}\n\n¡Nos vemos!`,
    });

    // PART 2: 2 horas antes — ventana 1.5h-2.5h (1h de ancho = el intervalo
    // del cron, para que no queden citas sin cubrir entre dos corridas).
    const part2 = await remindPart(sb, hq as HqSettings | null, logIssue, {
        label: "2h",
        windowHours: [1.5, 2.5],
        sentAtColumn: "reminder_2h_sent_at",
        founderTag: "en 2 horas",
        clientSubject: (firstName) => `En un par de horas nos conectamos, ${firstName}`,
        clientIntroHtml: () =>
            `<p style="font-size:15px; line-height:1.6;">Ya casi es hora de nuestra videollamada — te dejo el link a mano para que lo tengas listo cuando nos conectemos.</p>`,
        clientClosingHtml:
            `<p style="font-size:15px; line-height:1.6;">Si algo surgió de último momento y no vas a poder conectarte, avísame por este correo o por <a href="${HQ_WHATSAPP_LINK}" style="color:#7C3AED;">WhatsApp</a> y buscamos otro horario sin problema.</p>` +
            `<p style="font-size:15px; line-height:1.6;">¡Nos vemos en un rato!</p>`,
        clientWhatsApp: (firstName, whenLine) =>
            `¡Hola ${firstName}! 👋 Ya casi es hora de nuestra videollamada de activación, *${whenLine}*.\n\n📹 Link: ${MEET_LINK}\n\n¡Nos vemos en un rato!`,
    });

    return new Response(JSON.stringify({ part1, part2 }), {
        headers: { "Content-Type": "application/json" },
    });
});
