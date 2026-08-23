# Estado de cuenta y tracking — Vetly Google Ads

**Última verificación: 2026-08-22 (3.ª sesión, T3+T4 cerrado + intento de México).** Este documento manda sobre `brief-core.md`. Si al empezar una
sesión esta fecha tiene más de dos semanas, reverifica antes de decidir nada.

⚠️ **Estado de activación reportado por el usuario, NO reverificado por API.** La cuota del MCP de
Pipeboard se agotó (`100/30`) a mitad de esta sesión y bloqueó toda lectura/escritura posterior. El
usuario confirmó manualmente: campañas C1 y C2 (Chile) **activadas**, logo subido, verificación de
identidad del anunciante enviada. Falta re-verificar por MCP en cuanto la cuota se libere —
especialmente el geo por presencia, que la API nunca pudo corregir (ver sección Campañas).

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

| ID | Nombre | Tipo | Estado | Presupuesto | Nota |
|---|---|---|---|---|---|
| `24148766780` | `Campaign #1` | PERFORMANCE_MAX | **REMOVED** | CLP 10.268/día | **Eliminada.** Antes de eliminarla se intentó apagarle Display y Search Network — rechazado por la API (`OPERATION_NOT_PERMITTED_FOR_CONTEXT`): Display es inseparable de PMax por diseño de Google, no es una casilla que se pueda desmarcar. Nunca sirvió ni gastó un peso |
| `24160204077` | `[CL] Search - Gestión Veterinaria (Genéricas)` | SEARCH | **ACTIVADA** ⚠️ sin reverificar | CLP 4.700/día | C1 del brief. 3 grupos · 47+20+13 = 80 kw · 198 negativas · 92 kw entre C1+C2 |
| `24170865265` | `[CL] Search - Veterinario a Domicilio e Independiente` | SEARCH | **ACTIVADA** ⚠️ sin reverificar | CLP 3.000/día | C2 del brief. 1 grupo · 12 kw · 197 negativas |
| `24171087994` | `[MX] Search - Gestión Veterinaria (Genéricas)` | SEARCH | PAUSED — **incompleta** | CLP 2.500/día | 3 grupos creados (`3.1 Software y Sistema de Gestión`, `3.2 Expediente Clínico, Historial y Agenda`, `3.3 Inventario, Finanzas y Recordatorios`). **Sin keywords, sin negativas, sin anuncios** — cascarón vacío |
| `24171088219` | `[MX] Search - Veterinario a Domicilio e Independiente` | SEARCH | PAUSED — **incompleta** | CLP 1.000/día | Grupo(s) creados, misma falta que arriba |

**México quedó a medias por un límite de sesión, no por diseño.** El subagente que las armaba (mismo
playbook que C1/C2, adaptado con terminología mexicana — nótese `"Expediente Clínico"` en vez de
`"Ficha Clínica"`, correcto para ese mercado) se cortó a mitad de cargar keywords por el límite de
sesión de la cuenta de Claude (*"You've hit your session limit"*), con el último mensaje siendo
literalmente *"Grupos listos. Cargo las keywords (47 / 19 / 12 / 12)"*. Retomar: cargar keywords +
negativas (traducir/adaptar las 198 de C1, mismo criterio anti-colisión) + crear RSAs para los 4
grupos antes de activar nada.

**Presupuesto conjunto:** CLP 7.700/día → CLP 231.000/mes ≈ **USD 250/mes** (TC 925 CLP/USD, dólar
observado verificado el 2026-08-21). Coincide con el escenario del brief §6.1 para el mes 1.

### Estructura de C1 y C2 (creadas 2026-08-21)

| Campaña | Grupo (ID) | Keywords | RSA (ID) | Path |
|---|---|---:|---|---|
| C1 | `198725952879` · 1.1 Software y Sistema de Gestión | 47 | `821843726291` | `/core/30-dias-gratis` |
| C1 | `199777934055` · 1.2 Ficha Clínica, Historial y Agenda | 20 | `821723786775` | `/core/ficha-clinica` |
| C1 | `203206886527` · 1.3 Inventario, Finanzas y Recordatorios | 13 | `821770304836` | `/core/inventario` |
| C2 | `205103084048` · 2.1 Domicilio e Independiente | 12 | `821723787252` | `/core/a-domicilio` |

