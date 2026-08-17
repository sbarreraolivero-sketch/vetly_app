-- Migration: LemonSqueezy → Paddle
-- Agrega columnas propias para Paddle (no reusa mercadopago_subscription_id con
-- prefijo como hacía LS con "ls_..." — era deuda técnica que no vale la pena
-- heredar para el proveedor que sí procesa dinero real).
-- payment_provider queda como TEXT libre (sin CHECK constraint): agregar un CHECK
-- ahora arriesga romper filas viejas con 'lemonsqueezy' de pruebas (LS nunca tuvo
-- un pago real, pero test_mode sí insertó filas). Limpieza de datos + CHECK quedan
-- como mejora opcional posterior, no bloqueante para esta migración.

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS paddle_subscription_id TEXT;
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS paddle_customer_id TEXT;

COMMENT ON COLUMN clinic_settings.payment_provider IS 'Payment provider: mercadopago (CLP) or paddle (USD). Legacy value ''lemonsqueezy'' may still exist in old test_mode rows.';

-- Idempotencia de webhooks de Paddle — Paddle reintenta entregas automáticamente.
-- Sin esto, los packs (que incrementan balances) se duplicarían en cada reintento.
CREATE TABLE IF NOT EXISTS paddle_webhook_events (
    event_id TEXT PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE paddle_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON paddle_webhook_events
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
