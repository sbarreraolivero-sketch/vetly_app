-- Teléfono/WhatsApp del dueño de la cuenta, capturado en el registro.
-- Distinto de clinic_settings.contact_phone (número público que la IA entrega
-- a los pacientes de esa clínica) — este es el contacto de la persona que
-- creó la cuenta, para que Vetly pueda invitarla a agendar su llamada de
-- activación por WhatsApp.
ALTER TABLE public.user_profiles
    ADD COLUMN IF NOT EXISTS phone TEXT;

COMMENT ON COLUMN public.user_profiles.phone IS
    'WhatsApp/teléfono del dueño de la cuenta, capturado en el registro. Solo dígitos (sin +, sin espacios), mismo criterio que appointments.phone_number.';
