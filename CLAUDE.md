# Vetly — Guía para Claude

SaaS veterinario para clínicas móviles a domicilio. Permite agendar citas vía WhatsApp con un AI agent, gestionar pacientes, enviar recordatorios y campañas, y procesar pagos.

---

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | React + Vite + TypeScript, Radix UI, Tailwind |
| Backend | Supabase (PostgreSQL + Auth + Storage + 38 Edge Functions) |
| AI | OpenAI GPT-4o / GPT-4o-mini (híbrido por mensaje) |
| WhatsApp | YCloud — inbound/outbound via webhook |
| Email | Resend |
| Maps | Google Maps Distance Matrix + Geocoding API |
| Pagos | MercadoPago (suscripciones + créditos AI) |
| Deploy | Vercel (frontend) + Supabase (edge functions) |

---

## Arquitectura de Edge Functions

### AI Agent principal
**`ycloud-whatsapp-webhook`** — 3800+ líneas, es el core del producto.

Flujo por mensaje entrante:
1. Verificación HMAC-SHA256 de firma YCloud (per-clínica, ver sección Seguridad)
2. Debounce de 20 segundos (agrupa mensajes rápidos del mismo usuario)
3. Deduplicación: si llegó un mensaje más nuevo mientras esperaba, aborta
4. Selección de modelo según `clinic.ai_active_model`:
   - `"hybrid"`: `selectModelTier()` → mini por defecto, 4o para agenda/geo/cirugías/urgencias/imágenes. Detecta `activeSchedulingFlow` en los últimos 3 mensajes outbound para mantener coherencia del flujo.
   - `"pro"`: siempre GPT-4o
   - `"mini"`: siempre GPT-4o-mini
5. Loop de tool calls (máx 5 iteraciones): `check_availability`, `create_appointment`, `get_services`, `get_knowledge`, `escalate_to_human`, `reschedule_appointment`, `tag_patient`, `confirm_appointment`
6. Respuesta vía YCloud API

### Constantes importantes en el webhook
```typescript
const HQ_ID = "00000000-0000-0000-0000-000000000000";         // Prompt de ventas Vetly
const CLINIC_ANIMALGRACE_ID = "fd11b7e4-...";                  // Lógica Linares/Talca
const CLINIC_SANTIAGO_ID    = "13472ea4-...";                  // Fallback coordenadas RM
const TRAVEL_BUFFER_MINUTES = 15;                              // Buffer entre citas móviles
const KB_CACHE_TTL_MS = 5 * 60 * 1000;                        // TTL cache knowledge base
```

### Otras funciones relevantes
| Función | Rol |
|---|---|
| `ai-simulator` | Simulador del AI agent para el dashboard (usa mismo DB real) |
| `chat-agent` | Chat de ventas/soporte del sitio vetly.pro |
| `cron-process-reminders` | Envía recordatorios de **citas** (24h y 2h antes) Y recordatorios **médicos** (vacunas, desparasitaciones) — ver PART 1/2/4 |
| `cron-process-surveys` | Encuestas post-cita (retorna 400 en cada ejecución — pendiente de investigar) |
| `cron-process-upsell` | Campañas de upsell automático |
| `cron-retention-compute` / `cron-retention-execute` | Motor de retención preventivo |
| `ycloud-whatsapp-webhook` | AI agent WhatsApp (principal) |
| `send-whatsapp-campaign` | Campañas masivas manuales |
| `mercadopago-webhook` | Procesa pagos y activa/desactiva suscripciones |

---

## Páginas del frontend (`src/pages/`)

`Dashboard`, `Appointments`, `Patients`, `Tutors`, `Messages`, `CRM`, `Campaigns`, `Reminders`, `KnowledgeBase`, `RetentionEngine`, `Finance`, `AICredits`, `Settings`, `Templates`, `Loyalty`, `PatientProfile`

---

## Patrones críticos a respetar

### Google Maps — cálculo de slots
`checkAvail()` en el webhook usa **prefetch paralelo**: antes del loop de slots, recolecta todos los pares únicos `(origen → tutorCoords)` y `(tutorCoords → destino)` del día, los fetcha todos con `Promise.all`, y el loop evalúa con cache en memoria. Sin awaits dentro del loop.

### Knowledge base — cache de módulo
`getKnowledgeDocs(sb, clinicId)` es el único punto de acceso a la tabla `knowledge_base`. Cache en `kbCache: Map<clinicId, {docs, fetchedAt}>` con TTL de 5 min. Tanto `getKnowledge` (tool) como `getKnowledgeSummary` (prompt) usan este helper. No hacer queries directas a `knowledge_base` en ningún otro lugar.

### Routing híbrido
`selectModelTier(content, hasImage, activeSchedulingFlow)` decide el modelo. Si se agregan nuevas categorías que requieren razonamiento complejo (geo, agenda, cirugías), agregarlas en las listas `needsSchedulingReason` o `needsMedicalReason` dentro de esa función, no en otro lugar.

### Seguridad del webhook
- CORS restringido a `https://ycloud.com`
- Solo acepta `POST` — GET devuelve 405
- Firma HMAC-SHA256 verificada vía `verifyYCloudSignature(rawBody, signatureHeader, secret)` antes de procesar cualquier payload
- **El secret es POR CLÍNICA**, no global. Se busca en `clinic_settings.ycloud_webhook_secret` usando `ycloud_phone_number = payload.whatsappInboundMessage.to`
- Si la clínica no tiene secret configurado → acepta el mensaje con `console.warn` (comportamiento permisivo intencional para onboarding)
- El flujo del simulador (`!p.whatsappInboundMessage`) **no tiene verificación** — pasa directo
- El secret se configura desde Settings → campo "Webhook Secret" (tipo password)
- Estado actual: Animalgrace Linares ✅ configurado | Animalgrace Santiago ✅ configurado

