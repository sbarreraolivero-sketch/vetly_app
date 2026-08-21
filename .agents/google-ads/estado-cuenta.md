# Estado de cuenta y tracking — Vetly Google Ads

**Última verificación: 2026-08-20.** Este documento manda sobre `brief-core.md`. Si al empezar una
sesión esta fecha tiene más de dos semanas, reverifica antes de decidir nada.

---

## Cuenta

| Campo | Valor |
|---|---|
| Nombre | `Vetly` |
| Customer ID | `2149932315` |
| Acceso | MCP `google-ads-mcp` (Pipeboard), cuenta `vetflow.cl@gmail.com` |
| **Moneda** | **CLP** — irreversible. El brief razona en USD; convertir siempre |
| Zona horaria | `America/Santiago` |
| Gasto acumulado | **CLP 0** · 0 impresiones · 0 clics · 0 conversiones (últimos 30 días) |

## Campañas

| ID | Nombre | Tipo | Estado | Presupuesto | Problema |
|---|---|---|---|---|---|
| `24148766780` | `Campaign #1` | PERFORMANCE_MAX | PAUSED | CLP 10.268/día | **Display ON** + Search Network ON. Y PMax está prohibida hasta ≥30 conv./mes. Nunca ha servido |

## Conversiones

Verificado por GAQL el 2026-08-20 (`FROM conversion_action`): **existe una sola acción**.

| ID | Nombre | Tipo | Categoría | Principal | Estado |
|---|---|---|---|---|---|
| `7724783448` | `Registro` | WEBPAGE | SIGNUP | Sí | ENABLED — moneda **CLP**, valor 1.0. Código listo, **sin validar con un registro real** |
| — | `Demo` | — | — | — | ❌ **NO EXISTE**. Hay que crearla a mano en la UI (no hay herramienta de API para crear conversiones) |

---

## Tracking en el código

Reescrito el 2026-08-20 (T1). Todo pasa por **`public/vetly-tracking.js`**, un script único que
cargan las tres puertas de entrada. Va **síncrono y antes de `gtag.js`** — con `async` o debajo del
tag, Consent Mode deja de aplicar en silencio.

| Pieza | Estado | Dónde |
|---|---|---|
| Etiqueta Google Ads `AW-18395838136` | ✅ | `index.html`, `public/landing.html`, `public/core.html` |
| **Consent Mode v2** | ✅ los 4 parámetros en `denied` por defecto + banner + `url_passthrough` | `public/vetly-tracking.js` |
| **Captura `gclid`/`wbraid`/`gbraid`/UTM** | ✅ cookie first-party 90 d + localStorage | `public/vetly-tracking.js` |
| Atribución sobrevive `/core` → `/register` | ✅ verificado en navegador | `src/lib/attribution.ts` |
| Atribución llega al backend | ✅ `Register.tsx` → `AuthContext.signUp` → `signup-handler` | — |
| Tabla `attribution` en Supabase | 🟡 migración escrita, **sin aplicar** | `supabase/migrations/20260820180000_attribution_table.sql` |
| Conversión `Registro` (`sign_up`) | ✅ dispara tras `signUp()` exitoso, moneda fija CLP | `src/pages/Register.tsx` |
| **Enhanced Conversions** | 🟡 código ✅ (`gtag('set','user_data',{email})` hasheado por Google). **Falta activarlo en la UI de Ads** | `src/pages/Register.tsx` |
| Conversión "Demo" | 🟡 ya no manda un label inválido; hoy mide `generate_lead` en GA4. **Falta crear la acción en Ads** | `vetly-tracking.js` → `DEMO_CONVERSION_LABEL` |
| **GA4** | 🟡 código ✅ y apagado solo. **Falta crear la propiedad y pegar el Measurement ID** | `vetly-tracking.js` → `GA4_ID` |
| Autoetiquetado (`gclid`) en la cuenta | ✅ `auto_tagging_enabled: true` (verificado 2026-08-20) | — |
| Importación de conversiones offline | ❌ no existe (T1.4). La tabla ya tiene las columnas para el job | — |

**Verificación en navegador real (Chrome + Playwright, 2026-08-20): 30/30.** Incluye que el
`consent default` entra a `dataLayer` antes del primer `config`, que el `gclid` sobrevive al salto de
`/core` a la SPA, que una visita directa posterior no lo borra, y que un clic nuevo sí lo reemplaza
(last non-direct click, igual que Ads).

**Lo que sigue faltando:** sin el Measurement ID de GA4 no hay analítica de embudo, y sin la
importación offline el CAC por cliente **pagado** sigue invisible — con trial de 30 días, ese dato
llega mes y medio después del clic, mucho más tarde de lo que Google atribuye solo.

---

## Landings

| Problema | Evidencia | Prioridad |
|---|---|---|
| Precio de Core incoherente | `public/core.html` muestra **$17** (con $39 tachado); `public/landing.html` muestra **$39** en 4 lugares (líneas ~355, 651, 1129, 1214) | Bloqueante — riesgo de desaprobación por precio ≠ destino |
| CTA de Core incoherente | `core.html` → "Crear cuenta gratis"; `landing.html:1552` → "Agendar demo gratis" | Bloqueante — contradice el modelo self-serve |
| Sin prueba social en `/core` | Los testimonios viven solo en `landing.html` | Alta |
| Sin landing por país | Mismo copy para CL y MX. México dice "expediente clínico", no "ficha clínica" | Media |
| Sin FAQ de objeciones | Falta la respuesta honesta sobre SII / CFDI | Alta |
| `/core/comparar` no existe | Destino previsto de la campaña C4 | Media |

