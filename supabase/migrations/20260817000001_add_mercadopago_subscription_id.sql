-- mercadopago-create-subscription y mercadopago-webhook escriben
-- `mercadopago_subscription_id` en `subscriptions` desde hace tiempo, pero la
-- columna nunca existió. Supabase JS no lanza por defecto en `.update()`, así
-- que el UPDATE completo del webhook fallaba en silencio en cada pago real de
-- MercadoPago (ningún pago llegaba a activarse) — mismo patrón de bug que
-- `trial_ends_at` (sesión 68), reintroducido con otra columna al escribir
-- `plan`/`plan_id` juntos. Encontrado al probar el fix de planes nuevos.

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS mercadopago_subscription_id TEXT;
