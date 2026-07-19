# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Vetly — Guía para Claude

SaaS veterinario para clínicas móviles a domicilio. Permite agendar citas vía WhatsApp con un AI agent, gestionar pacientes, enviar recordatorios y campañas, y procesar pagos.

---

## Comandos de desarrollo

```bash
npm run dev          # Servidor local (Vite, puerto 5173+)
npm run build        # tsc -b && vite build — lo que corre en Vercel
npx tsc --noEmit     # Verificar tipos sin generar archivos
npm run lint         # ESLint sobre todo el proyecto
npm run preview      # Preview del build de producción local
```

**Edge Functions Supabase:**
```bash
supabase functions deploy <nombre>          # Deploy de una función específica
supabase functions deploy --no-verify-jwt <nombre>  # Para webhooks externos
supabase db push                            # Aplicar migraciones pendientes
```

**Regla de build:** `npm run build` es la única forma de detectar errores TS que `--noEmit` a veces pasa. Correr antes de cada PR importante.

**No hay test suite configurado.** La verificación es manual + TypeScript estricto.

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

### Sectorización AnimalGrace — `getSectorAG` (fuente única de verdad)
`getSectorAG(addr, lat)` es el único helper para clasificar una dirección como "Linares" o "Talca". Vive en `ycloud-whatsapp-webhook/index.ts`. **Regla crítica: siempre verificar `linaresCommunes` ANTES que `talcaCommunes`.**

```typescript
const getSectorAG = (addr: string | null, lat: number | null): "Linares" | "Talca" | null => {
  const norm = (addr || "").toLowerCase();
  const linaresCommunes = ["linares", "colbun", "colbún", "longavi", "longaví", "parral", "retiro", "san javier", "villa alegre", "yerbas buenas"];
  const talcaCommunes = ["talca", "constitucion", "constitución", "curepto", "empedrado", "maule", "pelarco", "pencahue", "rio claro", "río claro", "san clemente", "san rafael"];
  if (linaresCommunes.some(k => norm.includes(k))) return "Linares";
  if (talcaCommunes.some(k => norm.includes(k))) return "Talca";
  if (lat !== null) return lat <= -35.55 ? "Linares" : "Talca";
  if (!addr || addr.trim() === "") return "Linares";
  return null;
};
```

**Por qué el orden importa:** "Maule" es tanto una **REGIÓN** (aparece en todas las direcciones de Linares: `"..., Linares, Maule"`) como una **COMUNA** del sector Talca. Si se chequea Talca primero, cualquier dirección de Linares con `lat=null` quedaba clasificada como Talca. Al chequear Linares primero, `"linares"` hace match antes de llegar a `"maule"`.

**No duplicar esta lógica.** Antes había 3 implementaciones inconsistentes en `checkAvail()`. Todo el código que necesite el sector de una cita móvil debe llamar a `getSectorAG`.

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

## Cambios realizados — mayo 2026 (sesión 11, 2026-05-23)

### Migración de planes: essence/radiance/prestige → core/starter/pro/enterprise

**Motivación:** la UI de Settings mostraba los planes con los nombres y precios legacy (Essence $93.000, Radiance $150.000, Prestige $335.000). Los planes actuales de la landing son Core/Starter/Pro/Enterprise.

**Archivos actualizados:**
- **`src/lib/mercadopago.ts`**: `PLANS` reemplazado con los 4 planes nuevos (Core $33.000, Starter $89.000, Pro $149.000, Enterprise $349.000 CLP). Agregadas `PLAN_LEGACY_MAP` y `normalizePlanId()` para backward compat con registros DB existentes que siguen almacenando `'radiance'` etc.
- **`src/types/database.ts`**: 6 union types expandidos para incluir los 4 IDs nuevos además de los 3 legacy — la DB sigue almacenando valores viejos, el frontend normaliza al leer.
- **`src/components/common/PremiumFeature.tsx`**: `planOrder = ['core','starter','pro','enterprise']`, `legacyMap` para normalizar IDs legacy al comparar.
- **`src/pages/Register.tsx`**: lista de planes actualizada a Core/Starter/Pro/Enterprise, default `'pro'`.
- **`src/pages/Landing.tsx`**: planes del React landing actualizados con features y precios nuevos.
- **`src/pages/settings/Team.tsx`**: `PLAN_LIMITS` con los 4 planes nuevos + legacy como fallback; fallback de `subData.plan` cambiado de `'essence'` a `'starter'`.
- **`src/components/layout/BranchSwitcher.tsx`**: `canCreateBranch` acepta `'enterprise'` y `'prestige'` para compatibilidad.
- **`src/pages/hq/AdminDashboard.tsx`**: lógica Enterprise acepta ambos IDs (`'enterprise' || 'prestige'`).
- **`src/pages/Settings.tsx`**: `isRadiance` → `isPro`, grid de 4 columnas para los 4 planes.

**Nota permanente:** los registros en `subscriptions.plan` siguen con valores legacy. Siempre usar `normalizePlanId()` (de `src/lib/mercadopago.ts`) antes de comparar planes. Nunca hardcodear `'essence'`, `'radiance'` o `'prestige'` en código nuevo.

### Navegación — fix duplicado Referidos / Fidelización

**Problema:** el sidebar tenía dos ítems para la misma página (`/app/loyalty`): "Referidos" bajo Marketing y "Fidelización" bajo Configuración. Hacer clic en "Referidos" no cambiaba el tab porque React no re-monta el componente al cambiar solo los query params.

**Fixes:**
- `DashboardLayout.tsx`: eliminado ítem "Referidos" de Marketing. Fidelización movida de Configuración a Marketing.
- `Loyalty.tsx`: agregado `useEffect` que escucha cambios en `searchParams` y llama `setActiveTab` — corrige el bug donde navegar a `?tab=referrals` desde el mismo componente no actualizaba el tab.

**Estructura final del sidebar:**
- MARKETING: Campañas, Fidelización
- CONFIGURACIÓN: Conocimiento, Configuración

### Loyalty — color de banner actualizado a violet (Marketing)

El banner pasó de `from-accent-500 to-accent-700` (gold) a `from-violet-500 to-violet-700` (violet), consistente con la sección de Marketing. Label cambiado de "Configuración" a "Marketing".

---

## Cambios realizados — mayo 2026 (sesión 10, 2026-05-23)

### Push a GitHub — sincronización del repositorio
- 10 commits acumulados desde sesión 7 (incluyendo todos los fixes de sesiones 7–9) estaban solo en local.
- Causa del bloqueo: `git push` via HTTPS requiere Personal Access Token desde que GitHub deprecó autenticación por contraseña.
- Fix: token generado en github.com → Settings → Developer settings → Personal access tokens → Tokens (classic), scope `repo`, **sin expiración**.
- Token configurado con `git remote set-url origin https://<token>@github.com/sbarreraolivero-sketch/vetly_app`.
- Push exitoso: rama `main` en GitHub sincronizada hasta commit `57cbff0` (docs: rutina de monitoreo).
- El token queda persistido en la URL del remote — próximos `git push` desde este proyecto funcionan sin configuración adicional.

---

## Patrones adicionales a respetar

### Modelo de datos: patients vs tutors
- `patients` = mascotas. **No tienen `phone_number` ni `full_name`**. Campos: `name`, `tutor_id`, `species`, `breed`, `sex`, `dob`, `death_date`, etc.
- `tutors` = dueños humanos. Tienen `phone_number`, `name`.
- Cualquier operación que requiera contactar a alguien (WhatsApp, recordatorios, campañas) debe ir vía `tutors`.

### Campañas — flujo de segmentación
- Tags de tutor se guardan en `tutor_tags` (junction table, `tutor_id` + `tag_id`) — fuente de verdad para el frontend
- El RPC `get_tag_counts(p_clinic_id)` devuelve `tag_id` (UUID) + `tag_name` + `contact_count`
- El frontend usa `tag_id` como el `id` de cada Tag (UUID real, no el nombre)
- `get_estimated_audience(clinic_id, inclusion_tags UUID[], exclusion_tags UUID[])` cuenta tutores únicos con teléfono
- `send-whatsapp-campaign` lee `campaign.inclusion_tags` / `campaign.exclusion_tags` (JSONB con UUIDs)

### `logistics_config.routing_mode` — configuración sin deploy (sesión 24)
Para agregar una nueva clínica de veterinaria móvil con lógica de sectores (tipo Animalgrace):
1. Agregar en su `clinic_settings.logistics_config`: `{"routing_mode": "mobile_sectors"}`
2. Si usa zonas RM Santiago: agregar `{"routing_zone": "rm_santiago", "fallback_lat": lat, "fallback_lng": lng}`
3. No se requiere deploy — el webhook lee estos valores en cada request

`CLINIC_ANIMALGRACE_ID` y `CLINIC_SANTIAGO_ID` siguen definidas como constantes en el webhook pero **ya no se usan en lógica** — solo como referencia documentaria.

### `_shared/cors.ts` — `*` es intencional
El CORS de `_shared/cors.ts` usa `Access-Control-Allow-Origin: '*'` por diseño. Lo usan funciones llamadas desde el **browser** (`chat-agent`, `ai-simulator`). Los webhooks externos (YCloud, MercadoPago, LemonSqueezy) definen sus propios headers CORS restrictivos en cada función. No "corregir" este `*`.

### Créditos IA — fuente única de verdad (sesión 23, actualizado sesión 36)
- **Tabla `messages`** es la fuente de verdad para calcular créditos consumidos en `AISettings.tsx`:
  ```
  totalUsed = miniMessages×1 + (standardMessages + proMessages)×15
  ```
  `4o_standard` es etiqueta histórica (código muerto — nunca se asigna en el routing actual). Todo 4o nuevo se etiqueta `4o_pro`. Ambos cuestan **15 créditos** por mensaje.
- **`clinic_settings.ai_credits_monthly_mini_used` / `ai_credits_monthly_4o_used`** son contadores auxiliares para el credit check en el webhook. No son retroactivos (empezaron en 0 al deployarse). **No usarlos para mostrar créditos usados en la UI.**
- **`ai_credit_transactions`** es la fuente de verdad para el historial y los resúmenes de recarga/consumo. Se rellena automáticamente por cada mensaje (webhook v216+) y cada compra de pack.
- **RPC `get_credit_history_summary(p_clinic_ids, p_month_start, p_month_end)`** — agrega totales server-side. Usar siempre para calcular resúmenes de historial; nunca fetchear filas individuales en el cliente y sumar (PostgREST limita a 1.000 filas en silencio).

### Límites de plan y sucursales — reglas permanentes
- Los **créditos mensuales** por plan son: Core=0, Starter=5.000, Pro=10.000, Enterprise=30.000
- El plan **Enterprise** permite hasta **3 sucursales totales** (raíz + 2 adicionales). El RPC `create_clinic_branch` bloquea con excepción si `count(owner clinics) >= 3`
- Para cambiar precios o créditos, actualizar en **5 lugares**: `lemonsqueezy.ts`, `mercadopago.ts`, `lemonsqueezy-webhook` (subscription_created), `mercadopago-webhook` (subscription sync), `public/landing.html`
- Las cuentas `manually_active = true` se rigen por `clinic_settings.max_users` (no por el plan derivado de `subscriptions.plan`). El RPC `invite_member_v2` respeta este flag.

### Packs de créditos extra — reglas permanentes
- Los packs expiran a los **30 días** de la compra (`ai_credits_extra_expires_at`)
- El cron `cron-expire-extra-credits` corre diariamente a las 02:00 UTC y zeroes los balances vencidos
- Los créditos del plan base (`ai_credits_monthly_limit`) se renuevan mensualmente en la fecha de creación de la clínica (función `process_monthly_recharge`)
- Al comprar pack: siempre setear `ai_credits_extra_expires_at = NOW() + 30 días` e insertar transacción `type: 'purchase'`

---

## Cambios realizados — mayo 2026 (sesión 12, 2026-05-23)

### Suscripciones — estado "Inactivo" falso para Animalgrace

**Problema:** el badge de Settings mostraba "INACTIVO" para Animalgrace porque MercadoPago guarda `status = "trialing"` para suscripciones pagadas, y el frontend solo reconocía `"active"`.

**Fix:**
- **Migración `add_manually_active_to_subscriptions`**: columna `manually_active BOOLEAN DEFAULT false` añadida a `subscriptions`. Animalgrace Linares y Santiago tienen `manually_active = true` (pagan por transferencia bancaria, no vía MercadoPago).
- **`Settings.tsx`**: badge usa `subscription?.manuallyActive || status === 'active'`. Las demás clínicas muestran su estado real de MercadoPago. Botón de cancelar solo aparece con `status = 'active'` real.
- **Para autorizar manualmente una nueva clínica que pague por transferencia:** `UPDATE subscriptions SET manually_active = true WHERE clinic_id = '...'`

### Magic Link de Referidos — ahora genera enlace WhatsApp

**Problema:** el botón "Magic Link" en Fidelización copiaba `${origin}/r/{code}`, una URL interna inexistente.

**Fix en `Loyalty.tsx`:**
- Obtiene `ycloud_phone_number` de `clinic_settings` en el fetch inicial.
- `copyReferralLink(code, tutorName)` genera `https://wa.me/{phone}?text=Hola! Me contacto de parte de {tutorName} 🐾 Mi código de referido es *{code}*...`
- El amigo hace clic → abre WhatsApp con la clínica → mensaje pre-escrito con el código del referidor.

### CRM — prospectos no visibles en el kanban

**Causa raíz:** cuando el webhook creó los primeros prospectos, `crm_pipeline_stages` estaba vacía → `defaultStageId = undefined` → `stage_id = null` en DB. El kanban filtraba por `stage_id === stage.id`, así que todos quedaban invisibles.

**Fix:**
- **SQL retroactivo:** 70 prospectos asignados al stage "Nuevo Prospecto" (position=0) de su clínica.
- **`CRM.tsx`:** primera columna del kanban también captura `stage_id = null` como red de seguridad.

### Etiquetas — RLS bloqueaba toda lectura de la tabla `tags`

**Causa raíz:** la tabla `tags` tenía RLS habilitada pero **sin ninguna política** → cualquier query desde el frontend devolvía vacío silenciosamente. Por eso Settings → Etiquetas siempre mostraba "No hay etiquetas creadas aún" aunque hubiera 22 en la DB.

**Fix — migración `add_rls_policies_tags_table`:** políticas SELECT/INSERT/UPDATE/DELETE vía `clinic_members` + service_role. Ahora los tags son visibles en Settings y en el CRM.

### Etiquetas en Tutores — tabla incorrecta en el webhook

**Causa raíz (estructural):** hay DOS tablas de junction para tags:
- `tutor_tags` (`tutor_id + tag_id`) — lo que leen los RPCs `get_unified_contacts` y `get_tag_counts`
- `patient_tags` (`patient_id + tag_id`) — donde el webhook `tagPatient` insertaba (tabla creada en sesión 6)

El webhook insertaba en la tabla equivocada → nunca aparecían tags en la vista de Tutores.

**Fix:**
- **Migración `populate_tutor_tags_from_patient_tags`:** 183 registros migrados de `patient_tags` → `tutor_tags` vía `patients.tutor_id`. Los tutores de Linares y Santiago ahora tienen sus etiquetas asignadas.
- **Webhook `tagPatient` (v212):** reescrito para insertar directamente en `tutor_tags` por `tutor_id` (una sola fila por tutor, no un loop por mascota). Código `23505` (unique violation) ignorado silenciosamente para idempotencia.
- Deploy: `ycloud-whatsapp-webhook` v212.

### Regla permanente — sistema de tags

- `tutor_tags` es la fuente de verdad para el frontend (Tutores, Campañas, CRM).
- `patient_tags` sigue existiendo pero solo para usos futuros a nivel de mascota individual.
- Cualquier nueva asignación de tag desde el webhook debe ir a `tutor_tags`.
- Los RPCs `get_unified_contacts` y `get_tag_counts` leen de `tutor_tags` (y `crm_tags` para prospectos CRM).

---

## Cambios realizados — mayo 2026 (sesión 13, 2026-05-24)

### PetForm — separación de sexo y esterilización

**Problema:** el formulario de edición de mascotas mezclaba sexo y esterilización en un solo campo ("Macho castrado", "Hembra esterilizada").

**Fix en `src/components/patients/PetForm.tsx`:**
- `sexOptions` reducido a solo `[Macho, Hembra]` — siempre 'M' o 'F', nunca 'MN'/'FN'
- Backward compat en `useEffect`: `MN → M + is_sterilized:true`, `FN → F + is_sterilized:true`, `H → F`
- Nuevo toggle independiente "Esterilizado/a" con Sí (emerald) / No (charcoal/10)
- `petData.sex` guardado siempre como 'M' o 'F'; `is_sterilized` como campo separado

**Trigger DB — `tr_update_sterilized_tag_on_patient_change`:**
- Se dispara en UPDATE de `patients.is_sterilized`
- Si `is_sterilized = true` → elimina la etiqueta "No Esterilizado" del tutor en `tutor_tags`
- Si `is_sterilized = false` → inserta etiqueta "No Esterilizado" en `tutor_tags` (si existe el tag para esa clínica)
- Idempotente en ambas direcciones

### Tutors.tsx — fix delay en breadcrumb y auto-apertura

**Problema:** al navegar desde PatientProfile al tutor, la página cargaba con 400–500ms de delay antes de abrir el panel del tutor, porque el debounce de búsqueda se aplicaba también a la carga inicial.

**Fix:** separados en dos `useEffect` independientes:
```tsx
// Carga inmediata al cambiar clínica
useEffect(() => { fetchContacts(); fetchTagSummaries() }, [profile?.clinic_id])

// Debounce solo para búsqueda
useEffect(() => {
    if (!searchQuery) return
    const timer = setTimeout(() => fetchContacts(), 400)
    return () => clearTimeout(timer)
}, [searchQuery])
```

### LoyaltyRewardModal — correcciones de texto

- Opción "Tratamiento / Producto" → **"Servicio / Producto"**
- Helper text: `'Elige "Tratamiento" para que sea gratis'` → `'Elige "Servicio/Producto" para que sea gratis.'`
- Placeholder descripción → `'Válido para cualquier vacuna...'`

### Loyalty.tsx — color título "Reglas de Bienvenida"

El `h3` del card de Reglas de Bienvenida tenía `text-charcoal` sobre fondo de degradado oscuro. Fix: `className="text-lg font-bold mb-2 text-white"`.

### CRM — cierre automático y toggle "Cerrados"

**Problema:** los prospectos en "Cita agendada" acumulaban indefinidamente sin moverse aunque la cita ya hubiera pasado.

**Migración `cron_auto_close_crm_prospects`:**
- Función `auto_close_crm_prospects()`: mueve prospectos con `appointment_date < NOW()` del stage "Cita agendada" al stage "Cerrado" de su clínica
- pg_cron schedule: ejecuta diariamente a las 06:00 UTC

**`CRM.tsx`:**
- Estado `showClosed` (default `false`) — oculta la columna "Cerrado" por defecto
- Toggle "Cerrados" en la barra de filtros con badge del conteo
- Primera columna del kanban también captura `stage_id === null` como red de seguridad

### Planes — alineación exacta con Landing.tsx

La landing es la fuente de verdad. Todos los archivos de planes actualizados para coincidir exactamente:

**`src/lib/mercadopago.ts` (CLP):**
- Starter: `2.000` → `1.000` créditos; eliminado "Sistema de referidos con IA"
- Pro: tagline → "Para clínicas en crecimiento"; features[0] → "5 usuarios · 5 agendas"
- Enterprise: precio `$335.000` → `$349.000`

**`src/lib/lemonsqueezy.ts` (USD):**
- Core: precio `$39` → `$33`; features reducidas a 6 (igual que landing)
- Starter: precio `$99` → `$89`; `2.000` → `1.000` créditos; eliminado "Sistema de referidos con IA"
- Pro: precio `$169` → `$149`; tagline → "Para clínicas en crecimiento"; features[0] → "5 usuarios · 5 agendas"; eliminado "Sistema de referidos con IA"
- Enterprise: precio `$379` → `$349`; tagline → "Redes y multi-sucursal"; features alineadas

### LemonSqueezy — variant IDs actualizados

**Problema:** la edge function `lemonsqueezy-create-checkout` solo tenía entradas para los plan IDs legacy (`essence`, `radiance`, `prestige`) y nunca para los nuevos (`core`, `starter`, `pro`, `enterprise`). Los packs de créditos tenían variant IDs viejos (1459xxx).

**Fix en `supabase/functions/lemonsqueezy-create-checkout/index.ts` (deployada):**

| Clave | Variant ID | Observación |
|---|---|---|
| `core` | 1696093 | Nuevo producto |
| `starter` | 1459505 | Reutiliza variant de `essence` |
| `pro` | 1459526 | Reutiliza variant de `radiance` |
| `enterprise` | 1459528 | Reutiliza variant de `prestige` |
| `essence` / `radiance` / `prestige` | ídem | Mantenidos para backward compat |
| `pack_500` | 1696070 | Nuevo |
| `pack_1500` | 1696077 | Nuevo |
| `pack_4000` | 1696079 | Nuevo |
| `pack_500_4o` / `pack_1500_4o` / `pack_4000_4o` | 1459861/69/72 | Sin cambios — confirmar si aplica |

**Precios de packs actualizados:**
- USD: $9 / $15 / $29 (antes $5 / $12 / $25)
- CLP: $8.000 / $13.000 / $25.000 (antes $5.000 / $12.000 / $25.000)

**Regla permanente:** editar un producto en LemonSqueezy **no cambia su variant ID**. Solo cambia si se elimina y recrea el variant.

---

## Cambios realizados — mayo 2026 (sesión 14, 2026-05-24)

### Sistema de límites y compra de recordatorios — implementación completa

#### Límite mensual compartido (citas + médicos)
- **DB**: columna `reminders_pack_balance INTEGER DEFAULT 0` en `subscriptions` (sesión previa)
- **Función `reset_monthly_ai_usage()`**: actualizada para también resetear `monthly_reminders_used` y `reminders_pack_balance` el día 1 de cada mes
- **Límites por plan**: Core=0, Starter=100, Pro=250, Enterprise=null (ilimitado). Pool compartido entre recordatorios de citas (PART 1/2) y médicos (PART 4)
- **`cron-process-reminders` v17**: helpers `effectiveLimit(sub)` y `pickSub(sub)` — `effLimit = monthly_reminders_limit + reminders_pack_balance`; contador local `poolUsed` que hace `break` al alcanzar el límite

#### Filtros de fecha coherentes en Reminders.tsx
- **Pendientes médicos**: filtro forward-window (`scheduled_date >= hoy`). Labels dinámicos "Próximos N días"
- **Historial + citas**: filtro backward-window. Labels "Últimos N días"
- Fecha en tabla médica muestra `scheduled_date` (no `created_at`), con día de semana como sublabel

#### Indicador de pool en Resumen de Envíos
- Card con barra de progreso: `monthly_reminders_used / effLimit`
- Colores: verde (<80%), ámbar (≥80%), rojo (al límite)
- CTA a tab Packs cuando está al límite

#### Compra por unidad (Packs tab) — (sesión 14)
**Precio**: $150 CLP / US$0.15 por unidad. Mínimo 20 unidades. ~81% de margen.

**UI (Reminders.tsx):**
- Reemplazó 3 tarjetas de pack fijas por un selector de cantidad con stepper (`−` / input / `+`) + presets rápidos (50, 100, 200)
- Total calculado en tiempo real (CLP + USD)
- Botón "Comprar N recordatorios" → checkout LS
- Detecta `?payment=success` al volver y muestra toast

**`src/lib/lemonsqueezy.ts`:** función `redirectToLemonRemindersCheckout(clinicId, email, quantity)`

**`lemonsqueezy-create-checkout` (deployada):**
- Nuevo `type: 'reminders'` en RequestBody
- `'reminders': Deno.env.get("LS_VARIANT_REMINDERS") || "PLACEHOLDER_REMINDERS"` en VARIANT_IDS
- `customData.quantity = String(Math.max(20, quantity))` — el webhook lee este campo
- `checkoutData.quantity = quantity` para pre-llenar la cantidad en el checkout LS

**`lemonsqueezy-webhook` (deployada):**
- Nuevo bloque `if (purchaseType === 'reminders')` — solo procesa `order_created`
- Lee `customData.quantity`, incrementa `subscriptions.reminders_pack_balance`

**Pendiente crítico:** crear el producto en LemonSqueezy dashboard y configurar `LS_VARIANT_REMINDERS` como secret en Supabase → Edge Functions → Secrets. Sin ese secret, el botón devuelve error "PLACEHOLDER_REMINDERS variant not configured".

#### TemplateSelector — cache de módulo (sesión previa)
- Cache `Map<clinicId, Template[]>` + `inFlight Map<clinicId, Promise>` a nivel de módulo
- Evita 3-4 llamadas duplicadas a YCloud por carga de página (varios `TemplateSelector` comparten un solo request por clínica)

---

## Cambios realizados — mayo 2026 (sesión 15, 2026-05-24)

### Bug crítico logística Linares/Talca — corrección completa

**Contexto:** Claudia reportó que el agente agendó el lunes 2026-05-25 en orden Talca→Linares→Talca, lo que es físicamente imposible de cumplir.

**Diagnóstico:** 5 bugs independientes que se combinaban para permitir rutas inválidas:

#### Bug 1 — "Maule" misclasificado como Talca (raíz del problema)
Citas sin GPS en el sector Linares tenían `latitude = NULL`. El código hacía `norm.includes("maule")` sobre la dirección para asignar coordenadas virtuales. "Maule" es la región chilena → aparece en **todas** las direcciones de Linares (`"..., Linares, Maule"`). Resultado: coords de Talca asignadas a citas de Linares → el sistema creía que eran del mismo sector → no disparaba el buffer inter-sector.

**Fix:** creado helper `getSectorAG` (ver sección Patrones críticos) que verifica `linaresCommunes` **antes** que `talcaCommunes`. "linares" hace match y retorna antes de evaluar "maule". Todas las referencias de sectorización en `checkAvail()` migradas a este helper único.

#### Bug 2 — Unidades de travel time incorrectas
`getTravelDetails()` devuelve minutos, pero el código hacía `Math.ceil(cached.duration / 60)` → dividía por 60 otra vez → travel time inter-sector ≈ 1 minuto → buffer de 60 min nunca se activaba.

**Fix:** `travelTimeMinutes = cached.duration` (ya está en minutos, confirmado por comentario en línea ~1391).

#### Bug 3 — Umbral de capacidad inconsistente
`ai_behavior_rules` decía "5 citas en Linares → prohibir Talca", pero el código usaba `linaresCount >= 4`.

**Fix:** umbral actualizado a `>= 5`.

#### Bug 4 — Contradicción 120 vs 60 minutos
El prompt embebido en `rutaContext` (dentro de `checkAvail`) decía "REGLA DE LAS 2 HORAS: 120 min". El KB, `ai_behavior_rules` y el código usaban 60 min.

**Fix:** prompt actualizado a "REGLA DE 1 HORA: 60 min" con descripción de continuidad territorial.

#### Bug 5 — Umbral latitud -35.6 (San Javier)
El fallback por latitud usaba `-35.6` como umbral, pero San Javier tiene latitud `-35.5974 > -35.6` → clasificaba como Talca siendo sector Linares.

**Fix:** umbral corregido a `-35.55` (consistente con `getSector` original).

#### Chequeo anti-rebote (capa de seguridad adicional)
Aunque todos los bugs anteriores estén corregidos, se agregó un chequeo explícito que detecta la subsecuencia T→L→T en la secuencia de sectores del día:

```typescript
// Si isPossible && isAnimalGrace && targetSectorAG:
// Reconstruye la secuencia del día con el nuevo slot insertado
// Detecta patrón: Talca → Linares → Talca → marca isPossible = false
```

Bloquea el agendamiento incluso si algún otro path permitiera llegar hasta el chequeo final con una ruta inválida.

**Deploy:** webhook v213 (incluye todos los fixes anteriores).

---

### Bug $6.000 Santiago — causa confirmada con evidencia real

**Diagnóstico:** queries a `messages` confirmaron que ambos casos reportados (Quilicura y Quinta Normal) fueron generados por el modelo `mini` (columna `ai_model = 'gpt-4o-mini'`). El modelo mini tiene tendencia a alucinación en cálculos de precio/recargo.

**Causa raíz de la caída a mini:** `selectModelTier()` no tenía keywords de precio/recargo en `needsSchedulingReason`. Cuando el usuario respondía solo la comuna (ej: "Quinta Normal"), no había keywords que mantuvieran el flujo en 4o → caía a mini → alucinaba el recargo.

**Fixes aplicados:**
- **Código:** agregadas keywords a `needsSchedulingReason`: `precio`, `valor`, `cuánto`, `cuanto`, `cuesta`, `costo`, `recargo`, `tarifa`, `cotiz`, `comuna`. Ahora las preguntas de precio y las respuestas de comuna se mantienen en 4o.
- **KB Santiago `#PROTOCOLO_LOGISTICA_SANTIAGO_SERVICIOS_GENERALES`:** sección anti-error explícita: solo Las Condes tiene recargo $6.000; cualquier otra comuna = $0. Prohibición de inventar recargos.
- **`ai_behavior_rules` Santiago (sección 5):** regla anti-error reforzada con lista de comunas Tramo A (sin recargo) y amenaza de "GRAVE ERROR" si se inventa recargo.

---

### Regla de cachorro — no asumir especie

**Problema:** el agente asumía "cachorro" = perro sin preguntar.

**Fix aplicado en ambas sucursales:**
- **KB `PROTOCOLO_SERVICIOS_Y_VACUNACION_ANIMALGRACE`:** sección nueva "REGLA: CACHORRO SIN ESPECIE DEFINIDA" — si el tutor dice "cachorro/gatito/bebé" sin especificar, preguntar explícitamente antes de cotizar.
- **`ai_behavior_rules` Linares (sección 8) y Santiago (sección 5):** regla explícita — cachorro no implica canino; confirmar especie antes de continuar.

