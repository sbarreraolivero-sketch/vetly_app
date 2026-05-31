-- ═══════════════════════════════════════════════════════════════════
-- INVENTORY LOCATIONS — Vetly
-- Soporte para múltiples inventarios por clínica (máx 2)
-- Tablas: inventory_locations, inventory_stock
-- Alter:  inventory_movements (location_id + tipos de traspaso)
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. inventory_locations ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inventory_locations (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id           UUID NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
    name                TEXT NOT NULL DEFAULT 'Inventario Principal',
    type                TEXT NOT NULL DEFAULT 'warehouse'
                        CHECK (type IN ('warehouse', 'vehicle')),
    is_active_for_sales BOOLEAN NOT NULL DEFAULT false,
    is_default          BOOLEAN NOT NULL DEFAULT false,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.inventory_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory_locations_clinic_members" ON public.inventory_locations
    FOR ALL USING (
        clinic_id IN (
            SELECT clinic_id FROM public.clinic_members
            WHERE user_id = auth.uid() AND status = 'active'
        )
    );

CREATE POLICY "inventory_locations_service_role" ON public.inventory_locations
    FOR ALL TO service_role USING (true);

-- ── 2. inventory_stock (stock por ubicación) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.inventory_stock (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id  UUID NOT NULL REFERENCES public.inventory_products(id) ON DELETE CASCADE,
    location_id UUID NOT NULL REFERENCES public.inventory_locations(id) ON DELETE CASCADE,
    quantity    NUMERIC NOT NULL DEFAULT 0,
    UNIQUE (product_id, location_id)
);

ALTER TABLE public.inventory_stock ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory_stock_clinic_members" ON public.inventory_stock
    FOR ALL USING (
        location_id IN (
            SELECT id FROM public.inventory_locations
            WHERE clinic_id IN (
                SELECT clinic_id FROM public.clinic_members
                WHERE user_id = auth.uid() AND status = 'active'
            )
        )
    );

CREATE POLICY "inventory_stock_service_role" ON public.inventory_stock
    FOR ALL TO service_role USING (true);

-- ── 3. Alteraciones en inventory_movements ───────────────────────────
ALTER TABLE public.inventory_movements
    ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES public.inventory_locations(id) ON DELETE SET NULL;

-- Expandir CHECK de tipos para incluir traspasos
ALTER TABLE public.inventory_movements
    DROP CONSTRAINT IF EXISTS inventory_movements_type_check;

ALTER TABLE public.inventory_movements
    ADD CONSTRAINT inventory_movements_type_check
    CHECK (type IN ('purchase','sale','adjustment','waste','return','transfer_in','transfer_out'));

-- ── 4. Trigger actualizado: stock total + stock por ubicación ────────
CREATE OR REPLACE FUNCTION public.update_product_stock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    -- Los traspasos NO modifican el stock total del producto
    -- (un transfer_out en A + transfer_in en B = neto 0)
    IF NEW.type NOT IN ('transfer_in', 'transfer_out') THEN
        UPDATE public.inventory_products
        SET    stock_quantity = stock_quantity + NEW.quantity,
               updated_at     = NOW()
        WHERE  id = NEW.product_id;
    END IF;

    -- Si el movimiento tiene ubicación, actualizar el stock de esa ubicación
    IF NEW.location_id IS NOT NULL THEN
        INSERT INTO public.inventory_stock (product_id, location_id, quantity)
        VALUES (NEW.product_id, NEW.location_id, NEW.quantity)
        ON CONFLICT (product_id, location_id)
        DO UPDATE SET quantity = public.inventory_stock.quantity + EXCLUDED.quantity;
    END IF;

    RETURN NEW;
END;
$$;

-- ── 5. Función de traspaso atómica ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.transfer_inventory(
    p_clinic_id         UUID,
    p_product_id        UUID,
    p_from_location_id  UUID,
    p_to_location_id    UUID,
    p_quantity          NUMERIC,
    p_notes             TEXT DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_from_stock NUMERIC;
BEGIN
    -- Verificar stock disponible en origen
    SELECT quantity INTO v_from_stock
    FROM public.inventory_stock
    WHERE product_id = p_product_id AND location_id = p_from_location_id;

    IF v_from_stock IS NULL OR v_from_stock < p_quantity THEN
        RAISE EXCEPTION 'Stock insuficiente en el origen (disponible: %)', COALESCE(v_from_stock, 0);
    END IF;

    -- Salida del origen
    INSERT INTO public.inventory_movements
        (clinic_id, product_id, location_id, type, quantity, notes)
    VALUES
        (p_clinic_id, p_product_id, p_from_location_id, 'transfer_out', -p_quantity, p_notes);

    -- Entrada al destino
    INSERT INTO public.inventory_movements
        (clinic_id, product_id, location_id, type, quantity, notes)
    VALUES
        (p_clinic_id, p_product_id, p_to_location_id, 'transfer_in', p_quantity, p_notes);
END;
$$;

-- ── 6. Seed: crear "Inventario Principal" para clínicas existentes ────
-- Por cada clínica que tenga productos, crea la ubicación default
-- y migra el stock actual a inventory_stock como snapshot inicial.

DO $$
DECLARE
    r RECORD;
    v_location_id UUID;
BEGIN
    FOR r IN
        SELECT DISTINCT clinic_id
        FROM public.inventory_products
        WHERE is_active = true
    LOOP
        -- Crear ubicación default si no existe
        INSERT INTO public.inventory_locations
            (clinic_id, name, type, is_active_for_sales, is_default)
        VALUES
            (r.clinic_id, 'Inventario Principal', 'warehouse', true, true)
        ON CONFLICT DO NOTHING
        RETURNING id INTO v_location_id;

        -- Si ya existía (ON CONFLICT), obtener el ID existente
        IF v_location_id IS NULL THEN
            SELECT id INTO v_location_id
            FROM public.inventory_locations
            WHERE clinic_id = r.clinic_id AND is_default = true
            LIMIT 1;
        END IF;

        -- Snapshot inicial: stock actual de cada producto → inventory_stock
        INSERT INTO public.inventory_stock (product_id, location_id, quantity)
        SELECT id, v_location_id, stock_quantity
        FROM public.inventory_products
        WHERE clinic_id = r.clinic_id
          AND is_active = true
          AND stock_quantity > 0
        ON CONFLICT (product_id, location_id) DO NOTHING;

    END LOOP;
END;
$$;
