// Notifica una reserva nueva creada desde la página pública de una clínica
// (vetly.pro/reservar/:slug). Invocada fire-and-forget justo después del
// INSERT en appointments -- la cita ya quedó confirmada aunque este paso
// falle, así que todo acá es best-effort con logging real.
//
// Dos destinatarios: el cliente (confirmación) y el dueño/admin de la
// clínica (aviso de que llegó una reserva -- Core no tiene agente de IA que
// se lo diga por WhatsApp, así que sin esto nadie se entera hasta que abra
// el dashboard).

import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

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

const sendEmail = async (sb: ReturnType<typeof createClient>, tag: string, to: string, subject: string, html: string) => {
    if (!RESEND_API_KEY || !to) return;
    try {
        const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
            body: JSON.stringify({ from: "Vetly AI <hola@vetly.pro>", to, subject, html }),
        });
        if (!res.ok) {
            await logIssue(sb, `[public-booking-notify] ${tag} email failed`, { to, status: res.status, body: await res.text() });
        }
    } catch (e) {
        await logIssue(sb, `[public-booking-notify] ${tag} email threw`, { to, error: String(e) });
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
            .from("appointments")
            .select("id, clinic_id, tutor_name, phone_number, email, patient_name, service, price, appointment_date, duration_minutes")
            .eq("id", appointment_id)
            .maybeSingle();

        if (apptErr || !appt) {
            await logIssue(sb, "[public-booking-notify] Appointment not found", { appointment_id, apptErr });
            return new Response(JSON.stringify({ error: "Appointment not found" }), {
                status: 404,
                headers: { ...CORS, "Content-Type": "application/json" },
            });
        }

        const { data: clinic } = await sb
            .from("clinic_settings")
            .select("clinic_name, timezone, currency")
            .eq("id", appt.clinic_id)
            .maybeSingle();

        const { data: owner } = await sb
            .from("clinic_members")
            .select("email")
            .eq("clinic_id", appt.clinic_id)
            .eq("role", "owner")
            .eq("status", "active")
            .limit(1)
            .maybeSingle();

        const timezone = clinic?.timezone || "America/Santiago";
        const scheduled = new Date(appt.appointment_date as string);
        const dateTimeStr = new Intl.DateTimeFormat("es", {
            timeZone: timezone, weekday: "long", day: "numeric", month: "long",
            hour: "2-digit", minute: "2-digit", hour12: false,
        }).format(scheduled);

        const clinicName = clinic?.clinic_name || "la clínica";
        const firstName = String(appt.tutor_name || "").split(" ")[0] || appt.tutor_name;

        // --- Confirmación al cliente ---
        await sendEmail(sb, "client", appt.email as string, `Cita confirmada en ${clinicName}`, `
            <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #2E2E2E;">
                <h2 style="color: #0d9488;">¡Listo, ${firstName}! Tu cita quedó confirmada</h2>
                <p>Reservaste en <strong>${clinicName}</strong> para <strong>${appt.patient_name}</strong>.</p>
                <div style="background:#F0FDFA; border:1px solid #99F6E4; border-radius:12px; padding:20px; margin:24px 0;">
                    <p style="margin:0; font-size:15px;"><strong>🩺 Servicio:</strong> ${appt.service}</p>
                    <p style="margin:8px 0 0; font-size:15px;"><strong>📅 Cuándo:</strong> ${dateTimeStr} hrs</p>
                </div>
                <p>Si necesitas cambiar el horario, contacta directamente a la clínica.</p>
                <p style="color:#888; font-size:13px; margin-top:32px;">— ${clinicName}, vía Vetly</p>
            </div>
        `);

        // --- Aviso al dueño de la clínica ---
        await sendEmail(sb, "owner", owner?.email as string, `Nueva reserva online: ${appt.tutor_name}`, `
            <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #2E2E2E;">
                <h2 style="color: #0d9488;">Nueva reserva desde tu página online</h2>
                <div style="background:#F0FDFA; border:1px solid #99F6E4; border-radius:12px; padding:20px; margin:24px 0;">
                    <p style="margin:0; font-size:15px;"><strong>👤 Tutor:</strong> ${appt.tutor_name}</p>
                    <p style="margin:8px 0 0; font-size:15px;"><strong>🐾 Mascota:</strong> ${appt.patient_name}</p>
                    <p style="margin:8px 0 0; font-size:15px;"><strong>📱 WhatsApp:</strong> ${appt.phone_number}</p>
                    <p style="margin:8px 0 0; font-size:15px;"><strong>🩺 Servicio:</strong> ${appt.service}</p>
                    <p style="margin:8px 0 0; font-size:15px;"><strong>📅 Cuándo:</strong> ${dateTimeStr} hrs</p>
                </div>
                <p>Ya quedó agendada automáticamente en tu Vetly -- revísala en Citas Médicas.</p>
            </div>
        `);

        return new Response(JSON.stringify({ ok: true }), {
            headers: { ...CORS, "Content-Type": "application/json" },
        });
    } catch (error) {
        await logIssue(sb, "[public-booking-notify] Unhandled error", { error: String(error) });
        return new Response(JSON.stringify({ error: "Internal error" }), {
            status: 500,
            headers: { ...CORS, "Content-Type": "application/json" },
        });
    }
});
