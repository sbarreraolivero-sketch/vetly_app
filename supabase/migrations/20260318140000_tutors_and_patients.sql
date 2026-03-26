
-- =============================================================
-- IDEMPOTENT MIGRATION: Tutors & Patients (Pets) Module
-- Use this script to safely set up the veterinary domain model.
-- =============================================================

DO $$ 
BEGIN
    -- 1. Rename patients to tutors if not already done
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'patients') 
       AND NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'tutors') THEN
        ALTER TABLE public.patients RENAME TO tutors;
    END IF;

    -- 2. Rename patient_tags to tutor_tags
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'patient_tags') 
       AND NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'tutor_tags') THEN
        ALTER TABLE public.patient_tags RENAME TO tutor_tags;
    END IF;

    -- 3. Rename columns in tutor_tags
    IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'tutor_tags' AND column_name = 'patient_id') THEN
        ALTER TABLE public.tutor_tags RENAME COLUMN patient_id TO tutor_id;
    END IF;

    -- 4. Update appointments table columns
    IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'appointments' AND column_name = 'patient_id') THEN
        ALTER TABLE public.appointments RENAME COLUMN patient_id TO tutor_id;
    END IF;

END $$;

-- 5. Add pet_id to appointments if missing
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS pet_id UUID;

-- 6. Create new patients (Pets) table
CREATE TABLE IF NOT EXISTS public.patients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id UUID REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
    tutor_id UUID REFERENCES public.tutors(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    species TEXT, 
    breed TEXT,
    color TEXT,
    sex TEXT CHECK (sex IN ('M', 'F', 'MN', 'FN')), 
    weight NUMERIC,
    weight_unit TEXT DEFAULT 'kg',
    dob DATE,
    is_sterilized BOOLEAN DEFAULT false,
    microchip_id TEXT,
    status TEXT DEFAULT 'alive' CHECK (status IN ('alive', 'deceased')),
    death_date DATE,
    death_reason TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Add FK to appointments (Safe to run multiple times if named)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_appointments_pet') THEN
        ALTER TABLE public.appointments 
            ADD CONSTRAINT fk_appointments_pet 
            FOREIGN KEY (pet_id) 
            REFERENCES public.patients(id) 
            ON DELETE SET NULL;
    END IF;
END $$;

-- 8. Create Clinical Submodules
CREATE TABLE IF NOT EXISTS public.clinical_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID REFERENCES public.patients(id) ON DELETE CASCADE,
    general_notes TEXT,
    chronic_conditions TEXT,
    allergies TEXT,
    ongoing_treatments TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(patient_id)
);

CREATE TABLE IF NOT EXISTS public.medical_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID REFERENCES public.patients(id) ON DELETE CASCADE,
    event_date TIMESTAMPTZ DEFAULT NOW(),
    event_type TEXT, 
    diagnosis TEXT,
    procedure_notes TEXT,
    veterinarian_id UUID, 
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.vaccinations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID REFERENCES public.patients(id) ON DELETE CASCADE,
    vaccine_name TEXT NOT NULL,
    application_date DATE DEFAULT CURRENT_DATE,
    next_due_date DATE,
    lot_number TEXT,
    veterinarian_name TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.dewormings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID REFERENCES public.patients(id) ON DELETE CASCADE,
    product_name TEXT NOT NULL,
    application_date DATE DEFAULT CURRENT_DATE,
    frequency_days INTEGER,
    next_due_date DATE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Triggers for updated_at on new tables
DROP TRIGGER IF EXISTS update_patients_updated_at ON public.patients;
CREATE TRIGGER update_patients_updated_at
  BEFORE UPDATE ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS update_clinical_records_updated_at ON public.clinical_records;
CREATE TRIGGER update_clinical_records_updated_at
  BEFORE UPDATE ON public.clinical_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 10. Update RPC functions (REPLACE is safe)
