-- ============================================================================
-- Motor de fidelización — parte 5: los RPCs de ingresos aceptan canje y
-- disparan el motor ellos mismos.
--
-- El sync se hace DENTRO del RPC y no desde el frontend a propósito: así ningún
-- camino de escritura puede olvidarse de acreditar los puntos. Es el mismo error
-- que dejó `payment_method` sin guardar durante semanas (sesiones 45/46).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_clinic_income(
    p_clinic_id       UUID,
    p_description     TEXT,
    p_amount          NUMERIC,
    p_category        TEXT,
    p_date            DATE,
    p_tutor_id        UUID    DEFAULT NULL,
    p_services        JSONB   DEFAULT '[]'::jsonb,
    p_discount        NUMERIC DEFAULT 0,
    p_notes           TEXT    DEFAULT NULL,
    p_payment_method  TEXT    DEFAULT NULL,
    p_discount_reason TEXT    DEFAULT NULL,
    p_iva_amount      NUMERIC DEFAULT NULL,
    p_loyalty_redeemed NUMERIC DEFAULT 0
)
RETURNS SETOF public.incomes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id       UUID;
    v_redeemed NUMERIC := 0;
    v_balance  INTEGER := 0;
BEGIN
    -- auth.uid() NULL = service_role / llamada interna.
    IF auth.uid() IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM clinic_members cm
        WHERE cm.user_id = auth.uid() AND cm.clinic_id = p_clinic_id AND cm.status = 'active'
    ) THEN
        RAISE EXCEPTION 'No autorizado para operar sobre esta clínica';
    END IF;

    -- El canje nunca puede exceder el saldo real del tutor.
    IF p_tutor_id IS NOT NULL AND COALESCE(p_loyalty_redeemed, 0) > 0 THEN
        SELECT COALESCE(loyalty_points, 0) INTO v_balance FROM tutors WHERE id = p_tutor_id;
        v_redeemed := LEAST(p_loyalty_redeemed, v_balance);
    END IF;

    INSERT INTO public.incomes
        (clinic_id, description, amount, category, date, tutor_id, services,
         discount, notes, payment_method, discount_reason, iva_amount, loyalty_redeemed)
    VALUES
        (p_clinic_id, p_description, p_amount, p_category, p_date, p_tutor_id, p_services,
         p_discount, p_notes, p_payment_method, p_discount_reason, p_iva_amount, v_redeemed)
    RETURNING id INTO v_id;

    PERFORM public.sync_income_loyalty(v_id);

    RETURN QUERY SELECT * FROM public.incomes WHERE id = v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_clinic_income(
    p_income_id       UUID,
    p_description     TEXT    DEFAULT NULL,
    p_amount          NUMERIC DEFAULT NULL,
    p_category        TEXT    DEFAULT NULL,
    p_date            DATE    DEFAULT NULL,
    p_tutor_id        UUID    DEFAULT NULL,
    p_services        JSONB   DEFAULT NULL,
    p_discount        NUMERIC DEFAULT 0,
    p_notes           TEXT    DEFAULT NULL,
    p_payment_method  TEXT    DEFAULT NULL,
    p_discount_reason TEXT    DEFAULT NULL,
    p_iva_amount      NUMERIC DEFAULT NULL,
    p_loyalty_redeemed NUMERIC DEFAULT 0
)
RETURNS SETOF public.incomes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_clinic_id  UUID;
    v_prev_redeem NUMERIC := 0;
    v_redeemed   NUMERIC := 0;
    v_balance    INTEGER := 0;
BEGIN
    SELECT clinic_id, COALESCE(loyalty_redeemed, 0)
    INTO v_clinic_id, v_prev_redeem
    FROM public.incomes WHERE id = p_income_id;

    IF v_clinic_id IS NULL THEN RETURN; END IF;

    IF auth.uid() IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM clinic_members cm
        WHERE cm.user_id = auth.uid() AND cm.clinic_id = v_clinic_id AND cm.status = 'active'
    ) THEN
        RAISE EXCEPTION 'No autorizado para operar sobre esta clínica';
    END IF;

    -- Tope del canje: el saldo actual ya tiene descontado el canje previo de esta
    -- misma venta, así que se le vuelve a sumar para no penalizar una edición.
    IF p_tutor_id IS NOT NULL AND COALESCE(p_loyalty_redeemed, 0) > 0 THEN
        SELECT COALESCE(loyalty_points, 0) INTO v_balance FROM tutors WHERE id = p_tutor_id;
        v_redeemed := LEAST(p_loyalty_redeemed, v_balance + v_prev_redeem);
    END IF;

    UPDATE public.incomes SET
        description      = COALESCE(p_description, description),
        amount           = COALESCE(p_amount, amount),
        category         = COALESCE(p_category, category),
        date             = COALESCE(p_date, date),
        tutor_id         = p_tutor_id,
        services         = COALESCE(p_services, services),
        discount         = p_discount,
        notes            = p_notes,
        payment_method   = p_payment_method,
        discount_reason  = p_discount_reason,
        iva_amount       = p_iva_amount,
        loyalty_redeemed = v_redeemed
    WHERE id = p_income_id;

    PERFORM public.sync_income_loyalty(p_income_id);

    RETURN QUERY SELECT * FROM public.incomes WHERE id = p_income_id;
END;
$$;
