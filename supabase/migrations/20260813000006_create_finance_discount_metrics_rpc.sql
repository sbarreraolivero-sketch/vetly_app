-- Los descuentos eran invisibles en la app: se restaban del ingreso y
-- desaparecían. Medido en producción, Santiago descuenta ~6% de su facturación
-- bruta y Linares ~0,6% — 10x de diferencia sostenida durante 3 meses, sin que
-- nadie pudiera verlo. Este RPC expone el dato.
--
-- El % se calcula sobre el BRUTO (neto + descuento): "de todo lo que pude
-- cobrar, cuánto regalé". El monto absoluto por sí solo no es comparable entre
-- meses, porque sube y baja con el volumen.

CREATE OR REPLACE FUNCTION public.get_finance_discount_metrics(
    p_clinic_id  UUID,
    p_start      TIMESTAMPTZ,
    p_end        TIMESTAMPTZ
)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_result JSON;
BEGIN
    -- Mismo control de acceso que el resto de RPCs de finanzas.
    IF NOT EXISTS (
        SELECT 1 FROM public.clinic_members cm
        WHERE cm.user_id = auth.uid() AND cm.clinic_id = p_clinic_id AND cm.status = 'active'
    ) AND auth.uid() IS NOT NULL THEN
        RAISE EXCEPTION 'Acceso denegado';
    END IF;

    WITH inc AS (
        SELECT i.id, i.amount, COALESCE(i.discount,0) AS discount,
               NULLIF(TRIM(COALESCE(i.discount_reason,'')),'') AS reason,
               i.services
        FROM public.incomes i
        WHERE i.clinic_id = p_clinic_id
          AND i.date >= p_start::date
          AND i.date <= p_end::date
    ),
    totals AS (
        SELECT
            COALESCE(SUM(discount),0)                              AS total_discount,
            COALESCE(SUM(amount),0)                                AS net_revenue,
            COALESCE(SUM(amount),0) + COALESCE(SUM(discount),0)    AS gross_revenue,
            COUNT(*)                                               AS total_sales,
            COUNT(*) FILTER (WHERE discount > 0)                   AS sales_with_discount,
            COALESCE(ROUND(AVG(discount) FILTER (WHERE discount > 0)),0) AS avg_discount,
            COALESCE(MAX(discount),0)                              AS max_discount
        FROM inc
    ),
    by_reason AS (
        SELECT COALESCE(reason,'__SIN_MOTIVO__') AS reason,
               COUNT(*) AS times,
               SUM(discount) AS amount
        FROM inc WHERE discount > 0
        GROUP BY 1 ORDER BY SUM(discount) DESC LIMIT 10
    ),
    -- Descuento imputado a cada ítem, con el mismo prorrateo que usa
    -- get_finance_item_metrics, para que ambos reportes sean coherentes.
    item_disc AS (
        SELECT e->>'name' AS name,
               SUM(
                   COALESCE((e->>'price')::numeric,0)
                   * (i.discount / NULLIF(g.items_gross,0))
               ) AS discount_amount,
               COUNT(*) AS times
        FROM inc i
        JOIN LATERAL (
            SELECT COALESCE(SUM(COALESCE((x->>'price')::numeric,0)),0) AS items_gross
            FROM jsonb_array_elements(COALESCE(i.services,'[]'::jsonb)) x
        ) g ON TRUE
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(i.services,'[]'::jsonb)) e
        WHERE i.discount > 0 AND g.items_gross > 0 AND NULLIF(TRIM(e->>'name'),'') IS NOT NULL
        GROUP BY 1 ORDER BY 2 DESC LIMIT 10
    )
    SELECT json_build_object(
        'total_discount',      (SELECT total_discount FROM totals),
        'gross_revenue',       (SELECT gross_revenue FROM totals),
        'net_revenue',         (SELECT net_revenue FROM totals),
        'discount_pct',        (SELECT CASE WHEN gross_revenue > 0
                                            THEN ROUND(100.0 * total_discount / gross_revenue, 1)
                                            ELSE 0 END FROM totals),
        'total_sales',         (SELECT total_sales FROM totals),
        'sales_with_discount', (SELECT sales_with_discount FROM totals),
        'avg_discount',        (SELECT avg_discount FROM totals),
        'max_discount',        (SELECT max_discount FROM totals),
        'by_reason',           (SELECT json_agg(row_to_json(t)) FROM by_reason t),
        'top_items',           (SELECT json_agg(row_to_json(t)) FROM item_disc t)
    ) INTO v_result;

    RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_finance_discount_metrics(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_finance_discount_metrics(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;
