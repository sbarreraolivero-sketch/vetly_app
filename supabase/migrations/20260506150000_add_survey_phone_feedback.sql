-- =============================================
-- MIGRATION: Extend satisfaction_surveys for button-based response tracking
-- Adds phone_number so we can look up open surveys by phone when a button reply arrives.
-- Adds feedback_context to store the full free-text follow-up from the client.
-- =============================================

ALTER TABLE public.satisfaction_surveys
  ADD COLUMN IF NOT EXISTS phone_number TEXT,
  ADD COLUMN IF NOT EXISTS feedback_context TEXT; -- Free text follow-up after a bad rating

-- Index for fast lookup by phone (so the webhook can find an open survey quickly)
CREATE INDEX IF NOT EXISTS idx_surveys_phone ON public.satisfaction_surveys(phone_number);

COMMENT ON COLUMN public.satisfaction_surveys.phone_number IS 'Phone number of the tutor, used to match incoming button replies to the correct open survey.';
COMMENT ON COLUMN public.satisfaction_surveys.feedback_context IS 'Free-text follow-up message from client after a negative rating (1-3 stars). Captured by the AI.';
