ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS booking_source TEXT NOT NULL DEFAULT 'manual'
  CHECK (booking_source IN ('manual', 'ai_agent'));

COMMENT ON COLUMN public.appointments.booking_source IS
  'How the appointment was created: manual (staff/UI) or ai_agent (WhatsApp AI webhook). Historical rows default to manual — no retroactive backfill.';

CREATE INDEX IF NOT EXISTS idx_appointments_clinic_booking_source_created
  ON public.appointments (clinic_id, booking_source, created_at);
