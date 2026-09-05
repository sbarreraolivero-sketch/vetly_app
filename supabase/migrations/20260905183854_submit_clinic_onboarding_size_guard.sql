-- Endurece el RPC público: rechaza payloads desproporcionados (el formulario
-- real pesa < 50 KB y tiene ~70 campos). Evita que un atacante infle la tabla
-- con un único POST gigante.
CREATE OR REPLACE FUNCTION public.submit_clinic_onboarding(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'payload inválido';
  END IF;
  IF pg_column_size(p_payload) > 200000 THEN
    RAISE EXCEPTION 'payload demasiado grande';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_payload)) > 250 THEN
    RAISE EXCEPTION 'payload con demasiados campos';
  END IF;

  INSERT INTO public.clinic_onboarding (
    clinic_name, contact_name, contact_email, contact_phone, country, city, submission, source
  ) VALUES (
    LEFT(NULLIF(TRIM(p_payload->>'clinic_name'),''), 300),
    LEFT(NULLIF(TRIM(p_payload->>'contact_name'),''), 300),
    LEFT(NULLIF(TRIM(LOWER(p_payload->>'contact_email')),''), 300),
    LEFT(NULLIF(TRIM(p_payload->>'contact_phone'),''), 60),
    LEFT(NULLIF(TRIM(p_payload->>'country'),''), 100),
    LEFT(NULLIF(TRIM(p_payload->>'city'),''), 150),
    p_payload,
    COALESCE(LEFT(NULLIF(TRIM(p_payload->>'source'),''), 60),'alta-clinica')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