**Formato del header YCloud-Signature (crítico):**
- Header: `t={timestamp},s={signature}` — hay que parsear `t` y `s` por separado
- Payload firmado: `{timestamp}.{rawBody}` — no solo `{rawBody}`
- Encoding del digest: hexadecimal
- **Formato del secret**: YCloud usa el secret **completo** como clave HMAC en UTF-8 (incluyendo el prefijo `whsec_`). NO se decodifica base64. El código usa `encoder.encode(secret)` directamente. ⚠️ La asunción anterior de formato Svix (base64-decode) era incorrecta — verificado empíricamente con diagnóstico en mayo 2026 (v209).

### Tablas de recordatorios — distinción importante
Hay **dos tablas distintas** para recordatorios:
- `reminder_logs` — log de envíos de recordatorios de **citas** (24h, 2h antes). Escrito por PART 1/2 del cron. Tiene `clinic_id`, `appointment_id`, `type`, `status`, `error_message`.
- `reminders` — recordatorios **médicos** programados (vacunas, desparasitaciones, checkups). Escrito por el sistema cuando se registra un evento médico. Tiene `scheduled_date`, `type` (vaccine/deworming/checkup), `whatsapp_template`, `status` (pending/sent/failed/skipped).

### RLS de reminder_logs
Usa `clinic_members` (no `user_profiles.clinic_id`) para soportar usuarios multi-sucursal:
```sql
clinic_id IN (SELECT clinic_id FROM clinic_members WHERE user_id = auth.uid() AND status = 'active')
```
Si la RLS se rompe y un usuario no ve datos, verificar que tenga filas activas en `clinic_members`.

### cron-process-reminders — estructura interna
- **PART 1**: Recordatorios 24h antes de cita. Pre-check en `reminder_logs` para idempotencia.
- **PART 2**: Recordatorios 2h antes de cita. Pre-check en `reminder_logs` para idempotencia.
- **PART 3**: ~~Recordatorios 1h~~ — **ELIMINADO** en mayo 2026.
- **PART 4**: Recordatorios médicos (vacunas/desparasitaciones). Consulta `reminders WHERE status = 'pending' AND scheduled_date <= tomorrowStr`. Usa `lte` para hacer catch-up de registros atrasados. Fallback de template: `rem.whatsapp_template` → `clinic.vaccine/deworming/checkup_reminder_template`. Si no hay teléfono o template → marca como `failed`.

### Formato de tools OpenAI
Todo el código usa el formato moderno (`tools`/`tool_choice`/`tool_call_id`), no el deprecado (`functions`/`function_call`). El `ai-simulator` fue migrado en mayo 2026.

---

## Cambios realizados — mayo 2026 (sesión 1)

### Seguridad y routing (commit `6016157`)
- CORS del webhook restringido de `*` a `https://ycloud.com`
- Endpoint GET de `debug_logs` eliminado (exponía logs sin autenticación)
- Verificación HMAC-SHA256 de firma YCloud implementada (`verifyYCloudSignature`)
- Routing híbrido: `selectModelTier()` con mini como default y 4o para casos específicos
- Detección de `activeSchedulingFlow` para mantener coherencia de flujo en 4o

### Deuda técnica — limpieza de código muerto (commits `6016157`, `bdcb5cc`)
- Eliminados `callGemini()` y `callOpenRouter()` (~162 líneas)
- `callAI()` simplificado a 6 líneas (solo OpenAI, sin failover)
- Campo `geminiParts` eliminado de la interfaz `Msg`
- `getKnowledge`: query muerta a tabla `clinics` eliminada
- UUIDs hardcodeados extraídos a constantes nombradas (`CLINIC_ANIMALGRACE_ID`, `CLINIC_SANTIAGO_ID`)
- `isAnimalGrace` boolean usado consistentemente en lugar de repetir la comparación

### Performance (commits `6016157`, `bdcb5cc`)
- Loop de slots: Maps serial → prefetch paralelo de pares únicos (`Promise.all` antes del loop)
- Logistics geo: dos `Promise.all` seriales → un único `Promise.all` que envuelve ambos grupos
- `getKnowledgeDocs`: cache en memoria con TTL 5 min, elimina queries DB en cada mensaje

### Sincronización de agentes (commits `bdcb5cc`, `d3fb1c1`)
- `chat-agent`: migrado a `Deno.serve()`, eliminado polyfill XHR obsoleto, `max_completion_tokens`
- `ai-simulator`: migrado de API deprecada `functions`/`function_call` a `tools`/`tool_choice`, loop de tools actualizado a `tool_call_id`, array `functions` duplicado eliminado, IDs hardcodeados removidos, EMERGENCY HACK eliminado

---

## Cambios realizados — mayo 2026 (sesión 2, 2026-05-20)

### Sistema de recordatorios — `cron-process-reminders` (v14)
- **Imports modernizados**: `deno.land/std@0.168.0` → `jsr:`, `esm.sh` → `npm:`. `serve()` → `Deno.serve()`
- **PART 1 (24h)**: idempotencia via `reminder_logs` — pre-check antes de enviar, evita duplicados aunque el cron corra varias veces
- **PART 2 (2h)**: reemplazó la ventana frágil de 6h por el mismo pre-check en `reminder_logs`
- **PART 3 (1h)**: eliminado completamente (~178 líneas). La feature de 1h no existe más en cron ni en frontend
- **PART 4**: `console.error` silencioso → ahora marca `reminders.status = 'failed'` cuando falta teléfono o template

### Sistema de recordatorios — `cron-process-reminders` (v15, 2026-05-20)
- **PART 4**: `eq('scheduled_date', tomorrowStr)` → `lte('scheduled_date', tomorrowStr)` — fix crítico: con `eq`, cualquier registro cuya ventana se perdía quedaba atrapado en `pending` para siempre. Con `lte` el cron hace catch-up en la siguiente ejecución
- **9 registros vencidos** (scheduled_date mayo 1-19) marcados manualmente como `skipped` en la DB

### Dashboard de Recordatorios — `src/pages/Reminders.tsx` (reescritura)
- Dos `useEffect` separados: uno para settings (solo al cambiar clínica), otro para logs (tab/filtro/clínica)
- `getStartDate()` helper inmutable (evitaba mutación de Date)
- Query usa `created_at` en lugar de `sent_at` para ordenar y filtrar
- Coerción booleana corregida: `checked={!!settings.reminder_24h_before}`
- Time picker `preferred_hour` con `[color-scheme:dark]` para estilo nativo oscuro
- `dateRange` default cambiado de `'today'` a `'week'`
- Badge y lógica de tipo `1h` eliminados
- Botón de refresh llama directamente a `fetchLogs()`

