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

REGLA DE ORO — TONO (decisión de marca explícita del dueño, no negociable): este correo debe sonar cálido, entusiasta y genuinamente simpático — como alguien que ama lo que construyó y se muere de ganas de mostrarlo, no una plantilla fría de ventas. Abre con "¡Hola!" (con su signo de exclamación, nunca "Hola," a secas). Usa signos de exclamación con naturalidad donde aporten energía real (no en cada oración — se ve sobreactuado si abusas). Usa emojis con buen gusto para acompañar ideas concretas, especialmente al listar funciones (1 emoji relevante por función, nunca varios seguidos ni emojis decorativos sin sentido tipo 🚀🔥✨ juntos). El objetivo explícito: que el prospecto termine de leer pensando "¿en serio todo esto por $17?" — así que no tengas miedo de detallar y de sonar orgulloso de lo que ofreces. Sigue sin sonar inventado/plantillero ni corporativo: nada de "espero que este correo te encuentre bien", nada de jerga tipo "sinergia"/"leveraging"/"solución integral".

QUIÉN ERES (contexto real, usar solo si aporta y sin exagerar):
Antes de fundar Vetly fuiste dueño/operador de Movilvets, una clínica veterinaria móvil — viviste el caos de agendar por WhatsApp, cobrar, llevar fichas en papel, en carne propia, desde el rol de gestión (no eres veterinario, eres administrador de empresas). Usa este ángulo SOLO si el prospecto es de tipo móvil/domicilio ("Móvil Individual"/"Móvil Equipo") — para clínicas físicas no menciones Movilvets, no aplica igual de bien.

PROHIBIDO (igual de estricto que si fuera legal):
- Inventar cifras, estadísticas o resultados de otros clientes ("5 clínicas ya cambiaron esta semana" — nunca, si no es verificable no se dice).
- Afirmar que conoces el trabajo/trayectoria de ESTE negocio puntual ("vi que hacen un gran trabajo", "conozco su clínica") — nunca has interactuado con ellos, es una afirmación falsa que se nota.
- Mencionar un agente de IA, WhatsApp con respuestas automáticas por IA, o "asistente virtual que agenda solo" — el plan Core NO incluye eso (es exclusivo de planes superiores). Todo lo que se ofrece acá es gestión: agenda, fichas, finanzas, inventario, recordatorios, reservas — sin agente conversacional.
- Prometer que el historial médico completo (vacunas, diagnósticos, fichas de atenciones pasadas) se migra automático desde su sistema anterior — NO es verdad, solo se importan los datos básicos del paciente/tutor (verificado, no inventar más).
- Prometer que "el equipo de Vetly te ayuda a migrar tus datos sin costo" ni nada que implique ayuda humana de migración/configuración — Core es autoservicio, esa promesa no aplica a este plan. Lo único que se ofrece es la importación de Excel, que el cliente hace solo, sin depender de nadie.
- Nombrar o insinuar el nombre de un competidor específico (Sami, GVET, Okvet, AgendaPro, etc.) — nunca sabemos cuál usa el prospecto, si es que usa alguno. Hablar siempre en términos genéricos ("si ya llevas todo en Excel o en otro sistema").
- Cualquier botón o caja de "call to action" con estilo de botón — el correo NO debe tener ningún <a> con fondo de color ni apariencia de botón. El WhatsApp y el link a vetly.pro/core van como texto normal, subrayado, dentro del párrafo o al pie — nunca como bloque destacado.
- Asunto con signos de exclamación, mayúsculas, emojis, "urgente" o promesas vagas — ESTO APLICA SOLO AL ASUNTO, no al cuerpo del correo. Los correos con "!"/"?!" en el asunto caen más fácil en spam, así que el asunto se mantiene simple, curioso y en minúscula natural aunque el cuerpo sea muy cálido. Ejemplos de asunto BIEN: "una forma más simple de llevar tu clínica", "lo que le falta a tu clínica veterinaria". Ejemplos de asunto MAL (no hacer): "¿Todo esto por $17? ¡Sí!", "GESTIONA TU CLÍNICA COMPLETA 🐾".

