/**
 * hq-commit-medical-history — inserta en bloque los eventos médicos ya
 * revisados/editados por un humano (panel HQ) en vaccines/deworming/
 * medical_history. Es el único paso de esta feature con efecto real en
 * la base — nunca se llama sin que un operador haya confirmado la tabla
 * de revisión primero.
 *
 * Reglas duras de este archivo (ver plan de la feature):
 * - NUNCA escribe en `reminders` — una fecha histórica pasada dispararía
 *   un WhatsApp real en el próximo cron-process-reminders.
 * - `veterinarian_id` siempre null — no hay FK que lo exija, y no hay un
 *   veterinario real de Vetly asociado a un registro histórico migrado.
 * - `medical_history` no tiene columna clinic_id (su RLS deriva vía
 *   patient_id → patients.clinic_id) — el insert no la incluye.
 * - Valida application_date/name (vaccines) y application_date/type
 *   (deworming) NOT NULL antes de insertar — si falta alguno, esa fila se
 *   reporta como error en vez de abortar todo el lote.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

interface CommitEvent {
  event_type: "vaccine" | "deworming" | "consultation";
  patient_id: string;
  vaccine_name?: string | null;
  deworming_type?: string | null;
  deworming_brand?: string | null;
  weight?: number | null;
  application_date?: string | null;
  next_dose_date?: string | null;
  reason?: string | null;
  diagnosis?: string | null;
  anamnesis?: string | null;
  procedure_notes?: string | null;
  event_date?: string | null;
  notes?: string | null;
}

const CHUNK = 200;
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

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

    const { clinic_id, events } = await req.json();
    if (!clinic_id) return json({ error: "Falta clinic_id" }, 400);
    if (!Array.isArray(events) || events.length === 0) return json({ error: "Falta events (array no vacío)" }, 400);

    const vaccineRows: Record<string, unknown>[] = [];
    const dewormingRows: Record<string, unknown>[] = [];
    const medicalHistoryRows: Record<string, unknown>[] = [];
    const skipped: { index: number; reason: string }[] = [];

    (events as CommitEvent[]).forEach((ev, idx) => {
      if (!ev.patient_id) {
        skipped.push({ index: idx, reason: "Sin patient_id (evento sin match de paciente)" });
        return;
      }
      if (ev.event_type === "vaccine") {
        if (!ev.vaccine_name || !ev.application_date) {
          skipped.push({ index: idx, reason: "Vacuna sin nombre o sin fecha de aplicación (campos obligatorios)" });
          return;
        }
        vaccineRows.push({
          patient_id: ev.patient_id,
          clinic_id,
          name: ev.vaccine_name,
          application_date: ev.application_date,
          next_dose_date: ev.next_dose_date || null,
          veterinarian_id: null,
          notes: ev.notes || null,
        });
      } else if (ev.event_type === "deworming") {
        if (!ev.deworming_type || !ev.application_date) {
          skipped.push({ index: idx, reason: "Desparasitación sin tipo o sin fecha de aplicación (campos obligatorios)" });
          return;
        }
        dewormingRows.push({
          patient_id: ev.patient_id,
          clinic_id,
          type: ev.deworming_type,
          brand: ev.deworming_brand || null,
          weight: ev.weight ?? null,
          application_date: ev.application_date,
          next_dose_date: ev.next_dose_date || null,
          veterinarian_id: null,
          notes: ev.notes || null,
        });
      } else if (ev.event_type === "consultation") {
        medicalHistoryRows.push({
          patient_id: ev.patient_id,
          event_date: ev.event_date || ev.application_date || null,
          event_type: "Consulta migrada",
          diagnosis: ev.diagnosis || null,
          procedure_notes: ev.procedure_notes || null,
          reason: ev.reason || null,
          anamnesis: ev.anamnesis || null,
          weight: ev.weight ?? null,
          veterinarian_id: null,
        });
      } else {
        skipped.push({ index: idx, reason: `event_type desconocido: ${ev.event_type}` });
      }
    });

    let vaccinesInserted = 0;
    let dewormingInserted = 0;
    let medicalHistoryInserted = 0;
    const errors: string[] = [];

    for (const batch of chunk(vaccineRows, CHUNK)) {
      const { error } = await supabase.from("vaccines").insert(batch);
      if (error) errors.push(`vaccines: ${error.message}`);
      else vaccinesInserted += batch.length;
    }
    for (const batch of chunk(dewormingRows, CHUNK)) {
      const { error } = await supabase.from("deworming").insert(batch);
      if (error) errors.push(`deworming: ${error.message}`);
      else dewormingInserted += batch.length;
    }
    for (const batch of chunk(medicalHistoryRows, CHUNK)) {
      const { error } = await supabase.from("medical_history").insert(batch);
      if (error) errors.push(`medical_history: ${error.message}`);
      else medicalHistoryInserted += batch.length;
    }

    return json({
      ok: true,
      vaccines_inserted: vaccinesInserted,
      deworming_inserted: dewormingInserted,
      medical_history_inserted: medicalHistoryInserted,
      skipped,
      errors,
    });
  } catch (e) {
    console.error("[hq-commit-medical-history] error:", e);
    return json({ error: "Internal server error" }, 500);
  }
});
