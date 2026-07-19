// Completa el Embedded Signup de WhatsApp Cloud API (flujo de coexistencia).
//
// El frontend obtiene un `code` de un solo uso desde el popup de Meta. Ese code se cambia
// acá por un token de negocio, porque el intercambio exige el App Secret y no puede ocurrir
// en el browser. Con el token se suscribe la app a la WABA — sin esa suscripción Meta no
// entrega ningún webhook y el número queda conectado pero mudo para Vetly.
//
// Coexistencia: NO se llama a /register. Ese endpoint mueve el número a Cloud API puro y
// desconectaría a la clínica de su WhatsApp Business App, que es justo lo que este flujo evita.

import { createClient } from "npm:@supabase/supabase-js@2";

const META_APP_ID = "1658152138764158";
const GRAPH = "https://graph.facebook.com/v22.0";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

    try {
        const { clinic_id, code, phone_number_id, waba_id } = await req.json();
        if (!clinic_id || !code) return json({ error: "Missing clinic_id or code" }, 400);

        // Auth: JWT + membresía activa (patrón estándar del repo).
        const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
        if (!jwt) return json({ error: "Unauthorized" }, 401);

        const sbUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
            global: { headers: { Authorization: `Bearer ${jwt}` } },
        });
        const { data: { user } } = await sbUser.auth.getUser();
        if (!user) return json({ error: "Unauthorized" }, 401);

        const { data: member } = await supabase
            .from("clinic_members")
            .select("role")
            .eq("user_id", user.id)
            .eq("clinic_id", clinic_id)
            .eq("status", "active")
            .maybeSingle();
        // Conectar el WhatsApp de la clínica es una acción estructural: solo owner/admin.
        if (!member || !["owner", "admin"].includes(member.role)) {
            return json({ error: "Forbidden" }, 403);
        }

        const appSecret = Deno.env.get("META_APP_SECRET");
        if (!appSecret) return json({ error: "META_APP_SECRET no configurado" }, 500);

        // 1. Code -> token de negocio.
        const tokenRes = await fetch(
            `${GRAPH}/oauth/access_token?client_id=${META_APP_ID}` +
            `&client_secret=${encodeURIComponent(appSecret)}&code=${encodeURIComponent(code)}`,
        );
        const tokenBody = await tokenRes.json().catch(() => null);
        if (!tokenRes.ok || !tokenBody?.access_token) {
            return json({ error: `Meta rechazó el código: ${tokenBody?.error?.message ?? tokenRes.status}` }, 400);
        }
        const accessToken: string = tokenBody.access_token;

        // 2. Resolver la WABA y el número. El popup los manda por postMessage, pero ese canal
        //    puede perderse (bloqueadores, cierre anticipado), así que hay fallback vía API.
        let resolvedWabaId: string | undefined = waba_id;
        let resolvedPhoneId: string | undefined = phone_number_id;

        if (!resolvedWabaId) {
            const debugRes = await fetch(
                `${GRAPH}/debug_token?input_token=${encodeURIComponent(accessToken)}` +
                `&access_token=${encodeURIComponent(accessToken)}`,
            );
            const debug = await debugRes.json().catch(() => null);
            const wabaScope = debug?.data?.granular_scopes?.find(
                (s: { scope: string; target_ids?: string[] }) => s.scope === "whatsapp_business_management",
            );
            resolvedWabaId = wabaScope?.target_ids?.[0];
        }
        if (!resolvedWabaId) return json({ error: "No se pudo determinar la WABA conectada" }, 400);

        if (!resolvedPhoneId) {
            const phonesRes = await fetch(
                `${GRAPH}/${resolvedWabaId}/phone_numbers?access_token=${encodeURIComponent(accessToken)}`,
            );
            const phones = await phonesRes.json().catch(() => null);
            resolvedPhoneId = phones?.data?.[0]?.id;
        }
        if (!resolvedPhoneId) return json({ error: "No se pudo determinar el número conectado" }, 400);

        // 3. Suscribir la app a la WABA para empezar a recibir webhooks.
        const subRes = await fetch(
            `${GRAPH}/${resolvedWabaId}/subscribed_apps?access_token=${encodeURIComponent(accessToken)}`,
            { method: "POST" },
        );
        const subBody = await subRes.json().catch(() => null);
        const subscribed = subRes.ok && subBody?.success !== false;

        // 4. Persistir. El token de negocio no expira mientras la clínica no revoque el acceso.
        const { error: updateError } = await supabase
            .from("clinic_settings")
            .update({
                meta_phone_number_id: resolvedPhoneId,
                meta_waba_id: resolvedWabaId,
                meta_access_token: accessToken,
                whatsapp_provider: "meta",
            })
            .eq("id", clinic_id);
        if (updateError) return json({ error: `No se pudo guardar: ${updateError.message}` }, 500);

        await supabase.from("debug_logs").insert({
            message: `[META SIGNUP] Coexistencia conectada para clinic ${clinic_id}`,
            payload: { phone_number_id: resolvedPhoneId, waba_id: resolvedWabaId, subscribed },
        });

        return json({
            success: true,
            phone_number_id: resolvedPhoneId,
            waba_id: resolvedWabaId,
            subscribed,
        });
    } catch (e) {
        return json({ error: (e as Error).message }, 500);
    }
});