---

### Protocolo de vacunación primera vez

**Problema:** el agente ofrecía 2 vacunas en la misma visita (ej: óctuple + antirrábica) sin verificar si era la primera vez del animal.

**Regla clínica:** si el animal **nunca fue vacunado antes**, solo se aplica UNA vacuna por visita. La segunda se agenda en la siguiente visita. Aplica a perros (óctuple/séxtuple vs antirrábica) y gatos (triple felina vs antirrábica).

**Fix aplicado en ambas sucursales:**
- **KB `PROTOCOLO_SERVICIOS_Y_VACUNACION_ANIMALGRACE`:** sección nueva "PROTOCOLO PRIMERA VACUNACIÓN" — preguntar si es primera vez; si sí → solo una vacuna; reagendar la segunda.
- **`ai_behavior_rules` Linares (sección 8) y Santiago (sección 5):** regla explícita con la misma lógica.

---

### Promociones proactivas — cambio de política

**Problema:** el doc de promociones tenía una "REGLA DE ORO" que prohibía ofrecer promociones salvo que el tutor preguntara explícitamente. Esto bloqueaba la IA de ofrecer descuentos aunque detectara oportunidades claras (ej: 3 perros a vacunar = pack familiar).

**Fix en ambas sucursales — KB `PROMOCIONES_Y_DESCUENTOS_VIGENTES`:**
- "REGLA DE ORO" reescrita como positiva: la IA **debe** ofrecer la promoción proactivamente cuando detecta una oportunidad (múltiples mascotas, servicios combinables, etc.).
- Criterio: presentar primero el precio normal, luego la promoción como ventaja adicional.
- No esperar a que el tutor pregunte.

---

### Operacional — citas lunes 2026-05-25 ya agendadas con ruta inválida

Las 3 citas del lunes ya están en la DB con el orden Talca (12:00) → Linares (15:30) → Talca (16:30). El fix previene futuras reservas malas pero no corrige las existentes. Claudia debe reagendar manualmente una de las dos citas de Talca.

---

## Cambios realizados — mayo 2026 (sesión 16, 2026-05-25)

### Tab Packs de Recordatorios — rediseño completo

**Motivación:** la UI anterior solo mostraba un selector por unidad sin packs fijos, y el título "Recordatorios adicionales" aparecía en color oscuro sobre fondo teal.

#### Estructura nueva

**3 packs fijos con descuento real por unidad** (más económicos que comprar suelto):

| Pack | Unidades | CLP | USD | Por unidad | Variant ID LS |
|---|---|---|---|---|---|
| Pack Básico | 50 | $5.000 | $9 | $100/u (−33%) | 1701015 |
| Pack Pro ⭐ | 350 | $15.000 | $19 | $43/u (−71%) | 1701021 |
| Pack Ilimitado | 9.999 (∞) | $25.000 | $29 | Sin límite | 1701025 |

**Selector por unidad** debajo de un divisor con texto "¿Necesitas otro número exacto? Compra por unidad":
- Precio: $150 CLP / $0.15 USD por unidad
- Mínimo: **10 unidades**
- Stepper de ±10, arranca en 10
- Variant ID LS: **1701169** ("Recordatorios × decenas", precio $1.50 USD/decena)

#### Solución al mínimo $0.50 de LemonSqueezy

LS no permite variantes con precio < $0.50 USD. Para el selector por unidad ($0.15/u):
- Variante creada a **$1.50 USD** como product stub (variant ID `1701169`)
- La edge function usa `custom_price = roundedUnits * 15` (centavos USD) para override del precio
- `customData.quantity = roundedUnits` (lo que el webhook acredita en DB)
- ⚠️ El enfoque "decenas" (`quantity = units/10`) fue descartado en sesión 17 — LS rechaza `quantity` como atributo de checkout

#### Archivos modificados

- **`src/pages/Reminders.tsx`**: rediseño completo del tab Packs — 3 tarjetas con badge, chip de ahorro por unidad, divisor, selector compacto. Fix título blanco. Estado inicial qty=10, mín=10.
- **`src/lib/lemonsqueezy.ts`**: nueva función `redirectToLemonReminderPackCheckout(clinicId, email, packId)` + tipo `ReminderPackId`.
- **`supabase/functions/lemonsqueezy-create-checkout/index.ts`** (v16→v22): 4 nuevos variant IDs hardcodeados; mín 10 unidades. Ver sesión 17 para corrección del approach de precios.

#### Variant IDs hardcodeados en la edge function

Todos los IDs están hardcodeados como fallback (no requieren secrets en Supabase). Si en el futuro se quieren cambiar sin deploy, configurar los correspondientes `LS_VARIANT_REMINDERS_*` en Supabase → Edge Functions → Secrets.

---

## Cambios realizados — mayo 2026 (sesión 17, 2026-05-25)

### Landing page — causa raíz de "cambios no visibles en producción"

**Descubrimiento crítico:** `vercel.json` enruta `/` → `public/landing.html` (archivo estático), **no** al componente React `Landing.tsx`. Todos los cambios previos a `Landing.tsx` eran invisibles en `vetly.pro` porque la landing real es el HTML estático.

**Regla permanente:** cualquier cambio visual en la landing pública (`vetly.pro`) debe editarse en **`public/landing.html`**, no en `src/pages/Landing.tsx`. `Landing.tsx` solo aplica a la ruta interna `/app/landing` si existe.

---

### Planes — "Campañas masivas" eliminado como feature incluida

**Motivación:** las campañas masivas son un extra de pago (créditos por uso), no una feature incluida en el plan. Se eliminó de todos los planes y se reemplazó con una caja "Extras opcionales".

**Archivos actualizados:**
- **`src/lib/lemonsqueezy.ts`**: eliminado "Campañas masivas" de Starter; añadido `upsells: ['Mensajería masiva de marketing segmentada']` a Starter, Pro, Enterprise; Core upsells actualizados.
- **`src/lib/mercadopago.ts`**: mismos cambios para planes CLP.
- **`src/pages/Landing.tsx`**: eliminado "Campañas masivas" de Starter; añadido bloque de renderizado "Extras opcionales" con `+` prefix en color primary.
- **`src/pages/Pricing.tsx`**: eliminado "Campañas masivas" de Core y Pro; añadida caja de upsells con el mismo patrón de renderizado ya existente.
- **`public/landing.html`**: eliminado `<li>✓ Campañas masivas</li>` del plan Starter y `<li>– Campañas masivas</li>` del Core; añadida caja "Extras opcionales" a los 4 planes con estilos coherentes (teal para Core/Starter/Enterprise, dark para Pro). Texto del Core: "Recarga de recordatorios automáticos — WhatsApp 24h y 2h antes de cada cita y recordatorios médicos".

---

### Fix bug campañas — todos los tags se seleccionaban al hacer clic en uno

**Síntoma:** al hacer clic en una etiqueta de inclusión → 0 contactos (todas seleccionadas). Al hacer clic en una de exclusión → 58 contactos (todas seleccionadas).

**Causa raíz 1 — `get_tag_counts` sin `tag_id`:**
El RPC no devolvía la columna `tag_id` en su tipo de retorno → todos los tags del frontend mapeaban con `id: undefined` → `.includes(undefined)` era `true` para todos → cualquier clic seleccionaba todo.

**Causa raíz 2 — `get_estimated_audience` filtraba `patient_tags` en vez de `tutor_tags`:**
Los tags se migraron a `tutor_tags` en sesión 12, pero el RPC seguía consultando `patient_tags` (vacía) → inclusión = 0 contactos, exclusión = todos los contactos.

**Migración aplicada en producción (`fix_campaign_rpcs_tag_id_and_tutor_tags`):**
```sql
-- DROP + CREATE para añadir columna tag_id al tipo de retorno
DROP FUNCTION IF EXISTS public.get_tag_counts(UUID);
CREATE FUNCTION public.get_tag_counts(p_clinic_id UUID)
RETURNS TABLE (tag_id UUID, tag_name TEXT, tag_color TEXT, contact_count BIGINT)
-- GROUP BY tag_id AND tag_name

-- get_estimated_audience reescrito para usar tutor_tags
-- EXISTS (SELECT 1 FROM tutor_tags tt WHERE tt.tutor_id = t.id AND tt.tag_id = ANY(p_inclusion_tags))
-- NOT EXISTS (SELECT 1 FROM tutor_tags tt WHERE tt.tutor_id = t.id AND tt.tag_id = ANY(p_exclusion_tags))
```

---

### Sistema de créditos de campaña — implementación completa

**Modelo de precios:** US$0.15 / crédito · mínimo 50 · incrementos de 50 · **sin vencimiento** (a diferencia de `reminders_pack_balance` que se resetea mensualmente).

**Solución al mínimo $0.50 de LemonSqueezy:** variant a $1.50 USD como product stub; precio real via `custom_price = credits * 15` (centavos USD). `customData.quantity = roundedCredits` (lo que el webhook acredita). El enfoque "decenas" con `quantity` fue descartado en sesión 17 — LS rechaza `quantity` como atributo de checkout.

#### DB
- **Migración `add_campaign_credits_balance`**: `ALTER TABLE subscriptions ADD COLUMN campaign_credits_balance INTEGER NOT NULL DEFAULT 0`
- La columna **no se resetea** en `reset_monthly_ai_usage()` — los créditos son permanentes

#### Edge Functions (todas deployadas)
- **`lemonsqueezy-create-checkout` (v20)**: nuevo tipo `'campaign_credits'`; variant ID `1702308` hardcodeado como fallback; lógica decenas en bloque `campaign_credits`
- **`lemonsqueezy-webhook`**: nuevo bloque `if (purchaseType === 'campaign_credits')` — solo procesa `order_created`; incrementa `subscriptions.campaign_credits_balance`
- **`send-whatsapp-campaign`**: verifica `campaign_credits_balance >= recipients.length` antes de enviar; si insuficiente → marca campaña `'failed'` y retorna 400; al terminar descuenta solo `sentCount` (no `recipients.length`)

#### Frontend
- **`src/lib/lemonsqueezy.ts`**: función `redirectToLemonCampaignCreditsCheckout(clinicId, email, quantity)` — `quantity: Math.max(50, quantity)`
- **`src/pages/Campaigns.tsx`**: tarjeta de saldo con gradiente violet; stepper ±50 (mínimo 50); presets rápidos [100, 300, 500]; precio en tiempo real (CLP + USD); guard en `handleLaunchCampaign` (deshabilita botón si créditos insuficientes); badge de advertencia por campaña; detección de `?payment=success` al volver del checkout

#### LemonSqueezy — producto creado
| Campo | Valor |
|---|---|
| Nombre | Créditos de Campaña |
| Variant | Créditos × decenas |
| Precio | US$1.50 |
| Variant ID | **1702308** |

---

### Fix crítico checkout — `custom_price` en lugar de `quantity` — `lemonsqueezy-create-checkout` (v22)

**Síntoma:** al intentar comprar créditos de campaña → "Edge Function returned a non-2xx status code". En consola: la edge function retornaba 500 opaco.

**Diagnóstico:** después de cambiar la edge function a retornar 200 con `{success: false, details}` para errores de LS, el frontend mostró el error real de la API de LemonSqueezy:
```json
{"detail":"The field quantity is not a supported attribute.","source":{"pointer":"/data/attributes"},"status":"400"}
```

**Causa raíz:** la API de checkouts de LS **no acepta `quantity` como atributo** a nivel `data.attributes`. El enfoque "decenas" (variante a $1.50 = 10 unidades, pasar `quantity = credits/10`) era inválido desde el diseño.

**Fix (`lemonsqueezy-create-checkout` v22, deployada):**
- Renombrado `lsQuantity` → `lsCustomPrice` (precio en centavos USD)
- Para `campaign_credits`: `lsCustomPrice = roundedCredits * 15` (= $0.15/crédito en centavos)
- Para `reminders` por unidad: `lsCustomPrice = roundedUnits * 15` (= $0.15/unidad en centavos)
- `checkoutAttributes.custom_price = lsCustomPrice` (LS override de precio del variant)
- La variante base (`1702308` a $1.50) actúa como product stub; el precio real se override con `custom_price`
- `customData.quantity` sigue siendo los créditos reales a acreditar en DB (no cambia el webhook)

**Ejemplo:** 100 créditos × $0.15 = $15.00 → `custom_price: 1500` (centavos)

**Regla permanente:** para products de precio variable en LS, usar `custom_price` (centavos) en `checkoutAttributes`, **nunca** `quantity`. `quantity` no es un atributo válido del checkout endpoint de LS.

### Optimización mobile — banner `Campaigns.tsx`

- Botón "Nueva Campaña" aparece debajo del título en mobile (`sm:hidden` inline) y a la derecha en desktop (`hidden sm:flex`)
- Ícono reducido: `w-10 h-10` en mobile, `w-12 h-12` en desktop
- Tarjeta de créditos: fuentes adaptativas (`text-xl sm:text-2xl`), abreviación "disp." en mobile
- Panel de compra: layout apilado (`flex-col`) — fila 1 stepper+presets, fila 2 precio+botón con `justify-between`

---

## Cambios realizados — mayo 2026 (sesión 18, 2026-05-25)

### `lemonsqueezy-webhook` — `verify_jwt: false` (REGLA PERMANENTE)

**Problema:** todos los pagos de LemonSqueezy llegaban con 401 porque Supabase bloqueaba las requests antes de que llegaran al código. LS no envía JWT de Supabase.

**Fix:** redesplegar `lemonsqueezy-webhook` con `verify_jwt: false` (v17). La autenticación real la hace la verificación HMAC de la firma `x-signature`.

**⚠️ Regla permanente:** cualquier redesploy de `lemonsqueezy-webhook` debe incluir `verify_jwt: false`. Si se usa el default (`true`), ningún pago se procesa y los 401 no aparecen en los logs de la función (Supabase los bloquea antes).

### YCloud Santiago — saldo insuficiente (2026-05-25)

Recordatorios de citas fallando con `BALANCE_INSUFFICIENT`. La cuenta de YCloud de Santiago tiene $0.0555 USD. Claudia debe recargar.

**Costo referencial YCloud Chile:** ~$0.053–$0.089 USD por mensaje (conversación WhatsApp). Cada cita genera hasta 2 mensajes (24h + 2h). Presupuesto recomendado: $20–25 USD/mes para el volumen actual de Santiago.

### UI Recordatorios — tab y card de saldo

- Tab renombrado: "Packs" → "Recordatorios Extra"
- Card renombrada: "Recordatorios adicionales" → "Compras y Saldos"
- 3 métricas: Consumidos · Comprados · Saldo actual
- `fetchReminderUsage()` extraída como función independiente — se llama al detectar `?payment=success` para refrescar el saldo inmediatamente al volver del checkout

---

## Cambios realizados — mayo 2026 (sesión 19, 2026-05-25)

### Agentes HQ — `vetly-hq-agent` v2 + `cron-system-health` v2

#### Tool `agendar_videollamada` en Andrés (vetly-hq-agent v2)

Nueva herramienta del consultor Andrés para cerrar demos:
- **Trigger**: prospecto confirma día/hora para demo
- **Acción 1**: inserta cita en tabla `appointments` con `clinic_id = HQ_ID`, `service = "Demo / Videollamada Vetly"`, `duration_minutes = 30`, `status = "confirmed"`
- **Acción 2**: envía WhatsApp al `hq_escalation_phone` con nombre del prospecto, teléfono, y fecha/hora formateada en zona horaria Chile
- **Prompt actualizado**: Andrés pregunta día/hora, agenda, y le dice al prospecto que lo contactará Sebastián (el fundador) directamente

**Flujo de ventas actualizado:**
1. Calificación → 2. Demo o cierre directo → 3. Si demo: `agendar_videollamada` + notificación WA → 4. Si cierre: `escalar_lead_caliente` + link registro

#### Bug causa raíz — WhatsApp de alertas no llega (+56929935817)

**Causa**: WhatsApp Business API solo permite mensajes free-form dentro de una ventana de 24h después de que el destinatario haya enviado un mensaje al número. Como +56929935817 nunca ha enviado mensajes a +56993089185, no hay sesión activa → YCloud acepta el API call (200 → `notified:true`) pero Meta rechaza la entrega silenciosamente.

**Fix inmediato**: enviar un mensaje desde tu número personal (+56929935817) a +56993089185 por WhatsApp. Esto abre la sesión de 24h y los mensajes del cron y de Andrés llegarán.

**Fix robusto (pendiente)**: crear un template en el dashboard de YCloud para +56993089185 (ej: `alerta_sistema_vetly`) que permita mensajes proactivos sin necesidad de sesión activa.

**Logging mejorado**: `sendWhatsApp` ahora retorna `{id, status}` del API de YCloud. `cron-system-health` loguea el `msgId` y lo incluye en el response JSON (`notify_msg_id`) para trazabilidad en el dashboard de YCloud.

#### Configuraciones del HQ registradas
- `ycloud_phone_number`: +56993089185
- `hq_escalation_phone`: +56929935817 (número personal del fundador)
- `hq_admin_phones`: ["+56929935817"] (recibe comandos de soporte)
- `hq_sales_agent_enabled`: true
- `hq_support_agent_enabled`: true

### Frontend desplegado (commit 413a9a5)
- `AIChatWidget.tsx`: landing solo muestra tab Ventas; soporte in-app pasa `clinic_id` para diagnósticos
- `AdminSettings.tsx`: tab Integraciones HQ completo
- `database.ts`: 6 nuevas columnas HQ en `clinic_settings` Row/Insert/Update
- `public/landing.html`: burbuja flotante WhatsApp verde → +56993089185

---

## Cambios realizados — mayo 2026 (sesión 20, 2026-05-25)

### Prompt de ventas editable desde DB — `vetly-hq-agent` v3

**Motivación:** el prompt de personalidad y comportamiento de Andrés estaba hardcodeado como constante `SALES_PROMPT` en la edge function. Cualquier ajuste requería editar código y redesplegar. Opción B: mover el prompt a la columna `hq_sales_agent_prompt` en `clinic_settings`, editabl desde AdminSettings.

#### DB
- **Migración aplicada**: `ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS hq_sales_agent_prompt TEXT`
- **Seed inicial**: el contenido actual del `SALES_PROMPT` hardcodeado fue insertado como valor por defecto en la fila HQ (`id = '00000000-0000-0000-0000-000000000000'`)

#### Edge Function `vetly-hq-agent` (v3, deployada)
- Interfaz `HqConfig` añade campo `salesPrompt: string`
- Select query incluye `hq_sales_agent_prompt`
- `hq.salesPrompt = r?.hq_sales_agent_prompt || SALES_PROMPT` — DB tiene prioridad; la constante hardcodeada actúa como fallback si la columna está vacía
- `handleSales` usa `hq.salesPrompt` en lugar de la constante directamente
- `hqApiKey` renombrado a `_hqApiKey` (convención TypeScript para parámetros no usados)

#### `src/types/database.ts`
- `hq_sales_agent_prompt: string | null` añadido a `clinic_settings` Row, Insert y Update

#### `src/pages/hq/AdminSettings.tsx`
- `HqConfig` interface: campo `hq_sales_agent_prompt: string`
- `useState` inicial: `hq_sales_agent_prompt: ''`
- `fetchHqConfig`: popula `hq_sales_agent_prompt: hq.hq_sales_agent_prompt || ''`
- `saveHqConfig`: envía `hq_sales_agent_prompt: hqConfig.hq_sales_agent_prompt.trim() || null`
- Nueva textarea en card "Agente de Ventas": `rows=14`, `font-mono`, `resize-y`, anillo de foco violet
- Helper text: "Se carga dinámicamente — no requiere redesploy para aplicar cambios."

#### Patrón de carga dinámica (regla permanente)
El prompt se carga **por cada request** en `vetly-hq-agent`, no en startup. Cambiar el textarea en AdminSettings y hacer Save aplica el nuevo prompt **inmediatamente** en la siguiente conversación de WhatsApp, sin ningún deploy. La constante `SALES_PROMPT` en el código es solo un fallback de emergencia.

---

## Cambios realizados — mayo 2026 (sesión 21, 2026-05-26)

### `vetly-hq-agent` v4 — mejoras de UX y bugs críticos

#### Bug: demos no aparecían en el calendario HQ
`agendar_videollamada` insertaba en la tabla `appointments`, pero `AdminCalendar` lee de `demo_requests`. Fix: el handler ahora inserta en `demo_requests` con los campos correctos: `name`, `clinic_name`, `phone`, `email`, `needs`, `scheduled_at`, `status: 'pending'`.

#### Bug: mensajes HQ no aparecían en AdminMessages
RLS de `messages` usaba `clinic_members` — el admin HQ no tiene entrada en esa tabla para el HQ ID. Fix: migración `platform_admins_can_access_hq_messages` añadió política `FOR ALL` que permite acceso a cualquier usuario en `platform_admins`.

#### Bug: fechas incorrectas al agendar (usaba 2023)
El AI no conocía la fecha actual → al decir "el lunes" usaba una fecha de 2023. Fix: se inyecta `Fecha actual en Chile: {nowChile}` en el system prompt de cada request vía `new Date().toLocaleDateString("es-CL", { timeZone: "America/Santiago", ... })`.

#### Mejoras de prompt (aplicadas en DB, efectivas de inmediato)
- **Apertura suave**: responde brevemente a la primera pregunta, luego pide permiso: *"¿Te puedo hacer unas preguntas para entender mejor tus necesidades y así ayudarte de la mejor manera?"*. No lanzar calificación de golpe.
- **CTA post-plan**: no presionar a demo inmediatamente. Cerrar con: *"¿Te gustaría saber más detalles sobre el plan? O bien, también puedo ayudarte a agendar una demostración sin compromiso..."*
- **Datos de agenda**: recopila en orden (un mensaje a la vez): 1-Nombre y apellido, 2-Nombre del negocio, 3-Email, 4-Web (opcional), 5-Día y hora.

#### Tool `agendar_videollamada` — nuevos parámetros
Añadidos: `nombre_negocio`, `email`, `web` (opcional). La notificación WA al fundador incluye todos estos datos con emojis de contexto.

---

## Cambios realizados — mayo 2026 (sesión 22, 2026-05-27)

### Fix: rango horario no informado al agendar — ambas sucursales

**Problema:** El agente confirmaba citas indicando la hora exacta ("quedaste agendado a las 10:00") sin aclarar que el móvil trabaja por rangos horarios y puede haber retrasos en la ruta.

**Fix en `ai_behavior_rules` de Linares y Santiago (efectivo de inmediato, sin deploy):**
Nueva regla agregada justo después del PROTOCOLO DE AGENDAMIENTO en ambas sucursales:

> `AVISO DE RANGO HORARIO (OBLIGATORIO)`: Al confirmar cada cita agendada (ya sea al agendar o al confirmar un recordatorio), SIEMPRE añade al final del mensaje: *"Recuerda que el móvil trabaja por rangos horarios, por lo que te pedimos estar disponible al menos 2 horas después de la hora asignada, por si ocurre algún retraso en la ruta."*

---

### Fix: "No hay citas pendientes" al confirmar por botón de template

**Síntoma:** Clientes recibían el template de recordatorio con botones (Si, Confirmo / Cancelar Cita / Quiero Reagendar). Al hacer clic en "Si, Confirmo" en algunos casos, el agente respondía "No hay citas pendientes." en vez de confirmar.

**Causa raíz:** `confirmAppt()` buscaba exclusivamente citas con `status = "pending"`. Si la cita ya había sido confirmada por un clic previo (ej: el cliente hacía clic en una copia duplicada del template enviada por el bug de idempotencia anterior, ya corregido en v16), la función no encontraba ninguna `pending` y retornaba ese mensaje erróneo sin más.

**Fix en código (`confirmAppt`, webhook v214):**
```typescript
// Antes: si no había pending → "No hay citas pendientes."
// Después: si no hay pending, verificar si hay una confirmed futura
if (!appt) {
  if (response === "yes") {
    const { data: confirmedAppt } = await sb.from("appointments").select("id")
      .eq("clinic_id", clinicId).eq("phone_number", normalizedPhone)
      .eq("status", "confirmed").gte("appointment_date", now)
      .limit(1).maybeSingle();
    if (confirmedAppt) return { message: "Tu cita ya está confirmada 😊 ¡Te esperamos! Recuerda estar disponible al menos 2 horas después de la hora asignada..." };
  }
  return { message: "No hay citas pendientes." };
}
```

**Mensaje de confirmación exitosa actualizado:** ahora incluye también el aviso de rango horario:
> `"¡Cita confirmada! 😊 Recuerda que el móvil trabaja por rangos horarios, por lo que te pedimos estar disponible al menos 2 horas después de la hora asignada, por si hay algún retraso en la ruta."`

**Webhook deployado:** v214.

---

### Nota: botones duplicados en WhatsApp (no es un bug)

Los botones del template de recordatorio (Cancelar Cita / Quiero Reagendar) aparecen tanto dentro de la burbuja del mensaje como flotantes al fondo de la pantalla. Esto es **comportamiento nativo de WhatsApp** para templates con quick reply buttons — no es controlable desde nuestro código ni desde YCloud.

---

## Cambios realizados — mayo 2026 (sesión 23, 2026-05-28)

### Sistema de créditos IA — implementación completa

#### Migración DB (`20260528000001_ai_credits_unlimited_and_expiry.sql`)
- `clinic_settings.ai_credits_unlimited BOOLEAN DEFAULT false` — activa créditos ilimitados para una cuenta sin necesidad de tocar suscripciones
- `clinic_settings.ai_credits_extra_expires_at TIMESTAMPTZ DEFAULT NULL` — fecha de vencimiento de los créditos extra comprados
- `ai_credit_transactions.metadata JSONB DEFAULT NULL` — campo para almacenar modelo, source_clinic_id, expires_at, etc.

**Para activar créditos ilimitados en una cuenta:**
```sql
UPDATE clinic_settings SET ai_credits_unlimited = true WHERE id = '<clinic_id>';
```

#### Nueva edge function `cron-expire-extra-credits` (v1, `verify_jwt: false`)
- Se ejecuta diariamente a las **02:00 UTC** vía pg_cron (job schedule 17)
- Detecta clínicas con `ai_credits_extra_expires_at < NOW()` y saldo extra > 0
- Zeroes `ai_credits_extra_balance` y `ai_credits_extra_4o`, inserta transacción de tipo `adjustment` con `metadata.expired_at`
- Configurada en `supabase/config.toml` como `[functions.cron-expire-extra-credits]`

#### Webhook principal (`ycloud-whatsapp-webhook` v215)
**Credit check antes de responder:**
```typescript
// Resuelve pool root via parent_clinic_id
const creditPoolId = pool.parent_clinic_id || clinic.id;
// Si ai_credits_unlimited → skip check
// Si extrasExpired → zeroes balance sin await (fire-and-forget)
// Si totalUsed >= monthlyLimit + extraBalance → return 200 silencioso
```
**Insert de consumo** en `ai_credit_transactions` tras cada mensaje generado:
- `amount: -1` para mini, `-8` para 4o_standard/4o_legacy, `-8` para 4o_pro (sin distinción de tier aún — los tiers se distinguen vía metadata.model)
- `description: "Consumo IA: {model}"`
- `metadata: { model, source_clinic_id }` — source_clinic_id permite auditar desde qué sucursal vino el mensaje

#### Webhooks de pago
**`mercadopago-webhook` y `lemonsqueezy-webhook`:** al comprar créditos extra:
- Setean `ai_credits_extra_expires_at = NOW() + 30 días`
- Insertan transacción `type: 'purchase'` con `metadata: { model, expires_at }`

**`lemonsqueezy-webhook` `subscription_created`:** ahora sincroniza `ai_credits_monthly_limit` con los valores correctos por plan:
```typescript
const aiCreditsLimit = enterprise/prestige → 30000, pro/radiance → 10000, starter/essence → 5000, core → 0
await supabase.from('clinic_settings').update({ ai_credits_monthly_limit: aiCreditsLimit })
```

#### `AdminClinics.tsx` — carga manual de créditos
`handleManualCharge` ahora también:
- Setea `ai_credits_extra_expires_at = NOW() + 30 días`
- Inserta transacción `type: 'purchase'` con `metadata.source: 'hq_manual'`
- Alert de confirmación muestra la fecha de vencimiento

#### Historial mayo 2026 — backfill DB (Animalgrace pool)
4 transacciones insertadas directamente en `ai_credit_transactions` para transparencia:
- `monthly_refill` 12.000 créditos — 2026-05-01
- Consumo Mini: −1.123 créditos (1.123 msgs × 1) — 2026-05-28 23:59:00
- Consumo Standard: −2.976 créditos (372 msgs × 8) — 2026-05-28 23:59:30
- Consumo Pro: −25.140 créditos (419 msgs × 60) — 2026-05-28 23:59:59

---

### AISettings.tsx — rediseño completo (estilo Citenly + colores sky Vetly)

**Nueva estructura de página (una sola ruta `/app/settings?tab=ai`):**

1. **Agente IA activo** — card independiente con toggle grande (antes estaba dentro del panel del motor)
2. **Motor de IA** — 3 cards planas sin bordes pesados:
   - Ahorro Máximo (GPT-4o Mini) → emerald cuando activo
   - Híbrido Automático (IA Router) → sky cuando activo
   - Máximo Poder (GPT-4o Exclusivo) → violet cuando activo
   - Indicador `✓ ACTIVO` bajo la card seleccionada
