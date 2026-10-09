/**
 * Guard para funciones que SOLO debe invocar el sistema (pg_cron, otra edge function).
 *
 * `verify_jwt = true` NO basta: la anon key pública también es un JWT válido, así que
 * cualquiera con el bundle de vetly.pro podía disparar crons o mandar correos desde
 * hola@vetly.pro. Y las funciones con `verify_jwt = false` no tenían ningún control.
 *
 * La key de los jobs de pg_cron (JWT legacy) NO es igual, byte a byte, a
 * SUPABASE_SERVICE_ROLE_KEY del entorno de edge functions (otro formato), así que no
 * basta con comparar strings: si no coincide exacto, se valida contra el endpoint de
 * admin de Auth, que solo acepta una service role key real (cualquier formato).
 * Auditoría 2026-10-08.
 */
const verified = new Set<string>();

export async function isServiceRoleRequest(req: Request): Promise<boolean> {
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) return false;
    if (token === (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "")) return true;
    if (verified.has(token)) return true;
    try {
        const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/admin/users?per_page=1`, {
            headers: { apikey: token, Authorization: `Bearer ${token}` },
        });
        if (res.ok) { verified.add(token); return true; }
    } catch (_) { /* red caída → denegar */ }
    return false;
}

export function forbiddenResponse(): Response {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
    });
}
