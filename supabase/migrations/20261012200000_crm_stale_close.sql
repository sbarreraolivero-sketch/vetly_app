-- Cierre por inactividad (60 días sin escribir) y protección contra recierre de quien volvió a hablar.
-- La reapertura (Cerrado -> primera etapa) la hace el webhook al recibir un mensaje entrante.
CREATE OR REPLACE FUNCTION public.auto_close_crm_prospects()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    -- (a) Clientes atendidos, sin cita futura, sin solicitud abierta y sin escribir en los últimos 3 días
    UPDATE public.crm_prospects cp
    SET stage_id = cl.id, updated_at = NOW()
    FROM (SELECT DISTINCT ON (s.clinic_id) s.clinic_id, s.id FROM public.crm_pipeline_stages s
          WHERE s.name ILIKE '%cerrado%' ORDER BY s.clinic_id, s.position DESC) cl
    WHERE cl.clinic_id = cp.clinic_id AND cp.stage_id IS DISTINCT FROM cl.id
      AND length(public.phone_digits(cp.phone)) >= 7
      AND EXISTS (SELECT 1 FROM public.appointments a WHERE a.clinic_id = cp.clinic_id
                  AND public.phone_digits(a.phone_number) = public.phone_digits(cp.phone) AND a.status = 'completed')
      AND NOT EXISTS (SELECT 1 FROM public.appointments a WHERE a.clinic_id = cp.clinic_id
                  AND public.phone_digits(a.phone_number) = public.phone_digits(cp.phone)
                  AND a.status IN ('pending','confirmed') AND a.appointment_date >= NOW())
      AND NOT EXISTS (SELECT 1 FROM public.scheduling_requests sr WHERE sr.clinic_id = cp.clinic_id
                  AND public.phone_digits(sr.tutor_phone) = public.phone_digits(cp.phone) AND sr.status IN ('pending','authorized'))
      AND NOT EXISTS (SELECT 1 FROM public.messages m WHERE m.clinic_id = cp.clinic_id
                  AND m.phone_number IN (public.phone_digits(cp.phone), '+' || public.phone_digits(cp.phone))
                  AND m.direction = 'inbound' AND m.created_at > NOW() - INTERVAL '3 days');

    -- (b) "Cita agendada" con la cita ya pasada y sin otra por delante
    UPDATE public.crm_prospects cp
    SET stage_id = cl.id, updated_at = NOW()
    FROM (SELECT DISTINCT ON (s.clinic_id) s.clinic_id, s.id FROM public.crm_pipeline_stages s
          WHERE s.name ILIKE '%cerrado%' ORDER BY s.clinic_id, s.position DESC) cl
    WHERE cl.clinic_id = cp.clinic_id
      AND cp.stage_id IN (SELECT id FROM public.crm_pipeline_stages WHERE name ILIKE '%cita%')
      AND EXISTS (SELECT 1 FROM public.appointments a WHERE a.clinic_id = cp.clinic_id
                  AND public.phone_digits(a.phone_number) = public.phone_digits(cp.phone)
                  AND a.appointment_date < NOW() AND a.status <> 'cancelled')
      AND NOT EXISTS (SELECT 1 FROM public.appointments a WHERE a.clinic_id = cp.clinic_id
                  AND public.phone_digits(a.phone_number) = public.phone_digits(cp.phone)
                  AND a.status IN ('pending','confirmed') AND a.appointment_date >= NOW());

    -- (c) Inactividad: sin mensajes entrantes en 60 días (y sin cita futura ni solicitud abierta)
    UPDATE public.crm_prospects cp
    SET stage_id = cl.id, updated_at = NOW()
    FROM (SELECT DISTINCT ON (s.clinic_id) s.clinic_id, s.id FROM public.crm_pipeline_stages s
          WHERE s.name ILIKE '%cerrado%' ORDER BY s.clinic_id, s.position DESC) cl
    WHERE cl.clinic_id = cp.clinic_id AND cp.stage_id IS DISTINCT FROM cl.id
      AND cp.created_at < NOW() - INTERVAL '60 days'
      AND length(public.phone_digits(cp.phone)) >= 7
      AND NOT EXISTS (SELECT 1 FROM public.messages m WHERE m.clinic_id = cp.clinic_id
                  AND m.phone_number IN (public.phone_digits(cp.phone), '+' || public.phone_digits(cp.phone))
                  AND m.direction = 'inbound' AND m.created_at > NOW() - INTERVAL '60 days')
      AND NOT EXISTS (SELECT 1 FROM public.appointments a WHERE a.clinic_id = cp.clinic_id
                  AND public.phone_digits(a.phone_number) = public.phone_digits(cp.phone)
                  AND a.status IN ('pending','confirmed') AND a.appointment_date >= NOW())
      AND NOT EXISTS (SELECT 1 FROM public.scheduling_requests sr WHERE sr.clinic_id = cp.clinic_id
                  AND public.phone_digits(sr.tutor_phone) = public.phone_digits(cp.phone) AND sr.status IN ('pending','authorized'));
END;
$$;
REVOKE ALL ON FUNCTION public.auto_close_crm_prospects() FROM PUBLIC, anon, authenticated;
