-- =============================================================
-- MIGRATION: Revenue Retention Engine™ — Action Generation RPC
-- =============================================================

CREATE OR REPLACE FUNCTION public.generate_retention_actions(p_clinic_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_protocol RECORD;
  v_patient RECORD;
  v_count INTEGER := 0;
  v_existing_action_count INTEGER;
  v_execution_mode TEXT;
  v_cool_off_days INTEGER := 30; -- Don't repeat same protocol for 30 days
BEGIN
  -- 1. Get default execution mode/plan from clinic (simplified check)
  -- ideally we check the subscription plan, but let's stick to protocol config for now.
  -- The protocol has 'execution_mode'.
  
  -- 2. Iterate over active protocols
  FOR v_protocol IN
    SELECT * FROM public.retention_protocols 
    WHERE clinic_id = p_clinic_id AND is_active = true
  LOOP
    
    -- 3. Find target patients
    FOR v_patient IN
      SELECT prs.patient_id, prs.score, prs.risk_level, prs.days_since_last_visit
      FROM public.patient_retention_scores prs
      WHERE prs.clinic_id = p_clinic_id
        AND prs.risk_level = v_protocol.risk_level_trigger -- 'medium' or 'high'
    LOOP
      
      -- 4. Check cool-off period
      -- Has this patient received this protocol recently?
      SELECT COUNT(*) INTO v_existing_action_count
      FROM public.ai_action_log
      WHERE clinic_id = p_clinic_id
        AND patient_id = v_patient.patient_id
        AND protocol_id = v_protocol.id
        AND created_at > (NOW() - (v_cool_off_days || ' days')::INTERVAL);
        
      IF v_existing_action_count = 0 THEN
        -- 5. Determine initial status
        -- If protocol is 'autonomous', we mark as 'approved' (ready for execution queue)
        -- If protocol is 'supervised', we mark as 'pending' (wait for user)
        -- For safety in V1, let's default 'autonomous' to 'approved' but not 'executed'
        
        INSERT INTO public.ai_action_log (
          clinic_id,
          patient_id,
          protocol_id,
          action_type,
          action_details,
          trigger_score,
          trigger_risk_level,
          execution_mode,
          status
        ) VALUES (
          p_clinic_id,
          v_patient.patient_id,
          v_protocol.id,
          'whatsapp_message', -- Hardcoded for V1, ideally comes from protocol actions
          v_protocol.actions,
          v_patient.score,
          v_patient.risk_level,
          v_protocol.execution_mode,
          CASE 
            WHEN v_protocol.execution_mode = 'autonomous' THEN 'approved'
            ELSE 'pending'
          END
        );
        
        v_count := v_count + 1;
      END IF;
      
    END LOOP;
  END LOOP;
  
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
