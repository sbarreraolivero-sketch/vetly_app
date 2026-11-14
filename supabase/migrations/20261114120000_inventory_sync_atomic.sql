-- ============================================================================
-- Inventario ↔ ventas: sincronización atómica en la base (auditoría 2026-11-14)
--
-- Antes: el navegador, DESPUÉS de guardar el ingreso, hacía 3 pasos sueltos
-- (insertar reversiones → desvincular ventas viejas → insertar ventas nuevas).
-- Problemas: (a) si fallaba, solo un console.warn y el stock quedaba mal;
-- (b) un corte a mitad dejaba el stock devuelto sin volver a descontar;
-- (c) dos guardados simultáneos podían duplicar el descuento;
-- (d) al editar se descontaba de la ubicación activa DE HOY, no la original;
-- (e) las ventas viejas quedaban como type='sale' y el ABC / "sin rotación"
--     las contaban dos veces (52 casos en producción).
--
-- Ahora: un trigger sobre `incomes` lee `incomes.services` y reconcilia el
-- inventario EN LA MISMA TRANSACCIÓN que guarda la venta. Si algo falla, la
-- venta tampoco se guarda. Las ventas reemplazadas y sus reversiones quedan
-- marcadas `voided = true` y los reportes las excluyen. El stock sigue
-- moviéndose solo por INSERTs en inventory_movements (trigger existente).
-- ============================================================================

-- 1. Marca de movimientos anulados (venta reemplazada + su reversión)
ALTER TABLE public.inventory_movements
    ADD COLUMN IF NOT EXISTS voided boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.inventory_movements.voided IS
  'true = venta reemplazada por edición/borrado del ingreso, o la reversión que la compensa. Neto 0 en stock; excluir de reportes de ventas.';

CREATE INDEX IF NOT EXISTS idx_inventory_movements_income_active
    ON public.inventory_movements (income_id)
    WHERE type = 'sale' AND NOT voided;

-- 2. search_path fijo en el trigger de stock (advertencia de seguridad)
ALTER FUNCTION public.update_product_stock() SET search_path = public;

-- 3. Backfill: emparejar cada reversión automática histórica con la venta que
--    compensó y marcar ambas como anuladas. Neutral para el stock (solo flag).
DO $$
DECLARE
    r       record;
    v_sale  uuid;
    v_pairs int := 0;
BEGIN
    FOR r IN
        SELECT id, product_id, quantity, location_id, created_at
        FROM public.inventory_movements
        WHERE type = 'adjustment'
          AND notes LIKE 'Reversión automática%'
          AND NOT voided
        ORDER BY created_at
    LOOP
        SELECT s.id INTO v_sale
        FROM public.inventory_movements s
        WHERE s.type = 'sale'
          AND NOT s.voided
          AND s.income_id IS NULL
          AND s.appointment_id IS NULL
          AND s.product_id = r.product_id
          AND s.quantity = -r.quantity
          AND s.location_id IS NOT DISTINCT FROM r.location_id
          AND s.created_at <= r.created_at
        ORDER BY s.created_at DESC
        LIMIT 1;

        IF v_sale IS NOT NULL THEN
            UPDATE public.inventory_movements SET voided = true WHERE id IN (v_sale, r.id);
            v_pairs := v_pairs + 1;
        END IF;
    END LOOP;
    RAISE NOTICE 'Backfill inventario: % pares venta/reversión anulados', v_pairs;
END $$;

