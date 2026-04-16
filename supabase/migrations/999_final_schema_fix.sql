
-- FIX FOR TUTORS TABLE AND RPC
-- 1. Ensure columns exist in tutors table
DO $$ 
BEGIN
    -- Rename phone to phone_number if it exists
    IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'tutors' AND column_name = 'phone') THEN
        ALTER TABLE public.tutors RENAME COLUMN phone TO phone_number;
    END IF;

    -- Add address if it doesn't exist
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'tutors' AND column_name = 'address') THEN
        ALTER TABLE public.tutors ADD COLUMN address TEXT;
    END IF;

    -- Add loyalty columns if they don't exist
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'tutors' AND column_name = 'loyalty_points') THEN
        ALTER TABLE public.tutors ADD COLUMN loyalty_points INTEGER DEFAULT 0;
    END IF;

    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'tutors' AND column_name = 'notes') THEN
        ALTER TABLE public.tutors ADD COLUMN notes TEXT;
    END IF;
END $$;

-- 2. Update RPC to return ALL necessary columns for both Tutors and Prospects
CREATE OR REPLACE FUNCTION public.get_unified_contacts(p_clinic_id UUID)
RETURNS TABLE (
    id UUID, 
    name TEXT, 
    phone_number TEXT, 
    email TEXT, 
    address TEXT,
    notes TEXT,
    total_appointments INTEGER,
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
        p.address,
        p.notes,
        COALESCE(p.total_appointments, 0),
        'tutor'::TEXT as type, 
        p.created_at,
        COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color)) 
            FROM public.tutor_tags pt 
            JOIN public.tags t ON pt.tag_id = t.id 
            WHERE pt.tutor_id = p.id
        ), '[]'::jsonb) as tags
    FROM public.tutors p 
    WHERE p.clinic_id = p_clinic_id
    
    UNION ALL
    
    SELECT 
        pr.id, 
        pr.name, 
        pr.phone as phone_number, 
        pr.email, 
        pr.address,
        pr.notes,
        0 as total_appointments,
        'prospect'::TEXT as type, 
        pr.created_at,
        COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color)) 
            FROM public.crm_prospect_tags cpt 
            JOIN public.crm_tags t ON cpt.tag_id = t.id 
            WHERE cpt.prospect_id = pr.id
        ), '[]'::jsonb) as tags
    FROM public.crm_prospects pr 
    WHERE pr.clinic_id = p_clinic_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
