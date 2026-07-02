-- ============================================================
-- Reapertura de cajas antiguas — solo owners
-- ============================================================

ALTER TABLE public.cash_registers
    ADD COLUMN IF NOT EXISTS reopened_by UUID REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.reopen_cash_register(
    p_clinic_id UUID,
    p_date      DATE
)
RETURNS public.cash_registers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result public.cash_registers;
BEGIN
    -- Solo el owner de la clínica puede reabrir una caja cerrada
    IF NOT EXISTS (
        SELECT 1 FROM public.clinic_members
        WHERE clinic_id = p_clinic_id
          AND user_id = auth.uid()
          AND status = 'active'
          AND role = 'owner'
    ) THEN
        RAISE EXCEPTION 'Solo el owner de la clínica puede reabrir una caja';
    END IF;

    UPDATE public.cash_registers
    SET status = 'open',
        reopened_by = auth.uid(),
        reopened_at = NOW()
    WHERE clinic_id = p_clinic_id
      AND date = p_date
      AND status = 'closed'
    RETURNING * INTO v_result;

    IF v_result IS NULL THEN
        RAISE EXCEPTION 'No existe una caja cerrada para esa fecha';
    END IF;

    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reopen_cash_register(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_cash_register(UUID, DATE) TO service_role;
