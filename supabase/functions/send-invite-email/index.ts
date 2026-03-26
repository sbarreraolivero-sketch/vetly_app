
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
        const { email, clinicName, inviteLink, inviterName } = await req.json();

        if (!email || !inviteLink || !clinicName) {
            return new Response(JSON.stringify({ error: "Missing required fields" }), {
                status: 400,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            });
        }

        if (!RESEND_API_KEY) {
            console.warn("Missing RESEND_API_KEY. Simulating email send.");
            console.log(`[SIMULATED EMAIL] To: ${email}, Subject: Invitación a ${clinicName}, Link: ${inviteLink}`);
            return new Response(JSON.stringify({ message: "Email simulation successful (API key missing)" }), {
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
                from: "Citenly AI <onboarding@resend.dev>", // Default until user verifies domain
                to: email,
                subject: `Te han invitado a ${clinicName}`,
                html: `
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Invitación a Citenly AI</title>
            </head>
            <body style="margin: 0; padding: 0; background-color: #FAFAF8; font-family: 'Plus Jakarta Sans', Arial, sans-serif; color: #2E2E2E;">
              
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0; padding: 40px 20px; background-color: #FAFAF8;">
                <tr>
                  <td align="center">
                    
                    <!-- Card Container -->
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; border: 1px solid #EDE6DE; box-shadow: 0 4px 12px rgba(46, 46, 46, 0.05); overflow: hidden;">
                      
                      <!-- Header Gradient -->
                      <tr>
                        <td style="padding: 32px; background: linear-gradient(135deg, #1F6F5C 0%, #7FA89A 100%); text-align: center;">
                          <!-- Logo Placeholder (Sparkles Icon as text for email safety) -->
                          <div style="font-size: 24px; font-weight: 700; color: #ffffff; letter-spacing: -0.02em; display: inline-flex; align-items: center; gap: 8px;">
                             ✨ Citenly AI
                          </div>
                        </td>
                      </tr>

                      <!-- Content -->
                      <tr>
                        <td style="padding: 40px 32px; text-align: center;">
                          
                          <h1 style="margin: 0 0 16px 0; font-size: 24px; font-weight: 600; color: #2E2E2E;">
                            ¡Únete al equipo!
                          </h1>
                          
                          <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: #5a5a5a;">
                            Hola,<br><br>
                            <strong>${inviterName || 'Un administrador'}</strong> te ha invitado a colaborar en la gestión de la clínica <strong>"${clinicName}"</strong> utilizando Citenly AI.
                          </p>

                          <p style="margin: 0 0 32px 0; font-size: 16px; line-height: 1.6; color: #5a5a5a;">
                            Accede ahora para configurar tu perfil profesional, gestionar tus citas y comenzar a utilizar nuestro asistente inteligente.
                          </p>

                          <!-- CTA Button -->
                          <div style="margin-bottom: 32px;">
                            <a href="${inviteLink}" style="display: inline-block; background-color: #1F6F5C; color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 8px; box-shadow: 0 4px 12px rgba(31, 111, 92, 0.2); transition: background-color 0.2s;">
                              Aceptar Invitación
                            </a>
                          </div>

                          <!-- Divider -->
                          <hr style="border: none; border-top: 1px solid #EDE6DE; margin: 32px 0;">

                          <p style="margin: 0; font-size: 14px; color: #888888;">
                            Si el botón no funciona, copia y pega este enlace en tu navegador:
                          </p>
                          <p style="margin: 8px 0 0 0; font-size: 14px; word-break: break-all;">
                            <a href="${inviteLink}" style="color: #1F6F5C; text-decoration: underline;">${inviteLink}</a>
                          </p>

                        </td>
                      </tr>
                      
                      <!-- Footer -->
                      <tr>
                        <td style="background-color: #FAFAF8; padding: 24px; text-align: center; border-top: 1px solid #EDE6DE;">
                          <p style="margin: 0; font-size: 12px; color: #888888;">
                            Has recibido este mensaje porque fuiste invitado a Citenly AI.<br>
                            Si crees que esto es un error, puedes ignorar este correo.
                          </p>
                          <p style="margin: 12px 0 0 0; font-size: 12px; font-weight: 600; color: #C8A96A;">
                            Gestión Inteligente para Clínicas
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

        if (!res.ok) {
            console.error("Resend API Error:", data);
            return new Response(JSON.stringify({ error: data }), {
                status: 400,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            });
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