**Path es cosmético — no confundir con URL final.** La columna Path de la tabla (ej.
`/core/inventario`) es el texto de dominio+ruta que se muestra en la vista previa del anuncio (campo
Path 1/Path 2 del RSA) — no tiene que existir como página real y **no es a dónde va el clic**. El
destino real de cada anuncio es el campo "URL final" (ver fila "Destino" abajo: `https://vetly.pro/core`
para ambas campañas). En esta sesión se probó `curl` contra esos paths cosméticos pensando que eran
el destino real — 404 esperado, no un bug, corregido antes de tocar código de más.

**2026-08-22 — activadas por el usuario.** Reportado directamente, sin verificar por MCP (cuota de
Pipeboard agotada). Las keywords ya estaban activas desde la creación (no existe
`enable_google_ads_keyword`, así que si nacieran pausadas habría que activarlas a mano una por una).

**Configuración verificada por lectura, no por el `success` de la escritura:**

| Ítem | C1 | C2 |
|---|---|---|
| Red de Display / socios / red de búsqueda | `false` los 3 | `false` los 3 |
| Solo Google Search | ✅ | ✅ |
| Ubicación | Chile (`2152`) | Chile (`2152`) |
| Idioma | Español (`1003`) | Español (`1003`) |
| Puja | MANUAL_CPC · CLP 550/clic (≈ USD 0,59) | ídem |
| Destino | `https://vetly.pro/core` | `https://vetly.pro/core` |
| Sitelinks · Callouts · Fragmentos | 4 · 7 · 1 | 4 · 7 · 1 |

⚠️ **`positive_geo_target_type = PRESENCE_OR_INTEREST`** — el default de Google, exactamente lo que
la regla de la cuenta prohíbe. **La API nunca pudo corregirlo**: requiere `update_google_ads_campaign`,
herramienta que este agente no tiene por diseño. El usuario reportó haberlo cambiado a mano a
"Presencia" al activar las campañas el 2026-08-22 — **sin verificar por MCP todavía** (cuota
agotada). Es lo primero a reconfirmar apenas se libere la cuota o se suba el plan de Pipeboard.

### Sitelinks — la URL final debe ser única (no repetir entre sitelinks)

Google Ads rechaza crear un sitelink si su URL final coincide con la de otro sitelink del mismo
nivel (campaña o cuenta) — no es un límite arbitrario de la cuenta, es una validación de la
plataforma. Con solo 3 anclas reales en `/core` (`#recorrido`, `#precio`, `#preguntas`) era
imposible armar 8 sitelinks distintos.

**Fix aplicado (2026-08-22):** se agregó `id` a cada uno de los 6 módulos del "Recorrido del
producto" en `public/core.html`, que ya existían como bloques HTML separados y solo les faltaba el
ancla: `#agenda`, `#ficha-clinica`, `#finanzas`, `#recordatorios`, `#inventario`, `#fidelizacion`.
Verificado en producción — las 9 anclas responden.

**Mapeo recomendado para los 8 sitelinks:**

| Sitelink | URL final |
|---|---|
| Crear Cuenta Gratis | `https://vetly.pro/register?plan=core` |
| Ver Precio de Core | `https://vetly.pro/core#precio` |
| Preguntas Frecuentes | `https://vetly.pro/core#preguntas` |
| Agenda de Citas | `https://vetly.pro/core#agenda` |
| Ficha Clínica | `https://vetly.pro/core#ficha-clinica` |
| Inventario | `https://vetly.pro/core#inventario` |
| Finanzas y Caja | `https://vetly.pro/core#finanzas` |
| Recordatorios WhatsApp | `https://vetly.pro/core#recordatorios` |

Con 9 anclas disponibles (agregar `#fidelizacion` de la tabla de arriba) hay margen para un 9no
sitelink si se quiere ampliar. **Sin confirmar si el usuario terminó de cargar los 8** — revisar en
la próxima sesión.

