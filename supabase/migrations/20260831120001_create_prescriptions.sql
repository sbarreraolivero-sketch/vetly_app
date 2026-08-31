-- ============================================================================
-- Recetas / fórmulas médicas
--
-- Hasta ahora no existía ninguna función de prescripción: lo más cercano era
-- el textarea libre medical_history.procedure_notes ("Tratamiento y Evolución").
-- Esta tabla guarda recetas ESTRUCTURADAS (filas de medicamento en `items`
-- JSONB) emitidas desde la ficha del paciente. Cada receta se puede ver e
-- imprimir en /receta/:public_token (página pública, sin login, patrón del
-- carnet /p/:code) y enviarse por WhatsApp/correo como enlace a esa página.
--
-- SNAPSHOTS: prescriber_*, patient_snapshot, patient_weight, tutor_name y
-- diagnosis se congelan al emitir — un documento médico-legal no puede mutar
-- si el vet edita su perfil o si el paciente cambia de nombre/peso después.
-- El encabezado de la clínica (nombre/dirección/logo/colores/redes) NO se
-- snapshotea: se resuelve en vivo al ver la receta.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.prescriptions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id             UUID NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
    patient_id            UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    medical_history_id    UUID REFERENCES public.medical_history(id) ON DELETE SET NULL,
    prescriber_member_id  UUID REFERENCES public.clinic_members(id) ON DELETE SET NULL,
    prescriber_name       TEXT,
    prescriber_license    TEXT,
    prescriber_title      TEXT,
    issued_date           DATE NOT NULL DEFAULT CURRENT_DATE,
    patient_snapshot      JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {name,species,breed,sex,dob,microchip_id,weight,weight_unit}
    patient_weight        NUMERIC,
    tutor_name            TEXT,
    diagnosis             TEXT,
    items                 JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{drug,presentation,dose,route,frequency,duration,quantity,instructions}]
    general_instructions  TEXT,   -- lo ve el tutor, se imprime
    notes                 TEXT,   -- interno, NO se imprime ni sale en la RPC pública
    folio                 TEXT,   -- nullable, sin correlativo automático en v1
    -- Identificador no adivinable para la URL pública. hex sobre 16 bytes =
    -- 128 bits, URL-safe sin transformar. extensions.gen_random_bytes con
    -- schema explícito (bug de search_path documentado en la migración
    -- 20260817010000).
    public_token          TEXT NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(16), 'hex'),
    created_by            UUID,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prescriptions_patient_issued
    ON public.prescriptions (patient_id, issued_date DESC);
CREATE INDEX IF NOT EXISTS idx_prescriptions_clinic
    ON public.prescriptions (clinic_id);

ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;

-- Mismo helper que medical_history / reminders (migración de aislamiento core
-- 20260815195824). is_clinic_member es SECURITY DEFINER — no recursa sobre la
-- RLS de clinic_members — y devuelve TRUE para platform admins (soporte puede
-- ver las fichas, consistente con medical_history).
DROP POLICY IF EXISTS prescriptions_members ON public.prescriptions;
CREATE POLICY prescriptions_members ON public.prescriptions
    FOR ALL TO authenticated
    USING (public.is_clinic_member(clinic_id))
    WITH CHECK (public.is_clinic_member(clinic_id));

DROP POLICY IF EXISTS prescriptions_service_role ON public.prescriptions;
CREATE POLICY prescriptions_service_role ON public.prescriptions
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- public.set_updated_at() ya existe (20260529000001_inventory_system.sql).
DROP TRIGGER IF EXISTS tr_prescriptions_updated_at ON public.prescriptions;
CREATE TRIGGER tr_prescriptions_updated_at
    BEFORE UPDATE ON public.prescriptions
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.prescriptions TO authenticated;
