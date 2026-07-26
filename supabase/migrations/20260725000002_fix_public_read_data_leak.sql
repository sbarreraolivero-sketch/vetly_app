-- ============================================================================
-- Sesión 58 — FUGA DE DATOS PERSONALES vía policies legacy con USING (true)
--
-- Verificado empíricamente con la anon key pública (la que va embebida en el
-- bundle de vetly.pro): SIN ninguna sesión se podían leer
--   · debug_logs     101.245 filas (teléfonos y contenido de conversaciones)
--   · appointments      285 filas (tutor, mascota, teléfono, servicio médico)
--   · clinic_members      4 filas (roles y clinic_ids)
--
-- Causa: las policies RLS PERMISSIVE se combinan con OR. Una sola policy con
-- USING (true) para el rol `public` (que incluye anon) anula por completo todas
-- las policies correctas que existen al lado.
--
-- Culpables, todas legacy de desarrollo:
--   · appointments   → "Public read for appointments"   SELECT / public / true
--   · clinic_members → "Public read for clinic members" SELECT / public / true
--   · debug_logs     → "Allow all debug_logs"           ALL    / public / true+true
--
-- Verificado ANTES de aplicar (para no romper accesos legítimos):
--   · debug_logs no se lee desde src/ — solo lo escriben edge functions con
--     service_role, que no pasa por RLS.
--   · appointments conserva "Clinic members can see their appointments",
--     "Enable read for clinic members" y el acceso de service_role.
--   · clinic_members conserva "Members can view self" y "Users can view own
--     memberships". is_clinic_admin/is_admin_of_clinic son SECURITY DEFINER,
--     así que no se produce recursión de RLS al quitar el public read.
--   · Las páginas públicas (PetOwnerPortal, ReferralRedirect) no dependen de
--     estas policies: usan los RPC SECURITY DEFINER get_pet_owner_portal y
--     get_referral_link_data.
--
-- Verificado DESPUÉS de aplicar: anon obtiene 0 filas en las tres tablas y 401
-- al intentar escribir en debug_logs; un usuario autenticado de AnimalGrace
-- sigue viendo sus 284 citas (156 Linares + 128 Santiago) y deja de ver la
-- única cita de Vetly HQ, que es el comportamiento correcto.
-- ============================================================================

DROP POLICY IF EXISTS "Public read for appointments"   ON public.appointments;
DROP POLICY IF EXISTS "Public read for clinic members" ON public.clinic_members;
DROP POLICY IF EXISTS "Allow all debug_logs"           ON public.debug_logs;

CREATE POLICY "service_role_all_debug_logs" ON public.debug_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
