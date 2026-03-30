
-- =============================================================
-- VETLY AI: GLOBAL SCHEMA RESTORE & TUTORS/PATIENTS MODULE
-- Use this script if tables are missing or to update to the new model.
-- =============================================================

-- 1. Ensure extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Create/Update tutors (formerly patients)
CREATE TABLE IF NOT EXISTS public.tutors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id UUID REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
    phone_number TEXT NOT NULL,
    name TEXT,
    email TEXT,
    notes TEXT,
    total_appointments INTEGER DEFAULT 0,
    last_appointment_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(clinic_id, phone_number)
);

-- 3. Create patients (Pets)
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

-- 4. Tagging System for Tutors
CREATE TABLE IF NOT EXISTS public.tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id UUID REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#3B82F6',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tutor_tags (
    tutor_id UUID REFERENCES public.tutors(id) ON DELETE CASCADE,
    tag_id UUID REFERENCES public.tags(id) ON DELETE CASCADE,
    PRIMARY KEY (tutor_id, tag_id)
);

-- 5. Update Appointments
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS tutor_id UUID REFERENCES public.tutors(id) ON DELETE SET NULL;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS pet_id UUID REFERENCES public.patients(id) ON DELETE SET NULL;

-- 6. Clinical Submodules
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

-- 7. Functions & Triggers
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_tutors_updated_at ON public.tutors;
CREATE TRIGGER update_tutors_updated_at BEFORE UPDATE ON public.tutors FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS update_patients_updated_at ON public.patients;
CREATE TRIGGER update_patients_updated_at BEFORE UPDATE ON public.patients FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- RPC: get_tag_counts (Updated)
CREATE OR REPLACE FUNCTION public.get_tag_counts(p_clinic_id UUID)
RETURNS TABLE (tag_name TEXT, tag_color TEXT, contact_count BIGINT) AS $$
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
    SELECT name, MAX(color), COUNT(DISTINCT contact_id)::BIGINT FROM all_tags GROUP BY name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: get_unified_contacts (Updated)
CREATE OR REPLACE FUNCTION public.get_unified_contacts(p_clinic_id UUID)
RETURNS TABLE (id UUID, name TEXT, phone_number TEXT, email TEXT, type TEXT, created_at TIMESTAMPTZ, tags JSONB) AS $$
BEGIN
    RETURN QUERY
    SELECT p.id, p.name, p.phone_number, p.email, 'tutor', p.created_at,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color)) FROM public.tutor_tags pt JOIN public.tags t ON pt.tag_id = t.id WHERE pt.tutor_id = p.id), '[]'::jsonb)
    FROM public.tutors p WHERE p.clinic_id = p_clinic_id
    UNION ALL
    SELECT pr.id, pr.name, pr.phone, pr.email, 'prospect', pr.created_at,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color)) FROM public.crm_prospect_tags cpt JOIN public.crm_tags t ON cpt.tag_id = t.id WHERE cpt.prospect_id = pr.id), '[]'::jsonb)
    FROM public.crm_prospects pr WHERE pr.clinic_id = p_clinic_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. RLS
ALTER TABLE public.tutors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tutor_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medical_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vaccinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dewormings ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    DROP POLICY IF EXISTS "Tutors access" ON public.tutors;
    DROP POLICY IF EXISTS "Patients access" ON public.patients;
    DROP POLICY IF EXISTS "Clinical access" ON public.clinical_records;
    DROP POLICY IF EXISTS "Medical access" ON public.medical_history;
    DROP POLICY IF EXISTS "Vaccine access" ON public.vaccinations;
    DROP POLICY IF EXISTS "Deworming access" ON public.dewormings;
END $$;

CREATE POLICY "Tutors access" ON public.tutors FOR ALL USING (auth.role() IN ('authenticated', 'service_role'));
CREATE POLICY "Patients access" ON public.patients FOR ALL USING (auth.role() IN ('authenticated', 'service_role'));
CREATE POLICY "Clinical access" ON public.clinical_records FOR ALL USING (auth.role() IN ('authenticated', 'service_role'));
CREATE POLICY "Medical access" ON public.medical_history FOR ALL USING (auth.role() IN ('authenticated', 'service_role'));
CREATE POLICY "Vaccine access" ON public.vaccinations FOR ALL USING (auth.role() IN ('authenticated', 'service_role'));
CREATE POLICY "Deworming access" ON public.dewormings FOR ALL USING (auth.role() IN ('authenticated', 'service_role'));
