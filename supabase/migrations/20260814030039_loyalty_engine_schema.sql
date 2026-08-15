-- ============================================================================
-- Motor de fidelización sobre ventas — parte 1: modelo de datos
--
-- Contexto: hasta ahora `loyalty_points_percentage` (5%) era decorativo — ningún
-- código lo leía. La acumulación pasa a calcularse sobre `incomes` (única fuente
-- con monto desde la sesión 44) y necesita poder vincularse a la venta que la
-- originó, tanto para idempotencia como para revertir al editar/borrar.
-- ============================================================================

-- Vincula cada movimiento de puntos a la venta que lo generó.
-- ON DELETE SET NULL: al borrar la venta, la fila queda huérfana en vez de
-- desaparecer; el trigger de DELETE se encarga de revertir el saldo antes.
ALTER TABLE public.loyalty_transactions
    ADD COLUMN IF NOT EXISTS income_id UUID REFERENCES public.incomes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_loyalty_transactions_income_id
    ON public.loyalty_transactions(income_id) WHERE income_id IS NOT NULL;

-- Idempotencia a nivel de BD: una venta no puede generar dos veces el mismo tipo
-- de movimiento para el mismo tutor. Cierra el bug que le dio doble bono de
-- bienvenida a un tutor real el 2026-07-29 (18:44 y 21:24).
CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_tx_income_type_tutor
    ON public.loyalty_transactions(income_id, type, tutor_id)
    WHERE income_id IS NOT NULL;

-- Pesos canjeados en la venta. Columna propia y NO reutilizar `discount`: el canje
-- no es un descuento comercial, y mezclarlos falsearía el reporte de descuentos
-- (monto, % sobre bruto y motivo obligatorio) construido en la sesión 69.
ALTER TABLE public.incomes
    ADD COLUMN IF NOT EXISTS loyalty_redeemed NUMERIC NOT NULL DEFAULT 0;

-- El bono de bienvenida pasa a poder expresarse como porcentaje de la compra.
-- Se mantiene `loyalty_welcome_bonus` como el valor (15 = 15% si el tipo es
-- 'percentage'), para no romper a las clínicas que lo usan como monto fijo.
ALTER TABLE public.clinic_settings
    ADD COLUMN IF NOT EXISTS loyalty_welcome_bonus_type TEXT NOT NULL DEFAULT 'fixed';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.clinic_settings'::regclass
          AND conname = 'clinic_settings_loyalty_welcome_bonus_type_check'
    ) THEN
        ALTER TABLE public.clinic_settings
            ADD CONSTRAINT clinic_settings_loyalty_welcome_bonus_type_check
            CHECK (loyalty_welcome_bonus_type IN ('fixed', 'percentage'));
    END IF;
END $$;

COMMENT ON COLUMN public.loyalty_transactions.income_id IS
    'Venta que originó el movimiento. NULL para ajustes manuales desde Fidelización.';
COMMENT ON COLUMN public.incomes.loyalty_redeemed IS
    'Pesos de fidelización canjeados en esta venta. Separado de `discount` a propósito.';
COMMENT ON COLUMN public.clinic_settings.loyalty_welcome_bonus_type IS
    'fixed = loyalty_welcome_bonus es un monto; percentage = es un % de la primera compra.';