3. **Créditos de IA** — badge `∞ ILIMITADO` cuando `ai_credits_unlimited = true`; warning amber si `ai_credits_extra_expires_at` próximo; 2 cols (Usados / Disponibles); barra de uso
4. **Consumo por Modelo** — 3 cards (Mini=emerald, Standard=sky, Pro=violet) con `mensajes` + `créditos` reales
5. **Comprar Créditos Extra** — cards simples estilo Citenly con botón `Comprar Pack` en sky-500; "Válidos 30 días" en amber
6. **Historial de Transacciones** — **embebido en la misma página** (eliminado el link a `/app/ai-credits`):
   - Selector de mes (últimos 6 meses)
   - 3 cards de resumen sin límite de filas (Créditos Usados / Mensajes IA / Recargado)
   - Tabla con 200 filas (las más recientes)
   - Footer: "Mostrando N de M transacciones de {mes}"

**Patrón de datos — fuente única de verdad:**
- `totalUsed = miniMessages×1 + standardMessages×8 + proMessages×60` — tabla `messages`, cubre historial completo
- Se eliminaron `miniUsed`/`fourOUsed` de `clinic_settings` del cálculo (esos contadores no son retroactivos)
- `Disponibles = Math.max(0, totalAvailable - totalUsed)` — nunca negativo
- Textos: "ciclo" → "**ciclo mensual**" en todos los textos relevantes

---

### Fix Gestión de Equipo — 3 bugs corregidos

#### Bug 1 — Duplicados al invitar
**Causa:** botón "Enviar Invitación" sin estado de carga → múltiples clics = múltiples inserts.
**Fix (`Team.tsx`):**
- Estado `isInviting` que se activa al hacer submit y bloquea re-envíos con `if (isInviting) return`
- Botón deshabilitado + spinner "Enviando..." mientras procesa
- Cancelar también deshabilitado durante el proceso

#### Bug 2 — Límite incorrecto para sucursales (Santiago mostraba máx 2)
**Causa raíz (3 capas):**
1. Santiago tenía `clinic_settings.max_users = 5` (debería ser 999999)
2. RPC `invite_member_v2` leía `subscriptions WHERE clinic_id = p_clinic_id` sin considerar `parent_clinic_id` → encontraba `plan = 'essence'` → cap de 2 usuarios
3. Frontend usaba `sub.plan = 'essence'` de MercadoPago (legacy) sin respetar `manually_active = true`

**Fix — migración `fix_team_invite_limits_and_rpc`:**
- `UPDATE clinic_settings SET max_users = 999999 WHERE id = '13472ea4-...'` (Santiago)
- **RPC `invite_member_v2` reescrito:**
  - Resuelve pool root con `COALESCE(parent_clinic_id, id)`
  - Lee `manually_active` del pool root — si `true`, confía en `clinic_settings.max_users` directamente
  - Si `NOT manually_active`, deriva `max_users` del plan de subscriptions con CASE expandido a todos los IDs nuevos (`enterprise`, `pro`, `starter`, `core`) y legacy
  - `>= 999` = ilimitado, skip del count check
- **Frontend `Team.tsx`:** cuando `manually_active = true` OR `subscription_plan IN ('prestige', 'enterprise')` → usa `max_users` de `clinic_settings` sin overridear con el plan de MercadoPago; fetch del sub del parent si la sucursal no tiene el suyo

#### Bug 3 — Demora al cambiar de sucursal
**Causa:** `loadData()` hacía queries secuenciales y dejaba el estado anterior hasta que todo cargaba.
**Fix:**
- `setMembers([])` al inicio → tabla muestra spinner inmediatamente (sin datos obsoletos)
- `Promise.all` para 3 queries paralelas (miembros + settings + subscription)

---

### Packs de créditos IA — nuevas cantidades

| Pack | Créditos antes | Créditos ahora | Precio USD | Precio CLP |
|---|---|---|---|---|
| Pack Inicial | 500 | **4.000** | US$9 | $8.000 |
| Pack Pro | 1.500 | **8.000** | US$15 | $13.000 |
| Pack Enterprise | 4.000 | **20.000** | US$29 | $25.000 |

Actualizado en: `lemonsqueezy.ts` (LS_CREDIT_PACKS), `mercadopago.ts` (CREDIT_PACKS), `lemonsqueezy-create-checkout` (creditsMap), `mercadopago-create-credits-preference` (CREDIT_PACKS_MINI). Todas las edge functions deployadas.

**Los créditos extra expiran a los 30 días** de la compra. Los créditos del plan se renuevan mensualmente.

---

### Planes y precios — actualización completa

| Plan | USD | CLP | Créditos IA/mes |
|---|---|---|---|
| Core | **$39** (antes $33) | $33.000 | 0 |
| Starter | **$99** (antes $89) | $89.000 | **5.000** (antes 1.000) |
| Pro | **$169** (antes $149) | $149.000 | **10.000** (antes 4.000) |
| Enterprise | $349 | **$333.000** (antes $349.000) | **30.000** (antes 12.000) |

Actualizado en: `lemonsqueezy.ts` (LS_PLANS), `mercadopago.ts` (PLANS), `public/landing.html`, `lemonsqueezy-webhook` (subscription_created credit sync), `mercadopago-webhook` (subscription sync).

**Regla permanente:** cuando se cambien precios o créditos por plan, actualizar en: `lemonsqueezy.ts`, `mercadopago.ts`, `lemonsqueezy-webhook` (bloque subscription_created), `mercadopago-webhook` (bloque active sync), `public/landing.html`. Son 5 lugares.

---

### Enterprise — límite de 3 sucursales

**RPC `create_clinic_branch` reescrito (migración `enterprise_branch_limit_and_credits_update`):**
- Cuenta clínicas donde el usuario es owner y status = 'active'
- Si `v_branch_count >= 3` → `RAISE EXCEPTION 'Has alcanzado el límite de 3 sucursales del plan Enterprise...'`
- Default timezone: `America/Santiago` (antes `America/Mexico_City`)
- Default subscription_plan: `'enterprise'` (antes `'prestige'`)

**Nueva función helper `get_plan_credit_limit(p_plan TEXT) RETURNS INTEGER`** — mapea plan → créditos. Inmutable, reutilizable por futuros crons/webhooks.

---

### Landing `public/landing.html` — actualizaciones

1. **Precios actualizados** en los 4 planes (USD)
2. **Créditos IA** actualizados por plan: Starter 5.000 / Pro 10.000 / Enterprise 30.000
3. **Enterprise**: "Multi-sucursal unificado" → "Hasta **3 sucursales** unificadas"
4. **Sección "¿Qué son los créditos IA?"** expandida: tabla explicativa de N1/N2/N3 con descripción de cada nivel (1x/8x/60x), precio packs desde $9 USD
5. **Nueva sección "🔒 GARANTÍA — Prueba Vetly sin riesgo"** debajo de los planes:
   - 7 días para probar el sistema completo
   - Implementación llave en mano por el equipo
   - Puedes cancelar si no ayuda
   - Botón verde "0 RIESGO COMPROMETIDO" → `/demo`
6. Referencias de `$33 USD/mes` → `$39 USD/mes` en textos libres

---

### Fixes adicionales — mayo 2026 (sesión 23 continuación, 2026-05-28)

#### `balance_after` real en consumos del webhook (`ycloud-whatsapp-webhook` v216)
**Problema:** los inserts de consumo usaban `balance_after: 0` hardcodeado.
**Fix:** se calcula con los datos de `pool` ya en memoria (sin query adicional):
```typescript
balanceAfter = Math.max(0, monthlyLimit + extraBalance - totalUsedAhora)
```
Impacto: cero overhead — los datos del pool ya estaban cargados desde el credit check.

#### Backfill historial mayo 2026 — 1.914 filas individuales
Los 3 registros de consumo bulk (resúmenes de Mini/Standard/Pro) se reemplazaron por **1.914 filas individuales** generadas desde la tabla `messages`, con timestamp y modelo real de cada mensaje. El historial de mayo quedó con:
- 1 `monthly_refill` — 12.000 créditos (2026-05-01)
- 1.914 `consumption` — total 29.239 créditos
- Footer: "Mostrando 200 de 1.915 transacciones de mayo 2026"

#### Bug PostgREST límite 1.000 filas — RPC `get_credit_history_summary()`
**Problema raíz:** Supabase PostgREST aplica un límite default de **1.000 filas** aunque el código no especifique `.limit()`. Las queries "sin límite" para el resumen retornaban máximo 1.000 filas → totales incorrectos (2.425 créditos en vez de 29.239).
**Fix — migración `fix_credit_limits_and_history_summary_rpc`:**
```sql
CREATE FUNCTION get_credit_history_summary(p_clinic_ids UUID[], p_month_start, p_month_end)
RETURNS TABLE (consumed, messages, recharged, total)
-- Agrega server-side con SQL puro, sin límite de PostgREST
```
`AISettings.tsx` usa este RPC para los 3 cards de resumen del historial. La tabla de 200 filas sigue siendo un query cliente con `.limit(200)`.

**Regla permanente:** cualquier query que necesite contar o sumar más de 1.000 filas debe hacerse via RPC server-side. El límite de PostgREST es silencioso — no devuelve error, solo trunca.

#### `ai_credits_monthly_limit` actualizado globalmente
**Migración `fix_credit_limits_and_history_summary_rpc`** ejecutó:
```sql
UPDATE clinic_settings SET ai_credits_monthly_limit =
    CASE
        WHEN subscription_plan IN ('enterprise','prestige') THEN 30000
        WHEN subscription_plan IN ('pro','radiance')        THEN 10000
        WHEN subscription_plan IN ('starter','essence')     THEN 5000
        WHEN subscription_plan = 'core'                     THEN 0
    END
WHERE id != HQ_ID;
```
Resultado: Animalgrace Linares 12.000 → **30.000**, Animalgrace Santiago 0 → **30.000**.

#### `process_monthly_recharge()` — valores corregidos
**Problema:** la función que corre mensualmente y resetea créditos tenía hardcodeados los valores del sistema legacy (prestige=5.000, radiance=1.500, resto=500). Hubiera sobreescrito el 30.000 de vuelta a 5.000 el primer día del ciclo.
**Fix — migración `fix_process_monthly_recharge_credit_limits`:**
- CASE actualizado: enterprise/prestige→30.000, pro/radiance→10.000, starter/essence→5.000, core→0
- Remanente calculado correctamente: `limit - miniUsed - (4oUsed × 8)` (antes solo usaba `miniUsed`)
- Sucursales (`parent_clinic_id IS NOT NULL`) excluidas — solo recarga la clínica raíz del pool
- `metadata` agregado a la transacción `monthly_refill`: `{plan, allowance, remanente}`

---

## Cambios realizados — mayo 2026 (sesión 24, 2026-05-28)

### Cierre completo de deuda técnica — todos los pendientes

#### `_shared/cors.ts` — comentario explicativo
Se agregó comentario documenta por qué el CORS usa `*`: es para funciones llamadas desde el browser (`chat-agent`, `ai-simulator`). Los webhooks externos (YCloud, MercadoPago, LS) tienen sus propios headers CORS restrictivos en cada función. No hay que "corregir" el `*`.

#### `appointments.patient_id` — reconciliación retroactiva (migración `reconcile_appointments_patient_id`)
162 citas sin `patient_id` → 31 vinculadas en 3 capas:
- **Capa 1** (riesgo cero): `pet_id IS NOT NULL → patient_id = pet_id` — 3 filas
- **Capa 2** (muy seguro): `tutor_id + LOWER(patient_name) → patients` — 1 fila
- **Capa 3** (phone normalizado): últimos 8 dígitos de phone → tutors → patients por nombre — 27 filas
- **131 sin match** — citas históricas manuales sin datos suficientes para match seguro. No se fuerza el match para evitar asignaciones incorrectas.

Impacto en etiquetas automáticas: tags `Cirugía` y `Vacunado` ahora tienen mejor cobertura para las citas recién vinculadas.

#### N+1 en `checkAvail` — paralelización (`ycloud-whatsapp-webhook` v217)
Antes: 3 queries seriales al inicio de `checkAvail`. Ahora: `Promise.all` con las 3 queries independientes:
```typescript
const [{ data: clinic }, serviceDetails, { data: existingAppts }] = await Promise.all([
    sb.from("clinic_settings").select(...),
    getServiceDetails(sb, clinicId, serviceName),
    sb.from("appointments").select(...).eq("clinic_id", clinicId).neq("status", "cancelled"),
]);
```
`allDayAppts` derivado en memoria filtrando `existingAppts` por fecha — sin query adicional.
**Ahorra ~3 round-trips por cada llamada a `check_availability`** (1 round-trip en paralelo en vez de 3 seriales).

#### `logistics_config.routing_mode` — elimina UUIDs hardcodeados (`ycloud-whatsapp-webhook` v217)
**DB actualizada:**
- Animalgrace Linares: `logistics_config.routing_mode = 'mobile_sectors'`
- Animalgrace Santiago: `logistics_config.routing_zone = 'rm_santiago'`, `fallback_lat/lng` = San Miguel coords

**Webhook:**
```typescript
// Antes (UUID hardcodeado):
const isAnimalGrace = clinicId === CLINIC_ANIMALGRACE_ID;

// Ahora (configurable desde DB):
const isAnimalGrace = (clinic?.logistics_config as any)?.routing_mode === 'mobile_sectors';
```
Lo mismo para el bloque de Santiago: `clinic.logistics_config.routing_zone === 'rm_santiago'` en vez de `clinicId === CLINIC_SANTIAGO_ID`.

**Para agregar nueva clínica móvil:** solo hacer `UPDATE clinic_settings SET logistics_config = logistics_config || '{"routing_mode":"mobile_sectors"}'` — sin deploy.

Las constantes `CLINIC_ANIMALGRACE_ID` y `CLINIC_SANTIAGO_ID` permanecen en el código como referencia documentaria pero **ya no tienen uso en lógica**.

---

## Cambios realizados — mayo 2026 (sesión 25, 2026-05-28)

### Sistema de permisos por miembro — RBAC configurable desde Gestión de Equipo

**Motivación:** los permisos de navegación estaban hardcodeados en `DashboardLayout.tsx` (`vet_assistant` veía un menú fijo; el resto veía todo). No había forma de personalizar accesos sin deploy.

#### Arquitectura

**DB — migración `member_permissions`:**
- `clinic_members.permissions JSONB DEFAULT NULL` — `null` = usar defaults del rol; el valor almacenado sobreescribe completamente
- RPC `update_member_permissions(p_member_id, p_permissions)` con `SECURITY DEFINER`:
  - Solo `owner` o `admin` pueden llamarla
  - Bloquea modificación de permisos de `owner` / `admin`
  - No requiere cambios de RLS

**`src/lib/permissions.ts` (nuevo):**
- Tipos `PageKey` (15 páginas), `ActionKey` (11 acciones), `MemberPermissions`
- `FULL_PERMISSIONS` — acceso total para owner/admin
- `ROLE_DEFAULTS` — defaults por rol: `professional`, `receptionist`, `vet_assistant`
- `getEffectivePermissions(role, storedPermissions)` — owner/admin → full; stored null → role defaults; stored value → stored

**`src/hooks/usePermissions.ts` (nuevo):**
- `canAccess(page: PageKey)` — ¿puede ver esta sección?
- `can(action: ActionKey)` — ¿puede ejecutar esta acción?
- Fail-open mientras `member` carga (devuelve `true`) para evitar flash de contenido bloqueado
- Lee `member.permissions` del contexto de auth

**`DashboardLayout.tsx`:**
- Cada ítem de `navigationSections` tiene ahora un campo `pageKey: PageKey`
- Filtrado de nav reemplazado por `canAccess(item.pageKey)` en ambos sidebars (desktop + mobile)
- Eliminado el switch hardcodeado que tenía `vet_assistant` con lista fija y `isOwnerOrAdmin` para finanzas/CRM/campañas

**`teamService.ts`:**
- Campo `permissions?: MemberPermissions | null` agregado a `ClinicMember`
- Método `updateMemberPermissions(memberId, permissions)` — llama al RPC

**`Team.tsx`:**
- Botón **Permisos** por fila (visible para `isAdmin`, solo en roles `professional`/`receptionist`/`vet_assistant`)
- Badge **Personalizado** en la fila si `member.permissions != null`
- Modal de edición con:
  - Header: nombre + badge de rol + botón "Restaurar defaults del rol"
  - Sección "Acceso a secciones": toggles agrupados (Principal / Clínica / Marketing / Agente IA / Configuración)
  - Sección "Acciones permitidas": toggles agrupados (Dashboard / Pacientes / Tutores / Citas / Datos)
  - Footer: Cancelar + Guardar cambios (actualiza DB y estado local inmediatamente)

#### Defaults por rol

| Permiso | Professional | Receptionist | Vet Assistant |
|---|:---:|:---:|:---:|
| Dashboard | ✅ | ✅ | ✅ |
| Citas, Pacientes, Tutores | ✅ | ✅ | ✅ |
| Mensajes, Recordatorios | ✅ | ✅ | ❌/✅ |
| CRM | ❌ | ✅ | ❌ |
| Plantillas | ✅ | ✅ | ❌ |
| Campañas, Finanzas, Settings, IA | ❌ | ❌ | ❌ |
| Ver métricas financieras | ❌ | ❌ | ❌ |
| Crear/editar pacientes y tutores | ✅ | ✅ | ❌ |
| Eliminar pacientes/tutores/citas | ❌ | citas ✅ | ❌ |

#### Regla permanente — permisos
- `owner` y `admin` siempre tienen acceso total. El hook lo fuerza en frontend; el RPC lo bloquea en el servidor.
- Para guardar permisos custom de un miembro: usar `teamService.updateMemberPermissions()` — nunca un UPDATE directo (no pasaría RLS).
- Para verificar si un usuario puede hacer algo en cualquier página: `const { canAccess, can } = usePermissions()`.
- Al agregar una nueva sección al nav, agregar su `pageKey` al ítem en `navigationSections` y su default en `ROLE_DEFAULTS` en `src/lib/permissions.ts`.

---

## Cambios realizados — mayo 2026 (sesión 26, 2026-05-28)

### SEO técnico y marketing — `public/landing.html`

- **`<title>`** actualizado con keywords SEO: "Software veterinario con IA | Recepcionista digital 24/7 por WhatsApp"
- **`<meta name="description">`** agregado (155 chars)
- **`<link rel="canonical">`** apuntando a `https://vetly.pro/`
- **Open Graph completo**: `og:type`, `og:url`, `og:title`, `og:description`, `og:image`, `og:locale`, `og:site_name`
- **Twitter Cards**: `twitter:card`, `twitter:title`, `twitter:description`, `twitter:image`
- **`preconnect`** para Google Fonts (reduce latencia de carga de fuente Outfit)
- **Imágenes rotas corregidas**: `lia.png` → `lia.webp`, `goldi.png` → `goldi.webp`, `imagen-vet-claudia.png` → `imagen-vet-claudia.webp`

### Archivos nuevos en `public/`
- **`robots.txt`**: `Allow: /` + referencia a sitemap
- **`sitemap.xml`**: URLs `/` (priority 1.0) y `/demo` (priority 0.8)
- **`og-image.png`**: imagen OG 1200×630px, 163KB (compatible con WhatsApp <600KB)

### Sistema de marketing (`/`)
- **`.agents/product-marketing.md`**: contexto de marketing de Vetly creado. Todos los marketing skills lo leen automáticamente. Contiene: 3 segmentos target, personas, dolores, competidores, TAM LATAM, historia de Claudia, historia del fundador (Movilvets), plan de contenido SEO 15 artículos.
- **41 marketing skills** instalados globalmente en `~/.claude/skills/` — disponibles en cualquier proyecto.

**Regla permanente:** cualquier cambio de copy, precios, posicionamiento o segmentos → actualizar `.agents/product-marketing.md`. Los cambios de código/arquitectura → este CLAUDE.md.

---

## Tareas pendientes

### Deuda técnica conocida — no urgente

#### `auto_open_daily_cajas()` — timezone hardcodeado a Chile (jobid 18, pg_cron)

**Ubicación:** `supabase/migrations/20260604000001_caja_v2_improvements.sql` + función en DB.

**Situación actual:** la función que abre cajas automáticamente a las 07:00 usa `'America/Santiago'` hardcodeado:
```sql
v_today DATE := (NOW() AT TIME ZONE 'America/Santiago')::DATE;
```

**Impacto hoy:** ninguno — todos los clientes actuales son chilenos.

**Impacto cuando haya clientes de otro país:** la caja abriría con la fecha chilena, no la fecha local del cliente.

**Fix a aplicar cuando llegue el primer cliente de otro país:**
```sql
CREATE OR REPLACE FUNCTION public.auto_open_daily_cajas()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO public.cash_registers (clinic_id, date, status)
    SELECT
        id,
        (NOW() AT TIME ZONE COALESCE(timezone, 'America/Santiago'))::DATE,
        'open'
    FROM public.clinic_settings
    WHERE id != '00000000-0000-0000-0000-000000000000'
    ON CONFLICT (clinic_id, date) DO NOTHING;
END;
$$;
```

**Contexto:** el frontend ya está correctamente multi-timezone — `useClinicTimezone` lee `clinic_settings.timezone` y lo usa para calcular "hoy" en cada clínica. El único punto pendiente es este cron del lado del servidor.

---

Los únicos ítems que quedaron intencionalmente sin modificar:
- **`check_*.js` en raíz** — 0 archivos encontrados. Ya estaba limpio.
- **`user_profiles.clinic_id NULL`** — 3 cuentas dev/test (`claubarreraolivero@gmail.com`, `seba.barreraolivero.070493@gmail.com`, `vetflow.cl@gmail.com`) sin `clinic_members`. `clinic_id = NULL` es el estado correcto para cuentas sin clínica asignada. No bloquea nada (RLS usa `clinic_members`).

---

## Arquitectura de agentes HQ (2026-05-25)

### `vetly-hq-agent` (WhatsApp +56993089185)
- **Router**: compara `from` contra `hq_admin_phones` → soporte o ventas
- **Consultor Andrés** (ventas): GPT-4o, historial de conversación, tools: `registrar_lead`, `escalar_lead_caliente`, `agendar_videollamada`
- **Comandos de soporte** (admin): `status`, `saldo`, `errores`, `openai`, `debug <clínica>`, `ayuda`
- **HMAC**: misma implementación que el webhook principal (UTF-8 key, `t.body` payload)
- **`verify_jwt: false`** — necesario para webhooks YCloud

### `cron-system-health` (jobid 16, cada 6h: `0 */6 * * *`)
- Chequea OpenAI, saldo YCloud de cada clínica, recordatorios fallidos, agente mudo
- Envía alerta WhatsApp a `hq_escalation_phone` cuando hay problemas
- Retorna `notify_msg_id` para trazabilidad en YCloud dashboard
- **`verify_jwt: false`** — invocado por pg_cron, no por usuarios

### `chat-agent` (widget in-app)
- Ruta ventas: GPT-4o-mini, prompt con precios correctos CLP
- Ruta soporte: JWT → `clinic_id`, modelo híbrido (mini por default, 4o para diagnósticos), tools `diagnosticar_sistema` + `escalar_a_soporte`
- **`verify_jwt: false`** — el widget lo llama desde el browser con su propio JWT

### `_shared/diagnostics.ts`
Módulo compartido usado por los 3 agentes anteriores. Incluye: `sendWhatsApp` (retorna `{id,status}`), `getYCloudBalance`, `checkOpenAI`, `classifyError`, `getRecentErrors`, `getReminderFailures`, `detectMute`, `runClinicDiagnostics`, `formatHealthReport`.

---

## Cambios realizados — mayo 2026 (sesión 27, 2026-05-29)

### Fix `update_member_permissions` — columna `updated_at` inexistente

El RPC intentaba `SET permissions = p_permissions, updated_at = NOW()` pero `clinic_members` no tiene columna `updated_at`. Fix: eliminado `updated_at = NOW()` del UPDATE. Migración: `fix_update_member_permissions_no_updated_at`.

### Trigger auto-creación de tutor + paciente al completar cita

Trigger `tr_auto_create_contacts_on_complete` (AFTER UPDATE OF status ON appointments):
- Se activa solo al transicionar a `'completed'` por primera vez
- Normaliza teléfono con `regexp_replace(phone, '[^0-9]', '', 'g')`
- Upsert de tutor por `(clinic_id, phone_number)` — crea si no existe, completa campos vacíos si ya existe
- Crea paciente si no existe para ese tutor (match por nombre case-insensitive, solo mascotas vivas)
- Actualiza `appointments.tutor_id` y `appointments.pet_id`
- Luego otorga puntos de lealtad si `loyalty_enabled = true` (ver Sistema de referidos abajo)
- Fix de iteración: `patients_status_check` acepta `'alive'`/`'deceased'`, no `'active'`

### Sistema de referidos completo

#### Texto corregido
`copyReferralLink` en `Loyalty.tsx`: "agendar una consulta" → "agendar una cita"

#### URL corta `/r/:code`
- Botón "Magic Link" en Fidelización ahora copia `vetly.pro/r/{code}` (antes era la URL wa.me larga con encoding)
- `ReferralRedirect.tsx` (nueva página): lee el código, llama `get_referral_link_data(code)`, construye la URL wa.me y redirige
- Ruta pública `/r/:code` en `App.tsx`

#### Webhook — detección de código de referido
- Selección agregada: `referred_by` al query inicial de tutors
- Después del bloque de `tutorContext`, antes del API key check: regex `\b([A-Za-z0-9]{6})\b` sobre el `text` del mensaje
- Si código encontrado y tutor sin `referred_by`: lookup en `tutors.referral_code` para esa clínica → si hay match, `UPDATE tutors SET referred_by = referrer.id` (o upsert del tutor con `referred_by` si es nuevo)
- Variable `referralContext` inyectada al final del system prompt: "Este cliente llegó REFERIDO por {name}…"
- Deploy: webhook v218

#### Puntos de lealtad automáticos (en el trigger de completar cita)
Solo en la **primera** cita completada del tutor:
- `loyalty_welcome_bonus` pts → nuevo cliente (INSERT en `loyalty_transactions` tipo `welcome_bonus`)
- `loyalty_referral_bonus` pts → referidor (`UPDATE tutors.loyalty_points` + `referral_count++` + INSERT tipo `referral_reward`)
- Migración: `referral_system_rpc_and_loyalty_trigger`

#### RPCs públicos (anon + authenticated)
- `get_referral_link_data(p_code TEXT)` → `TABLE(clinic_phone, tutor_name)` — para `ReferralRedirect`
- `get_pet_owner_portal(p_code TEXT)` → `JSONB` — para `PetOwnerPortal` (ver abajo)

### Portal del tutor — `vetly.pro/p/:code`

Página pública accesible sin login, identificada por el `referral_code` del tutor.

**Datos que muestra:**
- Banner con gradiente teal/cyan, nombre del tutor centrado, clínica
- Saldo de puntos + contador de referidos + botón para copiar enlace corto
- Cards por mascota (colapsables, la primera abre por defecto):
  - Especie, sexo, fecha de nacimiento
  - Historial de vacunas con nombre, fecha aplicada, badge de próxima dosis (rojo/ámbar/verde)
  - Historial de desparasitaciones con tipo, marca, fecha aplicada, badge de próxima dosis
  - Historial médico: tipo de evento, diagnóstico, peso, fecha
- Citas recientes (hasta 6) con estado coloreado
- Botón "Agendar por WhatsApp" → `wa.me/{clinic_phone}`

**Rutas y archivos:**
- `PetOwnerPortal.tsx` — nueva página
- Ruta `/p/:code` en `App.tsx`
- RPC `get_pet_owner_portal` v3 (migración `pet_owner_portal_rpc_v3_fix_columns`):
  - `vaccines`: columna `name` (no `type`), sin `brand` — así está la tabla real
  - `deworming`: columna `type`, `brand` — correcto
  - Aliases explícitos (`pat`, `vac`, `dew`, `mh`, `appt`) para evitar colisiones con variables PL/pgSQL

**Regla permanente — páginas públicas y Supabase:**
`ReferralRedirect.tsx` y `PetOwnerPortal.tsx` usan su propio `publicClient` (NO el cliente global):
```typescript
const publicClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
})
```
**Por qué:** el cliente global usa la Web Locks API para sincronizar sesiones entre pestañas. Cuando una página pública (sin auth) se abre en el mismo browser que el dashboard autenticado, el nuevo lock "roba" (`steal`) el existente → `AbortError: Lock broken by another request with the 'steal' option` → la request se cancela silenciosamente → `data = null` → "Portal no encontrado". El cliente sin sesión no usa locks.

### Botón "Portal" en Fidelización

En la lista de tutores de `Loyalty.tsx`, junto al botón "Referido" aparece un botón **Portal** que abre `vetly.pro/p/{referral_code}` en nueva pestaña — permite verificar el portal del tutor directamente desde el dashboard.

---

## Cambios realizados — mayo 2026 (sesión 28, 2026-05-29)

### Dashboard `src/pages/Dashboard.tsx` — auditoría completa y mejoras

#### Cálculo de "Tiempo Ahorrado" — reescrito
**Problema:** `appointments × 15 min` no reflejaba el trabajo real del agente.
**Nuevo cálculo:**
```typescript
minutosAhorrados = (aiMessages × 3) + (appointments × 5) + (reminders × 2)
```
- **3 min/mensaje IA**: leer el entrante + pensar + escribir respuesta (lo que haría un humano)
- **5 min/cita**: flujo completo de agendamiento + coordinación en agenda
- **2 min/recordatorio**: buscar contacto + redactar + enviar manualmente

#### Bug 1 — "Citas Canceladas" siempre mostraba 0
**Causa raíz:** la query filtraba por `appointments.updated_at` que **no existe** en la tabla. PostgREST lo silenciaba y devolvía 0.
**Fix:** `updated_at` → `created_at` en el query actual y en el query del período anterior.

