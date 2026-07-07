-- Los ingresos manuales (tabla `incomes`) ya guardan `tutor_id`, pero
-- get_clinic_incomes_secure solo devolvía el UUID crudo. Ningún componente del
-- frontend hacía el join contra `tutors` para mostrar el nombre, por lo que el
-- tutor asociado nunca aparecía en el informe de caja ni en las listas de
-- ingresos (aunque el dato sí estuviera guardado en la DB).
--
-- Este fix agrega `tutor_name` al retorno del RPC (LEFT JOIN tutors) para que
-- el frontend pueda mostrarlo sin queries adicionales.

DROP FUNCTION IF EXISTS public.get_clinic_incomes_secure(uuid, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.get_clinic_incomes_secure(
    p_clinic_id uuid,
    p_start_date timestamp with time zone,
    p_end_date timestamp with time zone
)
RETURNS TABLE (
    id uuid,
    clinic_id uuid,
    description text,
    amount numeric,
    discount numeric,
    discount_reason text,
    iva_amount numeric,
    category text,
    date date,
    tutor_id uuid,
    tutor_name text,
    services jsonb,
    notes text,
    payment_method text,
    created_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
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
        i.notes, i.payment_method, i.created_at
    FROM public.incomes i
    LEFT JOIN public.tutors t ON t.id = i.tutor_id
    WHERE i.clinic_id = p_clinic_id
      AND i.created_at >= p_start_date
      AND i.created_at <= p_end_date
    ORDER BY i.created_at DESC;
END;
$function$;
