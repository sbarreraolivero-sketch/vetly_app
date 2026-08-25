-- Respaldo antes de tocar configuración (mismo patrón que las tablas
-- *_backup ya usadas en el proyecto para cambios de fidelización/prompts).
CREATE TABLE IF NOT EXISTS public.clinic_settings_loyalty_backup (
    id                          UUID,
    loyalty_enabled             BOOLEAN,
    loyalty_program_mode        TEXT,
    loyalty_points_name         TEXT,
    loyalty_currency_symbol     TEXT,
    loyalty_points_percentage   NUMERIC,
    loyalty_welcome_bonus       INTEGER,
    loyalty_welcome_bonus_type  TEXT,
    loyalty_referral_bonus      INTEGER,
    loyalty_referral_bonus_type TEXT,
    backed_up_at                TIMESTAMPTZ,
    label                       TEXT
);

ALTER TABLE public.clinic_settings_loyalty_backup ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'clinic_settings_loyalty_backup' AND policyname = 'service_role_all'
    ) THEN
        CREATE POLICY service_role_all ON public.clinic_settings_loyalty_backup
            FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

INSERT INTO public.clinic_settings_loyalty_backup
    SELECT id, loyalty_enabled, loyalty_program_mode, loyalty_points_name,
           loyalty_currency_symbol, loyalty_points_percentage,
           loyalty_welcome_bonus, loyalty_welcome_bonus_type,
           loyalty_referral_bonus, loyalty_referral_bonus_type,
           NOW(), 'pre_recommended_preset_2026_08_25'
    FROM public.clinic_settings;

-- Backfill: SOLO clínicas que quedaron exactamente en los valores crudos de
-- default (nunca configuradas a mano). Verificado en vivo el 2026-08-25 antes
-- de aplicar: AnimalGrace ×2 y "Veterinaria Los Robles" (de prueba, confirmado
-- por el usuario) ya tienen 15% / $5.000 fijo / 5% configurado deliberadamente
-- — el WHERE de abajo las excluye a propósito, no se tocan.
--
-- loyalty_enabled pasa a false: estas filas lo tenían en true por el default
-- crudo de columna, sin que nadie lo haya encendido a propósito — entre ellas,
-- los 4 leads reales de la campaña de Facebook, que hoy estaban pagando bonos
-- fijos en pesos chilenos sin saberlo.
UPDATE public.clinic_settings
SET loyalty_enabled              = false,
    loyalty_welcome_bonus        = 15,
    loyalty_welcome_bonus_type   = 'percentage',
    loyalty_referral_bonus       = 10,
    loyalty_referral_bonus_type = 'percentage',
    loyalty_points_percentage   = 5
WHERE loyalty_welcome_bonus        = 200
  AND loyalty_welcome_bonus_type   = 'fixed'
  AND loyalty_referral_bonus       = 500
  AND loyalty_referral_bonus_type  = 'fixed'
  AND loyalty_points_percentage    = 5.0;
