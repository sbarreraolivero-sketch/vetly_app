import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
    normalizePhone,
    sendWhatsApp,
    runClinicDiagnostics,
    formatHealthReport,
    getYCloudBalance,
    getRecentErrors,
    checkOpenAI,
} from "../_shared/diagnostics.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HQ_ID = "00000000-0000-0000-0000-000000000000";

const corsHeaders = {
    "Access-Control-Allow-Origin": "https://ycloud.com",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, YCloud-Signature",
};

// ---------- HMAC verification (same scheme as ycloud-whatsapp-webhook) ----------
const verifyYCloudSignature = async (
    rawBody: string,
    signatureHeader: string | null,
    secret: string,
): Promise<boolean> => {
    if (!secret) return true; // permissive until secret is configured
    if (!signatureHeader) return false;
    try {
        const parts: Record<string, string> = {};
        for (const part of signatureHeader.split(",")) {
            const idx = part.indexOf("=");
            if (idx > 0) parts[part.substring(0, idx).trim()] = part.substring(idx + 1).trim();
        }
        const timestamp = parts["t"];
        const receivedSig = parts["s"];
        if (!timestamp || !receivedSig) return false;
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
            "raw",
            encoder.encode(secret),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"],
        );
        const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${rawBody}`));
        const digest = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
        return digest === receivedSig;
    } catch {
        return false;
    }
};

const callOpenAI = async (model: string, messages: unknown[], tools?: unknown[]) => {
    const body: Record<string, unknown> = { model, messages, temperature: 0.6, max_completion_tokens: 700 };
    if (tools) {
        body.tools = tools;
        body.tool_choice = "auto";
    }
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const data = await r.json();
    if (data.error) throw new Error(data.error.message || "OpenAI error");
    return data.choices[0].message;
};

// =====================================================================
// SALES CONSULTANT — "Andrés"
// =====================================================================
const SALES_PROMPT = `Eres "Andrés", consultor senior de Vetly con 8 años vendiendo software de gestión con IA para clínicas veterinarias.
Atiendes por WhatsApp a dueños/veterinarios interesados en Vetly.

ESTILO: cálido, directo, profesional. Español de Chile. Mensajes cortos (WhatsApp). Una idea por mensaje.

NO empieces con pitch. Primero CALIFICA con preguntas naturales (no como interrogatorio):
1. ¿Cuántos veterinarios trabajan en la clínica?
2. ¿Atienden en local, a domicilio o ambas?
3. ¿Cuántas citas por semana aprox?
4. ¿Usan WhatsApp Business hoy?
5. ¿Cuál es su mayor dolor: agenda, seguimiento de pacientes o comunicación con dueños?

Luego recomienda el plan que calce y explica el valor (recuperar ingresos, agendar 24/7, recordatorios que reducen inasistencia).

PLANES (CLP/mes, NUNCA inventes otros precios):
- Core $33.000: gestión completa SIN IA conversacional.
- Starter $89.000: veterinarios independientes, con IA por WhatsApp.
- Pro $149.000 (el más popular): clínicas en crecimiento, 5 usuarios · 5 agendas.
- Enterprise $349.000: redes y multi-sucursal.

OBJECIONES comunes y cómo responder:
- "Es caro" → compara con el costo de una sola inasistencia/mes o de contratar a alguien para responder WhatsApp.
- "Ya tengo sistema" → Vetly no es solo agenda, es un agente que responde y agenda solo 24/7.
- "Lo veo después" → ofrece dejar agendada una demo corta.

ACCIONES:
- En cuanto tengas nombre y algún interés, llama a "registrar_lead" para guardarlo en el CRM.
- Si el prospecto quiere una demo o muestra alta intención: pregunta qué día y hora le acomoda (lunes a viernes, 9:00–18:00 hora Chile). Cuando confirme, llama a "agendar_videollamada" para registrar la cita. Dile que lo contactará directamente Sebastián (el fundador) a la hora acordada.
- Si el prospecto dice que quiere contratar ahora mismo (sin demo), llama a "escalar_lead_caliente" y envíalo a https://vetly.pro/register.

Nunca inventes datos. Si no sabes algo puntual, ofrece confirmarlo.`;

const SALES_TOOLS = [
    {
        type: "function",
        function: {
            name: "registrar_lead",
            description: "Guarda o actualiza el prospecto en el CRM de Vetly. Llama apenas tengas el nombre y algún interés.",
            parameters: {
                type: "object",
                properties: {
                    nombre: { type: "string", description: "Nombre del prospecto o de la clínica." },
                    email: { type: "string", description: "Email si lo dio." },
                    interes: { type: "string", description: "Plan o servicio de interés, o el dolor principal." },
                    notas: { type: "string", description: "Resumen de la calificación: tamaño, modalidad, volumen, dolor." },
                    score: { type: "integer", description: "Calidad del lead de 0 a 100 según intención." },
                },
                required: ["nombre"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "escalar_lead_caliente",
            description: "Avisa al equipo humano de Vetly que este prospecto quiere contratar ahora (sin demo primero).",
            parameters: {
                type: "object",
                properties: {
                    resumen: { type: "string", description: "Por qué es un lead caliente y qué necesita." },
                },
                required: ["resumen"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "agendar_videollamada",
            description: "Agenda una demo por videollamada en el calendario HQ y notifica al fundador. Úsalo cuando el prospecto confirme día y hora para la demo.",
            parameters: {
                type: "object",
                properties: {
                    fecha: { type: "string", description: "Fecha en formato YYYY-MM-DD (ej: 2026-05-27)." },
                    hora: { type: "string", description: "Hora en formato HH:MM de 24h, hora Chile (ej: 15:30)." },
                    nombre_prospecto: { type: "string", description: "Nombre del prospecto o de la clínica." },
                    notas: { type: "string", description: "Plan de interés, tamaño de clínica, dolor principal." },
                },
                required: ["fecha", "hora", "nombre_prospecto"],
            },
        },
    },
];

type Sb = ReturnType<typeof createClient>;

const handleSales = async (
    sb: Sb,
    hq: HqConfig,
    fromPhone: string,
    profileName: string,
    text: string,
): Promise<string> => {
    // Load recent conversation history for this lead.
    const { data: history } = await sb
        .from("messages")
        .select("direction, content")
        .eq("clinic_id", HQ_ID)
        .eq("phone_number", fromPhone)
        .order("created_at", { ascending: true })
        .limit(16);

    const convo: unknown[] = [
        { role: "system", content: SALES_PROMPT + `\n\nNombre del contacto en WhatsApp: ${profileName || "(desconocido)"}. Su teléfono: ${fromPhone}.` },
        ...((history || []) as { direction: string; content: string }[]).map((m) => ({
            role: m.direction === "outbound" ? "assistant" : "user",
            content: m.content,
        })),
        { role: "user", content: text },
    ];

    let assistant = await callOpenAI("gpt-4o", convo, SALES_TOOLS);

    for (let i = 0; i < 3 && assistant.tool_calls?.length; i++) {
        convo.push(assistant);
        for (const call of assistant.tool_calls) {
            const args = JSON.parse(call.function.arguments || "{}");
            let result = "ok";
            try {
                if (call.function.name === "registrar_lead") {
                    await upsertProspect(sb, fromPhone, args);
                    result = "Lead registrado en el CRM.";
                } else if (call.function.name === "escalar_lead_caliente") {
                    if (hq.escalationPhone && hq.apiKey) {
                        await sendWhatsApp(
                            hq.apiKey,
                            hq.phone,
                            hq.escalationPhone,
                            `🔥 LEAD CALIENTE — ${args.resumen || ""}\n\nContacto: ${profileName || "(s/n)"} ${fromPhone}\nWhatsApp: https://wa.me/${normalizePhone(fromPhone)}`,
                        );
                    }
                    await sb.from("crm_prospects").update({ requires_human: true, score: 90 })
                        .eq("clinic_id", HQ_ID).eq("phone", fromPhone);
                    result = "Equipo humano notificado.";
                } else if (call.function.name === "agendar_videollamada") {
                    const appointmentDate = `${args.fecha}T${args.hora}:00`;
                    await sb.from("appointments").insert({
                        clinic_id: HQ_ID,
                        patient_name: args.nombre_prospecto || fromPhone,
                        phone_number: normalizePhone(fromPhone),
                        service: "Demo / Videollamada Vetly",
                        appointment_date: appointmentDate,
                        duration_minutes: 30,
                        status: "confirmed",
                        notes: args.notas || null,
                        price: 0,
                    });
                    if (hq.escalationPhone && hq.apiKey) {
                        const displayDate = new Date(appointmentDate).toLocaleString("es-CL", {
                            timeZone: "America/Santiago",
                            weekday: "long",
                            day: "numeric",
                            month: "long",
                            hour: "2-digit",
                            minute: "2-digit",
                        });
                        await sendWhatsApp(
                            hq.apiKey,
                            hq.phone,
                            hq.escalationPhone,
                            `📅 *Demo agendada*\n\n👤 ${args.nombre_prospecto}\n📞 ${fromPhone}\n🕐 ${displayDate}\n${args.notas ? `\n📝 ${args.notas}` : ""}`,
                        );
                    }
                    result = `Demo agendada el ${args.fecha} a las ${args.hora}h.`;
                }
            } catch (e) {
                result = `Error: ${String(e)}`;
            }
            convo.push({ role: "tool", tool_call_id: call.id, content: result });
        }
        assistant = await callOpenAI("gpt-4o", convo, SALES_TOOLS);
    }

    return assistant.content || "¿Me cuentas un poco más sobre tu clínica?";
};

