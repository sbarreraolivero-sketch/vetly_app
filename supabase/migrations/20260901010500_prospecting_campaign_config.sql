-- ════════════════════════════════════════════════════════════════════════════
-- Config de la campaña de prospección (rampa + pausa) — fila única
-- ════════════════════════════════════════════════════════════════════════════
--
-- `started_at` es la fecha desde la que se cuenta "semana 1 = 5/día, semana 2
-- = 10/día...". `is_paused` es la válvula de seguridad para frenar el cron
-- desde el panel sin tener que tocar código ni desactivar el job de pg_cron.

CREATE TABLE public.prospecting_campaign_config (
    id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),  -- fila única (singleton)
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    max_daily_cap INTEGER NOT NULL DEFAULT 50,
    is_paused BOOLEAN NOT NULL DEFAULT true,  -- arranca pausada a propósito — se activa
                                               -- explícitamente desde el panel cuando el
                                               -- usuario confirme que quiere que la cola
                                               -- empiece a enviar de verdad
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.prospecting_campaign_config (id) VALUES (true);

CREATE TRIGGER trg_prospecting_campaign_config_updated_at
    BEFORE UPDATE ON public.prospecting_campaign_config
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.prospecting_campaign_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_prospecting_campaign_config"
    ON public.prospecting_campaign_config FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.get_prospecting_campaign_config()
RETURNS public.prospecting_campaign_config
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE v_row public.prospecting_campaign_config;
BEGIN
    IF NOT public.is_platform_admin() THEN
        RAISE EXCEPTION 'Unauthorized: platform admin access required';
    END IF;
    SELECT * INTO v_row FROM public.prospecting_campaign_config WHERE id = true;
    RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_prospecting_campaign_paused(p_paused BOOLEAN)
RETURNS public.prospecting_campaign_config
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE v_row public.prospecting_campaign_config;
BEGIN
    IF NOT public.is_platform_admin() THEN
        RAISE EXCEPTION 'Unauthorized: platform admin access required';
    END IF;
    UPDATE public.prospecting_campaign_config SET is_paused = p_paused WHERE id = true
    RETURNING * INTO v_row;
    RETURN v_row;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_prospecting_campaign_config() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_prospecting_campaign_paused(BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_prospecting_campaign_config() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_prospecting_campaign_paused(BOOLEAN) TO authenticated, service_role;
