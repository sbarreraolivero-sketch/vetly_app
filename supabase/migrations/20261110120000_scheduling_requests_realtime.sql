-- El panel de solicitudes de agenda se suscribe a cambios en vivo, pero la tabla
-- no estaba en la publicación de Realtime: nada se refrescaba sin recargar.
alter publication supabase_realtime add table public.scheduling_requests;
