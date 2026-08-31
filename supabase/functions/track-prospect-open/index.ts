/**
 * Píxel de tracking propio para los correos de prospección — no depende de
 * `open_tracking` de Resend.
 *
 * Por qué existe: el dominio dedicado de correo en frío (`mail.vetly.pro`,
 * verificado 2026-08-31) se resiste a que la API de Resend le active
 * `open_tracking` — el PATCH devuelve 200 pero el flag nunca queda en `true`
 * (probado varias veces, con distintas combinaciones, con espera de hasta
 * 30s). El dominio `vetly.pro` (correo transaccional/lifecycle) sí lo aceptó
 * al primer intento — es un problema puntual de Resend con ese dominio
 * específico, no de nuestro lado. En vez de esperar a que lo resuelvan, o
 * mezclar el envío en frío con el dominio transaccional (rompería el
 * aislamiento de reputación que se pidió a propósito en su momento), este
 * píxel mide la apertura por nuestra cuenta.
 *
 * `verify_jwt: false` obligatorio — lo pide el cliente de correo del
 * destinatario, sin ningún JWT.
 *
 * GET /track-prospect-open?id=<prospecting_leads.id>
 * Siempre responde con un GIF transparente 1x1, pase lo que pase (aunque el
 * id no exista o la actualización falle) — nunca debe romper la vista del
 * correo en el cliente de mail del destinatario.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// GIF transparente 1x1 real, en binario (43 bytes) — el más chico posible.
const PIXEL = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="), (c) => c.charCodeAt(0));
const PIXEL_HEADERS = {
    "Content-Type": "image/gif",
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    "Access-Control-Allow-Origin": "*",
};

Deno.serve(async (req: Request) => {
    try {
        const id = new URL(req.url).searchParams.get("id");
        if (id) {
            const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
                auth: { autoRefreshToken: false, persistSession: false },
            });
            // Solo la primera apertura — no pisa un email_opened_at ya registrado
            // (un cliente de correo puede re-pedir la imagen varias veces).
            await supabase
                .from("prospecting_leads")
                .update({ email_opened_at: new Date().toISOString() })
                .eq("id", id)
                .is("email_opened_at", null);
        }
    } catch {
        // Nunca debe fallar la respuesta al destinatario por un error interno.
    }
    return new Response(PIXEL, { headers: PIXEL_HEADERS });
});
