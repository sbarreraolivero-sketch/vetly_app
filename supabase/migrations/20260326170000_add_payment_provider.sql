-- Migration: Add payment_provider to clinic_settings
-- Tracks which payment gateway the clinic uses (mercadopago for Chile, lemonsqueezy for international)

ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS payment_provider TEXT DEFAULT 'mercadopago';
COMMENT ON COLUMN clinic_settings.payment_provider IS 'Payment provider: mercadopago (CLP) or lemonsqueezy (USD)';

-- Also store LemonSqueezy customer ID for future reference
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS lemonsqueezy_customer_id TEXT;
