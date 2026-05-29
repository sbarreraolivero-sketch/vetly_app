-- ═══════════════════════════════════════════════════════════════════
-- INVENTORY SYSTEM — Vetly
-- Tablas: inventory_products, inventory_movements, appointment_items
-- RPCs: get_inventory_abc, get_inventory_rotation, get_finance_item_metrics
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. inventory_products ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inventory_products (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id       UUID NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    sku             TEXT,
    category        TEXT NOT NULL DEFAULT 'other'
                    CHECK (category IN ('medication','vaccine','food','accessory','supply','other')),
    description     TEXT,
    unit            TEXT NOT NULL DEFAULT 'unit'
                    CHECK (unit IN ('ml','mg','unit','tablet','box','vial','kg','g','dose')),
    purchase_price  NUMERIC DEFAULT 0,
    sale_price      NUMERIC DEFAULT 0,
    stock_quantity  NUMERIC DEFAULT 0,
    min_stock_alert NUMERIC DEFAULT 5,
    batch_number    TEXT,
    expiry_date     DATE,
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.inventory_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory_products_clinic_members" ON public.inventory_products
    FOR ALL USING (
        clinic_id IN (
            SELECT clinic_id FROM public.clinic_members
            WHERE user_id = auth.uid() AND status = 'active'
        )
    );

CREATE POLICY "inventory_products_service_role" ON public.inventory_products
    FOR ALL TO service_role USING (true);

-- ── 2. inventory_movements ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inventory_movements (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id       UUID NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
    product_id      UUID NOT NULL REFERENCES public.inventory_products(id) ON DELETE CASCADE,
    type            TEXT NOT NULL
                    CHECK (type IN ('purchase','sale','adjustment','waste','return')),
    quantity        NUMERIC NOT NULL,   -- positivo = entrada, negativo = salida
    unit_cost       NUMERIC,
    unit_price      NUMERIC,
    appointment_id  UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
    tutor_id        UUID REFERENCES public.tutors(id) ON DELETE SET NULL,
    notes           TEXT,
    created_by      UUID REFERENCES auth.users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory_movements_clinic_members" ON public.inventory_movements
    FOR ALL USING (
        clinic_id IN (
            SELECT clinic_id FROM public.clinic_members
            WHERE user_id = auth.uid() AND status = 'active'
        )
    );

CREATE POLICY "inventory_movements_service_role" ON public.inventory_movements
    FOR ALL TO service_role USING (true);

-- ── 3. appointment_items ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.appointment_items (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    appointment_id  UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
    clinic_id       UUID NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
    item_type       TEXT NOT NULL CHECK (item_type IN ('service','product')),
    name            TEXT NOT NULL,
    quantity        NUMERIC NOT NULL DEFAULT 1,
    unit_price      NUMERIC NOT NULL DEFAULT 0,
    subtotal        NUMERIC NOT NULL DEFAULT 0,  -- quantity * unit_price, calculado en app
    product_id      UUID REFERENCES public.inventory_products(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.appointment_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "appointment_items_clinic_members" ON public.appointment_items
    FOR ALL USING (
        clinic_id IN (
            SELECT clinic_id FROM public.clinic_members
            WHERE user_id = auth.uid() AND status = 'active'
        )
    );

CREATE POLICY "appointment_items_service_role" ON public.appointment_items
    FOR ALL TO service_role USING (true);

-- ── 4. Trigger: actualizar stock al insertar movimiento ──────────────
CREATE OR REPLACE FUNCTION public.update_product_stock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    UPDATE public.inventory_products
    SET    stock_quantity = stock_quantity + NEW.quantity,
           updated_at     = NOW()
    WHERE  id = NEW.product_id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_update_stock_on_movement ON public.inventory_movements;
CREATE TRIGGER tr_update_stock_on_movement
    AFTER INSERT ON public.inventory_movements
    FOR EACH ROW EXECUTE FUNCTION public.update_product_stock();

-- ── 5. Trigger: updated_at en inventory_products ─────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_inventory_products_updated_at ON public.inventory_products;
CREATE TRIGGER tr_inventory_products_updated_at
    BEFORE UPDATE ON public.inventory_products
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 6. RPC: clasificación ABC de productos ───────────────────────────
CREATE OR REPLACE FUNCTION public.get_inventory_abc(
    p_clinic_id UUID,
    p_days      INTEGER DEFAULT 90
)
RETURNS TABLE (
    product_id    UUID,
    product_name  TEXT,
    category      TEXT,
    unit          TEXT,
    total_sold    NUMERIC,
    total_revenue NUMERIC,
    revenue_pct   NUMERIC,
    abc_class     TEXT
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_cutoff TIMESTAMPTZ := NOW() - (p_days || ' days')::INTERVAL;
BEGIN
    RETURN QUERY
    WITH sales AS (
        SELECT
            im.product_id,
            ABS(SUM(im.quantity))                    AS qty_sold,
            ABS(SUM(im.quantity * COALESCE(im.unit_price, 0))) AS revenue
        FROM public.inventory_movements im
        WHERE im.clinic_id = p_clinic_id
          AND im.type IN ('sale')
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
        prod_id,
        prod_name,
        prod_cat,
        prod_unit,
        qty_sold,
        rev,
        rev_pct,
        CASE
            WHEN cumulative_pct <= 80  THEN 'A'
            WHEN cumulative_pct <= 95  THEN 'B'
            ELSE                            'C'
        END AS abc_class
    FROM ranked
    ORDER BY rev DESC;
END;
$$;

-- ── 7. RPC: productos sin rotación ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_inventory_no_rotation(
    p_clinic_id UUID,
    p_days      INTEGER DEFAULT 30
)
RETURNS TABLE (
    product_id        UUID,
    product_name      TEXT,
    category          TEXT,
    stock_quantity    NUMERIC,
    last_movement_at  TIMESTAMPTZ,
    days_no_movement  INTEGER
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY
    SELECT
        ip.id,
        ip.name,
        ip.category,
        ip.stock_quantity,
        MAX(im.created_at)                                       AS last_mv,
        COALESCE(
            EXTRACT(DAY FROM NOW() - MAX(im.created_at))::INTEGER,
            EXTRACT(DAY FROM NOW() - ip.created_at)::INTEGER
        )                                                        AS days_no_mv
    FROM public.inventory_products ip
    LEFT JOIN public.inventory_movements im
           ON im.product_id = ip.id AND im.type IN ('sale','waste')
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
$$;

-- ── 8. RPC: métricas de ítems para Finance ───────────────────────────
CREATE OR REPLACE FUNCTION public.get_finance_item_metrics(
    p_clinic_id  UUID,
    p_start      TIMESTAMPTZ,
    p_end        TIMESTAMPTZ
)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_result JSON;
BEGIN
    WITH items AS (
        SELECT
            ai.item_type,
            ai.name,
            ai.quantity,
            ai.subtotal
        FROM public.appointment_items ai
        JOIN public.appointments a ON a.id = ai.appointment_id
        WHERE ai.clinic_id = p_clinic_id
          AND a.appointment_date >= p_start
          AND a.appointment_date <= p_end
          AND a.status = 'completed'
          AND a.payment_status IN ('paid','partial')
    ),
    by_type AS (
        SELECT
            item_type,
            COUNT(*)          AS item_count,
            SUM(subtotal)     AS total_revenue,
            SUM(quantity)     AS total_units
        FROM items
        GROUP BY item_type
    ),
    top_services AS (
        SELECT name, SUM(subtotal) AS revenue, SUM(quantity) AS units
        FROM items WHERE item_type = 'service'
        GROUP BY name
        ORDER BY revenue DESC
        LIMIT 10
    ),
    top_products AS (
        SELECT name, SUM(subtotal) AS revenue, SUM(quantity) AS units
        FROM items WHERE item_type = 'product'
        GROUP BY name
        ORDER BY revenue DESC
        LIMIT 10
    ),
    appt_metrics AS (
        SELECT
            COUNT(DISTINCT a.id)                        AS total_appts,
            COUNT(DISTINCT CASE WHEN EXISTS (
                SELECT 1 FROM public.appointment_items ai2
                WHERE ai2.appointment_id = a.id AND ai2.item_type = 'product'
            ) THEN a.id END)                            AS appts_with_products,
            COALESCE(AVG(a.price),0)                    AS avg_ticket
        FROM public.appointments a
        WHERE a.clinic_id = p_clinic_id
          AND a.appointment_date >= p_start
          AND a.appointment_date <= p_end
          AND a.status = 'completed'
          AND a.payment_status IN ('paid','partial')
    )
    SELECT json_build_object(
        'by_type',        (SELECT json_agg(row_to_json(t)) FROM by_type t),
        'top_services',   (SELECT json_agg(row_to_json(t)) FROM top_services t),
        'top_products',   (SELECT json_agg(row_to_json(t)) FROM top_products t),
        'appt_metrics',   (SELECT row_to_json(t) FROM appt_metrics t)
    ) INTO v_result;

    RETURN v_result;
END;
$$;

-- ── 9. RPC: items de una cita específica ─────────────────────────────
CREATE OR REPLACE FUNCTION public.get_appointment_items(p_appointment_id UUID)
RETURNS TABLE (
    id         UUID,
    item_type  TEXT,
    name       TEXT,
    quantity   NUMERIC,
    unit_price NUMERIC,
    subtotal   NUMERIC,
    product_id UUID
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY
    SELECT ai.id, ai.item_type, ai.name, ai.quantity, ai.unit_price, ai.subtotal, ai.product_id
    FROM public.appointment_items ai
    WHERE ai.appointment_id = p_appointment_id
    ORDER BY ai.item_type DESC, ai.created_at ASC;  -- services first
END;
$$;