#### Bug 2 — Top Servicios y Tasa de Conversión ignoraban el filtro
**Causa raíz:** las queries #5 (service ranking) y #6 (conversion rate) usaban `startOfMonth` hardcodeado sin importar qué filtro estaba activo.
**Fix:** ahora usan `startOfStats / endOfStats` del filtro seleccionado. Labels del header ("Este mes", "contactos que agendaron cita este mes") también se actualizan dinámicamente.

#### Bug 3 — Badges mostraban "100% ↑" cuando el período anterior tenía 0 datos
**Causa raíz:** `calculatePercentage` retornaba `100` cuando `previous === 0 && current > 0`, lo que era visualmente idéntico a un verdadero crecimiento del 100%.
**Fix:** retorna `null` cuando `previous === 0 && current > 0`. El `ChangeBadge` muestra "–" en gris.

#### Badges de comparación — etiqueta contextual
Cada badge ahora muestra dos líneas: el porcentaje y el período comparado.
```
↑ 47%
vs. mes ant.
```
Labels dinámicos: `vs. ayer` / `vs. sem. ant.` / `vs. mes ant.` / `vs. año ant.` / `vs. Xd ant.` (para rango personalizado).

#### "NUEVOS PROSPECTOS" → "CONVERSACIONES ÚNICAS"
La métrica cuenta teléfonos inbound únicos en el período (incluye clientes existentes que escribieron de nuevo). El nombre anterior era incorrecto. Verificado: de 396 "prospectos" en mayo, solo 10 eran clientes existentes — 97% son genuinamente nuevos, pero el label correcto es "conversaciones únicas".

#### Selector de rango de fechas con mini calendario
**Reemplaza** los 4 botones fijos `Hoy/Semana/Mes/Año` con un diseño más flexible:
- Botones de preset: `Hoy / Sem. / Mes / Año` (ahora abreviados)
- Botón **Rango** con ícono de calendario → abre un popover con mini calendario
- El mini calendario se construyó **sin dependencias nuevas**, usando `date-fns` ya instalado
- Dos clicks: primer clic = fecha inicio (con resaltado hover del rango), segundo clic = fecha fin
- Al confirmar: botón muestra `"15 may – 28 may"` con `×` para limpiar
- El período anterior para los badges se calcula automáticamente: misma duración, shifted back
- Cierra al hacer clic fuera (listener `mousedown` con `useRef`)

**Estado nuevo en Dashboard:**
```typescript
const [timeRange, setTimeRange] = useState<'day' | 'week' | 'month' | 'year' | 'custom'>('month')
const [customRange, setCustomRange] = useState<{ start: Date; end: Date } | null>(null)
const [showDatePicker, setShowDatePicker] = useState(false)
```

**Cálculo del período anterior para rango custom:**
```typescript
const days = differenceInCalendarDays(customRange.end, customRange.start) + 1
startOfPrev = toUTC(startOfDay(subDays(customRange.start, days)))
endOfPrev   = toUTC(endOfDay(subDays(customRange.end, days)))
```

#### Race condition en cambio de filtros — fix con `cancelled` flag
**Síntoma:** al cambiar filtros rápido, los datos retroactivaban mostrando resultados del filtro anterior antes de estabilizarse en el correcto.
**Causa raíz (dos bugs combinados):**
1. Sin cancelación de fetches en vuelo: si "Mes" resolvía después de "Año", pisaba el estado con datos incorrectos
2. `setLoading(true)` solo corría en el mount inicial — al cambiar filtro, `loading` era `false` y el usuario veía datos viejos sin spinner

**Fix — patrón estándar de React:**
```typescript
useEffect(() => {
    let cancelled = false
    const fetch = async () => {
        setLoading(true)                    // spinner inmediato
        // ... await Promise.all(queries)
        if (cancelled) return               // ignorar resultados stale
        // ... setState(...)
    }
    fetch()
    return () => { cancelled = true }       // cleanup cancela el fetch anterior
}, [user, profile?.clinic_id, timeRange, customRange])
```

**Resultado:** cada cambio de filtro muestra el spinner de inmediato y solo el fetch más reciente actualiza el estado. Sin retroactividad, sin flickering.

---

## Cambios realizados — mayo 2026 (sesión 29, 2026-05-29)

### Filtro de calendario en Finance — paridad con Dashboard

`Finance.tsx` ahora tiene el mismo selector de período que Dashboard: botones `Hoy / Sem. / Mes / Año` + botón **Rango** con mini calendario desplegable. El componente `MiniCalendar` es idéntico (construido con `date-fns`, sin dependencias nuevas). El export CSV/JSON usa el label del rango custom cuando está activo.

**Patrón:** el mismo `MiniCalendar` inline de Dashboard se copió a Finance. Si se necesita en más páginas, considerar extraerlo a `src/components/ui/MiniCalendar.tsx`.

---

## Cambios realizados — mayo 2026 (sesión 30, 2026-05-29)

### Sistema de Inventario — implementación completa (4 fases)

#### DB — 3 tablas nuevas (migración `inventory_system`)

| Tabla | Propósito |
|---|---|
| `inventory_products` | Catálogo: nombre, SKU, categoría, unidad, precio compra/venta, stock, alerta mínimo, lote, vencimiento |
| `inventory_movements` | Log de movimientos (purchase/sale/adjustment/waste/return). Trigger `tr_update_stock_on_movement` actualiza stock automáticamente al insertar |
| `appointment_items` | Líneas de detalle por cita (service/product). `subtotal = quantity × unit_price`, calculado en app |

**RLS:** todas via `clinic_members` (soporte multi-sucursal).

**RPCs:**
- `get_inventory_abc(clinic_id, days)` — clasificación ABC por ingresos generados en el período
- `get_inventory_no_rotation(clinic_id, days)` — productos con stock > 0 sin ventas en N días
- `get_finance_item_metrics(clinic_id, start, end)` — métricas de ítems para Finance: by_type, top_services, top_products, appt_metrics
- `get_appointment_items(appointment_id)` — ítems de una cita específica

#### Módulo Inventario (`src/pages/Inventory.tsx`)

**3 tabs:**
1. **Catálogo**: tabla con CRUD, badges de estado (Sin stock / Bajo stock / Vence pronto / OK), botones de editar/archivar/ajustar stock
2. **Movimientos**: log filtrable por tipo (200 filas), muestra nombre del producto
3. **Análisis**: clasificación ABC (A=80% ingresos, B=15%, C=5%), tabla de productos sin rotación con selector de días (15/30/60/90d)

**Modal de ajuste de stock (bidireccional):**
- Toggle **Ingreso (+)** / **Baja (−)**
- En Ingreso: campo de costo por unidad, preview verde
- En Baja: selector de motivo (Merma/Vencimiento · Ajuste · Devolución a proveedor), preview rojo con alerta si quedaría negativo o bajo mínimo
- Colores y texto del botón adaptativos

**Categorías de productos (13):** `medication`, `vaccine`, `antiparasitic`, `anesthetic`, `antibiotic`, `anti_inflammatory`, `vitamin`, `disinfectant`, `surgical`, `food`, `accessory`, `supply`, `other`. Tanto en CHECK constraint de DB como en frontend.

**Inversión vs valor de venta:** el banner muestra **"Inversión"** = `stock_quantity × purchase_price` (costo real invertido, no precio de venta).

**Fix inputs numéricos:** todos los campos numéricos del modal de producto usan `value={n || ''}` con `placeholder` — evita el cero inicial al escribir.

#### Modal de cierre de visita (`src/components/appointments/VisitClosureModal.tsx`)

Se activa cuando el usuario marca una cita como "Completada" (reemplaza el `alert()`). El trigger `tr_auto_create_contacts_on_complete` ya habrá creado el tutor antes de que el modal aparezca.

**Contenido:**
- Lista de ítems pre-cargada con el servicio de la cita
- Buscador de productos del inventario — agrega con `+1` si ya está en la lista
- Cada ítem: cantidad editable, precio editable, subtotal calculado, botón eliminar
- Campo de **descuento**: toggle `{currency}` / `%`, monto calculado en tiempo real
- Resumen: Subtotal → Descuento → **Total a cobrar**
- Selector de método de pago (Efectivo / Transferencia / Tarjeta / Débito)
- Toggle Cobrado / Pendiente
- Moneda leída de `clinic_settings.currency` al abrir

**Al guardar** (`inventoryService.closeVisit()`):
1. UPDATE `appointments` con `status='completed'`, `price=finalTotal`, `discount`, `payment_method`, `payment_status`
2. INSERT en `appointment_items` (un registro por ítem)
3. INSERT en `inventory_movements` tipo `sale` con `quantity=-n` para cada producto — el trigger descuenta stock automáticamente

#### Finance profesional

**Tab "Análisis"** (nuevo):
- Cards: ticket promedio, citas con productos vendidos (% del total), ingresos por tipo (Servicios/Productos)
- Top 10 servicios del período
- Top 10 productos del período

**Tab "Transacciones"** mejorado:
- Click en el nombre del servicio expande la fila mostrando `appointment_items` (desglose de ítems con badges Serv./Prod.)
- Botón **"Comprobante"** por cada transacción
- Las citas anteriores al sistema de inventario muestran "Sin desglose de ítems"

**Comprobante de visita** (`src/components/finance/VisitReceipt.tsx`):
- Modal con preview del recibo (clínica, paciente, tutor, fecha, tabla de ítems, total, método de pago, estado)
- **Imprimir / PDF**: abre ventana del navegador con HTML estilizado listo para "Guardar como PDF"
- **Enviar por WhatsApp**: edge function `send-visit-receipt` (deployada, `verify_jwt: false`) envía mensaje de texto formateado al tutor vía YCloud

#### Descuento en formulario de ingreso manual (`NewIncomeForm.tsx`)

Mismo campo de descuento que el modal de cierre de visita: toggle monto fijo / %, resumen Subtotal → Descuento → Total a registrar. El descuento se guarda en `incomes.discount` (columna `NUMERIC DEFAULT 0`).

El monto al agregar servicios del catálogo se calcula automáticamente (readonly); si no hay servicios, el campo es editable. La moneda se lee de `clinic_settings.currency`.

#### Historial financiero por tutor (`TutorDetails.tsx` — tab "Historial Financiero")

El tab ya existía pero solo mostraba el nombre del servicio. Ahora:
- Consulta citas por `tutor_id` directamente (antes hacía N+1 via `patient_id`)
- Fallback a `patient_id` para citas históricas sin `tutor_id`
- Carga `appointment_items` en una sola query para todas las citas del período
- Muestra desglose real: badges Serv./Prod. + cantidad + subtotal por ítem
- Muestra descuento aplicado si lo hubo
- Método de pago en el subtítulo
- Badges "Visita" / "Ingreso" según tipo de transacción

#### Archivos clave del sistema de inventario

| Archivo | Rol |
|---|---|
| `src/pages/Inventory.tsx` | Página completa (catálogo, movimientos, análisis) |
| `src/services/inventoryService.ts` | CRUD productos, movimientos, closeVisit, analytics |
| `src/components/appointments/VisitClosureModal.tsx` | Modal cierre de visita con descuento |
| `src/components/finance/VisitReceipt.tsx` | Preview + imprimir + envío WA |
| `src/components/finance/NewIncomeForm.tsx` | Formulario ingreso manual con descuento |
| `src/components/patients/TutorDetails.tsx` | Tab "Historial Financiero" mejorado |
| `supabase/functions/send-visit-receipt/index.ts` | Edge function comprobante WA |
| `supabase/migrations/20260529000001_inventory_system.sql` | Tablas + triggers + RPCs |

#### Reglas permanentes — inventario

- **Trigger de stock**: `tr_update_stock_on_movement` es el único mecanismo que actualiza `stock_quantity`. Nunca hacer UPDATE directo de ese campo.
- **Precio en appointments**: `appointments.price` = precio **después del descuento**. `appointments.discount` = monto descontado. Precio bruto = `price + discount`.
- **Inversión del stock**: `totalValue` usa `purchase_price`, no `sale_price`. Refleja dinero invertido.
- **Moneda dinámica**: `VisitClosureModal` y `NewIncomeForm` leen `clinic_settings.currency` al montar. No hardcodear moneda en estos componentes.
- **Inputs numéricos**: usar `value={n || ''}` con `placeholder` para evitar cero inicial visible. Al parsear: `Number(e.target.value) || 0`.
- **`appointment_items` vs `appointments.service`**: las citas cerradas desde el modal tienen desglose en `appointment_items`. Las citas históricas solo tienen `appointments.service` y `appointments.price`. Siempre hacer fallback al campo legacy si no hay ítems.

#### Permisos
- `inventory` agregado a `PageKey` en `src/lib/permissions.ts`
- Acceso por defecto: `owner` y `admin` = true; todos los demás roles = false
- Ruta: `/app/inventory` (lazy-loaded en App.tsx, con SubscriptionGuard + RoleGuard owner/admin)

---

## Cambios realizados — mayo 2026 (sesión 31, 2026-05-30)

### Finance — corrección masiva de bugs (todo mostraba $0.00)

**Causa raíz:** el `Promise.all` en `Finance.tsx loadData()` incluía 4 queries paralelas. Las RPCs `get_clinic_expenses_secure` y `get_clinic_transactions_secure` no existían → `Promise.all` rechazaba → catch silencioso → todo $0.00 y listas vacías.

**Migraciones aplicadas:**

#### `finance_missing_tables_and_rpcs`
- Tabla `expenses` creada con RLS via `clinic_members`
- Columnas `payment_status TEXT DEFAULT 'pending'` y `payment_method TEXT` añadidas a `appointments`
- Backfill: citas completadas con precio > 0 → `payment_status = 'paid'`
- RPCs creados: `get_clinic_expenses_secure`, `create_clinic_expense`, `get_clinic_transactions_secure`, `update_appointment_payment_status`
- `get_finance_stats` reescrito para usar `status != 'cancelled' AND price > 0` (antes usaba `status = 'completed'` que ninguna cita de Linares cumplía)

#### `fix_finance_rpcs_include_all_priced_appointments`
- `get_clinic_transactions_secure` y `get_finance_stats` actualizados para incluir **todas las citas no canceladas con precio > 0** (no solo las `completed`)
- Razón: Claudia ingresa citas manualmente y nunca las marca como `completed` — usar `completed` mostraba $0

#### `fix_finance_item_metrics_real_data`
- `get_finance_item_metrics` actualizado: usa `status != 'cancelled'` en lugar de `status = 'completed' AND payment_status IN ('paid','partial')`
- Fallback `top_services_fallback`: cuando no hay `appointment_items`, usa `appointments.service + price` directamente
- Resultado: ticket promedio y top servicios ahora muestran datos reales ($22.129 promedio, 31 citas mayo Linares)

#### `income_notes_and_fix_create_income_rpc`
- `incomes.notes TEXT DEFAULT NULL` añadida
- `create_clinic_income` reescrito: ahora guarda `tutor_id`, `services`, `discount`, `notes`, `payment_method` en un solo INSERT (antes se perdían)

#### `add_payment_method_to_incomes`
- `incomes.payment_method TEXT DEFAULT NULL` añadida
- `create_clinic_income` actualizado para aceptar `p_payment_method`

#### `save_transaction_items_and_update_income_rpcs`
- `save_transaction_items(p_appointment_id, p_clinic_id, p_items jsonb, p_price, p_discount, p_payment_method)` — borra ítems anteriores, inserta nuevos, actualiza appointment
- `update_clinic_income(p_income_id, ...)` — actualiza todos los campos de un ingreso manual

### Finance — nuevas funcionalidades

#### Acciones de transacciones (nuevo orden)
1. **Registrar Pago** (solo pendientes) / **Deshacer Pago** (solo pagadas)
2. **Editar** → `EditTransactionModal`
3. **Comprobante** → `VisitReceipt`
4. **Eliminar** → `handleClearTransaction` (precio → 0)

#### `EditTransactionModal` (`src/components/finance/EditTransactionModal.tsx`)
Modal nuevo para editar una transacción existente:
- Carga `appointment_items` existentes (o ítem sintético del campo `service` si no hay)
- Agrega/elimina servicios del catálogo y productos del inventario
- Edita cantidad y precio unitario inline
- Descuento (fijo o porcentaje) y método de pago
- Guarda via RPC `save_transaction_items`

#### Ingresos manuales — editar y eliminar
- Tab "Otros Ingresos": botones **Editar** y **Eliminar** por fila
- Editar abre `NewIncomeForm` en modo edición (pre-relleno con datos actuales)
- `handleUpdateIncome` → RPC `update_clinic_income`

#### `NewIncomeForm` — mejoras
- **Campo "Categoría" eliminado** — se auto-calcula (`product` si solo hay productos, `service` si hay servicios o nada)
- **Buscador de productos del inventario** — mismo patrón que buscador de tutor (search-as-you-type), productos en violet
- **Método de pago** — 4 botones toggle: Efectivo / Transferencia / Tarjeta crédito / Tarjeta débito
- **Notas** — textarea 2 líneas
- **Modo edición** — acepta prop `editingIncome` para pre-rellenar y cambiar título/botón

#### `VisitReceipt` — fix bug "Cargando ítems..." colgado
**Causa:** `setLoadingItems(true)` se activaba, pero cuando el RPC devolvía `[]` vacío, el `.finally()` no siempre ejecutaba a tiempo antes de que React batcheara las re-renders. Resultado: spinner colgado permanentemente.
**Fix:** eliminado el estado `loadingItems` y el spinner. `onLoadItems()` se llama en background (`fire-and-forget`). `displayItems` usa el ítem sintético del `tx.service` de inmediato si no hay ítems reales.

#### Reglas permanentes — Finance

**`appointments.payment_status`:**
- Valores: `'pending'`, `'paid'`, `'partial'`, `'refunded'`
- Default: `'pending'`
- Backfill histórico: citas con `status='completed'` y `price > 0` → `'paid'`
- Las citas de Linares que Claudia ingresa manualmente quedan en `'pending'` hasta que se registre el pago manualmente desde Finance

**Transacciones vs Ingresos manuales:**
- Tab **"Transacciones"**: citas de `appointments` donde `status != 'cancelled'` y `price > 0`. Tienen comprobante con Imprimir + WhatsApp.
- Tab **"Otros Ingresos"**: registros de tabla `incomes`. Se crean manualmente desde el botón "+ Ingreso". No tienen comprobante propio aún.

**`financeService` — métodos clave:**
- `addIncome(income)` → RPC `create_clinic_income` (9 parámetros, incluyendo notes y payment_method)
- `updateIncome(id, income)` → RPC `update_clinic_income`
- `saveTransactionItems(appointmentId, clinicId, items, price, discount, paymentMethod)` → RPC `save_transaction_items`
- `getTransactions` → RPC `get_clinic_transactions_secure`
- `getExpenses` → RPC `get_clinic_expenses_secure`

---

### Sistema de Inventario — análisis de facturas con IA

#### Edge function `analyze-invoice` (v1, `verify_jwt: false`)

**Flujo:**
1. Verifica acceso del usuario via JWT + `clinic_members`
2. Resuelve pool de créditos (respeta `parent_clinic_id` para sucursales)
3. Si no es `ai_credits_unlimited`: suma consumo del mes en `ai_credit_transactions`, verifica que haya ≥ 20 créditos
4. Envía imagen a GPT-4o-mini Vision con prompt estructurado
5. Parsea JSON devuelto: `{products, supplier, invoice_number, invoice_date}`
6. Inserta transacción `-20` en `ai_credit_transactions` con `metadata.source: 'invoice_analysis'`
7. Retorna productos extraídos

**Cobro:** 20 créditos por archivo (independiente del número de páginas). Aparece en historial de AISettings con descripción `"Análisis de factura (N productos detectados)"`.

#### `InvoiceAnalysisModal` (`src/components/inventory/InvoiceAnalysisModal.tsx`)

**Acepta:** imágenes (JPG, PNG, WEBP) y PDFs. Máx 20 MB.

**Flujo PDF (pdfjs-dist, lazy import):**
- `pdfjs-dist` se importa dinámicamente solo cuando el usuario sube un PDF — no afecta el bundle inicial
- Renderiza cada página a canvas (escala 2× para mejor legibilidad)
- Convierte a JPEG base64
- Llama a la edge function una vez **por página** (máx `MAX_PAGES = 5`)
- **Deduplicación automática**: si el mismo producto aparece en varias páginas, las cantidades se suman
- Si el PDF tiene más de 5 páginas → aviso toast + solo se procesan las primeras 5

**Modelo de precios:** 20 créditos por archivo, independiente de páginas. No por página.

**3 pasos del modal:**
1. **Upload**: zona drag-and-drop, acepta PDF e imágenes
2. **Analyzing**: spinner con estado dinámico ("Analizando página 2 de 3...")
3. **Review**: tabla editable — nombre, cantidad, precio, categoría por producto; checkbox para seleccionar/deseleccionar; botón eliminar; resumen de inversión total

**Al confirmar** → `inventoryService.bulkReceiveProducts()`:
- Para cada producto: busca por nombre (case-insensitive) en `inventory_products`
- Si existe: actualiza `purchase_price` + inserta movimiento `purchase`
- Si no existe: crea producto nuevo (precio venta = precio compra como default) + inserta movimiento
- El trigger `tr_update_stock_on_movement` actualiza `stock_quantity` automáticamente

#### Archivos clave — análisis de facturas

| Archivo | Rol |
|---|---|
| `supabase/functions/analyze-invoice/index.ts` | Edge function GPT-4o-mini Vision |
| `src/components/inventory/InvoiceAnalysisModal.tsx` | Modal completo (upload, análisis, revisión) |
| `src/services/inventoryService.ts` → `bulkReceiveProducts` | Upsert masivo de productos |

#### Reglas permanentes — análisis de facturas

- El costo es siempre **20 créditos por archivo**, no por página
- Máximo **5 páginas** por PDF. Si el archivo tiene más, se avisa y se procesan las primeras 5
- El crédito se descuenta del pool `parent_clinic_id` (misma lógica que mensajes del webhook)
- `pdfjs-dist` se carga lazy — no hardcodear en imports de nivel superior
- La deduplicación es por nombre exacto case-insensitive. Productos con nombres distintos pero equivalentes (ej: "Amoxicilina 500mg" vs "AMOXICILINA 500MG") se crean como productos separados — el usuario puede fusionarlos manualmente en el catálogo

---

## Cambios realizados — mayo 2026 (sesión 32, 2026-05-30)

### Sistema de inventarios múltiples — implementación completa

#### Motivación
Animalgrace opera con una sede y un vehículo móvil. Necesitaban saber exactamente cuánto stock había en cada lugar por separado, y poder traspasar productos entre ambos. Adicionalmente, necesitaban registrar materiales operativos (pinzas, termómetros, jeringas) que no se venden pero sí se usan en cada atención.

#### Impacto en la gestión de las clínicas Vetly

**Para clínicas móviles (caso Animalgrace):**
- Pueden crear un 2do inventario "Vehículo" y gestionar el stock de cada lugar por separado
- Al iniciar la jornada: traspasar desde "Sede" al "Vehículo" los productos que llevarán
- Al cerrar la jornada: devolver al "Sede" lo que sobró
- El arqueo es exacto: saben cuánto hay en el vehículo y cuánto en la sede en todo momento
- El switch "Activo para ventas" determina de qué inventario se descuenta cuando se cierra una visita — en días de trabajo móvil, activar "Vehículo"; cuando atienden en sede, activar "Sede"
- Los materiales (pinzas, termómetros, estetoscopios) se registran separados de los productos vendibles y también tienen stock por ubicación

**Para clínicas fijas (usuarios sin vehículo):**
- Sin cambios: ven un solo "Inventario Principal" exactamente igual que antes
- El toggle de ubicaciones no aparece si solo tienen 1 inventario — cero fricción

#### Arquitectura DB

**Nuevas tablas:**
- `inventory_locations`: `id, clinic_id, name, type (warehouse/vehicle), is_active_for_sales, is_default`
- `inventory_stock`: `product_id, location_id, quantity` — el stock por ubicación. UNIQUE `(product_id, location_id)`

**Columnas nuevas:**
- `inventory_movements.location_id` — a qué ubicación corresponde el movimiento (nullable para retrocompatibilidad)
- `inventory_movements.type` — expandido: ahora incluye `transfer_in` y `transfer_out`
- `inventory_products.is_for_sale BOOLEAN DEFAULT true` — distingue productos vendibles de materiales operativos

**Función `transfer_inventory(clinic_id, product_id, from_location_id, to_location_id, quantity, notes)`:**
- Crea dos movimientos atómicos: `transfer_out` en origen + `transfer_in` en destino
- Verifica stock disponible en origen antes de ejecutar — lanza excepción si es insuficiente
- Los traspasos **no modifican** `inventory_products.stock_quantity` (el total no cambia, solo se redistribuye entre ubicaciones)

**Trigger `update_product_stock` actualizado:**
- `transfer_in`/`transfer_out` → solo actualiza `inventory_stock` (por ubicación)
- Todos los demás tipos → actualiza `inventory_products.stock_quantity` (total) + `inventory_stock` (si tiene `location_id`)

**Seed automático (aplicado en producción):**
- Para cada clínica con productos: se creó "Inventario Principal" con `is_default=true, is_active_for_sales=true`
- El stock actual de cada producto se migró a `inventory_stock` como snapshot inicial

#### Archivos clave

| Archivo | Cambio |
|---|---|
| `src/pages/Inventory.tsx` | Selector de ubicaciones, modal traspaso, panel config, toggle Productos/Materiales, card explicativo ABC |
| `src/services/inventoryService.ts` | Métodos: `getLocations`, `createLocation`, `updateLocation`, `setActiveForSales`, `getActiveForSalesLocation`, `getLocationStockMap`, `transferStock`. `getProducts()` ahora filtra `is_for_sale = true` |
| `src/components/appointments/VisitClosureModal.tsx` | Carga `getActiveForSalesLocation` al montar y pasa `location_id` a `closeVisit` |
| `src/types/database.ts` | `is_for_sale` añadido a `inventory_products` Row/Insert/Update |
| `supabase/migrations/20260530000002_inventory_locations.sql` | Migración completa |

#### Reglas permanentes — inventarios múltiples

- **Máximo 2 inventarios** por clínica. El límite se aplica en la UI (botón "Agregar" desaparece con 2 ubicaciones).
- **`inventory_products.stock_quantity`** = stock total (suma de todas las ubicaciones). Para el stock por ubicación usar `inventory_stock` o `inventoryService.getLocationStockMap(locationId)`.
- **Traspasos**: siempre via `inventoryService.transferStock()` o la función DB `transfer_inventory()`. Nunca hacer UPDATE directo en `inventory_stock`.
- **`is_active_for_sales`**: solo una ubicación puede tener este flag `true` a la vez. `setActiveForSales()` resetea todas antes de activar la seleccionada.
- **Materiales (`is_for_sale = false`)**: nunca aparecen en `VisitClosureModal` (filtro en `getProducts()`), ni en análisis ABC ni en métricas de Finance. Sí tienen stock por ubicación y soportan traspasos.
- **Análisis de facturas IA** (`bulkReceiveProducts`): acepta `locationId` opcional. Los productos creados/actualizados desde facturas se asignan a la ubicación indicada.
- **`getProducts(clinicId)`** = solo productos vendibles (`is_for_sale = true`, `is_active = true`). Usar `getAllProducts(clinicId)` para ver todo (incluyendo materiales y archivados).

#### Card explicativo ABC (Análisis tab)

Añadido en el tab Análisis antes de la tabla ABC. Explica en lenguaje de negocio (no técnico) qué significa cada clase:
- **A** (emerald): 80% de ingresos, ~20% del catálogo → siempre en el vehículo, nunca deben faltar
- **B** (amber): 15% → llevar según agenda del día
- **C** (red): 5% → guardar en sede, llevar solo si hay cita que lo requiera
- Tip al pie: cómo usar la clasificación para decidir qué cargar en el vehículo cada día

---

## Cambios realizados — mayo 2026 (sesión 33, 2026-05-31)

### Sistema de lead magnets — implementación completa

#### Arquitectura

**`public/lm-popup.js`** — sistema de exit intent global:
- Se incluye vía `<script src="/lm-popup.js" defer></script>` en los 18 artículos del blog y en `landing.html`
- Integrado via Python script (no modifica el código React)
- No se muestra en `/demo`, `/recursos/`, `/r/`, `/p/`
- Solo se muestra **una vez por sesión** (`sessionStorage.lm_shown`)
- Espera **20 segundos** en la página antes de activarse
- **Desktop:** exit intent — detección de `mouseleave` con `clientY <= 5`
- **Mobile:** timeout de 40 segundos (no hay exit intent en touch)
- Selecciona el lead magnet según el slug del artículo (`MAP` object) — fallback aleatorio si no hay match
- Landing principal → siempre muestra el Diagnóstico

**Mapeo de relevancia artículo → lead magnet:**
| Lead Magnet | Artículos donde aparece |
|---|---|
| 🧮 Calculadora de horas | whatsapp-clinica, recepcionista-virtual, agente-ia, burnout, conseguir-clientes |
| 📋 Script anti no-shows | recordatorios, metricas-rentabilidad, agenda-veterinaria, cobros |
| 🗺️ Plantilla ruta móvil | movil, inventario, ruta-clinica |
| 🔍 Diagnóstico WhatsApp | Landing + software-gestion, gestionar-dos, fidelizacion, precios-clinica |

#### 4 recursos en `public/recursos/`

| Archivo | Descripción |
|---|---|
| `calculadora.html` | 5 sliders interactivos → calcula horas perdidas/mes en WhatsApp en tiempo real. Slider de consultas de precio: máx 200. |
| `script-no-shows.html` | Protocolo de 3 mensajes con botón "Copiar" por cada uno. Stats de referencia. Nota de Lía al pie. |
| `ruta-movil.html` | Día "Ejemplo" fijo con buffers. Lunes–Sábado con `<input type="time">` + `<input type="text">` editables. Botones Agregar/Eliminar cita. Botón Imprimir/PDF (`window.print()`). Botón Limpiar todo. Checklist del van con "Desmarcar todo". |
| `diagnostico.html` | Quiz de 7 preguntas. Resultado con nivel (Controlado/En riesgo/Crítico), puntaje %, y 3 acciones personalizadas. **Guarda en Supabase** al terminar + marca `wa_clicked=true` al hacer clic en el CTA. |

