-- Fix: Set working_hours in clinic_settings for AnimalGrace Linares
-- This is required by get_professional_available_slots RPC which checks BOTH
-- clinic_members.working_hours AND clinic_settings.working_hours

UPDATE public.clinic_settings
SET working_hours = '{
  "monday":    {"start": "10:00", "end": "18:30", "enabled": true,  "lunch_break": {"start": "14:00", "end": "15:00", "enabled": false}},
  "tuesday":   {"start": "10:00", "end": "18:30", "enabled": true,  "lunch_break": {"start": "14:00", "end": "15:00", "enabled": false}},
  "wednesday": {"start": "10:00", "end": "18:30", "enabled": true,  "lunch_break": {"start": "14:00", "end": "15:00", "enabled": false}},
  "thursday":  {"start": "10:00", "end": "18:30", "enabled": true,  "lunch_break": {"start": "14:00", "end": "15:00", "enabled": false}},
  "friday":    {"start": "10:00", "end": "18:30", "enabled": true,  "lunch_break": {"start": "14:00", "end": "15:00", "enabled": false}},
  "saturday":  {"start": "09:00", "end": "13:00", "enabled": false, "lunch_break": {"start": "14:00", "end": "15:00", "enabled": false}},
  "sunday":    {"start": "09:00", "end": "13:00", "enabled": false, "lunch_break": {"start": "14:00", "end": "15:00", "enabled": false}}
}'::jsonb
WHERE id = '4213322a-69a0-4e0b-9215-bc4033c15ef4';
