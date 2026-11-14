-- Las consultas del panel "últimos mensajes de la clínica" (Dashboard, Mensajes)
-- ordenan por created_at filtrando por clinic_id. Sin este índice Postgres leía
-- ~44.000 filas y las ordenaba en cada carga (3,1 s, con statement timeouts).
-- Aplicado en producción con CREATE INDEX CONCURRENTLY (no admite transacción).
CREATE INDEX IF NOT EXISTS idx_messages_clinic_created
    ON public.messages (clinic_id, created_at DESC);
