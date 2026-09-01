/**
 * hq-analyze-medical-history — extrae eventos médicos (vacunas,
 * desparasitaciones, consultas) de un LOTE de filas de un Excel/CSV
 * exportado de otro sistema, para migrarlos a Vetly. Mismo patrón que
 * analyze-invoice (GPT-4o-mini, JSON forzado, revisión humana obligatoria
 * después) pero para datos tabulares, no imágenes.
 *
 * Se llama UNA VEZ POR LOTE (hasta 50 filas) — el cliente (modal HQ) hace
 * el chunking y llama esta función en loop, acumulando resultados.
 *
 * NUNCA toca clinic_settings/ai_credit_transactions del cliente — el costo
 * de OpenAI lo paga la cuenta de Vetly directamente (mismo OPENAI_API_KEY
 * que usan chat-agent/ycloud-whatsapp-webhook/hq-generate-prospect-email).
 * Decisión de diseño: el plan Core tiene 0 créditos IA (plan_limits), y la
 * promesa al cliente es "te ayudamos" (el equipo, no self-serve) — cobrar
 * créditos acá contradiría ambas cosas.
 *
 * Esta función NUNCA escribe en ninguna tabla — solo devuelve JSON. El
 * insert real ocurre en hq-commit-medical-history, después de que un
 * humano revisó y confirmó cada evento.
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

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const SYSTEM_PROMPT = `Eres un asistente que extrae eventos médicos veterinarios (vacunas, desparasitaciones, consultas) desde una hoja de cálculo exportada por una clínica veterinaria, para migrarlos a Vetly (otro software de gestión). Te paso un lote de filas ya parseadas (como objetos JSON, una clave por columna original tal como venía en el archivo) más el nombre de la hoja de origen — puede dar una pista del tipo de evento (ej. "Vacunas"), pero no confíes ciegamente en el nombre de hoja, mira también el contenido real de cada fila.

Para CADA fila del lote, determina:

1. event_type: "vaccine" | "deworming" | "consultation" | "unknown"
   - "vaccine" si la fila describe una vacuna aplicada (nombre de vacuna, antígeno, "vacuna óctuple", "antirrábica", etc.)
   - "deworming" si describe una desparasitación (interna/externa, antipulgas, antiparasitario, producto tipo Drontal/Nexgard/Bravecto/etc.)
   - "consultation" si describe una consulta/atención general (motivo, diagnóstico, síntomas) sin ser específicamente vacuna o desparasitación
   - "unknown" si la fila no tiene información suficiente para clasificarla con confianza razonable — NUNCA fuerces un tipo si no estás seguro.

2. Identificador del paciente y tutor — copia el texto TAL COMO aparece en la fila, nunca inventes ni completes: patient_name, tutor_name, tutor_phone (si hay alguna columna de teléfono/celular/contacto en la fila).

3. Campos según el tipo (usa null si el dato no está en la fila — NUNCA inventes valores para completar campos vacíos):
   - vaccine: vaccine_name (obligatorio si event_type=vaccine, si no hay nombre claro de vacuna usa "unknown" en vez de inventar un nombre), application_date, next_dose_date, notes
   - deworming: deworming_type ("Interna"/"Externa"/"Interna y externa", tal como lo indique la fila — si no está claro, deja null), deworming_brand, weight (numérico, sin unidad), application_date, next_dose_date, notes
   - consultation: reason, diagnosis, anamnesis, procedure_notes, event_date, weight — IMPORTANTE: no se piden signos vitales estructurados (fc, fr, temperatura, etc.) — si la fila trae algo así, ponlo en procedure_notes como texto, nunca inventes una estructura que no te pedí.

4. Fechas: normaliza SIEMPRE a formato YYYY-MM-DD. Acepta dd/mm/yyyy, dd-mm-yyyy, nombres de mes en español, fechas ya en YYYY-MM-DD. Si la fecha es ambigua, está incompleta, o no se puede determinar con confianza razonable, devuelve null — nunca adivines ni completes una fecha.

5. Si una fila trae texto relevante que no encaja limpio en ningún campo de arriba, ponlo en "notes" (o "procedure_notes" si es event_type=consultation) en vez de descartarlo — el objetivo es no perder información real del cliente.

6. Si una fila está completamente vacía o es claramente un encabezado repetido/fila de totales, no la incluyas en la respuesta.

Responde SOLO con un objeto JSON válido, sin texto antes ni después:
{"events": [{"row_index": 0, "event_type": "vaccine", "patient_name": "...", "tutor_name": "...", "tutor_phone": "...", "vaccine_name": "...", "deworming_type": null, "deworming_brand": null, "weight": null, "application_date": "2023-05-14", "next_dose_date": "2024-05-14", "reason": null, "diagnosis": null, "anamnesis": null, "procedure_notes": null, "event_date": null, "notes": null}]}`;

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

    const { sheet_name, rows } = await req.json();
    if (!Array.isArray(rows) || rows.length === 0) return json({ error: "Falta rows (array no vacío)" }, 400);
    if (rows.length > 50) return json({ error: "Máximo 50 filas por lote" }, 400);

    if (!OPENAI_API_KEY) return json({ error: "OPENAI_API_KEY no configurada" }, 500);

    const userPrompt = `Hoja de origen: ${sheet_name || "sin nombre"}\n\nFilas (índice real dentro del archivo completo, no re-numeres):\n${JSON.stringify(
      rows.map((r: Record<string, unknown>, i: number) => ({ row_index: r.__row_index ?? i, ...r })),
      null,
      2,
    )}`;

    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
        max_tokens: 8000,
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      return json({ error: `Error OpenAI: ${errText}` }, 500);
    }

    const aiData = await aiRes.json();
    const rawText = aiData.choices?.[0]?.message?.content || "";

    let parsed: { events: unknown[] };
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return json({ error: "OpenAI no devolvió JSON válido", raw: rawText }, 500);
    }

    return json({ events: parsed.events || [] });
  } catch (e) {
    console.error("[hq-analyze-medical-history] error:", e);
    return json({ error: "Internal server error" }, 500);
  }
});
