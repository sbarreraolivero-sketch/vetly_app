/**
 * Baja pública de la secuencia de correos de onboarding/retención. Se llega
 * acá solo por el link "Dejar de recibir estos correos" del pie de cada
 * correo de la secuencia — nunca desde el dashboard autenticado.
 *
 * `verify_jwt: false` a propósito: quien hace clic en un link de correo no
 * tiene ninguna sesión de Supabase abierta en ese contexto.
 *
 * Identifica la clínica por `lifecycle_email_token` (22 caracteres base64url,
 * no adivinable) — nunca por el `clinic_id` crudo. Mismo criterio que
 * `tutors.portal_token` (sesión 74 corrigió exactamente esta clase de
 * vulnerabilidad para el carnet digital del tutor).
 *
 * No afecta correos operativos (recibos, invitaciones de equipo, avisos de
 * pago) — solo `lifecycle_emails_opt_out`, que únicamente lee
 * `cron-lifecycle-emails`.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function htmlPage(title: string, message: string): Response {
    return new Response(
        `<!DOCTYPE html>
        <html lang="es">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${title}</title>
          </head>
          <body style="margin:0; padding:0; background-color:#FAFAF8; font-family: 'Plus Jakarta Sans', Arial, sans-serif; color:#2E2E2E;">
            <div style="max-width:480px; margin:80px auto; padding:32px; background:#ffffff; border-radius:12px; border:1px solid #EDE6DE; text-align:center;">
              <div style="font-size:32px; margin-bottom:12px;">🐾</div>
              <h1 style="font-size:20px; margin:0 0 12px 0;">${title}</h1>
              <p style="font-size:14px; line-height:1.6; color:#5a5a5a; margin:0;">${message}</p>
            </div>
          </body>
        </html>`,
        { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
}

Deno.serve(async (req: Request) => {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");

    if (!token) {
        return htmlPage("Falta el enlace", "Este link no incluye la información necesaria. Si necesitas dejar de recibir correos, escríbenos a hola@vetly.pro.");
    }

    try {
        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            auth: { autoRefreshToken: false, persistSession: false },
        });

        const { data: clinic, error: findError } = await supabaseAdmin
            .from("clinic_settings")
            .select("id")
            .eq("lifecycle_email_token", token)
            .maybeSingle();

        if (findError || !clinic) {
            return htmlPage("Enlace no válido", "No encontramos una cuenta asociada a este link. Si el problema persiste, escríbenos a hola@vetly.pro.");
        }

        const { error: updateError } = await supabaseAdmin
            .from("clinic_settings")
            .update({ lifecycle_emails_opt_out: true })
            .eq("id", clinic.id);

        if (updateError) {
            return htmlPage("No se pudo procesar", "Ocurrió un error de nuestro lado. Intenta de nuevo más tarde o escríbenos a hola@vetly.pro.");
        }

        return htmlPage(
            "Listo, no recibirás más estos correos",
            "Dejamos de enviarte la serie de bienvenida y ayuda. Seguirás recibiendo avisos operativos de tu cuenta (citas, pagos) por los canales que ya tienes configurados."
        );
    } catch {
        return htmlPage("No se pudo procesar", "Ocurrió un error inesperado. Escríbenos a hola@vetly.pro si necesitas ayuda.");
    }
});
