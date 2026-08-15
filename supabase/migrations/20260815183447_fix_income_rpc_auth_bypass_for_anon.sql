-- Las 3 RPCs de ingresos/fidelización saltaban su control de acceso cuando
-- auth.uid() era NULL, con la intención de permitir llamadas de service_role.
-- Pero auth.uid() también es NULL para el rol `anon`, así que cualquiera con la
-- clave pública (embebida en el bundle de vetly.pro) podía crear, modificar o
-- recalcular ingresos de CUALQUIER clínica sin autenticarse. Verificado creando
-- un ingreso real con la anon key antes de aplicar este fix.
--
-- Mismo patrón que el bug de close_cash_register (sesión 43): un "escape" para
-- llamadas internas que en la práctica abre la puerta a usuarios no autenticados.
--
-- Se distingue el rol de verdad: solo service_role (o una conexión directa, que
-- ya es superusuario) salta el chequeo; anon y authenticated deben acreditar
-- membresía activa en la clínica.
DO $$
DECLARE
    r RECORD;
    v_def TEXT;
BEGIN
    FOR r IN
        SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prosecdef
          AND p.proname IN ('create_clinic_income','update_clinic_income','sync_income_loyalty')
          AND pg_get_functiondef(p.oid) LIKE '%auth.uid() IS NOT NULL AND NOT EXISTS%'
    LOOP
        v_def := replace(
            pg_get_functiondef(r.oid),
            'auth.uid() IS NOT NULL AND NOT EXISTS',
            'COALESCE(auth.role(), ''service_role'') <> ''service_role'' AND NOT EXISTS'
        );
        EXECUTE v_def;
    END LOOP;
END $$;
