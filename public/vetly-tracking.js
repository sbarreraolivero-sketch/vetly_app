/* ══════════════════════════════════════════════════════════════════════════
   vetly-tracking.js — capa única de medición de Vetly
   ══════════════════════════════════════════════════════════════════════════

   Este archivo lo cargan TODAS las puertas de entrada del sitio:
     · index.html         (la SPA de React: /register, /app, /precios, …)
     · public/landing.html (/)
     · public/core.html    (/core)

   ⚠️ ORDEN DE CARGA — NO CAMBIAR.
   Debe ir SÍNCRONO (sin async ni defer) y ANTES del <script> de gtag.js.
   Consent Mode v2 exige que el comando `consent default` entre a dataLayer
   antes que cualquier `config`. gtag.js procesa dataLayer en orden, así que
   basta con que este archivo se ejecute primero — pero si se le pone async
   o se mueve debajo del tag, el default deja de aplicar y se envían cookies
   sin consentimiento.

   Qué hace, en orden:
     1. Consent Mode v2 con todo en `denied` por defecto.
     2. Captura gclid / wbraid / gbraid / UTMs y los persiste 90 días.
     3. Configura GA4 (si hay Measurement ID) y expone helpers.
     4. Pinta el banner de cookies.

   Expone en window:
     window.vetlyAttribution()   → objeto con la atribución guardada
     window.vetlyTrackDemo()     → conversión "Demo" (Ads + GA4)
     window.vetlyConsentState()  → 'granted' | 'denied' | null (sin decidir)
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    /* ─────────────────────────── CONFIGURACIÓN ─────────────────────────── */

    var ADS_ID = 'AW-18395838136';

    // ⚠️ PENDIENTE MANUAL: pegar acá el Measurement ID de GA4 (formato G-XXXXXXXXXX).
    // Se crea en analytics.google.com → Admin → Crear propiedad → Flujo de datos web.
    // Mientras diga 'G-XXXXXXXXXX' el código NO configura GA4 (no rompe nada, solo
    // no mide). Es el ÚNICO lugar del repo donde hay que pegarlo.
    var GA4_ID = 'G-XXXXXXXXXX';

    // ⚠️ PENDIENTE MANUAL: label de la acción de conversión "Demo" de Google Ads.
    // Verificado el 2026-08-20 contra la cuenta 2149932315: sólo existe la acción
    // `Registro` (7724783448). La de Demo hay que crearla en la UI de Google Ads
    // (Objetivos → Conversiones → Nueva → Sitio web → Configuración manual).
    // Mientras esté vacío, vetlyTrackDemo() sólo manda el evento a GA4 — nunca
    // dispara un send_to inválido a Ads (que es lo que hacía el placeholder viejo
    // 'XXXXXXXXXXXXXXXXXXX': ruido que no registraba nada).
    var DEMO_CONVERSION_LABEL = '';

    // Modo de consentimiento:
    //   'strict'   → denied global hasta que el usuario acepte. Es lo más
    //                conservador y lo que está activo hoy.
    //   'eea_only' → denied sólo en EEA/UK/CH (donde la ley lo exige) y granted
    //                en el resto. Chile y México no exigen opt-in previo.
    //
    // ⚠️ DECISIÓN DE NEGOCIO PENDIENTE: 'strict' es legalmente irreprochable,
    // pero en Chile/México significa que todo usuario que ignore el banner se
    // mide sólo por modelado. Con el volumen objetivo del brief (20–45
    // conversiones/mes) esa pérdida de señal es material para el aprendizaje de
    // Smart Bidding. Cambiar a 'eea_only' es cambiar esta línea.
    var CONSENT_MODE = 'eea_only';

    var EEA_REGIONS = [
        'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
        'HU', 'IS', 'IE', 'IT', 'LV', 'LI', 'LT', 'LU', 'MT', 'NL', 'NO', 'PL',
        'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'GB', 'CH'
    ];

    var ATTRIBUTION_KEY = 'vetly_attribution';
    var CONSENT_KEY = 'vetly_consent';
    var ATTRIBUTION_TTL_DAYS = 90;
    var CONSENT_TTL_DAYS = 180;

    var CLICK_IDS = ['gclid', 'wbraid', 'gbraid', 'msclkid', 'fbclid'];
    var UTMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

    /* ──────────────────────── 1. CONSENT MODE v2 ───────────────────────── */

    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    window.gtag = window.gtag || gtag;

    // Los 4 parámetros de Consent Mode v2. `ad_user_data` y `ad_personalization`
    // son los que Google agregó en la v2 y sin ellos las audiencias y el modelado
    // dejan de funcionar en EEA.
    var DENIED = {
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
        analytics_storage: 'denied',
        functionality_storage: 'granted',
        security_storage: 'granted'
    };
    var GRANTED = {
        ad_storage: 'granted',
        ad_user_data: 'granted',
        ad_personalization: 'granted',
        analytics_storage: 'granted',
        functionality_storage: 'granted',
        security_storage: 'granted'
    };

    if (CONSENT_MODE === 'eea_only') {
        var eeaDefault = {};
        for (var k in DENIED) { if (Object.prototype.hasOwnProperty.call(DENIED, k)) eeaDefault[k] = DENIED[k]; }
        eeaDefault.region = EEA_REGIONS;
        gtag('consent', 'default', eeaDefault);
        gtag('consent', 'default', GRANTED);
    } else {
        gtag('consent', 'default', DENIED);
    }

    // Con el consentimiento denegado, estas dos banderas son las que salvan la
    // medición: `url_passthrough` propaga el gclid por la URL entre páginas
    // (sin cookie) y `ads_data_redaction` limita los datos enviados. Sin ellas
    // el modelado de conversiones de Google no tiene con qué trabajar.
    gtag('set', 'url_passthrough', true);
    gtag('set', 'ads_data_redaction', true);

    /* ────────────────────────── utilidades ─────────────────────────────── */

    function setCookie(name, value, days) {
        try {
            var exp = new Date(Date.now() + days * 864e5).toUTCString();
            var secure = location.protocol === 'https:' ? '; Secure' : '';
            document.cookie = name + '=' + encodeURIComponent(value) +
                '; expires=' + exp + '; path=/; SameSite=Lax' + secure;
        } catch (e) { /* cookies bloqueadas */ }
    }

    function getCookie(name) {
        try {
            var m = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
            return m ? decodeURIComponent(m[2]) : null;
        } catch (e) { return null; }
    }

    // Cookie y localStorage se escriben en paralelo a propósito: ninguno de los
    // dos es fiable solo. La cookie sobrevive a un borrado de localStorage por
    // ITP/extensiones; localStorage sobrevive a un bloqueo de cookies de terceros
    // mal configurado. Al leer se prefiere la cookie y se cae al otro.
    function readStore(key) {
        var raw = getCookie(key);
        if (!raw) { try { raw = localStorage.getItem(key); } catch (e) { raw = null; } }
        if (!raw) return null;
        try { return JSON.parse(raw); } catch (e) { return null; }
    }

    function writeStore(key, obj, days) {
        var raw;
        try { raw = JSON.stringify(obj); } catch (e) { return; }
        setCookie(key, raw, days);
        try { localStorage.setItem(key, raw); } catch (e) { /* modo privado */ }
    }

    /* ───────────────── 2. CAPTURA DE gclid / wbraid / UTMs ─────────────── */

    function captureAttribution() {
        var params;
        try { params = new URLSearchParams(location.search); } catch (e) { return readStore(ATTRIBUTION_KEY); }

        var incoming = {};
        var hasTouch = false;

        CLICK_IDS.concat(UTMS).forEach(function (key) {
            var v = params.get(key);
            if (v) { incoming[key] = v.slice(0, 512); hasTouch = true; }
        });

        var stored = readStore(ATTRIBUTION_KEY);

        // Sin parámetros nuevos en la URL: se respeta lo ya guardado. Nunca se
        // pisa una atribución existente con vacío — ese es el error clásico que
        // borra el gclid al navegar de /core a /register.
        if (!hasTouch) return stored;

        // Con parámetros nuevos: gana el toque nuevo (last non-direct click), que
        // es el mismo modelo que usa Google Ads para atribuir. Se conserva
        // first_seen_at para poder auditar cuánto tarda el registro.
        var record = {
            gclid: incoming.gclid || null,
            wbraid: incoming.wbraid || null,
            gbraid: incoming.gbraid || null,
            msclkid: incoming.msclkid || null,
            fbclid: incoming.fbclid || null,
            utm_source: incoming.utm_source || null,
            utm_medium: incoming.utm_medium || null,
            utm_campaign: incoming.utm_campaign || null,
            utm_term: incoming.utm_term || null,
            utm_content: incoming.utm_content || null,
            landing_url: (location.origin + location.pathname + location.search).slice(0, 1024),
            referrer: (document.referrer || '').slice(0, 1024) || null,
            first_seen_at: (stored && stored.first_seen_at) || new Date().toISOString(),
            last_touch_at: new Date().toISOString()
        };

        writeStore(ATTRIBUTION_KEY, record, ATTRIBUTION_TTL_DAYS);
        return record;
    }

    var attribution = captureAttribution();

    window.vetlyAttribution = function () {
        return readStore(ATTRIBUTION_KEY) || attribution || null;
    };

    /* ─────────────────────── 3. GA4 + helpers de evento ────────────────── */

    gtag('js', new Date());
    gtag('config', ADS_ID);

    var GA4_CONFIGURED = /^G-[A-Z0-9]{6,}$/.test(GA4_ID) && GA4_ID !== 'G-XXXXXXXXXX';
    if (GA4_CONFIGURED) {
        gtag('config', GA4_ID, { send_page_view: true });
    }
    window.vetlyGa4Ready = GA4_CONFIGURED;

    window.vetlyTrackDemo = function () {
        if (DEMO_CONVERSION_LABEL) {
            window.gtag('event', 'conversion', {
                send_to: ADS_ID + '/' + DEMO_CONVERSION_LABEL,
                event_category: 'demo',
                event_label: 'landing_principal'
            });
        }
        if (GA4_CONFIGURED) {
            window.gtag('event', 'generate_lead', {
                lead_source: 'landing_principal',
                lead_type: 'demo'
            });
        }
    };

    /* ─────────────────────── 4. Banner de consentimiento ───────────────── */

    function applyConsent(state) {
        window.gtag('consent', 'update', state === 'granted' ? GRANTED : DENIED);
        if (state === 'granted') {
            window.gtag('set', 'ads_data_redaction', false);
        }
    }

    var savedConsent = readStore(CONSENT_KEY);
    window.vetlyConsentState = function () {
        var c = readStore(CONSENT_KEY);
        return c && c.state ? c.state : null;
    };

    if (savedConsent && savedConsent.state) {
        applyConsent(savedConsent.state);
    }

    function decide(state) {
        writeStore(CONSENT_KEY, { state: state, at: new Date().toISOString() }, CONSENT_TTL_DAYS);
        applyConsent(state);
        var el = document.getElementById('vetly-consent-banner');
        if (el && el.parentNode) el.parentNode.removeChild(el);
    }

    function renderBanner() {
        if (savedConsent && savedConsent.state) return;           // ya decidió
        if (document.getElementById('vetly-consent-banner')) return;
        if (!document.body) return;

        var bar = document.createElement('div');
        bar.id = 'vetly-consent-banner';
        bar.setAttribute('role', 'dialog');
        bar.setAttribute('aria-live', 'polite');
        bar.setAttribute('aria-label', 'Aviso de cookies');
        bar.style.cssText = [
            'position:fixed', 'left:0', 'right:0', 'bottom:0', 'z-index:2147483000',
            'background:#18181b', 'color:#fafafa', 'padding:16px',
            'font-family:Outfit,system-ui,-apple-system,sans-serif', 'font-size:14px',
            'line-height:1.5', 'box-shadow:0 -8px 24px rgba(0,0,0,.18)'
        ].join(';');

        var wrap = document.createElement('div');
        wrap.style.cssText = 'max-width:1100px;margin:0 auto;display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between';

        var text = document.createElement('p');
        text.style.cssText = 'margin:0;flex:1 1 320px;min-width:0';
        text.innerHTML = 'Usamos cookies para medir el rendimiento del sitio y de nuestras campañas. ' +
            'Puedes rechazarlas y seguir navegando con normalidad. ' +
            '<a href="/privacidad" style="color:#5eead4;text-decoration:underline">Política de privacidad</a>.';

        var actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:8px;flex:0 0 auto';

        function mkBtn(label, primary) {
            var b = document.createElement('button');
            b.type = 'button';
            b.textContent = label;
            b.style.cssText = [
                'cursor:pointer', 'border-radius:8px', 'padding:10px 18px',
                'font-weight:600', 'font-size:14px', 'font-family:inherit',
                primary ? 'background:#0d9488' : 'background:transparent',
                primary ? 'color:#fff' : 'color:#d4d4d8',
                primary ? 'border:1px solid #0d9488' : 'border:1px solid #52525b'
            ].join(';');
            return b;
        }

        var reject = mkBtn('Rechazar', false);
        var accept = mkBtn('Aceptar', true);
        reject.addEventListener('click', function () { decide('denied'); });
        accept.addEventListener('click', function () { decide('granted'); });

        actions.appendChild(reject);
        actions.appendChild(accept);
        wrap.appendChild(text);
        wrap.appendChild(actions);
        bar.appendChild(wrap);
        document.body.appendChild(bar);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', renderBanner);
    } else {
        renderBanner();
    }
})();