### Seguridad HMAC per-clínica — `ycloud-whatsapp-webhook`
- **Problema**: el secret HMAC era global (`YCLOUD_WEBHOOK_SECRET` env var), pero cada clínica tiene su propia cuenta YCloud con su propio secret
- **Migración DB**: `ALTER TABLE clinic_settings ADD COLUMN ycloud_webhook_secret TEXT`
- **`verifyYCloudSignature`**: ahora recibe `secret: string` como tercer parámetro en lugar de leer variable global
- **Orden del handler corregido**: parsea `to` del payload → busca `clinic_settings.ycloud_webhook_secret` → verifica firma
- **Simulador**: detectado por ausencia de `p.whatsappInboundMessage` → bypassa verificación
- **Constante global eliminada**: `const YCLOUD_WEBHOOK_SECRET = Deno.env.get(...)` removida
- **Settings.tsx**: campo "Webhook Secret" (tipo password) entre "Número de WhatsApp" y "Webhook URL"
- Animalgrace Linares: secret guardado ✅ (verificación activa desde v205)
- Animalgrace Santiago: sin secret ⚠️ en esta sesión → configurado en sesión 5 ✅
- Deployed: webhook v203

### RLS `reminder_logs` — migración `fix_reminder_logs_rls_use_clinic_members`
- **Problema raíz**: la política SELECT usaba `user_profiles.clinic_id` (un solo valor). Para usuarios multi-sucursal que cambian de clínica via localStorage, la RLS siempre filtraba por la clínica guardada en DB, no la activa en el frontend
- **Fix**: política reemplazada para usar `clinic_members`:
  ```sql
  clinic_id IN (SELECT clinic_id FROM clinic_members WHERE user_id = auth.uid() AND status = 'active')
  ```
- Ahora un owner con acceso a Linares y Santiago puede ver datos de ambas según la clínica activa en el frontend

---

## Cambios realizados — mayo 2026 (sesión 3, 2026-05-20)

### Animalgrace Linares — ajustes de prompt y KB

**`ai_behavior_rules`:**
- Capacidad de citas por sector: 4 → 5 (alineado con vademécum de la app)
- Buffer en REGLA DE ORO: clarificado "desde el FIN de la última cita del sector actual"
- Sección 3 (INTELIGENCIA DE RUTA) simplificada: solo filosofía + referencia al KB. El detalle operativo vive en el doc de logística

**KB `PROTOCOLO_LOGISTICA_SERVICIOS_GENERALES`:**
- Restricción Talca antes de las 11am: añadida explícitamente
- Sección 4 reescrita con sectores correctos:
  - SECTOR LINARES: Linares, Yerbas Buenas, Colbún, Longaví, Villa Alegre, San Javier
  - SECTOR TALCA: Talca, Maule, San Clemente, Pelarco, Pencahue
- Buffer inter-sector: 1h desde FIN de última cita (no desde inicio)
- Talca: gestionada por demanda, no días fijos
- Regla 5: Linares siempre disponible al inicio y cierre del día

**KB `MATRIZ_PRECIOS_Y_PROTOCOLO_CIRUGIAS`:** pack prequirúrgico `$66.000` → `$55.000`

**KB `PROTOCOLO_SERVICIOS_Y_VACUNACION_ANIMALGRACE`:** precios de eutanasia formato coma → punto (`$90,000` → `$90.000`, `$100,000` → `$100.000`)

---

### Animalgrace Santiago — actualización logística y agendamiento

**KB `#PROTOCOLO_LOGISTICA_SANTIAGO_SERVICIOS_GENERALES`:** sección 4 completamente reemplazada:
- Tabla de zonas geográficas (solo uso interno del agente):
  - Centro: Santiago Centro, San Miguel, San Joaquín, Pedro Aguirre Cerda, Independencia, Recoleta
  - Norte: Conchalí, Huechuraba, Renca, Quilicura
  - Poniente: Maipú, Cerro Navia, Pudahuel, Quinta Normal, Lo Prado, Estación Central, Cerrillos
  - Sur: La Granja, La Pintana, El Bosque, San Ramón, Lo Espejo, San Bernardo, Puente Alto, La Florida, Macul, Buin, Pirque, Padre Hurtado, Valle Grande
  - Oriente: Providencia, Ñuñoa, La Reina, Peñalolén, Las Condes, Vitacura, Ciudad Satélite, Ciudad de los Valles
- Principio nuevo: "aprovechar desplazamientos largos" — incorporar pacientes intermedios cuando hay cita en zona lejana
- Protocolo §4.3 Tutores Fuera de Ruta: antes de `escalate_to_human`, ofrecer otro horario del mismo día o próximo día hábil
- Margen de flexibilidad horaria: `1 hora` → `1 a 2 horas`

**KB `POLITICAS_GENERALES_Y_CONDICIONES_SERVICIO`:** margen sección 2: `1 hora` → `1 a 2 horas`

**KB `PROTOCOLO_SERVICIOS_Y_VACUNACION_ANIMALGRACE`:** eutanasia `$90,000`/`$100,000` → `$90.000`/`$100.000`

**`ai_behavior_rules` Santiago:**
- Regla `ZONA DEL TUTOR (REGLA INTERNA)`: nunca preguntar al tutor a qué zona pertenece — inferir desde la comuna mencionada
- Sección 3: margen actualizado a `1 a 2 horas`
- Sección 10 agendamiento: +teléfono del tutor, +facilidad de estacionamiento, +si atención dentro o fuera del domicilio
- Referencia al título de sección 4 del KB actualizada al nuevo nombre

---

### Patrón de separación de reglas (decisión de diseño permanente)

**Regla establecida por el usuario:** las reglas de **negocio** van en documentos `knowledge_base`. `ai_behavior_rules` solo debe contener reglas **técnicas a nivel app** (cómo usar tools, formato de respuesta, restricciones del sistema). No duplicar lógica de negocio entre ambos. Si un cambio es de negocio (precios, horarios, sectores, márgenes), editar el KB.