### Títulos de anuncio — auditoría "no mencionan vet" (2026-08-22)

De ~10-11 combinaciones de título visibles en la vista previa, solo 4 mencionaban "Vet"/"Veterinario"
explícito. El grupo más débil era **"1.1 Software y Sistema de Gestión"** — títulos como
`"Ficha, Agenda e Inventario - 3 Usuarios Incluidos"` podrían ser el anuncio de cualquier vertical de
software, sin nada que le confirme a un veterinario que escanea el SERP que es relevante para él.

**Propuesta hecha, sin confirmar si se cargó** (todos ≤30 caracteres, varios mirror casi literal de
keywords ya cargadas):

Nuevos: `Sistema de Gestión Veterinaria` (30) · `Software Gestión Veterinaria` (28) ·
`Software para Veterinarias` (26) · `Clínica Veterinaria Ordenada` (28) · `Hecho para Veterinarias`
(23) · `Software Creado por un Vet` (26) · `Software Vet Desde US$17` (24).

Reemplazos puntuales: `"3 Usuarios Incluidos"` → `"3 Usuarios, Software Vet"` (24) ·
`"Ficha, Agenda e Inventario"` → `"Ficha, Agenda e Inventario Vet"` (30).

**Criterio, no forzar "vet" en los 15 títulos:** Google premia diversidad de ángulos en un RSA — si
todos dicen lo mismo, el Ad Strength puede bajar. La mezcla ideal es la mitad anclada en
"vet"/"veterinario", la otra mitad diferenciando por precio/features/urgencia (que es lo que ya hace
bien el grupo de Domicilio).

## Negativas

395 en total, **a nivel campaña** (198 en C1 + 197 en C2), cargadas desde `vetlynegativas.csv`.

Las exclusiones de palabras clave **a nivel cuenta** no se pueden escribir por API con las
herramientas disponibles (`customer_negative_criterion` no acepta keywords con tipo de concordancia,
y no hay herramienta de listas compartidas). Quedan replicadas por campaña; toda campaña nueva debe
recibir la misma lista, o el usuario debe crear la lista maestra a mano en
*Herramientas → Exclusiones de palabras clave*.

Antes de cargarlas se verificó **colisión negativa ↔ keyword positiva**: 0 colisiones sobre 198 × 92
combinaciones. Ninguna negativa anula una keyword propia.

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
| Precio de Core coherente en las 4 superficies | ✅ **Corregido 2026-08-21:** la landing en producción muestra **US$39 tachado → US$17/mes** como precio protagonista, con *"En Chile: $17.000 CLP/mes (antes $33.000)"* como nota al pie. La versión anterior de esta línea decía que el número grande era CLP — era falso. Verificado con `curl` sobre `vetly.pro/core` (HTTP 200): 6 apariciones de `US$17` contra 3 de `$17.000`. **El copy de los anuncios usa US$17** para que coincida con el número grande del destino |
| CTA de Core autoservicio | ✅ "Crear cuenta gratis" → `/register?plan=core` en `/core` y en la tarjeta de la home. Los demás planes mantienen la demo |
| Prueba social en `/core` | ✅ 6 capturas reales del plan Core + historia del fundador. **Sin testimonios de clientes a propósito**: los 3 de la home venden IA, rutas y campañas — nada de eso está en Core |
| FAQ de objeciones | ✅ 6 preguntas, incluida la respuesta honesta de que Core **no** emite boleta/factura electrónica (SII) |
| Qué NO incluye Core | ✅ sección explícita con el plan desde el que aparece cada cosa |
| Registro | ✅ un solo paso para Core, 30 días como bloque protagonista, casilla de profesional independiente |
| Copy "sistema de gestión veterinaria" | ✅ **Agregado 2026-08-22** al primer párrafo del hero — cierra el hueco de relevancia con el grupo de anuncios más grande (47 kw de "sistema de gestión") |
| 6 anclas para sitelinks (`#agenda`, `#ficha-clinica`, `#finanzas`, `#recordatorios`, `#inventario`, `#fidelizacion`) | ✅ **Agregadas 2026-08-22** — ver sección "Sitelinks" arriba |
| Landing por país (`/core/mx`) | ❌ pendiente — México dice "expediente clínico", no "ficha clínica" |
| Comparativa `/core/comparar` | ❌ pendiente — destino previsto de la campaña C4 |
| Logo para anuncios | ✅ **Subido 2026-08-22** — `public/logo.png`, 1024×1024, cumple spec 1:1 de Google. Falta logo horizontal 4:1 (opcional, no bloquea) |
| Verificación de identidad del anunciante | 🟡 **Documentos enviados 2026-08-22** — requisito de Google para desbloquear Logo/Nombre de empresa en anuncios de búsqueda. Revisión: 1-10 días hábiles, sin acción adicional mientras tanto |

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
T1  Tracking          ← ✅ CERRADO 2026-08-20. Validado con un registro real de punta a punta.

