/**
 * ════════════════════════════════════════════════════════════════════════════
 * ENVÍO Y LAYOUT DE CORREO — helper compartido para edge functions
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Antes de este archivo, cada función que mandaba correo (send-welcome-email,
 * send-plan-activated-email, send-invite-email) repetía su propio `fetch` a
 * Resend y volvía a escribir el mismo HTML de layout a mano (header morado,
 * card blanca, footer) — sin comprobar `res.ok`, así que un fallo real de
 * Resend (API key vencida, dominio no verificado) se veía igual que un envío
 * exitoso.
 *
 * Este módulo es nuevo desde la secuencia de correos de onboarding (agosto
 * 2026). NO se migraron `send-welcome-email`/`send-plan-activated-email`/
 * `send-invite-email` a usarlo — siguen con su HTML propio para no tocar 3
 * funciones que ya funcionan en producción. Sí se aplicaron acá los 2 fixes
 * puntuales de bajo riesgo (`res.ok`, guard de `full_name` null) que
 * `send-welcome-email` necesitaba de todos modos para la idempotencia de la
 * secuencia.
 */

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

export interface SendEmailParams {
    to: string;
    subject: string;
    html: string;
    /** Override del remitente — default "Vetly AI <hola@vetly.pro>". Usado por
     * cron-hq-prospecting-campaign para mostrar un nombre más personal
     * ("Sebastián · Vetly") sin tocar el dominio verificado. Un remitente
     * dedicado a outreach frío (subdominio propio) requiere configurar
     * SPF/DKIM nuevos en Resend — fuera de alcance hasta que se decida. */
    from?: string;
}

export interface SendEmailResult {
    ok: boolean;
    id?: string;
    error?: string;
}

/**
 * Envía un correo vía Resend. A diferencia del patrón viejo:
 *  - Si falta la API key, devuelve `{ok:false}` explícito en vez de un 200
 *    de "simulación" que esconde el problema de configuración.
 *  - Comprueba `res.ok` — un 4xx/5xx de Resend ya no se confunde con éxito.
 * Nunca lanza: el caller decide qué hacer con `{ok:false}` (loguear, reintentar
 * en la próxima corrida del cron, etc.) — un fallo de correo nunca debe tumbar
 * el flujo que lo dispara.
 */
export async function sendEmail({ to, subject, html, from }: SendEmailParams): Promise<SendEmailResult> {
    if (!RESEND_API_KEY) {
        return { ok: false, error: "RESEND_API_KEY no configurado" };
    }
    try {
        const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${RESEND_API_KEY}`,
            },
            body: JSON.stringify({ from: from || "Vetly AI <hola@vetly.pro>", to, subject, html }),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            return { ok: false, error: `Resend ${res.status}: ${text.slice(0, 300)}` };
        }
        const data = await res.json().catch(() => ({}));
        return { ok: true, id: data?.id };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}

export interface EmailLayoutOptions {
    headerEmoji?: string;
    headerTitle: string;
    headerSubtitle?: string;
    /** Fragmento de HTML ya armado — un párrafo + una caja de CTA, típicamente. */
    bodyHtml: string;
    /** Si viene, agrega el link de baja al pie — solo para correos de la secuencia de onboarding, nunca para transaccionales (recibos, invitaciones). */
    unsubscribeUrl?: string;
}

/**
 * Arma el HTML completo de un correo con la identidad visual ya establecida
 * en `send-welcome-email` (gradiente morado `#7C3AED→#A78BFA`, card blanca con
 * borde `#EDE6DE` y `border-radius:12px`, fondo `#FAFAF8`). Cada correo nuevo
 * de la secuencia solo aporta su `bodyHtml` — no repite los ~90 líneas de
 * boilerplate de tabla/estilos inline que exige el soporte de clientes de
 * correo (Gmail, Outlook).
 */
export function renderEmailLayout({ headerEmoji = "🐾", headerTitle, headerSubtitle, bodyHtml, unsubscribeUrl }: EmailLayoutOptions): string {
    return `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${headerTitle}</title>
          </head>
          <body style="margin: 0; padding: 0; background-color: #FAFAF8; font-family: 'Plus Jakarta Sans', Arial, sans-serif; color: #2E2E2E;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0; padding: 40px 20px; background-color: #FAFAF8;">
              <tr>
                <td align="center">
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; border: 1px solid #EDE6DE; box-shadow: 0 4px 12px rgba(46, 46, 46, 0.05); overflow: hidden;">
                    <tr>
                      <td style="padding: 40px 32px; background: linear-gradient(135deg, #7C3AED 0%, #A78BFA 100%); text-align: center;">
                        <div style="font-size: 32px; margin-bottom: 16px;">${headerEmoji}</div>
                        <h1 style="margin: 0; font-size: 26px; font-weight: 700; color: #ffffff; letter-spacing: -0.02em;">
                          ${headerTitle}
                        </h1>
                        ${headerSubtitle ? `<p style="margin: 8px 0 0 0; font-size: 16px; color: rgba(255, 255, 255, 0.9);">${headerSubtitle}</p>` : ""}
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 40px 32px;">
                        ${bodyHtml}
                        <p style="margin: 24px 0 0 0; font-size: 14px; line-height: 1.6; color: #888;">
                          ¿Dudas? Responde a este correo — te leemos.
                        </p>
                      </td>
                    </tr>
                    <tr>
                      <td style="background-color: #FAFAF8; padding: 24px; text-align: center; border-top: 1px solid #EDE6DE;">
                        <p style="margin: 0; font-size: 12px; color: #888888;">
                          &copy; 2026 Vetly AI. Todos los derechos reservados.<br>
                          Santiago, Chile.
                        </p>
                        ${unsubscribeUrl ? `<p style="margin: 8px 0 0 0; font-size: 11px;"><a href="${unsubscribeUrl}" style="color: #aaaaaa;">Dejar de recibir estos correos</a></p>` : ""}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </body>
        </html>
    `;
}
