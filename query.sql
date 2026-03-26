SELECT id, patient_name, appointment_date, created_at, clinic_id FROM appointments WHERE patient_name ILIKE '%Prueba%' ORDER BY created_at DESC LIMIT 5;