CREATE OR REPLACE FUNCTION public.get_tag_counts(p_clinic_id UUID)
RETURNS TABLE (
    tag_name TEXT,
    tag_color TEXT,
    contact_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    WITH all_tags AS (
        (SELECT t.name, t.color, pt.tutor_id as contact_id
         FROM public.tags t
         JOIN public.tutor_tags pt ON t.id = pt.tag_id
         WHERE t.clinic_id = p_clinic_id)
        UNION ALL
        (SELECT ct.name, ct.color, cpt.prospect_id as contact_id
         FROM public.crm_tags ct
         JOIN public.crm_prospect_tags cpt ON ct.id = cpt.tag_id
         WHERE ct.clinic_id = p_clinic_id)
    )
    SELECT 
        name as tag_name,
        MAX(color) as tag_color,
        COUNT(DISTINCT contact_id)::BIGINT as contact_count
    FROM all_tags
    GROUP BY name
    ORDER BY contact_count DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_unified_contacts(p_clinic_id UUID)
RETURNS TABLE (
    id UUID,
    name TEXT,
    phone_number TEXT,
    email TEXT,
    type TEXT, 
    created_at TIMESTAMPTZ,
    tags JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id,
        p.name,
        p.phone_number,
        p.email,
        'tutor' as type,
        p.created_at,
        COALESCE(
            (SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color))
             FROM public.tutor_tags pt
             JOIN public.tags t ON pt.tag_id = t.id
             WHERE pt.tutor_id = p.id),
            '[]'::jsonb
        ) as tags
    FROM public.tutors p
    WHERE p.clinic_id = p_clinic_id

    UNION ALL

    SELECT 
        pr.id,
        pr.name,
        pr.phone as phone_number,
        pr.email,
        'prospect' as type,
        pr.created_at,
        COALESCE(
            (SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color))
             FROM public.crm_prospect_tags cpt
             JOIN public.crm_tags t ON cpt.tag_id = t.id
             WHERE cpt.prospect_id = pr.id),
            '[]'::jsonb
        ) as tags
    FROM public.crm_prospects pr
    WHERE pr.clinic_id = p_clinic_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 11. Fix existing triggers to point to tutors
CREATE OR REPLACE FUNCTION public.auto_link_appointment_patient()
RETURNS TRIGGER AS $$
DECLARE
  v_tutor_id UUID;
BEGIN
  IF NEW.tutor_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_tutor_id
  FROM public.tutors
  WHERE phone_number = NEW.phone_number
    AND clinic_id = NEW.clinic_id;

  IF v_tutor_id IS NULL THEN
    INSERT INTO public.tutors (clinic_id, phone_number, name)
    VALUES (NEW.clinic_id, NEW.phone_number, NEW.patient_name)
    ON CONFLICT (phone_number) DO UPDATE SET name = EXCLUDED.name
    WHERE EXCLUDED.clinic_id = tutors.clinic_id
    RETURNING id INTO v_tutor_id;
  END IF;

  NEW.tutor_id := v_tutor_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.update_patient_stats()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.tutors p
  SET
    total_appointments = (
      SELECT COUNT(*)
      FROM public.appointments
      WHERE tutor_id = COALESCE(NEW.tutor_id, OLD.tutor_id)
        AND status NOT IN ('cancelled')
    ),
    last_appointment_at = (
      SELECT MAX(appointment_date)
      FROM public.appointments
      WHERE tutor_id = COALESCE(NEW.tutor_id, OLD.tutor_id)
        AND status NOT IN ('cancelled')
    ),
    updated_at = NOW()
  WHERE id = COALESCE(NEW.tutor_id, OLD.tutor_id);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 12. RLS (Policies with IF NOT EXISTS logic via temporary drops/recreates is safer in migrations)
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medical_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vaccinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dewormings ENABLE ROW LEVEL SECURITY;

-- Service role access
DROP POLICY IF EXISTS "Service role full access to patients" ON public.patients;
CREATE POLICY "Service role full access to patients" ON public.patients FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access to clinical_records" ON public.clinical_records;
CREATE POLICY "Service role full access to clinical_records" ON public.clinical_records FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access to medical_history" ON public.medical_history;
CREATE POLICY "Service role full access to medical_history" ON public.medical_history FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access to vaccinations" ON public.vaccinations;
CREATE POLICY "Service role full access to vaccinations" ON public.vaccinations FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access to dewormings" ON public.dewormings;
CREATE POLICY "Service role full access to dewormings" ON public.dewormings FOR ALL USING (auth.role() = 'service_role');

-- Authenticated access
DROP POLICY IF EXISTS "Authenticated users can manage patients" ON public.patients;
CREATE POLICY "Authenticated users can manage patients" ON public.patients FOR ALL USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can manage clinical records" ON public.clinical_records;
CREATE POLICY "Authenticated users can manage clinical records" ON public.clinical_records FOR ALL USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can manage medical history" ON public.medical_history;
CREATE POLICY "Authenticated users can manage medical history" ON public.medical_history FOR ALL USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can manage vaccinations" ON public.vaccinations;
CREATE POLICY "Authenticated users can manage vaccinations" ON public.vaccinations FOR ALL USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can manage dewormings" ON public.dewormings;
CREATE POLICY "Authenticated users can manage dewormings" ON public.dewormings FOR ALL USING (auth.role() = 'authenticated');
