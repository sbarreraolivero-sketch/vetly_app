-- Índices de cobertura para las consultas más frecuentes del frontend.
-- Detectados con get_advisors(performance): FKs sin índice + filtros de páginas de alto tráfico.
-- Tablas hoy pequeñas (cientos a pocos miles de filas) → CREATE INDEX es instantáneo, sin CONCURRENTLY.

-- Ficha del paciente (PatientProfile: 4 consultas por patient_id)
CREATE INDEX IF NOT EXISTS idx_medical_history_patient_id ON public.medical_history (patient_id);
CREATE INDEX IF NOT EXISTS idx_vaccines_patient_id        ON public.vaccines (patient_id);
CREATE INDEX IF NOT EXISTS idx_deworming_patient_id       ON public.deworming (patient_id);

-- Listado de Pacientes (filtra por clinic_id) y Finanzas/getIncomes (clinic_id + rango de fecha)
CREATE INDEX IF NOT EXISTS idx_patients_clinic_id  ON public.patients (clinic_id);
CREATE INDEX IF NOT EXISTS idx_incomes_clinic_date ON public.incomes (clinic_id, date);

-- Historial financiero del tutor (TutorDetails: appointments + incomes por tutor_id, fallback por patient_id)
CREATE INDEX IF NOT EXISTS idx_appointments_tutor_id   ON public.appointments (tutor_id)  WHERE tutor_id  IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_appointments_patient_id ON public.appointments (patient_id) WHERE patient_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_incomes_tutor_id        ON public.incomes (tutor_id)       WHERE tutor_id  IS NOT NULL;

-- Detalle de ítems por cita (TutorDetails + Finanzas expanden appointment_items por appointment_id)
CREATE INDEX IF NOT EXISTS idx_appointment_items_appointment_id ON public.appointment_items (appointment_id);