**Precios: 6 fuentes que no se sincronizan.** `src/lib/mercadopago.ts`, `src/lib/paddle.ts`,
`public/landing.html`, `public/core.html`, `src/pages/Pricing.tsx`, tabla `plan_limits`. Tocar una
obliga a revisar las seis.

---

## Orden de desbloqueo

```
T1  Tracking          ← código ✅ 2026-08-20. SIGUE BLOQUEANTE por 4 pasos manuales:
    (a) aplicar la migración de `attribution`  (b) desplegar signup-handler
    (c) crear GA4 + pegar Measurement ID       (d) activar Enhanced Conversions en Ads
    y sobre todo: validar `Registro` con un registro real. Detalle abajo.

T2  Landings          ← BLOQUEANTE para el CVR.
    Unificar precio y trial · CTA "Crear cuenta gratis" · prueba social
    en /core · FAQ de objeciones · reducir el registro a 3 campos

T3  Configurar cuenta
    Negativas a nivel cuenta · Display OFF · geo por presencia
    · autoetiquetado · resolver Campaign #1

T4  Lanzar C1 + C2 en borrador → orden de cambio
```

Nada después de T1 tiene sentido si T1 no está cerrado.

---

## T1 — pasos manuales pendientes (nadie más puede hacerlos)

En orden. Los 3 primeros son de despliegue; los 3 últimos, de consolas externas.

1. **Aplicar la migración** — `supabase/migrations/20260820180000_attribution_table.sql`.
   Sin la tabla, `signup-handler` loguea un warning no fatal y la atribución se pierde (el registro
   sí funciona). Supuestos ya verificados contra la base: `gen_random_uuid` vive en `pg_catalog`
   (no requiere prefijo `extensions.`, a diferencia del bug de `gen_random_bytes` de la sesión 78),
   FKs a `clinic_settings.id` y `auth.users.id` ambas `uuid`, y la tabla no existe todavía.

2. **Desplegar `signup-handler`** — `supabase functions deploy signup-handler`.
   Sin flag `--no-verify-jwt`: no está en `config.toml` y el frontend la llama con la anon key.

3. **Desplegar el frontend** (push a `main`). Verificar en el bundle **real**, no en local:
   `vetly-tracking.js` debe existir en la raíz servida, y el marcador de Enhanced Conversions vive
   en el chunk `Register-*.js`, **no** en `index-*.js` (es una ruta lazy).

4. **Crear la propiedad GA4** en `analytics.google.com` → Admin → Crear propiedad → Flujo de datos
   web (`https://vetly.pro`). Pegar el `G-XXXXXXXXXX` en la constante `GA4_ID` de
   `public/vetly-tracking.js`. Es el único lugar del repo. Vincular después GA4 ↔ Google Ads.

5. **Activar Enhanced Conversions** en Google Ads → Objetivos → Conversiones → `Registro` →
   Configuración → *Activar conversiones mejoradas* → aceptar condiciones → método **Etiqueta de
   Google**. El código ya envía el email normalizado; sin este switch Google lo descarta.

6. **Crear la acción de conversión `Demo`** (Objetivos → Conversiones → Nueva → Sitio web →
   configuración manual) y pegar su label en `DEMO_CONVERSION_LABEL` de `vetly-tracking.js`.
   Menor prioridad: `/demo` no es el destino de las campañas de Core.

**Decisión de negocio abierta:** `CONSENT_MODE` está en `'strict'` (denied global hasta aceptar).
Es lo más conservador, pero Chile y México no exigen opt-in previo, y todo usuario que ignore el
banner queda medido solo por modelado. Con 20–45 conversiones/mes objetivo, esa pérdida de señal
afecta el aprendizaje de Smart Bidding. Cambiar a `'eea_only'` es una línea.

---

## Bitácora

| Fecha | Qué pasó |
|---|---|
| 2026-08-18 | Auditoría inicial. Cuenta creada y vacía, 1 PMax pausada con Display ON, 1 conversión sin validar, tracking a medias, precios incoherentes. Nada ha gastado. |
| 2026-08-20 | **T1 en código.** Capa única `public/vetly-tracking.js`: Consent Mode v2, captura de `gclid`/`wbraid`/`gbraid`/UTM en cookie 90 d, GA4 gateado por una constante. Atribución viaja hasta `signup-handler` y tabla `attribution` (migración escrita, sin aplicar). Enhanced Conversions en `Register.tsx`. **Bug corregido:** la conversión enviaba `currency: 'USD'` cuando la acción está definida en CLP — Google convertía y el valor quedaba inconsistente entre registros idénticos. **Bug corregido:** el `send_to` de Demo con label placeholder se eliminó (no registraba nada). Verificado 30/30 en Chrome real. Reverificado por API: 1 sola conversión (`Registro`), autoetiquetado ON, `Campaign #1` sigue PAUSED con **Display y Search Network en true** (pendiente T3). |
