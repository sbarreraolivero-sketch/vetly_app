-- Continuación de la migración anterior: is_clinic_member() e
-- is_platform_admin() son los helpers de RLS más usados en todo el proyecto
-- (decenas de políticas), y tampoco tenían EXECUTE para anon. Mismo
-- razonamiento: ambos solo comparan auth.uid() -- NULL para anon -- así que
-- siempre devuelven false, sin ningún cambio de comportamiento real. Sin
-- este grant, CUALQUIER policy de CUALQUIER tabla que dependa (directa o
-- indirectamente, vía subconsulta a otra tabla) de estos dos helpers revienta
-- con "permission denied" apenas algo intente evaluarla como anon -- no solo
-- el flujo de reservas públicas.
GRANT EXECUTE ON FUNCTION public.is_clinic_member(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO anon;
