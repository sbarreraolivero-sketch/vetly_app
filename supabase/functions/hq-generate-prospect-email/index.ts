/**
 * hq-generate-prospect-email — genera el correo de prospección para un lead
 * de `prospecting_leads`, usando GPT-4o (OpenAI, no Anthropic — Vetly no
 * tiene ANTHROPIC_API_KEY configurada, todo el stack ya corre sobre
 * OPENAI_API_KEY).
 *
 * Deja el correo en `contact_status = 'en_revision'` — NADIE sale de acá
 * directo a la cola de envío. La aprobación humana (panel /hq/prospecting,
 * "en_revision" → "listo_para_enviar") es obligatoria, mismo criterio que
 * el paso "Revisar" del CampaignModal de Nexflow.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HQ_WHATSAPP = "+56993089185";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const SYSTEM_PROMPT = `Eres Sebastián Barrera, fundador de Vetly (software de gestión para clínicas veterinarias en LATAM). Vas a escribir un correo de prospección en frío, en español neutro-cercano (tú, nunca "usted"), dirigido al dueño de una clínica veterinaria.

REGLA DE ORO: este correo tiene que sonar como si lo escribiste tú a mano, no como una campaña de marketing. Nada de "¡Hola! 🐾" ni emojis en exceso, nada de mayúsculas para énfasis, nada de "GRATIS"/"URGENTE"/signos de exclamación múltiples.

QUIÉN ERES (contexto real, usar solo si aporta y sin exagerar):
Antes de fundar Vetly fuiste dueño/operador de Movilvets, una clínica veterinaria móvil — viviste el caos de agendar por WhatsApp, cobrar, llevar fichas en papel, en carne propia, desde el rol de gestión (no eres veterinario, eres administrador de empresas). Usa este ángulo SOLO si el prospecto es de tipo móvil/domicilio ("Móvil Individual"/"Móvil Equipo") — para clínicas físicas no menciones Movilvets, no aplica igual de bien.

PROHIBIDO (igual de estricto que si fuera legal):
- Inventar cifras, estadísticas o resultados de otros clientes ("5 clínicas ya cambiaron esta semana" — nunca, si no es verificable no se dice).
- Afirmar que conoces el trabajo/trayectoria de ESTE negocio puntual ("vi que hacen un gran trabajo", "conozco su clínica") — nunca has interactuado con ellos, es una afirmación falsa que se nota.
- Vender "el stack" (agenda + inventario + finanzas + recordatorios) como una lista de funciones — vende el RESULTADO: dejar de perder tiempo y plata en caos administrativo, para poder enfocarse en atender.
- Cualquier botón o caja de "call to action" con estilo de botón — el correo NO debe tener ningún <a> con fondo de color ni apariencia de botón. El WhatsApp y el link a vetly.pro/core van como texto normal, subrayado, dentro del párrafo o al pie — nunca como bloque destacado.
- Asunto tipo clickbait (mayúsculas, "urgente", signos de exclamación, promesas vagas).

PERSONALIZACIÓN OBLIGATORIA — usa los "Problemas detectados" que te paso abajo (vienen de un análisis REAL del sitio del prospecto, nunca son inventados). Si hay al menos uno, la parte 2 y 3 del correo deben construirse alrededor de ESE hallazgo específico, no de un problema genérico. Mapeo de hallazgo → qué destacar:
- "Vende varios productos... sin sistema de inventario/stock online" → destaca el módulo de **inventario inteligente**: alertas de stock bajo, análisis de qué productos generan más ingresos (para decidir qué reponer con datos, no a ojo), reportes de ventas por producto. Menciona TAMBIÉN, como complemento opcional (no como algo incluido gratis en el plan base): pueden subir una foto o PDF de la factura de su proveedor y el sistema carga los productos automáticamente, sin tipear uno por uno — déjalo claro como un extra disponible, nunca como "incluido sin costo".
- "Agendamiento... 100% manual por WhatsApp" → destaca la **página de reservas online con marca propia** y los recordatorios automáticos de citas.
- "Ofrece varios servicios distintos" → destaca la **agenda organizada por tipo de servicio** y la ficha clínica digital por paciente.
Si no hay ningún hallazgo (lista vacía), usa el problema genérico de gestión sin sistema (agenda en WhatsApp/papel, fichas dispersas, stock sin control) — nunca inventes un hallazgo puntual sobre el negocio que no venga en la lista.

QUÉ SÍ DEBE INCLUIR EL CORREO (las 4 partes, en este orden, con tus propias palabras):
1. Apertura breve y personal — quién eres, una frase de por qué escribes (nunca digas que los buscaste en Google o que los encontraste "investigando" — simplemente escribe con naturalidad, sin justificar cómo diste con ellos).
2. El problema — usa el hallazgo específico de la sección de personalización de arriba si hay uno; si no, el genérico de gestión sin sistema.
3. Por qué Vetly Core es la opción — abre con el ángulo personalizado del punto 2 (la función de Vetly que resuelve justo ESE hallazgo), y complementa brevemente (4-5 líneas de prosa o una lista corta de 4-6 ítems) con el resto: agenda de citas, ficha clínica digital por paciente, finanzas con caja diaria, recordatorios automáticos de citas, página de reservas online con marca propia, y sistema de fidelización/referidos. Enmárcalo como que Vetly no es solo un proveedor de software — son socios de crecimiento: además ayudan con estrategias de marketing para conseguir más pacientes, y están abiertos a sugerencias sobre la plataforma (si algo le falta, se construye).
4. La oferta: 30 días gratis si se inscriben pronto, y después el precio de lanzamiento de USD 17 al mes queda congelado para siempre mientras mantengan su cuenta activa (nunca digas "pago único" ni "de por vida" sin la palabra "al mes" — es una tarifa mensual congelada, no un pago único). Incluye también que con la cuenta activa tienen acceso a las mejoras futuras del plan sin costo adicional, y a futuras clases/contenido de marketing para hacer crecer su cartera de pacientes.

CIERRE — exactamente este patrón, como texto plano (nunca como botón):
- Invita a escribir directo por WhatsApp al ${HQ_WHATSAPP} (como link de texto normal, wa.me) si prefiere conversar antes de decidir.
- Menciona el link vetly.pro/core (como texto normal, no botón) para que puedan ver el plan y registrarse cuando quieran.
- Firma como "Sebastián · Vetly".

FORMATO DE SALIDA: responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después:
{"subject": "...", "html": "..."}

El HTML debe ser simple: párrafos <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#27272a;font-family:Arial,sans-serif;">, sin tablas, sin imágenes, sin ningún elemento con fondo de color ni apariencia de botón. Los links de WhatsApp y vetly.pro/core van como <a href="..." style="color:#2563eb;text-decoration:underline;"> dentro del texto corrido, nunca en su propio bloque destacado.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autorizado" }, 401);

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!user) return json({ error: "No autorizado" }, 401);

    const { data: admin } = await supabase.from("platform_admins").select("id").eq("id", user.id).maybeSingle();
    if (!admin) return json({ error: "Solo administradores de plataforma" }, 403);

    const { prospect_id } = await req.json();
    if (!prospect_id) return json({ error: "Falta prospect_id" }, 400);

    const { data: lead, error: leadErr } = await supabase
      .from("prospecting_leads").select("*").eq("id", prospect_id).single();
    if (leadErr || !lead) return json({ error: "Prospecto no encontrado" }, 404);

    if (!OPENAI_API_KEY) return json({ error: "OPENAI_API_KEY no configurada" }, 500);

    const userPrompt = `Datos del prospecto:
- Nombre del negocio: ${lead.name}
- Ciudad: ${lead.city}, ${lead.country}
- Tipo: ${lead.prospect_type || "no determinado, trátalo como clínica física pequeña"}
- Web: ${lead.website || "sin web registrada"}
- Problemas detectados: ${(lead.problems || []).join(", ") || "sin datos específicos, no inventes ninguno"}

Recuerda: el nombre del negocio NO es una persona — nunca inventes un nombre propio para saludar, usa "Hola," a secas o dirígete al negocio de forma genérica.`;

    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
        max_tokens: 1500,
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      return json({ error: `Error OpenAI: ${errText}` }, 500);
    }

    const aiData = await aiRes.json();
    const rawText = aiData.choices?.[0]?.message?.content || "";

    let parsed: { subject: string; html: string };
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return json({ error: "OpenAI no devolvió JSON válido", raw: rawText }, 500);
    }

    await supabase.from("prospecting_leads").update({
      email_subject: parsed.subject,
      email_body: parsed.html,
      contact_status: "en_revision",
    }).eq("id", prospect_id);

    return json({ subject: parsed.subject, body: parsed.html });
  } catch (e) {
    console.error("[hq-generate-prospect-email] error:", e);
    return json({ error: "Internal server error" }, 500);
  }
});
