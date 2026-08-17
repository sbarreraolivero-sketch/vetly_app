-- Migration: add_onboarding_call_prompted_at
-- Registra cuándo se le mostró a una clínica el CTA de agendar su llamada
-- de bienvenida (Andrés) tras su primera conversión trial → plan pago.
-- Se marca una sola vez desde el frontend (Settings.tsx) al detectar
-- ?payment=success proveniente de una conversión real (no renovaciones/upgrades).

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS onboarding_call_prompted_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN public.subscriptions.onboarding_call_prompted_at IS
  'Timestamp de cuándo se mostró el banner de agendar llamada de bienvenida tras la primera conversión de pago. NULL = aún no se le mostró (o no aplica).';
