-- La limpieza de seguridad de la sesión 77 quitó EXECUTE a anon de esta RPC, pero
-- /register?mode=join la llama sin sesión para verificar la invitación pendiente.
REVOKE ALL ON FUNCTION public.check_pending_invite_details(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_pending_invite_details(text, uuid) TO anon, authenticated, service_role;
