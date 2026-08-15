-- El canje debe viajar al frontend: se muestra como línea propia en el informe de
-- caja y en el export, y precarga el modal de edición para no perderse al editar.
DROP FUNCTION IF EXISTS public.get_clinic_incomes_secure(uuid, timestamptz, timestamptz);

CREATE FUNCTION public.get_clinic_incomes_secure(
    p_clinic_id  uuid,
    p_start_date timestamptz,
    p_end_date   timestamptz
)
RETURNS TABLE(
    id uuid, clinic_id uuid, description text, amount numeric, discount numeric,
    discount_reason text, iva_amount numeric, category text, date date,
    tutor_id uuid, tutor_name text, services jsonb, notes text,
    payment_method text, loyalty_redeemed numeric, created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.clinic_members cm
        WHERE cm.user_id = auth.uid()
          AND cm.clinic_id = p_clinic_id
          AND cm.status = 'active'
    ) THEN
        RAISE EXCEPTION 'Access denied.';
    END IF;

    RETURN QUERY
    SELECT
        i.id, i.clinic_id, i.description, i.amount,
        COALESCE(i.discount, 0), i.discount_reason, i.iva_amount,
        i.category, i.date, i.tutor_id, t.name AS tutor_name, i.services,
        i.notes, i.payment_method, COALESCE(i.loyalty_redeemed, 0), i.created_at
    FROM public.incomes i
    LEFT JOIN public.tutors t ON t.id = i.tutor_id
    WHERE i.clinic_id = p_clinic_id
      AND i.created_at >= p_start_date
      AND i.created_at <= p_end_date
    ORDER BY i.created_at DESC;
END;
$$;
