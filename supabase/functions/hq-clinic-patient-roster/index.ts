/**
 * hq-clinic-patient-roster — lee pacientes+tutores de UNA clínica puntual
 * para que el importador de historial médico (HQ) pueda hacer el matching
 * de cada evento extraído contra un paciente real. Sin IA, sin costo.
 *
 * Se llama UNA sola vez al abrir el modal (no por lote) — a diferencia de
 * hq-analyze-medical-history, que se llama una vez por lote de filas.
 *
 * Mismo patrón de auth que hq-discover-prospects/hq-generate-prospect-email:
 * JWT del operador → auth.getUser() → check platform_admins. La lectura de
 * datos del cliente usa el service role client (nunca la sesión del
 * operador), porque un admin de HQ no es necesariamente clinic_members de
 * la clínica del cliente — la RLS de vaccines/deworming (patrón viejo) no
 * lo contemplaría.
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

    const { clinic_id } = await req.json();
    if (!clinic_id) return json({ error: "Falta clinic_id" }, 400);

    const { data: patients, error: patientsErr } = await supabase
      .from("patients")
      .select("id, name, species, tutor_id, tutors(id, name, phone_number)")
      .eq("clinic_id", clinic_id)
      .order("name");

    if (patientsErr) return json({ error: patientsErr.message }, 500);

    return json({
      patients: (patients || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        species: p.species,
        tutor_id: p.tutor_id,
        tutor_name: p.tutors?.name ?? null,
        tutor_phone: p.tutors?.phone_number ?? null,
      })),
    });
  } catch (e) {
    console.error("[hq-clinic-patient-roster] error:", e);
    return json({ error: "Internal server error" }, 500);
  }
});
