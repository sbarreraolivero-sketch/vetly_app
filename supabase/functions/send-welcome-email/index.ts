
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", {
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
            },
        });
    }

    try {
        const { email, full_name, clinic_name, is_core_plan, clinic_id, plan, lifecycle_email_token } = await req.json();

        if (!email || !clinic_name) {
            return new Response(JSON.stringify({ error: "Missing required fields" }), {
                status: 400,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            });
        }

        // full_name puede venir vacío/null (ej. desde un flujo que no lo pida
        // aún) — sin este guard, `full_name.split(' ')` tronaba con TypeError
        // y el correo nunca salía, sin ningún rastro del motivo.
        const firstName = full_name ? full_name.split(' ')[0] : 'colega';

        // Formulario propio de Vetly (/agendar → hq_appointments), no WhatsApp:
        // así toda reserva queda en el panel HQ (AdminCalendar.tsx) de inmediato,
        // sin depender de que alguien vea/responda un mensaje entrante.
        const bookingParams = new URLSearchParams({
            name: full_name || "",
            email,
            clinic: clinic_name,
            ...(clinic_id ? { clinic_id } : {}),
            ...(plan ? { plan } : {}),
        });
        const bookingUrl = `https://www.vetly.pro/agendar?${bookingParams.toString()}`;

        // Link de baja de la secuencia de onboarding — token dedicado, nunca el
        // clinic_id (mismo criterio que tutors.portal_token, sesión 74).
        const unsubscribeUrl = lifecycle_email_token
            ? `${SUPABASE_URL}/functions/v1/unsubscribe-lifecycle-emails?token=${lifecycle_email_token}`
            : null;

        if (!RESEND_API_KEY) {
            console.warn("Missing RESEND_API_KEY. Simulating welcome email send.");
            return new Response(JSON.stringify({ message: "Email simulation successful" }), {
                status: 200,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            });
        }

        const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${RESEND_API_KEY}`,
            },
            body: JSON.stringify({
                from: "Vetly AI <hola@vetly.pro>",
                to: email,
                subject: `¡Bienvenido a la familia Vetly, ${firstName}! 🐾`,
                html: `
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Bienvenida a Vetly AI</title>
            </head>
            <body style="margin: 0; padding: 0; background-color: #FAFAF8; font-family: 'Plus Jakarta Sans', Arial, sans-serif; color: #2E2E2E;">

              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0; padding: 40px 20px; background-color: #FAFAF8;">
                <tr>
                  <td align="center">

                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; border: 1px solid #EDE6DE; box-shadow: 0 4px 12px rgba(46, 46, 46, 0.05); overflow: hidden;">

                      <tr>
                        <td style="padding: 40px 32px; background: linear-gradient(135deg, #7C3AED 0%, #A78BFA 100%); text-align: center;">
                          <div style="font-size: 32px; margin-bottom: 16px;">🐾</div>
                          <h1 style="margin: 0; font-size: 28px; font-weight: 700; color: #ffffff; letter-spacing: -0.02em;">
                            ¡Hola, ${firstName}!
                          </h1>
                          <p style="margin: 8px 0 0 0; font-size: 18px; color: rgba(255, 255, 255, 0.9);">
                            Estamos felices de acompañarte en <strong>${clinic_name}</strong>
                          </p>
                        </td>
                      </tr>

                      <tr>
                        <td style="padding: 40px 32px;">

                          <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: #5a5a5a;">
                            ¡Bienvenido a Vetly AI! Para que aproveches al máximo la plataforma desde el primer día, agenda una videollamada corta con nuestro equipo: te ayudamos a configurar todo correctamente${is_core_plan ? '' : ' y te mostramos cómo sacarle el máximo provecho a tu Asistente IA'}.
                          </p>

                          <div style="margin: 8px 0 28px 0; padding: 28px 24px; background-color: #F5F3FF; border: 1px solid #DDD6FE; border-radius: 16px; text-align: center;">
                            <p style="margin: 0 0 6px 0; font-size: 15px; font-weight: 700; color: #6D28D9;">📅 Videollamada de Activación</p>
                            <p style="margin: 0 0 18px 0; font-size: 14px; line-height: 1.5; color: #5B21B6;">
                              30 minutos para configurar tu agenda, servicios y equipo con nuestro apoyo en vivo.
                            </p>
                            <a href="${bookingUrl}" style="display: inline-block; background-color: #7C3AED; color: #ffffff; font-size: 16px; font-weight: 700; text-decoration: none; padding: 14px 36px; border-radius: 10px; box-shadow: 0 4px 12px rgba(124, 58, 237, 0.25);">
                              Agendar mi videollamada
                            </a>
                          </div>

                          <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #888; text-align: center;">
                            ¿Prefieres explorar primero? <a href="https://www.vetly.pro/app/dashboard" style="color: #7C3AED; font-weight: 600;">Entra a tu Dashboard</a>.
                          </p>

                          <p style="margin: 0; font-size: 15px; line-height: 1.6; color: #5a5a5a;">
                            Si tienes cualquier duda, simplemente responde a este correo. ¡Nuestro equipo (y sus mascotas) están listos para ayudarte!
                          </p>

                        </td>
                      </tr>

                      <tr>
                        <td style="background-color: #FAFAF8; padding: 24px; text-align: center; border-top: 1px solid #EDE6DE;">
                          <p style="margin: 0; font-size: 12px; color: #888888;">
                            &copy; 2026 Vetly AI. Todos los derechos reservados.<br>
                            Santiago, Chile.
                          </p>
                          ${unsubscribeUrl ? `<p style="margin: 8px 0 0 0; font-size: 11px;"><a href="${unsubscribeUrl}" style="color: #aaaaaa;">Dejar de recibir correos de bienvenida y ayuda</a></p>` : ''}
                        </td>
                      </tr>

                    </table>

                  </td>
                </tr>
              </table>

            </body>
          </html>
        `,
            }),
        });

        // Antes se reenviaba el JSON crudo de Resend sin comprobar el status —
        // un 4xx/5xx (API key vencida, dominio no verificado) se veía igual que
        // un envío exitoso, tanto para el caller como para quien revisara logs.
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            console.error("Resend error:", res.status, text);
            return new Response(JSON.stringify({ error: `Resend respondió ${res.status}` }), {
                status: 502,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            });
        }

        const data = await res.json();

        // Registro para la secuencia de onboarding — el email_key='welcome' que
        // el cron de secuencia usa para saber que este paso ya se cumplió, y
        // para que un fallo real (que antes era invisible) quede detectable por
        // ausencia de fila. No fatal: un fallo acá nunca debe hacer fallar un
        // envío que sí llegó al destinatario.
        if (clinic_id && SUPABASE_SERVICE_ROLE_KEY) {
            try {
                const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
                const { error: logError } = await supabaseAdmin
                    .from("email_sequence_log")
                    .insert({ clinic_id, email_key: "welcome", resend_id: data?.id || null });
                if (logError) console.warn("No se pudo registrar el envío en email_sequence_log:", logError);
            } catch (e) {
                console.warn("No se pudo registrar el envío en email_sequence_log:", e);
            }
        }

        return new Response(JSON.stringify(data), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
    }
});
