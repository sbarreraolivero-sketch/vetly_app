
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

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
        const { email, full_name, plan_name, monthly_limit, ai_4o_limit } = await req.json();

        if (!email || !plan_name) {
            return new Response(JSON.stringify({ error: "Missing required fields" }), {
                status: 400,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            });
        }

        if (!RESEND_API_KEY) {
            console.warn("Missing RESEND_API_KEY. Simulating activation email send.");
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
                subject: `¡Plan ${plan_name.toUpperCase()} Activado! 🚀 - Vetly AI`,
                html: `
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Plan Activado - Vetly AI</title>
            </head>
            <body style="margin: 0; padding: 0; background-color: #FAFAF8; font-family: 'Plus Jakarta Sans', Arial, sans-serif; color: #2E2E2E;">
              
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0; padding: 40px 20px; background-color: #FAFAF8;">
                <tr>
                  <td align="center">
                    
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; border: 1px solid #EDE6DE; box-shadow: 0 4px 12px rgba(46, 46, 46, 0.05); overflow: hidden;">
                      
                      <tr>
                        <td style="padding: 40px 32px; background: linear-gradient(135deg, #10B981 0%, #059669 100%); text-align: center;">
                          <div style="font-size: 32px; margin-bottom: 16px;">🚀</div>
                          <h1 style="margin: 0; font-size: 28px; font-weight: 700; color: #ffffff; letter-spacing: -0.02em;">
                            ¡Plan Activado!
                          </h1>
                          <p style="margin: 8px 0 0 0; font-size: 18px; color: rgba(255, 255, 255, 0.9);">
                            Tu suscripción <strong>${plan_name.toUpperCase()}</strong> ya está vigente.
                          </p>
                        </td>
                      </tr>

                      <tr>
                        <td style="padding: 40px 32px;">
                          
                          <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: #5a5a5a;">
                            Hola ${full_name ? full_name.split(' ')[0] : 'colega'},<br><br>
                            ¡Gracias por confiar en Vetly AI! Tu pago ha sido procesado correctamente y todos los beneficios de tu nuevo plan ya están disponibles en tu cuenta.
                          </p>

                          <div style="background-color: #F3F4F6; border-radius: 8px; padding: 24px; margin-bottom: 32px;">
                            <h3 style="margin: 0 0 16px 0; font-size: 16px; font-weight: 600; color: #2E2E2E; border-bottom: 1px solid #E5E7EB; padding-bottom: 8px;">Resumen de tu suscripción:</h3>
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                              <tr>
                                <td style="padding: 4px 0; color: #666;">Citas Mensuales:</td>
                                <td style="padding: 4px 0; text-align: right; font-weight: 600;">${monthly_limit}</td>
                              </tr>
                              <tr>
                                <td style="padding: 4px 0; color: #666;">Créditos IA (Mini):</td>
                                <td style="padding: 4px 0; text-align: right; font-weight: 600;">Ilimitados*</td>
                              </tr>
                              <tr>
                                <td style="padding: 4px 0; color: #666;">Créditos IA (GPT-4o):</td>
                                <td style="padding: 4px 0; text-align: right; font-weight: 600;">${ai_4o_limit} mensuales</td>
                              </tr>
                            </table>
                          </div>

                          <h2 style="font-size: 18px; font-weight: 600; color: #2E2E2E; margin-bottom: 16px;">¿Qué sigue?</h2>
                          
                          <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: #5a5a5a;">
                            Ahora puedes disfrutar de todas las herramientas avanzadas sin interrupciones. Tu asistente IA está listo para atender a más pacientes y tu agenda está liberada para crecer.
                          </p>

                          <div style="text-align: center; margin-bottom: 32px;">
                            <a href="https://www.vetly.pro/app/settings?tab=subscription" style="display: inline-block; background-color: #10B981; color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 8px;">
                              Ver mi Suscripción
                            </a>
                          </div>

                          <hr style="border: none; border-top: 1px solid #EDE6DE; margin: 32px 0;">

                          <p style="margin: 0; font-size: 14px; text-align: center; color: #888888;">
                            Si tienes dudas sobre tu facturación o necesitas ayuda técnica, escríbenos a hola@vetly.pro
                          </p>

                        </td>
                      </tr>
                      
                      <tr>
                        <td style="background-color: #FAFAF8; padding: 24px; text-align: center; border-top: 1px solid #EDE6DE;">
                          <p style="margin: 0; font-size: 12px; color: #888888;">
                            &copy; 2026 Vetly AI. Gestionando el futuro de la salud animal.<br>
                          </p>
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

        const data = await res.json();
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
