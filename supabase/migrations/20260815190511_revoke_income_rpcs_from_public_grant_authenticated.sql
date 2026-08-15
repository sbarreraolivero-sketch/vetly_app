-- ============================================================================
-- Corrección del endurecimiento anterior: `REVOKE ... FROM anon` no basta.
--
-- PostgreSQL concede EXECUTE a PUBLIC por defecto al crear una función, y el rol
-- `anon` hereda de PUBLIC. Revocar solo de `anon` deja vivo el permiso heredado:
-- has_function_privilege('anon', ...) seguía devolviendo true después del REVOKE.
--
-- El patrón correcto es el que ya usaba sync_income_loyalty desde su creación:
--   REVOKE FROM PUBLIC, anon  +  GRANT explícito a authenticated y service_role.
--
-- Verificado después de aplicar:
--   authenticated = true (Finanzas sigue operando), anon = false, service_role = true.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.create_clinic_income(
    uuid, text, numeric, text, date, uuid, jsonb, numeric, text, text, text, numeric, numeric
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_clinic_income(
    uuid, text, numeric, text, date, uuid, jsonb, numeric, text, text, text, numeric, numeric
) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.update_clinic_income(
    uuid, text, numeric, text, date, uuid, jsonb, numeric, text, text, text, numeric, numeric
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_clinic_income(
    uuid, text, numeric, text, date, uuid, jsonb, numeric, text, text, text, numeric, numeric
) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_clinic_incomes_secure(uuid, timestamptz, timestamptz)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_clinic_incomes_secure(uuid, timestamptz, timestamptz)
    TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_finance_discount_metrics(uuid, timestamptz, timestamptz)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_finance_discount_metrics(uuid, timestamptz, timestamptz)
    TO authenticated, service_role;

-- get_pet_owner_portal y get_referral_link_data NO se tocan: son públicas por
-- diseño (el carnet digital se abre sin sesión, identificado por el código).
