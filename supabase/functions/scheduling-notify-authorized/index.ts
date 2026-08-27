// Avisa proactivamente por WhatsApp al tutor cuando la coordinadora autoriza
// horarios en el panel de Citas Médicas.
//
// Antes de esto, autorizar una solicitud solo reactivaba la IA (requires_human=false)
// pero no le avisaba a nadie — el tutor solo se enteraba si volvía a escribir por su
// cuenta, y ni siquiera entonces la IA siempre lo mencionaba (confirmado en producción
// con 2 solicitudes autorizadas el 2026-08-26 que nunca llegaron a su destinatario).

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

// Duplicado deliberadamente (no extraído a _shared/): el proyecto no comparte
// helpers de envío entre edge functions, ver meta-whatsapp-webhook/index.ts.
const sendMetaMessage = async (phoneNumberId: string, accessToken: string, to: string, text: string) => {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body: text } }),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
};

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

    try {
        const { clinic_id, request_id } = await req.json();
        if (!clinic_id || !request_id) return json({ error: "Missing required fields" }, 400);

        // Auth: JWT + membresia activa en la clinica (patron estandar del repo,
        // ver send-visit-receipt y meta-capi-purchase).
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

        // Se relee la fila desde la DB en vez de confiar en lo que mande el cliente —
        // garantiza que el mensaje enviado sea exactamente lo que quedó autorizado.
        const { data: request } = await supabase
            .from("scheduling_requests")
            .select("id, clinic_id, tutor_phone, tutor_name, status, authorized_options")
            .eq("id", request_id)
            .eq("clinic_id", clinic_id)
            .maybeSingle();

        if (!request) return json({ error: "Solicitud no encontrada" }, 404);
        if (request.status !== "authorized" || !request.authorized_options) {
            return json({ skipped: "not_authorized" });
        }

        const { data: clinic } = await supabase
            .from("clinic_settings")
            .select("meta_phone_number_id, meta_access_token")
            .eq("id", clinic_id)
            .single();

        if (!clinic?.meta_phone_number_id || !clinic?.meta_access_token) {
            // Hoy ninguna clínica en modo coordinador usa YCloud — si eso cambia,
            // agregar la rama YCloud aquí (mismo patrón que send-visit-receipt).
            return json({ skipped: "no_meta_channel" });
        }

        const text = `¡Hola de nuevo! 😊 Ya coordinamos la ruta para tu visita. Podemos ofrecerte:\n\n${request.authorized_options}\n\n¿Cuál de esas opciones te acomoda más?`;

        const result = await sendMetaMessage(
            clinic.meta_phone_number_id,
            clinic.meta_access_token,
            request.tutor_phone,
            text,
        );

        // CRÍTICO: registrar el mensaje en `messages`, con el mismo shape que usa
        // saveMsg() en el webhook. Sin esto el envío es invisible tanto para el
        // dashboard como para el propio historial que arma el AI agent — su
        // "memoria" de la conversación se construye leyendo esta tabla, así que
        // un mensaje real no registrado aquí deja a la IA sin saber que ya le
        // ofreció esas horas al tutor. Confirmado como causa raíz de contradicciones
        // reales en producción el 2026-08-27 (ver auditoría de esa fecha).
        await supabase.from("messages").insert({
            clinic_id,
            phone_number: request.tutor_phone,
            content: text,
            direction: "outbound",
            ai_generated: false,
            message_type: "text",
        });

        await supabase.from("debug_logs").insert({
            message: `[SCHEDULING NOTIFY] Aviso de autorización enviado a ${request.tutor_phone}`,
            payload: result,
        });

        return json({ sent: true, meta_status: result.status });
    } catch (e) {
        return json({ error: (e as Error).message }, 500);
    }
});
