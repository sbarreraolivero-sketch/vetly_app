-- Fix: subir el logo de la clínica fallaba siempre con
-- "new row violates row-level security policy", pese a que el usuario sí
-- era miembro activo de la clínica y el path era correcto.
--
-- Causa raíz: las 3 políticas originales de `clinic-branding` estaban
-- creadas con `TO authenticated`. El servicio de Storage no las evaluaba
-- bajo ese rol, así que el INSERT nunca encontraba una policy aplicable.
-- Verificado por contraste: `expense-receipts` y `patient-documents` --
-- los dos buckets que sí funcionaban -- usan `TO public` con una sola
-- policy FOR ALL, y con esa misma forma la subida pasa de inmediato.
--
-- Se descartaron por prueba directa otras hipótesis: la lógica de la
-- policy era correcta (un INSERT manual con el JWT del usuario sí pasaba
-- dentro de una transacción SQL), el usuario tenía su fila activa en
-- clinic_members, y el path resolvía al clinic_id correcto.
--
-- `public` no debilita el aislamiento acá: el filtro real sigue siendo la
-- pertenencia a `clinic_members` vía auth.uid(), que para un visitante
-- anónimo es NULL y por lo tanto nunca hace match.

DROP POLICY IF EXISTS "clinic_branding_members_write" ON storage.objects;
DROP POLICY IF EXISTS "clinic_branding_members_update" ON storage.objects;
DROP POLICY IF EXISTS "clinic_branding_members_delete" ON storage.objects;
DROP POLICY IF EXISTS "clinic_members_clinic_branding_all" ON storage.objects;

CREATE POLICY "clinic_members_clinic_branding_all" ON storage.objects
FOR ALL TO public
USING (
  (bucket_id = 'clinic-branding') AND
  ((storage.foldername(name))[1] IN (
    SELECT (cm.clinic_id)::text FROM clinic_members cm
    WHERE cm.user_id = auth.uid() AND cm.status = 'active'
  ))
)
WITH CHECK (
  (bucket_id = 'clinic-branding') AND
  ((storage.foldername(name))[1] IN (
    SELECT (cm.clinic_id)::text FROM clinic_members cm
    WHERE cm.user_id = auth.uid() AND cm.status = 'active'
  ))
);
