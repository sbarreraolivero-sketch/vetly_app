
-- Function to increment patient appointment count safely
CREATE OR REPLACE FUNCTION public.increment_patient_appointments(p_patient_id UUID, p_last_appointment TIMESTAMPTZ)
RETURNS VOID AS $$
BEGIN
  UPDATE public.patients
  SET 
    total_appointments = COALESCE(total_appointments, 0) + 1,
    last_appointment_at = p_last_appointment
  WHERE id = p_patient_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
