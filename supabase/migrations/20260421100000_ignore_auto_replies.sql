-- Update the auto-pause function to ignore AnimalGrace's automatic welcome message
CREATE OR REPLACE FUNCTION public.handle_manual_message_pause()
RETURNS TRIGGER AS $$
BEGIN
    -- 1. Ignore if it's AI generated
    IF (NEW.ai_generated = true) THEN
        RETURN NEW;
    END IF;

    -- 2. Ignore specific Welcome/Absence keywords from AnimalGrace official auto-replies
    -- This prevents Meta's automated "Away Messages" from silencing the AI
    IF (NEW.content ILIKE '%Gracias por escribirnos%' OR NEW.content ILIKE '%Somos Animal Grace%') THEN
        RETURN NEW;
    END IF;

    -- 3. If the message is OUTBOUND and NOT AI-generated, it's a real human interventoion
    IF (NEW.direction = 'outbound') THEN
        -- Pause the tutor
        UPDATE public.tutors 
        SET requires_human = true 
        WHERE clinic_id = NEW.clinic_id AND phone_number = NEW.phone_number;

        -- Pause the prospect (CRM)
        UPDATE public.crm_prospects 
        SET requires_human = true 
        WHERE clinic_id = NEW.clinic_id AND phone_number = NEW.phone_number;
        
        RAISE NOTICE 'AI Paused for patient % due to manual message: %', NEW.phone_number, LEFT(NEW.content, 20);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
