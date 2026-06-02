-- Fix: backfill inventory_stock para clínicas sin entradas
-- Causa raíz: el seed de inventory_locations solo corría para clínicas
-- que YA tenían productos al momento de la migración. Clínicas que
-- agregaron productos después (ej: Santiago) quedaron sin location ni
-- entradas en inventory_stock → UI mostraba 0 para todos los productos.

DO $$
DECLARE
    r RECORD;
    v_location_id UUID;
BEGIN
    -- 1. Crear "Inventario Principal" para clínicas que tienen productos
    --    pero ninguna ubicación definida, y hacer backfill del stock.
    FOR r IN
        SELECT DISTINCT p.clinic_id
        FROM public.inventory_products p
        WHERE p.is_active = true
          AND NOT EXISTS (
              SELECT 1 FROM public.inventory_locations l
              WHERE l.clinic_id = p.clinic_id
          )
    LOOP
        INSERT INTO public.inventory_locations
            (clinic_id, name, type, is_active_for_sales, is_default)
        VALUES
            (r.clinic_id, 'Inventario Principal', 'warehouse', true, true)
        RETURNING id INTO v_location_id;

        INSERT INTO public.inventory_stock (product_id, location_id, quantity)
        SELECT id, v_location_id, stock_quantity
        FROM public.inventory_products
        WHERE clinic_id = r.clinic_id
          AND is_active = true
          AND stock_quantity > 0
        ON CONFLICT (product_id, location_id) DO NOTHING;
    END LOOP;

    -- 2. Para clínicas que SÍ tienen location (default) pero les faltan
    --    entradas en inventory_stock (productos creados después del seed),
    --    completar el snapshot desde stock_quantity.
    FOR r IN
        SELECT l.id AS location_id, l.clinic_id
        FROM public.inventory_locations l
        WHERE l.is_default = true
    LOOP
        INSERT INTO public.inventory_stock (product_id, location_id, quantity)
        SELECT p.id, r.location_id, p.stock_quantity
        FROM public.inventory_products p
        WHERE p.clinic_id = r.clinic_id
          AND p.is_active = true
          AND p.stock_quantity > 0
          AND NOT EXISTS (
              SELECT 1 FROM public.inventory_stock s
              WHERE s.product_id = p.id
                AND s.location_id = r.location_id
          )
        ON CONFLICT (product_id, location_id) DO NOTHING;
    END LOOP;
END;
$$;