const upsertProspect = async (
    sb: Sb,
    phone: string,
    args: { nombre?: string; email?: string; interes?: string; notas?: string; score?: number },
) => {
    const { data: existing } = await sb
        .from("crm_prospects")
        .select("id")
        .eq("clinic_id", HQ_ID)
        .eq("phone", phone)
        .maybeSingle();

    if (existing) {
        await sb.from("crm_prospects").update({
            name: args.nombre,
            email: args.email || null,
            service_interest: args.interes || null,
            notes: args.notas || null,
            score: args.score ?? null,
            updated_at: new Date().toISOString(),
        }).eq("id", (existing as { id: string }).id);
        return;
    }

    // First-time: place in the default/first stage of HQ pipeline.
    const { data: stage } = await sb
        .from("crm_pipeline_stages")
        .select("id")
        .eq("clinic_id", HQ_ID)
        .order("position", { ascending: true })
        .limit(1)
        .maybeSingle();

    await sb.from("crm_prospects").insert({
        clinic_id: HQ_ID,
        stage_id: (stage as { id: string } | null)?.id || null,
        name: args.nombre || "Prospecto WhatsApp",
        phone,
        email: args.email || null,
        service_interest: args.interes || null,
        notes: args.notas || null,
        score: args.score ?? null,
        source: "whatsapp_ventas",
    });
};

