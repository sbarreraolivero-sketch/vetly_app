// Chequeo de acceso compartido para las edge functions del importador de
// historial médico: acepta TANTO a un operador de HQ (platform_admins,
// puede operar la herramienta a nombre de cualquier clínica) COMO a un
// miembro activo de la clínica puntual (clinic_members) — desde que la
// feature se abrió también al portal del cliente (self-serve), no solo a
// HQ. Un solo helper compartido para no duplicar esta lógica 3 veces y
// arriesgar que diverja entre archivos.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type ClinicAccessResult =
  | { ok: true; userId: string }
  | { ok: false; status: number; error: string };

export async function requireClinicAccess(
  supabase: SupabaseClient,
  authHeader: string | null,
  clinicId: string,
): Promise<ClinicAccessResult> {
  if (!authHeader) return { ok: false, status: 401, error: "No autorizado" };

  const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  if (!user) return { ok: false, status: 401, error: "No autorizado" };

  const { data: admin } = await supabase.from("platform_admins").select("id").eq("id", user.id).maybeSingle();
  if (admin) return { ok: true, userId: user.id };

  const { data: member } = await supabase
    .from("clinic_members")
    .select("id")
    .eq("user_id", user.id)
    .eq("clinic_id", clinicId)
    .eq("status", "active")
    .maybeSingle();
  if (member) return { ok: true, userId: user.id };

  return { ok: false, status: 403, error: "No tienes acceso a esta clínica" };
}
