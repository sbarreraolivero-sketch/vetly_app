-- Aplicada vía MCP el 2026-08-17.
-- Las policies PERMISSIVE se combinan con OR: esta anulaba a las dos correctas
-- que ya existen al lado ("Allow admins to manage blocked dates" con
-- is_clinic_admin(clinic_id) y "Allow members to view blocked dates" con
-- clinic_members), dejando que cualquier usuario autenticado de cualquier
-- clínica leyera, modificara o borrara las fechas bloqueadas de otra.
DROP POLICY IF EXISTS manage_clinic_blocked_dates ON public.clinic_blocked_dates;
