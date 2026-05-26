import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
    runClinicDiagnostics,
    formatHealthReport,
    sendWhatsApp,
} from "../_shared/diagnostics.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const HQ_ID = "00000000-0000-0000-0000-000000000000";

const SALES_PROMPT = `Eres "Andrés", consultor senior de Vetly — un SaaS de gestión con IA para clínicas veterinarias.
Tu trabajo es ayudar a clínicas a entender cómo Vetly recupera ingresos automatizando agenda por WhatsApp, CRM médico, recordatorios y campañas.

ESTILO: directo, cálido, profesional. No haces pitch agresivo. Primero entiendes la clínica, después recomiendas.

PLANES (precios en CLP/mes, nunca inventes otros precios):
- Core — $33.000: gestión completa SIN IA conversacional.
- Starter — $89.000: para veterinarios independientes. Incluye IA por WhatsApp.
- Pro — $149.000 (el más popular): para clínicas en crecimiento. 5 usuarios · 5 agendas.
- Enterprise — $349.000: redes y multi-sucursal.
Extra opcional en todos: recarga de mensajería masiva de marketing y recordatorios.

REGLAS:
1. Si no sabes un dato puntual, dilo; nunca inventes precios, features ni cifras.
2. Para cerrar o probar, invita a registrarse en https://vetly.pro/register o a continuar la conversación por WhatsApp.
3. Respuestas breves, en español de Chile, con viñetas cuando ayude.`;

const SUPPORT_PROMPT = `Eres el asistente de Soporte Técnico de Vetly, dentro de la app.
Ayudas a los usuarios (dueños/equipo de clínicas) con dos cosas:
1. Dudas de uso de la plataforma (agenda, CRM, recordatorios, campañas, fidelización, configuración del bot).
2. Reportes de errores: "mi bot no responde", "no llegan recordatorios", "da problema técnico", etc.

CUANDO EL USUARIO REPORTA UN ERROR O ALGO QUE NO FUNCIONA:
- Llama a la herramienta "diagnosticar_sistema" para revisar el estado real de su clínica (saldo YCloud, firma, errores recientes, agente mudo, recordatorios fallidos).
- Explica en lenguaje simple qué encontraste y el siguiente paso concreto.
- Si el problema requiere intervención del equipo Vetly (bug de código, recarga de saldo, template por aprobar), usa "escalar_a_soporte" para avisar al equipo y dile al usuario que ya se notificó.

ESTILO: claro, en pasos simples, español de Chile. No inventes causas: básate en lo que devuelve el diagnóstico.`;

const SUPPORT_TOOLS = [
    {
        type: "function",
        function: {
            name: "diagnosticar_sistema",
            description: "Revisa el estado real de la clínica del usuario: saldo YCloud, configuración de firma, errores recientes, detección de agente mudo y recordatorios fallidos. Úsalo SIEMPRE que el usuario reporte un error o algo que no funciona.",
            parameters: { type: "object", properties: {}, required: [] },
        },
    },
    {
        type: "function",
        function: {
            name: "escalar_a_soporte",
            description: "Notifica al equipo Vetly por WhatsApp cuando el problema requiere intervención humana (bug de código, recarga de saldo, template por aprobar). Úsalo después de diagnosticar.",
            parameters: {
                type: "object",
                properties: {
                    resumen: { type: "string", description: "Resumen breve del problema del usuario y el hallazgo del diagnóstico." },
                },
                required: ["resumen"],
            },
        },
    },
];

const callOpenAI = async (model: string, messages: unknown[], tools?: unknown[]) => {
    const body: Record<string, unknown> = {
        model,
        messages,
        temperature: 0.6,
        max_completion_tokens: 600,
    };
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
    if (data.error) {
        console.error("OpenAI Error:", data.error);
        throw new Error("Error interno al comunicarse con IA");
    }
    return data.choices[0].message;
};

