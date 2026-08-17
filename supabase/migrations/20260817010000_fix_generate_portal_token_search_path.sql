-- generate_portal_token() llamaba a gen_random_bytes() sin calificar el
-- esquema. pgcrypto vive en el esquema `extensions`, no en `public` — cuando
-- el search_path efectivo del caller no incluye `extensions` (comportamiento
-- reciente de la plataforma Supabase), la llamada falla con
-- "function gen_random_bytes(integer) does not exist".
--
-- Esto rompía CUALQUIER insert nuevo en `tutors` (trigger BEFORE INSERT
-- trigger_set_portal_token → set_portal_token() → generate_portal_token()),
-- incluyendo el auto-alta de tutor/paciente al completar una cita
-- (tr_auto_create_contacts_on_complete). Reportado por Claudia como error al
-- actualizar el estado de una cita y al ingresar un tutor nuevo.

CREATE OR REPLACE FUNCTION public.generate_portal_token()
 RETURNS text
 LANGUAGE sql
AS $function$
    SELECT translate(encode(extensions.gen_random_bytes(16), 'base64'), '+/=', '-_');
$function$;
