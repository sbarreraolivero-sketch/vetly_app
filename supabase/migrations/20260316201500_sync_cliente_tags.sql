-- =============================================
-- Automated "Cliente" Tag Synchronization (v2)
-- Syncs 'Cliente [Service]' and 'Cliente Frecuente' tags based on appointment history
-- Handles robust linking and missing service data
-- =============================================

-- Function to ensure a tag exists and return its ID
CREATE OR REPLACE FUNCTION public.get_or_create_tag(
    p_clinic_id UUID,
    p_tag_name TEXT,
    p_color TEXT DEFAULT '#10B981'
) RETURNS UUID AS $$
DECLARE
    v_tag_id UUID;
BEGIN
    SELECT id INTO v_tag_id FROM public.tags 
    WHERE clinic_id = p_clinic_id AND name = p_tag_name 
    LIMIT 1;

    IF v_tag_id IS NULL THEN
        INSERT INTO public.tags (clinic_id, name, color)
        VALUES (p_clinic_id, p_tag_name, p_color)
        RETURNING id INTO v_tag_id;
    END IF;

    RETURN v_tag_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper for manual backfill / robust sync
CREATE OR REPLACE FUNCTION public.sync_patient_cliente_tags_manual(
    p_patient_id UUID,
    p_clinic_id UUID,
    p_service_id UUID
) RETURNS VOID AS $$
DECLARE
    v_service_name TEXT;
    v_tag_name TEXT;
    v_tag_id UUID;
    v_appt_count INT;
BEGIN
    -- 1. Get Service Name (Handle NULL)
    IF p_service_id IS NOT NULL THEN
        SELECT name INTO v_service_name FROM public.services WHERE id = p_service_id;
    END IF;
    
    -- 2. Map name or use default
    IF v_service_name IS NULL THEN
        v_tag_name := 'Cliente';
    ELSIF v_service_name ILIKE '%Microblading%' THEN 
        v_tag_name := 'Cliente Microblading';
    ELSIF v_service_name ILIKE '%labios%' THEN 
        v_tag_name := 'Cliente Labios';
    ELSIF v_service_name ILIKE '%Ojos%' THEN 
        v_tag_name := 'Cliente Ojos';
    ELSE 
        -- Use service name part or just "Cliente"
        v_tag_name := 'Cliente ' || COALESCE(split_part(v_service_name, ' ', 1), '');
        -- Cleanup if it ends in space
        v_tag_name := TRIM(v_tag_name);
    END IF;

    -- 3. Ensure Tag Exists and Link it
    IF v_tag_name IS NOT NULL AND v_tag_name != '' THEN
        v_tag_id := public.get_or_create_tag(p_clinic_id, v_tag_name, '#10B981');
        INSERT INTO public.patient_tags (patient_id, tag_id) 
        VALUES (p_patient_id, v_tag_id) 
        ON CONFLICT DO NOTHING;

        -- 3.b Remove "Prospect" tags now that they are a client
        -- Includes tags starting with "Interés" or exactly "Prospecto" / "Prospect"
        DELETE FROM public.patient_tags pt
        USING public.tags t
        WHERE pt.tag_id = t.id
        AND pt.patient_id = p_patient_id
        AND (
            t.name ILIKE 'Interés %' OR 
            t.name ILIKE 'Prospecto' OR 
            t.name ILIKE 'Prospect'
        );
    END IF;

    -- 4. Cliente Frecuente
    SELECT COUNT(*) INTO v_appt_count 
    FROM public.appointments 
    WHERE patient_id = p_patient_id 
    AND status IN ('confirmed', 'completed');

    IF v_appt_count >= 2 THEN
        v_tag_id := public.get_or_create_tag(p_clinic_id, 'Cliente Frecuente', '#10B981');
        INSERT INTO public.patient_tags (patient_id, tag_id) 
        VALUES (p_patient_id, v_tag_id) 
        ON CONFLICT DO NOTHING;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Main sync trigger function
CREATE OR REPLACE FUNCTION public.sync_patient_cliente_tags()
RETURNS TRIGGER AS $$
BEGIN
    IF (NEW.status IN ('confirmed', 'completed')) AND NEW.patient_id IS NOT NULL THEN
        PERFORM public.sync_patient_cliente_tags_manual(NEW.patient_id, NEW.clinic_id, NEW.service_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create Trigger
DROP TRIGGER IF EXISTS trigger_sync_cliente_tags ON public.appointments;
CREATE TRIGGER trigger_sync_cliente_tags
AFTER INSERT OR UPDATE OF status ON public.appointments
FOR EACH ROW
EXECUTE FUNCTION public.sync_patient_cliente_tags();

-- Re-sync everything phase
DO $$
DECLARE
    r RECORD;
BEGIN
    -- 1. Linking phase: Link appointments to patients if missing but phone matches
    UPDATE public.appointments a
    SET patient_id = p.id
    FROM public.patients p
    WHERE a.patient_id IS NULL
    AND regexp_replace(a.phone_number, '\D', '', 'g') = regexp_replace(p.phone_number, '\D', '', 'g')
    AND a.clinic_id = p.clinic_id;

    -- 2. Tagging phase
    FOR r IN 
        SELECT DISTINCT patient_id, clinic_id, service_id 
        FROM public.appointments 
        WHERE status IN ('confirmed', 'completed') AND patient_id IS NOT NULL
    LOOP
        PERFORM public.sync_patient_cliente_tags_manual(r.patient_id, r.clinic_id, r.service_id);
    END LOOP;
END;
$$;
