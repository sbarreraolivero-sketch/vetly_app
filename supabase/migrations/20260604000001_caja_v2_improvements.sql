-- ============================================================
-- CAJAS V2: opening balance, gastos, auto-apertura
-- ============================================================

-- 1. Nuevas columnas en cash_registers
ALTER TABLE public.cash_registers
    ADD COLUMN IF NOT EXISTS opening_balance NUMERIC NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_gastos    NUMERIC NOT NULL DEFAULT 0;

-- 2. Nuevas columnas en expenses
ALTER TABLE public.expenses
    ADD COLUMN IF NOT EXISTS payment_method TEXT,   -- efectivo/transferencia/tarjeta/debito
    ADD COLUMN IF NOT EXISTS receipt_url    TEXT;   -- URL archivo en Supabase Storage

-- 3. Bucket de Storage para boletas de gastos
-- (Se crea manualmente en el dashboard de Supabase si no existe)
-- INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- VALUES ('expense-receipts', 'expense-receipts', false, 10485760,
--         ARRAY['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
-- ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- RPC: update_caja_opening_balance
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_caja_opening_balance(
    p_clinic_id UUID,
    p_date      DATE,
    p_amount    NUMERIC,
    p_user_id   UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Verificar acceso
    IF NOT EXISTS (
        SELECT 1 FROM public.clinic_members
        WHERE clinic_id = p_clinic_id
          AND user_id = p_user_id
          AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'Acceso denegado';
    END IF;

    -- No permitir modificar cajas ya cerradas
    IF EXISTS (
        SELECT 1 FROM public.cash_registers
        WHERE clinic_id = p_clinic_id AND date = p_date AND status = 'closed'
    ) THEN
        RAISE EXCEPTION 'No se puede modificar el saldo de una caja cerrada';
    END IF;

    -- UPSERT: crear si no existe, actualizar si existe
    INSERT INTO public.cash_registers (clinic_id, date, status, opening_balance)
    VALUES (p_clinic_id, p_date, 'open', p_amount)
    ON CONFLICT (clinic_id, date) DO UPDATE
        SET opening_balance = EXCLUDED.opening_balance;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_caja_opening_balance(UUID, DATE, NUMERIC, UUID)
    TO authenticated, service_role;

-- ============================================================
-- RPC: open_cash_register
-- Crea una caja en estado 'open' (idempotente)
-- ============================================================
CREATE OR REPLACE FUNCTION public.open_cash_register(
    p_clinic_id UUID,
    p_date      DATE DEFAULT CURRENT_DATE
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.cash_registers (clinic_id, date, status)
    VALUES (p_clinic_id, p_date, 'open')
    ON CONFLICT (clinic_id, date) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.open_cash_register(UUID, DATE)
    TO authenticated, service_role;

-- ============================================================
-- Función de apertura automática diaria (llamada por pg_cron)
-- ============================================================
CREATE OR REPLACE FUNCTION public.auto_open_daily_cajas()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_today DATE := (NOW() AT TIME ZONE 'America/Santiago')::DATE;
BEGIN
    INSERT INTO public.cash_registers (clinic_id, date, status)
    SELECT id, v_today, 'open'
    FROM public.clinic_settings
    WHERE id != '00000000-0000-0000-0000-000000000000'  -- excluir HQ
    ON CONFLICT (clinic_id, date) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_open_daily_cajas() TO service_role;

-- pg_cron: apertura automática a las 11:00 UTC = 07:00-08:00 Chile
SELECT cron.schedule(
    'auto-open-cajas',
    '0 11 * * *',
    'SELECT public.auto_open_daily_cajas()'
) WHERE NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'auto-open-cajas'
);

-- ============================================================
-- RPC: close_cash_register — ACTUALIZADO con gastos
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
    v_opening_balance     NUMERIC := 0;
    v_total_cobrado       NUMERIC := 0;
    v_total_pendiente     NUMERIC := 0;
    v_total_efectivo      NUMERIC := 0;
    v_total_transferencia NUMERIC := 0;
    v_total_tarjeta       NUMERIC := 0;
    v_total_debito        NUMERIC := 0;
    v_total_gastos        NUMERIC := 0;
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

    -- Recuperar opening_balance existente (si la caja ya fue creada)
    SELECT COALESCE(opening_balance, 0)
    INTO v_opening_balance
    FROM public.cash_registers
    WHERE clinic_id = p_clinic_id AND date = p_date;

    -- ---- Cobrado desde appointments (paid o partial) ----
    SELECT
        COALESCE(SUM(CASE WHEN payment_status IN ('paid','partial') THEN COALESCE(price,0) ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN payment_status = 'pending'           THEN COALESCE(price,0) ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN payment_status IN ('paid','partial') AND LOWER(COALESCE(payment_method,'')) IN ('efectivo','cash')                                   THEN COALESCE(price,0) ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN payment_status IN ('paid','partial') AND LOWER(COALESCE(payment_method,'')) IN ('transferencia','transfer')                          THEN COALESCE(price,0) ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN payment_status IN ('paid','partial') AND LOWER(COALESCE(payment_method,'')) IN ('tarjeta','tarjeta credito','tarjeta crédito','card') THEN COALESCE(price,0) ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN payment_status IN ('paid','partial') AND LOWER(COALESCE(payment_method,'')) IN ('debito','débito','tarjeta debito','tarjeta débito','debit') THEN COALESCE(price,0) ELSE 0 END), 0),
        COUNT(CASE WHEN payment_status IN ('paid','partial') THEN 1 END)
    INTO
        v_total_cobrado, v_total_pendiente,
        v_total_efectivo, v_total_transferencia, v_total_tarjeta, v_total_debito,
        v_income_count
    FROM public.appointments
    WHERE clinic_id = p_clinic_id
      AND appointment_date::DATE = p_date
      AND status <> 'cancelled'
      AND COALESCE(price, 0) > 0;

    -- ---- Sumar incomes manuales del día ----
    SELECT
        v_total_cobrado       + COALESCE(SUM(COALESCE(amount,0) - COALESCE(discount,0)), 0),
        v_total_efectivo      + COALESCE(SUM(CASE WHEN LOWER(COALESCE(payment_method,'')) IN ('efectivo','cash')                                    THEN COALESCE(amount,0) - COALESCE(discount,0) ELSE 0 END), 0),
        v_total_transferencia + COALESCE(SUM(CASE WHEN LOWER(COALESCE(payment_method,'')) IN ('transferencia','transfer')                           THEN COALESCE(amount,0) - COALESCE(discount,0) ELSE 0 END), 0),
        v_total_tarjeta       + COALESCE(SUM(CASE WHEN LOWER(COALESCE(payment_method,'')) IN ('tarjeta','tarjeta credito','tarjeta crédito','card')  THEN COALESCE(amount,0) - COALESCE(discount,0) ELSE 0 END), 0),
        v_total_debito        + COALESCE(SUM(CASE WHEN LOWER(COALESCE(payment_method,'')) IN ('debito','débito','tarjeta debito','tarjeta débito','debit') THEN COALESCE(amount,0) - COALESCE(discount,0) ELSE 0 END), 0),
        v_income_count        + COUNT(*)
    INTO
        v_total_cobrado, v_total_efectivo, v_total_transferencia, v_total_tarjeta, v_total_debito, v_income_count
    FROM public.incomes
    WHERE clinic_id = p_clinic_id AND date = p_date;

    -- ---- Sumar gastos del día ----
    SELECT COALESCE(SUM(COALESCE(amount, 0)), 0)
    INTO v_total_gastos
    FROM public.expenses
    WHERE clinic_id = p_clinic_id AND date = p_date;

    -- ---- UPSERT en cash_registers ----
    INSERT INTO public.cash_registers (
        clinic_id, date, status,
        opening_balance,
        total_cobrado, total_pendiente,
        total_efectivo, total_transferencia, total_tarjeta, total_debito,
        total_gastos,
        income_count, notes, closed_by, closed_at
    )
    VALUES (
        p_clinic_id, p_date, 'closed',
        v_opening_balance,
        v_total_cobrado, v_total_pendiente,
        v_total_efectivo, v_total_transferencia, v_total_tarjeta, v_total_debito,
        v_total_gastos,
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
        total_gastos        = EXCLUDED.total_gastos,
        income_count        = EXCLUDED.income_count,
        notes               = EXCLUDED.notes,
        closed_by           = EXCLUDED.closed_by,
        closed_at           = EXCLUDED.closed_at
        -- opening_balance NO se toca al cerrar: preserva el valor ingresado por el usuario
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_cash_register(UUID, DATE, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_cash_register(UUID, DATE, TEXT, UUID) TO service_role;

-- ============================================================
-- RPC: create_clinic_expense — ACTUALIZADO con payment_method y receipt_url
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_clinic_expense(
    p_clinic_id     UUID,
    p_description   TEXT,
    p_amount        NUMERIC,
    p_category      TEXT,
    p_date          TEXT,
    p_payment_method TEXT DEFAULT NULL,
    p_receipt_url   TEXT DEFAULT NULL
)
RETURNS SETOF public.expenses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.clinic_members
        WHERE clinic_id = p_clinic_id AND user_id = auth.uid()
          AND status = 'active' AND role IN ('owner','admin')
    ) THEN
        RAISE EXCEPTION 'Solo owners y admins pueden registrar gastos';
    END IF;

    RETURN QUERY
    INSERT INTO public.expenses (clinic_id, description, amount, category, date, payment_method, receipt_url)
    VALUES (p_clinic_id, p_description, p_amount, p_category, p_date::DATE, p_payment_method, p_receipt_url)
    RETURNING *;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_clinic_expense(UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT)
    TO authenticated, service_role;

-- Política de Storage para expense-receipts (ejecutar en dashboard si no existe el bucket)
-- CREATE POLICY "clinic_members_expense_receipts" ON storage.objects FOR ALL
--     USING (bucket_id = 'expense-receipts' AND
--            (storage.foldername(name))[1] IN (
--                SELECT clinic_id::text FROM public.clinic_members
--                WHERE user_id = auth.uid() AND status = 'active'
--            ));