**Regla permanente:** los recursos son páginas HTML estáticas en `public/recursos/`. No son rutas de React. No tienen auth. Tienen `<meta name="robots" content="noindex">`.

#### Tabla `diagnostic_leads` (Supabase)

```sql
CREATE TABLE diagnostic_leads (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    score       INTEGER NOT NULL,      -- 0-21 raw
    score_pct   INTEGER NOT NULL,      -- 0-100 porcentaje
    level       TEXT NOT NULL,         -- 'controlado' | 'en_riesgo' | 'critico'
    answers     JSONB NOT NULL,        -- array de 7 respuestas [0,2,1,3,0,1,2]
    wa_clicked  BOOLEAN DEFAULT false,
    source_url  TEXT,
    referrer    TEXT
);
```

**RLS:**
- `anon INSERT` — permite captura pública sin auth
- `anon UPDATE` — solo permite `wa_clicked = true` (no puede cambiar otros campos)
- `authenticated SELECT` — cualquier usuario autenticado puede leer (para el dashboard HQ)
- `service_role ALL` — acceso total

**Flujo de captura en `diagnostico.html`:**
1. Al terminar la pregunta 7 → `saveLead()` hace POST al endpoint REST de Supabase con anon key (fire-and-forget, sin bloquear UI)
2. Guarda `leadId` del registro creado en variable JS
3. Al hacer clic en el CTA de WhatsApp → `markWaClicked()` hace PATCH con `wa_clicked: true`
4. El mensaje de WhatsApp lleva el nivel y porcentaje pre-escrito para que Andrés llegue con contexto

**Prompt de Andrés actualizado (en DB, sin deploy):** sección `LEAD MAGNETS — RECURSOS GRATUITOS` añadida al `hq_sales_agent_prompt`. Para cada recurso: cómo detectar el mensaje, qué link entregar, y qué pregunta de cierre hacer. Regla: primero entregar el recurso, luego una sola pregunta de seguimiento.

#### Vista de leads en `AdminDashboard.tsx`

Sección añadida debajo de "Validación y Activación":
- **5 stats chips:** Total leads · 🚨 Crítico · ⚠️ En riesgo · ✅ Controlado · % WA clicked
- **Tabla** (últimos 100): fecha/hora · badge de nivel coloreado · barra de progreso con % · ✓ WA clicked · fuente (helper `sourceLabel()` convierte la URL a nombre legible)
- Botón refresh manual
- Fetch via `supabase.from('diagnostic_leads')` — usa la policy `authenticated_select`

---

## Cambios realizados — mayo 2026 (sesión 33, 2026-05-31)

### Fidelización — símbolo de acumulación dinámico por modo del programa

**Problema:** en Ajustes → "Reglas de Ganancia", el campo "Cashback / Acumulación" mostraba siempre `%` como sufijo aunque el modo del programa fuera "Dinero (Cashback)".

**Fix (`src/pages/Loyalty.tsx`):**
- Label ahora muestra `Cashback / Acumulación ($)` cuando `loyalty_program_mode === 'money'`, o `(%)` en los demás modos
- Descripción adapta su texto según el modo: "Dinero que el cliente acumula…" vs "Porcentaje del valor de la cita…"
- Sufijo del input cambia a `loyalty_currency_symbol` en modo money, y a `%` en los demás
- El cambio es reactivo: al hacer clic en un modo diferente el campo se actualiza de inmediato sin guardar

### Auditoría recordatorios Animalgrace Linares/Talca

**Síntoma:** últimos 6 recordatorios fallidos. Diagnóstico vía `reminder_logs`.

**Causa raíz:** `BALANCE_INSUFFICIENT` en la cuenta de YCloud de Linares/Talca. El saldo se agotó el 28 de mayo a las 13:00 UTC, interrumpiendo los recordatorios de Lulu, Jim, Simón y Tadeo. Los envíos previos (Abril, Zuki) funcionaron correctamente.

**Resolución:** **no es un bug de código** — Claudia debe recargar el saldo de YCloud de la cuenta de Linares/Talca. Los 6 registros `failed` son de citas ya pasadas y no se reenviarán (idempotencia del cron). Los próximos recordatorios funcionan desde que haya saldo.

### Adaptación mobile completa — 4 banners de sección

**Problema:** los banners de Recordatorios, Ajustes IA, Finanzas e Inventario usaban `flex items-start justify-between` sin breakpoint responsive. En mobile (≈298px), los botones de acción comprimían el título hasta fragmentarlo en 3–4 líneas.

**Patrón de fix aplicado:**

| Antes | Después |
|---|---|
| `flex items-start justify-between gap-4` | `flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4` |
| Ícono decorativo siempre visible | `hidden sm:flex` — oculto en mobile |
| Padding `p-6 sm:p-8` | `p-5 sm:p-8` |
| `text-2xl sm:text-3xl` | `text-xl sm:text-3xl` |
| Texto descripción `text-sm` | `text-xs sm:text-sm` |

**Por página:**
- **Recordatorios** (`Reminders.tsx`): título arriba, botón "Guardar" compacto debajo; ícono reloj oculto en mobile
- **Ajustes IA** (`AISettings.tsx`): título arriba, botón "Guardar" compacto debajo; ícono sliders oculto en mobile
- **Finanzas** (`Finance.tsx`): título arriba, 3 botones (Exportar/Gasto/Ingreso) en fila compacta debajo; ícono dólar oculto en mobile; padding de botones reducido a `px-3 py-2`
- **Inventario** (`Inventory.tsx`): título + botón "Factura IA" (abreviado en mobile) en fila superior; 4 stats pasan de fila horizontal desbordante a **grid 2×2** con fondo `white/10` redondeado en mobile

### Fix SQL Finance — `column reference "clinic_id" is ambiguous`

**Síntoma:** la página de Finanzas no cargaba ingresos manuales — error 400 en `get_clinic_incomes_secure`.

**Causa raíz:** la función `get_clinic_incomes_secure` declara un `RETURNS TABLE(..., clinic_id uuid, ...)`. El chequeo de acceso interno usaba `WHERE ... AND clinic_id = p_clinic_id` sobre `clinic_members`, pero PostgreSQL lo consideraba ambiguo entre `clinic_members.clinic_id` y la columna de retorno de la función.

**Fix (migración `fix_get_clinic_incomes_secure_ambiguous_clinic_id`):**
```sql
-- Antes (ambiguo):
WHERE user_id = auth.uid() AND clinic_id = p_clinic_id AND status = 'active'

-- Después (explícito con alias cm):
FROM public.clinic_members cm
WHERE cm.user_id = auth.uid() AND cm.clinic_id = p_clinic_id AND cm.status = 'active'
```

---

## Marketing y ventas — estado al 2026-05-31

> El detalle completo de estrategia, posts y plan de acción vive en `.agents/product-marketing.md`. Este CLAUDE.md registra solo los cambios técnicos del sitio relacionados con marketing.

### Cambios técnicos de marketing (sesión 33)
- `public/lm-popup.js` — sistema de exit intent con 4 lead magnets según artículo
- `public/recursos/` — 4 recursos interactivos: calculadora, script no-shows, ruta móvil, diagnóstico
- `public/recursos/index.html` — página índice de recursos con navbar propio
- Navbar landing + 18 artículos del blog: enlace "Recursos" añadido
- `vercel.json` — rutas explícitas para `/recursos/*` (evitaba caer en React SPA)
- `src/App.tsx` — `Route path="/"` cambiada de `<Landing />` a `<Navigate to="/login">` — landing antigua de React eliminada del router
- `diagnostic_leads` — tabla Supabase para capturar resultados del diagnóstico
- `AdminDashboard.tsx` — sección "Leads del Diagnóstico" con stats y tabla

### LinkedIn (2026-05-31)
- Perfil de Sebastián Barrera actualizado: banner, headline, Acerca de, experiencia
- Banner: imagen 4:1 generada con ChatGPT usando `public/dashboard2.png` + logo Vetly
- **Post 1 publicado** — historia del fundador ("Soy administrador de empresas. No veterinario.")
- Post 2, 3 y 4 escritos y listos (cadencia: martes y jueves, 8:30am Chile)

### Próximos pasos de marketing
1. Post 2 LinkedIn — jueves (el del dato que duele)
2. Outreach directo a 20 veterinarios por WhatsApp (Sebastián)
3. Primer post en Colmevet Chile (Facebook) — artículo de valor, sin venta
4. Confirmar con Claudia uso de foto/nombre en LinkedIn → Post 3
5. Crear cuenta TikTok/Instagram @vetly.pro
6. Product Hunt — cuando haya 3–5 clientes pagos

---

## Prospección digital de clínicas — implementado 2026-05-31

### Informe de prospección

**Archivo:** `prospeccion-veterinarias-chile.html` en la raíz del proyecto. Abre directamente en el browser.

**Contenido:** 15 clínicas veterinarias reales de Chile analizadas con datos de contacto verificados, score de oportunidad (0-100), 5 fichas detalladas con mensajes de WhatsApp listos para enviar, exportación CSV/JSON, y plan de acción semana a semana.

**Hallazgo clave:** el 100% de las clínicas usa WhatsApp manual. Ninguna tiene IA. Score promedio del lote: 82/100.

### 15 prospectos en HQ CRM

Todos los prospectos están insertados en `crm_prospects` con `clinic_id = HQ_ID` y `source = 'Prospección Digital'`. Se gestionan desde `/hq/crm`.

**Top 5 por score:**
| Score | Nombre | Ciudad | Tipo |
|-------|--------|--------|------|
| 96 | Belevet – Vet. Domicilio Temuco | Temuco | Móvil individual |
| 95 | Dra. Aurora Shen | Santiago | Móvil individual |
| 93 | Dra. Fernanda Sasso | Rancagua | Móvil individual |
| 92 | Vetsana | Santiago | Móvil individual |
| 88 | CatDog Veterinaria a Domicilio | Santiago | Móvil equipo |

### Integración HQ — cambios técnicos

**DB (migración `add_website_and_type_to_crm_prospects`):**
- `crm_prospects.website TEXT` — URL del sitio web del prospecto
- `crm_prospects.prospect_type TEXT` — tipo de clínica ("Móvil Individual", "Móvil Equipo", "Física Pequeña", "Física Mediana", "Especialista")

**`AdminDashboard.tsx`:** sección "Pipeline de Ventas — Prospección Digital" añadida debajo de los Leads del Diagnóstico:
- 4 stats chips: Total / Sin contactar / En diálogo / Convertidos
- Lista top 6 prospectos por score con badge de color (rojo ≥90, ámbar ≥80, verde <80), stage actual, botón WA directo
- Link "Ver CRM completo" → `/hq/crm`

**Regla permanente:** los prospectos de prospección se identifican por `source = 'Prospección Digital'`. No cambiar este valor — el `fetchProspects` en AdminDashboard lo usa para filtrar.

### Hook de Movilvets en outreach

Los mensajes de WhatsApp del informe incluyen la historia del fundador donde tiene mayor impacto (clínicas móviles/domicilio):
> *"Antes de fundar Vetly, operé Movilvets, una clínica móvil. Ese problema lo viví en carne propia..."*

Este hook diferencia el outreach de cualquier otro vendedor de SaaS. Úsarlo siempre al contactar prospectos de tipo móvil/domicilio.

---

## Cambios realizados — junio 2026 (sesión 34, 2026-06-02)

### Finance — ítem libre en "Registrar Nuevo Ingreso"

**Motivación:** el formulario solo permitía agregar servicios del catálogo (`clinic_services`) o productos del inventario. Para servicios esporádicos o cobros puntuales sin configurar, no había forma de ingresar un ítem libre.

**Cambio en `src/components/finance/NewIncomeForm.tsx`:**
- Nueva sección **"Ítem libre (servicio esporádico)"** entre "Productos del Inventario" y "Descripción"
- Dos inputs en línea: nombre (texto libre) + monto (número)
- Botón `+` en amber — se activa solo cuando ambos campos tienen valor válido
- Soporta Enter desde cualquiera de los dos inputs para agregar rápido
- Lista de ítems agregados con fondo `amber-50` (diferenciado: servicios en teal, productos en violet, libres en amber)
- Cada ítem libre suma al subtotal automáticamente junto con los demás
- Al guardar, se incluyen en el array `services` con `type: 'custom'` para trazabilidad
- La descripción del ingreso se auto-completa incluyendo el nombre del ítem libre

**Estado `customItems`:** `Array<{ name: string; price: number }>`. El subtotal es `customSubtotal = customItems.reduce(...)`. El flag `hasItems` ahora incluye `customItems.length > 0`.

### Finance — fix badge "Por Cobrar"

**Problema:** la tarjeta "Por Cobrar" mostraba un badge "5 Citas" que usaba `stats?.appointments_count` — el conteo de citas **pagadas/parciales** (calculado en `get_finance_stats`), no de pendientes. Era una métrica incorrecta para ese contexto.

**Fix en `src/pages/Finance.tsx`:**
```tsx
// Antes (conteo de citas pagadas — incorrecto):
{stats?.appointments_count || 0} Citas

// Después (conteo real de pendientes del período — correcto):
{transactions.filter(tx => tx.payment_status === 'pending').length} Pendientes
```
Se deriva del array `transactions` ya cargado, sin query adicional.

### Comportamiento confirmado — transacciones sin precio no aparecen

**Diagnóstico:** `get_clinic_transactions_secure` filtra `status != 'cancelled' AND price > 0`. Las citas agendadas hoy con `price = NULL` o `price = 0` (antes de cerrar la visita) no aparecen en la lista de transacciones.

**Decisión:** mantener este comportamiento. La lista de Finance muestra solo transacciones con monto real asignado. Las citas sin precio aparecen cuando se cierra la visita desde el modal de Finance y se registra el cobro.

---

## Cambios realizados — junio 2026 (sesión 35, 2026-06-03)

### Bug crítico: Settings no cargaba ningún dato — `src/pages/Settings.tsx`

**Síntoma:** la página de Configuración mostraba siempre campos vacíos y "Físico" seleccionado aunque la DB tuviera datos correctos (`business_model = 'mobile'`, servicios, nombre de clínica). Si el usuario hacía clic en "Guardar Cambios" en ese estado, sobreescribía la DB con valores vacíos/por defecto — que es lo que le ocurrió a Animalgrace.

**Causa raíz:** el helper `safe()` dentro de `fetchSettings` hacía `p.catch(...)`, pero los query builders de Supabase son **thenables** (implementan `.then()`) pero **no Promises nativas** (no tienen `.catch()`). La primera query lanzaba `TypeError: c.catch is not a function`, rompía todo el `Promise.all`, el form quedaba en defaults, y el error se tragaba silenciosamente en el `try/catch` externo.

**Fix:**
```typescript
// ANTES (roto — Supabase builders no tienen .catch()):
const safe = (p: Promise<any>) => p.catch(() => ({ data: null, error: null }))

// DESPUÉS (correcto — Promise.resolve normaliza cualquier thenable):
const safe = (p: any) => Promise.resolve(p).then((r: any) => r, () => ({ data: null, error: null }))
```

**Regla permanente:** nunca llamar `.catch()` directamente sobre un query builder de Supabase. Siempre usar `Promise.resolve(query).then(ok, err)` o `await query` dentro de un try/catch.

### Race condition en Settings — botón "Guardar Cambios" prematuro

**Problema adicional:** incluso con el fetch funcionando, si el usuario hacía clic en "Guardar Cambios" durante los ~200-500ms que tarda el fetch en completarse, el form guardaba defaults vacíos.

**Fix en `src/pages/Settings.tsx`:** nuevo estado `loadingSettings` (boolean):
- Se activa con `setLoadingSettings(true)` al inicio de `fetchSettings`
- Se desactiva en el bloque `finally`
- El botón "Guardar Cambios" queda `disabled={savingClinic || loadingSettings}` y muestra "Cargando..." mientras el fetch está en vuelo

### AuthContext — desajuste de `member` en cuentas multi-sucursal

**Bug en `src/contexts/AuthContext.tsx`:** en el handler de `onAuthStateChange`, al cambiar de clínica activa, `member` y `subscription` se cargaban usando `data.clinic_id` (el valor crudo de `user_profiles` en DB) en vez de `resolvedClinicId` (que ya incorpora la clínica guardada en `localStorage`). Esto causaba que el `member` no correspondiera a la clínica activa en pantalla.

**Fix:** reemplazado `data.clinic_id` por `resolvedClinicId` en las queries de `clinic_members` y `fetchSubscription` dentro del bloque `onAuthStateChange`.

### DashboardLayout — error 400 por columna inexistente

**Bug en `src/components/layout/DashboardLayout.tsx:165`:** la query de chequeo de trial pedía `subscriptions.trial_ends_at`, columna que **no existe** en la tabla (confirmado en logs de Postgres). Generaba error 400 repetido en cada carga del dashboard.

**Fix:**
- `select('status, trial_ends_at')` → `select('status, current_period_end, manually_active')`
- La lógica de expiración ahora usa `current_period_end`
- **Crítico:** se agregó `&& !subData.manually_active` a la condición de redirect — sin esto, Animalgrace (que tiene `manually_active = true` y `current_period_end` en el pasado) habría sido redirigida en loop a la pantalla de suscripción expirada

### Restauración de datos — DB producción

**Datos recuperados directamente en la DB:**
- `clinic_settings.clinic_name` de Linares/Talca: restaurado a `"AnimalGrace Linares/Talca"` (se había vaciado al guardar el form con el bug activo)
- Los 21 servicios de Linares y 37 de Santiago **nunca se perdieron** — estaban intactos en `clinic_services`; simplemente no aparecían en la UI por el bug del fetch
- `clinic_settings.instagram_url`, `facebook_url`, `contact_phone`, `clinic_address`: estos sí se vaciaron y **no se recuperaron** (no hay backup accesible sin restaurar toda la DB). Claudia debe reingresar esos campos desde Configuración

### Citas Médicas — orden y filtros

**Cambios en `src/pages/Appointments.tsx`:**
- **Orden corregido:** `ascending: false` → `ascending: true` — las citas más próximas aparecen arriba, las más futuras abajo (era al revés)
- **Botón "Filtros" eliminado:** el panel de radios de ordenamiento no estaba conectado a ninguna lógica de estado — era UI muerta. Eliminado junto con el import de `Filter` (lucide) y el estado `showFilters`
- **"Este Mes" agregado:** nueva opción en el filtro de Fecha. Tipo `dateFilter` expandido a `'all' | 'today' | 'tomorrow' | 'week' | 'month'`. Lógica: `appointmentDate >= monthStart && appointmentDate <= monthEnd` (mes calendario actual)

---

## Cambios realizados — junio 2026 (sesión 36, 2026-06-04)

### Routing vacunación a GPT-4o — `ycloud-whatsapp-webhook`

**Problema:** preguntas sobre vacunas (ej: "¿se puede poner Óctuple + Antirrábica en la misma visita?") caían a GPT-4o-mini en modo híbrido. Mini simplificó la regla condicional y respondió con una afirmación absoluta incorrecta.

**Fix 1 — `selectModelTier` `needsMedicalReason`:** keywords de vacunación añadidas al grupo que fuerza GPT-4o:
```typescript
text.includes("vacun") || text.includes("antirrabi") || text.includes("octuple") ||
text.includes("sextuple") || text.includes("triple felina") || text.includes("puppy") ||
text.includes("kcnasal") || text.includes("leucemia felina")
```

**Fix 2 — `schedulingSignals`:** mismas keywords añadidas al detector de flujo activo. Si la IA mencionó vacunas en respuestas recientes, el siguiente mensaje del usuario también va a GPT-4o.

**Fix 3 — `ai_behavior_rules` Linares y Santiago (DB, efectivo de inmediato):** nueva regla en la sección de vacunación:
> **FLUJO OBLIGATORIO — PREGUNTA SOBRE 2 VACUNAS EN LA MISMA VISITA:** Si el tutor pregunta si se pueden aplicar 2 vacunas juntas (ej: Óctuple + Antirrábica), NUNCA respondas con una regla absoluta. PRIMERO pregunta: "¿Tu mascota ya ha recibido alguna vacuna anteriormente?" Solo DESPUÉS de recibir esa respuesta, aplica la regla correcta.

**Regla clínica correcta** (ya estaba en el KB y ai_behavior_rules, la instrucción de flujo era lo que faltaba):
- Si ya fue vacunada antes → PERMITIDO aplicar 2 en la misma visita (Óctuple + Antirrábica)
- Si es la primera vez → solo UNA vacuna; la segunda en visita posterior

---

### Créditos IA — multiplicadores corregidos a 15x

**Diagnóstico:** había una inconsistencia entre dos sistemas:
- **Webhook (realidad):** descontaba `-8` para todo 4o en `ai_credit_transactions`
- **AISettings display:** calculaba `proMessages × 60` desde la tabla `messages` — sobreestimaba 7.5x

Con el volumen real de Animalgrace (52% mensajes 4o, costo OpenAI ~$0.0165/msg), el multiplicador correcto es **15x** para mantener ~51% de margen vs ~8% con 8x.

**Cambios aplicados:**

| Archivo | Cambio |
|---|---|
| `supabase/functions/ycloud-whatsapp-webhook/index.ts:633` | `creditCost = model === "mini" ? 1 : 8` → `1 : 15` |
| `src/pages/AISettings.tsx:244` | fórmula `standardMessages×8 + proMessages×60` → `(standardMessages + proMessages)×15` |
| `src/pages/Settings.tsx` | N2 Standard (8x) + N3 Sovereign (60x) → un solo N2 GPT-4o (15x) |

**GPT-4o Standard — etiqueta muerta:** `4o_standard` nunca se asigna en el routing actual. El label `modelForTracking` asigna `"4o_pro"` cuando `tierUsed === 3`, que es siempre que se usa GPT-4o (tanto en modo híbrido como pro). Las 372 filas `4o_standard` en `messages` son datos históricos de una versión anterior. La card "Standard" fue eliminada de la UI — solo quedan **Mini (×1)** y **GPT-4o (×15)**.

**Economía con 15x (pack 4.000 créditos, $9 USD):**
- OpenAI costo/msg 4o: ~$0.0165
- Cobro al cliente: 15 × $0.00225 = $0.034
- Margen: ~51%

---

## Cambios realizados — junio 2026 (sesión 37, 2026-06-04)

### Fix definitivo: "No hay citas pendientes" al confirmar — causa raíz real

**Bug persistente desde sesión 22.** El fix v214 (verificar `confirmed` como fallback) no era suficiente porque la causa raíz era distinta.

**Causa raíz real (encontrada con diagnóstico DB directo):**
Claudia guarda citas manualmente desde el dashboard con teléfonos en formato chileno con espacios: `"56 9XXXXXXXX"` (14 chars) o `"+56 9XXXXXXXX"` (15 chars). YCloud envía el `from` de mensajes entrantes como dígitos puros: `"56912345678"` (11 chars). `confirmAppt` usa `.or("phone_number.eq.56912345678,phone_number.eq.+56912345678")` — match exacto de strings. `"56 9XXXXXXXX" ≠ "56912345678"` → nunca encontraba la cita → "No hay citas pendientes."

**Evidencia:** 44 de 123 citas de Linares (36%) tenían `phone_len > 11` con caracteres no numéricos. La cita con phone_len=11 (puro dígitos) sí funcionaba correctamente.

**Fix aplicado:**
1. **Migración DB `normalize_appointment_phone_numbers`**: `REGEXP_REPLACE(phone_number, '[^0-9]', '', 'g')` sobre todas las citas donde `phone_number ~ '[^0-9]'`. Resultado: 44 citas normalizadas, `phones_still_dirty = 0`.
2. **`src/pages/Appointments.tsx` `handleSaveAppointment`**: `const normalizedPhone = (newAppointment.phone_number || '').replace(/\D/g, '')` — aplicado a CREATE y UPDATE. Las nuevas citas siempre guardan dígitos puros.

**No se modificó el webhook** — `confirmAppt` ya estaba correcto; el problema era el dato.

**Regla permanente:** `appointments.phone_number` debe contener SOLO dígitos (sin +, sin espacios). La función `normalizePhone` del webhook asume esto. Cualquier lugar que guarde teléfonos en appointments debe aplicar `.replace(/\D/g, '')` antes de persistir.

---

## Cambios realizados — junio 2026 (sesión 38, 2026-06-04)

### Sistema de Cajas v2 — implementación completa

#### Nuevas funcionalidades

**1. Saldo inicial del día (`opening_balance`)**
- Campo editable en cada caja abierta ("Saldo inicial en caja") con botón Guardar
- Se muestra como stat estático en cajas cerradas
- Almacenado en `cash_registers.opening_balance NUMERIC DEFAULT 0`
- RPC `update_caja_opening_balance(clinic_id, date, amount, user_id)` — solo modifica cajas abiertas; verifica acceso vía `clinic_members`

**2. Gastos desde la caja con boleta adjunta**
- Botón "Gasto" junto a "Ingreso" en cada caja abierta
- `CajaExpenseModal.tsx`: descripción, monto, 4 medios de pago (toggle), categoría, adjunto de boleta
- Boleta: drag-and-drop + `capture="environment"` (abre cámara trasera en mobile), acepta JPG/PNG/WEBP/HEIC/PDF, máx 10 MB
- Las boletas se guardan en bucket privado `expense-receipts` — se almacena el **path** (no URL pública); URL firmada se genera on-demand al ver (TTL 1h)
- Ícono de clip en la lista de gastos → genera signed URL y abre en nueva pestaña
- Columnas nuevas en `expenses`: `payment_method TEXT`, `receipt_url TEXT`
- RPC `create_clinic_expense` actualizado para aceptar los nuevos campos

**3. Apertura automática diaria a las 07:00 Chile**
- pg_cron jobid 18, schedule `0 11 * * *` (11:00 UTC = 07:00 CLT)
- Función `auto_open_daily_cajas()`: UPSERT `status='open'` para todas las clínicas activas, usando fecha en zona horaria `America/Santiago`
- Idempotente: `ON CONFLICT DO NOTHING`
- **Deuda técnica pendiente:** timezone hardcodeado a Chile — ver sección "Tareas pendientes"

**4. Informe detallado descargable (`CajaReport.tsx`)**
- Botón "Informe" visible en TODAS las cajas (abiertas y cerradas)
- Abre ventana imprimible via `window.open()` + `window.print()` (mismo patrón que VisitReceipt)
- Contenido: saldo inicial, cobrado por ítem, gastos, desglose por método, pendientes, resumen (saldo inicial + cobrado − gastos = **saldo final**), notas
- Todos los datos de usuario escapados con `esc()` para prevenir XSS

**5. CloseCajaModal mejorado**
- Muestra saldo inicial + cobrado − gastos = saldo final en card oscura
- Sección de gastos del día (rose)
- Botón "PDF" para descargar informe antes/después de cerrar

#### DB — migración `caja_v2_improvements` + `fix_caja_security`

| Objeto | Cambio |
|---|---|
| `cash_registers.opening_balance` | Columna nueva NUMERIC DEFAULT 0 |
| `cash_registers.total_gastos` | Columna nueva NUMERIC DEFAULT 0 |
| `expenses.payment_method` | Columna nueva TEXT nullable |
| `expenses.receipt_url` | Columna nueva TEXT nullable (almacena path de Storage, no URL) |
| `close_cash_register` | Actualizado: preserva `opening_balance`, calcula `total_gastos`, auth incondicional con `auth.uid()` |
| `open_cash_register` | Nueva RPC con verificación de acceso `auth.uid()` |
| `update_caja_opening_balance` | Nueva RPC para guardar saldo inicial |
| `auto_open_daily_cajas` | Nueva función para pg_cron |
| `create_clinic_expense` | Actualizado: acepta `payment_method` y `receipt_url` |
| RLS `expenses` | Migrada de policy genérica a `clinic_members` (patrón estándar) |
| Storage bucket `expense-receipts` | Creado privado, 10MB, con RLS por `clinic_members` |

#### Archivos frontend

| Archivo | Acción |
|---|---|
| `src/components/finance/CajaExpenseModal.tsx` | Nuevo — modal de gastos con upload de boleta |
| `src/components/finance/CajaReport.tsx` | Nuevo — informe imprimible con `esc()` anti-XSS |
| `src/components/finance/CajaDelDia.tsx` | Modificado — opening balance, gastos, botones Gasto/Informe |
| `src/pages/Finance.tsx` | Modificado — orquestación completa, signed URL para boletas |
| `src/services/financeService.ts` | Modificado — nuevos métodos, tenant filter en deleteExpense |

#### Fix timezone de cajas

`new Date().toISOString()` retorna UTC. En Chile (UTC-4), después de las 8pm muestra el día siguiente. Corregido usando `toLocaleDateString('sv-SE', { timeZone: timezone })` donde `timezone` viene de `clinic_settings.timezone` via `useClinicTimezone`. Aplicado en `Finance.tsx` (`todayStr`) y en `CajaDelDia.tsx` (`isToday`). El `'America/Santiago'` es fallback, no valor fijo.

#### Seguridad — hallazgos y fixes (revisión de seguridad sesión 38)

