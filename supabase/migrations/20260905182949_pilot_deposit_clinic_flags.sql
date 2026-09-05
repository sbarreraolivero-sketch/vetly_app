-- Flags para el piloto de clínicas (alianza Yares). El checkout de US$47 solo
-- está disponible para clínicas marcadas pilot_eligible = true; el webhook
-- también lo re-verifica antes de provisionar.
ALTER TABLE public.clinic_settings
  ADD COLUMN IF NOT EXISTS pilot_eligible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pilot_activated_at timestamptz;

COMMENT ON COLUMN public.clinic_settings.pilot_eligible IS
  'true = clínica habilitada para el checkout de piloto de US$47 (alianza Yares). Lo setea HQ manualmente para cada clínica piloto confirmada.';
COMMENT ON COLUMN public.clinic_settings.pilot_activated_at IS
  'Fecha en que la clínica pagó el depósito de piloto y quedó provisionada. NULL = piloto no activado.';