---

## Estado actual de clínicas (2026-05-20)

### Animalgrace Linares y Talca (`fd11b7e4-...`)
- Recordatorios de citas: ✅ funcionando — 59 enviados, 25 fallidos en `reminder_logs`
- Recordatorios médicos: ✅ 4 pendientes para hoy (mayo 20), se envían esta noche
- Webhook HMAC: ✅ secret configurado
- Templates médicos: ✅ `recordatorio_vacunas`, `recordatorio_desparasitacion`, `seguimiento_medico`

### Animalgrace Santiago (`13472ea4-...`)
- Recordatorios de citas: ⏸️ **desactivados manualmente** — estaban fallando con 403 (`confirmacion_visita` no existe en WABA de Santiago) porque el AI agent aún no está activo y Claudia carga citas manualmente, por lo que los recordatorios se disparaban antes de tener templates configurados. Desactivar fue la solución correcta hasta tener templates listos.
- Recordatorios médicos: templates no configurados (`vaccine/deworming/checkup_reminder_template = null`)
- Webhook HMAC: ✅ secret configurado (`whsec_84...`) — verificación activa desde v205
- AI agent: ⏸️ no activo — Claudia ingresa citas manualmente al sistema

---

## Cambios realizados — mayo 2026 (sesión 4, 2026-05-20)

### Bug idempotencia `cron-process-reminders` — v16

**Problema raíz:** el check de idempotencia usaba `.maybeSingle()` para verificar si ya existía un log en `reminder_logs` antes de reintentar un envío. `.maybeSingle()` devuelve `null` cuando hay **más de una fila** (en vez de la esperada), lo que hacía que el check fallara silenciosamente. Resultado: una vez que una cita acumulaba 2+ registros `failed`, el cron la reintentaba en cada ejecución indefinidamente (cada hora).

**Evidencia:** Santiago tenía 5 citas de hoy con 5–8 intentos fallidos cada una, todos con error 403 `WHATSAPP_TEMPLATE_UNAVAILABLE`.

**Fix aplicado** (`cron-process-reminders` v16, deployado):
```typescript
// Antes (roto con >1 fila):
.maybeSingle()
if (existingLog) continue

// Después (correcto):
.limit(1)
if (existingLog && existingLog.length > 0) continue
```
Aplicado en PART 1 (check `type='24h'`) y PART 2 (check `type='2h'`).

### Defaults de `reminder_settings` — migración `reminder_settings_defaults_off`

**Problema raíz:** la tabla `reminder_settings` tenía `DEFAULT true` para `reminder_24h_before`, `reminder_2h_before` y `request_confirmation`. Clínicas nuevas como Santiago quedaban con recordatorios activados al guardar por primera vez la página de Recordatorios, antes de tener templates de WhatsApp configurados.

**Fix aplicado** (migración `20260520180000_reminder_settings_defaults_off.sql`):
```sql
ALTER TABLE reminder_settings
    ALTER COLUMN reminder_24h_before SET DEFAULT false,
    ALTER COLUMN reminder_2h_before  SET DEFAULT false,
    ALTER COLUMN request_confirmation SET DEFAULT false;
```
Nuevas clínicas ahora nacen con recordatorios desactivados y deben habilitarlos explícitamente.

### Contexto: recordatorios de Santiago

El cron actúa sobre **todas las citas** en la BD sin importar si el AI agent está activo. Claudia cargaba citas manualmente para Santiago → el cron las tomaba → intentaba usar el template `confirmacion_visita` (que no existe en el WABA de Santiago) → 403. Solución correcta: desactivar recordatorios hasta tener templates listos, lo que ya hizo el usuario desde Settings.

---

## Cambios realizados — mayo 2026 (sesión 5, 2026-05-20)

### Fix crítico: verificación HMAC — `ycloud-whatsapp-webhook` (v205)

**Síntoma:** Animalgrace Linares sin respuesta — 100% de los mensajes de WhatsApp rechazados con 401.

**Diagnóstico:** La implementación de `verifyYCloudSignature` tenía tres bugs que hacían fallar toda verificación real de YCloud:

1. **Payload incorrecto**: se firmaba solo `rawBody`, pero YCloud firma `{timestamp}.{rawBody}`
2. **Header mal parseado**: se comparaba el digest contra el header completo `t=...,s=...` en lugar de extraer solo el valor de `s`
3. **Decodificación del secret incorrecta** *(parcialmente arreglado en v205, corregido definitivamente en v209)*: se asumía formato Svix (base64-decode). YCloud en realidad usa el secret completo como clave UTF-8 directamente.

**Fix en `verifyYCloudSignature`:**
- Parsea el header `t={timestamp},s={signature}` extrayendo `t` y `s` por separado
- Firma `{timestamp}.{rawBody}` como payload
- Clave HMAC: `encoder.encode(secret)` — el string completo `whsec_...` como UTF-8 (NO decodificar base64)

**Nota:** Los bugs 1 y 2 se fijaron en v205/v206. El bug 3 (decodificación incorrecta) persistió hasta v209 (2026-05-21) cuando un diagnóstico empírico de 6 variantes HMAC confirmó que d3 (full key UTF-8) era el correcto.

**Deployed:** webhook v205 (bugs 1 y 2), v209 (bug 3 — fix definitivo)

---

## Cambios realizados — mayo 2026 (sesión 6, 2026-05-20)

### Auditoría general del sistema — bugs corregidos

#### `KnowledgeBase.tsx` — bug multi-tenant en logistics_config
`logisticsConfig` useState inicializado con 5 ubicaciones hardcodeadas de Animalgrace. Clínicas nuevas heredaban coordenadas de Animalgrace. Fix: estado inicial con `locations: [], is_active: false`.

#### `PatientProfile.tsx` — sex no formateado en header
`{patient.sex}` mostraba el código crudo ('M', 'H', 'MN', 'FN'). Añadida función `formatSex()` usando el mismo mapeo que `Patients.tsx` (`H`/`F`/`FN` → "Hembra", `M`/`MN` → "Macho").

