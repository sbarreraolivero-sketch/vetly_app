-- Secuencia de 3 correos (A/B/C) para la campaña de prospección de clínicas
-- veterinarias (ver hq-generate-prospect-email / cron-hq-prospecting-campaign).
--
-- A: catálogo con emojis (el correo original, ya existía).
-- B: personal/cálido, se manda >= 2 días después de A.
-- C: credibilidad de marketing (caso Animalgrace/Meta Ads), >= 2 días después de B.

ALTER TABLE public.prospecting_leads
    ADD COLUMN IF NOT EXISTS email_b_subject TEXT,
    ADD COLUMN IF NOT EXISTS email_b_body TEXT,
    ADD COLUMN IF NOT EXISTS email_b_sent_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS email_b_opened_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS resend_id_b TEXT,
    ADD COLUMN IF NOT EXISTS email_c_subject TEXT,
    ADD COLUMN IF NOT EXISTS email_c_body TEXT,
    ADD COLUMN IF NOT EXISTS email_c_sent_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS email_c_opened_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS resend_id_c TEXT;

-- contact_status (TEXT sin CHECK constraint) soporta además de los valores
-- originales: 'en_revision_b' | 'listo_para_enviar_b' | 'email_b_enviado' |
-- 'en_revision_c' | 'listo_para_enviar_c' | 'secuencia_completa'.
