-- Atomic increments for AI credit usage
CREATE OR REPLACE FUNCTION increment_clinic_mini_usage(p_clinic_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE clinic_settings
    SET ai_credits_monthly_mini_used = COALESCE(ai_credits_monthly_mini_used, 0) + 1
    WHERE id = p_clinic_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION increment_clinic_4o_usage(p_clinic_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE clinic_settings
    SET ai_credits_monthly_4o_used = COALESCE(ai_credits_monthly_4o_used, 0) + 1
    WHERE id = p_clinic_id;
END;
$$ LANGUAGE plpgsql;
