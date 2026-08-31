-- Identidad profesional del miembro del equipo, para que aparezca en las
-- recetas médicas emitidas desde la ficha del paciente. Ambos campos son
-- OPCIONALES: la receta los imprime solo si están completos. En varios
-- países una receta veterinaria válida exige el nº de registro/matrícula
-- del profesional (cédula profesional en México, etc.).
--
-- Sin cambios de RLS: las policies de clinic_members son row-level, no
-- column-level, y el self-update de MyProfile.tsx ya funciona hoy con un
-- UPDATE directo. Sin cambios de RPC: get_clinic_members_secure hace
-- SELECT * (RETURNS SETOF clinic_members) y AuthContext carga `member` con
-- .select('*'), así que las columnas nuevas se propagan solas.

ALTER TABLE public.clinic_members
    ADD COLUMN IF NOT EXISTS professional_license TEXT,
    ADD COLUMN IF NOT EXISTS professional_title   TEXT;

COMMENT ON COLUMN public.clinic_members.professional_license IS
    'Nº de colegiatura / matrícula / cédula profesional. Opcional. Se imprime en recetas si está.';
COMMENT ON COLUMN public.clinic_members.professional_title IS
    'Título profesional (ej. Médico Veterinario). Opcional. Se imprime en recetas si está.';
