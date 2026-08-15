-- ============================================================================
-- Endurecimiento post-auditoría de la sesión 73 — segunda capa.
--
-- El bypass de anon ya se corrigió con auth.role() (fix_income_rpc_auth_bypass_for_anon).
-- Esto quita además el permiso de ejecución: hasta ahora el único freno era el
-- chequeo interno, y si alguien lo altera al editar la función la superficie se
-- reabre sola.
--
-- El frontend llama con sesión autenticada (financeService.addIncome/updateIncome),
-- nunca con anon — verificado por grep: son los únicos llamadores.
--
-- NOTA: este REVOKE solo sobre `anon` resultó INSUFICIENTE (anon hereda de PUBLIC).
-- La corrección completa está en 20260815190511_revoke_income_rpcs_from_public_grant_authenticated.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.create_clinic_income(
    uuid, text, numeric, text, date, uuid, jsonb, numeric, text, text, text, numeric, numeric
) FROM anon;

REVOKE EXECUTE ON FUNCTION public.update_clinic_income(
    uuid, text, numeric, text, date, uuid, jsonb, numeric, text, text, text, numeric, numeric
) FROM anon;

REVOKE EXECUTE ON FUNCTION public.get_clinic_incomes_secure(
    uuid, timestamptz, timestamptz
) FROM anon;

-- Las tablas de respaldo del reset guardan nombres de tutores y saldos. Tienen
-- RLS activa sin políticas (deniegan todo por defecto; verificado: anon devuelve
-- 0 filas). Se declara service_role explícitamente para que el estado sea
-- intencional y no un descuido silencioso.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'loyalty_transactions_backup' AND policyname = 'service_role_all') THEN
        CREATE POLICY service_role_all ON public.loyalty_transactions_backup
            FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tutors_loyalty_backup' AND policyname = 'service_role_all') THEN
        CREATE POLICY service_role_all ON public.tutors_loyalty_backup
            FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;
