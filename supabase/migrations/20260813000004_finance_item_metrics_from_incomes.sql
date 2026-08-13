-- BUG RAÍZ del tab "Análisis" de Finanzas: get_finance_item_metrics leía los
-- servicios, el ticket promedio y el conteo de "citas" desde la tabla
-- `appointments`, pero desde la sesión 44 TODO el dinero de Finanzas vive en
-- `incomes` (decisión: "Finanzas se basa SOLO en ingresos manuales"). Nadie
-- actualizó este RPC en ese momento.
--
-- Medido en producción (agosto 2026), el RPC veía ~4% de la realidad:
--   Santiago:  4 citas / $63.000   vs   38 ingresos / $1.639.500
--   Linares:   5 citas / $101.000  vs   30 ingresos / $1.767.500
--   "Consulta Médica" mostraba $40.000 cuando la realidad eran $220.000.
--   Ticket promedio subestimado 2,7–2,9× en ambas sucursales.
--
-- Cambios:
--  1. Todo se calcula desde `incomes` (la fuente real de ingresos).
--  2. El descuento se prorratea entre los ítems del ingreso, para que la suma
--     por tipo cuadre exactamente con la tarjeta "Ingresos" (verificado: cuadra
--     al peso en ambas clínicas).
--  3. Los ítems libres (type='custom' — 41% del mes en Linares: cirugías,
--     eutanasias) dejan de ser invisibles: categoría y top propios.
--  4. "Citas con productos" (siempre 0, medía appointment_items que este flujo
--     nunca llena) pasa a ser "Ventas con productos", medido sobre incomes.
--  5. Se emite `sale_metrics` con nombres correctos y se mantiene `appt_metrics`
--     como alias de compatibilidad, para que un browser con el frontend viejo
--     en caché no muestre datos rotos durante el deploy.

CREATE OR REPLACE FUNCTION public.get_finance_item_metrics(
    p_clinic_id  UUID,
    p_start      TIMESTAMPTZ,
    p_end        TIMESTAMPTZ
)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_result JSON;
BEGIN
    WITH inc AS (
        SELECT i.id, i.amount, COALESCE(i.discount, 0) AS discount, i.services
        FROM public.incomes i
        WHERE i.clinic_id = p_clinic_id
          AND i.date >= p_start::date
          AND i.date <= p_end::date
    ),
    inc_totals AS (
        SELECT inc.id,
               inc.discount,
               COALESCE(SUM(COALESCE((elem->>'price')::numeric, 0)), 0) AS items_gross
        FROM inc
        LEFT JOIN LATERAL jsonb_array_elements(COALESCE(inc.services, '[]'::jsonb)) elem ON TRUE
        GROUP BY inc.id, inc.discount
    ),
    items AS (
        SELECT
            CASE WHEN elem->>'type' IN ('service','product') THEN elem->>'type' ELSE 'custom' END AS item_type,
            NULLIF(TRIM(elem->>'name'), '') AS name,
            1::numeric AS quantity,
            -- Descuento prorrateado: cada ítem baja en la misma proporción que el
            -- descuento aplicado al ingreso completo, para que la suma por tipo
            -- cuadre exactamente con la tarjeta "Ingresos".
            GREATEST(
                0,
                COALESCE((elem->>'price')::numeric, 0)
                * CASE WHEN t.items_gross > 0
                       THEN GREATEST(0, 1 - (t.discount / t.items_gross))
                       ELSE 1 END
            ) AS subtotal
        FROM inc
        JOIN inc_totals t ON t.id = inc.id
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(inc.services, '[]'::jsonb)) elem
    ),
    by_type AS (
        SELECT item_type,
               COUNT(*)       AS item_count,
               SUM(subtotal)  AS total_revenue,
               SUM(quantity)  AS total_units
        FROM items GROUP BY item_type
    ),
    top_services AS (
        SELECT name, SUM(subtotal) AS revenue, SUM(quantity) AS units
        FROM items WHERE item_type = 'service' AND name IS NOT NULL
        GROUP BY name ORDER BY revenue DESC LIMIT 10
    ),
    top_products AS (
        SELECT name, SUM(subtotal) AS revenue, SUM(quantity) AS units
        FROM items WHERE item_type = 'product' AND name IS NOT NULL
        GROUP BY name ORDER BY revenue DESC LIMIT 10
    ),
    top_custom AS (
        SELECT name, SUM(subtotal) AS revenue, SUM(quantity) AS units
        FROM items WHERE item_type = 'custom' AND name IS NOT NULL
        GROUP BY name ORDER BY revenue DESC LIMIT 10
    ),
    sale_metrics AS (
        SELECT
            COUNT(*)                                     AS total_sales,
            COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM jsonb_array_elements(COALESCE(inc.services, '[]'::jsonb)) e
                WHERE e->>'type' = 'product'
            ))                                           AS sales_with_products,
            COALESCE(ROUND(AVG(inc.amount)), 0)          AS avg_ticket,
            COALESCE(SUM(inc.amount), 0)                 AS total_revenue
        FROM inc
    )
    SELECT json_build_object(
        'by_type',      (SELECT json_agg(row_to_json(t)) FROM by_type t),
        'top_services', (SELECT json_agg(row_to_json(t)) FROM top_services t),
        'top_products', (SELECT json_agg(row_to_json(t)) FROM top_products t),
        'top_custom',   (SELECT json_agg(row_to_json(t)) FROM top_custom t),
        'sale_metrics', (SELECT row_to_json(t) FROM sale_metrics t),
        'appt_metrics', (SELECT json_build_object(
                             'total_appts',         total_sales,
                             'appts_with_products', sales_with_products,
                             'avg_ticket',          avg_ticket
                         ) FROM sale_metrics)
    ) INTO v_result;

    RETURN v_result;
END;
$$;
