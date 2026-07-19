// Reporta a Meta CAPI el evento Purchase de una cita creada desde el dashboard.
//
// El webhook ya dispara Purchase cuando el AI agent agenda via tool call, pero ese bloque
// vive despues del `return` de `ai_auto_respond`: con el agente apagado (el caso de
// AnimalGrace Linares) nunca se alcanza, y las citas que Claudia carga a mano no generaban
// ninguna senal. Resultado: Meta optimizaba las campanas Click-to-WhatsApp conociendo solo
// quien inicio conversacion, nunca quien termino agendando.
//
// El token CAPI vive en clinic_settings y no puede exponerse al browser, de ahi que esto
// sea una edge function y no una llamada directa desde el frontend.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

const sendMetaCAPIEvent = async (
    pixelId: string,
    accessToken: string,
    phone: string,
    ctwaClid: string,
    contentName?: string,
    testEventCode?: string,
    pageId?: string,
) => {
    const normalized = phone.replace(/\D/g, "");
    const hashBuffer = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(normalized),
    );
    const hashedPhone = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

    const userData: Record<string, unknown> = { ph: [hashedPhone], ctwa_clid: ctwaClid };
    if (pageId) userData.page_id = pageId;

    const payload: Record<string, unknown> = {
        data: [{
            event_name: "Purchase",
            event_time: Math.floor(Date.now() / 1000),
            action_source: "business_messaging",
            messaging_channel: "whatsapp",
            event_id: `Purchase_${normalized}_${Date.now()}`,
            user_data: userData,
            ...(contentName ? { custom_data: { content_name: contentName } } : {}),
        }],
    };
    if (testEventCode) payload.test_event_code = testEventCode;

    const res = await fetch(
        `https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${accessToken}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        },
    );
    return { status: res.status, body: await res.json().catch(() => null) };
};

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

    try {
        const { clinic_id, phone_number, service_name } = await req.json();
        if (!clinic_id || !phone_number) {
            return json({ error: "Missing required fields" }, 400);
        }

        // Auth: JWT + membresia activa en la clinica (patron estandar del repo).
        const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
        if (!jwt) return json({ error: "Unauthorized" }, 401);

        const sbUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
            global: { headers: { Authorization: `Bearer ${jwt}` } },
        });
        const { data: { user } } = await sbUser.auth.getUser();
        if (!user) return json({ error: "Unauthorized" }, 401);

        const { data: member } = await supabase
            .from("clinic_members")
            .select("id")
            .eq("user_id", user.id)
            .eq("clinic_id", clinic_id)
            .eq("status", "active")
            .maybeSingle();
        if (!member) return json({ error: "Forbidden" }, 403);

        // Solo hay algo que reportar si el tutor llego desde un anuncio C2W.
        // Meta exige ctwa_clid en eventos business_messaging: sin el, rechaza con error 2804071.
        const normalizedPhone = String(phone_number).replace(/\D/g, "");
        const { data: tutor } = await supabase
            .from("tutors")
            .select("id, ctwa_clid, capi_purchase_sent_at")
            .eq("clinic_id", clinic_id)
            .eq("phone_number", normalizedPhone)
            .maybeSingle();

        if (!tutor?.ctwa_clid) return json({ skipped: "no_ctwa_clid" });
        if (tutor.capi_purchase_sent_at) return json({ skipped: "already_sent" });

        const { data: clinic } = await supabase
            .from("clinic_settings")
            .select("meta_pixel_id, meta_capi_token, meta_page_id, meta_test_event_code")
            .eq("id", clinic_id)
            .single();

        if (!clinic?.meta_pixel_id || !clinic?.meta_capi_token) {
            return json({ skipped: "capi_not_configured" });
        }

        const result = await sendMetaCAPIEvent(
            clinic.meta_pixel_id,
            clinic.meta_capi_token,
            normalizedPhone,
            tutor.ctwa_clid,
            service_name,
            clinic.meta_test_event_code || undefined,
            clinic.meta_page_id || undefined,
        );

        await supabase
            .from("tutors")
            .update({ capi_purchase_sent_at: new Date().toISOString() })
            .eq("id", tutor.id)
            .is("capi_purchase_sent_at", null);

        await supabase.from("debug_logs").insert({
            message: `[META CAPI] Purchase(dashboard) result for ${normalizedPhone}`,
            payload: result,
        });

        return json({ sent: true, meta_status: result.status });
    } catch (e) {
        return json({ error: (e as Error).message }, 500);
    }
});