// =====================================================================
// SUPPORT COMMANDS (admin numbers)
// =====================================================================
const HELP_TEXT = `🛠️ *Soporte Vetly — comandos*
• *status* — estado de todas las clínicas
• *saldo* — saldo YCloud de cada clínica
• *errores* — errores recientes del sistema (6h)
• *openai* — estado de la conexión OpenAI
• *debug <clínica>* — diagnóstico completo de una clínica
• *ayuda* — esta lista`;

const handleSupportCommand = async (sb: Sb, hqApiKey: string, text: string): Promise<string> => {
    const cmd = text.trim().toLowerCase();

    if (cmd === "ayuda" || cmd === "help" || cmd === "comandos") return HELP_TEXT;

    // All operational clinics with a YCloud key (exclude HQ itself for health checks).
    const { data: clinics } = await sb
        .from("clinic_settings")
        .select("id, clinic_name, ycloud_api_key")
        .not("ycloud_api_key", "is", null)
        .neq("id", HQ_ID);
    const list = (clinics || []) as { id: string; clinic_name: string; ycloud_api_key: string }[];

    if (cmd === "status" || cmd === "estado") {
        if (list.length === 0) return "No hay clínicas con YCloud configurado.";
        const reports = await Promise.all(list.map((c) => runClinicDiagnostics(sb, c.id)));
        const ok = reports.filter((r) => r.status === "ok").length;
        const header = `📊 *Estado del sistema* — ${ok}/${reports.length} OK\n`;
        return header + "\n" + reports.map(formatHealthReport).join("\n\n");
    }

    if (cmd === "saldo" || cmd === "balance" || cmd === "saldos") {
        const lines = await Promise.all(list.map(async (c) => {
            const bal = await getYCloudBalance(c.ycloud_api_key);
            const icon = !bal ? "❓" : bal.amount <= 0 ? "🔴" : bal.amount < 5 ? "⚠️" : "✅";
            return `${icon} ${c.clinic_name}: ${bal ? `${bal.amount.toFixed(4)} ${bal.currency}` : "no disponible"}`;
        }));
        return "💰 *Saldo YCloud*\n" + lines.join("\n");
    }

    if (cmd === "errores" || cmd === "logs" || cmd === "log") {
        const errs = await getRecentErrors(sb, 360);
        if (errs.length === 0) return "✅ Sin errores clasificados en las últimas 6h.";
        return "📋 *Errores recientes (6h)*\n\n" + errs.map((e) => `🔴 ${e.summary}\n   → ${e.suggestedFix}`).join("\n\n");
    }

    if (cmd === "openai") {
        const res = await checkOpenAI(OPENAI_API_KEY);
        return res.ok ? "✅ OpenAI responde correctamente." : `🔴 OpenAI con problemas (status ${res.status}). ${res.detail || ""}`;
    }

    if (cmd.startsWith("debug")) {
        const term = text.trim().slice(5).trim().toLowerCase();
        if (!term) return "Uso: debug <nombre de clínica>";
        const match = list.find((c) => c.clinic_name.toLowerCase().includes(term));
        if (!match) return `No encontré una clínica que contenga "${term}".`;
        const health = await runClinicDiagnostics(sb, match.id);
        return formatHealthReport(health);
    }

    return `No reconozco ese comando.\n\n${HELP_TEXT}`;
};