| Severidad | Hallazgo | Fix |
|---|---|---|
| ALTO | `open_cash_register` sin verificación de acceso | `auth.uid()` check vía `clinic_members` |
| ALTO | `close_cash_register` bypasseaba auth cuando `p_closed_by = NULL` | Verificación incondicional con `auth.uid()` |
| MEDIO | XSS en informe HTML — datos de usuario sin escapar | Función `esc()` en todas las interpolaciones |
| MEDIO | `getPublicUrl` en bucket privado — URL no funciona con bucket privado | Cambiado a path + `createSignedUrl` on-demand |
| MEDIO | RLS de `expenses` con policy genérica | Migrada a `clinic_members` |
| MEDIO | `deleteExpense` sin filtro de `clinic_id` | `.eq('clinic_id', clinicId)` agregado |
| BAJO | MIME type no validado en drag-and-drop | Validación explícita de `ACCEPTED_MIME` |
| BAJO | Extensión derivada del nombre del archivo | Derivada del `file.type` via `MIME_TO_EXT` |

---

## Cambios realizados — junio 2026 (sesión 39, 2026-06-05)

### Fixes post-cajas v2

#### Fecha de caja en zona horaria correcta
`new Date().toISOString()` retorna UTC — en Chile (UTC-4) después de las 8pm mostraba el día siguiente. Reemplazado por `toLocaleDateString('sv-SE', { timeZone: timezone })` donde `timezone` viene de `clinic_settings.timezone` via `useClinicTimezone`. Aplicado en `Finance.tsx` (`todayLocalStr`) y en `CajaDelDia.tsx` (`localToday`). El `'America/Santiago'` es fallback, no valor fijo — se adapta automáticamente a clínicas de otros países cuando tengan `timezone` configurado.

#### Nombre real de la sucursal en informe PDF
`clinicName` en Finance.tsx se obtenía de `member.clinic_name` (siempre undefined — esa columna no existe en `clinic_members`). Corregido: se fetch desde `clinic_settings.clinic_name` en el `loadData()` usando `Promise.resolve(query).then(ok, err)` — nunca `.catch()` directo sobre query builders de Supabase (regla de sesión 35).

#### Bug crítico: Finance mostraba $0.00 en todos los KPIs
**Causa raíz:** se usó `.catch(() => null)` directo sobre un query builder de Supabase (violación de la regla de sesión 35). El thenable lanzaba `TypeError`, reventando todo el `Promise.all` → stats, transactions, incomes y expenses sin setear → $0 en todo. Fix: `Promise.resolve(query).then(ok, err)`.

**Regla permanente (refuerzo):** nunca llamar `.catch()` directamente sobre un query builder de Supabase. Usar siempre `Promise.resolve(query).then(ok, err)` o `await query` dentro de try/catch.

#### Estilo saldo inicial — revertido a colores originales
El usuario rechazó los colores amber. El saldo inicial volvió al fondo `ivory/60` con borde `silk-beige` original. El texto del monto y el placeholder ahora son `text-charcoal` (negro) en vez del gris apagado previo.

### Modal de Exportación (`ExportModal.tsx`)

**Motivación:** el dropdown de exportación solo ofrecía CSV/JSON sin control de fechas. El usuario quería poder filtrar el reporte por cualquier período antes de descargar.

**Implementación (`src/components/finance/ExportModal.tsx`):**
- Abre desde el botón "Exportar" en el banner de Finanzas
- **Selector de período propio** (independiente del filtro de la vista): Hoy / Semana / Este mes / Este año + rango personalizado con mini calendario
- **Preview en tiempo real**: al cambiar el período, hace fetch de `get_finance_stats` y muestra ingresos, gastos, ganancia neta y por cobrar antes de descargar
- **Formato**: CSV (con BOM UTF-8 para compatibilidad Excel) o JSON
- **Fetch independiente al descargar**: obtiene transactions + expenses + incomes para el período seleccionado, no usa los datos del filtro de la vista
- CSV incluye columna de método de pago en gastos e ingresos manuales

**Fix de calendario recortado:** el selector de período se movió **fuera** del `div overflow-y-auto` del modal a su propia sección con `shrink-0`. El dropdown del calendario usa `z-[60]` para superar el `z-50` del overlay. Patrón permanente: cualquier dropdown que abra dentro de un modal debe estar en una sección fuera del overflow scrolleable, o usar un portal.

**Limpieza:** eliminados `handleExport`, `showExportMenu`, `exportMenuRef`, el useEffect de click-outside del menú, y constantes `CATEGORY_LABELS_INCOME`, `STATUS_LABELS` que solo usaba `handleExport`.

### Patrón de dropdowns dentro de modales (regla permanente)

Un `position: absolute` dentro de un contenedor con `overflow-y-auto` queda recortado por el overflow. Opciones:
1. **Mover el trigger fuera del overflow** (solución aplicada aquí — más simple)
2. Usar un portal React (`createPortal`) para renderizar el dropdown en el body
3. `overflow: visible` + scroll manual (frágil, no recomendado)

Preferir opción 1 cuando la sección con el dropdown puede estar en un área fija (header, sección separada). Preferir opción 2 (portal) cuando el trigger debe estar dentro del scroll.

---

## Cambios realizados — junio 2026 (sesión 40, 2026-06-06)

### Bug 1 — Horario mínimo Talca corregido a 11:30 AM

**Síntoma:** el agente ofrecía slots a las 10:00 AM y 10:30 AM para clientes del sector Talca. El KB decía 11:00 AM pero el código no lo enforcement.

**Causa raíz:** la restricción existía solo en texto del KB (`PROTOCOLO_LOGISTICA_SERVICIOS_GENERALES`). `checkAvail` devolvía todos los slots disponibles sin filtro por sector; el AI presentaba los slots tal como los recibía.

**Fixes aplicados:**
- **KB `PROTOCOLO_LOGISTICA_SERVICIOS_GENERALES` (DB, efectivo de inmediato):** "antes de las 11:00 hrs" → "antes de las **11:30 hrs**" en la restricción absoluta + tabla de Bloques de Referencia del Día.
- **Código `checkAvail` (`ycloud-whatsapp-webhook` v220):** filtro en código puro justo después de calcular `targetSectorAG` (línea ~1287):

```typescript
// AnimalGrace: sector Talca no puede atenderse antes de las 11:30 AM.
if (targetSectorAG === "Talca") {
  filteredSlots = filteredSlots.filter((s: any) => {
    const [h, m] = s.slot_time.split(":").map(Number);
    return h * 60 + m >= 11 * 60 + 30;
  });
}
```

Este filtro aplica a **todos los días** (no solo mismo día) y es inviolable: incluso si el AI ignora el KB, el sistema nunca devuelve slots Talca antes de las 11:30.

**Posición del filtro:** dentro del bloque `if (isMobile && tutorCoords && filteredSlots.length > 0)`, después de la definición de `getSectorAG` (línea 1233) y después de computar `targetSectorAG` (línea 1286). No aplica cuando el cliente no comparte GPS pin.

---

### Bug 2 — Precio esterilización gata cotizado en $80.000 (correcto: $65.000)

**Síntoma:** el agente cotizó $80.000 por esterilización de gata en Talca. El valor correcto es $65.000 (felino hembra T1).

**Causa raíz — confusión de tabla de precios:**
- Los hubs quirúrgicos **sí estaban correctamente configurados** en `logistics_config`:
  - `surgical-norte` (Talca): `-35.4232, -71.6734`
  - `surgical-sur` (Yerbas Buenas): `-35.85, -71.58`
- El código calcula el hub más cercano e inyecta en contexto: `[LOGÍSTICA: Pabellón más cercano: Hub Quirúrgico Norte (Talca) a 17 min]` → T1 ($0 recargo)
- El AI computó T1 correctamente, pero al buscar en la MATRIZ aplicó la fila **Caninos Hembras 1-5 kg T1 = $80.000** en vez de **Felinos Hembras T1 = $65.000**
- $80.000 es exactamente el precio de perra pequeña T1 — confusión de especie en el lookup de la MATRIZ

**Fixes aplicados:**

- **KB `MATRIZ_PRECIOS_Y_PROTOCOLO_CIRUGIAS` (DB):** bloque de advertencia añadido al inicio de la sección FELINOS:
  > ⚠️ **ANTI-CONFUSIÓN CRÍTICA:** Para gatos y gatas usa EXCLUSIVAMENTE esta tabla FELINOS. NUNCA uses precios de la tabla Caninos para felinos. GATA hembra T1 = $65.000 (NO $80.000). GATO macho T1 = $60.000 (NO $70.000).

- **KB `MATRIZ_PRECIOS_Y_PROTOCOLO_CIRUGIAS` (DB):** precio gato macho T1 corregido: $58.000 → **$60.000** (T2 y T3 sin cambio: $66.000 y $74.000)

- **`ai_behavior_rules` Linares (DB, efectivo de inmediato):** regla añadida al inicio de la sección 7 (CIRUGÍAS MUNDO B):
  > ⚠️ ANTI-CONFUSIÓN DE ESPECIE (ABSOLUTO): Al cotizar una CIRUGÍA FELINA (gato o gata), usa SIEMPRE la tabla FELINOS del `#MATRIZ_PRECIOS_Y_PROTOCOLO_CIRUGIAS`. NUNCA uses precios de caninos para felinos. GATA hembra T1 = $65.000 (NO $80.000). GATO macho T1 = $60.000 (NO $70.000).

**Precios felinos actualizados (Linares/Talca):**
| Especie | T1 | T2 | T3 |
|---|---|---|---|
| Felino Hembra (gata) | $65.000 | $73.000 | $81.000 |
| Felino Macho (gato) | **$60.000** | $66.000 | $74.000 |

**Regla permanente:** los hubs quirúrgicos de Animalgrace están en `logistics_config.locations` con `type: 'surgical_hub'`. El código los usa para calcular el hub más cercano y loguear el tramo. Si se agrega un nuevo centro quirúrgico, agregar un nuevo objeto con `type: 'surgical_hub'` en `logistics_config` vía SQL — sin deploy.

---

### Permiso `finance_metrics` — tarjetas de resumen financiero

**Motivación:** Claudia quiere poder dar acceso a la página de Finanzas a un miembro del equipo sin que vea los montos globales (Ingresos, Gastos, Ganancia Neta, Por Cobrar).

**Implementación:**

- **`src/lib/permissions.ts`:** nuevo `ActionKey 'finance_metrics'` en el union type, en `ALL_ACTIONS` (true) y en los 3 roles no-admin (professional/receptionist/vet_assistant = false).
- **`src/pages/settings/Team.tsx`:** nuevo grupo **"Finanzas"** en `ACTION_SECTIONS` con el toggle `finance_metrics`. El label de `dashboard_metrics` fue renombrado a "Ver métricas resumen del Dashboard" para evitar duplicados.
- **`src/pages/Finance.tsx`:** importa `usePermissions`, usa `can('finance_metrics')` para mostrar/ocultar los montos en las 4 tarjetas KPI. Cuando está bloqueado: texto *"No disponible"* en gris itálico. El badge de "N Pendientes" en la tarjeta Por Cobrar también se oculta.

**Comportamiento:**
- Owner y Admin: siempre ven los montos (`FULL_PERMISSIONS`)
- Otros roles: oculto por defecto, habilitables individualmente desde Settings → Equipo → Permisos

---

## Cambios realizados — junio 2026 (sesión 41, 2026-06-08)

### Bug: error al completar cita — `loyalty_transactions_type_check`

**Síntoma:** al marcar una cita como completada desde Citas Médicas, aparecía "new row for relation loyalty_transactions violates check constraint loyalty_transactions_type_check".

**Causa raíz:** el trigger `auto_create_tutor_and_patient_on_complete` inserta en `loyalty_transactions` con tipos `'welcome_bonus'` y `'referral_reward'`, pero el check constraint original solo admitía `'earn'`, `'redeem'`, `'adjustment'`, `'referral_bonus'`. Los dos tipos del trigger nunca fueron añadidos al constraint cuando se implementó el sistema de referidos (sesión 27).

**Fix — migración `fix_loyalty_transactions_type_check`:**
```sql
ALTER TABLE loyalty_transactions DROP CONSTRAINT loyalty_transactions_type_check;
ALTER TABLE loyalty_transactions ADD CONSTRAINT loyalty_transactions_type_check
    CHECK (type = ANY (ARRAY['earn','redeem','adjustment','referral_bonus','welcome_bonus','referral_reward']));
```

---

### Auditoría de seguridad completa — 9 vulnerabilidades corregidas (commit `5d5f5aa`)

#### CRÍTICO

**1. `mercadopago-webhook` — HMAC-SHA256 implementado**
`createHmac` y `MERCADOPAGO_WEBHOOK_SECRET` ya estaban importados/definidos pero nunca se usaban. Cualquiera podía forjar un POST y activar suscripciones / añadir créditos sin pagar.
- Nueva función `verifyMercadoPagoSignature(signatureHeader, requestId, dataId)`:
  - Header: `x-signature: ts=<timestamp>,v1=<hex>`
  - Payload firmado: `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
  - Algoritmo: HMAC-SHA256, digest hexadecimal
- Se llama antes de cualquier lógica de negocio → 401 si falla

**2. `analyze-invoice` — JWT obligatorio**
El bloque `if (jwt)` hacía la verificación solo si había JWT presente. Sin header `Authorization`, toda la función corría sin auth, consumiendo créditos de cualquier clínica.
- Cambio: `if (!jwt) → return 401` antes del bloque de verificación. El bloque interno queda idéntico.

**3. `send-visit-receipt` — Auth JWT + membresía**
No había ninguna autenticación. Cualquiera podía enviar WhatsApp usando las credenciales YCloud de cualquier clínica.
- Agrega JWT check + `clinic_members` verification después de parsear el body.

**4. `send-whatsapp-campaign` — Auth JWT + membresía**
Solo recibía `campaign_id` sin verificar quién lo llamaba. Cualquier usuario podía ejecutar una campaña ajena.
- Agrega JWT check + fetch de `campaign.clinic_id` + `clinic_members` verification.

#### ALTO

**5. RPCs de inventario — check de membresía (migración `fix_inventory_rpcs_add_membership_check`)**
Las 4 RPCs eran `SECURITY DEFINER` sin ningún control de acceso. Cualquier usuario autenticado podía consultar datos de cualquier clínica.
- `get_inventory_abc`, `get_inventory_no_rotation`, `get_finance_item_metrics`: check `clinic_members` por `p_clinic_id` al inicio.
- `get_appointment_items`: lookup del `clinic_id` de la cita → check `clinic_members`.

**6. `VisitReceipt.tsx` — XSS en `handlePrint`**
El método construía HTML con datos de usuario sin escapar (patient_name, tutor_name, item names, discount_reason). `CajaReport.tsx` ya tenía `esc()` — `VisitReceipt.tsx` no.
- Agregada función `esc()` idéntica a CajaReport y aplicada a todos los campos interpolados.

#### MEDIO

**7. `lemonsqueezy-webhook` — falla cerrado sin secret**
`verifySignature` tenía `return !LEMONSQUEEZY_WEBHOOK_SECRET` — si la variable se borraba del entorno, aceptaba cualquier request sin firma.
- Cambiado a `return false` + `console.error` explícito.

**8. `diagnostic_leads` — RPC para `wa_clicked`**
La política RLS `anon UPDATE` no restringía columnas — cualquiera podía modificar `score`, `answers`, `level` además de `wa_clicked`.
- Nueva RPC `mark_diagnostic_wa_clicked(p_id UUID)` con `SECURITY DEFINER` que solo actualiza `wa_clicked = true`.
- `public/recursos/diagnostico.html` actualizado para usar `POST /rpc/mark_diagnostic_wa_clicked` en vez de `PATCH` directo.

**9. `ycloud-whatsapp-webhook` — error 500 genérico**
El catch externo retornaba `{ error: (e as Error).message }` — podía filtrar nombres de tablas o mensajes de API internos.
- Cambiado a `{ error: "Internal server error" }`. El mensaje real queda solo en `debugLog` (DB interna).

#### Reglas permanentes — seguridad

- **Auth en edge functions**: el patrón estándar es JWT check → `auth.getUser()` → check `clinic_members`. Nunca hacer el JWT opcional con `if (jwt)`.
- **RPCs SECURITY DEFINER**: toda RPC que reciba `p_clinic_id` debe tener un check `clinic_members` al inicio. Las que reciban otro ID (appointment_id, etc.) deben hacer lookup del `clinic_id` primero.
- **HTML generado en el browser**: cualquier dato de usuario interpolado en template literals de `window.open` / `win.document.write` debe pasar por `esc()`. Ver `CajaReport.tsx` como referencia.
- **Webhooks de pago**: verificar firma HMAC antes de cualquier acción. Fallar cerrado (`return false`) si falta el secret — nunca fallar abierto.
- **Políticas RLS anon UPDATE**: siempre restringir a una RPC específica que solo actualice la columna permitida.

---

## Cambios realizados — junio 2026 (sesión 42, 2026-06-09)

### Auditoría de inconsistencias del AI agent — Animalgrace Linares

Claudia reportó dos conversaciones con respuestas incorrectas del agente. Diagnóstico completo vía DB (`messages`, `ai_behavior_rules`, `knowledge_base`).

#### Caso 1 — "Triple Felina" cuando se preguntó por séxtuple

**Veredicto: NO fue un error del AI.**

La tabla `messages` confirmó que el mensaje original de Tamara (phone `+56977757470`) era `"Para la vacuna de tiple refuerzo"` (typo de "triple"). El AI recibió ese texto, lo interpretó correctamente como Triple Felina y respondió bien. La captura de pantalla mostraba "sextuple refuerzo (Editado 9:41 p.m.)" — la cliente **editó** su mensaje después de que el AI ya había procesado y respondido el original. WhatsApp permite editar mensajes pero YCloud envía el texto en el momento de recepción; el AI no recibe re-notificaciones de ediciones.

**Nota permanente:** los mensajes con "(Editado)" en WhatsApp son indetectables para el AI — siempre actúa sobre el texto original recibido. Si un cliente reporta una respuesta incorrecta, verificar en `messages` el contenido original antes de asumir un bug del AI.

#### Caso 2 — Aviso de "urgencias" espontáneo

**Veredicto: Error real del AI.** El historial de Tamara en DB mostraba que el 30 de mayo preguntó: `"tendrán atención a domicilio de urgencia para ahora!?"`. El AI cargó ese historial como contexto y, combinado con el mensaje nocturno ("Disculpen la hora"), activó proactivamente el aviso de urgencias del KB — aunque en la conversación de junio no había señal alguna de emergencia. Sobre-aplicación de contexto histórico.

**Fix aplicado (Linares + Santiago, DB, efectivo de inmediato):** nueva regla `PROHIBIDO MENCIONAR "URGENCIAS" SIN CONTEXTO` en `ai_behavior_rules`:
- El aviso de urgencias SOLO se activa si el cliente menciona explícitamente emergencia/urgencia o describe síntomas de riesgo vital (sangrado masivo, asfixia, convulsiones, etc.)
- Escribir de noche, decir "disculpen la hora" o tener historial previo de consultas de urgencia NO activa el aviso
- Para consultas rutinarias (vacunación, control, agendamiento), el aviso debe omitirse completamente

#### Caso 3 — Cobaya atendida como si fuera perro o gato

**Veredicto: Error estructural — vacío en las instrucciones.** No existía ninguna regla que dijera que AnimalGrace solo atiende perros y gatos. La REGLA 1 anti-alucinación cubre servicios inexistentes, pero no especies fuera de cobertura. El AI (GPT-4o en este caso) ofreció consulta a domicilio para una cobaya porque no encontró ninguna restricción explícita.

**Fix aplicado (Linares + Santiago, DB, efectivo de inmediato):** nueva regla `COBERTURA DE ESPECIES` en `ai_behavior_rules`:
- AnimalGrace SOLO atiende PERROS (caninos) y GATOS (felinos)
- Cualquier otra especie (cobayas, conejos, hámsters, tortugas, aves, reptiles, serpientes, etc.) → respuesta estándar de no cobertura + recomendación de especialista en animales exóticos
- No se ofrece ningún servicio ni se agenda cita para otras especies

**Regla permanente — diagnóstico de bugs del AI:**
Antes de concluir que el AI "alucinó" o "se equivocó", siempre verificar en la tabla `messages` el contenido exacto del mensaje inbound (`direction = 'inbound'`). Los mensajes editados de WhatsApp son la causa más común de discrepancias entre lo que el cliente "escribió" (versión editada) y lo que el AI respondió (versión original).

### Simulador IA eliminado del dashboard

El widget `<AIChatWidget variant="simulator" />` fue eliminado de `DashboardLayout.tsx`. El simulador sigue existiendo como edge function (`ai-simulator`) pero ya no hay un botón flotante en el dashboard que lo exponga. Si se quiere reintroducir en el futuro, se puede agregar como una ruta propia o dentro de la página de Settings IA.

### Campo "Hallazgos del Examen Físico" — historial clínico

**`MedicalEventForm.tsx` — tab "Examen Físico":**
- Nuevo textarea "Hallazgos del Examen Físico" añadido después de la grilla de constantes vitales
- Se guarda en `physical_exam.findings` (campo dentro del JSONB existente — sin migración)
- Placeholder orientativo: dolor a la palpación, aumento de volumen, reflejo alterado, etc.

**`PatientProfile.tsx` — historial clínico:**
- Los hallazgos se muestran en la tarjeta de cada atención, entre el diagnóstico y las Notas de Evolución
- Fondo `bg-primary-50/40` con borde `border-primary-100` para diferenciarse visualmente
- Solo se renderiza si el campo tiene valor (`event.physical_exam?.findings`)

---

## Cambios realizados — junio 2026 (sesión 44, 2026-06-11)

### Finanzas basadas SOLO en ingresos manuales — eliminación de "pagos pendientes" y "Por Cobrar"

**Decisión del usuario (permanente):** el sistema de Finanzas NO procesa ningún dato de ingreso desde citas (`appointments`). La única fuente de ingresos es la tabla `incomes` (ingresos manuales) y la de egresos es `expenses`. La opción de pagos pendientes y la tarjeta "Por Cobrar" fueron eliminadas definitivamente porque generaban más confusión que ayuda a Claudia.

**Migración `finance_incomes_only_no_appointments`:**
- `get_finance_stats` reescrito: solo suma `incomes` y `expenses`. Columna `pending_payments` eliminada del tipo de retorno (DROP + CREATE). Ahora `SECURITY DEFINER` con check de `clinic_members`. `appointments_count` ahora es el conteo de ingresos manuales del período.
- `close_cash_register` reescrito: solo suma `incomes` (con descuento) y `expenses`. Las citas ya no aportan a `total_cobrado` ni al desglose por método. `total_pendiente` siempre se guarda como 0.

**Frontend:**
- `Finance.tsx`: tarjeta KPI "Por Cobrar" eliminada (grid 4 → 3 columnas); `handleMarkPaid`, `handleDeleteTransaction`, estados `transactions`/`receiptTx`/`editTx`/`txItems` y los modales `VisitReceipt`/`EditTransactionModal` eliminados de esta página; lista "Recientes" del tab Resumen ahora muestra ingresos manuales; guía actualizada (sección "Cajas diarias" en lugar de "Pagos por Cobrar").
- `CajaDelDia.tsx`: prop `transactions` y todo el rendering de citas (cobradas/pendientes) eliminados; `totalCobrado` = solo suma de `incomes`; `CloseCajaModal` sin sección "Pendiente de cobro" ni props `totalPendiente`/`pendingList`.
- `CajaReport.tsx`: secciones de transacciones y pendientes eliminadas del informe imprimible.
- `ExportModal.tsx`: secciones TRANSACCIONES, "Por Cobrar" y `STATUS_LABELS` eliminadas del CSV/JSON y del preview.
- `financeService.ts`: `pending_payments` removido de `FinanceStats`; método `updatePaymentStatus` eliminado.

### Bug UTC: ingresos creados de noche quedaban con fecha del día siguiente

**Causa raíz:** el botón "Ingreso" del banner de Finanzas abría el modal sin `defaultDate`, y el fallback de `NewIncomeForm` usaba `new Date().toISOString()` (UTC). En Chile (UTC-4), después de las 20:00 el ingreso se guardaba con la fecha de mañana. Esto explicaba: (a) ingresos de ayer apareciendo en hoy, (b) cierre de caja en $0 (el RPC no encontraba ingresos en la fecha del día).

**Fixes:**
- `Finance.tsx`: el botón del banner ahora setea `setIncomeDefaultDate(todayLocalStr)` (timezone de la clínica).
- `NewIncomeForm.tsx`: fallback cambiado a `toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' })`.
- **Datos corregidos:** 8 ingresos de Linares creados el 2026-06-10 entre 23:22–23:34 hora Chile (fechados 06-11 por el bug) movidos a su fecha real 06-10 ($268.000 total).

### Cajas faltantes en el listado

**Causa raíz:** `cajasByDate` solo se construía desde días con actividad. Cajas existentes en `cash_registers` sin movimientos (jun 5, 6, 7, 10) eran invisibles.

**Fix:** el useMemo ahora incluye también las fechas de `cashRegisters` aunque estén vacías, con `cashRegisters` en las dependencias.

### Placeholder "[NOMBRE DEL TUTOR]" — el AI agendaba sin nombre real

**Causa raíz:** `tutor_name` es campo `required` del tool `create_appointment`. Cuando el cliente no había dado su nombre, GPT inventaba el placeholder literal `"[Nombre del Tutor]"` para satisfacer el schema, y el webhook lo aceptaba. El trigger de auto-creación de contactos luego creaba el tutor con ese nombre. (La "reaparición" del nombre tras editar que reportó Claudia era este mismo placeholder en registros distintos, no una pérdida de su edición.)

**Fixes (webhook deployado):**
- Guard en `createAppt`: rechaza nombres con corchetes/llaves, vacíos o genéricos ("tutor", "cliente", "sin nombre", etc.) y devuelve `FALTA_NOMBRE_TUTOR` instruyendo al AI a preguntar el nombre completo antes de reintentar.
- Descripción del parámetro `tutor_name` reforzada: NUNCA placeholders; si no hay nombre, no llamar la función.
- **DB:** 1 tutor (`[Nombre del Tutor]`, tel 56934839967, Linares) renombrado a "Sin nombre" junto con sus citas. Claudia puede buscarlo y ponerle el nombre real.

**Regla permanente:** cualquier tool del AI con campos required de datos personales debe validar contra placeholders en el handler — el modelo SIEMPRE puede inventar valores para satisfacer el schema.

### Tercer bug UTC encontrado en revisión final: modal de Gasto del banner (commit `a0993e2`)

En la revisión de seguridad pre-push se encontró que el modal de "Gasto" del banner de Finanzas (`Finance.tsx` línea ~1058) todavía usaba `new Date().toISOString().split('T')[0]` como `defaultValue` del campo fecha — mismo bug UTC que el modal de Ingreso. Un gasto registrado después de las 20:00 hora Chile quedaba fechado al día siguiente. Fix: `defaultValue={todayLocalStr}`.

**Verificado con grep:** ya no queda ningún uso de `toISOString()` para fechas en `Finance.tsx` ni en `src/components/finance/`. El patrón de bug está erradicado del módulo de finanzas.

### Arquitectura de timezone en Finanzas — cómo funciona (referencia permanente)

Hubo 3 bugs UTC del mismo tipo corregidos en sesiones distintas. Para evitar confusión futura, así funciona la cadena completa:

1. **`useClinicTimezone`** (hook) lee `clinic_settings.timezone` de la clínica activa. Es **per-clínica** — cada clínica usa su propia zona configurada en Settings.
2. **`todayLocalStr`** en `Finance.tsx` se calcula con `toLocaleDateString('sv-SE', { timeZone: timezone || 'America/Santiago' })`. El `'America/Santiago'` es solo **fallback** si la clínica no tiene timezone, no un valor fijo.
3. **Creación de ingresos/gastos:** ambos modales reciben `todayLocalStr` como fecha por defecto → la fecha guardada respeta la timezone de la clínica.
4. **Cierre de caja:** el RPC `close_cash_register` recibe `p_date` desde el frontend (calculado con la timezone de la clínica) → hereda la zona correcta. El RPC no calcula fechas por sí mismo.
5. **Única excepción (deuda técnica documentada):** el cron `auto_open_daily_cajas()` del servidor tiene `'America/Santiago'` hardcodeado. Solo afectará cuando haya clínicas de otro país — el fix está en "Tareas pendientes".

**Historial de los 3 bugs UTC (todos `toISOString()` devolviendo el día siguiente después de las 20:00 CLT):**
| Sesión | Dónde estaba | Qué rompía |
|---|---|---|
| 39 | `Finance.tsx` / `CajaDelDia.tsx` — display de caja "hoy" | La caja del día mostraba la fecha equivocada de noche |
| 44 | `NewIncomeForm` fallback + botón "Ingreso" del banner sin `defaultDate` | Ingresos nocturnos fechados mañana → cierre de caja en $0 |
| 44 (final) | Modal "Gasto" del banner — `defaultValue` del campo fecha | Gastos nocturnos fechados mañana |

**Regla permanente:** nunca usar `new Date().toISOString()` para derivar una fecha "de hoy" en el frontend. Siempre `todayLocalStr` (o `toLocaleDateString('sv-SE', { timeZone: ... })` con la timezone de la clínica). Si un componente necesita fecha por defecto, recibirla por prop desde la página que ya tiene `useClinicTimezone` — no calcularla internamente.

---

## Cambios realizados — junio 2026 (sesión 43, 2026-06-09)

### Bug crítico: cierre de caja fallaba para Mauricio (Animalgrace Santiago)

**Síntoma:** al hacer clic en "Cerrar caja", aparecía el toast "No se pudo cerrar la caja". Ocurrió 4 veces según logs de Postgres.

**Causa raíz confirmada en logs:** `null value in column "opening_balance" of relation "cash_registers" violates not-null constraint`

