
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
        const { email, full_name, clinic_name, is_core_plan } = await req.json();

        if (!email || !clinic_name) {
            return new Response(JSON.stringify({ error: "Missing required fields" }), {
                status: 400,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            });
        }

        // Mismo número/mecanismo que la burbuja flotante de WhatsApp
        // (NewAccountWhatsAppBubble.tsx) — se refuerza acá por si la persona no
        // llega a ver la burbuja o abandona antes de entrar al dashboard.
        const ANDRES_WHATSAPP_NUMBER = "56993089185";
        const waMessage = `Hola! Soy de ${clinic_name}, acabo de crear mi cuenta en Vetly y quiero agendar mi reunión de implementación.`;
        const waUrl = `https://wa.me/${ANDRES_WHATSAPP_NUMBER}?text=${encodeURIComponent(waMessage)}`;

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
                subject: `¡Bienvenido a la familia Vetly, ${full_name.split(' ')[0]}! 🐾`,
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
                            ¡Hola, ${full_name.split(' ')[0]}!
                          </h1>
                          <p style="margin: 8px 0 0 0; font-size: 18px; color: rgba(255, 255, 255, 0.9);">
                            Estamos felices de acompañarte en <strong>${clinic_name}</strong>
                          </p>
                        </td>
                      </tr>

                      <tr>
                        <td style="padding: 40px 32px;">
                          
                          <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: #5a5a5a;">
                            ¡Bienvenido a Vetly AI! Estamos emocionados de ayudarte a transformar la gestión de tu clínica con tecnología inteligente.
                          </p>

                          <h2 style="font-size: 18px; font-weight: 600; color: #2E2E2E; margin-bottom: 16px;">¿Por dónde empezar?</h2>
                          
                          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                            <tr>
                              <td style="padding: 0 0 20px 0;">
                                <div style="font-weight: 600; color: #7C3AED; margin-bottom: 4px;">1. Configura tu Agenda</div>
                                <div style="font-size: 14px; color: #666;">Define tus horarios y servicios para empezar a recibir citas automáticamente.</div>
                              </td>
                            </tr>
                            <tr>
                              <td style="padding: 0 0 20px 0;">
                                ${is_core_plan
                                  ? `<div style="font-weight: 600; color: #7C3AED; margin-bottom: 4px;">2. Registra tus primeras fichas</div>
                                <div style="font-size: 14px; color: #666;">Carga a tus pacientes y tutores para tener su historial médico y de citas a mano.</div>`
                                  : `<div style="font-weight: 600; color: #7C3AED; margin-bottom: 4px;">2. Conoce a tu Asistente IA</div>
                                <div style="font-size: 14px; color: #666;">Entrena a tu IA con la información de tu clínica para que responda dudas de tus clientes.</div>`}
                              </td>
                            </tr>
                            <tr>
                              <td style="padding: 0 0 20px 0;">
                                <div style="font-weight: 600; color: #7C3AED; margin-bottom: 4px;">3. Invita a tu Equipo</div>
                                <div style="font-size: 14px; color: #666;">Añade a tus veterinarios y recepcionistas para trabajar de forma sincronizada.</div>
                              </td>
                            </tr>
                          </table>

                          <div style="margin: 32px 0; padding: 20px; background-color: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 12px; text-align: center;">
                            <p style="margin: 0 0 12px 0; font-size: 15px; line-height: 1.5; color: #166534; font-weight: 600;">
                              📅 Te recomendamos agendar una videollamada corta con nuestro equipo para ayudarte a configurar tu cuenta y conocer el sistema.
                            </p>
                            <a href="${waUrl}" style="display: inline-block; background-color: #25D366; color: #ffffff; font-size: 15px; font-weight: 600; text-decoration: none; padding: 12px 24px; border-radius: 8px;">
                              Agendar por WhatsApp
                            </a>
                          </div>

                          <div style="margin: 32px 0; text-align: center;">
                            <a href="https://www.vetly.pro/app/dashboard" style="display: inline-block; background-color: #7C3AED; color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 8px; box-shadow: 0 4px 12px rgba(124, 58, 237, 0.2);">
                              Ir a mi Dashboard
                            </a>
                          </div>

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
