-- Bug preexistente encontrado al construir el formulario público de reservas
-- (2026-08-26): clinic_members tiene políticas RLS ("Users can view own
-- memberships", "Admins can manage/view all members") que llaman
-- is_clinic_admin()/is_admin_of_clinic() sin que el rol anon tuviera
-- permiso de EJECUTAR esas funciones. Como clinic_settings hace
-- subconsultas directas a clinic_members en sus propias políticas, CUALQUIER
-- intento de leer clinic_settings como anon (incluso indirecto, vía una
-- policy de otra tabla) explotaba con "permission denied for function
-- is_clinic_admin" -- no era un problema de la política nueva de reservas,
-- era que nada había consultado estas tablas como anon antes.
--
-- Ambas funciones solo comparan auth.uid() contra clinic_members/
-- platform_admins -- para anon, auth.uid() es siempre NULL, así que
-- otorgar EXECUTE es seguro: siempre van a devolver false para anon, igual
-- que ya hacen hoy para cualquier usuario autenticado sin ese rol.
GRANT EXECUTE ON FUNCTION public.is_clinic_admin(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.is_admin_of_clinic(uuid) TO anon;
