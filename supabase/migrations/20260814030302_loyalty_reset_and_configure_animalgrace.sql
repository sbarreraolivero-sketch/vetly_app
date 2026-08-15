-- ============================================================================
-- Motor de fidelización — parte 4: reset de saldos y configuración
--
-- Los 8.600 pts existentes se otorgaron por un mecanismo que ya no existe (bono
-- de bienvenida a cualquier cliente que completara su primera cita, sin relación
-- con referidos). Nunca se comunicaron a los clientes. El programa arranca en 0
-- con las reglas nuevas, por decisión explícita del usuario.
-- ============================================================================

-- Respaldo antes de borrar (patrón incomes_services_backup, sesión 69).
CREATE TABLE IF NOT EXISTS public.loyalty_transactions_backup AS
    SELECT *, NOW() AS backed_up_at, 'pre_reset_2026_08_13'::TEXT AS label
    FROM public.loyalty_transactions WHERE false;

INSERT INTO public.loyalty_transactions_backup
    SELECT *, NOW(), 'pre_reset_2026_08_13' FROM public.loyalty_transactions;

CREATE TABLE IF NOT EXISTS public.tutors_loyalty_backup (
    tutor_id       UUID,
    clinic_id      UUID,
    name           TEXT,
    loyalty_points INTEGER,
    referral_count INTEGER,
    backed_up_at   TIMESTAMPTZ DEFAULT NOW(),
    label          TEXT
);

INSERT INTO public.tutors_loyalty_backup (tutor_id, clinic_id, name, loyalty_points, referral_count, label)
    SELECT id, clinic_id, name, loyalty_points, referral_count, 'pre_reset_2026_08_13'
    FROM public.tutors
    WHERE COALESCE(loyalty_points, 0) <> 0 OR COALESCE(referral_count, 0) <> 0;

ALTER TABLE public.loyalty_transactions_backup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tutors_loyalty_backup       ENABLE ROW LEVEL SECURITY;

-- Reset
DELETE FROM public.loyalty_transactions;

UPDATE public.tutors
SET loyalty_points = 0,
    referral_count = 0,
    last_loyalty_update = NOW()
WHERE COALESCE(loyalty_points, 0) <> 0 OR COALESCE(referral_count, 0) <> 0;

-- ── Configuración del programa en ambas sucursales de AnimalGrace ──────────
--   Recompra    : 5% del monto pagado, desde la 2ª venta
--   Bienvenida  : 15% de la primera compra, SOLO para clientes referidos
--   Referidor   : $5.000 cuando su recomendado hace su primera compra
UPDATE public.clinic_settings
SET loyalty_enabled            = true,
    loyalty_program_mode       = 'money',
    loyalty_points_name        = 'Pesos AnimalGrace',
    loyalty_currency_symbol    = '$',
    loyalty_points_percentage  = 5,
    loyalty_welcome_bonus      = 15,
    loyalty_welcome_bonus_type = 'percentage',
    loyalty_referral_bonus     = 5000
WHERE id IN (
    'fd11b7e4-7d96-461c-a292-2caa5e2592ce',  -- AnimalGrace Linares/Talca
    '13472ea4-4da6-461c-9a80-a5c970d9ec73'   -- Animal Grace Santiago
);
