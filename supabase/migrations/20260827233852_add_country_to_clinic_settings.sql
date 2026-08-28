-- El registro (Register.tsx) ahora pide el país explícitamente y lo usa para
-- resolver currency/timezone (ver supabase/functions/_shared/countries.ts) --
-- antes ambos nacían siempre en los DEFAULT de columna (CLP /
-- America/Mexico_City) sin importar dónde estuviera la clínica real.
--
-- Nullable y sin default a propósito: distingue una clínica que sí eligió
-- país (post este cambio) de una que nació antes (NULL), sin inventar un
-- valor que no se puede confirmar.
ALTER TABLE public.clinic_settings ADD COLUMN IF NOT EXISTS country TEXT;

COMMENT ON COLUMN public.clinic_settings.country IS
    'ISO-3166-1 alpha-2, elegido en el registro. Ver src/lib/countries.ts. NULL = clínica creada antes de este campo.';