T2  Landings          ← ✅ CERRADO 2026-08-21. Precio unificado, /core reescrita con
    capturas reales, registro de un paso. Pendiente menor: /core/mx y /core/comparar.

T3  Configurar cuenta ← ✅ CERRADO 2026-08-21, con 2 salvedades que NO se pudieron
    resolver por API (ver abajo). Campaign #1 dada de baja · Display OFF en las
    campañas nuevas · negativas cargadas · autoetiquetado ya estaba ON.

T4  Lanzar C1 + C2    ← ✅ CREADAS 2026-08-21, ACTIVADAS 2026-08-22 (reportado por el
    usuario, sin reverificar por MCP — cuota de Pipeboard agotada a mitad de sesión).

T5  México (C3 + C4)  ← 🟡 A MEDIAS. Campañas y grupos creados, sin keywords/negativas/
    anuncios — el subagente se cortó por límite de sesión. Retomar cuando haya cuota.
```

**Cosas que la API no permitió y dependen de verificación manual / futura:**

1. 🔴 **Geo por presencia** — `PRESENCE_OR_INTEREST` en C1 y C2 nunca se pudo corregir por API
   (`update_google_ads_campaign` no está en el toolset del agente por diseño). El usuario reportó
   haberlo cambiado a mano a "Presencia" al activar el 2026-08-22 — **falta confirmar por MCP**.
   *Configuración → Ubicaciones → Opciones de ubicación → "Presencia: personas que se encuentran
   periódicamente en tus ubicaciones incluidas o que las visitaron".*
2. 🟡 **Lista de negativas a nivel cuenta** — hoy están replicadas por campaña. Funciona igual, pero
   obliga a repetirlas en cada campaña futura (incluida México cuando se retome).
3. 🟡 **Cuota de Pipeboard** — plan gratis agotado (`100/30`). Subir plan en
   `pipeboard.co/settings/billing` o esperar reset antes de poder auditar/completar México.

**MCP oficial de Google Ads — investigado 2026-08-22, decisión de no usarlo por ahora.** Google
lanzó un MCP propio el 28 de abril de 2026 (mismo patrón que Meta), pero a diferencia del de Meta
**no es un servicio hospedado** — es código de solo lectura (`list_accessible_customers` + `search`
GAQL, 2 tools) que requiere autodesplegarse en Google Cloud Run con proyecto de GCP, developer token
y OAuth propios. Para lo que resolvería (ahorrar cuota de Pipeboard en lecturas) el esfuerzo de
montar Cloud Run no se justifica hoy — y de todas formas nunca reemplaza a Pipeboard para las
mutaciones, que están fuera de su diseño. Referencia:
[developers.google.com/google-ads/api/docs/developer-toolkit/mcp-server](https://developers.google.com/google-ads/api/docs/developer-toolkit/mcp-server).

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
| 2026-08-21 (T3 + T4) | **Higiene de cuenta y primeras campañas en borrador.** *T3:* `Campaign #1` (PMax por defecto de Google) dada de baja — confirmada PAUSED, 0 impresiones y CLP 0 de por vida. Intento de apagarle Display y Search Network **rechazado por la API** (`OPERATION_NOT_PERMITTED_FOR_CONTEXT`): Display es inseparable de PMax, no es una casilla que se pueda desmarcar. Queda neutralizada por estar pausada; si se quiere certeza total hay que eliminarla desde la UI (este agente no elimina). *T4:* creadas **C1** (`24160204077`, CLP 4.700/día, 3 grupos, 80 kw) y **C2** (`24170865265`, CLP 3.000/día, 1 grupo, 12 kw), ambas SEARCH · MANUAL_CPC CLP 550 · solo Google Search · Chile · español · destino `/core`. 92 keywords y 395 negativas cargadas desde los CSV de investigación, 4 RSAs de 15 títulos y 4 descripciones (todos contados carácter por carácter antes de llamar la API; uno de 91 se corrigió a 90), 8 sitelinks, 14 callouts y 2 fragmentos estructurados. **Hallazgo que corrige este documento:** la landing muestra **US$17 como precio grande** y el CLP como nota, al revés de lo que decía la línea de Landings — verificado con `curl` contra producción antes de escribir el copy, porque un precio en el anuncio distinto al del destino es motivo de desaprobación. **Decisión de criterio sobre los datos de investigación:** se descartaron 7 keywords del grupo *1.8 App y Móvil* (`app veterinaria`, `app de veterinaria`, `veterinaria app`, etc.) porque capturan al **dueño de mascota**, la fuga que el brief marca como la más cara; solo entraron las 3 inequívocamente profesionales. La negativa `domicilio precio` se retiró de C2 (bloquearía a un profesional buscando *"software veterinario a domicilio precio"*, el núcleo de esa campaña) y se mantuvo en C1. Se verificó 0 colisiones entre las 198 negativas y las 92 keywords. **Sin resolver por falta de herramienta:** geo sigue en `PRESENCE_OR_INTEREST` en ambas campañas — es lo primero que hay que corregir a mano antes de activar. Todo el estado final se verificó leyendo la cuenta de vuelta, no confiando en el `success` de cada escritura. |
| 2026-08-22 | **Lanzamiento: activación + intento de México + investigación de MCP oficial.** Sitelinks: Google rechazó URL final duplicada entre sitelinks — se agregaron 6 anclas nuevas a `/core` (`#agenda`, `#ficha-clinica`, `#finanzas`, `#recordatorios`, `#inventario`, `#fidelizacion`) para poder armar 8 destinos distintos; también se aclaró que el campo "Path del anuncio gráfico" mostrado en la vista previa es cosmético (no la URL final), tras probar por error con `curl` un path que nunca fue el destino real del clic. Copy: agregada la frase "sistema de gestión veterinaria" al hero de `/core`, cerrando el hueco de relevancia con el grupo de 47 keywords que más la necesitaba. Auditoría de títulos: solo ~4 de 10-11 combos visibles mencionaban "vet"/"veterinario" — se propusieron 7 títulos nuevos + 2 reemplazos, sin confirmar si se cargaron. **Intento de México:** creadas `[MX] Search - Gestión Veterinaria` (`24171087994`) y `[MX] Search - Veterinario a Domicilio` (`24171088219`) con sus grupos de anuncios (terminología correcta: "Expediente Clínico", no "Ficha Clínica"), pero el subagente se cortó por límite de sesión de Claude a mitad de cargar keywords — quedaron sin keywords, negativas ni anuncios. **Bloqueante nuevo:** cuota del MCP de Pipeboard agotada (`100/30`, plan gratis) a mitad del trabajo de México, sin lectura ni escritura posible por el resto de la sesión. **MCP oficial de Google investigado como alternativa** — descartado por ahora: es de solo lectura (2 tools) y requiere autodesplegarse en Cloud Run, no resuelve el problema de fondo (necesitamos escritura). **Logo subido** (`public/logo.png`, 1024×1024, spec 1:1 cumplida) y **verificación de identidad del anunciante enviada** (Google exige esto para desbloquear Logo/Nombre de empresa en search ads; revisión 1-10 días hábiles). **Cierre de sesión: usuario reportó C1 y C2 activadas y geo corregido a "Presencia" manualmente** — sin verificar por MCP por la cuota agotada; primera tarea de la próxima sesión en cuanto haya cuota. |
