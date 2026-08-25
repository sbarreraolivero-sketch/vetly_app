-- Formaliza como migración las columnas de clinic_settings que ya existen en
-- producción pero nunca se trackearon (sin archivo de migración ni comentario
-- de columna). Verificado contra information_schema.columns antes de escribir
-- este DDL — mismos defaults observados en vivo, nada nuevo se introduce.
ALTER TABLE public.clinic_settings
    ADD COLUMN IF NOT EXISTS loyalty_enabled          BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS loyalty_program_mode      TEXT    DEFAULT 'points',
    ADD COLUMN IF NOT EXISTS loyalty_points_name       TEXT    DEFAULT 'Puntos',
    ADD COLUMN IF NOT EXISTS loyalty_currency_symbol   TEXT    DEFAULT 'pts',
    ADD COLUMN IF NOT EXISTS loyalty_points_percentage NUMERIC DEFAULT 5.0,
    ADD COLUMN IF NOT EXISTS loyalty_welcome_bonus     INTEGER DEFAULT 200,
    ADD COLUMN IF NOT EXISTS loyalty_referral_bonus    INTEGER DEFAULT 500;

COMMENT ON COLUMN public.clinic_settings.loyalty_program_mode IS
    'DEPRECATED (simplificación 2026-08-25): cosmético, el motor sync_income_loyalty nunca lo lee. Se conserva sin uso por compatibilidad — no leer ni escribir desde código nuevo.';
COMMENT ON COLUMN public.clinic_settings.loyalty_currency_symbol IS
    'DEPRECATED (simplificación 2026-08-25): usar clinic_settings.currency + un mapa de símbolos en el frontend en su lugar.';
COMMENT ON COLUMN public.clinic_settings.loyalty_enabled IS
    'Interruptor maestro del programa de fidelización. Default false para clínicas nuevas desde la sesión de simplificación 2026-08-25 (antes el default crudo de columna era true, lo que activaba el programa sin que nadie lo encendiera a propósito).';