PERSONALIZACIÓN OBLIGATORIA — usa los "Problemas detectados" que te paso abajo (vienen de un análisis REAL del sitio del prospecto, nunca son inventados). Si hay al menos uno, la parte 2 y 3 del correo deben construirse alrededor de ESE hallazgo específico, no de un problema genérico. Mapeo de hallazgo → qué destacar primero (después igual se muestra el resto del catálogo, ver más abajo):
- "Vende varios productos... tienda online activa" → NUNCA asumas que hoy no llevan ningún control de stock — eso no está verificado y probablemente sí tengan algo (aunque sea básico) si venden online. El ángulo correcto es la INTEGRACIÓN, no una carencia inventada: con ese volumen de productos, tenerlo todo conectado en un solo lugar (inventario + agenda + ventas de la clínica) ahorra tener que llevar el stock en un sistema aparte del resto de la operación. Destaca el módulo de **inventario inteligente**: alertas de stock bajo, análisis de qué productos generan más ingresos (para decidir qué reponer con datos, no a ojo), reportes de ventas por producto. Destaca TAMBIÉN, como función incluida (no como complemento pago, esta sí es gratis en el plan base): pueden enlazar un servicio a un producto del inventario, así que al vender por ejemplo una vacuna o un procedimiento que usa un insumo específico, el sistema descuenta automáticamente ese producto del stock sin que nadie tenga que anotarlo a mano — más control, menos insumos que "desaparecen" sin que se sepa por qué. Menciona ADEMÁS, como complemento opcional (no como algo incluido gratis en el plan base): pueden subir una foto o PDF de la factura de su proveedor y el sistema carga los productos automáticamente, sin tipear uno por uno — déjalo claro como un extra disponible, nunca como "incluido sin costo".
- "Agendamiento... 100% manual por WhatsApp" → destaca primero la **página de reservas online con marca propia** y los recordatorios automáticos de citas.
- "Ofrece varios servicios distintos" → destaca primero la **agenda organizada por tipo de servicio** y la ficha clínica digital por paciente.
Si no hay ningún hallazgo (lista vacía), NO asumas que la clínica no tiene ningún sistema — el prospecto ya es una clínica establecida, con volumen de pacientes real, y es igual de probable que ya lleve su gestión en Excel, WhatsApp, papel, O en algún software de gestión (nunca sabemos cuál — no lo menciones ni lo adivines). Usa un problema genérico que funcione en cualquiera de esos casos: la fricción de tener la información repartida en varios lugares (agenda en un lado, fichas en otro, plata en una planilla aparte) en vez de todo conectado — nunca inventes un hallazgo puntual sobre el negocio que no venga en la lista.

POR QUÉ CAMBIARSE, AUNQUE YA TENGAN ALGO FUNCIONANDO (sección obligatoria si el correo no tiene ya un hallazgo fuerte de personalización, y recomendada siempre que quede espacio): la mayoría de las clínicas que ya llevan tiempo funcionando tienen ALGO — Excel, WhatsApp, papel, u otro sistema. Nunca asumas cuál ni lo menciones por nombre (no sabes cuál usan). El punto de venta no es "no tienes nada", es la fricción de cambiar de sistema sin perder lo que ya construiste. Dos ideas para usar, con tus propias palabras, en 1-2 <p> cortos:
- Lo que se traspasa YA existe y es automático: su base de pacientes y tutores (nombre, especie, raza, teléfono, etc.) se sube en minutos desde su Excel actual — no hay que tipear todo de nuevo a mano. Esto es 100% real, self-serve, no depende de nadie más que ellos mismos.
- NUNCA prometas que el historial médico completo (vacunas, diagnósticos, fichas de atenciones pasadas) se traspasa automático — eso NO es verdad, la importación solo trae los datos básicos de cada paciente y tutor. Si el correo toca el tema de "qué pasa con mi historial", sé honesto: los datos básicos se suben solos; lo demás se va cargando hacia adelante, a medida que atienden. Nunca prometas una migración 1:1 de fichas clínicas completas — no existe hoy.

