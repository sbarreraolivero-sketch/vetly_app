import "https://deno.land/x/xhr@0.3.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

const SYSTEM_PROMPTS = {
    sales: `Eres Citenly AI, un experto asesor de crecimiento para clínicas médicas estéticas.
Tu objetivo es ayudar a los visitantes a entender cómo nuestra Infraestructura Inteligente (Software 2.0) puede recuperar ingresos perdidos mediante la automatización de la agenda, CRM y un motor de retención predictivo.
No somos "un software de agenda más", somos un motor de ingresos que funciona 24/7.

Reglas clave:
1. Sé persuasivo, directo y enfocado en resultados financieros.
2. Usa un tono moderno, profesional y premium.
3. Si el usuario muestra interés en probar la plataforma o agendar, indícale amablemente que puede registrarse o agendar su implementación en: https://citenly.com/register
4. Nuestros planes: Essence ($79/mes - ideal para inicio), Radiance ($159/mes - el más popular para crecimiento) y Prestige ($299/mes - multi-sucursal y escala total).`,

    support: `Eres el Copilot de Soporte de Citenly AI.
Tu objetivo es asistir a los usuarios de la plataforma con dudas sobre el uso del CRM, Agenda, Motor de Retención o Campañas Masivas.
Sé amable, claro y usa viñetas o pasos simples para explicar.
Si te piden ayuda técnica compleja, recomienda contactar a 'soporte técnico humano' desde el menú.`,
};

serve(async (req) => {
    // Manejo de CORS (Preflight)
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const { messages, variant } = await req.json();

        if (!messages || !Array.isArray(messages)) {
            throw new Error("Formato de mensajes inválido");
        }

        if (!OPENAI_API_KEY) {
            throw new Error("No se encontró OPENAI_API_KEY en las variables de entorno");
        }

        const type = variant === "sales" ? "sales" : "support";
        const systemMessage = { role: "system", content: SYSTEM_PROMPTS[type] };

        // Formatear mensajes para OpenAI
        const promptMessages = [
            systemMessage,
            ...messages.map((m: any) => ({
                role: m.sender === "ai" ? "assistant" : "user",
                content: m.text,
            })),
        ];

        // Llamada a OpenAI
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "gpt-4o-mini", // O cambiar a gpt-4o si tienes acceso y quieres máxima calidad
                messages: promptMessages,
                temperature: 0.7,
                max_tokens: 500,
                stream: false, // Por ahora usaremos la respuesta completa para simplificar el frontend, pero puede ser true
            }),
        });

        const data = await response.json();

        if (data.error) {
            console.error("OpenAI Error:", data.error);
            throw new Error("Error interno al comunicarse con IA");
        }

        const reply = data.choices[0].message.content;

        return new Response(JSON.stringify({ reply }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
        });

    } catch (error: any) {
        console.error("Function Error:", error.message);
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 400,
        });
    }
});
