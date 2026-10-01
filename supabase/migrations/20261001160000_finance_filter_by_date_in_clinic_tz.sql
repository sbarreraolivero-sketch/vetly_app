-- El listado de ingresos filtraba por created_at (momento de carga) mientras las
-- tarjetas (get_finance_stats) suman por incomes.date -> un ingreso cargado hoy con
-- fecha de ayer sumaba en "ayer" pero no aparecía en el detalle. Ahora todo filtra
-- por `date`, convirtiendo los límites a fecha en la zona horaria de la clínica
-- (antes ::DATE usaba UTC y el fin de un día chileno caía en el día siguiente).

CREATE OR REPLACE FUNCTION public.clinic_local_date(p_clinic_id uuid, p_ts timestamptz)
RETURNS date LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT (p_ts AT TIME ZONE COALESCE(
      (SELECT z.name FROM public.clinic_settings cs
         JOIN pg_timezone_names z ON z.name = cs.timezone
        WHERE cs.id = p_clinic_id), 'America/Santiago'))::date
$$;

CREATE OR REPLACE FUNCTION public.get_clinic_incomes_secure(p_clinic_id uuid, p_start_date timestamptz, p_end_date timestamptz)
 RETURNS TABLE(id uuid, clinic_id uuid, description text, amount numeric, discount numeric, discount_reason text, iva_amount numeric, category text, date date, tutor_id uuid, tutor_name text, services jsonb, notes text, payment_method text, loyalty_redeemed numeric, created_at timestamptz)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.clinic_members cm
        WHERE cm.user_id = auth.uid() AND cm.clinic_id = p_clinic_id AND cm.status = 'active'
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
      AND i.date >= public.clinic_local_date(p_clinic_id, p_start_date)
      AND i.date <= public.clinic_local_date(p_clinic_id, p_end_date)
    ORDER BY i.date DESC, i.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_finance_stats(p_clinic_id uuid, p_start_date timestamptz, p_end_date timestamptz)
 RETURNS TABLE(total_income numeric, total_expenses numeric, net_profit numeric, appointments_count integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_manual_income NUMERIC; v_expenses NUMERIC; v_count INTEGER;
  v_from date := public.clinic_local_date(p_clinic_id, p_start_date);
  v_to   date := public.clinic_local_date(p_clinic_id, p_end_date);
BEGIN
  IF NOT EXISTS (
      SELECT 1 FROM public.clinic_members cm
      WHERE cm.user_id = auth.uid() AND cm.clinic_id = p_clinic_id AND cm.status = 'active'
  ) THEN RAISE EXCEPTION 'Acceso denegado'; END IF;

  SELECT COALESCE(SUM(amount), 0), COUNT(*) INTO v_manual_income, v_count
  FROM public.incomes WHERE clinic_id = p_clinic_id AND date >= v_from AND date <= v_to;

  SELECT COALESCE(SUM(amount), 0) INTO v_expenses
  FROM public.expenses WHERE clinic_id = p_clinic_id AND date >= v_from AND date <= v_to;

  RETURN QUERY SELECT v_manual_income, v_expenses, (v_manual_income - v_expenses), v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_clinic_expenses_secure(p_clinic_id uuid, p_start_date timestamptz, p_end_date timestamptz)
 RETURNS SETOF expenses LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.clinic_members
    WHERE user_id = auth.uid() AND clinic_id = p_clinic_id AND status = 'active'
  ) THEN RAISE EXCEPTION 'Access denied.'; END IF;

  RETURN QUERY
  SELECT * FROM public.expenses
  WHERE clinic_id = p_clinic_id
    AND date >= public.clinic_local_date(p_clinic_id, p_start_date)
    AND date <= public.clinic_local_date(p_clinic_id, p_end_date)
  ORDER BY date DESC, created_at DESC;
END; $function$;

REVOKE EXECUTE ON FUNCTION public.get_clinic_incomes_secure(uuid, timestamptz, timestamptz), public.get_finance_stats(uuid, timestamptz, timestamptz), public.get_clinic_expenses_secure(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_clinic_incomes_secure(uuid, timestamptz, timestamptz), public.get_finance_stats(uuid, timestamptz, timestamptz), public.get_clinic_expenses_secure(uuid, timestamptz, timestamptz) TO authenticated, service_role;