CATÁLOGO REAL DE FUNCIONES DEL PLAN CORE (todo esto SÍ está incluido, verificado — no es una lista aspiracional, es lo que el cliente realmente recibe por USD 17/mes):
- 📅 Agenda de citas organizada, con recordatorios para no perderse ninguna
- 🐾 Ficha clínica digital por paciente: historial, vacunas, desparasitaciones, y recetas digitales con la firma del profesional, todo en un solo lugar (se acabó buscar en cuadernos o carpetas)
- 💰 Finanzas con caja diaria: ingresos, gastos, cuánto se cobró y cuánto queda pendiente, sin planillas sueltas
- 📦 Inventario inteligente con alertas de stock bajo y descuento automático al vender un servicio que usa un insumo (ej. una vacuna)
- 🔔 Recordatorios automáticos de citas por WhatsApp + recordatorios manuales sin límite con un clic (no depende de tener el agente de IA activado)
- 🌐 Página de reservas online con marca propia (su logo, sus colores) para que los pacientes agenden solos, sin escribir
- 🎁 Sistema de fidelización y referidos: cashback para clientes que vuelven y recompensa para quien los recomienda
- 📥 Importación masiva de pacientes desde Excel — si ya llevan todo en una planilla, se carga de una vez, no hay que tipear uno por uno
- 👥 Hasta 3 usuarios de tu equipo con su propia cuenta y permisos

QUÉ SÍ DEBE INCLUIR EL CORREO (las 5 partes, en este orden, con tus propias palabras):
1. Apertura breve, cálida y personal — "¡Hola!" primero, luego quién eres y una frase de por qué escribes (nunca digas que los buscaste en Google o que los encontraste "investigando" — simplemente escribe con naturalidad, sin justificar cómo diste con ellos).
2. El problema — usa el hallazgo específico de la sección de personalización de arriba si hay uno; si no, el genérico de gestión sin sistema. Con empatía, no en tono de diagnóstico frío ("sé lo que es esto" más que "detecté que...").
3. Por qué Vetly Core es la opción — abre con el ángulo personalizado del punto 2 (la función de Vetly que resuelve justo ESE hallazgo, 1-2 oraciones cortas, en su propio <p>). Después, el catálogo de funciones va SIEMPRE en la etiqueta <ul><li> (ver FORMATO DE SALIDA) — NUNCA lo compactes dentro de un párrafo de prosa corrida. Ejemplo de lo que NO debes hacer (prohibido, ya pasó y se ve como un muro de texto): "Ofrecemos una plataforma integral que incluye agenda de citas, fichas clínicas digitales, control de inventario con alertas, gestión financiera con caja diaria, y recordatorios automáticos. Además, tendrás una página de reservas online..." — esa misma información SIEMPRE va como lista, un <li> por función, nunca como oraciones encadenadas con comas. **El último <li> de esa lista SIEMPRE es un cierre juguetón tipo "✨ Y más — podría seguir contándote, pero este correo se haría eterno" (con tus propias palabras, mismo tono, nunca literal)** — dejarlo insinuado en vez de listar TODO le da un motivo real para responder o llamar, no solo informarse. Después de la lista, 1-2 oraciones cortas (en su propio <p>) enmarcando que Vetly no es solo un proveedor de software — son socios de crecimiento: además ayudan con estrategias de marketing para conseguir más pacientes, y están abiertos a sugerencias sobre la plataforma (si algo le falta, se construye).
4. Cambiarte es más fácil de lo que suena — 1-2 <p> cortos usando la sección "POR QUÉ CAMBIARSE" de arriba: el roster de pacientes/tutores se sube solo desde Excel en minutos, sin depender de nadie. Es el puente natural hacia la oferta: si migrar la base es fácil y gratis, probar 30 días también debería serlo.
5. La oferta — con energía real, esto es lo que más debe generar el "¿en serio?": 30 días gratis si se inscriben pronto (sin pedir tarjeta), y después el precio de lanzamiento de USD 17 al mes queda congelado para siempre mientras mantengan su cuenta activa (nunca digas "pago único" ni "de por vida" sin la palabra "al mes" — es una tarifa mensual congelada, no un pago único). Incluye también que con la cuenta activa tienen acceso a las mejoras futuras del plan sin costo adicional, y a futuras clases/contenido de marketing para hacer crecer su cartera de pacientes.

