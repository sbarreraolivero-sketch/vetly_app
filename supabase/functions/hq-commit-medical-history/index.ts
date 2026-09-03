/**
 * hq-commit-medical-history — paso final del importador de datos de otro
 * sistema. En una sola llamada:
 *   1. CREA los dueños (tutors) y mascotas (patients) que no existen
 *      (`new_patients`), deduplicando tutores por teléfono / nombre.
 *   2. INSERTA en bloque los eventos médicos ya revisados/editados por un
 *      humano en vaccines / deworming / medical_history, resolviendo el
 *      `patient_id` real de los eventos que apuntaban a una mascota recién
 *      creada (`temp_key`).
 *
 * Es el único paso de esta feature con efecto real en la base — nunca se
 * llama sin que un operador haya confirmado la tabla de revisión primero.
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
 * - Dedup de tutores por phone_number (solo dígitos) y, si no hay teléfono,
 *   por nombre normalizado dentro de la clínica. Nunca crea un tutor
 *   duplicado si ya existe uno con el mismo teléfono.
 *
 * Acceso: operador de HQ (platform_admins) O miembro activo de la propia
 * clínica (clinic_members) — el modal se usa tanto desde HQ como desde el
 * portal del cliente (self-serve).
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireClinicAccess } from "../_shared/clinicOrAdminAuth.ts";

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
  patient_id?: string | null;
  temp_key?: string | null;
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

interface NewPatient {
  temp_key: string;
  patient_name?: string | null;
  species?: string | null;
  breed?: string | null;
  sex?: string | null;
  dob?: string | null;
  microchip?: string | null;
  tutor_name?: string | null;
  tutor_phone?: string | null;
  tutor_email?: string | null;
  tutor_address?: string | null;
}

const CHUNK = 200;
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const normStr = (s: unknown): string =>
  (s ?? "").toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const digitsOnly = (s: unknown): string => (s ?? "").toString().replace(/\D/g, "");
const cleanStr = (s: unknown): string | null => {
  const v = (s ?? "").toString().trim();
  return v === "" ? null : v;
};
const sanitizeSex = (s: unknown): "M" | "F" | null => {
  const v = normStr(s);
  if (["m", "macho", "male"].includes(v)) return "M";
  if (["f", "h", "hembra", "female"].includes(v)) return "F";
  return null;
};
const sanitizeDate = (s: unknown): string | null => {
  const v = (s ?? "").toString().trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    const body = await req.json();
    const clinic_id: string | undefined = body?.clinic_id;
    const events: CommitEvent[] = Array.isArray(body?.events) ? body.events : [];
    const newPatients: NewPatient[] = Array.isArray(body?.new_patients) ? body.new_patients : [];

    if (!clinic_id) return json({ error: "Falta clinic_id" }, 400);
    if (events.length === 0 && newPatients.length === 0) {
      return json({ error: "No hay nada que importar (events y new_patients vacíos)" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const access = await requireClinicAccess(supabase, authHeader, clinic_id);
    if (!access.ok) return json({ error: access.error }, access.status);

    // ── 1. Crear dueños + mascotas nuevos ──────────────────────────────
    const tempKeyToPatientId = new Map<string, string>();
    let tutorsCreated = 0;
    let patientsCreated = 0;

    if (newPatients.length > 0) {
      // Roster de tutores existentes de la clínica (id, teléfono, nombre)
      // para deduplicar. Una sola query — mismo criterio que
      // hq-clinic-patient-roster.
      const { data: existingTutors, error: tutErr } = await supabase
        .from("tutors")
        .select("id, name, phone_number")
        .eq("clinic_id", clinic_id);
      if (tutErr) return json({ error: `Error leyendo tutores: ${tutErr.message}` }, 500);

      const phoneToTutorId = new Map<string, string>();
      const nameToTutorIds = new Map<string, string[]>();
      const addName = (nm: string, id: string) => {
        if (!nm) return;
        const arr = nameToTutorIds.get(nm) || [];
        arr.push(id);
        nameToTutorIds.set(nm, arr);
      };
      for (const t of existingTutors || []) {
        const ph = digitsOnly((t as any).phone_number);
        if (ph.length >= 7) phoneToTutorId.set(ph, (t as any).id);
        addName(normStr((t as any).name), (t as any).id);
      }

      // tutors.phone_number es NOT NULL → un dueño SIN teléfono no se crea:
      // la mascota queda con tutor_id null (mismo criterio que el importador
      // de CSV anterior). Un dueño con teléfono sí se crea (deduplicado).
      type PendingTutor = { name: string | null; email: string | null; address: string | null };
      const pendingByPhone = new Map<string, PendingTutor>();

      const tutorRefForPatient = newPatients.map((np) => {
        const phone = digitsOnly(np.tutor_phone);
        if (phone.length >= 7) {
          if (!phoneToTutorId.has(phone) && !pendingByPhone.has(phone)) {
            pendingByPhone.set(phone, {
              name: cleanStr(np.tutor_name),
              email: cleanStr(np.tutor_email),
              address: cleanStr(np.tutor_address),
            });
          }
          return { kind: "phone" as const, phone };
        }
        return { kind: "name" as const, name: normStr(np.tutor_name) };
      });

      // Insertar los tutores nuevos (con teléfono).
      const newPhoneTutors = [...pendingByPhone.entries()].map(([phone, d]) => ({
        clinic_id,
        phone_number: phone,
        name: d.name,
        email: d.email,
        address: d.address,
      }));
      for (const batch of chunk(newPhoneTutors, 150)) {
        const { data: ins, error } = await supabase
          .from("tutors")
          .insert(batch)
          .select("id, phone_number, name");
        if (error) return json({ error: `Error creando dueños: ${error.message}` }, 500);
        for (const t of ins || []) {
          phoneToTutorId.set(digitsOnly((t as any).phone_number), (t as any).id);
          addName(normStr((t as any).name), (t as any).id); // permite vincular un pet sin teléfono al dueño recién creado
          tutorsCreated++;
        }
      }

      const resolveTutorId = (ref: { kind: "phone"; phone: string } | { kind: "name"; name: string }): string | null => {
        if (ref.kind === "phone") return phoneToTutorId.get(ref.phone) ?? null;
        // Sin teléfono: solo se vincula si hay UN único dueño con ese nombre.
        const ids = ref.name ? nameToTutorIds.get(ref.name) : undefined;
        return ids && ids.length === 1 ? ids[0] : null;
      };

      // Construir las filas de patients, con tutor_id resuelto.
      const patientRows = newPatients.map((np, i) => ({
        _temp_key: np.temp_key,
        row: {
          clinic_id,
          tutor_id: resolveTutorId(tutorRefForPatient[i]),
          name: cleanStr(np.patient_name) ?? "Sin nombre",
          species: cleanStr(np.species),
          breed: cleanStr(np.breed),
          sex: sanitizeSex(np.sex),
          dob: sanitizeDate(np.dob),
          microchip_id: cleanStr(np.microchip),
        },
      }));

      for (const batch of chunk(patientRows, CHUNK)) {
        const { data: ins, error } = await supabase
          .from("patients")
          .insert(batch.map((b) => b.row))
          .select("id");
        if (error) return json({ error: `Error creando mascotas: ${error.message}` }, 500);
        // Postgres preserva el orden de un INSERT ... RETURNING con lista de
        // VALUES — pero si por lo que sea no calza el largo, abortamos antes
        // de mapear temp_key → patient_id equivocados.
        if (!ins || ins.length !== batch.length) {
          return json({ error: "El insert de mascotas devolvió un número de filas inesperado — abortado para no mezclar historiales" }, 500);
        }
        ins.forEach((p: any, idx: number) => {
          tempKeyToPatientId.set(batch[idx]._temp_key, p.id);
          patientsCreated++;
        });
      }
    }

    // ── 2. Insertar eventos médicos ───────────────────────────────────
    const vaccineRows: Record<string, unknown>[] = [];
    const dewormingRows: Record<string, unknown>[] = [];
    const medicalHistoryRows: Record<string, unknown>[] = [];
    const skipped: { index: number; reason: string }[] = [];

    events.forEach((ev, idx) => {
      const patientId = ev.patient_id || (ev.temp_key ? tempKeyToPatientId.get(ev.temp_key) : null);
      if (!patientId) {
        skipped.push({ index: idx, reason: "Sin patient_id (evento sin match ni mascota creada)" });
        return;
      }
      if (ev.event_type === "vaccine") {
        if (!ev.vaccine_name || !ev.application_date) {
          skipped.push({ index: idx, reason: "Vacuna sin nombre o sin fecha de aplicación (campos obligatorios)" });
          return;
        }
        vaccineRows.push({
          patient_id: patientId,
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
          patient_id: patientId,
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
          patient_id: patientId,
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
      tutors_created: tutorsCreated,
      patients_created: patientsCreated,
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
