-- Los signups de Core ya vienen de Chile, México, Colombia y Perú (sesión
-- 2026-08-25). Mostrar todo en "hora de Chile" sin más contexto confunde a
-- un cliente que no está en Chile. Este campo permite calcular y mostrar la
-- hora local real del cliente junto a la de Chile en la confirmación/recordatorio.
ALTER TABLE public.hq_appointments ADD COLUMN IF NOT EXISTS contact_country TEXT;
