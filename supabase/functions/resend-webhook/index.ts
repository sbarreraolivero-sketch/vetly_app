/**
 * Webhook de Resend — captura eventos `email.opened` (y de paso
 * `email.delivered`) de los correos de la secuencia de onboarding, para que
 * el HQ pueda mostrar "correos abiertos", no solo "enviados".
 *
 * `verify_jwt: false` a propósito: Resend no manda un JWT de Supabase, manda
 * su propia firma Svix (`svix-id`/`svix-timestamp`/`svix-signature`).
 *
 * ⚠️ Paso manual pendiente (no lo puede hacer Claude): en el dashboard de
 * Resend → Webhooks → agregar endpoint apuntando a esta función
 * (`{SUPABASE_URL}/functions/v1/resend-webhook`), eventos `email.delivered` y
 * `email.opened`. Resend entrega ahí el signing secret (`whsec_...`) — copiarlo
 * a Supabase → Edge Functions → Secrets como `RESEND_WEBHOOK_SECRET`.
 *
 * Falla abierto sin ese secret (mismo criterio que Turnstile en
 * signup-handler): mientras no esté configurado, los eventos se procesan sin
 * verificar firma — severidad baja, el peor caso es que alguien falsee un
 * "abierto" en un contador interno del HQ, no hay dato sensible ni acción
 * destructiva en juego. Igual queda logueado si falta el secret, para que no
 * pase desapercibido para siempre.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RESEND_WEBHOOK_SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET") || "";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature",
};

// Resend firma con Svix real (a diferencia del falso-Svix de YCloud
// documentado en otra parte de este proyecto — acá el formato base64 SÍ
// aplica, es el estándar Svix genuino).
async function verifySvix(secret: string, svixId: string, svixTimestamp: string, svixSignature: string, rawBody: string): Promise<boolean> {
    try {
        const secretBytes = Uint8Array.from(atob(secret.replace(/^whsec_/, "")), (c) => c.charCodeAt(0));
        const signedPayload = `${svixId}.${svixTimestamp}.${rawBody}`;
        const key = await crypto.subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
        const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
        const expected = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)));

        // El header trae una o más firmas separadas por espacio, cada una "v1,<base64>".
        const candidates = svixSignature.split(" ").map((s) => s.split(",")[1]).filter(Boolean);
        return candidates.includes(expected);
    } catch {
        return false;
    }
}

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }
    if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsHeaders });
    }

    const rawBody = await req.text();

    if (RESEND_WEBHOOK_SECRET) {
        const svixId = req.headers.get("svix-id") || "";
        const svixTimestamp = req.headers.get("svix-timestamp") || "";
        const svixSignature = req.headers.get("svix-signature") || "";
        const ok = await verifySvix(RESEND_WEBHOOK_SECRET, svixId, svixTimestamp, svixSignature, rawBody);
        if (!ok) {
            return new Response(JSON.stringify({ error: "invalid signature" }), { status: 401, headers: corsHeaders });
        }
    } else {
        console.warn("[resend-webhook] RESEND_WEBHOOK_SECRET no configurado — procesando sin verificar firma.");
    }

    try {
        const payload = JSON.parse(rawBody);
        const eventType: string = payload?.type || "";
        const resendId: string | undefined = payload?.data?.email_id;

        if (!resendId) {
            return new Response(JSON.stringify({ ok: true, skipped: "sin email_id" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            auth: { autoRefreshToken: false, persistSession: false },
        });

        if (eventType === "email.opened") {
            // No pisa un opened_at ya registrado (nos interesa el primero),
            // pero sí incrementa el contador de aperturas repetidas.
            const { data: existing } = await supabase
                .from("email_sequence_log")
                .select("id, opened_at, open_count")
                .eq("resend_id", resendId)
                .maybeSingle();

            if (existing) {
                await supabase
                    .from("email_sequence_log")
                    .update({
                        opened_at: existing.opened_at ?? new Date().toISOString(),
                        open_count: (existing.open_count ?? 0) + 1,
                    })
                    .eq("id", existing.id);
            } else {
                // No es un correo de la secuencia de onboarding — probar si es
                // un correo de la campaña de prospección (prospecting_leads).
                await supabase
                    .from("prospecting_leads")
                    .update({ email_opened_at: new Date().toISOString() })
                    .eq("resend_id", resendId)
                    .is("email_opened_at", null);
            }
        } else if (eventType === "email.delivered") {
            await supabase
                .from("email_sequence_log")
                .update({ delivered_at: new Date().toISOString() })
                .eq("resend_id", resendId)
                .is("delivered_at", null);
        }

        return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } catch (e) {
        console.error("[resend-webhook] error:", e);
        return new Response(JSON.stringify({ error: "internal error" }), { status: 500, headers: corsHeaders });
    }
});