#### `cron-process-surveys` — error 400 perpetuo (root cause)
La función usaba `reminder_settings!inner` en un join con `appointments`, pero no hay FK directa entre ellas (ambas se relacionan con `clinic_settings`). PostgREST falla en joins indirectos. Fix: dos queries separadas — `reminder_settings WHERE surveys_enabled = true` → clinic_ids → `appointments IN (clinic_ids)`. Imports modernizados a `npm:` + `Deno.serve()`. Deployado como v6.

#### `tagPatient` en `ycloud-whatsapp-webhook` — siempre fallaba silenciosamente
**Bug 1**: buscaba `patients.phone_number` — columna inexistente (los pacientes son mascotas; los teléfonos están en `tutors`).
**Bug 2**: insertaba en `patient_tags` — tabla que no existía.
Fix: lookup por `tutors.phone_number` → `patients WHERE tutor_id = tutor.id AND death_date IS NULL` → insertar en `patient_tags` por cada mascota activa. Tabla `patient_tags` creada via migración con RLS. Webhook redeployado.

#### Sistema de Campañas — reescritura completa
**Tabla `campaigns` no existía en producción** (migraciones locales no aplicadas).
**5 bugs corregidos:**
1. `campaigns` table y `get_estimated_audience` RPC creados via migración `20260520200000_create_campaigns_system.sql`
2. RLS migrada a `clinic_members` (multi-clínica)
3. `get_estimated_audience` ahora cuenta tutores únicos con teléfono (no pacientes), ya que los mensajes van al dueño
4. `send-whatsapp-campaign` reescrito: lee `inclusion_tags`/`exclusion_tags` (UUID arrays) en vez del campo legacy `segment_tag`; consulta `tutors` via `patients.tutor_id` para obtener el teléfono; deduplica por tutor (un mensaje por dueño aunque tenga N mascotas)
5. `Campaigns.tsx` `fetchTags`: `id: t.tag_name` → `id: t.tag_id` para que los arrays pasen UUIDs al RPC

#### `AICredits.tsx` — overflow de fecha en next_recharge
`new Date(year, month+1, 31)` desbordaba al mes siguiente si el mes destino tenía <31 días (ej: 31 enero → 31 marzo si febrero es el destino). Fix: helper `clampToMonth` que clampea el día al último día válido del mes antes de construir la fecha.

#### RLS habilitada en 6 tablas sin protección — migración `enable_rls_on_unprotected_tables`
Tablas afectadas: `vaccines` (57 filas activas), `deworming` (29 filas activas), `patient_files`, `notifications`, `user_profiles`, `platform_admins`. Todas expuestas a cualquier usuario autenticado.
- `vaccines` y `deworming`: policies `clinic_members` estándar (SELECT/INSERT/UPDATE/DELETE + service_role)
- `patient_files` y `notifications`: policies `clinic_members` estándar
- `user_profiles`: solo acceso a fila propia (`id = auth.uid()`) + service_role
- `platform_admins`: solo SELECT propio + service_role
- Nota: `vaccinations` y `dewormings` (con RLS) son tablas vacías nunca usadas. El frontend usa `vaccines`/`deworming` directamente.

#### Dead code upsell eliminado de `Settings.tsx`
El sistema de upsell automático fue desactivado pero dejó rastro: 3 variables de estado (`newUpsellEnabled/Days/Message`), columnas extra en SELECT, campos en `serviceData`, badge condicional en el listado de servicios, y resets en handlers de modal. Todo eliminado. La edge function `cron-process-upsell` sigue existiendo en el servidor pero no hay UI que la configure.

#### `ai-simulator` — sincronizado con tools del webhook
Tools añadidos al simulador: `confirm_appointment`, `escalate_to_human`, `reschedule_appointment`. Los handlers de simulación devuelven respuestas descriptivas indicando que es entorno de prueba. Deployado.

#### Etiquetas retroactivas — migración `retroactive_tags_animalgrace`
9 etiquetas creadas para ambas clínicas y asignadas automáticamente a pacientes existentes con reglas basadas en datos estructurados:

| Etiqueta | Regla | Linares | Santiago |
|---|---|---|---|
| Canino | `species IN ('Canino','Perro',...)` | 49 | 3 |
| Felino | `species IN ('Felino','Gato',...)` | 32 | 0 |
| No Esterilizado | `is_sterilized = false OR NULL` | 52 | 3 |
| Cachorro | `dob > now - 1 año` | 31 | 1 |
| Senior | perro > 7 años / gato > 10 años | 16 | 1 |
| Vacuna Pendiente | `vaccines.next_dose_date ≤ hoy + 60d` | 19 | 0 |
| Desparasitación Pendiente | `deworming.next_dose_date ≤ hoy + 60d` | 16 | 0 |
| Vacunado | cita con servicio LIKE '%vacun%' | 2 | 0 |
| Cirugía | cita con servicio LIKE '%cirug%' | 0 | 0 |

**Nota:** `Cirugía` y `Vacunado` tienen cobertura baja porque `appointments.patient_id`/`pet_id` no está consistentemente vinculado a `patients.id` en datos históricos. Las nuevas citas creadas vía AI agent sí quedan vinculadas. La migración es idempotente (`ON CONFLICT DO NOTHING`).

#### `Appointments.tsx` y `Settings.tsx` — auditoría de bugs (commit `8995a4c`)
4 bugs corregidos:
1. **`handleBlockSchedule`**: insertaba `duration: 60` — columna inexistente en `appointments`. Fix: `duration_minutes: 60`.
2. **`updateAppointmentStatus`**: `if (error) throw error` duplicado después de un bloque que ya hacía throw. Eliminado.
3. **Edit modal** (x2): `appointment.appointment_date.split('T')[1].slice(0, 5)` crasha si la fecha no tiene componente de hora. Fix: `(split('T')[1] ?? '00:00').slice(0, 5)`.
4. **`Settings.tsx` AI config**: fallback `data.ai_active_model || '4o'` usaba `'4o'` que no existe en el union type `'hybrid' | 'mini' | 'pro'`. Fix: fallback a `'hybrid'`.

