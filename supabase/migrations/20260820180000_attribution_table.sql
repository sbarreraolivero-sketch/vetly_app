-- ═══════════════════════════════════════════════════════════════════════════
-- Tabla `attribution` — de qué clic vino cada registro
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Escrita por la edge function `signup-handler` (service_role) con lo que
-- `public/vetly-tracking.js` capturó en la landing y guardó en una cookie
-- first-party de 90 días.
--
-- Para qué existe: sin el `gclid` guardado junto al usuario es imposible hacer
-- la importación de conversiones offline a Google Ads, y por lo tanto es
-- imposible saber el CAC real por cliente PAGADO (no por registro de trial).
-- Hoy el trial de Core dura 30 días: el dato de si ese registro terminó pagando
-- llega mes y medio después del clic, mucho más tarde de lo que Google puede
-- atribuir solo.
--
-- Una fila por registro con señal publicitaria. Los registros directos/orgánicos
-- no generan fila (`signup-handler` los descarta antes de insertar).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.attribution (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    clinic_id       UUID REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
    plan            TEXT,

    -- Identificadores de clic. `gclid` es el estándar; `wbraid`/`gbraid` son los
    -- que Google usa cuando el usuario viene de iOS con seguimiento limitado y
    -- el gclid no puede generarse. Los tres son válidos para importación offline
    -- y hay que guardarlos por separado: la API de Google Ads los recibe en
    -- campos distintos.
    gclid           TEXT,
    wbraid          TEXT,
    gbraid          TEXT,
    msclkid         TEXT,   -- Microsoft Ads, por si se abre ese canal
    fbclid          TEXT,   -- Meta, ya hay campañas corriendo en ese canal

    utm_source      TEXT,
    utm_medium      TEXT,
    utm_campaign    TEXT,
    utm_term        TEXT,
    utm_content     TEXT,

    landing_url     TEXT,
    referrer        TEXT,
    country         TEXT,   -- header cf-ipcountry, no derivado del navegador

    first_touch_at  TIMESTAMPTZ,
    last_touch_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Marcas del job de importación de conversiones offline (T1.4 del brief).
    -- NULL = todavía no se subió a Google Ads. Se llenan cuando el registro
    -- convierte a pago y la conversión se sube con éxito.
    offline_conversion_name        TEXT,
    offline_conversion_uploaded_at TIMESTAMPTZ
);

-- Índice por gclid: es la clave de cruce con el reporte de Google Ads y con el
-- futuro job de importación offline. Parcial porque la mayoría de las filas de
-- otros canales lo tendrán en NULL.
CREATE INDEX IF NOT EXISTS attribution_gclid_idx
    ON public.attribution (gclid) WHERE gclid IS NOT NULL;

CREATE INDEX IF NOT EXISTS attribution_user_id_idx  ON public.attribution (user_id);
CREATE INDEX IF NOT EXISTS attribution_clinic_id_idx ON public.attribution (clinic_id);
CREATE INDEX IF NOT EXISTS attribution_created_at_idx ON public.attribution (created_at DESC);

-- Un registro no debería generar dos filas de atribución. Si `signup-handler`
-- se reintenta, la segunda inserción falla y queda en el console.warn no fatal.
CREATE UNIQUE INDEX IF NOT EXISTS attribution_user_unique_idx
    ON public.attribution (user_id) WHERE user_id IS NOT NULL;

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Esta tabla contiene datos de marketing de TODAS las clínicas juntas: es de
-- la plataforma, no de un cliente. Nadie que no sea platform admin la lee.
--
-- Sin política para `anon` ni para `authenticated` general: el patrón
-- `USING (auth.role() = 'authenticated')` que se limpió en la sesión 74 es
-- exactamente lo que NO hay que hacer acá — se combinan con OR y la más
-- abierta gana.
ALTER TABLE public.attribution ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS attribution_platform_admin_select ON public.attribution;
CREATE POLICY attribution_platform_admin_select ON public.attribution
    FOR SELECT TO authenticated
    USING (public.is_platform_admin());

DROP POLICY IF EXISTS attribution_service_role_all ON public.attribution;
CREATE POLICY attribution_service_role_all ON public.attribution
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

COMMENT ON TABLE public.attribution IS
    'Atribución publicitaria por registro. Escrita por signup-handler con lo capturado en la landing por public/vetly-tracking.js. Base de la importación de conversiones offline a Google Ads.';
