# Estado de cuenta y tracking — Vetly Google Ads

**Última verificación: 2026-08-21.** Este documento manda sobre `brief-core.md`. Si al empezar una
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
| **Enhanced Conversions** | ✅ activo — confirmado en Ads (Objetivos → Conversiones → Registro → Configuración → "Conversiones avanzadas": casilla ya marcada de fábrica, administrada vía la etiqueta de Google unificada) | `src/pages/Register.tsx` |
| Conversión "Demo" | 🟡 ya no manda un label inválido; hoy mide `generate_lead` en GA4. **Falta crear la acción en Ads** (baja prioridad) | `vetly-tracking.js` → `DEMO_CONVERSION_LABEL` |
| **GA4** | ✅ propiedad "Vetly" creada, `GA4_ID` pegado (`G-7CEW929SSP`), vinculada a la etiqueta ya existente en el sitio (Google detectó `AW-18395838136` y la reutilizó — sin script adicional). Confirmado con usuario real en Realtime | `vetly-tracking.js` → `GA4_ID` |
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

| Tema | Estado |
|---|---|
| Precio de Core coherente en las 4 superficies | ✅ `/core`, home, `/precios` y registro muestran $33.000 tachado → **$17.000 CLP** (≈US$17) |
| CTA de Core autoservicio | ✅ "Crear cuenta gratis" → `/register?plan=core` en `/core` y en la tarjeta de la home. Los demás planes mantienen la demo |
| Prueba social en `/core` | ✅ 6 capturas reales del plan Core + historia del fundador. **Sin testimonios de clientes a propósito**: los 3 de la home venden IA, rutas y campañas — nada de eso está en Core |
| FAQ de objeciones | ✅ 6 preguntas, incluida la respuesta honesta de que Core **no** emite boleta/factura electrónica (SII) |
| Qué NO incluye Core | ✅ sección explícita con el plan desde el que aparece cada cosa |
| Registro | ✅ un solo paso para Core, 30 días como bloque protagonista, casilla de profesional independiente |
| Landing por país (`/core/mx`) | ❌ pendiente — México dice "expediente clínico", no "ficha clínica" |
| Comparativa `/core/comparar` | ❌ pendiente — destino previsto de la campaña C4 |

**Precios: 6 fuentes que no se sincronizan.** `src/lib/mercadopago.ts` (`PLANS.core.launchPrice`),
`src/lib/paddle.ts` (`PADDLE_PLANS.core.launchPrice`), `public/landing.html`, `public/core.html`,
`src/pages/Pricing.tsx` y la tabla `plan_limits`. Además, el monto que **se cobra** de verdad en
Chile vive en `mercadopago-create-subscription` (`PLAN_PRICES.core.CLP`): si se cambia el precio de
lanzamiento hay que tocar ese archivo también, o la web promete un número y el checkout cobra otro.

**Capturas del producto.** Viven en `public/core-shots/*.webp` y se toman de la clínica de prueba
Core `741a3568-…` ("Veterinaria Los Robles"), poblada con datos ficticios. Para regenerarlas hace
falta una sesión: se obtiene con `admin/generate_link` + `POST /auth/v1/verify` usando el
`email_otp` (no el `hashed_token`), y la sesión se inyecta por hash en la URL — `vetly.pro` no está
en la lista de Redirect URLs de Supabase Auth, así que el flujo de redirección cae a
`localhost:3000` y falla. Navegar por el menú lateral en vez de recargar la página: cada `goto`
reinicia la autenticación y deja el splash "Cargando Vetly…" varios segundos.

---

## Orden de desbloqueo

```
T1  Tracking          ← ✅ CERRADO 2026-08-20. Validado con un registro real de punta a punta
    (ver bitácora). Ya no bloquea nada.

T2  Landings          ← ✅ CERRADO 2026-08-21. Precio unificado en las 4
    superficies, /core reescrita con capturas reales, registro de un paso.
    Pendiente menor: landing /core/mx y comparativa /core/comparar.

T3  Configurar cuenta
    Negativas a nivel cuenta · Display OFF · geo por presencia
    · autoetiquetado · resolver Campaign #1

T4  Lanzar C1 + C2 en borrador → orden de cambio
```

T1 y T2 están cerrados. **El siguiente paso es T3: higiene de la cuenta antes de crear campañas.**

---

## T1 — cerrado (referencia histórica, no quedan pasos pendientes)

Los 6 pasos manuales que este documento traía pendientes (aplicar migración, desplegar
`signup-handler`, desplegar frontend, crear GA4, activar Enhanced Conversions, `CONSENT_MODE`)
**se completaron y verificaron todos el 2026-08-20** — ver bitácora para el detalle de cada uno.
Único punto que queda abierto, sin bloquear nada: crear la acción de conversión `Demo` en Ads
(baja prioridad, `/demo` no es destino de las campañas de Core).

---

## Bitácora

