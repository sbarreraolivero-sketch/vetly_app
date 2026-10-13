-- Los contactos pausados (requires_human = true) se reactivan solos a las 24 h.
ALTER TABLE public.crm_prospects ADD COLUMN IF NOT EXISTS requires_human_since timestamptz;
ALTER TABLE public.tutors        ADD COLUMN IF NOT EXISTS requires_human_since timestamptz;

CREATE OR REPLACE FUNCTION public.track_requires_human_since()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.requires_human IS TRUE THEN
    IF TG_OP = 'INSERT' OR OLD.requires_human IS NOT TRUE THEN
      NEW.requires_human_since := COALESCE(NEW.requires_human_since, now());
    END IF;
  ELSE
    NEW.requires_human_since := NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.track_requires_human_since() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tr_requires_human_since ON public.crm_prospects;
CREATE TRIGGER tr_requires_human_since BEFORE INSERT OR UPDATE ON public.crm_prospects
  FOR EACH ROW EXECUTE FUNCTION public.track_requires_human_since();
DROP TRIGGER IF EXISTS tr_requires_human_since ON public.tutors;
CREATE TRIGGER tr_requires_human_since BEFORE INSERT OR UPDATE ON public.tutors
  FOR EACH ROW EXECUTE FUNCTION public.track_requires_human_since();

UPDATE public.crm_prospects SET requires_human_since = updated_at WHERE requires_human IS TRUE AND requires_human_since IS NULL;
UPDATE public.tutors        SET requires_human_since = updated_at WHERE requires_human IS TRUE AND requires_human_since IS NULL;

CREATE OR REPLACE FUNCTION public.auto_reactivate_paused_contacts()
RETURNS void LANGUAGE sql SET search_path = public AS $$
  UPDATE public.crm_prospects SET requires_human = false WHERE requires_human IS TRUE AND requires_human_since < now() - interval '24 hours';
  UPDATE public.tutors        SET requires_human = false WHERE requires_human IS TRUE AND requires_human_since < now() - interval '24 hours';
$$;
REVOKE ALL ON FUNCTION public.auto_reactivate_paused_contacts() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('auto-reactivate-paused-contacts', '*/30 * * * *', 'SELECT public.auto_reactivate_paused_contacts()');