---

## Cambios realizados — mayo 2026 (sesión 7, 2026-05-21)

### Fix crítico: derivación de clave HMAC — `ycloud-whatsapp-webhook` (v209)

**Síntoma:** Animalgrace Linares sin respuesta — 100% de los mensajes reales (`whatsapp.inbound_message.received`) rechazados con 401. Los eventos de tipo `whatsapp.message.updated` y `whatsapp.smb.message.echoes` pasaban con 200 porque **no activan el chequeo HMAC** (son status updates, no mensajes entrantes).

**Diagnóstico:** Proceso de 3 pasos:
1. Log de headers capturó que el header `ycloud-signature: t={ts},s={hex}` llegaba correctamente — no era un problema de nombre de header ni de formato de valor.
2. Log de 6 variantes HMAC probó simultáneamente distintas combinaciones de derivación de clave × payload:
   - d1: `HMAC(base64decode(secret[6:]), ts.body)` — **enfoque anterior (Svix)**
   - d2: `HMAC(UTF-8(secret[6:]), ts.body)`
   - **d3: `HMAC(UTF-8(secret_completo), ts.body)` → `d3_match: true` en los 4 mensajes capturados ✅**
   - d4–d6: variantes sin timestamp → todas falsas
3. Fix aplicado y verificado: los siguientes 2 mensajes de Linares respondieron 200 inmediatamente.

**Root cause:** La implementación asumía formato Svix (decodificar la parte base64 de `whsec_<base64>`). YCloud usa el string completo del secreto como clave HMAC en UTF-8, sin ninguna decodificación. El `whsec_` es solo un prefijo visual en el dashboard, no indica base64.

**Fix en `verifyYCloudSignature` (1 línea efectiva):**
```typescript
// ANTES — incorrecto:
const secretBytes = secret.startsWith("whsec_")
  ? Uint8Array.from(atob(secret.slice(6).replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0))
  : encoder.encode(secret);

// DESPUÉS — correcto:
const secretBytes = encoder.encode(secret);
```

**Impacto:** Fix aplica a ambas clínicas (Linares y Santiago). Ambas fallaban por el mismo bug. Verificado con 200s inmediatos en v209.

**Estado post-fix:**
- Animalgrace Linares: ✅ webhook HMAC verificando correctamente — IA respondiendo
- Animalgrace Santiago: ✅ webhook HMAC verificando correctamente (IA aún inactiva, citas manuales)

---

## Cambios realizados — mayo 2026 (sesión 8, 2026-05-22)

### Sistema de diseño — tokens y colores por sección