El RPC `close_cash_register` hace:
```sql
SELECT COALESCE(opening_balance, 0) INTO v_opening_balance
FROM public.cash_registers WHERE clinic_id = p_clinic_id AND date = p_date;
```
Cuando **no existe fila previa** para esa fecha, PostgreSQL resetea la variable a `NULL` aunque el `COALESCE` esté en el SELECT (aplica solo si hay fila — con 0 filas el `INTO` anula el valor inicial `NUMERIC := 0`). El INSERT posterior fallaba por NOT NULL constraint.

Hay 4 fechas en Santiago con transacciones pero sin fila en `cash_registers` (jun 1, 2, 4 y 12 — esta última con citas futuras agendadas), que pueden disparar el error.

**Fix — migración `fix_close_cash_register_null_opening_balance`:**
```sql
-- Línea agregada después del SELECT INTO:
v_opening_balance := COALESCE(v_opening_balance, 0);
```

**Regla permanente:** en PL/pgSQL, `SELECT ... INTO variable` con 0 filas deja la variable en `NULL`, anulando el valor declarado con `:= default`. Siempre agregar `variable := COALESCE(variable, default)` después de todo `SELECT INTO` que pueda no encontrar filas.

---

### Bug AI agent: mínimo $15.000 no aplicado cuando recargo = $0 — Linares y Santiago

**Síntoma (Linares):** el agente cotizó corte de uñas $6.000 sin recargo adicional (cliente dentro del radio urbano de Talca), sin informar que el mínimo de visita es $15.000.

**Causa raíz:** la regla `VALOR MÍNIMO DE ATENCIÓN` existía en `ai_behavior_rules` de ambas sucursales, pero el ejemplo solo mostraba el caso con recargo $6.000. Cuando recargo = $0 (dentro del radio urbano), el modelo no activaba el chequeo porque el patrón del ejemplo requería un recargo no nulo.

**Fix aplicado (Linares + Santiago, DB, efectivo de inmediato):** regla reescrita con indicación explícita para el caso $0:

> `⚠️ ESTO APLICA INCLUSO CUANDO EL RECARGO ES $0: ej. corte de uñas $6.000 + recargo $0 = $6.000 → cobrar $15.000.`

**Regla permanente — ejemplos en prompts de precio:** nunca usar un único ejemplo que implique un caso especial (ej: solo con recargo ≠ $0). Siempre incluir el caso borde explícito (ej: recargo = $0) para que el modelo no asuma que la regla no aplica en ese caso.

---

### Bug: Mauricio (vet_assistant) no podía registrar gastos ni ingresos en Finanzas

**Síntoma:** al intentar agregar un gasto desde Finanzas, aparecía error "Solo owners y admins pueden registrar gastos". Mauricio solo tiene restricción en `finance_metrics` (ver KPIs financieros), pero debería poder realizar todas las acciones de Finanzas.

**Causa raíz:** 7 overloads de RPCs de finanzas tenían hardcodeado `AND role IN ('owner','admin')` en el check de membresía:
- `create_clinic_expense` (2 overloads — 5 y 7 params)
- `create_clinic_income` (4 overloads — 5, 7, 9 y 10 params)
- `update_clinic_income` (1 overload — 10 params)

La restricción de rol era redundante con el sistema de permisos del frontend (`can('finance')`). Cualquier miembro activo con acceso a la página de Finanzas debería poder operar en ella.

**Fix — migración `fix_finance_rpcs_remove_owner_admin_restriction`:** removido `AND role IN ('owner','admin')` de los 7 overloads. El check ahora solo verifica membresía activa en la clínica:
```sql
-- Antes:
WHERE user_id = auth.uid() AND clinic_id = p_clinic_id AND status = 'active' AND role IN ('owner','admin')

-- Después:
WHERE user_id = auth.uid() AND clinic_id = p_clinic_id AND status = 'active'
```

**Regla permanente:** los RPCs de finanzas no deben restringir por rol — el control de acceso a la sección es responsabilidad del sistema de permisos del frontend (`permissions.pages.finance`). La única excepción es `finance_metrics` que controla la visibilidad de KPIs, no las acciones.

---

## Cambios realizados — junio 2026 (sesión 45, 2026-06-16)

### Fix Finanzas — método de pago no aparecía en informe de caja

**Síntoma:** el informe PDF de la caja del día mostraba "sin especificar" en todos los ingresos aunque el método de pago se hubiera ingresado desde el modal.

**Causa raíz:** `financeService.addIncome()` recibía `payment_method` del formulario pero lo omitía al llamar al RPC `create_clinic_income`. El parámetro `p_payment_method` simplemente no estaba en el objeto que se enviaba al RPC.

**Fix en `src/services/financeService.ts`:**
```typescript
// Añadida línea faltante:
p_payment_method: income.payment_method || null,
```

**Cadena completa:** UI recopila `payment_method` → `handleAddIncome` lo pasa → `financeService.addIncome()` lo enviaba al RPC (antes lo ignoraba) → RPC `create_clinic_income` guarda en `incomes.payment_method` → `get_clinic_incomes_secure` lo retorna → `CajaReport` lo muestra.

---

### Integración Meta Cloud API — inicio de proceso Tech Provider

**Contexto:** el número de WhatsApp de Animalgrace Santiago no podía conectarse a YCloud por un mismatch de moneda irresolvable (YCloud conecta cuentas en AUD, la WABA de Santiago fue creada en USD). Meta tampoco permite agregar el número directamente a la Cloud API porque sigue ligado a la WhatsApp Business App.

**Descubrimiento clave:** Meta permite coexistencia (WhatsApp Business App + Cloud API simultáneamente) pero SOLO para **Tech Providers** aprobados. Así es como YCloud lo logra para Linares. El camino correcto es que Vetly se registre como Tech Provider.

**App Meta configurada:** `Vetly Omnicanal` (App ID: `1658152138764158`)
- **Negocio Meta dueño de la app:** `Nexflow Ai System` (Business ID: `2680025095637170`). La app `Vetly Omnicanal` vive bajo este negocio — confirmado en sesión 47.
- Proyecto Supabase: `ehmncwawzdciajvuallg`
- Webhook URL: `https://ehmncwawzdciajvuallg.supabase.co/functions/v1/meta-whatsapp-webhook`
- Verify token: `vetly_meta_2026`
- App Secret: guardado como Supabase secret `META_APP_SECRET`
- Webhook verificado ✅ — subscrito a `messages`, `message_template_quality_update`, `message_template_status_update`, `calls`
- Verificación del negocio: ✅ Aprobado (Paso 1 completado)
- **Verificación de acceso como proveedor de tecnología (Tech Provider): ✅ VERIFICADO** — enviada 17 jun 2026, aprobada (vista en sesión 47, 2026-06-24). El estado en Meta Developers → Verificación de acceso muestra Enviado → Revisado → Verificado. Como la verificación de Tech Provider es a nivel de **negocio**, cubre a la app `Vetly Omnicanal` por estar bajo `Nexflow Ai System`.
- App Review de permisos (`whatsapp_business_messaging`, `whatsapp_business_management`): 🟡 **EN REVISIÓN** ("Revisión en curso"). Enviado 17 jun 2026 con los videos de demostración. Verificado en sesión 47 (2026-06-24): ambos permisos figuran "En 1 caso de uso", esperando veredicto. Meta revisa la mayoría en ~20 días → ventana estimada hasta ~7 jul 2026. Si piden más información, llega a la Bandeja de entrada de alertas de la app.

**Edge function creada:** `supabase/functions/meta-whatsapp-webhook/index.ts`
- Maneja GET para verificación de webhook (responde con `hub.challenge`)
- Maneja POST con verificación HMAC-SHA256 (`x-hub-signature-256: sha256=<hex>`)
- Busca clínica por `clinic_settings.meta_phone_number_id`
- El routing al AI agent está marcado como TODO — es un scaffold
- Deployada con `--no-verify-jwt` (requerido para webhooks externos)

**Política de privacidad:** `https://vetly.pro/privacidad` — existe y es accesible públicamente ✅

---

### Pasos pendientes — App Review Meta (sesión 46, actualizado sesión 47)

> **Actualización sesión 47 (2026-06-24):** la **verificación de acceso como proveedor de tecnología ya está VERIFICADA** para el negocio `Nexflow Ai System` (dueño de la app `Vetly Omnicanal`). Eso completa el requisito de fondo. Lo que queda es el **App Review de los permisos avanzados** con los videos (pasos 2–4 abajo). El paso 1 de config conviene revisarlo igual antes de enviar.

Para que Vetly pueda ofrecer coexistencia a los clientes vía App Review aprobada:

**1. Revisar configuración de la app**
En Meta Developers → App `Vetly Omnicanal` → "Revisar la configuración de la app":
- Confirmar que el ícono está subido
- Confirmar que `https://vetly.pro/privacidad` está configurada como URL de política de privacidad
- Confirmar la categoría de la app

**2. Grabar video para `whatsapp_business_messaging`**
- Mostrar la app enviando un mensaje vía API al número de prueba
- Mostrar la interfaz de WhatsApp (web o móvil) recibiendo ese mensaje
- Usar el número de prueba del Paso 1 (Phone Number ID: `1199762829882743`)

**3. Grabar video para `whatsapp_business_management`**
- Mostrar llamadas a la API de gestión (ej: listar números o crear plantilla)

**4. Iniciar revisión**
Botón "Iniciar revisión de la aplicación" en Meta Developers → Conviértete en proveedor de tecnología.

**Una vez aprobado:**
1. Implementar Embedded Signup con Coexistence en el frontend de Vetly
2. Conectar Santiago con coexistencia (sin perder WhatsApp Business App)
3. Completar `meta-whatsapp-webhook` con routing completo al AI agent
4. Agregar columnas DB: `meta_phone_number_id`, `meta_access_token`, `meta_waba_id` en `clinic_settings`

**Regla permanente — coexistencia Meta:**
La coexistencia (WhatsApp Business App + Cloud API) solo está disponible para Tech Providers aprobados. El flujo es Embedded Signup con soporte para cuentas existentes de WhatsApp Business App. Los clientes deben tener la app en versión 2.24.17 o superior.

**⚠️ No compartir el App Secret en texto plano.** Ya está guardado como `META_APP_SECRET` en Supabase secrets. Si se necesita consultarlo, buscarlo en Supabase → Edge Functions → Secrets.

---

## Cambios realizados — junio 2026 (sesión 46, 2026-06-18)

### Bug: método de pago de ingresos manuales nunca se guardaba en producción (commit `da8d8a1`)

**Síntoma:** Claudia seleccionaba un método de pago al registrar un ingreso, pero nunca quedaba reflejado (informe de caja mostraba "sin especificar"). El fix de sesión 45 supuestamente ya lo había resuelto.

**Causa raíz (confirmada con datos reales):** el fix de sesión 45 — añadir `p_payment_method` a `financeService.addIncome` — **quedó solo en el working tree local y nunca se commiteó ni se deployó a Vercel**. Producción corría el código de HEAD, donde `addIncome` llamaba al RPC `create_clinic_income` SIN `p_payment_method`. Como ese parámetro tiene `DEFAULT NULL`, PostgREST resolvía igual el overload de 12 args (oid 41752) pero guardaba `null`.

**Evidencia:** en `incomes`, el único registro con método (`"efectivo"`, 16-jun 23:10) se creó corriendo el código local en dev; todos los creados desde vetly.pro (producción) los días 15–18 jun quedaron en `payment_method = null`. La cadena completa (form → handler → service → RPC → lectura) estaba correcta salvo esa línea sin deployar.

**Fix:** se commiteó y pusheó la línea faltante (`p_payment_method: income.payment_method || null` en `addIncome`). El RPC y `get_clinic_incomes_secure` ya guardaban/retornaban el campo correctamente — no requirieron cambios.

**Dato no recuperable:** los 16 ingresos del 15–18 jun quedaron con `payment_method = null` sin rastro en ningún otro campo (notes también vacío). El método nunca se persistió, no es recuperable automáticamente. **Resolución acordada: Claudia los completa manualmente** editándolos desde Finanzas (la edición vía `updateIncome` sí guardaba el método, incluso antes de este fix).

**Lección permanente (refuerzo de sesión 17):** un fix solo cuenta cuando está **commiteado y pusheado a `main`** (Vercel deploya desde `main`). Documentar un cambio en CLAUDE.md no equivale a deployarlo. Antes de dar por cerrado un bug de frontend, verificar `git status` / que el commit esté en `main`.

### Bug: eliminar un ingreso no se reflejaba hasta refrescar la página (commit `22aa72f`)

**Síntoma:** al borrar un ingreso, desaparecía de la DB (al refrescar ya no estaba) pero la lista en pantalla seguía mostrándolo hasta recargar manualmente.

**Causa raíz:** `handleDeleteIncome` borraba y luego llamaba `loadData()`, que recarga con un `Promise.all` de 6 queries. Las 3 críticas (`getStats`/`getExpenses`/`getIncomes`) no tienen `.catch`, así que si cualquiera rechazaba en esa recarga puntual, todo el `Promise.all` caía al `catch` y **ningún `setState` corría** → la vista quedaba con datos viejos hasta el siguiente refresh.

**Fix (dos capas):**
1. **Eliminación optimista en `handleDeleteIncome`:** quita el ingreso del estado local al instante (`setIncomes(curr => curr.filter(...))`), con reversión si el borrado falla. No depende de que `loadData` tenga éxito.
2. **`loadData` con `Promise.allSettled`:** un fallo en una query ya no tumba a las demás; cada sección (`stats`, `expenses`, `incomes`, `metrics`, `cashRegisters`, `clinicName`) se setea de forma aislada solo si su promesa resolvió. Beneficia también a agregar/editar ingresos y gastos.

**Regla permanente — recargas de Finance:** preferir `Promise.allSettled` sobre `Promise.all` cuando se hace fan-out de múltiples queries cuyo fallo individual no debe invalidar las demás. Para operaciones de borrado/edición en listas, aplicar actualización optimista del estado local en vez de depender exclusivamente de un refetch.

### Indicador de estado de la IA — ahora refleja el estado real (commit `f72889a`)

**Síntoma:** el menú lateral ("IA Activa / Respondiendo 24/7") y el banner del Dashboard ("Agente activo") mostraban siempre la IA como activa, sin importar si el agente estaba apagado.

**Causa:** los tres indicadores tenían el texto y los estilos hardcodeados, sin leer ningún campo de estado.

**Fix:** los tres ahora leen `clinic_settings.ai_auto_respond` (el mismo campo que controla el toggle "Agente IA activo" en Ajustes IA → `AISettings.tsx`):
- **`DashboardLayout.tsx`** (sidebar desktop + mobile): estado `aiActive` cargado en un `useEffect` por `profile.clinic_id`. Cuando `ai_auto_respond === false` → "IA Apagada / No responde mensajes" con punto gris sin animación; en otro caso → "IA Activa / Respondiendo 24/7" (punto teal pulsante).
- **`Dashboard.tsx`** (banner de saludo): mismo patrón. Badge "Agente apagado" (punto gris) + subtítulo "Tu asistente IA está apagado y no responde mensajes" cuando está off.

**Comportamiento:** el indicador se lee al montar la página. Si Claudia cambia el toggle en Ajustes IA, el cambio se refleja al navegar/recargar (no en tiempo real en la misma vista) — comportamiento esperado para este indicador.

**Regla permanente:** `clinic_settings.ai_auto_respond` es la fuente de verdad de si el agente IA responde. Cualquier indicador de "IA activa/apagada" en la UI debe leer este campo, nunca hardcodearse. El webhook `ycloud-whatsapp-webhook` también respeta este flag para decidir si responde.

---

## Cambios realizados — junio 2026 (sesión 47, 2026-06-24)

### Meta Conversions API (CAPI) — implementación completa para Click-to-WhatsApp

**Motivación:** el Meta Pixel no puede rastrear eventos dentro de conversaciones de WhatsApp. CAPI envía eventos server-side desde el webhook de Vetly a Meta, habilitando la optimización de anuncios Click-to-WhatsApp.

#### DB — columnas nuevas en `clinic_settings`

| Columna | Tipo | Descripción |
|---|---|---|
| `meta_pixel_id` | TEXT | ID del Pixel de Meta (ej: `1175200031357348`) |
| `meta_capi_token` | TEXT | System User Token generado desde Events Manager (nunca mostrar en chat) |
| `meta_test_event_code` | TEXT | Código de prueba de Events Manager — debe setearse en `NULL` en producción |
| `meta_page_id` | TEXT | ID de la Página de Facebook conectada a la WABA (ej: `114060250435261`) |

**Migración aplicada:** `add_meta_capi_to_clinic_settings` + `add_meta_page_id_to_clinic_settings`

**Valores actuales en producción:**
- Ambas clínicas (Linares y Santiago): `meta_pixel_id = '1175200031357348'`, `meta_page_id = '114060250435261'`, `meta_capi_token` configurado, `meta_test_event_code = NULL`

#### Helper `sendMetaCAPIEvent` — `ycloud-whatsapp-webhook`

```typescript
const sendMetaCAPIEvent = async (
  pixelId, accessToken, eventName, phone,
  ctwaClid?, customData?, testEventCode?, pageId?
): Promise<{ status: number; body: unknown } | { error: string }>
```

- Hashea el teléfono con SHA-256 antes de enviarlo a Meta (`user_data.ph`)
- Incluye `ctwa_clid` y `page_id` en `user_data` cuando están disponibles
- Retorna el resultado completo para logging (antes era fire-and-forget y se cancelaba)
- Usa `action_source: "business_messaging"` + `messaging_channel: "whatsapp"` — requeridos para eventos de WhatsApp

#### Dos eventos CAPI en producción

| Evento | Cuándo | Condición |
|---|---|---|
| `LeadSubmitted` | Primer mensaje de un contacto nuevo | `!tutor && ctwaClid && clinic.meta_pixel_id` |
| `Purchase` | Cita agendada exitosamente | `ctwaClid && clinic.meta_pixel_id && apptResult.success` |

**Posición en el código:**
- `LeadSubmitted`: ANTES del check `!clinic.ai_auto_respond` — se envía incluso cuando la IA está apagada (Santiago)
- `Purchase`: dentro de `asyncProcess`, después del tool loop cuando `create_appointment` tiene `success: true`

#### Reglas permanentes — Meta CAPI

- **`ctwa_clid` es requerido por Meta** para eventos `business_messaging`. Solo existe cuando el usuario hizo clic en un anuncio Click-to-WhatsApp real. Nunca enviar CAPI sin `ctwaClid` — Meta rechaza la request con error `2804071`.
- **`page_id` es requerido** en `user_data` para eventos de WhatsApp. Es el ID de la Página de Facebook asociada a la WABA, **no** el Pixel ID ni el Ad Account ID.
- **Event names válidos** para `business_messaging`: `LeadSubmitted`, `Purchase`. El evento `Contact` no es válido (error `2804066`).
- **El token es un System User Token** generado desde Events Manager (tipo: `Conversions API Application`). Nunca expira. Scope: `read_ads_dataset_quality`. **No compartir en chat.**
- **No se puede probar sin un anuncio real.** El `ctwa_clid` que inyecta Meta es validado server-side — valores inventados dan error `2804087`. La única prueba real es crear un anuncio Click-to-WhatsApp y hacer clic desde un teléfono real.
- **`meta_test_event_code`** debe ser `NULL` en producción. Solo se usa durante desarrollo para que los eventos aparezcan en "Probar eventos" de Events Manager.

#### Diagnóstico durante desarrollo — patrón para ver respuestas de CAPI

El `console.log` de edge functions NO es visible con el MCP tool `get_logs` (solo muestra HTTP-level). Para ver la respuesta real de Meta, loguear en `debug_logs` y consultar con SQL:

```sql
SELECT created_at, message, payload
FROM debug_logs
WHERE message LIKE '%META CAPI%'
ORDER BY created_at DESC LIMIT 5;
```

Secuencia de errores resueltos durante implementación:
1. Fire-and-forget cancelado por Deno → `await` el fetch
2. Event name `Contact` inválido → `LeadSubmitted` (primer contacto) + `Purchase` (cita)  
3. Faltaba `page_id` → añadir `meta_page_id` a `clinic_settings`
4. `ctwa_clid` inválido en pruebas manuales → es imposible testear sin un anuncio real

#### Estado Tech Provider Meta (actualización)

- **Verificación del negocio:** ✅ Aprobado
- **Verificación de acceso Tech Provider:** ✅ VERIFICADO — `Nexflow Ai System` aprobado como proveedor de tecnología
- **App Review** (`whatsapp_business_messaging` + `whatsapp_business_management`): 🟡 En revisión — enviado 17 jun 2026, ventana estimada hasta ~7 jul 2026
- **CAPI:** ✅ En producción — funcionará automáticamente con el primer clic de anuncio Click-to-WhatsApp

---

## Cambios realizados — julio 2026 (sesión 48, 2026-07-01)

### Finanzas — owners pueden reabrir cajas cerradas

**Motivación:** una vez cerrada una caja del día, quedaba bloqueada para siempre (no se podían editar/agregar ingresos o gastos de esa fecha). Se pidió una vía de excepción, mantenida como acción exclusiva del owner de la clínica.

**DB (migración `20260701000001_reopen_cash_register_owner_only.sql`):**
- Columnas `reopened_by UUID` / `reopened_at TIMESTAMPTZ` en `cash_registers` (auditoría)
- RPC `reopen_cash_register(p_clinic_id, p_date)` — `SECURITY DEFINER`, verifica `clinic_members.role = 'owner'` (no admin, no otros roles) antes de pasar `status: 'closed' → 'open'`. Lanza excepción si el caller no es owner o si no hay caja cerrada para esa fecha.

**Frontend:**
- `usePermissions.ts` expone `isOwner` — distinción nueva porque `owner` y `admin` comparten `FULL_PERMISSIONS` en el sistema de permisos existente (sesión 25), que no alcanza a diferenciar acciones exclusivas del owner.
- `financeService.ts`: método `reopenCaja(clinicId, date)`.
- `CajaDelDia.tsx`: botón **"Reabrir caja"** (candado abierto, ámbar) visible solo cuando la caja está cerrada y `canReopen` es true. Al reabrirse, los controles ya existentes de editar/agregar ingresos y gastos (condicionados a `!isClosed`) vuelven a aparecer automáticamente — sin UI adicional.
- `Finance.tsx`: pasa `canReopen={isOwner}` + handler `handleReopenCaja` con `confirm()` (mismo patrón que `handleDeleteIncome`/`handleDeleteExpense`).

**Regla permanente:** cualquier acción futura que deba distinguir owner de admin (no solo "miembro con acceso a la página") debe usar `isOwner` de `usePermissions()`, no el sistema de `ActionKey`/`PageKey` — ese sistema por diseño trata a owner y admin como equivalentes.

### Auditoría y limpieza de archivos sueltos (commit `af987ac`)

Revisión de los archivos no versionados que quedaban en el working tree:

#### Bug encontrado: 10 imágenes de portada del blog en 404 en producción
Los artículos de `public/blog/*.html` referencian imágenes (`og:image`, `twitter:image`, `<img>` inline) que **nunca se habían subido a git** — en el Mac local solo existían como placeholders vacíos de iCloud (`.nombre.png.icloud`, ~180 bytes) porque el contenido real había sido evictado a la nube. Confirmado con `curl -I` a `vetly.pro/*.png` → 404 en las 10 URLs.

**Fix:** `brctl download <path>` fuerza la descarga del contenido real desde iCloud (funciona para archivos dentro de carpetas sincronizadas por iCloud Drive/Desktop, como este proyecto en `~/Desktop`). Las 10 imágenes recuperadas (~2MB c/u) y commiteadas. Esto arregla tanto el `<img>` visible en cada artículo como las previews de redes sociales (og:image/twitter:image), que estaban rotas desde que se publicaron.

**Regla permanente:** si aparecen archivos `.nombre-real.ext.icloud` en `public/` (o cualquier carpeta del proyecto), son placeholders de iCloud por evicción — el archivo real puede recuperarse con `brctl download` antes de asumir que el contenido se perdió.

#### Limpieza adicional
- **Versionado (nunca se había commiteado):** `supabase/functions/meta-whatsapp-webhook/index.ts` — código real ya deployado en Supabase desde sesión 45, ausente del repo hasta ahora.
- **Eliminados (duplicados obsoletos, sin uso):** `src/pages/AISettings 2.tsx` (snapshot con pricing pre-sesión 36: Standard ×8 + Pro ×60, superado por la consolidación a un solo GPT-4o ×15), `supabase/functions/ycloud-whatsapp-webhook/index 2.ts` (snapshot pre Meta CAPI), `.grep_out.txt` (residuo de un grep redirigido a archivo), `public/elizabeth.jpeg` (sin referencias en el código), `public/Vetly-App.code-workspace` (archivo de VSCode con ruta personal del usuario — mal ubicado dentro de `public/`, se hubiera servido públicamente en vetly.pro).
- **Sacados del tracking de git** (quedan en `.gitignore`): `tsconfig.tsbuildinfo` y `supabase/.temp/cli-latest` — artefactos de build/CLI que cambian en cada corrida local y no aportan como historial versionado.

**Regla permanente:** los archivos `*.code-workspace` no deben vivir dentro de `public/` (ni de ninguna carpeta servida estáticamente) — cualquier archivo ahí se publica tal cual en vetly.pro.

---

## Cambios realizados — julio 2026 (sesión 49, 2026-07-06)

### Finanzas — el tutor de un ingreso manual no aparecía en ninguna parte del frontend

**Reporte del usuario:** "Cada ingreso debería quedar enlazado al tutor, tanto en el informe como en el historial financiero de cada tutor."

**Diagnóstico (verificado con datos reales, no supuesto):**
- `incomes.tutor_id` **sí se guarda correctamente** en la gran mayoría de los registros — confirmado con query directa a producción (semana del 29-jun: 44 ingresos, 36 con tutor; semana del 6-jul: 6 de 7 con tutor). El flujo Form → `handleAddIncome` → `financeService.addIncome` → RPC `create_clinic_income` (overload de 12 params) ya pasaba `p_tutor_id` correctamente.
- El bug real: **ningún componente del frontend leía ni mostraba `tutor_name`**. `get_clinic_incomes_secure` solo devolvía el `tutor_id` (UUID crudo) — nunca se hacía el JOIN contra `tutors`. Por eso:
  - El informe de caja (`CajaReport.tsx`) mostraba el texto fijo `"Ingreso manual"` en la columna "Paciente / Descripción", nunca el nombre real.
  - La lista de ingresos del día (`CajaDelDia.tsx`) tampoco mostraba tutor — el tipo `IncomeEntry` ni siquiera tenía el campo.
  - El export CSV/JSON (`ExportModal.tsx`) tampoco incluía tutor en "INGRESOS MANUALES".
  - `TutorDetails.tsx` → tab "Historial Financiero" **sí funcionaba** (consulta directa `incomes WHERE tutor_id = tutor.id`), pero solo mostraba los ingresos que tuvieran tutor — invisible para el resto.
- **Causa raíz de los ingresos SIN tutor** (8-21 por semana): en `NewIncomeForm.tsx`, el campo "Tutor Asociado" es de texto libre + dropdown. Si Claudia escribía el nombre y hacía clic en otro campo del formulario **sin hacer clic explícito sobre la sugerencia**, `selectedTutor` quedaba en `null` — el campo se veía "lleno" pero `tutor_id` nunca se enviaba. Confirmado por el patrón de datos: no es aleatorio, ocurre de forma sistemática todas las semanas.

**Fixes aplicados:**
1. **Migración `income_tutor_name_in_secure_rpc`** (aplicada en producción + archivo en `supabase/migrations/`): `get_clinic_incomes_secure` ahora hace `LEFT JOIN tutors` y retorna `tutor_name`.
2. **`financeService.ts`**: `Income.tutor_name?: string | null` agregado.
3. **`CajaDelDia.tsx`**: cada fila de ingreso muestra el tutor vinculado (o `"Sin tutor vinculado"` en itálica) en vez del texto fijo "Ingreso manual".
4. **`CajaReport.tsx`**: la columna del informe imprimible ahora muestra el tutor real. Encabezado renombrado de "Paciente / Descripción" a **"Tutor"** (ajuste pedido tras revisar el informe generado — el nombre anterior confundía porque la columna nunca mostró pacientes, solo tutores).
5. **`ExportModal.tsx`**: columna `Tutor` agregada al CSV y campo `tutor` al JSON de "ingresos_manuales".
6. **`Finance.tsx`** (mini-lista "Recientes"): subtítulo ahora antepone el nombre del tutor a la fecha.
7. **`NewIncomeForm.tsx`** (fix de causa raíz): 
   - `onBlur` del campo de tutor intenta resolver el texto escrito contra la lista (match exacto case-insensitive, o único resultado filtrado) con un delay de 150ms para no pisar el click sobre una sugerencia del dropdown.
   - `Enter` en el campo selecciona el primer resultado filtrado.
   - Si el campo tiene texto pero no quedó ningún tutor resuelto, aparece un aviso ámbar: *"Este ingreso se guardará sin tutor vinculado. Selecciona uno de la lista o borra el texto."*

**No recuperable automáticamente:** los ingresos históricos con `tutor_id = NULL` no tienen forma de backfill automático — la `description` solo lista nombres de servicios/productos, sin ninguna referencia al tutor o paciente. Quedan así salvo que alguien los edite manualmente desde Finanzas.

---

## Cambios realizados — julio 2026 (sesión 50, 2026-07-09)

### Conexión Animalgrace Santiago a Meta Cloud API — en progreso

**Objetivo:** conectar el número +56966614016 de Santiago directamente a Meta Cloud API, reemplazando YCloud (que tenía mismatch de moneda AUD/USD irresoluble).

#### Estado de la infraestructura Meta (completado en esta sesión)

**WABA "Animal Grace Veterinaria Móvil":**
- ID: `903775156940145`
- Business owner: "Agencia Digital - Publymed" (Business ID: `587379105060987`)
- Moneda: USD ✅
- App suscrita: **Vetly Omnicanal** (ID: `1658152138764158`) ✅ — subscribed_apps confirmado