// Support intent → pick model. Errors/diagnosis go to 4o; plain FAQ to mini.
const ERROR_HINTS = /no responde|no funciona|error|mudo|falla|fallo|problema|no llega|no env[ií]a|ca[ií]do|no anda|atascad|no contesta|saldo|template/i;

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const { messages, variant, clinic_id } = await req.json();
        if (!messages || !Array.isArray(messages)) throw new Error("Formato de mensajes inválido");
        if (!OPENAI_API_KEY) throw new Error("No se encontró OPENAI_API_KEY");

        const type = variant === "sales" ? "sales" : "support";

        // ---------- SALES (public landing, no auth) ----------
        if (type === "sales") {
            const reply = await callOpenAI("gpt-4o-mini", [
                { role: "system", content: SALES_PROMPT },
                ...messages.map((m: { sender: string; text: string }) => ({
                    role: m.sender === "ai" ? "assistant" : "user",
                    content: m.text,
                })),
            ]);
            return new Response(JSON.stringify({ reply: reply.content }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
                status: 200,
            });
        }

        // ---------- SUPPORT (in-app, JWT-verified clinic) ----------
        const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

        // Verify identity from JWT and confirm membership of the requested clinic.
        let verifiedClinicId: string | null = null;
        const authHeader = req.headers.get("Authorization");
        if (authHeader && clinic_id) {
            const userClient = createClient(SUPABASE_URL, ANON_KEY, {
                global: { headers: { Authorization: authHeader } },
            });
            const { data: { user } } = await userClient.auth.getUser();
            if (user) {
                const { data: membership } = await service
                    .from("clinic_members")
                    .select("clinic_id")
                    .eq("user_id", user.id)
                    .eq("clinic_id", clinic_id)
                    .eq("status", "active")
                    .maybeSingle();
                if (membership) verifiedClinicId = clinic_id;
                if (!verifiedClinicId) {
                    const { data: prof } = await service
                        .from("user_profiles")
                        .select("clinic_id")
                        .eq("id", user.id)
                        .maybeSingle();
                    if (prof?.clinic_id === clinic_id) verifiedClinicId = clinic_id;
                }
            }
        }

        const lastUser = [...messages].reverse().find((m: { sender: string }) => m.sender === "user");
        const model = ERROR_HINTS.test(lastUser?.text || "") ? "gpt-4o" : "gpt-4o-mini";

        const convo: unknown[] = [
            { role: "system", content: SUPPORT_PROMPT },
            ...messages.map((m: { sender: string; text: string }) => ({
                role: m.sender === "ai" ? "assistant" : "user",
                content: m.text,
            })),
        ];

        // Tools only available when we have a verified clinic to diagnose.
        const tools = verifiedClinicId ? SUPPORT_TOOLS : undefined;
        let toolsUsed = 0;
        let assistantMsg = await callOpenAI(model, convo, tools);

        for (let i = 0; i < 3 && assistantMsg.tool_calls?.length; i++) {
            convo.push(assistantMsg);
            for (const call of assistantMsg.tool_calls) {
                toolsUsed++;
                let result = "";
                try {
                    if (call.function.name === "diagnosticar_sistema" && verifiedClinicId) {
                        const health = await runClinicDiagnostics(service, verifiedClinicId);
                        result = formatHealthReport(health);
                    } else if (call.function.name === "escalar_a_soporte" && verifiedClinicId) {
                        const args = JSON.parse(call.function.arguments || "{}");
                        const { data: hq } = await service
                            .from("clinic_settings")
                            .select("ycloud_api_key, ycloud_phone_number, hq_escalation_phone")
                            .eq("id", HQ_ID)
                            .maybeSingle();
                        const { data: clinic } = await service
                            .from("clinic_settings")
                            .select("clinic_name")
                            .eq("id", verifiedClinicId)
                            .maybeSingle();
                        if (hq?.ycloud_api_key && hq?.hq_escalation_phone) {
                            await sendWhatsApp(
                                hq.ycloud_api_key,
                                hq.ycloud_phone_number || "+56993089185",
                                hq.hq_escalation_phone,
                                `🆘 Soporte in-app — ${clinic?.clinic_name || verifiedClinicId}\n\n${args.resumen || "(sin resumen)"}`,
                            );
                            result = "Listo, el equipo Vetly fue notificado.";
                        } else {
                            result = "No se pudo notificar (falta config de escalación en el HQ).";
                        }
                    } else {
                        result = "Herramienta no disponible.";
                    }
                } catch (e) {
                    result = `Error ejecutando la herramienta: ${String(e)}`;
                }
                convo.push({ role: "tool", tool_call_id: call.id, content: result });
            }
            assistantMsg = await callOpenAI(model, convo, tools);
        }

        return new Response(JSON.stringify({ reply: assistantMsg.content, tools_used: toolsUsed }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
        });
    } catch (error) {
        console.error("Function Error:", (error as Error).message);
        return new Response(JSON.stringify({ error: (error as Error).message }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 400,
        });
    }
});