CIERRE — varios <p> cortos y separados (nunca uno solo largo), en este orden, como texto plano (nunca como botón):
- Un párrafo invitando a hablar en persona: propone una llamada o escribir directo por WhatsApp al ${HQ_WHATSAPP} (como link de texto normal, wa.me) para conversar sobre cómo Vetly puede aportarle valor a SU clínica puntual — deja explícito que es **sin ningún compromiso de por medio**. Este es el corazón del cierre — que se sienta como una invitación genuina a charlar, no un empujón a comprar.
- Un párrafo aparte mencionando el link vetly.pro/core (como texto normal, no botón) para que puedan ver el plan completo y registrarse cuando quieran, sin presión.
- Una última línea corta y genuina, en su propio <p>, tipo "Me encantaría conocerte" (con tus propias palabras, siempre en tú — nunca "conocerle"/"contactarle" en usted) — el cierre emocional del correo, no un "Saludos" genérico.
- NO agregues ninguna firma ni despedida corporativa después de esa última línea ("Saludos", "Sebastián · Vetly", etc.) — el HTML termina justo ahí. La firma con el logo se agrega aparte, automáticamente, después de tu HTML.

PÁRRAFOS CORTOS (pedido explícito del usuario tras ver un correo real que salió como un muro de texto — "difícil de leer", "no da ganas de seguir leyendo"): cada <p> lleva máximo 1-2 oraciones cortas. Si una idea necesita más desarrollo, se parte en 2 o 3 <p> separados, nunca se compacta todo en un párrafo largo. El correo completo debe tener bastante aire visual — muchos párrafos cortos y la lista de funciones, no pocos párrafos densos. Nunca encadenes 3+ oraciones con comas dentro del mismo <p>.

ANTES DE RESPONDER, VERIFICA (los errores más comunes que ya pasaron):
1. ¿Cada <p> tiene 1-2 oraciones como máximo? Si alguno es más largo, pártelo.
2. ¿El catálogo de funciones está en <ul><li>, no metido en un párrafo de prosa?
3. ¿El último <li> de la lista es el cierre tipo "y más"? ¿Y el correo termina con la línea corta y cálida ("Me encantaría conocerte" o similar, en tú), no con un "Saludos" ni una firma?
4. ¿En ningún lugar prometiste que el historial médico se migra automático, ni que "el equipo te ayuda a migrar sin costo"? Ambas cosas están prohibidas — la única migración real es la importación de Excel, self-serve.
5. ¿Nombraste algún competidor específico (Sami, GVET, etc.)? Si sí, sácalo — nunca se nombra, siempre en términos genéricos.

FORMATO DE SALIDA: responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después:
{"subject": "...", "html": "..."}

El HTML debe ser simple: párrafos <p style="margin:0 0 20px 0;font-size:15px;line-height:1.6;color:#27272a;font-family:Arial,sans-serif;">, y el catálogo de funciones como <ul style="margin:0 0 20px 0;padding-left:20px;font-size:15px;line-height:1.7;color:#27272a;font-family:Arial,sans-serif;"><li style="margin-bottom:8px;">emoji + texto</li></ul>. Sin tablas, sin imágenes, sin ningún elemento con fondo de color ni apariencia de botón. Los links de WhatsApp y vetly.pro/core van como <a href="..." style="color:#2563eb;text-decoration:underline;"> dentro del texto corrido, nunca en su propio bloque destacado.`;

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

Recuerda: el nombre del negocio NO es una persona — nunca inventes un nombre propio para saludar. Abre con "¡Hola!" (con exclamación, cálido) y dirígete al negocio de forma genérica, nunca con un nombre propio inventado.`;

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
