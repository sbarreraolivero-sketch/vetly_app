-- Duración variable por regla de estética (talla / pelaje / peso / raza).
-- Antes, grooming_price_rules solo variaba el PRECIO — la duración del servicio
-- era fija para todos los tamaños. Ahora cada regla puede llevar su propia
-- duración; si es NULL, se usa la duración base del servicio.

ALTER TABLE public.grooming_price_rules
    ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;

COMMENT ON COLUMN public.grooming_price_rules.duration_minutes IS
    'Duración de la sesión para esta combinación de talla/pelaje/raza. NULL = usa clinic_services.duration.';

-- replace_grooming_price_rules: ahora persiste también duration_minutes.
CREATE OR REPLACE FUNCTION public.replace_grooming_price_rules(p_service_id uuid, p_rules jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_clinic UUID;
BEGIN
    SELECT clinic_id INTO v_clinic FROM public.clinic_services WHERE id = p_service_id;
    IF v_clinic IS NULL THEN RAISE EXCEPTION 'Servicio no encontrado'; END IF;
    IF COALESCE(auth.role(), 'service_role') <> 'service_role' AND NOT public.is_clinic_member(v_clinic) THEN RAISE EXCEPTION 'Acceso denegado'; END IF;
    DELETE FROM public.grooming_price_rules WHERE service_id = p_service_id;
    INSERT INTO public.grooming_price_rules (clinic_id, service_id, size_category, coat_type, weight_min, weight_max, breed, price, duration_minutes)
    SELECT v_clinic, p_service_id, NULLIF(r->>'size_category',''), NULLIF(r->>'coat_type',''),
        (r->>'weight_min')::numeric, (r->>'weight_max')::numeric, NULLIF(r->>'breed',''), (r->>'price')::numeric,
        NULLIF(r->>'duration_minutes','')::integer
    FROM jsonb_array_elements(p_rules) AS r
    WHERE (r->>'price') IS NOT NULL AND (r->>'price') <> '';
END;
$function$;

-- Resuelve precio + duración de la regla más específica que coincida.
-- Devuelve {"price": <n|null>, "duration_minutes": <n|null>}.
CREATE OR REPLACE FUNCTION public.grooming_rule_resolve(
    p_service_id uuid,
    p_size text DEFAULT NULL,
    p_coat text DEFAULT NULL,
    p_weight numeric DEFAULT NULL,
    p_breed text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_clinic UUID; v_price NUMERIC; v_dur INTEGER;
BEGIN
    SELECT clinic_id INTO v_clinic FROM public.clinic_services WHERE id = p_service_id;
    IF v_clinic IS NULL THEN RETURN jsonb_build_object('price', NULL, 'duration_minutes', NULL); END IF;
    IF COALESCE(auth.role(), 'service_role') <> 'service_role' AND NOT public.is_clinic_member(v_clinic) THEN RAISE EXCEPTION 'Acceso denegado'; END IF;

    SELECT r.price, r.duration_minutes INTO v_price, v_dur
    FROM public.grooming_price_rules r
    WHERE r.service_id = p_service_id
      AND (r.breed IS NULL OR (p_breed IS NOT NULL AND lower(r.breed) = lower(p_breed)))
      AND (r.size_category IS NULL OR r.size_category = p_size)
      AND (r.coat_type IS NULL OR r.coat_type = p_coat)
      AND (r.weight_min IS NULL OR (p_weight IS NOT NULL AND p_weight >= r.weight_min))
      AND (r.weight_max IS NULL OR (p_weight IS NOT NULL AND p_weight <= r.weight_max))
    ORDER BY (r.breed IS NOT NULL) DESC, (r.size_category IS NOT NULL) DESC, (r.coat_type IS NOT NULL) DESC,
        (r.weight_min IS NOT NULL OR r.weight_max IS NOT NULL) DESC, r.created_at ASC
    LIMIT 1;

    RETURN jsonb_build_object('price', v_price, 'duration_minutes', v_dur);
END;
$function$;

REVOKE ALL ON FUNCTION public.grooming_rule_resolve(uuid, text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grooming_rule_resolve(uuid, text, text, numeric, text) TO authenticated, service_role;
