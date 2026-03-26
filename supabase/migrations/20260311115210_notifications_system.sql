-- =============================================
-- NOTIFICATIONS SYSTEM
-- Creates notification tables and configures triggers
-- =============================================

-- 1. Create notification_preferences table if not exists (has a fk to clinic_settings)
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID REFERENCES public.clinic_settings(id) ON DELETE CASCADE UNIQUE NOT NULL,
  
  -- Preferences
  new_appointment BOOLEAN DEFAULT true,
  confirmed BOOLEAN DEFAULT true,
  cancelled BOOLEAN DEFAULT true,
  pending_reminder BOOLEAN DEFAULT true,
  new_message BOOLEAN DEFAULT true,
  survey_response BOOLEAN DEFAULT true,
  
  -- AI
  ai_handoff BOOLEAN DEFAULT true,
  
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Safely add the ai_handoff column in case the table already existed and didn't have it
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'notification_preferences'
          AND column_name = 'ai_handoff'
    ) THEN
        ALTER TABLE public.notification_preferences ADD COLUMN ai_handoff BOOLEAN DEFAULT true;
    END IF;
END $$;


-- 2. Create notifications table if not exists
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  
  type TEXT NOT NULL, -- e.g. new_appointment, confirmed_appointment, cancelled_appointment, human_handoff
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  
  is_read BOOLEAN DEFAULT false,
  link TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- 3. Enable RLS
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- 4. Policies
-- Policies for preferences 
DO $$ BEGIN
    CREATE POLICY "Allow authenticated users to read their clinic preferences" 
      ON public.notification_preferences FOR SELECT 
      USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE POLICY "Allow authenticated users to update their clinic preferences" 
      ON public.notification_preferences FOR UPDATE 
      USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE POLICY "Allow authenticated users to insert their clinic preferences" 
      ON public.notification_preferences FOR INSERT 
      WITH CHECK (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN null; END $$;


-- Policies for notifications
DO $$ BEGIN
    CREATE POLICY "Allow authenticated users to read notifications" 
      ON public.notifications FOR SELECT 
      USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE POLICY "Allow authenticated users to update notifications (mark as read)" 
      ON public.notifications FOR UPDATE 
      USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Service role access
DO $$ BEGIN
    CREATE POLICY "Service Role Full Access notifications" 
      ON public.notifications FOR ALL 
      USING (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN null; END $$;


-- =============================================
-- TRIGGERS
-- =============================================

-- Create the trigger function for appointments
CREATE OR REPLACE FUNCTION public.handle_appointment_notifications()
RETURNS TRIGGER AS $$
DECLARE
    prefs RECORD;
    notif_title TEXT;
    notif_msg TEXT;
    notif_type TEXT;
    should_notify BOOLEAN := false;
BEGIN
    -- Only process for non-service_role inserts/updates/changes to avoid notification loops or spam if needed,
    -- but usually appointments are created by patients via AI (service_role) or admins. We want to notify in both cases.
    
    -- Fetch the clinic notification preferences
    -- If no preferences found, assume true (default)
    SELECT * INTO prefs FROM public.notification_preferences WHERE clinic_id = NEW.clinic_id LIMIT 1;
    
    -- Case 1: New Appointment
    IF TG_OP = 'INSERT' THEN
        notif_type := 'new_appointment';
        notif_title := 'Nueva Cita';
        notif_msg := 'Se ha agendado una cita para ' || NEW.patient_name || ' (' || COALESCE(NEW.service, 'consulta') || ').';
        
        -- Check preferences
        IF prefs IS NULL OR COALESCE(prefs.new_appointment, true) THEN
            should_notify := true;
        END IF;

    -- Case 2: Status Update
    ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
        
        IF NEW.status = 'confirmed' THEN
            notif_type := 'confirmed_appointment';
            notif_title := 'Cita Confirmada';
            notif_msg := 'La cita de ' || NEW.patient_name || ' ha sido confirmada.';
            IF prefs IS NULL OR COALESCE(prefs.confirmed, true) THEN
                should_notify := true;
            END IF;
            
        ELSIF NEW.status = 'cancelled' THEN
            notif_type := 'cancelled_appointment';
            notif_title := 'Cita Cancelada';
            notif_msg := 'La cita de ' || NEW.patient_name || ' ha sido cancelada.';
            IF prefs IS NULL OR COALESCE(prefs.cancelled, true) THEN
                should_notify := true;
            END IF;
        END IF;
    END IF;

    -- Insert notification if applicable
    IF should_notify THEN
        INSERT INTO public.notifications (clinic_id, type, title, message, link)
        VALUES (NEW.clinic_id, notif_type, notif_title, notif_msg, '/appointments');
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Drop trigger if exists to recreate it
DROP TRIGGER IF EXISTS trigger_appointment_notifications ON public.appointments;

-- Create the trigger on appointments
CREATE TRIGGER trigger_appointment_notifications
AFTER INSERT OR UPDATE OF status
ON public.appointments
FOR EACH ROW
EXECUTE FUNCTION public.handle_appointment_notifications();