// =====================================================================
// Helpers
// =====================================================================
interface HqConfig {
    apiKey: string;
    secret: string;
    phone: string;
    adminPhones: string[];
    escalationPhone: string;
    salesEnabled: boolean;
    supportEnabled: boolean;
}

const storeMessage = async (sb: Sb, phone: string, direction: string, content: string, aiModel?: string) => {
    await sb.from("messages").insert({
        clinic_id: HQ_ID,
        phone_number: phone,
        direction,
        content,
        ai_generated: direction === "outbound",
        ai_model: aiModel || null,
        message_type: "text",
    });
};

// =====================================================================
// Webhook handler
// =====================================================================
Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (req.method !== "POST") {
        return new Response(JSON.stringify({ status: "method_not_allowed" }), { status: 405, headers: corsHeaders });
    }

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    let rawBody = "";
    let p: { type?: string; whatsappInboundMessage?: { from?: string; to?: string; type?: string; text?: { body?: string }; customerProfile?: { name?: string } } };
    try {
        rawBody = await req.text();
        if (!rawBody.trim()) return new Response(JSON.stringify({ status: "ok" }), { headers: corsHeaders });
        p = JSON.parse(rawBody);
    } catch {
        return new Response(JSON.stringify({ status: "ok" }), { headers: corsHeaders });
    }

    // Only process real inbound text messages; ignore status updates/echoes.
    if (p.type !== "whatsapp.inbound_message.received" || !p.whatsappInboundMessage) {
        return new Response(JSON.stringify({ status: "ignored" }), { headers: corsHeaders });
    }

    // Load HQ config.
    const { data: hqRow } = await sb
        .from("clinic_settings")
        .select("ycloud_api_key, ycloud_webhook_secret, ycloud_phone_number, hq_admin_phones, hq_escalation_phone, hq_sales_agent_enabled, hq_support_agent_enabled")
        .eq("id", HQ_ID)
        .maybeSingle();

    const r = hqRow as {
        ycloud_api_key: string | null;
        ycloud_webhook_secret: string | null;
        ycloud_phone_number: string | null;
        hq_admin_phones: unknown;
        hq_escalation_phone: string | null;
        hq_sales_agent_enabled: boolean | null;
        hq_support_agent_enabled: boolean | null;
    } | null;

    const hq: HqConfig = {
        apiKey: r?.ycloud_api_key || "",
        secret: r?.ycloud_webhook_secret || "",
        phone: r?.ycloud_phone_number || "+56993089185",
        adminPhones: Array.isArray(r?.hq_admin_phones) ? (r!.hq_admin_phones as string[]) : [],
        escalationPhone: r?.hq_escalation_phone || "",
        salesEnabled: r?.hq_sales_agent_enabled ?? true,
        supportEnabled: r?.hq_support_agent_enabled ?? true,
    };

    // Verify HMAC signature.
    const signatureValid = await verifyYCloudSignature(rawBody, req.headers.get("YCloud-Signature"), hq.secret);
    if (!signatureValid) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const m = p.whatsappInboundMessage;
    const from = m.from || "";
    const text = m.type === "text" ? (m.text?.body || "") : "";
    const profileName = m.customerProfile?.name || "";

    if (!from || !text) {
        return new Response(JSON.stringify({ status: "ignored_non_text" }), { headers: corsHeaders });
    }

    // Respond async; ack immediately so YCloud doesn't retry.
    const process = async () => {
        try {
            await storeMessage(sb, from, "inbound", text);

            const normFrom = normalizePhone(from);
            const isAdmin = hq.adminPhones.some((a) => normalizePhone(a) === normFrom);

            let reply: string;
            let model = "gpt-4o";

            if (isAdmin && hq.supportEnabled) {
                reply = await handleSupportCommand(sb, hq.apiKey, text);
                model = "support-command";
            } else if (hq.salesEnabled) {
                reply = await handleSales(sb, hq, from, profileName, text);
            } else {
                reply = "Gracias por tu mensaje. En breve un asesor te contactará.";
                model = "static";
            }

            if (hq.apiKey) {
                await sendWhatsApp(hq.apiKey, hq.phone, from, reply);
                await storeMessage(sb, from, "outbound", reply, model);
            }
        } catch (e) {
            console.error("[vetly-hq-agent] process error:", e);
            await sb.from("debug_logs").insert({ message: "vetly-hq-agent error", payload: { error: String(e), from } });
        }
    };

    // @ts-ignore EdgeRuntime is provided by the Supabase runtime.
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(process());
    } else {
        await process();
    }

    return new Response(JSON.stringify({ status: "ok" }), { headers: corsHeaders });
});