**Número de teléfono:**
- +56 9 6661 4016
- Phone Number ID: `830644144272371`
- `quality_rating: "GREEN"`, `verified_name: "Animal Grace Veterinaria Móvil"`
- `platform_type: "ON_PREMISE"`, `status: "DISCONNECTED"` ← **pendiente migrar a Cloud API**

**System User Token generado:**
- "Vetly API" (ID: `61591681656544`) en "Agencia Digital - Publymed"
- Token generado con permisos `whatsapp_business_management` + `whatsapp_business_messaging`
- Token guardado en DB: `clinic_settings.meta_access_token` para Santiago

**DB de Santiago actualizada:**
```sql
UPDATE clinic_settings SET
  meta_phone_number_id = '830644144272371',
  meta_access_token    = '<token>',  -- guardado en DB
  meta_waba_id         = '903775156940145',
  whatsapp_provider    = 'meta'
WHERE id = '13472ea4-4da6-461c-9a80-a5c970d9ec73';
```

**Edge function `meta-whatsapp-webhook`:** deployada (v2, código completo con AI agent).

#### Bloqueante: número aún en mode ON_PREMISE

El número sigue con `platform_type: "ON_PREMISE"` porque YCloud lo tenía registrado en su infraestructura. Para que los webhooks funcionen, el número debe migrar a `"CLOUD_API"`.

**Intentos y errores encontrados:**
- `POST /register` → "Register endpoint is not available for SMB businesses" (el endpoint chequea el negocio dueño del WABA, no el app caller)
- `DELETE /deregister` → no soportado para ON_PREMISE
- `POST /request_code` → error 136024 "espera 1 hora" (rate limit temporal, no es error de permisos)

**Clave:** el endpoint `/request_code` NO devuelve "SMB not available" — solo un rate limit de 1 hora. Esto indica que el flujo de 3 pasos SÍ es accesible:
1. `POST /request_code` → Meta manda SMS con OTP al número
2. `POST /verify_code` con el OTP
3. `POST /register` → número queda en Cloud API

#### Pendiente ejecutar (requiere presencia de Claudia)

```bash
# Paso 1 — ejecutar 1h después del último intento fallido
curl -X POST "https://graph.facebook.com/v22.0/830644144272371/request_code" \
  -H "Authorization: Bearer <USER_TOKEN_VETLY_OMNICANAL>" \
  -d '{"code_method": "SMS", "language": "es"}'

# Paso 2 — Claudia recibe OTP en +56966614016, pasarlo aquí
curl -X POST "https://graph.facebook.com/v22.0/830644144272371/verify_code" \
  -H "Authorization: Bearer <USER_TOKEN_VETLY_OMNICANAL>" \
  -d '{"code": "<OTP_6_DIGITOS>"}'

# Paso 3 — una vez verificado
curl -X POST "https://graph.facebook.com/v22.0/830644144272371/register" \
  -H "Authorization: Bearer <USER_TOKEN_VETLY_OMNICANAL>" \
  -d '{"messaging_product": "whatsapp", "pin": "000000"}'
```

**Tokens disponibles:**
- System User Token (Agencia Digital - Publymed): guardado en DB
- User Token Vetly Omnicanal: de vida corta, requiere regenerar en developers.facebook.com/tools/explorer → app "Vetly Omnicanal" → permisos `whatsapp_business_management` + `whatsapp_business_messaging`

#### Una vez migrado a Cloud API

1. Verificar `platform_type: "CLOUD_API"` con `GET /v22.0/830644144272371?fields=platform_type,status`
2. Enviar mensaje de prueba desde el número de Santiago a cualquier contacto vía API
3. Verificar que `meta-whatsapp-webhook` recibe el POST en `debug_logs`
4. Activar AI agent: `UPDATE clinic_settings SET ai_auto_respond = true WHERE id = '13472ea4-...'`

#### Reglas permanentes — Meta Cloud API Santiago

- **WABA suscrita a Vetly Omnicanal:** el campo `subscribed_apps` ya está configurado. Los eventos de WhatsApp llegan al webhook `https://ehmncwawzdciajvuallg.supabase.co/functions/v1/meta-whatsapp-webhook`
- **App Secret:** el HMAC de los webhooks usa el App Secret de Vetly Omnicanal, que ya está guardado como `META_APP_SECRET` en Supabase secrets
- **System User Token:** no expira (generado sin caducidad en "Agencia Digital - Publymed → Usuarios del sistema → Vetly API"). Si se revoca, regenerar desde el mismo Business Manager
- **`whatsapp_provider = 'meta'`** en DB de Santiago: el código del dashboard ya está preparado para mostrar las credenciales Meta en Settings cuando el proveedor es `'meta'`
- **El PIN de 2FA** (paso 3 del registro) puede ser cualquier número de 6 dígitos si el número no tenía 2FA activado previamente en YCloud. Si YCloud activó 2FA, se necesita el PIN original de YCloud (contactarlos si es necesario)

**Regla permanente:** cualquier campo de tipo "buscador con dropdown + texto libre" (tutor, producto, etc.) donde el resultado seleccionado se guarda como FK debe resolver el texto escrito en `onBlur`/`Enter`, no solo en el `onClick` de la sugerencia — de lo contrario el dato se pierde en silencio cada vez que el usuario no hace clic explícito en la lista.

---

## Cambios realizados — julio 2026 (sesión 51, 2026-07-13)

### Bug crítico: Meta CAPI nunca reportaba conversiones reales (`Purchase`) — solo "leads"

**Contexto:** se revisó si Animalgrace estaba aprovechando la atribución de campañas Meta (Click-to-WhatsApp) implementada en sesión 47. Diagnóstico con datos reales de producción:

- **211 personas distintas** hicieron clic en un anuncio C2W y llegaron a WhatsApp — el evento `LeadSubmitted` se disparaba correctamente (216 envíos exitosos a Meta CAPI).
- De esos 211, **10 efectivamente agendaron una cita** (cruce contra `appointments`).
- Pero el evento `Purchase` (que le informa a Meta cuáles clics terminaron en una conversión real) **nunca se había disparado ni una sola vez** — 0 registros en `debug_logs` desde que CAPI existe.

**Causa raíz:** en `ycloud-whatsapp-webhook/index.ts`, `ctwaClid` se extraía como variable local **solo del mensaje que se está procesando en esa invocación** (`m.referral?.ctwa_clid`, línea ~2884). Meta únicamente adjunta ese dato en el primer mensaje que resulta de tocar el anuncio. El webhook es *stateless* por mensaje — el agendamiento real ocurre varios mensajes (y varias invocaciones separadas) después, momento en el cual `ctwaClid` ya es `undefined` porque ese mensaje posterior no trae `referral`. Además, **no existía ninguna columna en la base de datos que persistiera el `ctwa_clid`** — se perdía apenas terminaba la request del primer contacto. Resultado: Meta nunca aprendía cuáles clics convertían, y el algoritmo de optimización de la campaña no podía priorizarlos.

**Fix aplicado:**
- **Migración `add_ctwa_clid_to_tutors`:** columna `tutors.ctwa_clid TEXT DEFAULT NULL`.
- **Webhook (`ycloud-whatsapp-webhook`, deployado):**
  - El SELECT inicial de `tutor` ahora incluye `ctwa_clid`.
  - Al primer contacto, si `ctwaClid` está presente y el tutor no tiene uno guardado, se persiste: `UPDATE` si el tutor ya existe (solo si `ctwa_clid IS NULL`, para no pisar la primera atribución), o `upsert` de un registro mínimo (mismo patrón que la detección de código de referido) si el tutor aún no existe.
  - El bloque que dispara el evento `Purchase` ahora usa `const effectiveCtwaClid = tutor?.ctwa_clid || ctwaClid` — recupera el valor persistido en el primer contacto en vez de depender de la variable local (casi siempre vacía en ese punto).

**Regla permanente:** cualquier dato que Meta/WhatsApp solo entrega en el **primer mensaje** de una conversación (ej. `referral.ctwa_clid`) debe persistirse de inmediato si se necesita más adelante en el flujo — el webhook no tiene memoria entre invocaciones distintas de un mismo número.

---

## Cambios realizados — julio 2026 (sesión 52, 2026-07-13)

### Bug crítico: sucursal activa inconsistente — mascotas y finanzas en la clínica equivocada (commit `9f93a32`)

**Síntoma (reportado por Claudia, cuenta multi-sucursal Linares/Talca + Santiago):**
1. Seleccionaba la sucursal Linares, agregaba una mascota, y la mascota (y su tutor) terminaban guardados en **Santiago**.
2. Veía las finanzas de Linares/Talca, pero el indicador de sucursal (`BranchSwitcher`) mostraba **Santiago**.

**Confirmado con datos de producción:** la cuenta de Claudia (`vetmovilanimalgrace@gmail.com`) tenía `user_profiles.clinic_id = Santiago` en la DB aunque trabaja principalmente en Linares. **8 tutores + sus mascotas con dirección del Maule** (Colbún, Linares, Talca) estaban guardados en Santiago, algunos desde mayo — incluyendo *Nala* (creada el miércoles 8-jul, la fecha exacta que reportó Claudia).

#### Causa raíz (una sola, dos síntomas) — `src/contexts/AuthContext.tsx`

Dos fuentes de verdad para la sucursal activa y dos caminos de inicialización que las resolvían distinto, en carrera en el mismo `useEffect` de montaje:
- `ACTIVE_CLINIC_KEY = 'vetly_active_clinic_id'` (localStorage) = elección real del usuario, escrita por `switchClinic`.
- **`initializeAuth`** seteaba `profile.clinic_id` con el valor **crudo de la DB**, IGNORANDO `ACTIVE_CLINIC_KEY`.
- **`onAuthStateChange`** seteaba `profile.clinic_id = ACTIVE_CLINIC_KEY || DB`, RESPETANDO localStorage.
- Como la DB de Claudia = Santiago y su `ACTIVE_CLINIC_KEY` = Linares, si ganaba `initializeAuth`, `profile.clinic_id` quedaba en Santiago.

Además, dos patrones de consumo divergentes: `member?.clinic_id || profile?.clinic_id` (Finance, Inventory, Settings, RetentionEngine, Team, `useClinicTimezone`) vs `profile?.clinic_id` solo (`BranchSwitcher` indicador, `PetForm`). Cuando `member` y `profile` divergían, Finanzas cargaba de `member` (Linares) mientras el indicador mostraba `profile` (Santiago) → síntoma 2. Y `PetForm` insertaba con `profile.clinic_id` (Santiago) → síntoma 1.

#### Fix de código (hotfix mínimo — converger `profile` y `member`)

- **`AuthContext.tsx`:** nuevo helper `resolveActiveClinicId(dbClinicId)` = `localStorage.getItem(ACTIVE_CLINIC_KEY) || dbClinicId`, usado en AMBOS caminos (`initializeAuth` y `onAuthStateChange`). `initializeAuth` ahora resuelve igual que `onAuthStateChange` y fetchea member/subscription con el valor resuelto. La hidratación inicial del `useState` de `profile` también mergea `ACTIVE_CLINIC_KEY` (el primer render deja de usar el cache crudo). `member` ahora siempre se resetea a `null` si no hay fila (antes solo se seteaba con fila presente → quedaba obsoleto). Resultado: `profile.clinic_id === member.clinic_id === sucursal activa`, gane quien gane la carrera. No se tocan los ~6 consumidores.
- **`PetForm.tsx` + `TutorDetails.tsx` (defensa en profundidad):** `PetForm` ahora recibe `clinicId` como prop y lo hereda del tutor (`clinicId={tutor.clinic_id}`), en vez de usar `profile.clinic_id`. **Una mascota siempre pertenece a la misma clínica que su tutor.**

Verificado que resetear `member` a `null` es seguro: `usePermissions.ts` usa `member?.role ?? profile?.role` y `Settings.tsx:101` usa `if (!member || member.role…)` — ambos null-safe, caen a `profile.role`.

**Regla permanente:** la sucursal activa se resuelve SIEMPRE con `resolveActiveClinicId` (localStorage `vetly_active_clinic_id` manda sobre el `clinic_id` crudo de la DB). Ningún componente nuevo debe leer `user_profiles.clinic_id` directamente para decidir la clínica activa. Tras `switchClinic`, `profile.clinic_id` y `member.clinic_id` quedan garantizados iguales. Cualquier registro que pertenezca a un tutor (mascotas, etc.) debe heredar el `clinic_id` del tutor, no de la sucursal activa.

#### Remediación de datos en producción (transacciones revisadas antes de ejecutar)

Diagnóstico completo antes de mover nada: de los 8 tutores del Maule mal ubicados en Santiago, **6 estaban DUPLICADOS** (ya existían en Linares — Claudia los recreó o el flujo de citas los generó). Solo 2 eran únicos de Santiago.

- **Perfil de Claudia:** `user_profiles.clinic_id` Santiago → Linares (su sucursal principal).
- **2 tutores únicos** (Priscila Duarte, María Elena Retamal) → movidos a Linares con mascotas, ingresos y recordatorios.
- **Ingreso de Catalina $28.000 (8-jul)** → reubicado al tutor Catalina que ya existía en Linares. **Ingreso de Priscila $46.000 (13-jul)** → viajó con su tutora. Ambos quedaron en la caja de Linares del día correcto (ambas cajas abiertas, recalculan solas).
- **6 duplicados limpiados:** se borraron las 5 copias fantasma de Santiago (Zuliber, Fernanda Espinoza, Catalina, Fernanda Reyes, Fernando) porque la copia buena ya estaba en Linares. Caso especial **Griselda Huinca**: la copia Santiago tenía los datos buenos (Canela + Marta como mascotas separadas, con vacuna) y la copia Linares un registro basura ("Marta y canela" combinado) → se movieron las mascotas buenas + sus registros clínicos a Linares y se eliminó el registro basura.
- **Resultado: 0 tutores del Maule quedan en Santiago.** Ningún dato clínico se perdió — se verificó cada tabla hija (vaccines, deworming, appointments, clinical_records, medical_history, satisfaction_surveys, patient_tags, tutor_tags, incomes, loyalty) antes de borrar, y las FK se limpiaron en orden dentro de una transacción.

**Regla permanente — fusión de tutores duplicados:** antes de borrar un tutor/mascota, consultar TODAS las tablas hija vía FK (`information_schema` sobre `patients`/`tutors`) y verificar counts reales. Al fusionar duplicados, no asumir cuál copia conservar: comparar datos clínicos (la copia con vacunas/desparasitaciones/historial puede estar en cualquiera de las dos sucursales). Mover registros clínicos actualizando su `clinic_id` (vaccines/deworming/reminders lo tienen; patient_tags no). Todo en una transacción `BEGIN…COMMIT`.

**Nota operativa:** tras el deploy, Claudia debe cerrar sesión y volver a entrar una vez para que el navegador cargue el estado limpio (su `profile` cacheado en localStorage aún apuntaba a Santiago).

---

### REGRESIÓN del fix anterior: no se podían guardar mascotas (commits `a5c4117`, `b80fdf9`)

**Síntoma:** inmediatamente después de desplegar `9f93a32`, Claudia no podía guardar ninguna mascota. **No aparecía ningún error — simplemente no pasaba nada.**

**Causa raíz:** el cambio de defensa en profundidad hizo que `PetForm` heredara el `clinic_id` del tutor (`clinicId={tutor.clinic_id || ''}` en `TutorDetails`). Pero el objeto `tutor` **no viene de la tabla `tutors`**: `Tutors.tsx` lo obtiene del RPC `get_unified_contacts` y lo pasa como `tutor={selectedContact as any}` (línea ~157). **Ese RPC no devolvía la columna `clinic_id`** (su `RETURNS TABLE` tenía solo `id, name, phone_number, email, address, notes, total_appointments, type, created_at, tags`). Resultado: `tutor.clinic_id === undefined` → `clinicId = ''` → el guard `if (!clinicId || !tutorId) return` **cortaba en silencio** y el insert nunca se ejecutaba.

**Por qué no lo detectó TypeScript ni `npm run build`:** el `as any` en `tutor={selectedContact as any}` desactiva la verificación de tipos en el punto exacto donde el contrato se rompía. El build pasó limpio con el bug adentro.

**Fix aplicado (3 capas):**
- **Migración `get_unified_contacts_return_clinic_id`** (archivo `20260713000002_...sql`): `DROP + CREATE` del RPC añadiendo `clinic_id` al `RETURNS TABLE`, tanto en la rama de `tutors` como en la de `crm_prospects`. Verificado: 0 contactos con `clinic_id` nulo.
- **`Tutors.tsx`:** `clinic_id: string` agregado al tipo `Contact`.
- **`PetForm.tsx`:** el guard **ya no falla en silencio** — setea `error` visible ("No se pudo determinar la clínica del tutor. Recarga la página e intenta de nuevo.") en vez de un `return` mudo.

**Auditoría de regresiones del fix de sesión 52 (hecha a raíz de esto):**
| Cambio | Veredicto |
|---|---|
| `member` puede ser `null` | Seguro — sus ~10 consumidores usan `member?.` o chequean null; `RoleGuard` cae a `profile.role` |
| `resolveActiveClinicId` en ambos caminos | Sano — es el fix de raíz y funciona |
| Otros consumidores de `get_unified_contacts` (`Appointments.tsx`) | Seguros — añadir una columna al RETURNS TABLE es aditivo |
| Otros usos de `tutor.clinic_id` | Ninguno — `PetForm` era el único |

**Reglas permanentes:**
1. **Nunca escribir un guard que retorne en silencio en un handler de submit.** Si faltan datos para guardar, mostrar un error visible. Un `return` mudo produce exactamente el síntoma "no pasa nada" que es el más difícil de diagnosticar para el usuario.
2. **`as any` al pasar props oculta contratos rotos.** Antes de asumir que un objeto tiene un campo, verificar su origen real — en Vetly, muchos "tutores" que ve la UI vienen de RPCs (`get_unified_contacts`) que devuelven un subconjunto de columnas, NO de `SELECT * FROM tutors`. Si un componente necesita un campo nuevo del tutor, confirmar que el RPC de origen lo devuelva.
3. **`npm run build` no sustituye ejercitar el flujo real.** Este bug pasó el build limpio. Para cambios que tocan escritura de datos, probar el flujo end-to-end (crear/guardar) antes de desplegar.

---

## Cambios realizados — julio 2026 (sesión 53, 2026-07-17/19)

### Migración Santiago a Meta Cloud API — estado del bloqueo ON_PREMISE

**Contexto:** el número +56966614016 de Animalgrace Santiago (Phone Number ID: `830644144272371`) está atascado en `platform_type: ON_PREMISE` / `status: DISCONNECTED` en el backend de Meta. Todo el código e infraestructura de Vetly está lista (edge function `meta-whatsapp-webhook` deployada, columnas DB configuradas, WABA suscrita a Vetly Omnicanal). El único bloqueante es liberar el número del registro on-premise.

#### Estado verificado via API (definitivo)

```
platform_type: "ON_PREMISE"
status: "DISCONNECTED"
code_verification_status: "NOT_VERIFIED"
name_status: "AVAILABLE_WITHOUT_REVIEW"   ← nombre perfecto, NO es el problema
quality_rating: "GREEN"
verified_name: "Animal Grace Veterinaria Móvil"
```

#### Intentos de migración realizados

- `POST /v22.0/830644144272371/request_code` con `code_method: "SMS"` → error 136024 / subcode 2388091, `is_transient: false`
- `POST /v22.0/830644144272371/request_code` con `code_method: "VOICE"` → mismo error
- Ruta WABA-scope (`/903775156940145/phone_numbers/830644144272371/request_code`) → `Unknown path components`
- Deregister (`DELETE`) → no soportado para ON_PREMISE desde tokens externos
- Esperar 1+ horas entre intentos → mismo error (no es rate limit, es bloqueo estructural)

#### Causa raíz confirmada

YCloud registró este número como on-premise puro (no coexistencia) en su infraestructura. Al desconectarse, el número quedó en `DISCONNECTED` pero el **registro on-premise sigue activo en el backend de Meta** a nombre de YCloud como BSP. Meta bloquea cualquier `request_code` de terceros sobre un número registrado por otro BSP. Esto requiere intervención manual.

#### Errores y falsas pistas descartadas

- **Agente IA de Meta dijo que era el nombre de visualización** — INCORRECTO. `name_status: AVAILABLE_WITHOUT_REVIEW` es el mejor estado posible. Se verificó via API y el nombre no tiene ningún problema.
- **YCloud dijo "desvincular desde la app móvil"** — INCORRECTO para este caso. La desvinculación desde la app aplica a cuentas en modo *coexistencia*. Este número era on-premise puro — la app de Claudia mostraba "Conéctate a la plataforma" (sin conexión activa), no hay nada que desvincular desde la app.

#### Lo que Meta Support confirmó

El agente humano de soporte (caso ID: **1005021615770685**) confirmó que el número necesita un **"Manual Release de backend"** — su término exacto. No pudieron ejecutarlo en el momento por carga del equipo técnico.

#### Acciones pendientes (ambas en paralelo)

**Para YCloud:** enviarles este mensaje:
> "El número +56966614016 (Phone Number ID: 830644144272371, WABA: 903775156940145) fue registrado como on-premise puro a través de su infraestructura. La API de Meta muestra `platform_type: ON_PREMISE, status: DISCONNECTED`. El endpoint `/request_code` retorna error 136024/2388091 con `is_transient: false`. Necesitamos que llamen al endpoint de deregistro desde su infraestructura de servidor (no desde la app móvil — ese número nunca estuvo en coexistencia). ¿Pueden confirmar si este número sigue activo en su sistema interno y ejecutar el deregistro desde su lado?"

**Para Meta Support (caso 1005021615770685):** reabrir y decir:
> "Hola, vengo del caso ID 1005021615770685. El equipo anterior confirmó que el número 830644144272371 necesita un **Manual Release de backend** para liberar su registro ON_PREMISE/DISCONNECTED. ¿Pueden proceder con eso ahora?"

#### Una vez liberado el número

Ejecutar inmediatamente:
```bash
# Paso 1 — solicitar OTP (Claudia debe estar disponible para recibirlo)
curl -X POST "https://graph.facebook.com/v22.0/830644144272371/request_code" \
  -H "Authorization: Bearer <SYS_TOKEN>" \
  -d '{"code_method": "SMS", "language": "es"}'

# Paso 2 — verificar con el OTP recibido
curl -X POST "https://graph.facebook.com/v22.0/830644144272371/verify_code" \
  -H "Authorization: Bearer <SYS_TOKEN>" \
  -d '{"code": "<OTP>"}'

# Paso 3 — registrar en Cloud API
curl -X POST "https://graph.facebook.com/v22.0/830644144272371/register" \
  -H "Authorization: Bearer <SYS_TOKEN>" \
  -d '{"messaging_product": "whatsapp", "pin": "000000"}'
```

El `SYS_TOKEN` es el System User Token de "Agencia Digital - Publymed" guardado en `clinic_settings.meta_access_token` de Santiago. Es permanente (no expira).

Después de los 3 pasos, verificar `platform_type: "CLOUD_API"` y activar el AI agent: `UPDATE clinic_settings SET ai_auto_respond = true WHERE id = '13472ea4-...'`.

---

## Cambios realizados — julio 2026 (sesión 54, 2026-07-19)

### Auditoría Meta CAPI — la campaña de Linares optimizaba sin señal de conversión

**Contexto:** se revisó por qué el costo por "cliente potencial" de la campaña Click-to-WhatsApp de Linares se sentía alto, y si esos leads estaban realmente más calificados que una conversación iniciada.

#### Hallazgo 1 — "cliente potencial" lo definía Vetly, y lo definía mal

En una campaña C2W, Meta puede usar su modelo nativo (comportamiento dentro del hilo) **o** los eventos que el anunciante manda por Conversions API. Si hay eventos CAPI, Meta usa esos y descarta su heurística. Animalgrace está en el segundo caso.

La condición de `LeadSubmitted` era `!tutor && ctwaClid && meta_pixel_id` — **el primer mensaje de cualquier contacto nuevo venido del anuncio**, sin ninguna calificación. Vetly le reportaba a Meta "esto es un cliente potencial" apenas alguien escribía "hola". **294 eventos enviados** entre el 25-jun y el 18-jul con esa definición.

#### Hallazgo 2 — filtrar por palabras clave no sirve (medido, no supuesto)

La hipótesis inicial (calificar por "declara comuna" o "pregunta precio") se midió contra los 68 leads reales con `ctwa_clid`: **67 de 68 califican — el 98,5%**. Preguntar el precio o mencionar la comuna es el comportamiento por defecto de todo el que toca el anuncio, no una señal de intención. La regla por keywords se descartó.

Lo que sí discrimina es la **profundidad de conversación**: de 68 leads, 18 mandaron 1 mensaje, 14 mandaron 2-3, y 36 mandaron 3 o más.

#### Hallazgo 3 (el más grave) — 0 eventos `Purchase` en toda la historia de CAPI

El bloque que dispara `Purchase` vive en el tool loop del AI agent (línea ~4083), **después del `return` de `!clinic.ai_auto_respond`** (línea ~3443). Como Claudia mantiene el agente apagado en Linares de forma intencional, ese bloque nunca se alcanzaba. Las citas que ella carga a mano en el dashboard no disparaban nada.

**Consecuencia:** Meta llevaba un mes optimizando la campaña conociendo únicamente quién había saludado, sin una sola señal de quién terminó agendando.

#### Fixes aplicados

| Cambio | Archivo |
|---|---|
| Columnas `capi_lead_sent_at` / `capi_purchase_sent_at` + backfill de los 68 leads ya reportados | `20260719000001_capi_event_idempotency.sql` |
| `LeadSubmitted` ahora espera `LEAD_MIN_INBOUND = 3` mensajes inbound del tutor, con idempotencia | `ycloud-whatsapp-webhook` |
| Guard `!tutor?.capi_purchase_sent_at` en el `Purchase` del agente, para no duplicar con el dashboard | `ycloud-whatsapp-webhook` |
| Edge function nueva que reporta `Purchase` desde el dashboard (JWT + `clinic_members`, idempotente, valida `ctwa_clid`) | `meta-capi-purchase` |
| Llamada fire-and-forget a la edge function al crear una cita nueva | `src/pages/Appointments.tsx` |

#### Errores de interpretación cometidos y corregidos en la misma sesión

Ambos se presentaron al usuario como hallazgos y hubo que retirarlos:

1. **"0 respuestas registradas" ≠ Claudia no responde.** Con la IA apagada, sus respuestas salen por fuera de Vetly (su teléfono o la consola de YCloud) y nunca tocan el webhook, así que no quedan en `messages`. La tabla de ceros insinuaba abandono y el dato no daba para eso — es un punto ciego de instrumentación, no una métrica de operación.
2. **"2,9% de conversión" era una foto parcial.** La ventana real es de 5 días (13→18 jul, desde que se persiste el `ctwa_clid`). Un lead de anteayer todavía puede agendar.

**Regla permanente:** antes de presentar una métrica derivada de `messages`, verificar si la IA estaba activa en ese período. Con `ai_auto_respond = false` la tabla solo contiene inbound — cualquier ratio que use outbound como denominador o señal es inválido.

#### Reglas permanentes — Meta CAPI

- **El evento de optimización define qué compra la campaña.** Si `LeadSubmitted` se dispara con el primer mensaje, "cliente potencial" y "conversación iniciada" son el mismo evento con distinto nombre, y se paga precio premium por lo mismo.
- **`Purchase` debe poder dispararse con el agente apagado.** Cualquier señal de conversión que dependa de un tool call del AI desaparece cuando la clínica opera en manual. Por eso vive en una edge function invocable desde el dashboard.
- **Meta necesita ~50 eventos de optimización por semana** por conjunto de anuncios para salir de la fase de aprendizaje. Al endurecer la definición de un evento, verificar que el volumen resultante siga sobre ese umbral (aquí: 36 de 68 ≈ 43/semana).
- **Sin webhook no hay CAPI.** Santiago no genera `ctwa_clid` porque su número está bloqueado en `ON_PREMISE` y Vetly no recibe sus mensajes. Nada de lo implementado en esta sesión aplica a Santiago mientras dure ese bloqueo.

#### Recomendación de campaña para Santiago (sin tracking propio)

Optimizar por **"Conversaciones iniciadas"**, no por "Clientes potenciales". Sin CAPI que lo alimente y sin histórico, el evento escaso deja el conjunto atrapado en fase de aprendizaje e infla el costo por resultado. Segmentación amplia por comunas, presupuesto contenido 5-7 días corridos sin ediciones, y medir citas agendadas a mano desde el dashboard.

**Puente entre campañas:** cuando Linares acumule eventos `Purchase` reales, se puede crear un público similar (lookalike) desde los convertidos y aplicarlo a Santiago. Para que funcione, Claudia debe cargar en el dashboard las citas que vienen del anuncio — las que queden fuera del sistema no alimentan el modelo.

### Meta Ads MCP — disponible desde abril 2026

Meta lanzó un MCP oficial el **29 de abril de 2026** en `https://mcp.facebook.com/ads` (beta abierta, gratis, ~29 tools, OAuth de Meta Business). Permite gestionar campañas por conversación desde Claude Code local o la web.

**Nota de scopes:** ninguno de los tokens existentes sirve para gestionar campañas — `meta_capi_token` tiene `read_ads_dataset_quality` y el System User Token de Publymed tiene solo `whatsapp_business_*`. Marketing API requiere `ads_read` / `ads_management`. El MCP oficial lo resuelve vía OAuth, sin tokens manuales.

**Precaución:** el MCP tiene capacidad de escritura (crear campañas, cambiar presupuestos y pujas) sobre dinero real. Usarlo para diagnóstico por defecto y confirmar con el usuario cualquier cambio estructural o de presupuesto.