**Paleta de sección establecida** (decisión de diseño permanente):
| Sección | Color | Páginas |
|---|---|---|
| Principal | `sky` (celeste de marca) | Dashboard, Mensajes, Plantillas |
| Clínica | `primary` (teal #0d9488) | Tutores, Pacientes, CRM, Citas, Recordatorios, Finanzas |
| Marketing | `violet` | Campañas, Referidos |
| Configuración | `amber` | Conocimiento, Fidelización, Configuración |
| Finance especial | `emerald` | sección interna de Finance |
| Loyalty especial | `accent/gold` | sección interna de Loyalty |

**Limpieza de tokens heredados completada:**
- `bg-gray-*` / `border-gray-*` / `text-gray-*` eliminados de todas las páginas
- Reemplazados por: `bg-ivory`, `bg-silk-beige`, `border-silk-beige`, `text-charcoal`, `text-charcoal/60`, `text-charcoal/40`
- Archivos actualizados: `Loyalty.tsx`, `src/pages/settings/Team.tsx`, `src/pages/settings/MyProfile.tsx`, y todas las páginas principales

### Dashboard — tarjetas con cabeceras de degradado

Patrón de card con header colorido + body blanco (inspirado en la landing):
```tsx
<div className="bg-white rounded-2xl border border-silk-beige shadow-sm overflow-hidden">
    <div className="bg-gradient-to-br from-[color]-500 to-[color]-700 p-5 text-white">
        <p className="text-xs font-bold uppercase tracking-widest text-[color]-200 mb-1">Etiqueta</p>
        <h3 className="text-lg font-extrabold tracking-tight">Título</h3>
    </div>
    <div className="p-5">...</div>
</div>
```
Colores aplicados en Dashboard: `primary` (Citas), `sky` (Mensajes), `amber` (Top Servicios), `emerald` (Conversión), `violet` (NPS).

### Banner de página — patrón por sección (piloto: Tutores)

Reemplaza el header plano con un banner de degradado que incluye:
- Label de sección (`text-xs font-black uppercase tracking-widest text-[color]-200`)
- Título grande + descripción
- Fila de estadísticas con divisores verticales (`w-px h-8 bg-white/15`)
- Botones de acción como pills blancos (`bg-white text-[color]-700`)

Implementado en `Tutors.tsx`. Pendiente aplicar al resto de páginas (ver Tareas pendientes).

### PatientProfile — panel de resumen clínico

Panel insertado entre las tarjetas de estadísticas y las pestañas principales. Se renderiza solo cuando hay datos (`historyEvents || vaccines || dewormings`).

**4 columnas del panel:**
1. **Última Atención Médica**: `historyEvents[0]` — muestra `event_date` + `event_type`. Solo consultas médicas/controles (no vacunas/desparasitaciones).
2. **Próxima Vacuna**: `vaccines[0].next_dose_date` con alertas de color (rojo=vencida, ámbar=≤30 días, verde=al día).
3. **Última Desparasitación**: bucle sobre `['Interno', 'Externo']` → `dewormings.find(d => d.type === tipo)` con fecha del último registro de cada tipo.
4. **Últimas Atenciones**: array mezclado de historyEvents + vaccines + dewormings ordenado por fecha DESC, sliceado a 3, con puntos de color (teal=historia, emerald=vacuna, amber=desparasitación).

Nota clínica al pie: `historyEvents[0]?.diagnosis || historyEvents[0]?.procedure_notes`.

### Navegación — fix breadcrumb tutor + auto-apertura

**Bug corregido:** el nombre del tutor en el breadcrumb de PatientProfile era `<span>` estático y no navegaba.

**Fix aplicado:**
```tsx
// PatientProfile.tsx — breadcrumb
<button
    onClick={() => navigate('/app/tutors', { state: { tutorId: tutor?.id } })}
    className="text-charcoal/60 hover:text-primary-600 transition-colors"
>
    {tutor?.name}
</button>
```

**Auto-apertura en Tutors.tsx:**
```tsx
useEffect(() => {
    const tutorId = (location.state as any)?.tutorId
    if (tutorId && contacts.length > 0) {
        const contact = contacts.find(c => c.id === tutorId)
        if (contact) {
            setSelectedContact(contact)
            navigate('/app/tutors', { replace: true, state: {} })
        }
    }
}, [contacts, location.state])
```
Patrón: `navigate('/app/tutors', { state: { tutorId } })` → `useLocation` → `useEffect` auto-abre el panel del tutor.

### TutorDetails — rediseño completo

Reemplazó el header plano y tabs básicos con:
- **Banner teal con gradiente**: botón "← Tutores", avatar con iniciales, teléfono/email inline, stats Mascotas/Citas
- **Nueva barra de tabs**: `h-14`, `font-black uppercase tracking-widest`, borde inferior activo `h-1 bg-primary-600`
- **Tarjetas de mascotas enriquecidas**: tira header `bg-primary-50` con avatar/nombre/raza/badge de estado, body con cálculo de edad correcto (meses para <1 año), botones edit/delete al hacer hover

**Bug corregido en TutorDetails.tsx** — crash en runtime (`cn is not defined`):
- `cn` se usaba en el rediseño pero no estaba importado
- `Calendar` se importaba pero no se usaba
- Fix: `import { formatPhoneNumber, cn } from '@/lib/utils'` + eliminado `Calendar` de lucide imports

---

## Cambios realizados — mayo 2026 (sesión 9, 2026-05-22)

### Auditoría de 4 bugs reportados desde conversaciones reales de WhatsApp

Claudia reportó respuestas erróneas del AI agent (precios mal, "problema técnico"). Diagnóstico completo de 4 bugs, todos corregidos.

**Nota de IDs (corregir asunción previa del CLAUDE.md):** el `clinic_id` real de Santiago es `13472ea4-4da6-461c-9a80-a5c970d9ec73` (no el placeholder genérico). El de Linares es `fd11b7e4-7d96-461c-a292-2caa5e2592ce`. Las `ai_behavior_rules` viven en `clinic_settings` y se buscan por la columna `id` (= clinic_id), no por una columna `clinic_id`.

#### Bug 1 — Esterilización gata Linares cotizada en $85.000 (correcto: $65.000)
**Causa raíz:** la sección 7 (CIRUGÍAS MUNDO B) del `ai_behavior_rules` de Linares tenía el monto `$85.000` **como ejemplo literal** (`Entrega un VALOR TOTAL ÚNICO (ej: "$85.000 todo incluido")`). El modelo anclaba en el número del ejemplo en vez de consultar la MATRIZ. Casualmente $85.000 = precio de perra hembra 5-12kg T1, lo que reforzaba el error.
**Fix:** ejemplo reemplazado por instrucción de consultar siempre `#MATRIZ_PRECIOS_Y_PROTOCOLO_CIRUGIAS`. Editado vía SQL en `clinic_settings.ai_behavior_rules` (Linares). **Lección: nunca poner montos concretos como ejemplo en un prompt de precios.**

#### Bug 2 — Castración gato Santiago cotizada en $50.000 (correcto: $70.000) + nunca pidió peso
**Causa raíz:** el protocolo de cirugías (sección 6) de Santiago tenía 4 pasos donde el **PASO 3 era "sugiere pack prequirúrgico por $50.000"** y NUNCA existía un paso para entregar el precio de la cirugía ni para pedir el peso (necesario en caninos). El modelo leyó el $50.000 del examen y lo dio como precio de la cirugía.
**Fix:** protocolo reescrito a 6 pasos: 1-Ubicación, 2-Especie+Género, 3-Peso (solo perros), 4-Precio de la cirugía (gato=$70.000, perros por tabla), 5-Exámenes $50.000 (explícitamente separado de la cirugía), 6-Cierre. Editado vía SQL.

#### Bug 3 — Quinta Normal cotizada con recargo $6.000 (correcto: $0; $6.000 es solo Las Condes)
**Causa raíz (estructural, NO alucinación aleatoria):** el routing híbrido tiene dos listas. `selectModelTier()` evalúa el mensaje del **usuario** (cirugía/castración/esterilización → 4o). `schedulingSignals` (call site, ~línea 3684) evalúa los mensajes **outbound** para activar `activeSchedulingFlow` y mantener el flujo en 4o. Cuando el usuario respondió solo `"Quinta Normal"` (sin keywords), la única salvación era `activeSchedulingFlow` — pero la IA había preguntado por "comuna"/"cobertura" y esas palabras **no estaban en `schedulingSignals`**, así que el flujo cayó a mini, que alucinó el recargo.
**Fix:** agregadas `comuna`, `cobertura`, `recargo`, `castr`, `cirug`, `esteril` a `schedulingSignals`. Ahora, cuando la IA pregunta la comuna o está en flujo quirúrgico, las respuestas del usuario se mantienen en 4o. Fix de código (deploy).

#### Bug 4 — "Lo siento, tuve un problema técnico" (el más grave)
**Causa raíz:** `ReferenceError: isAnimalGrace is not defined` (confirmado en `debug_logs`). En `checkAvail()`, `const isAnimalGrace` se declaraba **dentro del bloque `if (date === localDate)`** (block scope) pero se usaba fuera, en el bloque de logística móvil (líneas 1170/1289/1331). Cuando se agendaba para una **fecha futura** (no hoy), ese bloque no se ejecutaba, la variable nunca se declaraba, y al usarla lanzaba ReferenceError → catch-all global → mensaje de "problema técnico". **Afectaba a AMBAS clínicas** y bloqueaba por completo cualquier agendamiento de fecha futura en clínica móvil con coordenadas.
**Diagnóstico falso descartado:** NO era el KB. Las comunas reportadas (La Cisterna, Lo Prado) sí estaban/quedaron bien en el KB. La Cisterna se agregó al Tramo A de todos modos (faltaba), pero NO era la causa.
**Fix:** `const isAnimalGrace = clinicId === CLINIC_ANIMALGRACE_ID;` movido al scope de la función `checkAvail` ([index.ts](supabase/functions/ycloud-whatsapp-webhook/index.ts), ~línea 1041). Fix de código (deploy).

### Resumen de capas tocadas
- **DB producción (activo inmediato):** `ai_behavior_rules` Linares (bug 1) + Santiago (bug 2); `knowledge_base` Santiago La Cisterna (bug 4 parcial). Editados vía `execute_sql` con `REPLACE`. **Ojo:** los REPLACE multilínea requieren notación `E'...\n...'` para que los saltos de línea coincidan con lo almacenado.
- **Código (requiere deploy):** bug 3 (`schedulingSignals`) + bug 4 (`isAnimalGrace` scope). Webhook redeployado.
- Recordatorio: los fixes de KB/prompt viven solo en la DB, no en migraciones del repo. Un reset/restore desde migraciones los perdería.

### Monitoreo post-deploy agendado
- Rutina remota programada (claude.ai/code/routines): `trig_01EMWGpcbWJ9wbLDEaFgL5P7` — corre una vez el **2026-05-23 16:00 UTC (12:00 Chile)**. Consulta `debug_logs` por reaparición de `isAnimalGrace is not defined` / `Async Process Error` desde el deploy v211 y confirma que el webhook responde 200 en v211. Solo lectura, reporta veredicto.

---

## Patrones adicionales a respetar

### Modelo de datos: patients vs tutors
- `patients` = mascotas. **No tienen `phone_number` ni `full_name`**. Campos: `name`, `tutor_id`, `species`, `breed`, `sex`, `dob`, `death_date`, etc.
- `tutors` = dueños humanos. Tienen `phone_number`, `name`.
- Cualquier operación que requiera contactar a alguien (WhatsApp, recordatorios, campañas) debe ir vía `tutors`.

### Campañas — flujo de segmentación
- Tags se guardan en `patient_tags` (junction table, `patient_id` + `tag_id`)
- El RPC `get_tag_counts(p_clinic_id)` devuelve `tag_id` (UUID) + `tag_name` + `contact_count`
- El frontend usa `tag_id` como el `id` de cada Tag (UUID real, no el nombre)
- `get_estimated_audience(clinic_id, inclusion_tags UUID[], exclusion_tags UUID[])` cuenta tutores únicos con teléfono
- `send-whatsapp-campaign` lee `campaign.inclusion_tags` / `campaign.exclusion_tags` (JSONB con UUIDs)

---

## Tareas pendientes

### Alta prioridad
- [ ] **Animalgrace Santiago — templates de recordatorios**: recordatorios desactivados hasta que se creen los templates en YCloud dashboard de Santiago (`confirmacion_visita` o `24hrs_recordatorio_cita`). Una vez creados, reactivar desde Settings → Recordatorios.
- [ ] **`logistics_config.routing_mode`** — mover la lógica de `CLINIC_ANIMALGRACE_ID` y `CLINIC_SANTIAGO_ID` a un campo en `clinic_settings` para que sea configurable sin deploy. Requiere migración de datos y actualizar `checkAvail()` para leer `logisticsConfig.routing_mode` en vez de comparar por ID.

### Media prioridad
- [ ] **N+1 en `processFunc`** — `check_availability` hace múltiples queries seriales a Supabase (servicios, profesionales, slots, citas del día). Candidato a `Promise.all` donde no haya dependencia.
- [ ] **`getKnowledge` en el simulador** — usa filtrado por `ilike` directo en DB en vez del scoring en memoria del webhook. Considerar unificar el approach.
- [ ] **Templates médicos de Santiago**: configurar `vaccine_reminder_template`, `deworming_reminder_template`, `checkup_reminder_template` en `clinic_settings` de Santiago para que PART 4 del cron pueda enviar recordatorios médicos.
- [ ] **`appointments.patient_id`/`pet_id` sin FK consistente** — las citas históricas no vinculan correctamente a `patients.id`, por lo que tags `Cirugía` y `Vacunado` tienen cobertura baja. Las nuevas citas creadas vía AI agent sí quedan vinculadas.

### Baja prioridad
- [ ] **Banner de sección en páginas restantes**: aplicar el patrón de banner con degradado (piloto: Tutores) a: Patients, CRM, Appointments, Reminders, Finance, KnowledgeBase, Campaigns, Messages, Templates, Settings, Loyalty. Cada una con el color de su sección (ver paleta en sesión 8).
- [ ] **`_shared/cors.ts`** — el CORS de `chat-agent` usa este archivo (`*`). Documentar explícitamente por qué es `*` (browser widget, no webhook) para que nadie lo "corrija" innecesariamente.
- [ ] **Cleanup de archivos `check_*.js`** en la raíz — 50+ scripts de debugging acumulados, no forman parte del proyecto, pueden eliminarse.
- [ ] **`user_profiles.clinic_id` de usuarios sin clínica** — `claubarreraolivero@gmail.com` y otros tienen `clinic_id = NULL`. No bloquea el flujo actual (la RLS de `reminder_logs` usa `clinic_members`), pero es inconsistente.

---

## Roadmap próximas sesiones

### Agente de Soporte Técnico Autónomo
- Monitor de salud (cron cada 5 min revisando sistemas críticos)
- Agente diagnóstico con Claude Sonnet + acceso a logs y DB de Supabase
- Sistema de fixes automáticos para casos comunes:
  - Recordatorios no enviados → reintento automático
  - Errores de WhatsApp → diagnóstico YCloud/OpenAI
  - Citas mal agendadas → corrección en DB
  - Errores de pago → diagnóstico MercadoPago
- Notificaciones al dueño vía WhatsApp cuando algo falla
- Fixes de código → crea PR en GitHub para aprobación manual
