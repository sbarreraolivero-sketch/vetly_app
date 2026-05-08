-- Restauración de columnas de recordatorios en tabla appointments
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'appointments' AND column_name = 'reminder_sent') THEN
        ALTER TABLE public.appointments ADD COLUMN reminder_sent BOOLEAN DEFAULT false;
    END IF;

    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'appointments' AND column_name = 'reminder_sent_at') THEN
        ALTER TABLE public.appointments ADD COLUMN reminder_sent_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'appointments' AND column_name = 'confirmation_received') THEN
        ALTER TABLE public.appointments ADD COLUMN confirmation_received BOOLEAN DEFAULT false;
    END IF;
END $$;