| Fecha | Qué pasó |
|---|---|
| 2026-08-18 | Auditoría inicial. Cuenta creada y vacía, 1 PMax pausada con Display ON, 1 conversión sin validar, tracking a medias, precios incoherentes. Nada ha gastado. |
| 2026-08-20 | **T1 en código.** Capa única `public/vetly-tracking.js`: Consent Mode v2, captura de `gclid`/`wbraid`/`gbraid`/UTM en cookie 90 d, GA4 gateado por una constante. Atribución viaja hasta `signup-handler` y tabla `attribution` (migración escrita, sin aplicar). Enhanced Conversions en `Register.tsx`. **Bug corregido:** la conversión enviaba `currency: 'USD'` cuando la acción está definida en CLP — Google convertía y el valor quedaba inconsistente entre registros idénticos. **Bug corregido:** el `send_to` de Demo con label placeholder se eliminó (no registraba nada). Verificado 30/30 en Chrome real. Reverificado por API: 1 sola conversión (`Registro`), autoetiquetado ON, `Campaign #1` sigue PAUSED con **Display y Search Network en true** (pendiente T3). |
| 2026-08-20 (cont.) | **T1 cerrado end-to-end.** Migración `attribution` aplicada; `signup-handler` redeployado (v38) con verify_jwt=true intacto — el bundler de `deploy_edge_function` requiere nombrar los archivos con la ruta real del repo (`supabase/functions/signup-handler/index.ts` + `supabase/functions/_shared/planLimits.ts`) para que resuelva `../_shared/`, si no tira `Module not found`. `CONSENT_MODE` cambiado a `'eea_only'` (denied solo en EEA/UK/CH). GA4 creado (`G-7CEW929SSP`) y pegado en `GA4_ID`, confirmado con 1 usuario real en Realtime. **Bug encontrado y corregido:** `AuthContext.signUp` solo mostraba el mensaje genérico de supabase-js ("Edge Function returned a non-2xx status code") en cualquier fallo de `signup-handler`, sin importar la causa real — ahora lee `functionError.context.json()` para mostrar el motivo verdadero. Registro real de prueba completado en plan Core (tras sortear: sesión previa de Animalgrace bloqueando `/register` por diseño de `ProtectedRoute`, autofill de Chrome con el email viejo, y un primer intento fallido probablemente por token de Turnstile expirado durante la depuración). Confirmado por consola del navegador: `dataLayer` con `send_to: "AW-18395838136/CU91CNiuu-McELjt6MNE"`, `currency: "CLP"` — la conversión llega bien formada. **Enhanced Conversions confirmado ya activo** en Ads (casilla marcada de fábrica, vía la etiqueta de Google unificada) — no requirió ninguna acción. Hallazgo aparte, no bloqueante: bucle de "Attempt N failed to fetch profile" en consola causado por eco de `onAuthStateChange` entre pestañas de Vetly abiertas simultáneamente — no impide que el perfil cargue, pendiente de investigar si molesta. Hallazgo aparte para T2: el toggle Chile/CLP en `/register` muestra Core a $33.000 sin el descuento de lanzamiento (el cupón CLP nunca se armó, ya documentado como pendiente). |
| 2026-08-21 | **T2 cerrado.** *Precio:* el descuento de lanzamiento estaba escrito como `source.price - 22` (resta en dólares) y condicionado a `paymentRegion === 'international'` — Chile no podía verlo por diseño. Ahora sale de `launchPrice` por plan; MercadoPago cobra $17.000 CLP como monto recurrente (no soporta cupones en suscripciones, así que para terminar la promo hay que subir el número en `PLANS.core.launchPrice` **y** en `mercadopago-create-subscription`). Precio unificado en `/core`, home, `/precios` y registro. *Registro:* flujo de un paso para Core (Turnstile, selector de región y `handleSubmit` acompañan el cambio); los 30 días pasan de gris 12px a bloque protagonista; casilla "profesional independiente" que envía el nombre del profesional como `clinic_name` (signup-handler lo exige no vacío); "Vetly AI" → "Vetly"; título plan-aware. Se eliminó un testimonio que atribuía una persona inventada ("Dra. Carolina Méndez") a una clínica real (AnimalGrace) — lo reemplaza la historia del fundador. *Landing:* `/core` reescrita con recorrido de producto en 6 capturas **reales del plan Core**; las que había en el repo mostraban el dashboard con IA ("Mensajes de IA", "Agente activo"), justo lo que Core no incluye, y las de 2 MB resultaron ser fotos de stock del blog. Las nuevas se tomaron de la clínica de prueba Core `741a3568-…` ("Veterinaria Los Robles") poblada con datos ficticios. Sección explícita de qué NO trae Core, FAQ con la respuesta honesta sobre boleta electrónica/SII, y análisis de factura con IA presentado como extra de créditos (no como incluido). Todo en WebP: 284 KB las 6 capturas. Verificado en navegador real: sin desbordamiento móvil, sin errores JS, flujo Pro intacto en 3 pasos. |
