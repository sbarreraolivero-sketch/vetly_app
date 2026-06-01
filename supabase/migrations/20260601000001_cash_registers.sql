-- ============================================================
-- CAJAS REGISTRADORAS DIARIAS
-- Snapshot de cierre de caja por día. Los datos reales siguen
-- en appointments e incomes; este registro es solo auditoría.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cash_registers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id           UUID NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
    date                DATE NOT NULL,
    status              TEXT NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open', 'closed')),
    -- Snapshot calculado al cerrar
    total_cobrado       NUMERIC NOT NULL DEFAULT 0,
    total_pendiente     NUMERIC NOT NULL DEFAULT 0,
    total_efectivo      NUMERIC NOT NULL DEFAULT 0,
    total_transferencia NUMERIC NOT NULL DEFAULT 0,
    total_tarjeta       NUMERIC NOT NULL DEFAULT 0,
    total_debito        NUMERIC NOT NULL DEFAULT 0,
    income_count        INTEGER NOT NULL DEFAULT 0,
    notes               TEXT,
    closed_by           UUID REFERENCES auth.users(id),
    closed_at           TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(clinic_id, date)
);

-- RLS: acceso via clinic_members (patrón estándar del proyecto)
ALTER TABLE public.cash_registers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cash_registers_clinic_members"
    ON public.cash_registers
    FOR ALL
    USING (
        clinic_id IN (
            SELECT clinic_id FROM public.clinic_members
            WHERE user_id = auth.uid() AND status = 'active'
        )
    )
    WITH CHECK (
        clinic_id IN (
            SELECT clinic_id FROM public.clinic_members
            WHERE user_id = auth.uid() AND status = 'active'
        )
    );

CREATE POLICY "cash_registers_service_role"
    ON public.cash_registers
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================
-- RPC: close_cash_register
-- Calcula totales desde appointments + incomes para una fecha
-- y hace UPSERT en cash_registers.
-- ============================================================

CREATE OR REPLACE FUNCTION public.close_cash_register(
    p_clinic_id UUID,
    p_date      DATE,
    p_notes     TEXT DEFAULT NULL,
    p_closed_by UUID DEFAULT NULL
)
RETURNS public.cash_registers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total_cobrado       NUMERIC := 0;
    v_total_pendiente     NUMERIC := 0;
    v_total_efectivo      NUMERIC := 0;
    v_total_transferencia NUMERIC := 0;
    v_total_tarjeta       NUMERIC := 0;
    v_total_debito        NUMERIC := 0;
    v_income_count        INTEGER := 0;
    v_result              public.cash_registers;
BEGIN
    -- Verificar acceso del usuario
    IF p_closed_by IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.clinic_members
            WHERE clinic_id = p_clinic_id
              AND user_id = p_closed_by
              AND status = 'active'
        ) THEN
            RAISE EXCEPTION 'Acceso denegado';
        END IF;
    END IF;

    -- ---- Cobrado desde appointments (paid o partial) ----
    SELECT
        COALESCE(SUM(CASE WHEN payment_status IN ('paid','partial') THEN COALESCE(price,0) ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN payment_status = 'pending'           THEN COALESCE(price,0) ELSE 0 END), 0),
        -- desglose por método (solo cobrados)
        COALESCE(SUM(CASE WHEN payment_status IN ('paid','partial') AND LOWER(COALESCE(payment_method,'')) IN ('efectivo','cash') THEN COALESCE(price,0) ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN payment_status IN ('paid','partial') AND LOWER(COALESCE(payment_method,'')) IN ('transferencia','transfer') THEN COALESCE(price,0) ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN payment_status IN ('paid','partial') AND LOWER(COALESCE(payment_method,'')) IN ('tarjeta','tarjeta credito','tarjeta crédito','card') THEN COALESCE(price,0) ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN payment_status IN ('paid','partial') AND LOWER(COALESCE(payment_method,'')) IN ('debito','débito','tarjeta debito','tarjeta débito','debit') THEN COALESCE(price,0) ELSE 0 END), 0),
        COUNT(CASE WHEN payment_status IN ('paid','partial') THEN 1 END)
    INTO
        v_total_cobrado,
        v_total_pendiente,
        v_total_efectivo,
        v_total_transferencia,
        v_total_tarjeta,
        v_total_debito,
        v_income_count
    FROM public.appointments
    WHERE clinic_id = p_clinic_id
      AND appointment_date::DATE = p_date
      AND status <> 'cancelled'
      AND COALESCE(price, 0) > 0;

    -- ---- Sumar incomes manuales del día ----
    SELECT
        v_total_cobrado       + COALESCE(SUM(COALESCE(amount,0) - COALESCE(discount,0)), 0),
        v_total_efectivo      + COALESCE(SUM(CASE WHEN LOWER(COALESCE(payment_method,'')) IN ('efectivo','cash')             THEN COALESCE(amount,0) - COALESCE(discount,0) ELSE 0 END), 0),
        v_total_transferencia + COALESCE(SUM(CASE WHEN LOWER(COALESCE(payment_method,'')) IN ('transferencia','transfer')    THEN COALESCE(amount,0) - COALESCE(discount,0) ELSE 0 END), 0),
        v_total_tarjeta       + COALESCE(SUM(CASE WHEN LOWER(COALESCE(payment_method,'')) IN ('tarjeta','tarjeta credito','tarjeta crédito','card') THEN COALESCE(amount,0) - COALESCE(discount,0) ELSE 0 END), 0),
        v_total_debito        + COALESCE(SUM(CASE WHEN LOWER(COALESCE(payment_method,'')) IN ('debito','débito','tarjeta debito','tarjeta débito','debit') THEN COALESCE(amount,0) - COALESCE(discount,0) ELSE 0 END), 0),
        v_income_count        + COUNT(*)
    INTO
        v_total_cobrado,
        v_total_efectivo,
        v_total_transferencia,
        v_total_tarjeta,
        v_total_debito,
        v_income_count
    FROM public.incomes
    WHERE clinic_id = p_clinic_id
      AND date = p_date;

    -- ---- UPSERT en cash_registers ----
    INSERT INTO public.cash_registers (
        clinic_id, date, status,
        total_cobrado, total_pendiente,
        total_efectivo, total_transferencia, total_tarjeta, total_debito,
        income_count, notes, closed_by, closed_at
    )
    VALUES (
        p_clinic_id, p_date, 'closed',
        v_total_cobrado, v_total_pendiente,
        v_total_efectivo, v_total_transferencia, v_total_tarjeta, v_total_debito,
        v_income_count, p_notes, p_closed_by, NOW()
    )
    ON CONFLICT (clinic_id, date) DO UPDATE SET
        status              = 'closed',
        total_cobrado       = EXCLUDED.total_cobrado,
        total_pendiente     = EXCLUDED.total_pendiente,
        total_efectivo      = EXCLUDED.total_efectivo,
        total_transferencia = EXCLUDED.total_transferencia,
        total_tarjeta       = EXCLUDED.total_tarjeta,
        total_debito        = EXCLUDED.total_debito,
        income_count        = EXCLUDED.income_count,
        notes               = EXCLUDED.notes,
        closed_by           = EXCLUDED.closed_by,
        closed_at           = EXCLUDED.closed_at
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_cash_register(UUID, DATE, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_cash_register(UUID, DATE, TEXT, UUID) TO service_role;
