-- Periodo de facturación de la suscripción (mensual / anual).
-- Lo escribe paddle-webhook desde `customData.billing_period`, que a su vez
-- viene de openPaddleSubscriptionCheckout(..., period). Necesario para el plan
-- Core anual (US$170/año) — hasta ahora todas las suscripciones eran mensuales.
ALTER TABLE public.subscriptions
    ADD COLUMN IF NOT EXISTS billing_period TEXT NOT NULL DEFAULT 'month';

COMMENT ON COLUMN public.subscriptions.billing_period IS
    'month | year. Lo escribe paddle-webhook desde customData.billing_period. Las suscripciones previas quedan en month, que es lo que eran.';