-- 4. Consumo de inventario que corresponde a una venta, leído de incomes.services
--    (productos vendidos directo + servicios vinculados a un producto).
--    `price` de cada línea es el TOTAL de la línea; `quantity` las unidades.
CREATE OR REPLACE FUNCTION public.income_inventory_consumption(p_clinic_id uuid, p_services jsonb)
RETURNS TABLE (product_id uuid, qty numeric, amount numeric)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    WITH it AS (
        SELECT
            e->>'type' AS t,
            (e->>'id')::uuid AS item_id,
            CASE WHEN (e->>'quantity') ~ '^[0-9]+(\.[0-9]+)?$'
                 THEN GREATEST(1, (e->>'quantity')::numeric) ELSE 1 END AS q,
            CASE WHEN (e->>'price') ~ '^-?[0-9]+(\.[0-9]+)?$'
                 THEN (e->>'price')::numeric ELSE 0 END AS price
        FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(p_services) = 'array' THEN p_services ELSE '[]'::jsonb END
             ) e
        WHERE (e->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ),
    raw AS (
        -- Productos vendidos directamente
        SELECT p.id AS product_id, it.q AS qty, it.price AS amount
        FROM it
        JOIN public.inventory_products p ON p.id = it.item_id AND p.clinic_id = p_clinic_id
        WHERE it.t = 'product'
        UNION ALL
        -- Servicios con producto vinculado (ej. vacuna): consumo = dosis × cantidad
        SELECT s.linked_product_id, COALESCE(s.linked_product_qty, 1) * it.q, it.price
        FROM it
        JOIN public.clinic_services s ON s.id = it.item_id AND s.clinic_id = p_clinic_id
        JOIN public.inventory_products p ON p.id = s.linked_product_id AND p.clinic_id = p_clinic_id
        WHERE it.t = 'service' AND s.linked_product_id IS NOT NULL
    )
    SELECT product_id, SUM(qty), SUM(amount)
    FROM raw
    GROUP BY product_id
$$;

REVOKE ALL ON FUNCTION public.income_inventory_consumption(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.income_inventory_consumption(uuid, jsonb) TO authenticated, service_role;

-- 5. Reconciliar el inventario de un ingreso (idempotente, no-op si no cambió)
CREATE OR REPLACE FUNCTION public.reconcile_income_inventory(
    p_income_id uuid,
    p_clinic_id uuid,
    p_tutor_id  uuid,
    p_services  jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_location uuid;
    v_existing jsonb;
    v_desired  jsonb;
BEGIN
    -- Estado actual: ventas vigentes ligadas al ingreso
    SELECT COALESCE(jsonb_agg(jsonb_build_array(x.product_id, round(x.qty, 3)) ORDER BY x.product_id), '[]'::jsonb)
    INTO v_existing
    FROM (
        SELECT m.product_id, SUM(-m.quantity) AS qty
        FROM public.inventory_movements m
        WHERE m.income_id = p_income_id AND m.type = 'sale' AND NOT m.voided
        GROUP BY m.product_id
    ) x;

    -- Estado deseado según incomes.services
    SELECT COALESCE(jsonb_agg(jsonb_build_array(c.product_id, round(c.qty, 3)) ORDER BY c.product_id), '[]'::jsonb)
    INTO v_desired
    FROM public.income_inventory_consumption(p_clinic_id, p_services) c;

    IF v_existing = v_desired THEN
        RETURN;  -- nada que hacer: no ensuciar el historial con reversiones
    END IF;

    -- Ubicación: la ORIGINAL de la venta; si es nueva, la activa para ventas,
    -- y si no hay, la ubicación por defecto.
    SELECT m.location_id INTO v_location
    FROM public.inventory_movements m
    WHERE m.income_id = p_income_id AND m.type = 'sale' AND NOT m.voided
      AND m.location_id IS NOT NULL
    ORDER BY m.created_at
    LIMIT 1;

    IF v_location IS NULL THEN
        SELECT l.id INTO v_location
        FROM public.inventory_locations l
        WHERE l.clinic_id = p_clinic_id
        ORDER BY l.is_active_for_sales DESC, l.is_default DESC, l.created_at
        LIMIT 1;
    END IF;

    -- Revertir las ventas vigentes (cada una en su propia ubicación) y anularlas
    INSERT INTO public.inventory_movements
        (clinic_id, product_id, type, quantity, location_id, income_id, notes, voided)
    SELECT m.clinic_id, m.product_id, 'adjustment', -m.quantity, m.location_id, NULL,
           'Reversión automática por edición/eliminación de ingreso', true
    FROM public.inventory_movements m
    WHERE m.income_id = p_income_id AND m.type = 'sale' AND NOT m.voided;

    -- Se desvincula (income_id = NULL) igual que hacía el código anterior del
    -- navegador: así un frontend viejo aún en caché nunca ve ventas anuladas
    -- y no las revierte por segunda vez durante el despliegue.
    UPDATE public.inventory_movements
    SET voided = true, income_id = NULL
    WHERE income_id = p_income_id AND type = 'sale' AND NOT voided;

    -- Descontar el consumo vigente
    INSERT INTO public.inventory_movements
        (clinic_id, product_id, type, quantity, unit_price, income_id, tutor_id, location_id)
    SELECT p_clinic_id, c.product_id, 'sale', -c.qty,
           CASE WHEN c.qty > 0 THEN c.amount / c.qty ELSE 0 END,
           p_income_id, p_tutor_id, v_location
    FROM public.income_inventory_consumption(p_clinic_id, p_services) c
    WHERE c.qty > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_income_inventory(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_income_inventory(uuid, uuid, uuid, jsonb) TO service_role;

-- 6. Triggers sobre incomes
CREATE OR REPLACE FUNCTION public.tr_income_inventory_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.reconcile_income_inventory(NEW.id, NEW.clinic_id, NEW.tutor_id, NEW.services);
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tr_income_inventory_revert_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Devolver al stock lo que esta venta descontó, antes de que el FK
    -- (ON DELETE SET NULL) desvincule los movimientos.
    BEGIN
        PERFORM public.reconcile_income_inventory(OLD.id, OLD.clinic_id, OLD.tutor_id, '[]'::jsonb);
    EXCEPTION WHEN foreign_key_violation THEN
        -- Borrado en cascada de la clínica completa: no hay stock que devolver.
        NULL;
    END;
    RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.tr_income_inventory_sync() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tr_income_inventory_revert_on_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tr_income_inventory_sync ON public.incomes;
CREATE TRIGGER tr_income_inventory_sync
    AFTER INSERT OR UPDATE OF services, tutor_id ON public.incomes
    FOR EACH ROW EXECUTE FUNCTION public.tr_income_inventory_sync();

DROP TRIGGER IF EXISTS tr_income_inventory_revert_on_delete ON public.incomes;
CREATE TRIGGER tr_income_inventory_revert_on_delete
    BEFORE DELETE ON public.incomes
    FOR EACH ROW EXECUTE FUNCTION public.tr_income_inventory_revert_on_delete();

-- 7. Cambiar la ubicación activa para ventas en UNA sentencia (antes eran dos
--    updates sueltos y si fallaba el segundo la clínica quedaba sin ubicación).
CREATE OR REPLACE FUNCTION public.set_active_sales_location(p_location_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_clinic uuid;
BEGIN
    SELECT clinic_id INTO v_clinic FROM public.inventory_locations WHERE id = p_location_id;
    IF v_clinic IS NULL THEN
        RAISE EXCEPTION 'Ubicación no encontrada';
    END IF;
    IF COALESCE(auth.role(), 'service_role') <> 'service_role'
       AND NOT public.is_clinic_member(v_clinic) THEN
        RAISE EXCEPTION 'Acceso denegado';
    END IF;
    UPDATE public.inventory_locations
    SET is_active_for_sales = (id = p_location_id)
    WHERE clinic_id = v_clinic;
END;
$$;

REVOKE ALL ON FUNCTION public.set_active_sales_location(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_active_sales_location(uuid) TO authenticated, service_role;

-- 8. Reportes de inventario: excluir movimientos anulados
CREATE OR REPLACE FUNCTION public.get_inventory_abc(p_clinic_id uuid, p_days integer DEFAULT 90)
 RETURNS TABLE(product_id uuid, product_name text, category text, unit text, total_sold numeric, total_revenue numeric, revenue_pct numeric, abc_class text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_cutoff TIMESTAMPTZ := NOW() - (p_days || ' days')::INTERVAL;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.clinic_members
        WHERE user_id = auth.uid() AND clinic_id = p_clinic_id AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'Acceso denegado';
    END IF;

    RETURN QUERY
    WITH sales AS (
        SELECT
            im.product_id,
            ABS(SUM(im.quantity))                    AS qty_sold,
            ABS(SUM(im.quantity * COALESCE(im.unit_price, 0))) AS revenue
        FROM public.inventory_movements im
        WHERE im.clinic_id = p_clinic_id
          AND im.type IN ('sale')
          AND NOT im.voided
          AND im.quantity < 0
          AND im.created_at >= v_cutoff
        GROUP BY im.product_id
    ),
    totals AS (
        SELECT COALESCE(SUM(revenue), 0) AS grand_total FROM sales
    ),
    ranked AS (
        SELECT
            ip.id          AS prod_id,
            ip.name        AS prod_name,
            ip.category    AS prod_cat,
            ip.unit        AS prod_unit,
            COALESCE(s.qty_sold, 0)   AS qty_sold,
            COALESCE(s.revenue, 0)    AS rev,
            CASE WHEN t.grand_total > 0
                 THEN ROUND((COALESCE(s.revenue,0) / t.grand_total * 100)::NUMERIC, 2)
                 ELSE 0 END           AS rev_pct,
            SUM(COALESCE(s.revenue,0) / NULLIF(t.grand_total,0) * 100)
                OVER (ORDER BY COALESCE(s.revenue,0) DESC) AS cumulative_pct
        FROM public.inventory_products ip
        CROSS JOIN totals t
        LEFT JOIN sales s ON s.product_id = ip.id
        WHERE ip.clinic_id = p_clinic_id AND ip.is_active = true
    )
    SELECT
        prod_id, prod_name, prod_cat, prod_unit, qty_sold, rev, rev_pct,
        CASE
            WHEN cumulative_pct <= 80  THEN 'A'
            WHEN cumulative_pct <= 95  THEN 'B'
            ELSE                            'C'
        END AS abc_class
    FROM ranked
    ORDER BY rev DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_inventory_no_rotation(p_clinic_id uuid, p_days integer DEFAULT 30)
 RETURNS TABLE(product_id uuid, product_name text, category text, stock_quantity numeric, last_movement_at timestamp with time zone, days_no_movement integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.clinic_members
        WHERE user_id = auth.uid() AND clinic_id = p_clinic_id AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'Acceso denegado';
    END IF;

    RETURN QUERY
    SELECT
        ip.id, ip.name, ip.category, ip.stock_quantity,
        MAX(im.created_at)                                       AS last_mv,
        COALESCE(
            EXTRACT(DAY FROM NOW() - MAX(im.created_at))::INTEGER,
            EXTRACT(DAY FROM NOW() - ip.created_at)::INTEGER
        )                                                        AS days_no_mv
    FROM public.inventory_products ip
    LEFT JOIN public.inventory_movements im
           ON im.product_id = ip.id AND im.type IN ('sale','waste') AND NOT im.voided
    WHERE ip.clinic_id = p_clinic_id
      AND ip.is_active = true
      AND ip.stock_quantity > 0
    GROUP BY ip.id, ip.name, ip.category, ip.stock_quantity, ip.created_at
    HAVING COALESCE(
        EXTRACT(DAY FROM NOW() - MAX(im.created_at))::INTEGER,
        EXTRACT(DAY FROM NOW() - ip.created_at)::INTEGER
    ) >= p_days
    ORDER BY days_no_mv DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_inventory_abc(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_inventory_no_rotation(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_abc(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_inventory_no_rotation(uuid, integer) TO authenticated, service_role;
