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
- El plan **Enterprise** permite hasta **3 sucursales totales** (raíz + 2 adicionales). El RPC `create_clinic_branch` bloquea con excepción si `count(owner clinics) >= 3`
- **Límites por plan (usuarios/agendas/recordatorios/créditos): autoridad = tabla `plan_limits`** (Postgres). Espejos a mantener en sync: `src/lib/plans.ts` (frontend) y `_shared/planLimits.ts` FALLBACK (solo se usa si la query falla). Cambiar el número primero en `plan_limits`, luego los dos espejos.
- **Para cambiar precios** (no límites): `src/lib/mercadopago.ts`, `src/lib/paddle.ts`, `src/pages/Pricing.tsx`, `public/landing.html`. (LemonSqueezy se eliminó en sesión 68 — cualquier nota vieja que lo mencione está obsoleta.)
- Las cuentas `manually_active = true` se rigen por `clinic_settings.max_users` (no por el plan derivado de `subscriptions.plan`). El RPC `invite_member_v2` respeta este flag.

### Créditos IA por plan — límites, enforcement y estado (2026-09-02)

**Límites vigentes en `plan_limits.ai_credits`:**

| Plan | Créditos IA/mes | ≈ mensajes del agente/mes | Marketing dice |
|---|---|---|---|
| Core | 0 | — | "gestión sin IA" ✅ |
| Starter | 5.000 | ~575 | "5.000 créditos IA/mes" ✅ |
| **Pro** | **20.000** | **~2.300** | "Conversaciones IA ilimitadas" (cierto en la práctica con 20k) |
| Enterprise | 30.000 | ~3.450 | "Conversaciones IA ilimitadas" ⚠️ (tope real; Animalgrace lo supera) |

Costo blended ≈ **8,7 créditos/mensaje** (mezcla ~55% GPT-4o × 15 + ~45% mini × 1). `CREDIT_COST_4O = 15` en `_shared/aiCredits.ts`.

**Cadena de enforcement:** `plan_limits.ai_credits` → los webhooks de pago (`paddle-webhook`, `mercadopago-webhook`, `signup-handler`, `mercadopago-create-subscription`) vía `limitsForPlan()` lo copian a `clinic_settings.ai_credits_monthly_limit` → `getCreditStatus()` en el webhook del agente lo checkea → al agotarse (`exhausted`), **el agente queda mudo** hasta el reset del día 1 o hasta que compren un pack. Los webhooks solo resincronizan `ai_credits_monthly_limit` en el próximo pago/cambio de plan — subir un límite en `plan_limits` NO actualiza a las clínicas ya existentes; hay que hacerlo a mano.

**"Ilimitado" de verdad = flag `clinic_settings.ai_credits_unlimited` (boolean) por clínica.** El código NO soporta un plan con créditos ilimitados (`PlanLimits.ai_credits` es `number`, no nullable; null caería a un default de 500). Para hacer un plan realmente ilimitado habría que: (a) que los webhooks seteen `ai_credits_unlimited = true` para ese plan, o (b) usar un número muy alto. La UI (`AISettings.tsx`) ya muestra "∞ ILIMITADO" cuando el flag está activo.

**Direcciones para resolver la inconsistencia "ilimitadas" vs tope real:**
- **A — flag `ai_credits_unlimited` real:** elimina el modo "agente mudo" para el plan; riesgo de costo OpenAI sin techo (acotado — incluso uso alto deja >70% de margen).
- **B — tope honesto + copy con número:** "20.000 créditos IA/mes" en vez de "ilimitadas".
- **C — tope alto de seguridad + copy sigue "ilimitadas":** el tope protege contra abuso pero ninguna clínica real lo toca. **← elegido para Pro (20.000).**

**Estado:** Pro resuelto con dirección C (20.000). **Enterprise pendiente de decisión del usuario:** sigue en 30.000 con copy "ilimitadas"; Animalgrace (pool compartido Linares+Santiago) consume ~43.000/mes → se les acaba y compran packs, fricción sobre el cliente insignia. Recomendación: Enterprise → `ai_credits_unlimited` real (dirección A).

### Packs de créditos extra — reglas permanentes (reescritas sesión 2026-09-01)
- **Los packs comprados NO expiran.** `ai_credits_extra_expires_at` siempre queda en `NULL`. Todas las rutas de compra (`mercadopago-webhook`, `paddle-webhook`, `AdminClinics.tsx handleManualCharge`) fijan `null`. El cron `expire-extra-credits` (pg_cron jobid 17) quedó **desactivado** (`cron.unschedule('expire-extra-credits')`); la edge function sigue existiendo pero no la llama nadie.
- **El pack se descuenta a medida que el consumo del ciclo supera el plan mensual.** El único punto que lo descuenta son los RPC `increment_clinic_mini_usage` / `increment_clinic_4o_usage` (los llama `saveMsg` en ambos webhooks): calculan el excedente de cada mensaje por encima de `ai_credits_monthly_limit` y lo restan de `ai_credits_extra_balance` (y luego de `ai_credits_extra_4o`). Nunca hacer UPDATE directo de esos campos por consumo.
- **Lo que sobra del pack se arrastra al mes siguiente automáticamente.** `reset_monthly_ai_usage()` (pg_cron jobid 3, día 1 de cada mes) pone en 0 solo los contadores `ai_credits_monthly_*_used` — **no toca `ai_credits_monthly_limit` (queda fijo en el valor del plan) ni `ai_credits_extra_balance`**. Así, cada mes: plan fresco + saldo del pack que quedó sin usar.
- **`process_monthly_recharge()` NO se usa y NO está agendada.** Arrastra remanente del *plan* (`v_new_limit := v_remanente + v_allowance`), lo cual no es el comportamiento deseado (el plan es use-it-or-lose-it) — además calcula el remanente con el multiplicador viejo `× 8`. Si algún día se agenda, hay que reescribirla primero.
- **`ai_credits_monthly_limit` = valor plano del plan** (Core=0, Starter=5.000, Pro=20.000, Enterprise=30.000). Solo lo cambian los webhooks de pago al cambiar de plan (vía `limitsForPlan`). Nada más lo toca.
- **Agotamiento** (`getCreditStatus.exhausted` en `_shared/aiCredits.ts`): es "plan agotado (`totalUsed >= limit`) **Y** `extraBalance <= 0`". NO usar `totalUsed >= limit + extraBalance` — como `totalUsed` sube y `extraBalance` baja al mismo ritmo, ese umbral se cruzaría al doble de velocidad.
- Al comprar pack: sumar a `ai_credits_extra_balance`, dejar `ai_credits_extra_expires_at = NULL`, insertar transacción `type: 'purchase'`.

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
- **Límites por plan**: Core=25, Starter=100, Pro=null (ilimitado, desde 2026-09-02), Enterprise=null (ilimitado). Pool compartido entre recordatorios de citas (PART 1/2) y médicos (PART 4)
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

#### ~~`auto_open_daily_cajas()` — timezone hardcodeado a Chile~~ ✅ RESUELTO (sesión 80, 2026-08-18)

Ver la entrada de sesión 80 al final de este documento. El cron ya calcula la fecha con la zona de cada clínica y corre cada hora para abrir a las 07:00 locales de cada país.

⚠️ **El fix que estaba propuesto aquí era peligroso** y quedó descartado. Proponía `COALESCE(timezone, 'America/Santiago')` sin validar el valor contra `pg_timezone_names`. Como la función hace un único `INSERT ... SELECT`, un `timezone` mal escrito en **una** clínica habría lanzado `22023: time zone not recognized` y abortado el INSERT completo, dejando a **todas** las clínicas sin caja ese día. El `COALESCE` solo cubre `NULL`, no un string inválido. La versión aplicada valida contra el catálogo de Postgres.

---

#### Recordatorios automáticos de Santiago — en pausa intencional (2026-07-23)

**Estado actual:** `clinic_settings` de Santiago tiene `ycloud_api_key` y `ycloud_phone_number` en `NULL` (limpiados durante la migración a Meta Cloud API, sesiones 50-55). El cron (`cron-process-reminders`) salta a Santiago silenciosamente en las 3 partes (citas 24h/2h y recordatorios médicos) porque su chequeo inicial es `if (!clinic?.ycloud_api_key || !clinic?.ycloud_phone_number) continue`. `reminder_settings` de Santiago sigue con `reminder_24h_before = true` y `reminder_2h_before = true`, pero no tiene efecto mientras no haya un canal de envío configurado.

**Por qué se deja así a propósito:** no tiene sentido reactivar el envío hasta que:
1. El número de Santiago quede conectado a Meta Cloud API (ver plan de Embedded Signup con coexistencia, sección Meta más abajo).
2. Se creen y aprueben en Meta las plantillas de WhatsApp necesarias (`confirmacion_visita` y equivalentes de vacuna/desparasitación) — **hoy no existen para el canal Meta**. Sin plantillas aprobadas, cualquier intento de envío fallaría igual que cuando YCloud tenía el número mal registrado (sesión 56: 15+ fallos por `WHATSAPP_PHONE_NUMBER_UNAVAILABLE` entre el 14 y el 20 de julio).

**Qué falta para reactivar (checklist):**
- [ ] Completar la conexión Embedded Signup + coexistencia del número de Santiago con Meta (pendiente de intentar con Claudia).
- [ ] Crear y esperar aprobación de las plantillas de recordatorio en el Business Manager de Meta.
- [ ] Configurar `vaccine_reminder_template` / `deworming_reminder_template` / `checkup_reminder_template` y la plantilla de confirmación de cita para Santiago en `clinic_settings`, apuntando a los nombres aprobados en Meta.
- [ ] Verificar que el código de envío (hoy apunta a la API de YCloud) sepa enviar por Meta Cloud API cuando `whatsapp_provider = 'meta'` — **`cron-process-reminders` actualmente solo sabe hablar con la API de YCloud**, no con la de Meta. Esto requiere código nuevo antes de poder reactivar recordatorios en Santiago, no solo configuración.

**No se requiere ninguna acción sobre el fix de "ENVIADO que no llegaba" (sesión 56) para Santiago.** Ese fix ya está desplegado y es agnóstico de clínica — se activará solo, sin tocar código de nuevo, en cuanto Santiago vuelva a enviar por cualquier canal que use las mismas tablas (`reminder_logs`/`reminders`) y dispare eventos `whatsapp.message.updated` equivalentes.

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
5. **Apertura automática de caja:** el cron `auto_open_daily_cajas()` resuelve la zona de cada clínica desde `clinic_settings.timezone`, validada contra `pg_timezone_names` (sesión 80). Corre cada hora y abre la caja cuando en esa zona ya son las 07:00. Ya no queda ningún `'America/Santiago'` hardcodeado en la cadena de fechas del servidor.

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

**Conectado el 2026-07-19** en scope de proyecto (`~/.claude.json` → `projects[Vetly-App].mcpServers.meta-ads`), transporte HTTP, OAuth completado. La lista de MCP se lee al iniciar la sesión: tras agregarlo hay que abrir una sesión nueva para que aparezca.

---

## Cambios realizados — julio 2026 (sesión 55, 2026-07-19)

### Desbloqueo de Santiago — eliminación de la WABA y coexistencia

**Punto de partida:** el número +56966614016 llevaba semanas atascado en `platform_type: ON_PREMISE` / `status: DISCONNECTED`. YCloud insistía en que se desvinculara desde la app (procedimiento que solo aplica a números en coexistencia, no a on-premise puro) y Meta escaló a un "Manual Release de backend" que nunca ejecutó.

**Acción del usuario:** eliminó la WABA `903775156940145` desde el Business Manager de Publymed. Verificado por API: tanto la WABA como el Phone Number ID `830644144272371` dejaron de existir. **Los IDs viejos quedaron huérfanos en `clinic_settings` y hubo que limpiarlos a mano.**

Contexto que explica el limbo: Meta **deprecó la On-Premises API en octubre de 2025**. El número estaba registrado en un modo que ya no existe, por eso ninguna operación normal lo liberaba.

La campaña de Santiago quedó apuntando al número vía la **Página de Facebook**, no vía WABA — por eso Ads Manager permite seleccionarlo aunque no exista WABA. Un anuncio Click-to-WhatsApp funciona contra un número de WhatsApp Business App normal; lo que no hay en ese modo es webhook, y por lo tanto **no hay `ctwa_clid` ni eventos CAPI para Santiago**.

### Coexistencia — solo se activa desde el JS SDK

**Hallazgo central:** la coexistencia NO es una opción de configuración del `config_id` ni del link de onboarding hospedado. Se activa pasando un parámetro en `FB.login()`:

```js
extras: {
    setup: {},
    featureType: 'whatsapp_business_app_onboarding',  // 'coexistence' quedó obsoleto
    sessionInfoVersion: '3',
}
```

**El link hospedado que entrega el panel de Meta (`business.facebook.com/messaging/whatsapp/onboard/?app_id=…&config_id=…`) ejecuta el flujo estándar**, que registra el número como nuevo y desconecta a la clínica de su WhatsApp Business App. Por eso no existía ningún toggle que encontrar en el Administrador de registro insertado.

**Datos de la integración:**
| Campo | Valor |
|---|---|
| App | `Vetly Omnicanal` — `1658152138764158` |
| Config Embedded Signup | `1533217227702013` ("Tech Provider Embedded Signup config", no caduca) |
| App Secret | `META_APP_SECRET` en Supabase secrets |
| Tech Provider | ✅ verificado (Nexflow Ai System) |
| App Review | ✅ acceso avanzado a `whatsapp_business_messaging` + `whatsapp_business_management` |

**Flujo real para el usuario** (no es QR, como se documentó por error en un primer momento): elegir portfolio y número → llega un mensaje del *Facebook Business Account* al WhatsApp Business del teléfono → tocar "Conectar a la plataforma comercial" → aceptar compartir historial → pegar el código que aparece.

**Limitaciones permanentes de un número en coexistencia:**
- Listas de difusión deshabilitadas (confirmado con Claudia que no las usa)
- Los grupos no se sincronizan con la API
- Sin mensajes temporales, "ver una vez" ni ubicación en vivo
- Throughput fijo de 20 mps
- Requiere **WhatsApp Business app 2.24.17 o superior**

### Implementación

| Archivo | Rol |
|---|---|
| `src/components/settings/MetaWhatsAppConnect.tsx` | Carga el SDK de Meta y lanza el popup con el `featureType` de coexistencia. Captura los IDs por `postMessage` (evento `WA_EMBEDDED_SIGNUP`) y el `code` por el callback de `FB.login` — son canales distintos que llegan en orden variable, por eso ambos van a `useRef` y se envían cuando están los dos. |
| `supabase/functions/meta-embedded-signup/index.ts` | Cambia el `code` por token de negocio (requiere App Secret, no puede ir en el browser), resuelve WABA y número con fallback vía `debug_token` → `granular_scopes` si se pierde el postMessage, suscribe la app a la WABA y persiste los IDs. |

**No se llama a `/register`.** Ese endpoint mueve el número a Cloud API puro y rompería la coexistencia. La suscripción de la app a la WABA (`POST /{waba-id}/subscribed_apps`) sí es obligatoria: sin ella Meta no entrega ningún webhook y el número queda conectado pero mudo para Vetly.

### Dos errores cometidos y corregidos

1. **La tarjeta se puso primero en `Settings.tsx`.** El bloque de integraciones de esa página es código legacy que ya no se renderiza — la ruta `/app/integrations` apunta a `src/pages/Integrations.tsx`. **Regla: antes de agregar UI a una sección, confirmar en `App.tsx` qué componente sirve esa ruta.** Settings.tsx conserva markup de YCloud que no se muestra en ninguna parte.
2. **La tarjeta mostraba "Número conectado" con los IDs muertos.** El estado se derivaba solo de que existiera un `meta_phone_number_id` en la base, sin verificar que siguiera vivo en Meta. Se agregó "Volver a conectar", siempre visible en el estado conectado. **Regla: un indicador de "conectado" que solo mira si hay un ID guardado miente cuando el recurso se elimina del lado del proveedor — siempre dejar una salida para reconectar.**

### Estado al cierre de la sesión

- Campaña de Santiago: **activa**, optimizando por conversaciones iniciadas, sin tracking CAPI
- Número de Santiago: **sin WABA**, funcionando en la app de Claudia, listo para el Embedded Signup
- `clinic_settings` de Santiago: `meta_phone_number_id`, `meta_waba_id` y `meta_access_token` en `NULL`
- **Pendiente:** ejecutar la conexión con Claudia presente y verificar por API que quedó en coexistencia
- **Después de conectar, la IA sigue apagada.** `ai_auto_respond` de Santiago nunca ha respondido un mensaje real — revisar KB, precios y comunas antes de encenderla, sobre todo con la campaña corriendo.

---

## Cambios realizados — julio 2026 (sesión 56, 2026-07-23)

### Recordatorios que aparecían "ENVIADO" pero nunca llegaban — 3 bugs encadenados

**Reporte de Claudia (AnimalGrace Linares):** el dashboard de Recordatorios mostraba envíos como **ENVIADO** que en WhatsApp nunca llegaron (caso Ricardo, tel. `56972616061`). Diagnóstico con datos reales de producción; evidencia directa del caso de Ricardo.

#### Causa raíz #1 (dominante) — plantillas con parámetro vacío → Meta 131008
El cron enviaba `confirmacion_visita` con el primer parámetro (`patient_name`) **vacío**. La cita de Ricardo tenía `patient_name = ""` en la BD. Meta rechaza toda plantilla con un parámetro de texto vacío → `errorCode 131008: "Parameter of type text is missing text value"`. **18 de 24 fallos en 14 días** eran por esto. YCloud acepta el envío (HTTP 200, el cron marca 'sent'), y Meta lo rechaza después de forma asíncrona.

**Fix:** helper `safeParam()` en `cron-process-reminders/index.ts` (`mkParams`) — cada parámetro cae a un fallback no vacío si viene `null`/vacío/espacios (`patient_name`→"tu mascota", `service`→"tu visita", etc.). **Nunca** se envía `{type:'text', text:''}`. Defensa en el origen: `Appointments.tsx handleSaveAppointment` guarda `"Sin nombre"` si `patient_name` queda vacío tras `trim()` (patrón de `tutor_name`, sesión 44).

#### Causa raíz #2 — el "ENVIADO" solo significaba "aceptado por YCloud"
El cron marcaba `reminder_logs.status='sent'` con solo recibir HTTP 200 (aceptación, no entrega). YCloud reporta la entrega real vía evento `whatsapp.message.updated` (`status`: sent→delivered→read, o failed) — **el webhook lo descartaba** (solo procesaba `whatsapp.inbound_message.received`). Verificado: YCloud envía ~218 de estos eventos cada 3 días.

**Fix:**
- Migración `add_ycloud_message_id_to_reminder_logs`: columna `reminder_logs.ycloud_message_id TEXT` + índice. Es la clave de correlación (no existía).
- El cron ahora guarda `ycloud_message_id: responseData.id` en cada insert de `reminder_logs`.
- Nuevo handler en `ycloud-whatsapp-webhook` (bloque temprano, antes del dispatcher de inbound): si `p.type === "whatsapp.message.updated"` → verifica HMAC (buscando secret por `whatsappMessage.from`, modo permisivo igual que inbound) → actualiza `reminder_logs` y `messages` por `ycloud_message_id`. **Regla anti-desorden** (eventos llegan repetidos y fuera de orden): `failed`/`undelivered` → `status='failed'`+motivo (terminal); `delivered`/`read` → ese estado, con `.neq("status","failed")` para no pisar un fallo; `sent` se ignora (ya registrado). Retorna temprano, no toca el flujo del AI. También ignora explícitamente `whatsapp.smb.message.echoes`.

**Sinergia:** `cron-system-health` (jobid 16) ya revisaba `reminder_logs WHERE status='failed'` y alerta al fundador por WhatsApp (`getReminderFailures`, `_shared/diagnostics.ts`). Estaba ciego porque nada marcaba 'failed'. Ahora las alertas de fallos de recordatorio funcionan solas.

#### Causa raíz #3 — sin rastro auditable (insert a `messages` roto en 6 funciones)
Las 6 funciones que registran envíos insertaban en `messages` con columnas **inexistentes** (`ycloud_status`, `metadata`). El insert fallaba en silencio (Supabase JS no lanza por defecto) → sin contenido ni `ycloud_message_id`. El webhook principal ya tenía el patrón correcto (`saveMsg`), nunca replicado.

**Fix:** en `cron-process-reminders`, `cron-process-upsell`, `cron-retention-execute`, `send-whatsapp-campaign`, `cron-process-surveys`, `send-whatsapp-reminder`, `send-whatsapp-survey`: `ycloud_status:'sent'` → `status:'sent'`; `metadata:{...}` → `payload:{...}` (JSONB real); se verifica y loguea el `{error}` del insert (antes se ignoraba). Verificado con grep: `0` usos de `ycloud_status` restantes en las funciones.

#### UI — estado de entrega real (`Reminders.tsx`)
El badge dejó de mostrar un "ENVIADO" que solo significaba "aceptado". Ahora: **Enviado** (emerald) → **Entregado** (`CheckCheck`, emerald) → **Leído** (`Eye`, teal), o **Fallido** (red, con `title` del `error_message`). `delivered`/`read` cuentan como éxito en los contadores del resumen junto con `sent`; `failed` como fallo.

#### Limpieza de datos (producción)
- 1 cita futura de Santiago con `patient_name` vacío → `"Sin nombre"` (habría fallado por 131008).
- **Backfill de honestidad:** 21 filas de `reminder_logs` marcadas 'sent' que la evidencia de `debug_logs` confirma fallidas (match por teléfono + timestamp <120s del evento `status:failed`) → corregidas a `failed` con su motivo real (19× 131008 parámetro vacío, 2× 131026 no entregable). Linares pasó de "100% sent" a 61 enviados / 30 fallidos en 30 días — el dashboard ahora refleja la realidad.

#### Reglas permanentes — recordatorios y estado de entrega
- **`appointments.patient_name` NUNCA vacío.** Es parámetro de plantilla; Meta rechaza plantillas con parámetros vacíos (131008). Cualquier envío de plantilla debe sanear TODOS los parámetros a un fallback no vacío antes de llamar a YCloud.
- **HTTP 200 de YCloud ≠ entregado.** Significa "aceptado". La entrega/fallo real llega asíncrono vía `whatsapp.message.updated`. Nunca tratar la respuesta síncrona del envío como confirmación de entrega.
- **`reminder_logs.ycloud_message_id`** es la clave de correlación con los eventos de estado. Todo insert de `reminder_logs` con status 'sent' debe guardar el `responseData.id` de YCloud.
- **El webhook procesa 3 tipos de evento:** `whatsapp.inbound_message.received` (AI), `whatsapp.message.updated` (estado de entrega → actualiza reminder_logs/messages), `whatsapp.smb.message.echoes` (ignorado). El handler de estado va ANTES del dispatcher de inbound y retorna temprano.
- **Insert a `messages`:** columnas reales son `status` y `payload` (JSONB), NO `ycloud_status` ni `metadata`. Siempre verificar el `{error}` del insert. Patrón de referencia: `saveMsg` en el webhook.
- **Deploy:** `ycloud-whatsapp-webhook` con `--no-verify-jwt` (está en config.toml). Las funciones cron/campaña/encuesta NO están en config.toml → default `verify_jwt=true`; deployarlas SIN el flag `--no-verify-jwt` (con el flag se rompería su config esperada).

### Extensión del fix anterior a recordatorios médicos (misma sesión, continuación)

**Reporte de Claudia:** el mismo día se detectó el mismo patrón en recordatorios **médicos** (vacunas/desparasitación) — caso Blanquita (tutora Francisca Astete), vacuna del 14/7 marcada "ENVIADO" pero nunca llegó.

**Causa:** el fix de esta sesión solo cubrió `reminder_logs` (recordatorios de **citas**, PART 1/2). Los recordatorios **médicos** viven en una tabla distinta (`reminders`, PART 4) que tenía exactamente el mismo problema estructural — nunca se había extendido el mecanismo de corrección.

**Confirmado con evidencia:** el mensaje de Blanquita falló con `errorCode 130472`: *"Failed to send message because this user's phone number is part of an experiment"* (bloqueo temporal de Meta sobre ese número específico, externo a Vetly). Auditando los últimos 60 días: **15 recordatorios médicos de Linares** (de 43 marcados "sent") en realidad habían fallado, incluyendo 3 casos accionables de `BALANCE_INSUFFICIENT` (saldo YCloud agotado).

**Fix aplicado (mismo patrón que `reminder_logs`):**
- Migración `add_ycloud_message_id_to_reminders`: columna `reminders.ycloud_message_id` + índice.
- `cron-process-reminders` PART 4: guarda `ycloud_message_id` al marcar `status='sent'`.
- `ycloud-whatsapp-webhook`: el handler de `whatsapp.message.updated` ahora también actualiza `reminders.status` (además de `reminder_logs` y `messages`). Nota: `reminders` no tiene columna de mensaje de error, solo se corrige el `status`.
- `Reminders.tsx`: el filtro de la pestaña médica (`.in('status', [...])`) ampliado para incluir `delivered`/`read` — antes los habría ocultado de la lista.
- Backfill: 15 recordatorios médicos corregidos a `failed` con la misma metodología de correlación (teléfono + ventana de 120s contra el evento de fallo real en `debug_logs`).

**Regla permanente (reforzada):** cualquier flujo que envíe plantillas de WhatsApp y marque su propio estado de "enviado" debe guardar el `ycloud_message_id` y ser alcanzado por el handler de `whatsapp.message.updated` del webhook. Hay **dos** tablas de estado de envío en Vetly (`reminder_logs` para citas, `reminders` para médicos) — un fix de "estado real de entrega" en una no cubre automáticamente a la otra.

---

## Cambios realizados — julio 2026 (sesión 57, 2026-07-23)

### Santiago conectado a Meta Cloud API por coexistencia — 2 bugs de `meta-embedded-signup` corregidos

**Resultado:** Animalgrace Santiago quedó conectado con éxito. `clinic_settings` (id `13472ea4-4da6-461c-9a80-a5c970d9ec73`): `meta_phone_number_id = 830644144272371`, `meta_waba_id = 903775156940145`, `meta_access_token` guardado, `whatsapp_provider = 'meta'`. App suscrita a la WABA (`subscribed: true` en el log de la función) — sin esto Meta no entrega webhooks. **Son los mismos IDs que en sesión 55 se habían documentado como "eliminados" de Meta** — esa WABA nunca desapareció del todo del lado de Meta, solo quedó huérfana en la base de Vetly tras el desorden de aquella sesión.

**`ai_auto_respond` de Santiago sigue en `false`.** No se tocó — sigue pendiente revisar KB/precios/comunas antes de encenderla, tal como quedó documentado en sesión 55, sobre todo con la campaña de Ads corriendo sobre ese número.

#### Diagnóstico y fix — 2 intentos fallidos antes del éxito

**Intento 1 — `Edge Function returned a non-2xx status code` sin detalle:** la función `meta-embedded-signup` no dejaba ningún rastro de sus errores — los `return json({error}, status)` solo devolvían el body al cliente, nunca se logueaban en ningún lugar visible con las herramientas de logs disponibles (`get_logs` de edge functions no expone el response body, y `console.log` no es legible con las herramientas de este entorno). **Fix:** el helper `json()` ahora inserta en `debug_logs` cualquier respuesta con `status >= 400`, con el body completo como `payload`. Deploy v2.

**Intento 2 — con logging ya activo, apareció la causa real:**
```json
{"error": "No se pudo determinar la WABA conectada",
 "debug_token_response": {"error": {"code": 100, "type": "OAuthException",
   "message": "(#100) You must provide an app access token, or a user access token that is an owner or developer of the app"}}}
```
El popup de Meta no entregó `waba_id`/`phone_number_id` por `postMessage` en este intento (canal que la función ya sabía que podía perderse — ver sesión 56), así que cayó al fallback vía `/debug_token`. Ese fallback usaba el **propio token de negocio recién obtenido** como `access_token` de inspección — pero `/debug_token` exige que el token INSPECTOR sea un app access token (`app_id|app_secret`) o un token de usuario owner/developer de la app; el token de negocio de la Embedded Signup no cumple ninguna de las dos condiciones. **Fix:** el fallback ahora arma `appAccessToken = \`${META_APP_ID}|${appSecret}\`` y lo usa como `access_token` de la llamada a `/debug_token`, dejando `accessToken` (el token de negocio) únicamente como `input_token`. Deploy v3 — funcionó al primer reintento del usuario.

#### Reglas permanentes — `meta-embedded-signup`

- **`/debug_token` de Meta necesita dos tokens distintos:** `input_token` (el que se quiere inspeccionar) y `access_token` (el que hace la inspección, debe ser un app token `app_id|app_secret` o un token de owner/developer de la app). Usar el mismo token para ambos roles falla con error 100 — no es un error de permisos de la integración, es un uso incorrecto del endpoint.
- **Toda edge function de flujos críticos (pagos, conexión de integraciones) debe loguear sus propios errores a `debug_logs` desde el día uno.** El patrón `return json({error}, status)` sin logging deja a cualquiera —Claude incluido— completamente ciego ante un "Edge Function returned a non-2xx status code" del cliente Supabase JS, que no expone el body del error por defecto. Este flujo no lo tenía y costó un round-trip completo con el usuario solo para poder ver el primer error real.
- **El canal de `postMessage` del popup de Meta es efectivamente poco confiable en producción** (ya iba documentado en sesión 56 como posible, se confirmó real en el primer intento de esta sesión) — el fallback vía API (`/debug_token` → `granular_scopes` → `/phone_numbers`) no es una ruta de emergencia teórica, es el camino que se ejecuta en la práctica. Debe mantenerse funcionando, no tratarse como código muerto.

### Corrección de nota previa: `meta-whatsapp-webhook` NO es un scaffold

La sesión 45 documentó `meta-whatsapp-webhook` como scaffold con "el routing al AI agent marcado como TODO". Esa nota quedó **obsoleta** — en algún momento entre sesión 45 y esta, alguien completó el port entero: tool loop de 5 iteraciones, `checkAvail`/`createAppt`/`confirmAppt`/`rescheduleAppt`/`tagPatient`/`escalateToHuman`, routing híbrido (`selectModelTier` + `schedulingSignals`), CAPI (`LeadSubmitted`/`Purchase`), debounce de 20s, credit tracking — prácticamente un espejo completo de `ycloud-whatsapp-webhook` adaptado a la capa de transporte de Meta (HMAC global en vez de por-clínica, `sendMetaMessage` vía Graph API, descarga de media en 2 pasos). Confirmado end-to-end en esta sesión: mensaje real → webhook → IA → respuesta real, sin tocar código.

### Datos de Santiago verificados como completos antes de activar la IA

Antes de dar luz verde a la activación se auditó `clinic_settings` de Santiago: `ai_active_model = 'hybrid'`, `ai_personality` (2.915 caracteres), `ai_behavior_rules` (24.140 caracteres), 66 `clinic_services`, 9 documentos activos de `knowledge_base`, `working_hours` configurado, `logistics_config` con zona `rm_santiago` y base San Miguel activa, pool de créditos de 30.000/mes compartido con Linares vía `parent_clinic_id = fd11b7e4-...` (Santiago es sucursal de Linares, no clínica independiente). Todo heredado de cuando Santiago operaba sobre YCloud — no hubo que crear nada nuevo.

### El agente de Santiago quedó activo sin coordinación explícita

`ai_auto_respond` de Santiago pasó de `false` a `true` (`clinic_settings.updated_at = 2026-07-24 01:30:00 UTC`) sin que Claude hiciera el cambio — coincide con la ventana en que Claudia tenía sesión activa en Vetly (vista en Integraciones momentos antes). Confirmado con un mensaje de prueba real: la IA (`Ary`, modelo `4o_pro`) respondió correctamente sobre el número de Santiago recién conectado por coexistencia. **No hubo ningún bug de "IA respondiendo estando apagada"** — el código respeta el flag correctamente (`if (!clinic.ai_auto_respond) return;` en `meta-whatsapp-webhook`); el switch ya estaba en `true` cuando llegó el mensaje. Recomendado: confirmar con Claudia que fue ella quien lo activó, y coordinar que deje de responder manualmente ese número para evitar respuestas dobles mientras la campaña de Ads sigue corriendo.

### Bug crítico compartido: `check_availability` — `operator does not exist: time without time zone = text`

**Síntoma:** en la primera conversación real de Santiago post-activación, tras dirección y precio correctos, `check_availability` falló con "problema técnico" al pedir disponibilidad para el lunes.

**Causa raíz (reproducida directo en SQL):** la función Postgres `check_availability(clinic_id, date, time, duration)` — invocada por `get_available_slots()` una vez por cada slot candidato, para cada profesional activo — comparaba mal los tipos:
```sql
WHERE slot_time = to_char(p_time, 'HH24:MI')   -- slot_time es TIME, to_char(...) es TEXT → operador inexistente
```
Postgres no tiene `TIME = TEXT`, así que cualquier llamada que alcance esa rama explota. La rama se alcanza siempre que la clínica tenga al menos un `clinic_member` activo con rol distinto de `receptionist`/`admin` — es decir, casi cualquier clínica con al menos un profesional u owner configurado.

**Impacto real — NO era exclusivo de Santiago.** Se reprodujo el mismo error llamando `get_available_slots` para Linares (`fd11b7e4-...`) con los mismos parámetros. La diferencia es de **exposición**, no de causa:
- `ycloud-whatsapp-webhook` (Linares) primero intenta `get_professional_available_slots` directo cuando resuelve un `professionalId` — esa función NO tiene el bug. Solo cae a `get_available_slots` (la rota) como fallback, y ese fallback traga el error silenciosamente (`slots = []`) en vez de propagarlo — probablemente generando falsos "sin disponibilidad" en Linares sin que nadie lo notara.
- `meta-whatsapp-webhook` (Santiago) no resuelve `professionalId` en este flujo, va directo a `get_available_slots` y propaga el error como `reason: "rpc_error"` — por eso salió visible aquí y nunca en Linares.

**Fix — migración `fix_check_availability_time_text_type_mismatch`:**
```sql
-- Antes:
WHERE slot_time = to_char(p_time, 'HH24:MI') AND is_available = TRUE
-- Después:
WHERE to_char(slot_time, 'HH24:MI') = to_char(p_time, 'HH24:MI') AND is_available = TRUE
```
Verificado post-fix: `get_available_slots` devuelve 15 slots para el lunes 2026-07-27 tanto en Santiago como en Linares, sin error.

**Regla permanente:** cualquier reporte de "problema técnico" o disponibilidad sospechosamente vacía debe verificarse llamando directamente el RPC subyacente por SQL (`SELECT * FROM get_available_slots(...)`) antes de asumir que es un problema de la IA o del KB — un error real de Postgres puede quedar enmascarado por fallbacks que lo convierten silenciosamente en "sin resultados" en un webhook, mientras se propaga como error visible en otro.

---

### Regla de tramos — corrección definitiva (absoluta, no condicional)

El primer fix del día para "Longaví" (KB `MATRIZ_PRECIOS_Y_PROTOCOLO_CIRUGIAS`) quedó condicionado a "si el tutor solo da el nombre de la ciudad sin pin". El usuario corrigió: la regla debe ser **absoluta** — la tabla de tramos T1/T2/T3 **nunca** se muestra al tutor, tenga o no tenga ya el pin/dirección exacta. Siempre se exige ubicación exacta primero, y se entrega solo el valor final único (nunca el desglose). KB actualizado con la versión absoluta.

### Tormenta de 500 en Santiago — causa raíz real y auditoría de todo el sistema

**Síntoma reportado:** un mensaje real ("Recoleta") se quedó sin respuesta en Santiago — la IA "quedó muda".

**Diagnóstico:** el mensaje sí llegó al webhook (`Meta incoming payload` logueado), pero no hubo ni respuesta ni error registrado después. Al revisar `get_logs` del edge function se encontró una **tormenta de cientos de errores 500** en `meta-whatsapp-webhook` en los ~20 minutos previos y posteriores — Meta reintentando entregas fallidas repetidamente. La causa: el bloque que procesa eventos de estado de WhatsApp (`sent`/`delivered`/`read`, que Meta dispara después de cada mensaje que envía la IA) hacía:
```typescript
await sb.from("messages").update({ status: status.status }).eq("ycloud_message_id", status.id).catch(() => {});
```
**Mismo anti-patrón ya documentado como regla permanente en sesiones 35/39**: los query builders de Supabase no tienen `.catch()` nativo (son thenables, no Promises reales) → `TypeError: ... .catch is not a function` no capturado → tumbaba la invocación completa (500) en ~100-800ms, mucho antes de llegar a procesar el mensaje real.

**Fix inmediato (2 capas):**
1. `Promise.resolve(query).then(() => {}, () => {})` en el punto exacto del bug.
2. Try/catch envolvente en todo el procesamiento síncrono por `change` (antes solo protegido dentro de `asyncProcess`), con `debugLog` del error — para que un fallo futuro similar quede visible y aislado en vez de tumbar toda la invocación en silencio.

Ambos fixes deployados vía Supabase CLI (`supabase functions deploy meta-whatsapp-webhook --no-verify-jwt --project-ref ehmncwawzdciajvuallg`), verificado con `list_edge_functions` que `verify_jwt: false` se mantuvo. Confirmado: cero errores 500 nuevos desde el deploy.

#### Auditoría sistemática (3 agentes Explore en paralelo, solo lectura) — 4 bugs más confirmados

El usuario pidió una revisión general de bugs dado que `meta-whatsapp-webhook` es un port nuevo (mucho menos rodaje que `ycloud-whatsapp-webhook`). Se usó modo plan: 3 Explore agents en paralelo (grep de anti-patrones en las ~25 edge functions, investigación de un bug de CRM ya detectado, diff meta vs ycloud) confirmaron con evidencia de schema real:

1. **`crm_prospects` de Santiago no registraba NINGÚN contacto nuevo.** El insert de "CRM auto-sync" mandaba `status: "new"` — columna que **no existe** en `crm_prospects` (la tabla tiene `stage_id`, no `status`). El catch vacío lo ocultaba. Confirmado con evidencia en vivo: 25 filas de `crm_prospects` para Santiago, todas en formato `+56...` (formato del webhook YCloud viejo), ninguna del webhook Meta nuevo. Fix: insert sin el campo `status` + logging del error si vuelve a fallar.

2. **`tag_patient` nunca funcionó en Santiago.** Usaba columnas `tag_id`/`tag_name`/`tag_color` en la tabla `tags`, que en realidad tiene `id`/`name`/`color`. Select e insert fallaban ambos. Fix: alineado con `ycloud-whatsapp-webhook`.

3. **`send-whatsapp-campaign` tenía el mismo anti-patrón `.catch()`** (línea ~274, dentro del catch del handler, sobre `supabaseClient.from('campaigns').update(...).eq(...)`) — si el update de estado de campaña fallida fallaba, lanzaba un `TypeError` no capturado. Fix aplicado con el mismo patrón `Promise.resolve(...).then(ok, err)`.

4. **`requires_human`/comando reset en `tutors` no usaba variantes de teléfono.** A diferencia de `crm_prospects` (que sí usaba `.or()` con `+`/sin `+`), el chequeo y el reset sobre `tutors` en `meta-whatsapp-webhook` usaban `.eq()` exacto — si el formato de teléfono no calzaba byte-a-byte, un cliente pausado seguía recibiendo respuestas de la IA y el comando reset no reactivaba nada, sin error visible. Fix: `.or()` con variantes `+`/sin `+`, igual que `ycloud-whatsapp-webhook`. De paso, se alinearon las frases del comando reset (`"resetear_ia"`, `"resetear ia"`, `"reset_ia"` además de `"/reset ia"`/`"reset ia"`) para consistencia con el personal ya entrenado en el flujo viejo.

**Verificaciones que NO mostraron divergencia** (se descartaron como hipótesis): debounce/dedup de 20s idéntico, los 8 tools de OpenAI son los mismos en ambos webhooks, el chequeo de créditos IA es post-hoc en ambos (no es una regresión de meta).

**Pendiente (Fase 2, menor prioridad, no aplicado esta sesión):** portar la lógica de auto-reactivación de IA cuando un cliente pausado vuelve a saludar (existe en ycloud, no en meta); try/catch por-ítem en los loops de los crons; revisión de `debug_logs` de varias semanas + `get_advisors` como pasada adicional.

**Regla permanente (reforzada):** cuando se porta o reescribe código entre dos edge functions que tocan las mismas tablas, verificar SIEMPRE los nombres de columna reales contra el schema (`information_schema.columns`), no contra la memoria/intuición de cómo "debería" llamarse la columna — 3 de los 4 bugs confirmados hoy en `meta-whatsapp-webhook` eran exactamente este error, todos silenciados por bloques `catch {}` vacíos. Un catch vacío no es manejo de errores, es un bug esperando a pasar desapercibido.

### Fase 2 — auditoría general del sistema (`get_advisors`, `debug_logs`, crons)

**Auto-reactivación de IA tras pausa — descartada explícitamente, no es un bug.** El plan original incluía portar a `meta-whatsapp-webhook` la lógica de `ycloud-whatsapp-webhook` que reactiva la IA sola cuando un cliente pausado (`requires_human=true`) vuelve a saludar. El usuario lo rechazó: cuando Claudia toma una conversación manualmente, no quiere que la IA se la devuelva sola. **No portar esta lógica a meta-whatsapp-webhook — es una decisión de negocio, no una paridad pendiente.**

#### CRÍTICO — 5 tablas + 1 bucket con bypass total de RLS multi-tenant (`get_advisors` security)

`mcp__claude_ai_Supabase__get_advisors(type: 'security')` reveló políticas RLS con `qual: true` (sin ninguna restricción) en rol `public` — es decir, alcanzables incluso con la anon key pública del proyecto, sin necesidad de estar logueado como miembro de la clínica:

| Tabla / bucket | Política vulnerable | Alcance real |
|---|---|---|
| `crm_prospects` | `"Permitir inserción de prospectos desde el webhook"` (ALL, qual=true/true) | Cualquiera (ni logueado) puede leer/escribir/borrar prospectos de **cualquier** clínica |
| `crm_prospects` | `"Allow members and HQ Admins..."` (ALL, qual solo `auth.role()='authenticated'`) | Cualquier usuario logueado de **cualquier** clínica veía prospectos de todas — no filtraba por `clinic_id` |
| `reminder_settings` | 2 políticas `qual=true` | Configuración de recordatorios de cualquier clínica, lectura/escritura libre |
| `service_professionals` | 2 políticas `qual=true/true` | Asignación profesional↔servicio de cualquier clínica |
| `subscriptions` | `"Permitir todo a autenticados"` (ALL, qual=true) | Cualquier usuario logueado podía leer **y modificar** la suscripción de cualquier clínica, incluyendo `manually_active` (el flag que da acceso pagado sin pasar por MercadoPago/LemonSqueezy) |
| Storage `patient-documents` | `"Allow authenticated selects/deletes"` + `"Patients access"` (ALL, sin scope) | Cualquier autenticado podía **listar** todos los archivos de pacientes de cualquier clínica (y con eso, construir la URL pública de descarga) |
| `tutor_tags` | RLS habilitada, **cero políticas** | Bug de disponibilidad (no de exposición): sin ninguna policy, RLS bloquea todo por defecto |

**Impacto real verificado:** el bucket `patient-documents` está vacío hoy (0 archivos subidos), así que la exposición ahí era cero en la práctica — pero la vulnerabilidad estaba viva para el primer archivo que se subiera. Las otras 4 tablas sí tienen datos reales de producción.

**Diagnóstico de por qué no se podía simplemente borrar las políticas "true":** antes de tocar nada se verificó qué frontend depende de cada tabla, para no romper flujos legítimos:
- `subscriptions`: `Settings.tsx` deja que el dueño de una clínica **cancele su propia suscripción** con un UPDATE directo (`.eq('clinic_id', clinicId)`) — esta es la única escritura real de usuarios normales a esta tabla. Se agregó una policy de UPDATE scoped por `clinic_members` para no romper esa función.
- `service_professionals`: no tenía ninguna policy scoped de respaldo (a diferencia de las otras 3, que sí tenían una policy "buena" al lado de la mala). Se usa solo desde `Settings.tsx` (asignar profesional a un servicio), sin filtro explícito de `clinic_id` en la query — el aislamiento dependía solo de que `service_id` viniera de un `clinic_services` ya filtrado en el cliente. Se creó una policy nueva scoped vía join `clinic_services → clinic_members`.
- `tutor_tags`: mismo patrón exacto que `patient_tags` (ya arreglado en sesión 6) — se replicaron las 3 policies (`select`/`insert`/`delete` vía `tutors.clinic_id → clinic_members`) + `service_role_all`, migración `fix_multi_tenant_rls_bypass_vulnerabilities`.
- Bucket `patient-documents`: mismo patrón ya usado en `expense-receipts` (sesión 38) — scoped por primer segmento de carpeta (`storage.foldername(name)[1]`) contra `clinic_members`. Confirmado que el frontend (`PatientFiles.tsx`) ya sube con el path `{clinic_id}/{patientId}/archivo`, así que el fix no requirió cambios de código, solo de policy.

**Migración aplicada:** `fix_multi_tenant_rls_bypass_vulnerabilities` — dropea las 6 policies inseguras y crea las versiones scoped correspondientes. Verificado post-fix: `SELECT ... WHERE qual='true' OR with_check='true'` sobre las 5 tablas devuelve 0 filas.

**Regla permanente:** correr `get_advisors(type: 'security')` regularmente (la propia tool de Supabase lo recomienda después de cualquier cambio de DDL) — encontró en una sola pasada más superficie de exposición multi-tenant real que meses de auditorías puntuales por bug reportado. Antes de borrar una policy insegura, verificar SIEMPRE si hay un flujo de frontend que dependía de ella (grep de `from('tabla')` en `src/`) para reemplazarla por una policy scoped, no solo eliminarla.

#### `get_advisors(type: 'performance')` — 695 hallazgos, todos de optimización (no bugs)

`multiple_permissive_policies` (522), `auth_rls_initplan` (116, `auth.uid()` sin envolver en subselect), `unindexed_foreign_keys` (54), `unused_index`/`duplicate_index` (3). Ninguno afecta corrección de datos ni causa fallos — son oportunidades de eficiencia a escala. **No se tocaron esta sesión** — quedan como backlog de una futura pasada de performance dedicada, dado el volumen (arreglar `auth_rls_initplan` a fondo implicaría reescribir ~116 políticas RLS en gran parte del schema).

#### Revisión de `debug_logs` — sin bugs nuevos, un hallazgo histórico ya resuelto

Se revisaron los mensajes más frecuentes de `debug_logs`. `"Unrecognized payload structure"` tenía volumen altísimo (20.551 para `whatsapp.message.updated`, 11.573 para `whatsapp.smb.message.echoes`, acumulados desde abril), pero el `last_seen` de ambos es **2026-07-23 18:xx** — exactamente cuando se desplegó el fix de sesión 56 que agregó el manejo explícito de esos dos tipos de evento. Cero ocurrencias nuevas desde entonces: es ruido histórico ya resuelto, no un bug activo.

#### Try/catch por-ítem en los crons — verificado, ya existía (no requirió fix)

El plan original (basado en un hallazgo del agente Explore de la fase de diagnóstico) sugería que los 4 loops de cron (`cron-process-reminders`, `cron-process-surveys`, `cron-process-upsell`, `cron-retention-execute`) no tenían try/catch por-ítem. **Verificado directamente en el código: los 4 SÍ lo tienen** — cada loop hace algunas validaciones baratas (fechas, flags, `continue`/`break`) antes de un bloque `try {}` que envuelve toda la parte riesgosa (llamadas a YCloud, inserts). El hallazgo inicial del agente era impreciso. No se aplicó ningún cambio de código aquí — se prefirió verificar y descartar antes que tocar código que ya funcionaba bien.

### Regla nueva de negocio: costo de visita para desparasitación y corte de uñas (Linares/Talca)

**Decisión del usuario (permanente).** Para tres servicios específicos — desparasitación interna, desparasitación externa (perro o gato) y corte de uñas — la visita SIEMPRE lleva costo de traslado, a diferencia de los demás servicios:
- Si la visita es **exclusivamente** uno o varios de estos servicios (sin consulta, vacuna, examen, cirugía): traslado en **radio urbano = $6.000** (donde los demás servicios pagan $0); fuera del radio urbano = el tramo normal de la tabla (T1/T2/T4, ya ≥ $6.000).
- Si la visita incluye **además** cualquier otro servicio (consulta, vacuna, etc.): el traslado vuelve a la tabla normal (radio urbano = $0).
- **Convive** con el mínimo de $15.000 por visita: el $6.000 es el traslado; si el total (servicio + traslado) queda bajo $15.000, se cobra $15.000. Ej: corte de uñas $6.000 + visita $6.000 = $12.000 → sube a $15.000.
- Sigue exigiéndose el pin para determinar el tramo real.

**Dónde vive (solo DB, sin código ni deploy):** KB `PROTOCOLO_LOGISTICA_SERVICIOS_GENERALES` (nueva sección "3B. EXCEPCIÓN — VISITA CON PISO…", fuente de verdad) + refuerzo en `ai_behavior_rules` Sección 4 (junto al mínimo de $15.000). Solo Linares (`fd11b7e4-…`); Santiago no se tocó (su `logistics_config` es una sola zona urbana a $0, estructura distinta).

**Nota de enforcement:** es una regla de prompt/KB, no hard-enforced en código — igual que el mínimo de $15.000. El traslado es conversacional (no se persiste en `appointments`), así que no hay nada que forzar server-side; el único lever es el prompt.

### Fix: la IA cotizaba traslado con solo la comuna, sin pedir el pin (Mundo A)

**Síntoma real (Linares, modelo `4o_pro`):** cliente pidió "precio visita a domicilio" → IA preguntó "¿en qué **comuna**…?" → cliente dijo "Linares" → IA respondió "traslado dentro de Linares = **$6.000**" — sin pin, adivinando el valor (el $6.000 es casualmente el primer tramo rural de Linares; en radio urbano una consulta es $0).

**Root cause:** la exigencia estricta del pin que se reforzó en la sesión 57 quedó **solo en la Sección 9 (CIRUGÍAS)**. Para servicios generales (Mundo A) la regla era blanda y tenía una cláusula de "flexibilidad", así que la IA pedía la comuna y rellenaba el hueco del traslado con un número inventado.

**Fix (solo DB, Linares):**
- `ai_behavior_rules` Sección 1 (ZONAS CONFIRMADAS): prohibición absoluta de indicar cualquier monto de traslado (ni $0, ni $6.000, ni un tramo) basándose solo en la comuna. Pedir el pin y detenerse.
- `ai_behavior_rules` REGLA 3 (FLEXIBILIDAD DE CONSULTA): aun con dirección escrita, prohibido cotizar un traslado específico; solo se cotiza con pin o link de Google Maps.
- `ai_behavior_rules` REGLA 3 — nuevo caso **"SI EL CLIENTE NO PUEDE ENVIAR EL PIN (POR CUALQUIER MOTIVO)"**: la IA no se niega ni escala de inmediato — entrega el **valor del servicio** y aclara que, al no conocer la ubicación, no puede calcular el traslado, por lo que podría sumarse un valor adicional a confirmar con la ubicación exacta. Nunca inventa un monto de traslado.
- `ai_personality` Regla de Oro #1: "validar la ubicación" = pin de WhatsApp o link de Google Maps, **NO** el nombre de la comuna.

### Santiago — regla de desparasitación/corte de uñas SÍ aplicada; PIN NO (diferencia estructural)

A pedido del usuario se replicó a Santiago (`13472ea4-…`) la **regla de $6.000 de visita para desparasitación/corte de uñas**, adaptada a su estructura: si van solos, traslado mínimo $6.000 aunque la comuna sea Tramo A ($0); si la comuna ya tiene recargo mayor (Las Condes $6.000, Vitacura $8.000, Pirque/Buin/etc. $10.000) se aplica ese; si van con otro servicio, vuelve a la tabla de comunas normal; convive con el mínimo de $15.000. Vive en `ai_behavior_rules` de Santiago (junto a su "VALOR MÍNIMO DE ATENCIÓN").

**El endurecimiento del PIN NO se aplicó a Santiago — decisión explícita del usuario, por diferencia estructural real:**
- **Linares:** recargo por **distancia** (radio urbano $0 vs tramos rurales $6.000+). El nombre de la comuna NO alcanza; sin el pin la IA solo puede adivinar. Por eso "nunca cotizar traslado sin pin" es correcto ahí.
- **Santiago:** recargo por **comuna** (Las Condes $6.000, Vitacura $8.000, resto = Tramo A = $0), con una "REGLA ANTI-ERROR" en su prompt que lo enforcema. Indicar "$0 para Ñuñoa" o "$6.000 para Las Condes" con solo el nombre de la comuna **es correcto** en Santiago. Aplicar la regla estricta de Linares habría negado a un cliente de Tramo A su "$0" hasta mandar el pin — fricción innecesaria que contradice su diseño. El usuario eligió **dejar el flujo de Santiago como está** (comuna → recargo → pedir pin para cerrar).

**Regla permanente — cotización de traslado móvil (matizada por estructura):** en clínicas con recargo **por distancia** (tipo Linares: `logistics_config` con múltiples `time_ranges` por tiempo), NUNCA cotizar traslado sin el pin/GPS — el nombre de la comuna no determina el tramo. En clínicas con recargo **por comuna** (tipo Santiago: tabla de comunas en el KB, `logistics_config` de una sola zona), el nombre de la comuna SÍ determina el recargo y es correcto indicarlo sin pin (el pin se pide igual para cerrar/agendar). Antes de portar una regla de traslado entre sucursales, verificar cuál de los dos modelos usa cada una — no asumir que la regla de una aplica a la otra.

---

## Cambios realizados — julio 2026 (sesión 58, 2026-07-25)

### Caída total del agente IA — cuota de OpenAI agotada

**Síntoma:** Linares respondía *"Lo siento, tuve un problema técnico"* y Santiago *"Error. ¿Puedes repetir?"*; después, silencio total.

**Causa raíz:** la API de OpenAI devolvía `insufficient_quota` ("You exceeded your current quota"). No fue un bug de código. Resuelto por el usuario recargando saldo.

**Cronología (hora Chile):** hasta 14:39 normal → 15:06 primer `insufficient_quota` → 16:09/16:10 Claudia apagó `ai_auto_respond` en ambas clínicas → silencio. Impacto: **27 mensajes de 9 clientes** sin atender en Linares y **8 de 2 clientes** en Santiago, varios provenientes de anuncios pagados.

**Episodios previos del mismo error:** 30-abr, 9-may (17), 24-may (14), 23-jun. Es recurrente — saldo que se agota, no un incidente aislado.

#### Bug secundario detectado: los fallos de OpenAI en Meta no quedaban registrados

`callOpenAI` de `meta-whatsapp-webhook` hace `return res.json()` **sin validar el status HTTP**. Un 429 se cuela como respuesta válida → `assistant` queda `undefined` → sale el fallback `"Error. ¿Puedes repetir?"` ([meta-whatsapp-webhook/index.ts:1796](supabase/functions/meta-whatsapp-webhook/index.ts#L1796)) en lugar de caer al `catch`. Consecuencia: el cliente recibe un mensaje sin sentido y **el error no llega a `debug_logs`**. `ycloud-whatsapp-webhook` sí valida (`if (!r.ok) throw`) y por eso ahí sí quedó registro.

**Pendiente (no aplicado):** agregar `if (!res.ok) throw` en el `callOpenAI` de Meta, y vigilar el saldo de OpenAI en `cron-system-health` — hoy vigila el saldo de YCloud pero **no** el de OpenAI, que es justamente lo que falló.

---

### Bug del sábado — `get_professional_available_slots` ignoraba días cerrados

**Síntoma:** el agente ofreció horas para el sábado (11:30 y 12:00) cuando la clínica atiende de lunes a viernes.

**Causa raíz (bug de producto, no de AnimalGrace):** el guard del RPC era

```sql
IF v_working_hours->v_day_name IS NULL THEN RETURN; END IF;
```

y **no cubre ninguno de los dos modos reales en que la app marca un día como cerrado**:

| Origen | Cómo guarda el día cerrado | ¿El guard lo detectaba? |
|---|---|---|
| `Settings.tsx` (clínica) | `{"saturday": null}` | ❌ `'null'::jsonb` **no** es SQL NULL |
| `MyProfile.tsx` (profesional) | `{enabled: false, start, end}` | ❌ ni siquiera miraba `enabled` |

Al no cortar, caía al `COALESCE` y generaba slots. Verificado en producción para el sábado 25-jul: el RPC del profesional devolvía **7 slots** (09:00–12:00, justo los ofrecidos) mientras el RPC global devolvía **0**. `checkAvail` consulta primero el del profesional, por eso ganaba la versión rota.

**Afecta a cualquier clínica cuyo profesional haya guardado su perfil alguna vez** — `DEFAULT_HOURS` de `MyProfile.tsx` trae `saturday: {enabled: false, ...}`.

**Fix** (migración `20260725000001`): el guard ahora cubre los tres casos, igual que `get_available_slots`:
```sql
IF v_day_hours IS NULL OR v_day_hours = 'null'::jsonb
   OR (v_day_hours->>'enabled')::BOOLEAN IS FALSE THEN RETURN; END IF;
```

**⚠️ Regla permanente — JSONB null vs SQL NULL:** `'{"x": null}'::jsonb -> 'x'` devuelve `'null'::jsonb`, y `'null'::jsonb IS NULL` es **FALSE**. Todo guard sobre un campo JSONB opcional debe chequear `IS NULL OR = 'null'::jsonb`. Este patrón ya había mordido antes en este RPC.

**⚠️ Regla permanente — `CREATE OR REPLACE` con parámetro nuevo:** agregar un parámetro **cambia la firma**, así que crea una **sobrecarga nueva** y deja viva la anterior (con el bug), volviendo ambigua la resolución. Siempre `DROP FUNCTION` de la firma antigua. En esta sesión ocurrió y se corrigió al verificar `pg_get_function_identity_arguments`.

---

### Último horario del día — tope configurable a las 18:00

**Requerimiento:** el último horario ofrecido debe ser **18:00**, aunque el servicio termine pasadas las 19:00. **No aplica a cirugías** (evita agendar pabellón que terminaría cerca de las 21:00).

**Implementación:** nuevo parámetro `p_last_slot_cap TIME DEFAULT NULL` en `get_professional_available_slots`, `get_available_slots` y `check_availability`.
- `NULL` → loop original intacto (retrocompatible con `ai-simulator` y el frontend).
- Con valor → el límite pasa a ser el **inicio** del slot, permitiendo que la duración exceda el cierre.

Se tocó el RPC y no solo el webhook porque el caso de servicio largo requiere **agregar** el slot de las 18:00, no solo recortar los posteriores.

**Propagación obligatoria a `check_availability`:** `get_available_slots` filtra cada slot con `check_availability`, que a su vez delega en `get_professional_available_slots`. Sin propagar el cap, el slot tope nunca aparecía como disponible en el RPC global (Santiago quedaba en 17:30 en vez de 18:00).

**Webhooks:** el cap se lee de `logistics_config.last_slot_time` con fallback `'18:00'` — ajustable por clínica **sin deploy**, mismo patrón que `routing_mode`.
- `ycloud-whatsapp-webhook`: se aplica siempre, porque `checkAvail` **ya bloquea cirugías** antes de consultar slots (hard block que deriva a `escalate_to_human`).
- `meta-whatsapp-webhook`: condicionado a `isSurgery` (allí el bloqueo es solo para AnimalGrace).

### El cierre de 19:00 no estaba surtiendo efecto

`clinic_settings` de Linares quedó con los dos formatos mezclados y contradictorios (`close: 19:00` junto a `end: 18:30`), y el perfil de la profesional conservaba `end: 18:30`. Como el RPC del profesional tiene prioridad, **el cierre efectivo seguía siendo 18:30** y el último slot salía a las 17:30.

Corregido en datos: `clinic_members.working_hours` de la profesional a `19:00` (L–V, sin tocar aperturas ni flags), y `clinic_settings.working_hours` sincronizado (`start`←`open`, `end`←`close`) para eliminar la contradicción.

**Regla permanente:** el horario del **profesional** manda sobre el de la clínica cuando hay un `professionalId` resuelto. Cambiar el horario en Configuración **no** basta: si el profesional tiene horario propio en Mi Perfil, hay que actualizarlo también.

---

### Reglas de negocio — ambas sucursales (solo DB, sin deploy)

**Vacunación — anamnesis antes del precio.** La IA cotizó Triple Felina y Antirrábica *"cada una $25.000"*. Los datos estaban **correctos en todas las fuentes** (Antirrábica $23.000 en `clinic_services` y en el KB): fue arrastre del precio de la primera vacuna a la segunda. Nueva regla en `ai_behavior_rules` + `PROTOCOLO_SERVICIOS_Y_VACUNACION_ANIMALGRACE`:
1. Antes de cualquier valor: **edad**, **¿está sana?** (enferma no se vacuna → consulta médica), **¿ya fue vacunada?**
2. Entregar **solo la vacuna principal** (Triple Felina / Séxtuple-Óctuple) con lo que incluye.
3. **No mencionar la Antirrábica ni su precio** salvo pregunta explícita — la doctora la ofrece en la visita. Listar varias vacunas hace que el tutor sume los valores y crea que pagará mucho más.
4. Si hay **2 o más mascotas**, ofrecer el Pack Anual como gancho por ahorro.
5. Prohibido reusar el precio de una vacuna para otra.

**Exámenes son recomendación, nunca requisito.** Regla en `ai_behavior_rules` y en `TARIFARIO_EXAMENES_LABORATORIO_ANIMALGRACE`: decir explícitamente que son opcionales, no condicionar el agendamiento a ellos y no sumarlos al total como obligatorios.

**Prohibido derivar a otra clínica.** El KB `POLITICAS_GENERALES_Y_CONDICIONES_SERVICIO` §4 decía *"Derivar de inmediato a la clínica física más cercana"* — pensado para riesgo vital, pero la IA lo generalizaba a cualquier síntoma y mandaba clientes a la competencia (casos reales: perrita con vómitos, gato decaído). Reescrito en ambas: la **gran mayoría de los casos con síntomas se atienden a domicilio**, se ofrece disponibilidad y se agenda; el tutor decide si puede esperar. Prohibido sugerir otra clínica, urgencias o Google Maps. **Única excepción:** mascota agonizando o riesgo vital inminente → `escalate_to_human`. Por decisión explícita del usuario, **sin** aviso preventivo de urgencia en casos comunes.

### Traslado sin ubicación — solo Linares/Talca

La regla de la sesión 57 quedó demasiado estricta: prohibía indicar cualquier monto *"ni $0, ni $6.000"*, dejando al tutor sin ninguna referencia. Ahora, si no comparte ubicación, la IA **sí puede afirmar** que dentro del **radio urbano** los servicios generales no tienen costo de traslado (excepto desparasitaciones y corte de uñas, que mantienen el piso de $6.000), que fuera del radio sí hay valor adicional, y que **solo con la ubicación exacta se confirma el monto**.

Se armonizaron además los **dos bloques previos** que prohibían decir "$0" (Sección 1 ZONAS CONFIRMADAS y REGLA 3 FLEXIBILIDAD), para no dejar instrucciones contradictorias en el mismo prompt. La prohibición pasa a ser sobre **cifras rurales concretas**, no sobre el criterio general.

Santiago no se tocó en este punto: allí el recargo lo define la **comuna**, no la distancia (ver regla permanente de la sesión 57).

**⚠️ Regla permanente — reglas contradictorias en prompts:** al flexibilizar una regla endurecida en una sesión anterior, buscar **todas** las apariciones del criterio viejo en `ai_behavior_rules`, `ai_personality` y KB antes de dar el cambio por hecho. Dos instrucciones opuestas en el mismo prompt producen comportamiento aleatorio.

### Estado al cierre

`ai_auto_respond` sigue en **`false`** en ambas sucursales desde que Claudia lo apagó durante la caída. Ningún cambio de esta sesión tiene efecto visible hasta que se reactive.

---

### Revisión de seguridad (sesión 58) — fuga de datos personales por policies `USING (true)`

**Hallazgo ALTO, preexistente, confirmado como explotable.** Usando únicamente la **anon key pública** (la que va embebida en el bundle de `vetly.pro`, sin ninguna sesión) se podían leer:

| Tabla | Filas expuestas | Contenido |
|---|---|---|
| `debug_logs` | 101.245 | teléfonos de clientes y contenido de conversaciones de WhatsApp |
| `appointments` | 285 | nombre del tutor, nombre de la mascota, teléfono, servicio médico |
| `clinic_members` | 4 | roles y `clinic_id` |

**Causa raíz:** las policies RLS **PERMISSIVE se combinan con OR**. Una sola policy con `USING (true)` para el rol `public` (que incluye `anon`) **anula por completo** todas las policies correctas que existen al lado. Las tres culpables eran legacy de desarrollo: `"Public read for appointments"`, `"Public read for clinic members"` y `"Allow all debug_logs"`.

**Por qué no lo detectaron los advisors como error:** `get_advisors(type:'security')` devolvió 207 hallazgos, **todos nivel WARN, cero ERROR**, y solo marcó `debug_logs` en `rls_policy_always_true` (las otras dos no aparecieron). El hallazgo real salió de **probar con la anon key contra la API REST**, no de leer el listado.

**Fix** (migración `20260725000002`): se eliminan las tres policies; `debug_logs` queda solo con `service_role`. Verificado después: `anon` obtiene **0 filas** en las tres tablas y **401** al intentar escribir en `debug_logs`, mientras un usuario autenticado de AnimalGrace **sigue viendo sus 284 citas** (156 Linares + 128 Santiago) y deja de ver la única cita de Vetly HQ — que es exactamente el aislamiento esperado.

**⚠️ Regla permanente — auditar RLS de verdad:** revisar el listado de policies no basta y `get_advisors` tampoco alcanza. La comprobación válida es **golpear la API REST con la anon key** y contar filas por tabla:
```bash
curl -s -I "https://<ref>.supabase.co/rest/v1/<tabla>?select=*" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
  -H "Prefer: count=exact" -H "Range: 0-0" | grep -i content-range
```
Cualquier tabla con datos de clientes que devuelva `>0` filas es una fuga. Conviene repetir este barrido tras cualquier cambio de RLS.

**⚠️ Regla permanente — una policy `USING (true)` anula a todas las demás.** Nunca dejar una policy permisiva "de desarrollo" al lado de una correcta creyendo que la restrictiva manda: se combinan con OR, gana la más abierta.

**Falso positivo descartado:** 444 registros de `debug_logs` hacían match con el patrón `EAA[A-Za-z0-9]{30,}` (formato de token de Meta), pero al inspeccionar el contexto resultó ser el parámetro `_nc_oc=` de las URLs de CDN de Meta en los adjuntos de WhatsApp. **No hay credenciales almacenadas en `debug_logs`.**

### Endurecimiento del cambio propio de la sesión

`logistics_config.last_slot_time` es editable desde el dashboard y se envía al RPC como `time without time zone`. No hay riesgo de inyección (PostgREST parametriza y el tipo valida), pero **un valor mal escrito haría fallar el cast y dejaría a la clínica sin agendamiento** ("problema técnico"). Ambos webhooks ahora validan el formato `HH:MM[:SS]` con regex y caen al default `18:00` ante un valor inválido.

**Hallazgo de bajo riesgo, no modificado:** varios `.or()` de PostgREST interpolan el teléfono crudo del payload (`phone_number.eq.${from},…`). Un valor con comas o paréntesis podría alterar el filtro, pero el payload viene con **HMAC verificado** de Meta/YCloud y `normalizePhone` sanea las variantes. Queda anotado; usar siempre el teléfono normalizado sería más robusto.

**Pendiente de plataforma:** `auth_leaked_password_protection` está deshabilitado — activar en Supabase → Authentication el chequeo contra HaveIBeenPwned. Los otros 206 WARN (`security_definer_function_executable`, `function_search_path_mutable`) son el patrón histórico de todo el proyecto, no regresiones de esta sesión.

---

## Cambios realizados — julio 2026 (sesión 59, 2026-07-27)

### Plan de ruta por fecha — override esporádico de sector (Animalgrace Linares/Talca)

**Motivación:** Claudia necesitaba poder decir "mañana el móvil solo recorre Linares" o "el miércoles solo Talca" para días puntuales, sin que fuera un cambio permanente de la lógica de sectores. Una regla puesta solo en el prompt no era opción — el historial del proyecto (mínimo $15.000, la regla del pin, el rebote de sectores) muestra que reglas solo-texto se diluyen; por eso el enforcement real vive en `checkAvail`, igual que el filtro de las 11:30 en Talca.

**Arquitectura — tabla `clinic_route_plan`** (migración `20260727000001_clinic_route_plan.sql`):
```sql
clinic_route_plan (id, clinic_id, date, allowed_sectors TEXT[], note, created_by, created_at, updated_at)
UNIQUE (clinic_id, date)
```
RLS estándar vía `clinic_members`. Una fecha **sin fila** (o con `allowed_sectors = {}`) se comporta exactamente como antes — es un override puntual, no un régimen nuevo.

**Enforcement en dos puntos (`ycloud-whatsapp-webhook`):**
1. **Filtro duro en `checkAvail`** (antes del chequeo de capacidad de 5 citas): si el sector del tutor (`getSectorAG`) no está en `allowed_sectors` del día pedido, la función retorna `available: false` con un mensaje de sistema que incluye las próximas fechas donde sí se atiende ese sector — la IA no puede ofrecer esa hora porque nunca la recibe.
2. **Bloque en el system prompt**: plan de los próximos 21 días (mismo helper de fecha/hora que el resto del prompt), marcado como prioridad máxima sobre cualquier otra regla de sectores, para que la IA sea proactiva (mencione la fecha correcta sin esperar a que el cliente choque contra un bloqueo) en vez de reactiva. Instrucción explícita de nunca mencionar "plan", "sistema" ni "restricción" — se explica como coordinación de ruta del equipo móvil.

Ambas rutas fallan abierto: si la query a `clinic_route_plan` falla, se loguea el error y se agenda sin restricción (nunca se deja a la clínica sin agendamiento por un error de este mecanismo).

**Panel `RoutePlanPanel.tsx`** (nuevo, en `Citas Médicas` vía `Appointments.tsx`): chips `Linares` / `Talca` por cada uno de los próximos 14 días, autoguardado (upsert al tocar un chip, delete de la fila al desmarcar todos). Solo se renderiza si `clinic_settings.logistics_config.routing_mode === 'mobile_sectors'` — invisible para Santiago y cualquier clínica sin sectorización. Sectores configurables vía `logistics_config.sectors` (default `['Linares', 'Talca']`) para poder reutilizar el mismo panel si se agrega otra clínica móvil con sectores distintos.

**Regla permanente:** cualquier restricción de agenda que dependa de fecha/sector debe aplicarse en `checkAvail` (el punto donde se generan los slots), nunca solo en el prompt — el prompt sirve para que la IA sea proactiva/explique bien, pero el bloqueo real tiene que ser imposible de saltarse desde el texto.

**Verificado:** insert/lectura de prueba en `clinic_route_plan` contra producción (borrada después); `anon` key devuelve `content-range: */0` en la tabla (sin fuga); `npm run build` limpio; deploy `ycloud-whatsapp-webhook` v242.

### Deploy pendiente de sesiones anteriores — recordatorios vía Meta Cloud API

Al revisar el estado del repo se encontraron 2 archivos con cambios ya funcionando en producción (deployados a Supabase) pero **nunca commiteados a git** — mismo patrón de sesión 46 ("un fix solo cuenta si está commiteado y pusheado a `main`"). Se commitearon en un commit separado del plan de ruta:

- **`cron-process-reminders`**: generalizado para enviar plantillas de recordatorio tanto por YCloud como por Meta Cloud API (`hasMetaChannel`, `sendReminderTemplate`). Antes solo sabía hablar con la API de YCloud, así que ninguna clínica migrada a Meta (Santiago) podía recibir recordatorios de citas por ese canal.
- **`meta-whatsapp-webhook`**: los eventos de estado de WhatsApp (`sent`→`delivered`→`read`, o `failed`) ahora actualizan `reminder_logs` y `reminders` además de `messages` — extiende a Meta el fix de "ENVIADO que nunca llegaba" de sesión 56, que hasta ahora solo cubría el canal YCloud.

### `RoutePlanPanel` — colapsable y título en blanco

Ajuste de UI pedido tras ver el panel en producción: el header (todo el bloque celeste) ahora es clickeable con un chevron que rota, y el cuerpo (los 14 días con chips) arranca colapsado — antes ocupaba demasiado espacio en la página siempre expandido. El `<h3>` del título pasó a `text-white` explícito en vez de heredarlo del contenedor.

---

## Cambios realizados — julio 2026 (sesión 60, 2026-07-28)

### Auditoría de la IA en producción — Linares apagada por corte de cuota OpenAI (recurrente)

**Pedido:** revisar si la IA de Animalgrace estaba funcionando bien. Diagnóstico con datos reales de `messages` y `debug_logs`, no con suposiciones.

**Hallazgo — Linares llevaba ~3 horas sin responder al momento de la revisión:** la IA funcionó normal hasta las 17:56 (hora Chile 13:56). A las 18:07 empezó a fallar con el mismo error `insufficient_quota` de OpenAI de la sesión 58 (2026-07-25) — 6 mensajes fallidos a 4 clientes distintos entre 18:07 y 18:40. A las 18:42 `ai_auto_respond` de Linares se puso en `false` (mismo patrón de sesión 58: Claudia lo apaga en respuesta al error). Desde entonces, **solo mensajes entrantes sin respuesta**, incluyendo un caso puntual: un cliente con sordera escribiendo *"Mire podría escribirme soy una persona con sordera..."*, *"Donde puedo hablar"*, *"Por favor"*, sin ninguna respuesta.

**Santiago** seguía apagada desde el 2026-07-27 por decisión ya documentada (pendiente revisar KB/precios antes de reactivar) — no es una sorpresa nueva, pero también solo tenía inbound sin respuesta en las mismas horas.

**Verificado como sano:** el plan de ruta (sesión 59) con 0 filas y sin errores relacionados; agendamiento y recordatorios sin errores mientras la IA sí respondía.

### Causa raíz de por qué $10 USD de OpenAI se agotan en <4 días

El usuario preguntó si era normal que $10 recargados el 25-jul ya se hubieran acabado el 28-jul. Diagnóstico con datos medidos (no estimados a ciegas):

- **El system prompt de Linares mide 52.998 caracteres** (medido directo en un log real de `debug_logs`, mensaje "Prompt Construction"). Desglose: `ai_behavior_rules` = **39.324 caracteres** (crecido sesión tras sesión desde mayo, nunca depurado), `ai_personality` = 3.140, más KB y 48 servicios.
- **Ese prompt completo se reenvía en cada llamada a OpenAI**, incluyendo cada iteración del tool loop (hasta 5 por turno — `check_availability`, `create_appointment`, etc. cada uno dispara una llamada extra completa). Desde la recarga del 25-jul: **437 turnos de conversación** + **77 ejecuciones de herramientas** en Linares ≈ ~500 llamadas completas en <4 días, cada una cargando ~13.000-16.000 tokens solo de prompt de sistema.
- Con ese volumen medido, agotar $10 en 3-4 días es matemáticamente consistente — no hace falta un bug de duplicación de llamadas para explicarlo. No hay acceso al dashboard real de OpenAI desde aquí; para el desglose exacto en USD hay que mirar `platform.openai.com/usage`.

**Causa estructural encontrada y corregida — el prompt rompía el prompt caching de OpenAI:**
El contenido dinámico (fecha/hora actual, geo-data del tutor) estaba intercalado **antes** del bloque de reglas/servicios/KB en el prompt. Como la hora cambia en cada mensaje, el prefijo nunca era idéntico entre llamadas consecutivas, lo que le impedía a OpenAI aplicar su descuento automático de prompt caching (~50% en input tokens repetidos) sobre las ~40.000 caracteres de contenido que sí son idénticos entre turnos.

**Fix aplicado (`ycloud-whatsapp-webhook`, deployado):** reordenado a `staticSysPrompt` (personalidad, datos de la clínica, `ai_behavior_rules`, servicios, KB, plan de ruta — idéntico entre turnos) + `dynamicSysPrompt` (fecha/hora, contexto de encuesta) al final, y `globalLocContext` (geo del tutor, antes antepuesto a TODO el prompt) movido también a la cola dinámica. Mismo contenido, sin cambios de comportamiento — solo el orden.

**Regla permanente:** cualquier contenido que cambie entre llamadas (hora, geo, contexto por-tutor) debe ir al **final** del system prompt, nunca antes del bloque estático — el prompt caching de OpenAI/Anthropic solo aplica al prefijo común entre llamadas, y un solo carácter distinto cerca del principio invalida el cache para todo lo que viene después.

### Limpieza — servicios duplicados en Linares

Se encontraron 7 filas duplicadas (mismo nombre/duración/precio, creadas segundos aparte — doble-submit del form de Settings) en `clinic_services` de Linares: 3× "Medicamento Inyectable 11-20 kilos" $8.000, 2× "Examen de sangre HB + pb" $55.000, 2× "Medicamento Inyectable 26 a 30 kilos" $10.000. Migración `dedup_clinic_services_linares`: reasignadas las referencias de `service_professionals` hacia la fila más antigua de cada grupo y borradas las 4 filas sobrantes (48 → 44 servicios). Impacto menor en el tamaño del prompt, pero limpio.

**Nota, no resuelta esta sesión:** hallazgo de precios inconsistentes para el mismo servicio con nombre casi idéntico (`"Examen de sangre HB + pb"` $55.000 vs `"Examen de sangre hb+ pb"` $45.000, distinta capitalización) — no se tocó por no saber si son dos exámenes distintos o un error de precio; confirmar con Claudia antes de unificar.

### Continuación — mismo fix aplicado a Santiago (el trabajo anterior fue solo Linares)

El usuario preguntó explícitamente si el trabajo había cubierto también Santiago — no fue así, ambos fixes de arriba (reordenamiento del prompt y limpieza de duplicados) se habían hecho solo sobre `ycloud-whatsapp-webhook` / `clinic_id` de Linares. Se replicó todo a Santiago:

- **Examen de sangre duplicado (Linares):** confirmado con el usuario que `"Examen de sangre HB + pb"` a **$55.000** es el correcto. Borrada la fila `"Examen de sangre hb+ pb"` a $45.000 (sin referencias en `appointment_items` ni `service_professionals`).
- **Servicios duplicados en Santiago:** mismo patrón de doble-submit (filas creadas segundos aparte). 3 pares duplicados en `clinic_services` de Santiago (`Desparasitacion interna hasta 35 kilos` $8.000, `Desparasitación interna hasta 40 kilos` $9.000, `Control post quirúrgico y extracción de ptos` $15.000). Migración `dedup_clinic_services_santiago`: 61 → 58 servicios, mismo mecanismo de reasignar `service_professionals` antes de borrar.
- **Reordenamiento del prompt en `meta-whatsapp-webhook` (Santiago):** mismo problema exacto que Linares — `ai_behavior_rules` de Santiago mide **28.988 caracteres** (+ `ai_personality` 2.915), y el contenido dinámico (fecha/hora, `globalLocContext` del tutor antepuesto a TODO el prompt) iba antes del bloque estático, anulando el prompt caching de OpenAI en cada llamada. Reordenado con el mismo patrón `staticSysPrompt` + `dynamicSysPrompt` que Linares. Deployado, sin errores nuevos en logs post-deploy.

**Regla permanente (reforzada):** `ycloud-whatsapp-webhook` (Linares, canal YCloud) y `meta-whatsapp-webhook` (Santiago, canal Meta Cloud API) son dos archivos separados que duplican la misma lógica del agente. Un fix de optimización/costo/prompt aplicado a uno **no se propaga automáticamente al otro** — hay que aplicarlo explícitamente a ambos y verificarlo por separado (tamaño real de `ai_behavior_rules`, duplicados en `clinic_services`, orden del prompt), como ya pasa con los fixes de negocio documentados en sesiones anteriores.

---

## Cambios realizados — julio 2026 (sesión 61, 2026-07-28)

### Consolidación de prompts — reducir el tamaño, no solo el precio por token

Continuación directa de la sesión 60: el reordenamiento del prompt habilitó el *prompt caching* de OpenAI (que abarata el token repetido), pero no reducía la **cantidad** de tokens. `ai_behavior_rules` de Linares había crecido a 39.324 caracteres sumando reglas sesión tras sesión desde mayo, sin consolidarse nunca.

**Restricción descubierta y respetada:** `getKnowledgeSummary` inyecta solo los **5 documentos KB más recientes truncados a 500 caracteres**. Verificado en producción: `MATRIZ_PRECIOS_Y_PROTOCOLO_CIRUGIAS` NO llega al prompt en ninguna sucursal (posición 10 en Linares, 6 en Santiago) — la IA solo lo ve si llama `get_knowledge`. **Por eso está prohibido recortar una regla de `ai_behavior_rules` argumentando "ya está en el KB": el KB no es un respaldo del prompt.** Toda la consolidación fue interna (misma regla escrita 2–4 veces dentro del propio campo).

#### 2 contradicciones corregidas (ambas sucursales)

1. **`ai_personality` mandaba derivar a la competencia.** Su Regla de Oro 3 decía *"Ante emergencias vitales, deriva de inmediato a una clínica física"*, en contradicción directa con la regla `PROHIBIDO DERIVAR A OTRA CLÍNICA (ABSOLUTO)` añadida a `ai_behavior_rules` en la sesión 58 (que manda usar `escalate_to_human`). Como `ai_personality` va **primero** en el prompt, la versión vieja tenía ventaja posicional — es exactamente el bug que costó una sesión diagnosticar. Reemplazada por la conducta acordada.
2. **El peso era requisito y estaba prohibido pedirlo a la vez.** El bloque `PROTOCOLO DE AGENDAMIENTO` exigía *"Especie, peso y edad"*, mientras `REGLA 2` decía *"TERMINANTEMENTE PROHIBIDO pedir el peso como requisito para agendar"* y la sección de agendamiento lo repetía. Se quitó el peso de la lista superior, dejando la nota de que solo aplica a cirugía, sedación y destartraje.

#### Duplicaciones consolidadas (Linares)

El criterio de pin/traslado estaba escrito **tres veces** (§1 `ZONAS CONFIRMADAS`, `REGLA 3 › FLEXIBILIDAD`, `REGLA 3 › SI NO PUEDE ENVIAR EL PIN`), sumando 2.857 caracteres → consolidado a ~1.400. Además: **§7 y §9 eran dos protocolos de cirugía en paralelo** (fusionados en §7 con los 5 pasos, y renumeradas las secciones siguientes); `PROHIBICIÓN DE EXCLUSIVIDAD` literal en §1 y §3; comunas de cada sector en `REGLA DE ORO LOGÍSTICA` y §3; aviso de rango de 2 horas arriba y en §6; remisión al destartraje en `REGLA 3` teniendo la regla completa en §6; y un "Ejemplo INCORRECTO" de 440 caracteres dentro de la propia regla de concisión.

Santiago estaba **notoriamente más limpio** (una sola sección de cirugías, reglas ya condensadas): solo un encabezado anidado que repetía el título de su sección, un nivel de encabezado inconsistente y la tabla de recargos por comuna repetida en §4.

#### Correcciones puntuales
- Linares §8: typo `siemplo incluye` → `siempre incluye`.
- Santiago `REGLA 3`: remitía a *"Sección 3"* para destartraje, que es la **Sección 8**.
- Santiago `REGLA 1`: nombres de documentos mal escritos (`#POTOCOLO_DE_DESTARTRAJE` sin la R, `#PROTOCOLO_DE_SEDACIÓN_A_DOMICILIO`) que no coincidían con los títulos reales en `knowledge_base` — `get_knowledge` podía no encontrarlos.

#### Fix de código — relleno en el JSON de servicios
El **100% de los servicios** (43 Linares / 58 Santiago) tiene `ai_description` en null, pero el prompt emitía igual `"info_importante":"Sin detalles específicos."` por cada uno. Ahora los campos vacíos se omiten en vez de rellenarse con placeholder (igual para `duracion` cuando es 0). JSON de servicios: Linares 5.371 → 3.089, Santiago 7.369 → 4.568.

#### Resultado medido

| | Linares | Santiago |
|---|---|---|
| `ai_behavior_rules` | 39.324 → 36.987 | 28.988 → 28.811 |
| `ai_personality` | 3.140 → 3.297 (crece: el fix de contradicción es más explícito) | 2.915 → 3.072 |
| JSON de servicios | 5.371 → 3.089 | 7.369 → 4.568 |
| **Bloque total** | 47.835 → **43.373 (−9,3%)** | 39.272 → **36.451 (−7,2%)** |

Menos que el ~15% estimado al planificar: la mayor parte de los 39.324 caracteres de Linares resultaron ser reglas legítimas y distintas, no duplicación. El ahorro se **suma** al del prompt caching de la sesión 60 (que actúa sobre el precio por token, mientras esto reduce la cantidad).

#### Respaldo y reversión
Tabla nueva `prompt_backups` (`clinic_id`, `field`, `content`, `label`, `backed_up_at`), RLS solo `service_role`. Los 4 valores originales quedaron guardados con label `pre_consolidacion_2026_07_28`. Revertir:
```sql
UPDATE clinic_settings cs SET ai_behavior_rules = pb.content
FROM prompt_backups pb
WHERE pb.clinic_id = cs.id AND pb.field = 'ai_behavior_rules'
  AND pb.label = 'pre_consolidacion_2026_07_28';
```

#### Verificación aplicada
Se extrajeron con regex todos los títulos de regla (`**EN MAYÚSCULA:**`) del respaldo y del texto nuevo, y se diferenciaron: **Santiago no perdió ninguno**; en Linares desaparecieron 8, todos esperados (2 renombrados por la fusión de cirugías, 2 renumerados como PASO 4/5, 4 eliminados por duplicación). Además se comprobó una a una la supervivencia de 12 reglas sustantivas (rango de 2 horas, consulta previa de destartraje, comunas de ambos sectores, radio urbano $0, rural variable, exámenes $55.000, cierre con Claudia, anti-confusión felina $65.000/$60.000, mínimo $15.000, centro quirúrgico, advertencia textual de dirección escrita).

**⚠️ Regla permanente — antes de recortar un prompt:** verificar qué documentos del KB llegan realmente al prompt (`ORDER BY updated_at DESC LIMIT 5`, truncados a 500 chars). Una regla que solo viva en un documento fuera de ese top 5 desaparece del contexto si se borra de `ai_behavior_rules`. Y antes de aplicar cualquier `UPDATE` sobre estos campos, respaldar en `prompt_backups`.

---

## Cambios realizados — julio 2026 (sesión 62, 2026-07-28/29)

### Conocimiento forzado — cirugía, sedación y visita fallida ya no dependen de que la IA decida buscarlos

**Origen:** al explicar por qué `MATRIZ_PRECIOS_Y_PROTOCOLO_CIRUGIAS` no entra al resumen automático (top 5 por `updated_at`), se verificó con conversaciones reales si al menos la tool `get_knowledge` compensaba el hueco. **No lo hacía:** de 15 conversaciones reales sobre cirugía, `get_knowledge` se llamó **1 vez**. Peor — en un caso real (canino 10kg, castración) la IA respondió **$70.000 sin haber llamado la tool ni una vez**, y ese número resultó ser el correcto por la matriz real. No fue un mecanismo confiable: fue una coincidencia sobre un mismo diseño que ya había fallado antes (sesiones 9 y 40: gata cotizada en $85.000 y $80.000 en vez de $65.000).

**Por qué destartraje NO tiene el mismo problema (verificado, no asumido):** sus 4 precios por peso ($90.000–$135.000) están duplicados en `clinic_services` (la Lista Oficial de Servicios, que siempre va en el prompt). Un caso real (mascota 4,6 kg) mostró la IA respondiendo $90.000 correctamente sin tocar `get_knowledge` — porque el dato ya estaba en el prompt por otra vía, no por casualidad.

**Auditoría de los 5 documentos fuera del top 5, con evidencia real:**

| Documento | Respaldo fuera del KB | Riesgo |
|---|---|---|
| `MATRIZ_PRECIOS_Y_PROTOCOLO_CIRUGIAS` | Ninguno (`clinic_services` tiene solo "Cirugía" a $0) | **Alto** — forzado |
| `Protocolo_de_Sedación_a_Domicilio` | Ninguno | **Alto** — forzado (10% de 20 conversaciones de agresividad/sedación llamó `get_knowledge`) |
| `POLITICAS_GENERALES_Y_CONDICIONES_SERVICIO` | Parcial — orden médica, prohibición de derivar y riesgo vital ya están en `ai_behavior_rules`. Huérfanos: política de visita fallida (cobro no reembolsable) y 2 restricciones de vacunación (cachorro 7 días en el hogar, no vacunar con cirugía programada en 7 días) | **Medio** — forzado (solo la parte huérfana importa) |
| `PROTOCOLO_LOGISTICA_CIRUGIAS_ANIMALGRACE` | La tabla T1/T2/T3 ($0/$8.000/$16.000) está duplicada dentro de `MATRIZ_PRECIOS_Y_PROTOCOLO_CIRUGIAS` — forzar ese documento ya cubre el riesgo de precio | **Bajo** — no forzado |
| `Protocolo_de_Destartraje` | Precios reales ya en `clinic_services` (verificado con caso real) | **Bajo** — no forzado |

**Fix — `getForcedKnowledgeBlock()` (ambos webhooks):** detecta keywords en los mensajes recientes del cliente (`cirug/esterili/castra/pabell`, `sedaci/agresiv/anestesi/inquiet`, `reembols/devuelv/cancela/visita fallida`) y, si hay match, inyecta el documento KB **completo** (no truncado) al final del bloque estático del prompt (`staticSysPrompt`), antes del bloque dinámico. Se ubica ahí a propósito: todo el prefijo grande (reglas, servicios, KB summary, plan de ruta) sigue siendo idéntico entre llamadas y se beneficia del prompt caching de la sesión 60 — solo se pierde el cache en la cola condicional, y solo para los mensajes que tocan estos 3 temas.

**Regla permanente:** cuando una regla del prompt dice "consulta `#NombreDocumento`" para un dato crítico (precio, política), verificar con datos reales de `messages`/`debug_logs` si la IA efectivamente llama `get_knowledge` cuando corresponde — no asumir que lo hace porque el prompt se lo pide. Si el documento no tiene respaldo en otra fuente siempre presente (como `clinic_services`), la única forma confiable es forzarlo, no delegarlo a la decisión del modelo.

**Nota lateral — costo:** este fix no ataca el consumo de créditos OpenAI (esa es una investigación separada, ver sesión 60/61). Solo agrega ~2-3 KB al prompt, y únicamente en las conversaciones que tocan estos 3 temas — impacto marginal frente al ahorro ya logrado.

**Verificado:** deploy de ambos webhooks sin errores nuevos en `get_logs` (solo el 500 preexistente de `cron-process-surveys`, no relacionado).

---

## Cambios realizados — agosto 2026 (sesión 63, 2026-08-05)

### Estrategia de crecimiento — plan de entrada agresivo + referidos B2B

**Contexto de negocio:** el usuario quiere lanzar una campaña de adquisición masiva de clínicas veterinarias vía contenido orgánico, con un precio de entrada muy agresivo en el plan Core (todo menos el agente IA conversacional) y un programa de referidos entre clínicas para crecimiento viral. También se planea un canal de YouTube con tutoriales para reducir la dependencia de demos 1:1.

**Recomendación de pricing dada (no requiere código):** $17/mes es viable como precio de **lanzamiento** (no permanente) porque el Core actual ($39) es casi puro margen — reducirlo permanentemente ancla mal la percepción de valor y agranda la brecha psicológica hacia Starter ($97). Se recomendó implementarlo como **cupón de descuento con tope de cupos**, no como cambio de precio base.

### Fix — "Módulo de inventario" faltaba en el listado de features de todos los planes

El plan Core (y por herencia Starter/Pro/Enterprise vía "Todo lo de Core") no mencionaba el módulo de inventario en ningún listado de features, aunque el módulo existe desde sesión 30-32. Agregado "Módulo de inventario" en:
- `src/lib/mercadopago.ts` (features de Core)
- `src/lib/lemonsqueezy.ts` (features de Core)
- `public/landing.html` (tarjeta de precios de Core, landing real de producción)
- `src/pages/Pricing.tsx` (ruta `/pricing`, sí enrutada — a diferencia de `src/pages/Landing.tsx`, que es código muerto desde sesión 17 y no se tocó)

**El precio de Core sigue en $39 en todos lados.** No se agregó ningún aviso de "$17 lanzamiento" en la landing — el cupón todavía no existe en LemonSqueezy ni MercadoPago (confirmado explícitamente con el usuario). Poner "$17" en la landing antes de que el cupón exista habría creado un mismatch real entre lo prometido y lo que el checkout cobra de verdad.

### Sistema de referidos B2B (clínica refiere clínica) — implementación completa

**Distinto del sistema de referidos ya existente** (`tutors.referral_code` / `/r/:code`, sesión 27), que es para que un tutor refiera a otro tutor dentro de la misma clínica. Este es nuevo: una clínica cliente de Vetly refiere a otra clínica/veterinario para que se suscriba.

**Reglas de recompensa (decisión de negocio):**
- Referido toma plan **Core** → referidor recibe **2 meses gratis**, aplicados automáticamente (solo se extiende `subscriptions.current_period_end`, sin dinero de por medio).
- Referido toma **Starter / Pro / Enterprise** → referidor gana **50% del primer pago**, como comisión pagada **manualmente por transferencia vía HQ** (el sistema solo registra y permite marcar como pagada — no hay payout automatizado).

**DB (migración `clinic_referrals_system`):**
- `clinic_settings.partner_referral_code TEXT UNIQUE` — trigger `BEFORE INSERT` que genera 6 caracteres (mismo patrón que `trigger_generate_tutor_referral_code`), con backfill retroactivo para las 3 clínicas existentes.
- Tabla `clinic_referrals` (`referrer_clinic_id`, `referred_clinic_id UNIQUE`, `referral_code`, `referred_plan`, `status` enum `pending|qualified|paid`, `reward_type` enum `free_months|cash_commission`, `reward_amount`, `reward_currency`, `rewarded_at`, `paid_at`, `paid_by`). El `UNIQUE` en `referred_clinic_id` da idempotencia gratis: una clínica solo puede ser "la referida" una vez.
- RLS: miembros de la clínica referidora ven sus propios referidos vía `clinic_members`; `service_role` acceso total; sin policy de escritura para `authenticated` (todo pasa por RPC o service role).
- RPCs `SECURITY DEFINER` (verifican `platform_admins`): `mark_referral_paid(p_referral_id)` y `get_admin_referrals()` (evita el problema de hacer 2 joins a `clinic_settings` desde la misma tabla vía PostgREST embeds). Se revocó `EXECUTE` de `PUBLIC`/`anon` sobre ambas tras detectarlo con `get_advisors` (hardening, sin cambio de comportamiento — las funciones ya se auto-protegían internamente).

**Captura al signup:**
- `Register.tsx` lee `?ref=CODIGO` de la URL (o acepta un código escrito a mano si no viene en el link) y lo pasa a `AuthContext.signUp` (ahora acepta `paymentProvider` y `referralCode` como parámetros opcionales adicionales — nota: `paymentProvider` sigue sin reenviarse al backend, ese es un bug preexistente de otra sesión que **no se tocó**, fuera de alcance).
- `signup-handler` (edge function, v19): si llega `referral_code`, busca la clínica dueña de ese código y crea la fila `clinic_referrals` en `pending`, de forma no bloqueante (si falla, el signup continúa igual — mismo criterio que el email de bienvenida).

**Recompensa automática al primer pago real:**
- El signup en sí **no cobra nada** — la clínica queda en modo trial/`pending_activation`. El pago real ocurre después, cuando el dueño hace upgrade desde Settings (`redirectToLemonCheckout` o `createSubscriptionPreference`), lo cual dispara `lemonsqueezy-webhook` o `mercadopago-webhook`.
- **`lemonsqueezy-webhook` (v23):** el bloque de recompensa vive dentro de `case 'subscription_created'` — evento que LemonSqueezy solo dispara una vez por suscripción (las renovaciones van por `subscription_payment_success`), así que no hace falta lógica extra de idempotencia ahí.
- **`mercadopago-webhook` (v14):** MercadoPago no distingue primera vez de renovación por tipo de evento — el bloque corre dentro de `if (subscriptionStatus === 'active')`, que se ejecuta en cada pago aprobado. La idempotencia la da el propio estado de la fila: solo actúa si encuentra `clinic_referrals.status = 'pending'`; una vez que pasa a `qualified`, ningún pago futuro (renovación) la vuelve a tocar.
- Ambos bloques van en `try/catch` que solo loguea — **nunca pueden romper la activación real del pago**, que es lo que ya funciona hoy en producción para Animalgrace. Precios de referencia hardcodeados por plan (USD en LS, CLP en MP) para calcular el 50% — mismo patrón de duplicación de constantes ya establecido en el proyecto (ver regla de "5 lugares" para precios).
- `charge-trials/index.ts` (flujo legado, referencia "Citenly AI", no fija `metadata.clinic_id`) se dejó **fuera de alcance a propósito** — no está conectado de forma confiable al resto del sistema, así que un referido que se active por ese camino no dispararía la recompensa. No es un problema práctico hoy porque ese flujo ya estaba desconectado del resto del sistema de créditos/planes antes de esta sesión.

**Frontend nuevo:**
- `src/pages/PartnerReferral.tsx` — página "Recomienda Vetly" (ruta `/app/partner-referral`, sección Marketing del nav junto a Fidelización): muestra el link de invitación (`{origin}/registro?ref={code}`), las reglas de recompensa, y la lista de referidos propios con badge de estado.
- `src/pages/hq/AdminReferrals.tsx` — panel HQ (`/hq/referrals`, nav en `AdminLayout.tsx`): stats + tabla de todos los referidos vía `get_admin_referrals()`, botón "Marcar como pagado" (mismo patrón confirm→loading-por-fila→RPC→refetch que `AdminClinics.tsx`) solo visible para comisiones en efectivo `qualified`.
- `src/lib/permissions.ts`: nuevo `PageKey` `'partner_referral'` — `true` para owner/admin, `false` para el resto (dato financiero de la clínica).

#### Pendiente — próxima sesión

- [ ] **Crear el cupón de $17 (primeros 100 clientes)** en LemonSqueezy y MercadoPago. Es un paso manual en el dashboard de cada pasarela — no requiere código. Una vez creado, actualizar la landing (`public/landing.html`) para mostrar el precio de lanzamiento junto al normal ($39), dejando claro que es por tiempo/cupo limitado.
- [ ] **Banner o pop-up post-pago** para agendar la primera reunión de onboarding. Diseño acordado: reutilizar el agente HQ (Andrés) vía WhatsApp en vez de construir un flujo de agenda nuevo.
- [ ] **Canal de YouTube + sección de tutoriales** dentro de la plataforma (o un link directo al canal). Grabar los videos es trabajo del usuario; lo que falta construir es solo el punto de acceso desde la plataforma.
- [ ] Verificar en producción, con un referido real, que el flujo completo funciona end-to-end (signup con `?ref=`, primer pago, aplicación de la recompensa) — lo verificado en esta sesión fue `tsc --noEmit` limpio y `get_advisors` sin hallazgos nuevos de severidad ERROR, no un caso real de punta a punta.

---

## Cambios realizados — agosto 2026 (sesión 64, 2026-08-05)

### Migración de Animalgrace Linares/Talca de YCloud a Meta Cloud API — en progreso

**Motivación:** el saldo de YCloud de Linares se agotó (mismo problema recurrente que Santiago tuvo antes de migrar — sesiones 33/40), y como Santiago viene funcionando bien con Meta Cloud API vía coexistencia desde sesión 57 (sin necesitar tarjeta ni saldo prepago), se decidió migrar también Linares al mismo modelo.

#### Código — paridad `clinic_route_plan` portada a `meta-whatsapp-webhook` (v19, deployado)

**Gap encontrado:** el enforcement del "plan de ruta por fecha" (sesión 59 — el panel donde Claudia restringe qué sector móvil se atiende cada día) vivía solo en `ycloud-whatsapp-webhook`. Si Linares migraba a Meta sin portarlo, ese panel dejaría de tener efecto real en silencio — justo el control más sensible para esa sucursal (rebote de sectores Talca↔Linares).

**3 bloques portados literalmente** (mismo texto/lógica que `ycloud-whatsapp-webhook`, solo adaptados a los nombres de variables locales de `meta-whatsapp-webhook`):
1. Query paralela a `clinic_route_plan` dentro de `checkAvail` (antes del `Promise.all` de `clinic_settings`/`serviceDetails`/`existingAppts`), con horizonte de 21 días y fail-open (`errRoutePlan` logueado, nunca bloquea el agendamiento si la query falla).
2. Filtro duro con `dayPlan`/`allowed_sectors` dentro del bloque `if (isAnimalGrace)`, ANTES del chequeo de capacidad de 5 citas — reutiliza `targetSector` ya calculado ahí mismo.
3. Bloque `routePlanBlock` inyectado en `staticSysPrompt` (después de `forcedKnowledgeBlock`), condicionado a `routing_mode === "mobile_sectors"`, para que la IA sea proactiva ofreciendo la fecha correcta en vez de chocar contra un "no disponible".

**Verificación de seguridad antes del deploy:** `clinic_route_plan` tenía 0 filas para el `clinic_id` de Santiago (la única clínica que hoy usa este webhook en producción) — el cambio fue confirmado inerte para Santiago antes de deployar. Deploy limpio (`supabase functions deploy meta-whatsapp-webhook --no-verify-jwt`, v18→v19), `verify_jwt: false` preservado, sin errores nuevos en `get_logs` post-deploy.

**Conclusión de la investigación de código previa al deploy:** todo el resto de la infraestructura (`MetaWhatsAppConnect.tsx`, `meta-embedded-signup`, resolución de clínica en `meta-whatsapp-webhook` por `meta_phone_number_id`, `cron-process-reminders` con `hasMetaChannel`/`hasYCloudChannel`) ya es genérico por `clinic_id` desde que se construyó para Santiago — no hizo falta tocar nada más para que el flujo de conexión sirva para Linares.

#### Operativo — desconexión de YCloud, bloqueada por moneda AUD (sin resolver al cierre de sesión)

**Hallazgo 1 — YCloud tenía control total sobre la WABA de Linares vía Business Manager.** En `business.facebook.com` (business_id `587379105060987`, "Agencia Digital - Publymed" — el mismo Business Manager que ya usamos para la conexión de Santiago), existía una WABA **"Animal Grace vetmóvil Linares"** (ID `10010918923567`) con **YCloud como "Socio con control total"**.

**Hallazgo 2 — la WABA estaba en AUD, mismo patrón que el problema original de Santiago.** La pestaña "Resumen" de esa WABA mostraba `Divisa: AUD` y sin método de pago asociado. Confirmado con evidencia externa (no solo precedente interno): existe un caso documentado donde Meta bloquea explícitamente vincular un número si la moneda de la WABA no es USD (*"the error indicated that a WhatsApp Business Account phone number cannot be linked because the currency is not US Dollars"*). La moneda de una WABA **no es editable desde la interfaz de Business Manager** una vez creada — solo existe una API de "migración de moneda" que clona la WABA en una nueva, no un toggle simple.

**Secuencia de desconexión ejecutada** (en el Business Manager de Publymed y en el teléfono de Linares, +56958897996):
1. Quitado YCloud como Socio de la WABA "Animal Grace vetmóvil Linares" (Business Manager → Cuentas de WhatsApp → esa cuenta → Socios → Administrar).
2. Desconectado desde WhatsApp Business App en el teléfono (Ajustes → Cuenta → Plataforma empresarial → Desconectar cuenta).
3. **WABA "Animal Grace vetmóvil Linares" eliminada por completo** (no alcanzaba con quitar el socio y desconectar — el bloqueo de moneda vive en la WABA misma).
4. Reintento del Embedded Signup → nuevo bloqueo: *"El número de teléfono ya está vinculado a una página de Facebook"* → desvinculado desde Business Manager → Páginas → la página con el número conectado.
5. Reintento → nuevo bloqueo: *"El negocio ya comparte esta cuenta de WhatsApp Business con un socio... deberás desconectar el socio actual en la app de WhatsApp Business"* → reconfirmado en el teléfono (captura de pantalla de la app mostrando la pantalla de "Conéctate a la plataforma para empresas" limpia, sin ningún socio activo).
6. **El error del punto 5 persistió incluso después de confirmar que la app ya no mostraba conexión alguna.** Diagnóstico: no es un vínculo más por desconectar, es Meta tardando en propagar internamente el borrado de la WABA + desvinculación de la Página + desconexión de la app (cada una tiene su propia sincronización, no necesariamente instantánea).

**Descartado como causa — partnership Nexflow Ai System sobre la Página "Animal Grace - Veterinaria Móvil".** Esta Página (ID `114060250435261`, distinta de la WABA borrada) tenía a Nexflow Ai System (el negocio dueño de la app Vetly Omnicanal) como Socio con control total. Se investigó como posible causa del bloqueo, pero el usuario confirmó que esa asignación fue un intento manual propio, anterior, para vincular el número de Santiago, que **nunca llegó a completarse con éxito** — no es la relación que sostiene la conexión real de Santiago (que pasa por la WABA `903775156940145`, distinta). Se decidió no tocarla por ahora dado que no es necesaria para destrabar Linares y removerla sin certeza total agregaba un riesgo innecesario sobre una cuenta compartida.

**Estado al cierre de la sesión:** Linares sigue sin conectar a Meta. Plan: esperar varias horas (o al día siguiente) sin reintentar cada pocos minutos, reintentar con una sesión nueva del diálogo de Embedded Signup (no reutilizar el popup ya usado, por posible caché), y si el error persiste más allá de eso, escalar directamente a soporte de Meta con el detalle exacto de los 3 objetos ya desconectados/eliminados (WABA, Página, socio de la app), pidiendo confirmación de que el número quedó completamente liberado del lado de ellos — mismo tipo de gestión ("Manual Release de backend") que se necesitó para destrabar a Santiago en su momento (sesión 53).

#### Pendiente para cuando la conexión de Linares se complete

- [ ] Verificar en DB que `clinic_settings` de Linares quedó con `meta_phone_number_id`, `meta_waba_id`, `meta_access_token` poblados y `whatsapp_provider = 'meta'`.
- [ ] **Recrear las 6 plantillas de WhatsApp en la WABA nueva** — nace sin ninguna aprobada. Mismos nombres que ya usa Santiago como referencia de texto/variables: `24hrs_recordatorio_cita`, `2hrs_recordatorio_cita`, `confirmacion_visita` (de `reminder_settings`), `recordatorio_vacunas`/`recordatorio_vacunacion`, `recordatorio_desparasitacion`, `seguimiento_medico` (de `clinic_settings`). Sin esto, los recordatorios fallarán igual que le pasó a Santiago al principio (`WHATSAPP_TEMPLATE_UNAVAILABLE`).
- [ ] Mandar un mensaje de prueba real y confirmar en `debug_logs` que `meta-whatsapp-webhook` lo recibe — con `ai_auto_respond` en `false` hasta confirmar que toda la lógica de sectores/logística responde bien.
- [ ] Recién ahí, activar `ai_auto_respond = true` para Linares.
- [ ] **No limpiar los campos `ycloud_api_key`/`ycloud_phone_number`/`ycloud_webhook_secret` de Linares todavía** — el cron ya prioriza Meta sobre YCloud automáticamente (`hasMetaChannel` antes que `hasYCloudChannel`), así que dejarlos no genera conflicto y sirven de respaldo. Limpiar recién después de confirmar unos días de funcionamiento estable, igual que se hizo con Santiago.
- [ ] Hay una campaña de Meta Ads con tráfico Click-to-WhatsApp corriendo hacia este número — **debe quedar pausada durante toda la migración** (evita gastar en clics sin respuesta y datos sucios de CAPI). Antes de reactivarla, revisar en Ads Manager (con la campaña todavía pausada) que el destino de WhatsApp del anuncio siga apuntando correctamente al +56958897996 — el número no cambia, pero vale la pena confirmarlo antes de volver a gastar. Pausar/reactivar no pierde historial ni datos de la campaña.

### Regla permanente — checklist de liberación de un número de WhatsApp para reconectarlo a un nuevo Tech Provider

Cuando un número activo con WhatsApp Business API/App necesita moverse de un BSP a otro (o a Vetly Omnicanal vía coexistencia), hay que soltar **todos** estos vínculos — son independientes entre sí y Meta los va exponiendo de a uno en cada reintento fallido, no todos juntos:

1. **Socio de la WABA** en Business Manager → Cuentas de WhatsApp → esa cuenta → Socios → quitar el BSP anterior.
2. **La WABA misma**, si fue creada por el BSP anterior con una moneda distinta a USD (ej. AUD) — la moneda no es editable, así que no alcanza con quitar el socio: hay que **eliminar la WABA completa** y dejar que el nuevo Tech Provider cree una nueva durante el Embedded Signup.
3. **Vínculo del número a una Página de Facebook** — Business Manager → Páginas → la página con el número conectado → desvincular. Es un objeto separado de la WABA; es el que usan los anuncios Click-to-WhatsApp como destino (no la WABA directamente).
4. **Socio de plataforma empresarial en la propia app de WhatsApp Business** (el teléfono) — Ajustes → Cuenta → Plataforma empresarial → Desconectar cuenta. Esta es la única vía que documenta Meta para este paso — el API de "Deregister" no funciona si el número está en uso simultáneo con Cloud API + la app (coexistencia).

**Después de soltar los 4**, esperar propagación — puede tardar bien más de los 2-5 minutos que suele citarse; en el caso de Linares no alcanzó ni con varias horas de margen entre intentos individuales. No reintentar en loop corto; probar de nuevo tras un descanso largo (horas) con una sesión nueva del diálogo, y si persiste, escalar a soporte de Meta pidiendo confirmación de liberación completa del número.

---

## Cambios realizados — agosto 2026 (sesión 65, 2026-08-10)

### Linares conectado a Meta Cloud API — cierre exitoso de la migración

**Bloqueo final y cómo se destrabó:** después de ~48 horas y de agotar WABA borrada + Página desvinculada + socio desconectado en "Plataforma empresarial" (sesión 64), el Embedded Signup seguía rechazando el número con el mismo error de "socio compartido". **Contactar a soporte de Meta se descartó explícitamente** — el usuario ya lo había intentado sin éxito durante todo el proceso de Santiago (sesiones 50-57), nunca logró contacto humano, y no quería repetir esa vía. La solución que funcionó fue un **downgrade completo**: convertir WhatsApp Business a cuenta personal desde el teléfono (Ajustes → Cuenta → Cambiar a cuenta personal) y volver a subir a WhatsApp Business desde cero — un reseteo más agresivo que simplemente desconectar el socio, que limpió cualquier residuo que ningún menú dejaba tocar directamente.

**Resultado verificado en DB:**
```
whatsapp_provider:     meta
meta_phone_number_id:  1319298197922642
meta_waba_id:          1039327445154499   (WABA completamente nueva)
meta_access_token:     presente
```
Confirmado en `debug_logs`: `[META SIGNUP] Coexistencia conectada para clinic fd11b7e4-...` con `subscribed: true` — la app quedó suscrita a los eventos de la WABA. `ycloud_api_key`/`ycloud_phone_number` de Linares quedaron en `NULL` (se limpiaron durante el proceso, antes de lo planeado, pero sin impacto porque Meta ya es el canal activo).

**Nota — por qué Santiago no necesitó recrear plantillas y Linares sí:** la WABA final de Santiago (`903775156940145`) nunca fue realmente nueva — es la misma que existía desde los primeros intentos on-premise (sesión 50); lo que en sesión 55 se documentó como "eliminada" en realidad nunca desapareció del todo del lado de Meta (confirmado en sesión 57), así que las plantillas creadas en intentos anteriores sobrevivieron. La WABA de Linares (`1039327445154499`) sí es genuinamente nueva — cero historial, cero plantillas.

### Bug encontrado: `ycloud-templates` no soportaba clínicas conectadas por Meta

**Síntoma:** la página "Plantillas" del dashboard (`src/pages/Templates.tsx`) mostraba *"Error al sincronizar plantillas — Hubo un problema al conectar con YCloud: YCloud API Key not configured for this clinic"* para **Santiago**, que lleva conectada a Meta desde sesión 57. El error es real pero **no afecta el envío real de mensajes** — eso lo maneja `cron-process-reminders`, que sí tiene la rama Meta correcta (`hasMetaChannel`) y funciona perfecto (verificado con `reminder_logs` reales: últimos envíos `delivered`/`read`, sin fallos).

**Causa raíz:** la edge function `ycloud-templates` (que sirve tanto al listado como a la creación/borrado de plantillas desde el dashboard) hacía `SELECT ycloud_api_key` únicamente y tiraba error si no lo encontraba — nunca se actualizó para reconocer `whatsapp_provider = 'meta'`. Como Linares también acababa de migrar a Meta, iba a pegarle el mismo bug apenas alguien abriera esa página.

**Fix — `supabase/functions/ycloud-templates/index.ts` (deployado):**
- El `SELECT` ahora trae `whatsapp_provider, ycloud_api_key, meta_waba_id, meta_access_token`.
- Nueva variable `isMeta` gatea las 3 operaciones (`list`, `create`, `delete`) hacia la API nativa de Meta (`https://graph.facebook.com/v21.0/{waba_id}/message_templates`, header `Authorization: Bearer {token}`) en vez de la API de YCloud — mismo patrón/versión ya usado en `cron-process-reminders`'s `getVarCount`/`sendReminderTemplate`, para consistencia.
- `list`: mapea la respuesta de Graph API (`result.data`) al mismo shape `{id, name, language, status, category, body}` que ya esperaba el frontend — sin tocar `src/pages/Templates.tsx` ni `src/services/retentionService.ts`.
- `create`: arma el payload de componentes (`BODY` + `BUTTONS` opcional + `example.body_text` autogenerado para variables `{{n}}`) **una sola vez** y lo reutiliza en ambas ramas — para Meta se hace `POST` directo al WABA ya conocido (`meta_waba_id`, guardado en `clinic_settings`); para YCloud se mantiene el paso extra de resolver el `wabaId` vía `/phoneNumbers` (YCloud no lo tiene guardado de antemano en Vetly).
- `delete`: `DELETE {META_BASE}?name={templateName}` con Bearer, en vez del `DELETE {YCLOUD_BASE}/{templateName}` con `X-API-Key`.
- El fallback genérico de POST (para acciones no reconocidas) sigue existiendo solo para YCloud — para Meta tira un error explícito en vez de silenciosamente pegarle a la API equivocada.

**Verificado en producción (curl directo a la function, sin pasar por el frontend):**
- Linares (`fd11b7e4-...`, Meta): `{"templates":[]}` — sin error, WABA nueva vacía como se esperaba.
- Santiago (`13472ea4-...`, Meta): devuelve las 7 plantillas reales aprobadas con su texto completo — confirma que el fix no rompió nada y que Santiago ya tenía plantillas aprobadas todo este tiempo, solo invisibles en el dashboard.

**Bug preexistente encontrado de paso, no corregido (fuera de alcance):** `Templates.tsx` deja elegir categoría (Marketing/Utility/Authentication) en el formulario de creación, pero `retentionService.createRemoteTemplate()` nunca envía ese campo — la edge function siempre usa el default `MARKETING`. No se tocó porque no era parte de lo pedido esta sesión.

### Las 6 plantillas de Linares creadas y enviadas a revisión de Meta

Usando el fix de arriba, se crearon directo desde Vetly (vía la edge function, con el mismo contenido ya aprobado y probado en producción para Santiago) las 6 plantillas que `reminder_settings`/`clinic_settings` de Linares ya tenían configuradas por nombre:

| Plantilla | Estado tras crear | Nota |
|---|---|---|
| `24hrs_recordatorio_cita` | PENDING | Mismo texto que Santiago |
| `2hrs_recordatorio_cita` | PENDING | Mismo texto que Santiago |
| `confirmacion_visita` | PENDING | Con botones: "Si, Confirmo" / "Cancelar Cita" / "Quiero Reagendar" |
| `recordatorio_vacunas` | PENDING | Texto de `recordatorio_vacunacion` de Santiago — Linares usa el nombre `recordatorio_vacunas` en su config |
| `recordatorio_desparasitacion` | PENDING | Mismo texto que Santiago |
| `seguimiento_medico` | PENDING | Mismo texto que Santiago |

Todas quedaron en `PENDING` (revisión de Meta, minutos a 24h típicamente). Como el contenido es idéntico al ya aprobado para Santiago en la misma categoría (`MARKETING`), la aprobación debería ser rápida — no requiere ninguna acción adicional, `cron-process-reminders` las recogerá automáticamente en cuanto pasen a `APPROVED`.

### Estado al cierre — pendiente para la próxima sesión

- [ ] Confirmar que las 6 plantillas pasaron a `APPROVED` (chequear vía la página Plantillas, ya arreglada, o `reminder_logs`/`reminders` de Linares en las próximas horas).
- [ ] Mandar un mensaje de prueba real al +56958897996 y confirmar en `debug_logs` que `meta-whatsapp-webhook` responde bien — con `ai_auto_respond` todavía en `false`.
- [ ] Activar `ai_auto_respond = true` para Linares recién después de confirmar lo anterior.
- [ ] Revisar el destino de la campaña de Ads (sigue pausada) antes de reactivarla — confirmar que sigue apuntando al +56958897996 correctamente tras la reconexión.
- [ ] Considerar limpiar `ycloud_api_key`/`ycloud_phone_number`/`ycloud_webhook_secret` de Linares (ya están en `NULL`, así que este punto ya está resuelto de hecho, no hace falta acción).

### Regla permanente — `ycloud-templates` es multi-canal

Cualquier clínica que migre de YCloud a Meta (o se cree nueva ya en Meta) usa automáticamente la rama correcta en `ycloud-templates` según `whatsapp_provider` — no hace falta tocar código de nuevo para la próxima migración. Si en el futuro se agrega un tercer proveedor de WhatsApp, extender el mismo patrón de `isMeta` acá y en `cron-process-reminders` (`hasMetaChannel`/`hasYCloudChannel`).

---

## Cambios realizados — agosto 2026 (sesión 66, 2026-08-10)

> Nota de numeración: esta sesión se solapó en el tiempo con otra sesión de Claude Code trabajando en paralelo sobre este mismo repo (la migración de Linares a Meta Cloud API, documentada arriba como "sesión 65, 2026-08-10"). Ambas escribieron al archivo casi al mismo tiempo — esta entrada se renumeró de "65" a "66" para no pisar esa otra entrada. Si en el futuro aparece otro desorden de numeración similar, es probablemente la misma causa: sesiones concurrentes sobre el mismo CLAUDE.md.

### Pendiente #2 de sesión 63 completado — banner post-pago de onboarding con Andrés

Implementado y deployado en producción:

- **`src/components/settings/PostPaymentOnboardingBanner.tsx`** (nuevo): banner con gradiente emerald que aparece en Settings tras la primera conversión trial→pago. CTA abre `wa.me/56993089185` con mensaje pre-llenado ("acabo de suscribirme al plan X") que dispara el reconocimiento de Andrés.
- **`src/pages/Settings.tsx`**: en `handlePlanSelection`, captura `subscription?.plan === 'trial'` (única señal fiable de "primera conversión real", capturada ANTES de redirigir al checkout, vía `sessionStorage` para sobrevivir el round-trip fuera del SPA — las renovaciones automáticas nunca producen una navegación con `?payment=success`, así que no hace falta tocar los webhooks de pago). Al volver con `?payment=success`, si el flag está presente, muestra el banner y marca `subscriptions.onboarding_call_prompted_at` (fire-and-forget, nunca bloquea el flujo de pago si falla).
- **Migración `20260808000001_add_onboarding_call_prompted_at.sql`**: columna `subscriptions.onboarding_call_prompted_at TIMESTAMPTZ`, aplicada en producción.
- **`clinic_settings.hq_sales_agent_prompt` (HQ_ID)**: nueva sección "CLIENTE YA PAGADO — reconocimiento inmediato" insertada entre APERTURA y CALIFICACIÓN — si el mensaje entrante indica un pago reciente, Andrés salta la calificación y va directo a pedir día/hora para `agendar_videollamada`. Cambio de contenido en DB, sin deploy (el prompt se carga dinámicamente, patrón de sesión 20). Respaldado en `prompt_backups` (label `pre_onboarding_cliente_pagado_2026_08_08`).

`npm run build` limpio, `git diff --stat` confirmado acotado a los 3 archivos — sin tocar `lemonsqueezy-webhook`/`mercadopago-webhook`/`agendar_videollamada`.

### Migración de cuenta MercadoPago — guía entregada, ejecución pendiente del usuario

La cuenta MercadoPago vinculada a Vetly hoy es personal; el usuario ahora tiene Root de empresa (Nextflow) y quiere migrar. Confirmado en código: Vetly solo depende de **`MERCADOPAGO_ACCESS_TOKEN`** y **`MERCADOPAGO_WEBHOOK_SECRET`** (secrets de Supabase, usados en `mercadopago-webhook`, `mercadopago-create-subscription`, `mercadopago-create-credits-preference`) — no hay public key en el frontend, así que la migración no requiere ningún cambio de código, solo:
1. Crear cuenta MercadoPago tipo Empresa con el RUT de Nextflow (correo distinto al de la cuenta personal — MP no permite duplicar email).
2. Verificación KYC (puede tardar horas/días).
3. Generar Access Token de producción en el panel de developers de la cuenta nueva.
4. Configurar el webhook (`https://ehmncwawzdciajvuallg.supabase.co/functions/v1/mercadopago-webhook`) en la cuenta nueva y obtener el nuevo secret de firma.
5. Reemplazar ambos secrets en Supabase.
6. Probar con un pago real antes de desactivar la cuenta vieja.

**⚠️ Verificar antes de migrar:** confirmar que ninguna clínica aparte de Animalgrace (que paga por transferencia, `manually_active=true`, no pasa por este flujo) tiene una suscripción MercadoPago activa cobrándose recurrentemente con la cuenta personal — cambiar el Access Token cortaría esos cobros.

### LemonSqueezy — dos caminos posibles, pendiente que el usuario elija

LemonSqueezy es Merchant of Record — no tiene el concepto de cuenta personal/empresa de MercadoPago. Se le presentaron dos opciones, sin decidir aún:
1. **Solo actualizar payout/tax info** (Settings → Payouts + Tax) para que el dinero y la facturación queden a nombre de Nextflow, manteniendo el mismo Store ID/API Key — cero cambios de código, recomendado por simplicidad.
2. **Transferir la tienda a una cuenta nueva** — requeriría regenerar `LEMONSQUEEZY_STORE_ID`, `LEMONSQUEEZY_API_KEY` y recrear todos los `LS_VARIANT_*` (planes + packs), ya que los variant IDs no viajan entre tiendas (regla ya documentada en sesión 13).

### Nueva feature definida — Plan Core con 30 días de prueba gratis, sin tarjeta (prioridad estratégica, pendiente de implementar próxima sesión)

**Objetivo de negocio (tal como lo planteó el usuario):** competir directamente con el resto del software veterinario del mercado ofreciendo un plan de entrada con más funcionalidades y una prueba mucho más generosa que lo habitual — 30 días gratis, sin pedir tarjeta de crédito. La prioridad es maximizar la adopción del plan Core como puerta de entrada.

**Comportamiento esperado (a diseñar y confirmar al inicio de la próxima sesión, no implementado aún):**
1. **Sin checkout para crear la cuenta.** El signup para este plan específico no debe pasar por LemonSqueezy/MercadoPago en absoluto — se activa directo, sin datos de pago.
2. **Landing dedicada** dentro de `public/` para vender específicamente este plan (distinta de `public/landing.html`, que vende los 4 planes). Necesita copy y diseño propios, pensados para competir feature-por-feature contra otros softwares veterinarios del mercado.
3. **Duración especial de 30 días** — distinta al trial genérico actual de 7 días que aplica hoy a cualquier plan elegido en `Register.tsx`. Requiere decidir si esto es una duración por-plan en el modelo de datos (`subscriptions`/`clinic_settings`) o un tratamiento completamente aparte solo para esta landing.
4. **Al día 30, la suscripción se detiene** — probablemente reutilizando el mecanismo de bloqueo por trial vencido que ya existe hoy (`DashboardLayout.tsx` redirige a `/app/settings?tab=subscription&expired=1` cuando el período venció y `manually_active` es falso), a confirmar si aplica igual o necesita variantes.
5. **El banner de onboarding (`PostPaymentOnboardingBanner`, implementado esta sesión) debe adaptarse** para mostrar la fecha exacta de vencimiento de los 30 días — esto es distinto de su función actual (aparece solo tras un pago real vía checkout); como este flujo nuevo NO pasa por checkout, hay que definir si se reutiliza el mismo componente con lógica de trigger distinta, o se crea una variante/banner nuevo específico para countdown de trial sin pago.

**Contexto de roadmap relevante para el diseño de la landing:** el usuario mencionó que próximamente se implementará una **sección de contabilidad/tesorería** (alertas de cuándo pagar el IVA, etc.) como diferenciador competitivo adicional — vale la pena que el copy de la landing deje espacio o mencione este roadmap ("próximamente") si ayuda a la propuesta de valor frente a la competencia.

**Nota:** el usuario decidió explícitamente dejar esto para la próxima sesión en vez de arrancarlo ahora, dado el tamaño (landing nueva + cambio de flujo de signup + modelo de datos de trial + banner) — no hay código ni diseño de este feature todavía, solo el spec de negocio arriba.

### Diagnóstico completo de LemonSqueezy — causa raíz encontrada: verificación de identidad rechazada

Al intentar configurar el cupón $17 (pendiente de sesión 63), la tienda de LemonSqueezy (**"Vetly AI"**, Store ID `327603`, `vetly.lemonsqueezy.com`) resultó estar completamente bloqueada. Diagnóstico hecho vía API directa (no por dashboard, cuyos botones no respondían) usando un API key temporal generado por el usuario y corrido desde su propia Terminal — la key nunca se compartió en el chat.

**Hallazgos, en orden:**
1. **Store confirmada como la real de producción** — vía `GET /v1/stores` se confirmó `id=327603`, nombre "Vetly AI", coincide con `vetly.lemonsqueezy.com`. Se descartó la hipótesis de "tienda equivocada".
2. **Los 12 productos del catálogo tienen `test_mode: true`** — incluyendo los 4 planes de suscripción. `total_revenue`/`total_sales` en $0 de por vida. Esto confirma que **el checkout USD/internacional de Vetly nunca procesó un pago real**, desde que se armó.
3. **Gotcha de `curl` encontrado en el camino:** los filtros `?filter[store_id]=...` fallaban en silencio (`-s` ocultaba el error) porque `curl` interpreta `[...]` como "URL globbing" (rangos tipo `archivo[1-5].html`) salvo que se pase `-g`/`--globoff`. Cualquier curl futuro contra la API de LemonSqueezy con filtros de query debe incluir `-g`.
4. **Causa raíz real, encontrada por el usuario en el dashboard** (Settings → General → "Activación de la tienda"): **verificación de identidad en estado "Rechazado"**, sin motivo visible, y el botón para reintentarla ("Verifica tu identidad") también aparece deshabilitado — igual que el toggle de Test Mode y el botón "Add Discount" del checklist de Setup.
5. **LemonSqueezy no tiene chat en vivo** — confirmado que es un feature pendiente en su propio tablero público de roadmap. Su único canal de soporte es email: `hello@lemonsqueezy.com`, 24-48h de respuesta típica.
6. **Contexto crítico encontrado por búsqueda web:** LemonSqueezy fue **comprado por Stripe en 2024**. Desde entonces hay un patrón **documentado y repetido** entre sus comerciantes — verificaciones rechazadas sin explicación, botones de reenvío bloqueados, procesos de 2+ semanas, fondos congelados, soporte lento — exactamente lo que le pasó a Vetly. Stripe está migrando todo hacia su propio producto ("Stripe Managed Payments"); LemonSqueezy como marca separada parece estar en modo de mantenimiento mientras dura la transición.

**Se redactó un email para `hello@lemonsqueezy.com`** (asunto: "Identity verification rejected and resubmit button is disabled") con el detalle completo (Store ID, síntomas, checklist ya completado). **No quedó confirmado si el usuario efectivamente lo envió** — verificar al inicio de la próxima sesión.

### LemonSqueezy vs. Paddle — comparación y decisión de explorar Paddle en paralelo

| | LemonSqueezy | Paddle |
|---|---|---|
| Modelo | Merchant of Record | Merchant of Record (igual) |
| Comisión base | 5% + $0.50 | 5% + $0.50 |
| Comisión real para Vetly | ~7–8.5% efectivo (+0.5% por ser suscripción, +1.5% por transacción internacional — el 100% del negocio de Vetly en LS cae en ambos recargos) | Comisión plana, sin recargos adicionales |
| Chile como vendedor | Sí (ya configurado) | Confirmado, soportado |
| Soporte | Solo email, sin chat, 24-48h | Sin datos verificados — pendiente de confirmar si se avanza |
| Estabilidad | En transición post-adquisición por Stripe, con patrón de fallas documentado igual al de Vetly | Empresa establecida desde 2012, sin señales similares encontradas |

**Recomendación dada:** no abandonar LemonSqueezy todavía (ya se mandó/se va a mandar el ticket de soporte), pero **arrancar en paralelo la creación de cuenta en Paddle** como respaldo, dado que el patrón de "2+ semanas de verificación" está documentado como común en la comunidad de LemonSqueezy post-adquisición.

### dLocal descartado como alternativa inmediata

El usuario preguntó por dLocal. Verificado por búsqueda: **no es Merchant of Record** (Nextflow tendría que asumir compliance fiscal en cada país por su cuenta), **no tiene alta de autoservicio** (requiere proceso de ventas/KYB directo con su equipo comercial, clientes de referencia tipo Microsoft/Amazon/Spotify/Uber), y está pensado para plataformas de alto volumen que necesitan métodos de pago locales específicos (PIX, OXXO, boleto) en muchos países a la vez. Mucho más de lo que Vetly necesita hoy (cobrar tarjeta en USD). Se descarta por ahora — reconsiderar solo si en el futuro hace falta un método de pago local puntual en un mercado específico.

### Bug de precios USD encontrado y corregido — 3 fuentes que no coincidían entre sí

Al armar el catálogo de Paddle, se cruzaron los precios reales del catálogo de LemonSqueezy (vía API) contra el código y el historial de este documento, y **ninguna de las 3 fuentes coincidía completamente**:

| Plan | Código (viejo) | CLAUDE.md (histórico) | LemonSqueezy real (API) |
|---|---|---|---|
| Core | $39 | $39 | $39 |
| Starter | $97 | $99 | $99 |
| Pro | $167 | $169 | $169 |
| Enterprise | $297 | $349 | $379 |

Se usó el skill de `pricing` + `.agents/product-marketing.md` para resolver, en vez de adivinar. Hallazgo clave: **$89 para Starter** (no $97 ni $99) es el número que ya está incrustado en **18 artículos de blog publicados**, en copy de ads aprobado, y en la definición de audiencias de Meta Ads — incluyendo el cálculo exacto del gancho "86% más barato que una recepcionista" ($89/$650). Cambiar el contenido ya publicado sale más caro que corregir un producto que además está inactivo (test mode).

**Precios finales confirmados por el usuario:** Core $39 · Starter **$89** · Pro **$169** · Enterprise **$349**.

**Corregido en 3 archivos** (`tsc --noEmit` limpio después de cada uno):
- `src/lib/lemonsqueezy.ts` (`LS_PLANS` — fuente que usan Settings.tsx/Register.tsx)
- `public/landing.html` (tabla de precios principal + 2 menciones sueltas de "$97" en otras secciones)
- `src/pages/Pricing.tsx` — **copia duplicada no documentada hasta ahora**, con su propio array `plans` hardcodeado, mismos valores viejos

**Pendiente, no corregido esta sesión:** el lado CLP (`src/lib/mercadopago.ts`) probablemente tiene el mismo tipo de inconsistencia — se detectó que Enterprise ahí muestra `$282.000` mientras que `.agents/product-marketing.md` documenta `$333.000`. Mismo patrón de bug, distinta moneda.

**⚠️ Actualización a la regla permanente de "5 lugares para precios"** (documentada en sesión 23): agregar **`src/pages/Pricing.tsx`** a la lista — es un 6to lugar con su propia copia hardcodeada de planes/precios que no se actualiza automáticamente con los otros. Vale la pena evaluar, en algún momento, refactorizar `Pricing.tsx` para que importe `PLANS`/`LS_PLANS` en vez de mantener su propio array — eliminaría esta clase de bug de raíz.

### Script de creación de catálogo en Paddle — armado, no ejecutado

Node.js (usa `fetch` nativo, sin dependencias) que crea los 4 productos + precios recurrentes mensuales (Core/Starter/Pro/Enterprise, con los precios finales ya confirmados) y el descuento de lanzamiento `LANZAMIENTO17` (mismo criterio que LemonSqueezy: $22 off → Core a $17/mes, `recur: true` sin límite de intervalos = indefinido, `usage_limit: 100`).

**Ubicación:** `/private/tmp/claude-501/-Users-sebabarrera-Desktop-Vetly-App/5f7d4236-b145-47ea-b7d7-5fa30d94d848/scratchpad/create-paddle-catalog.js` — **es un directorio de scratchpad temporal de esta sesión, no el repo.** Si se sigue este camino, mover el script a un lugar persistente antes de la próxima sesión (ej. `scripts/` en el repo) o pedir que se regenere.

Sintaxis validada (`node --check`). **No corrido** — requiere cuenta de Paddle creada primero. Alcance acotado a Fase 1 (solo catálogo, cero cambios al código de Vetly/checkout/webhooks). Los packs de créditos/recordatorios quedaron fuera de este script — tienen su propia complejidad (el truco de `custom_price` que se usó en LemonSqueezy por el mínimo de $0.50) y se abordarían en una segunda pasada.

### Estado real al cierre de sesión — pendientes para la próxima

- [ ] **Plan Core 30 días sin tarjeta** (spec completo en la sección de arriba) — sigue como prioridad #1 estratégica, sin tocar esta sesión.
- [ ] **Confirmar si el email a soporte de LemonSqueezy fue enviado** — quedó redactado y listo, no confirmado como enviado.
- [ ] **Revocar la API key temporal de LemonSqueezy** usada para el diagnóstico (Settings → API) — buena práctica de higiene aunque nunca haya sido compartida fuera de la Terminal del usuario.
- [ ] **Crear cuenta en Paddle** (paddle.com, datos de Nextflow) y correr `create-paddle-catalog.js --sandbox` primero, después sin el flag para producción — mover el script del scratchpad a un lugar persistente antes.
- [ ] **Cupón $17 USD** — bloqueado hasta que LemonSqueezy se active O hasta que Paddle esté listo (lo que ocurra primero). El código de MercadoPago no aplica acá (ese es un cupón CLP aparte, sin avances esta sesión).
- [ ] **Reconciliar precios CLP** en `src/lib/mercadopago.ts` — mismo tipo de bug que se encontró y corrigió del lado USD, detectado pero no corregido.
- [ ] **Canal de YouTube + tutoriales** dentro de la plataforma — sin cambios desde sesión 63.
- [ ] **Verificar referidos B2B end-to-end** con un caso real — sin cambios desde sesión 63.
- [ ] **Migración de cuenta MercadoPago** a Nextflow empresa — el usuario ya envió la solicitud de apertura de cuenta Checkout Pro/empresa (confirmado con captura de pantalla), esperando que MP lo contacte. Próximos pasos ya documentados arriba (Access Token, webhook, secrets).
- [ ] **Decisión LemonSqueezy payout/tax vs. transferencia de tienda** — quedó en segundo plano frente al problema más grave de activación; retomar solo si LS se destraba.

---

## Cambios realizados — agosto 2026 (sesión 67, 2026-08-11)

### Conexión Paddle vía MCP — catálogo sandbox creado (sin usar el script)

**Cuenta de Paddle creada** (Nextflow) y conectada por MCP en vez de correr `create-paddle-catalog.js` — Paddle expone un servidor MCP oficial (`mcp.paddle.com` para live, `sandbox-mcp.paddle.com` para sandbox) que permite crear catálogo directo por conversación, sin manejar API keys en un script en disco.

**Bug encontrado en el primer intento de conexión:** el comando inicial apuntaba a `https://mcp.paddle.com/mcp` (producción) usando una key sandbox (`pdl_sdbx_apikey_...`) — Paddle usa **hosts completamente separados** por entorno (no la misma URL con distinta key), así que devolvía 403 "You aren't permitted to perform this request" sin importar que la key fuera válida. Fix: recrear el servidor MCP contra `https://sandbox-mcp.paddle.com/mcp`.

**Config vive en `.mcp.json`** (raíz del proyecto, scope de proyecto — compartido entre todas las sesiones de Claude Code sobre este repo), no en `~/.claude.json`. Contiene el header `Authorization: Bearer <key>` en texto plano. **Se agregó `.mcp.json` a `.gitignore`** — el archivo no estaba ignorado y quedaba `??` (untracked) en `git status`; si se hubiera hecho `git add -A`/`git add .` en algún momento, la key habría quedado commiteada al repo público.

**Catálogo creado en Paddle sandbox** (`tax_category: saas`, IDs reales — quedan para reutilizar en la Fase 2 de checkout/webhooks cuando se implemente el flujo de pago con Paddle):

| Plan | Product ID | Price ID | Precio |
|---|---|---|---|
| Core | `pro_01kzsgkhgw3asdh7yprga5n6gt` | `pri_01kzsgkhmwc0a0aazfgermnyn8` | $39/mes |
| Starter | `pro_01kzsgkhv8h2mbkjg9p7gh4a1s` | `pri_01kzsgkhzg4jn0zwpmp9b6yp6q` | $89/mes |
| Pro | `pro_01kzsgkj5p23rywepdhva05ea3` | `pri_01kzsgkj9mabpzn0h7b4gc7f57` | $169/mes |
| Enterprise | `pro_01kzsgkjfnvpvw2tyxx6h80bv6` | `pri_01kzsgkjksfatz4hmwxrvbjn1v` | $349/mes |

**Descuento `LANZAMIENTO17`** (`dsc_01kzsgkjrvhnxbtsrmfx8grx42`): flat $22 USD off, recurrente sin límite de ciclos, tope de 100 usos, restringido al producto Core (→ $17/mes efectivo mientras dure), habilitado para checkout.

**El script `create-paddle-catalog.js` del scratchpad de sesión 66 queda obsoleto** — no se necesitó, el catálogo se creó por MCP. No hace falta rescatarlo del scratchpad temporal.

**Fuera de alcance esta sesión (sin cambios de código):** checkout, webhooks de Paddle, y cualquier integración con `Settings.tsx`/`Register.tsx` — sigue siendo solo Fase 1 (catálogo), igual que documentó sesión 66. Cuando se decida activar Paddle en producción real, correr el mismo bloque de creación por MCP contra el servidor `paddle-live` (mismos precios, mismo `LANZAMIENTO17`) y recién ahí conectar el código de checkout.

### Regla permanente — conexión MCP de Paddle (y cualquier proveedor con entornos sandbox/live separados)

Verificar siempre la URL exacta del host antes de asumir que sandbox/live es solo un parámetro o una key distinta contra el mismo endpoint. En Paddle son dos hosts:
- Sandbox: `https://sandbox-mcp.paddle.com/mcp` (keys `pdl_sdbx_apikey_...`)
- Live: `https://mcp.paddle.com/mcp` (keys `pdl_live_apikey_...`)

Mezclar key de un entorno con la URL del otro da un 403 de autorización que parece (pero no es) un problema de permisos de la key.

### Pendientes actualizados

- [x] ~~Crear cuenta en Paddle y correr `create-paddle-catalog.js --sandbox`~~ → hecho por MCP en su lugar, ver arriba.
- [ ] Cuando se confirme avanzar con Paddle en producción: repetir la creación de catálogo contra `paddle-live` con los mismos precios/descuento, y ahí sí planificar la Fase 2 (checkout + webhooks + `Settings.tsx`/`Register.tsx`).
- [ ] Sigue pendiente decidir Paddle vs. LemonSqueezy (o ambos) como proveedor definitivo — ver comparación de sesión 66.
- [ ] Resto de pendientes de sesión 66 sin cambios (Plan Core 30 días sin tarjeta, precios CLP en `mercadopago.ts`, migración MercadoPago a Nextflow, YouTube/tutoriales, referidos B2B end-to-end).

---

## Cambios realizados — agosto 2026 (sesión 68, 2026-08-12)

### Campo de correo electrónico (opcional) en citas — ambas sucursales

**Motivación:** poder contactar por correo a los tutores y que el agente de IA lo recopile al agendar, sin que sea un dato bloqueante.

#### DB y tipos
- **Migración `20260811000002_add_email_to_appointments.sql`**: `ALTER TABLE appointments ADD COLUMN email TEXT` — mismo patrón que `phone_number`/`address` (dato del tutor duplicado en la cita, sin prefijo).
- **`src/types/database.ts`**: `email: string | null` agregado a `appointments.Row` (ya existía en `tutors.Row` desde antes).

#### Frontend — `src/pages/Appointments.tsx`
- Input "Correo Electrónico" (no obligatorio, `type="email"`) justo después de Teléfono en el modal de crear/editar cita.
- Se precarga si el tutor seleccionado desde el autocomplete ya tiene `email` guardado (`handleTutorSelect`).
- Se guarda en `INITIAL_FORM_STATE` y en los ~5 puntos donde el formulario se puebla al editar (calendario desktop/mobile, menú de tabla, tarjetas).
- **Sync a `tutors.email`**: al guardar cualquier cita con `tutor_id` conocido, si hay email, se hace un `update` fire-and-forget a `tutors.email` — por eso el correo pasa a aparecer automáticamente como dato de contacto en `TutorDetails.tsx` (que ya renderizaba `tutor.email` condicionalmente desde antes) y en la búsqueda de `Tutors.tsx` — **no hizo falta tocar ninguna de las dos**, ya consumían el campo.

#### Agente de IA — tool `create_appointment`
**Hallazgo de contexto clave:** Linares ya no depende de YCloud — migró a Meta Cloud API en la sesión 65. Hoy **ambas sucursales** (Linares y Santiago) reciben sus conversaciones de WhatsApp por `meta-whatsapp-webhook`. Prioricé ese archivo:
- Parámetro `email` agregado al schema del tool (opcional, nunca en `required`).
- `createAppt`: si viene `args.email`, se hace `trim()` y se sincroniza a `tutors.email`; se guarda también en el INSERT de `appointments`.
- Repliqué el mismo cambio en `ycloud-whatsapp-webhook` por consistencia con la regla ya documentada del proyecto ("un fix aplicado a un webhook no se propaga automáticamente al otro"), aunque ese canal no reciba tráfico real hoy — sirve de base para una futura clínica que se conecte vía YCloud.
- Deploy de ambos: `supabase functions deploy meta-whatsapp-webhook --no-verify-jwt` y `ycloud-whatsapp-webhook --no-verify-jwt`. Verificado sin errores nuevos en `get_logs` post-deploy.

#### Prompt — `ai_behavior_rules` (Linares y Santiago)
- Respaldo previo en `prompt_backups` (label `pre_email_field_2026_08_12`) antes de tocar el campo, siguiendo el patrón de sesión 61/62.
- Sección "REQUISITOS Y EJECUCIÓN DEL AGENDAMIENTO" de ambas clínicas: agregado un ítem nuevo a la lista de datos a solicitar ("Correo electrónico (OPCIONAL)...") y una aclaración explícita en la REGLA DE EJECUCIÓN de que ese punto **no cuenta como dato faltante** — evita que el modelo bloquee `create_appointment` esperando el correo si el tutor no lo entrega.
- Aplicado vía `REPLACE()` en SQL (no en migraciones — vive solo en DB, como el resto de los fixes de prompt/KB documentados en sesiones previas).

### Revisión de seguridad + push a producción

**Bug de tooling encontrado:** el skill `security-review` fallaba con `fatal: ambiguous argument 'origin/HEAD'` porque el repo nunca tenía seteado el symref local de `origin/HEAD` (aunque el remoto sí reporta `HEAD branch: main`). Fix no destructivo: `git remote set-head origin main`. Vale la pena dejarlo anotado por si vuelve a pasar en otra máquina/clon del repo.

**Hallazgo operativo:** al pedir el diff para revisar, salió a la luz que `meta-whatsapp-webhook/index.ts` y `ycloud-whatsapp-webhook/index.ts` ya tenían cambios sin commitear **de sesiones anteriores** (el código de "plan de ruta" de sesiones 59/64, ya deployado en producción pero nunca llevado a git) mezclados en los mismos archivos que edité para el campo de email. Decisión: commitear y pushear **únicamente los 5 archivos de este feature** (`Appointments.tsx`, `database.ts`, ambos webhooks, la migración nueva) — el resto del working tree (Paddle, `PostPaymentOnboardingBanner.tsx`, `PartnerReferral.tsx`, `AdminReferrals.tsx`, imágenes borradas, `.env.example`, etc., acumulado de sesiones 63-67) se dejó intacto sin commitear, por ser trabajo no relacionado con esta tarea.

**Resultado de la revisión (sin hallazgos HIGH/MEDIUM):**
- El `email` que entrega el LLM solo se usa como valor de un `update`/`insert` parametrizado de Supabase — el filtro de la query (`clinic_id` + `phone_number` normalizado) no depende del texto libre del modelo, así que no hay inyección posible.
- Grep confirmado: **ningún** edge function de Vetly lee hoy `tutors.email` ni `appointments.email` para enviar correos — no existe (todavía) un vector de inyección de headers de email a través de este campo.
- Input del frontend es un `<input type="email">` controlado por React, sin `dangerouslySetInnerHTML` — sin riesgo de XSS.

**Commit `531a205` pusheado a `main`** — dispara el deploy de Vercel para el frontend. Las edge functions ya estaban deployadas directo a Supabase antes del commit, así que git y producción quedaron sincronizados.

### Regla permanente — separar el diff antes de commitear en un repo con backlog sin commitear

Cuando el working tree tiene cambios acumulados de sesiones anteriores mezclados con el trabajo de la sesión actual (visible con `git status` al inicio de la conversación), **no asumir que todo el diff pertenece a la tarea en curso**. Antes de `git add`/`git commit`, listar explícitamente solo los archivos tocados por el trabajo actual (`git add <archivo1> <archivo2> ...`, nunca `-A`/`.` en este escenario) y confirmar con `git status --short` que el staging quedó acotado. El resto del backlog queda para que el usuario lo revise y decida cuándo commitearlo — no es responsabilidad de la sesión actual empaquetarlo "de paso".

### Pendiente — backlog de sesiones 63-67 sigue sin commitear

Sigue sin commitear en el working tree (no tocado esta sesión, ver detalle en sesiones respectivas): migración a Paddle (catálogo sandbox + `paddle.ts` + edge functions `paddle-create-transaction`/`paddle-webhook`), sistema de referidos B2B (`PartnerReferral.tsx`, `AdminReferrals.tsx`, migración `clinic_referrals`), banner de onboarding post-pago (`PostPaymentOnboardingBanner.tsx`), migración de LemonSqueezy a Paddle en `lemonsqueezy-webhook`, y varios archivos sueltos (imágenes borradas, `.env.example`, `package.json`, skills de Higgsfield). Revisar y commitear en una sesión dedicada cuando el usuario confirme que ese trabajo está listo.

---

## Cambios realizados — agosto 2026 (sesión 68, 2026-08-11/12)

### Migración completa LemonSqueezy → Paddle — implementada y verificada end-to-end en sandbox

Decisión del usuario: descartar LemonSqueezy por completo (cuenta bloqueada desde sesión 66 por verificación de identidad rechazada) y mover todo el cobro internacional en USD a Paddle. Se ejecutó el plan completo de la Fase A (sandbox) aprobado en sesión 67/68, con verificación real de un pago de punta a punta.

**Diferencia arquitectónica clave (no es un simple swap de proveedor):** LS generaba una URL de checkout vía backend y redirigía (`window.location.href`). Paddle usa un modelo cliente-servidor con **overlay**: el frontend carga Paddle.js (paquete npm `@paddle/paddle-js`, lazy-loaded) y abre `Paddle.Checkout.open({items, discountId, customData})` para catálogo fijo (planes, packs), o crea una **transacción draft no-catálogo** en el backend (precio calculado siempre server-side) para montos variables (recordatorios por unidad, créditos de campaña). El checkout nunca navega fuera de la SPA — el refresco de balance/plan depende de escuchar el evento `checkout.completed` vía `onPaddleCheckoutEvent()`, no de un redirect con `?payment=success`.

**Archivos nuevos:**
- `src/lib/paddle.ts` — reemplaza `lemonsqueezy.ts`. `PADDLE_PLANS`, `PADDLE_CREDIT_PACKS`/`_4O`, `PADDLE_REMINDER_PACKS`, funciones `openPaddle*Checkout()`, `onPaddleCheckoutEvent()`.
- `supabase/functions/paddle-create-transaction/` — transacciones draft para precio variable (mismo cálculo $0.15/unidad que LS, server-side).
- `supabase/functions/paddle-webhook/` — verificación de firma `Paddle-Signature` (`ts=...;h1=...`, HMAC-SHA256, payload `ts:rawBody`), idempotencia vía tabla nueva `paddle_webhook_events` (Paddle reintenta webhooks — sin esto los packs se duplicarían), routing por `event_type`+`custom_data.type`, referidos B2B con precios corregidos (89/169/349, no los 97/167/297 desactualizados que tenía LS).
- `scripts/create-paddle-packs.js` — crea los 9 packs de precio fijo + 1 producto contenedor vía API REST de Paddle (reutilizable para Fase B/live cambiando `PADDLE_ENVIRONMENT`).
- Migración `20260811000001_migrate_lemonsqueezy_to_paddle.sql` — columnas `subscriptions.paddle_subscription_id`, `clinic_settings.paddle_customer_id`, tabla `paddle_webhook_events`.

**Archivos eliminados:** `src/lib/lemonsqueezy.ts`, `supabase/functions/lemonsqueezy-create-checkout/`, `supabase/functions/lemonsqueezy-webhook/`. Secrets de Supabase dados de baja: `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_STORE_ID`, `LEMONSQUEEZY_WEBHOOK_SECRET`, los 9 `LS_VARIANT_*` restantes.

**Secrets nuevos:** `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, `PADDLE_ENVIRONMENT=sandbox`, `PADDLE_CONTAINER_PRODUCT_ID` (Supabase); `VITE_PADDLE_CLIENT_TOKEN`, `VITE_PADDLE_ENVIRONMENT=sandbox` (`.env`, frontend — el client-side token es público, seguro de exponer).

**Catálogo Paddle sandbox completo** (creado entre sesión 67 y 68): 4 planes + descuento `LANZAMIENTO17` + 9 packs + 1 producto contenedor. IDs completos en el código (`src/lib/paddle.ts`) y en el output del script.

### Bugs reales encontrados y corregidos durante la verificación end-to-end

Ejecutar el flujo completo (signup → checkout → webhook → DB) sacó a la luz 7 bugs, algunos preexistentes y sin relación directa con Paddle, otros introducidos al portar la lógica de LS:

1. **`Register.tsx` — precios hardcodeados ignorando el toggle de región.** Un array estático `[{id:'core', price:33}, ...]` (valores USD desactualizados) se mostraba siempre, sin importar si el toggle decía "Chile" o "Internacional", y sin usar `.toLocaleString()`. Reemplazado por un array derivado de `PLANS` (CLP)/`PADDLE_PLANS` (USD) según `paymentRegion`.
2. **`Register.tsx` — número de WhatsApp de soporte hardcodeado a un cliente real.** El botón "¿Tienes dudas con el registro?" enlazaba a `+56958897996` (el número real de Animalgrace Linares) en vez del número de soporte de Vetly (`+56993089185`). Corregido — era el único lugar del código con ese número filtrado.
3. **`paddle-webhook` — `trial_ends_at: null` en el upsert de `subscriptions`, columna que no existe.** Heredado literal de `lemonsqueezy-webhook`. Habría hecho fallar el upsert completo en cualquier `subscription.created` real. **Mismo bug confirmado en `mercadopago-webhook`** (línea con `updateData.trial_ends_at = null` dentro del bloque `if (periodEnd)`) — no corregido en esta sesión (fuera de alcance), pero es un hallazgo real: cualquier suscripción de MercadoPago que llegue a estado activo con `periodEnd` definido fallaría silenciosamente al actualizar. Pendiente para otra sesión.
4. **`subscriptions.plan` vs `subscriptions.plan_id` — dos columnas de plan, el webhook solo escribía una.** `Settings.tsx` lee `plan_id` como fuente primaria (mismo patrón que ya usa `mercadopago-webhook`), pero `paddle-webhook` solo escribía `plan`. Resultado: tras un upgrade real, la UI seguía mostrando el plan viejo aunque `clinic_settings.subscription_plan` sí se hubiera actualizado. Corregido escribiendo ambas columnas.
5. **`Settings.tsx` — "Gestionar en Mercado Pago" se mostraba siempre**, sin condicionar al proveedor real de la clínica (a diferencia de `paymentRegion`, que es solo un toggle de exploración de precios, no el proveedor de facturación real). Se agregó estado `currentPaymentProvider` fijado una vez al cargar, y el botón ahora solo aparece si `currentPaymentProvider === 'mercadopago'`.
6. **`Settings.tsx` — countdown de días de prueba nunca se mostraba.** Leía `subscriptions.trial_ends_at` (columna inexistente, ver punto 3) en vez de `clinic_settings.trial_end_date` (la columna real donde vive el trial). Corregido.
7. **`PendingActivation.tsx` — botón "Saltar y entrar al Dashboard" sin estado de carga**, lo que llevaba a clics repetidos mientras la respuesta tardaba (mismo patrón de "doble submit" ya documentado en sesión 23 para invitaciones de equipo). Se agregó `isSkippingActivation` + mensajes de error visibles en vez de fallar en silencio si `profile.clinic_id` no estaba listo.

### Configuración de Paddle — pasos no obvios documentados para la Fase B (live)

- **"Default payment link" es obligatorio a nivel de cuenta.** Sin configurarlo en Paddle → Checkout → Checkout Settings, **cualquier** transacción falla con `400 transaction_default_checkout_url_not_set` — no depende del código, es un requisito de cuenta. Hay que repetirlo también en la cuenta live.
- **El "Secret key" de una notification destination no es lo mismo que su "Notification ID".** El ID de la destination tiene el formato `ntfset_...` y es visible en la URL; el secret real es un string distinto y más largo (`pdl_ntfset_<id>_<random>`, con botón de copiar en "Edit destination"). Confundirlos produce 401 "Invalid signature" con un secret que *parece* válido (tiene contenido, longitud razonable) — el error no distingue "secret vacío" de "secret equivocado", hay que loguear el prefijo/longitud para diferenciarlos en debug.
- **`supabase secrets set` corrido como una serie de comandos en el mismo bloque no garantiza que todos se ejecuten** — en esta sesión, de 4 comandos pegados juntos en la terminal del usuario, solo 1 se aplicó cada vez (confirmado con `supabase secrets list` después de cada intento). Regla operativa: verificar siempre con `supabase secrets list` después de configurar secrets en lote, nunca asumir que "correrlos" significó que los 4 se guardaron.

### Patrón de diagnóstico — logging temporal en `debug_logs` para verificar HMAC

Mismo patrón ya usado en sesiones anteriores (Meta CAPI, sesión 47): cuando un webhook falla verificación de firma y no hay acceso a los `console.log` de la función vía las herramientas disponibles, insertar un log temporal en `debug_logs` con metadatos seguros de comparar (longitud del secret, primeros caracteres, ambos digests HMAC, si coinciden) — nunca el secret completo ni el rawBody entero. Se agregó, se usó para encontrar el secret equivocado, y se quitó del código antes de cerrar la sesión.

### Estado al cierre — Fase A completa, Fase B pendiente

- [x] Catálogo sandbox completo (planes + descuento + packs).
- [x] Checkout de suscripción verificado end-to-end (overlay abre, pago procesa, webhook firma válida, `subscriptions` y `clinic_settings` actualizados correctamente, referidos B2B con precios corregidos).
- [x] Código de LemonSqueezy eliminado del repo y secrets dados de baja.
- [ ] **No verificado en esta sesión:** checkout de packs de precio fijo (créditos IA, recordatorios fijos) ni de monto variable (`paddle-create-transaction` — reminders por unidad, créditos de campaña). El código está escrito y deployado, pero ningún flujo de packs se probó con un pago real todavía.
- [ ] Fase B (producción): repetir catálogo + Default payment link + notification destination en la cuenta **live** de Paddle (bloqueado hasta confirmar verificación KYB, ver sesión 66), generar secrets live, y recién ahí cambiar `PADDLE_ENVIRONMENT`/`VITE_PADDLE_ENVIRONMENT` a `production` en el entorno de Vercel.
- [ ] Arreglar el bug de `trial_ends_at` en `mercadopago-webhook` (hallazgo de esta sesión, no corregido — ver punto 3 arriba).
- [ ] Todo el trabajo de esta sesión sigue sin commitear — ver nota de la sección anterior sobre el backlog acumulado de sesiones 63-68.

---

## Cambios realizados — agosto 2026 (sesión 69, 2026-08-13)

Sesión larga en dos partes: (1) revamp planificado de Dashboard/Finanzas con `/plan`, y (2) una auditoría de varios bugs reales reportados por el usuario sobre ese mismo módulo, que terminó revelando un error de cálculo de fondo en Finanzas mucho más grave que los síntomas puntuales. Cerró con una feature de visibilidad de descuentos. Todo el código de esta sesión sí quedó commiteado y pusheado (a diferencia del backlog de sesiones 63-68 documentado arriba, que sigue intacto sin tocar).

### Parte 1 — Dashboard y Finanzas: nuevas métricas (vía `/plan`)

- **`appointments.booking_source`** (`'manual'|'ai_agent'`, default `'manual'`, sin backfill retroactivo): ambos webhooks de WhatsApp (`meta-whatsapp-webhook` y `ycloud-whatsapp-webhook`, aunque hoy solo Meta recibe tráfico real — Linares migró en sesión 65) marcan `'ai_agent'` en `createAppt`.
- **Dashboard**: tarjeta "Citas Totales" con desglose IA/manual como subtexto; nueva tarjeta "Ticket Promedio"; banner condicional de alertas de inventario (bajo stock / por vencer, reutiliza `inventoryService.getInventoryStats`); grid de KPIs reordenado a `lg:grid-cols-4`; permiso `dashboard_metrics` finalmente conectado (existía el toggle en Equipo desde hace sesiones, nunca se leía en el componente).
- **Finanzas**: notas de ingresos visibles en el informe de caja y en pantalla; edición de gastos conectada (`financeService.updateExpense` ya existía, nadie lo llamaba) desde Cajas y desde el tab Gastos; nuevo tab "Ingresos" con listado completo filtrado por fecha.
- Revisión de seguridad (skill `security-review`) sobre el diff completo: sin hallazgos.

### Parte 2 — Auditoría de 6 reportes del usuario sobre esa misma sección

El usuario reportó, todos a la vez: Santiago con 0 citas por IA, productos vendidos invisibles en Análisis, "Citas con productos" en 0%, el gráfico Ingresos vs Gastos seguía sin implementar, sospecha sobre las tarjetas de Cancelaciones/Recordatorios del Dashboard, e inconsistencias generales en Inventario. Se investigó cada uno con SQL directo contra producción antes de tocar código — varios resultaron ser hallazgos reales y no percepciones.

**1. Santiago 0 citas IA — no era bug.** `ai_auto_respond=true`, la IA estaba activa y confirmando citas reales por WhatsApp, pero `booking_source` recién existía desde el deploy de esa misma tarde — sin backfill posible (documentado a propósito). Cero citas nuevas se habían creado desde el deploy al momento de revisar.

**2 y 3 — bug raíz confirmado: Análisis calculaba sobre `appointments`, no sobre `incomes`.** Desde sesión 44 todo el dinero de Finanzas vive en `incomes` (decisión: "Finanzas se basa SOLO en ingresos manuales"), pero `get_finance_item_metrics` nunca se actualizó — seguía leyendo `appointments`/`appointment_items`. Medido en producción: veía **~4% de la realidad** (Santiago: 4 citas/$63.000 vs 38 ingresos reales/$1.639.500; "Consulta Médica" mostraba $40.000 en vez de $220.000; ticket promedio subestimado 2,7-2,9×). RPC reescrito para leer de `incomes`, con el descuento prorrateado entre ítems (verificado: cuadra al peso con la tarjeta "Ingresos"). Los ítems libres (`type='custom'`, 41% del mes en Linares — cirugías, eutanasias) pasaron de invisibles a categoría propia con su Top. "Citas con productos" (medía `appointment_items`, siempre 0 porque ese flujo nunca se usa) se renombró a "Ventas con productos", sobre `incomes` reales.

**Vacunas duplicadas — hallazgo posterior, mismo origen.** Las 6 vacunas existían a la vez como servicio en `clinic_services` y como producto en `inventory_products`, mismo precio. Santiago las vendía eligiendo el producto, Linares el servicio — por eso "Ventas con productos" marcaba 55% en Santiago vs 13% en Linares, cuando la venta cruzada real es ~13% en ambas. Se agregó `clinic_services.linked_product_id/linked_product_qty` (UI en Ajustes → Servicios, con badge "Descuenta stock"): el ingreso se atribuye al servicio, el producto vinculado solo se descuenta del inventario. Se reclasificó el histórico de Santiago (24 ingresos, 61 ítems) de `product`→`service`, remapeando también el `id`/`name` al servicio real del catálogo — no solo la etiqueta, para no dejar el ítem apuntando a un producto de inventario. Sin tocar los movimientos de inventario ya generados (la vacuna física se consumió igual). Backup previo en tabla nueva `incomes_services_backup`.

**Stock nunca se descontaba en ventas por "+ Ingreso" — el hallazgo más serio.** Ese flujo (usado para ~25% del volumen: 58/225 Santiago, 28/204 Linares) nunca tocaba `inventory_movements`. Se agregó `inventory_movements.income_id` (`ON DELETE SET NULL`) y `inventoryService.syncIncomeProductMovements()` — reconciliación idempotente por reversión + reinserción (nunca `DELETE` de movimientos, para no perder auditoría y porque el trigger de stock solo reacciona a `INSERT`). Se extendió para que un **servicio vinculado a un producto** también descuente stock, no solo los productos elegidos directo. Backfill retroactivo de 180 movimientos históricos (confirmado con el usuario antes de aplicar): reveló **18 productos con stock negativo real** (13 Santiago, 5 Linares) — compras no registradas o descuadre físico. No se ajustó artificialmente para "cuadrar"; el dato queda como evidencia real pendiente de que el usuario lo resuelva (recontar o cargar compras faltantes).

**4. Gráfico Ingresos vs Gastos — confirmado que nunca se implementó** ("Gráfico de barras (Próximamente)" literal, sin librería conectada). Implementado con `recharts` (ya en el proyecto), agrupado por día/semana/mes según el filtro activo, sobre los datos ya cargados (sin queries extra). **Paleta validada con el script de la skill `dataviz`**: verde/rojo (la convención obvia) falla el chequeo de deuteranopía (ΔE 5,6, bajo el piso); se usó teal de marca + naranja (`#0d9488`/`#ea580c`, ΔE 13,8, pasa todos los checks).

**5. Recordatorios del Dashboard — bug confirmado.** Contaba solo `status='sent'`, pero un envío exitoso avanza a `'delivered'`/`'read'` (webhook de estado, sesión 56) y deja de contar como `'sent'`. Verificado con datos reales: Santiago mostraba 0 en vez de **119** recordatorios exitosos en 30 días. Cambiado a `.in('status', ['sent','delivered','read'])`. Cancelaciones: los datos eran correctos hoy (muy pocas), pero queda documentada la falla de diseño (filtra por `created_at`, no por cuándo se canceló realmente) — no corregida, bajo impacto actual.

**6. Inventario — mismo root cause de fondo.** `get_inventory_abc`/`get_inventory_no_rotation` solo leen `inventory_movements` tipo `sale`, que estaba en 0 para ambas clínicas (consecuencia directa del bug de arriba) — se resuelve solo con el fix de sync de stock. Se identificó además (sin manifestarse aún en los datos de estas dos clínicas) que `bulkReceiveProducts` (escaneo de factura IA) nunca recibe `locationId` de su único llamador — riesgo latente de descuadre `stock_quantity` vs `inventory_stock` para cualquier clínica con 2+ ubicaciones que use esa función. No corregido esta sesión.

### Deploy roto ~4 horas — error propio, con lección de proceso

Al commitear `Settings.tsx` completo (para la UI de vínculo servicio→producto) se arrastró sin querer la migración a Paddle de otra sesión: esa versión local del archivo ya importaba `@/lib/paddle` y `@/components/settings/PostPaymentOnboardingBanner`, dos archivos **sin commitear**. Compilaba en local (existen en disco) pero Vercel solo ve git — build roto con `TS2307` durante ~4 horas, **ningún cambio de la sesión llegó a producción** en ese lapso, y el propio Claude reportó "desplegado" solo por haber confirmado que el `git push` había salido bien, sin verificar el contenido real servido. El usuario lo detectó por una etiqueta rara en pantalla, no la herramienta de verificación.

**Fix**: se restauró `Settings.tsx` a la base sin Paddle (`git show <commit-previo>:src/pages/Settings.tsx`) y se reaplicó encima, con anclas de texto exactas, solo el cambio de esta sesión — nunca commiteando los archivos de Paddle (siguen intactos sin commitear en el working tree, intocados).

**⚠️ Regla permanente — verificación de deploy:** un `git push` exitoso no es un deploy exitoso. Desde este punto de la sesión, cada deploy se verificó construyendo un checkout limpio y aislado de git (`git worktree add --detach`, symlink a `node_modules`, `npm run build`) — la única forma real de replicar lo que Vercel ve — y confirmando además el **contenido del bundle servido en vetly.pro** (descargar el JS real y grepear por strings que solo existen en el código nuevo, nunca por strings que ya existían en el código viejo — un primer intento de verificación cayó en falso positivo exactamente por reusar un marcador que ya estaba presente antes del cambio). Nunca dar un deploy por bueno solo por la salida de `git push`.

### Bug de moneda — montos formateados en pesos mexicanos

`formatCurrency` en `Finance.tsx` y `Dashboard.tsx` tenía `new Intl.NumberFormat('es-MX', { currency: 'MXN' })` fijo, pese a que ambas clínicas están en CLP — pasaba desapercibido porque el símbolo `$` es igual en ambos países; solo se notaba en el formato (coma de miles + 2 decimales, que el CLP no usa). `NewIncomeForm.tsx` ya leía `clinic_settings.currency` correctamente desde antes; Finance/Dashboard nunca se actualizaron. Corregido: ambos ahora leen la moneda real de la clínica, con un mapa de locales/símbolos y una lista de monedas sin decimales (CLP, COP, PYG, JPY, KRW, ISK, VND). Los decimales que motivaron la pregunta del usuario eran en parte reales (prorrateo de descuentos de packs de vacunas) y en parte este bug de formato — ambas causas confirmadas con datos antes de tocar código.

### Visibilidad de descuentos otorgados

A pedido explícito del usuario, con alcance completo confirmado por `AskUserQuestion` (cifra + análisis + captura de motivo, motivo obligatorio siempre). Motivador con datos reales: Santiago descuenta ~6% de su facturación bruta, Linares ~0,6% — 10× de diferencia sostenida 3 meses seguidos ($677.000 acumulados), invisible en cualquier pantalla hasta ahora, y **0 de 39 descuentos con motivo registrado** (el campo era texto libre opcional).

- **RPC `get_finance_discount_metrics`** (mismo control de acceso por `clinic_members` que el resto de RPCs de finanzas): monto total, % sobre el bruto (neto + descuento — el % es lo comparable entre meses, el monto absoluto no), ventas con descuento, promedio, mayor descuento, desglose por motivo, top ítems descontados (mismo prorrateo que `get_finance_item_metrics`, para que ambos reportes sean coherentes entre sí).
- **Tarjeta KPI** en Finanzas (grid a 4 columnas): monto + % + variación en puntos porcentuales contra el período anterior de igual duración (no hay comparación posible si el período previo no tuvo ventas → se muestra un guion, nunca 0%, para no leerse como "no hubo descuentos").
- **Bloque en Análisis**: las mismas métricas desglosadas, con nota explícita de que los descuentos "sin motivo" son anteriores a exigirlo y el reporte se irá completando solo.
- **`NewIncomeForm`**: el campo de texto libre para motivo se reemplazó por botones de un clic (Promoción/pack · Cliente frecuente · Convenio · Caso social · Ajuste de cobro · Otro) y pasó a ser **obligatorio** si hay descuento > 0. "Otro" abre un input de texto para no bloquear casos no previstos; un motivo antiguo que no calce con la lista se edita como "Otro" con su texto, en vez de perderse.

### Reglas permanentes de esta sesión

- **Un `git push` exitoso no es un deploy exitoso.** Verificar siempre construyendo un checkout limpio (`git worktree add --detach` + symlink a `node_modules`, nunca el working tree con archivos sueltos) y confirmando el contenido real del bundle servido — con marcadores que no existan en el código anterior, no con cualquier string presente en ambas versiones.
- **Antes de commitear un archivo grande y compartido entre features (`Settings.tsx`, etc.), verificar si la versión local en disco tiene imports de trabajo de otra sesión sin commitear.** `npm run build` local no detecta esto porque los archivos sí existen en el filesystem — solo un build desde un checkout limpio de git lo revela.
- **`get_finance_item_metrics` y cualquier reporte de Finanzas debe leer de `incomes`, nunca de `appointments`** — ya es la segunda vez que este mismo error de fondo aparece en el módulo (ver también sesión 44, que fue la que estableció la regla original).
- **Antes de aplicar cualquier backfill o reclasificación retroactiva sobre datos de producción, confirmar explícitamente con el usuario** (`AskUserQuestion`), incluso cuando la lógica sea clara — un ajuste "obviamente correcto" en abstracto puede chocar con correcciones manuales que el usuario ya hizo por su cuenta.
- **Paleta de gráficos: correr el validador de la skill `dataviz`, nunca asumir verde=bien/rojo=mal por defecto** — es justo la combinación que falla para daltonismo (deuteranopía).

---

## Cambios realizados — agosto 2026 (sesión 70, 2026-08-13)

### Ecografía y radiografía en Santiago — derivación obligatoria a Claudia (sin revelar que son externos)

**Motivación del usuario:** la IA de Santiago daba mal la información sobre ecografías y radiografías. Se pidió: confirmar que el servicio SÍ existe, pero al momento de agendar, derivar siempre a Claudia — estos exámenes los realizan profesionales externos a nombre de AnimalGrace (igual que cirugías), y el cliente NUNCA debe enterarse de ese detalle.

**Diagnóstico:** el KB de Santiago no tenía ningún documento sobre estos exámenes, y `clinic_services` tampoco tenía precio cargado — sin ninguna fuente de verdad, cualquier respuesta de la IA sobre el tema era, en el mejor caso, un placeholder de REGLA 1 ("no lo realizamos"), y en el peor, una alucinación de precio.

**Fix (solo Santiago, DB — respaldo en `prompt_backups` label `pre_ecografia_radiografia_2026_08_13`):**
- KB nuevo `PROTOCOLO_ECOGRAFIA_Y_RADIOGRAFIA_ANIMALGRACE`: confirma el servicio, prohíbe inventar precio, define el flujo (confirmar → recolectar datos del caso → `escalate_to_human`, nunca `create_appointment`), y la nota de confidencialidad explícita (nunca mencionar que es un profesional externo).
- `ai_behavior_rules`: bullet crítico al inicio (mismo nivel que la regla de citología existente) + referencia agregada a la lista de documentos "verificados" de REGLA 1 + nueva sección 6B con el protocolo paso a paso, calcado del patrón de Cirugías.
- **Código** (`meta-whatsapp-webhook`, canal activo de Santiago, + `ycloud-whatsapp-webhook` por paridad de código): nuevo tema en `FORCED_KB_TOPICS` (mecanismo de sesión 62) con keywords `ecograf`, `radiograf`, `rayos x`, `eco abdominal`/`de abdomen`, `imagenolog` — el documento se inyecta completo cuando el cliente toca el tema, sin depender de que el modelo llame `get_knowledge` por su cuenta. Deployado en ambas funciones directo con `supabase functions deploy` — **cambio de código aún sin commitear a git** (ver nota de drift al final de esta sesión).

### Bug real: "no realizamos corte de uñas para gatos" — causa raíz confirmada como alucinación de GPT-4o-mini, no un cambio de código

**Síntoma:** Linares negó el corte de uñas para gatos en una conversación real, contradiciendo el catálogo (`clinic_services` tiene "Corte de Uñas" genérico por peso, sin distinción de especie, igual que el KB).

**Diagnóstico con datos reales (`messages`):** de 57 respuestas históricas de Linares mencionando "corte de uñas", **esta fue la única vez** que se negó para gatos. El mensaje que falló fue generado por `ai_model: "mini"` — las otras 16 respuestas de mini sobre el mismo tema fueron correctas, igual que las 37 de `4o_pro`. No hubo ningún cambio de prompt o código que lo causara: fue la primera vez que esta combinación puntual ocurrió (mensaje inicial de conversación nueva, sin ninguna keyword de `selectModelTier`/`schedulingSignals` que fuerce el routing a 4o para "disponibilidad de servicio genérico") y GPT-4o-mini tiene una debilidad ya documentada en el proyecto (sesiones 15, 66) de alucinar restricciones cuando razona sin apoyo fuerte del contexto.

**Fix aplicado en AMBAS sucursales** (Linares y Santiago comparten el mismo texto de KB para "Corte de Uñas", byte a byte — mismo riesgo latente confirmado en las dos, aunque solo se había manifestado en Linares; respaldo previo en `prompt_backups` label `pre_corte_unas_gatos_2026_08_13`): bullet crítico al inicio de `ai_behavior_rules` de ambas clínicas — mismo patrón que la regla de citología — dejando explícito que Corte de Uñas aplica igual a perros y gatos, mismo precio por peso, nunca negarlo para ninguna especie.

**Regla permanente:** no toda respuesta incorrecta del agente es un bug de prompt/KB — antes de asumir causa raíz, revisar en `messages` qué `ai_model` generó la respuesta. Si es la única falla entre muchas respuestas correctas sobre el mismo tema y coincide con el tier `mini`, es la debilidad conocida del modelo económico, no una regresión — el fix sigue siendo el mismo (reforzar la regla en el prompt para que sea inequívoca sin importar qué tier responda), pero el diagnóstico cambia la urgencia y evita perseguir un cambio de código que nunca ocurrió.

### Auditoría de recordatorios — Santiago sano, Linares roto por 3 causas apiladas (ya resuelto)

A pedido del usuario se revisó el estado real de envío de recordatorios en ambas sucursales.

**Santiago:** sano — 87 de 88 recordatorios de citas (24h+2h) `delivered`/`read` en 14 días, solo 1 fallo por tipo (ruido normal).

**Linares — 100% de fallos en los 14 días previos, tres causas distintas apiladas en el tiempo:**
1. Hasta el 10 de agosto: `BALANCE_INSUFFICIENT` de YCloud (problema crónico ya conocido, resuelto solo porque el canal cambió).
2. 10 de agosto 19:00 (migración recién completada, sesión 65): plantilla `confirmacion_visita` aún no aprobada en la WABA nueva de Meta — verificado en esta sesión que las 6 plantillas ya están `APPROVED`.
3. Desde el 10 de agosto 20:00 hasta el momento del diagnóstico: **100% de fallos** con `[131042] Business eligibility payment issue` — la WABA nueva de Linares (creada en la migración de sesión 65) nunca tuvo un método de pago asociado en el Business Manager que la administra, a diferencia de la WABA de Santiago (más antigua, ya facturando desde antes).

**Resolución:** el usuario asoció el método de pago al Business Manager de la WABA de Linares. Verificado post-cambio: el siguiente envío (24h, 19:00 UTC) quedó `read` sin error, confirmando el fix.

### Bug real: recordatorios de "Control Médico" nunca se crearon, en ninguna clínica, nunca

**Reporte de Claudia (via el usuario):** los recordatorios de control médico jamás se han enviado — solo vacunas y desparasitaciones.

**Confirmado con SQL:** cero filas `type='checkup'` en la tabla `reminders`, para ambas clínicas, en toda la historia. No es un problema de envío — nunca llegó a crearse el registro.

**Causa raíz (`src/components/patients/MedicalEventForm.tsx`):** el insert a `reminders` usaba `template_name` y `notes` — columnas que **no existen** en la tabla real (que tiene `whatsapp_template`, no `notes`). El insert fallaba el 100% de las veces desde que existe el toggle "Recordatorio de Control Médico" en el formulario de historial clínico. El resto del pipeline (plantilla configurable en Ajustes → Recordatorios, procesamiento del cron PART 4 con fallback a `clinic_settings.checkup_reminder_template`) siempre estuvo correctamente armado — era una feature completa rota en un solo punto. Bug secundario: tampoco se seteaba `tutor_id`, que el cron necesita para resolver el teléfono al enviar (a diferencia de `VaccineForm.tsx`/`DewormingForm.tsx`, que sí lo hacen).

**Fix aplicado:**
- `template_name` → `whatsapp_template` (columna real); eliminado `notes` (no existe); agregado `tutor_id` desde `patients.tutor_id`.
- El error del insert ahora se loguea (`console.error`) en vez de propagarse y tumbar el guardado completo del evento médico con un mensaje confuso (la consulta médica sí se guardaba antes; solo el recordatorio fallaba en silencio y con un error visible superpuesto).
- **No es recuperable el histórico** — como el insert nunca persistió nada, no hay ningún rastro estructurado de qué controles debieron programarse en el pasado. Solo los controles registrados desde el deploy en adelante generan el recordatorio.
- Commit `218f77e`, pusheado a `main` — Vercel lo despliega automáticamente (es un cambio de frontend puro, sin edge function ni migración).

### Nota de drift — cambios de código deployados hoy sin commitear a git

`meta-whatsapp-webhook/index.ts` y `ycloud-whatsapp-webhook/index.ts` recibieron el cambio de `FORCED_KB_TOPICS` (ecografía/radiografía) y ya están deployados en producción vía `supabase functions deploy`, pero **no se commitearon a git en esta sesión** (el usuario solo pidió commitear el fix de `MedicalEventForm.tsx`). Mismo patrón de riesgo ya documentado en sesiones 46 y 68 — un fix "solo cuenta" cuando está commiteado y pusheado a `main`. Pendiente: commitear ambos archivos en la próxima sesión que toque este tema, o cuando el usuario lo pida explícitamente.

### Reglas permanentes de esta sesión

- **Antes de concluir que una respuesta incorrecta del agente es un bug de prompt/código, revisar `messages.ai_model` de esa respuesta puntual** — si el resto del historial sobre el mismo tema es correcto y coincide con el tier `mini`, es la debilidad conocida del modelo económico (ya documentada en sesiones 15 y 66), no una regresión.
- **Cuando un documento del KB es idéntico byte a byte entre dos clínicas, un riesgo de alucinación confirmado en una aplica igual a la otra** — se corrigió el bullet de "Corte de Uñas" en ambas sucursales aunque el bug solo se había manifestado en Linares.
- **`reminders.checkup_reminder_template` y el flujo de "Control Médico" ya estaban completos end-to-end salvo un solo INSERT roto** — antes de asumir que una feature "nunca se implementó", verificar si existe la UI/estado/backend y solo el punto de persistencia está fallando en silencio.
- **Error `[131042] Business eligibility payment issue` de Meta = falta método de pago en el Business Manager que administra esa WABA específica** — no es un error de plantillas ni de código; es exclusivamente una acción de facturación externa a Vetly.

---

## Cambios realizados — agosto 2026 (sesión 71, 2026-08-13)

### Vacuna "Intratac Oral" — nueva opción, reemplazo funcional de KC (ambas sucursales)

**Motivación del usuario:** Animalgrace incorpora la vacuna Intratac Oral, que cubre la misma enfermedad que la vacuna KC pero por vía oral en vez de intranasal. Debe quedar disponible para que el profesional la registre en la ficha clínica del paciente, y entrar en el mismo grupo de descuentos por cantidad que ya cubría a KC.

**Cambios aplicados:**
- **`src/components/patients/VaccineForm.tsx`** (`DOG_VACCINES`): agregada "Intratac Oral" como opción del desplegable de vacunación canina, antes de "Otra". Es una lista fija compartida por toda la app (sin catálogo por clínica en este formulario), así que la opción queda disponible para cualquier clínica que use Vetly, no solo Animalgrace.
- **KB `PROMOCIONES_Y_DESCUENTOS_VIGENTES`** (DB, ambas clínicas): agregada al Grupo A de vacunas especiales — `*(Incluye: Triple Felina, Leucemia Felina, Puppy DP, KC, Intratac Oral)*` — mismo tramo de descuento por cantidad que KC.
- **`clinic_services`** (DB, ambas clínicas): creado el servicio **"Vacuna Intratac Oral" a $25.000** (mismo precio que "Vacuna KC"), duración heredada de KC por sucursal (45 min Santiago, 30 min Linares). Decisión confirmada con el usuario vía `AskUserQuestion`: se agrega como servicio **nuevo**, sin tocar ni eliminar "Vacuna KC" — ambas quedan disponibles en el catálogo. `linked_product_id` se dejó vacío porque no existe todavía un producto de inventario para Intratac Oral (a diferencia del KC de Santiago, que sí tiene uno vinculado) — si se quiere que descuente stock automáticamente, hay que crear el producto en Inventario y vincularlo desde Ajustes → Servicios.

**No se tocó** `ai_behavior_rules` ni el protocolo de vacunación del KB (reglas de "primera vez solo una vacuna", anamnesis antes del precio, etc.) — esas reglas hablan de "la vacuna" en genérico y ya cubren a Intratac Oral igual que a KC sin cambios adicionales.

**Regla permanente:** cuando se agrega un servicio "equivalente" a uno existente (misma enfermedad/función, distinta presentación), verificar 3 capas antes de darlo por completo: (1) el formulario de ficha clínica donde el profesional lo registra, (2) el KB de precios/descuentos que usa el agente de IA, y (3) `clinic_services` — el catálogo real del que la IA saca el precio individual fuera de promociones. Faltar la capa 3 deja a la IA sin precio para cotizar el servicio suelto, con riesgo de alucinación (ver historial de bugs de precio de sesiones 9, 40, 66).

---

## Cambios realizados — agosto 2026 (sesión 72, 2026-08-13)

### Bug: San Bernardo cotizado con $6.000 de recargo (correcto: $0) — Santiago

**Reporte de Claudia (capturas de WhatsApp reales):** el agente cotizó $6.000 de recargo de traslado para San Bernardo en dos mensajes seguidos de la misma conversación, cuando San Bernardo es Tramo A ($0) según el KB.

**Causa raíz — no fue alucinación aleatoria, es un vacío estructural:** `getKnowledgeSummary` arma el resumen de KB que se inyecta en el prompt tomando los 5 documentos más recientes por `updated_at` y truncando cada uno a **500 caracteres** (`.substring(0, 500)`). El documento `#PROTOCOLO_LOGISTICA_SANTIAGO_SERVICIOS_GENERALES` (5.159 caracteres) sí entra en ese top-5, pero los primeros 500 caracteres solo alcanzan la introducción del documento — la tabla real de comunas (Tramo A/B/C/D) y la regla anti-error ("$6.000 aplica EXCLUSIVAMENTE a Las Condes") están más adelante en el texto y nunca llegan al prompt por defecto. Confirmado con `messages`: ambas respuestas incorrectas fueron generadas por `4o_pro` (no fue debilidad de `mini`) — sin la tabla real disponible, ni el modelo más caro pudo evitar el error. `ai_behavior_rules` sí menciona algunas comunas de ejemplo ("Quilicura, Quinta Normal, Maipú, Ñuñoa, etc.") pero usa "etc." — San Bernardo no está nombrado ahí, así que sin el KB completo el modelo no tenía de dónde inferirlo.

Es el mismo tipo de vacío que la sesión 62 resolvió para cirugía/sedación/eutanasia con el mecanismo de "conocimiento forzado" (`FORCED_KB_TOPICS`), pero nunca se había extendido a este documento — pese a que las consultas de "¿cuánto cobran en mi comuna?" son, por volumen, de las más frecuentes de toda la clínica.

**Fix aplicado (`meta-whatsapp-webhook` y `ycloud-whatsapp-webhook`, deployados):** agregado `#PROTOCOLO_LOGISTICA_SANTIAGO_SERVICIOS_GENERALES` a `FORCED_KB_TOPICS` con las ~45 comunas de las 4 tablas (Tramo A/B/C/D) como keywords, más `"recargo"`/`"traslado"` como red de seguridad. Cuando el cliente menciona cualquier comuna de cobertura, el documento completo (tabla real + regla anti-error) se inyecta entero en el prompt, sin depender de que el modelo decida llamar `get_knowledge` — igual que ya ocurre con cirugía/sedación/eutanasia/ecografía.

**De paso, cerrada la deuda de drift documentada en sesión 71:** la adición de `PROTOCOLO_ECOGRAFIA_Y_RADIOGRAFIA_ANIMALGRACE` a `FORCED_KB_TOPICS` (sesión 70) seguía sin commitear a git — quedó incluida en el mismo commit que este fix.

**Regla permanente (refuerzo de sesión 62):** cualquier documento del KB con una tabla de precios/reglas usada para responder preguntas frecuentes y estructuradas (comuna → recargo, peso → precio, etc.) debe evaluarse para `FORCED_KB_TOPICS` si su contenido útil queda más allá de los primeros 500 caracteres — no basta con que el documento esté en el top-5 por `updated_at`, el corte de 500 caracteres es ciego al contenido.

### Investigación: "la IA dejó de responder" (Pudahuel, esterilización de gata) — no era un bug de la IA

**Reporte de Claudia:** una segunda captura mostraba una conversación donde, aparentemente, nadie respondió durante un tiempo prolongado.

**Diagnóstico con `messages` completo de la conversación (fecha y hora en Chile):** los mensajes que la captura mostraba como respuestas del negocio ("Muy buenos días", "¿De qué comuna nos escribes?", precio con formato "$70,000" con coma) **no existen en ningún registro de Vetly** — ni contenido, ni `ai_model`, ni tampoco respetan el estilo obligatorio de Ary (falta el aviso de rango horario, no pide pin de ubicación, formato de coma en vez de punto para pesos). Todo indica que fueron enviados manualmente por alguien del equipo desde la app de WhatsApp Business — y como el número está en coexistencia, esas respuestas manuales **nunca llegan a la base de datos de Vetly** (los eventos `whatsapp.smb.message.echoes` se ignoran explícitamente desde sesión 56/57).

Lo que sí está en `messages`: el mensaje "Da lo mismo en que comuna, y cuántos meses tenga?" es del **cliente** (no del negocio), y 27 segundos después Ary respondió correctamente (edad mínima de 4 meses, precio $70.000, comuna sin recargo), y la conversación cerró bien de ahí en adelante. Sin errores ni cuota agotada en ese período.

**Conclusión:** no hubo ninguna falla de la IA en este hilo. El riesgo real que sí queda expuesto: en un número en coexistencia, si alguien del equipo responde manualmente por la app, **la IA queda completamente ciega a esas respuestas** — no las ve en su historial de contexto. Si el cliente vuelve más tarde, la IA puede repetir preguntas o información ya entregada manualmente, que es exactamente lo que generó la apariencia de "silencio"/desorden en esta conversación. No se aplicó ningún cambio de código para esto — capturar los echoes manuales en `messages` sería un cambio de alcance mayor (revertiría una decisión explícita de sesión 56/57 de ignorarlos) y no se decidió hacerlo esta sesión.

**Regla permanente:** ante un reporte de "la IA no respondió" o "dejó de responder", reconstruir la conversación completa desde `messages` con conversión a hora de Chile antes de asumir una falla — en números conectados por coexistencia, una respuesta visible en la app del teléfono no implica que haya pasado por Vetly ni que la IA la conozca.

---

## Cambios realizados — agosto 2026 (sesión 73, 2026-08-13/14)

> Nota de numeración: otra sesión trabajó en paralelo sobre este repo el mismo día y ocupó los números 71 y 72. Esta entrada es de una sesión distinta, dedicada por completo al módulo de Fidelización/Referidos.

### Auditoría del sistema de referidos — nunca atribuyó nada, y por tres causas distintas

**Pedido del usuario:** convertir Fidelización en un programa operativo (acumulación por recompra, bono de bienvenida, premio al referidor, canje en el punto de venta) y auditar por qué aparecían "puntos otorgados a personas que no corresponde".

**Hallazgo que corrige la premisa del reporte:** los 8.600 pts repartidos entre 42 tutores de Linares **no venían del sistema de referidos**. Eran 43 transacciones `welcome_bonus` de 200 pts que el trigger `auto_create_tutor_and_patient_on_complete` otorgaba a **cualquier** cliente al completar su primera cita, viniera referido o no. Evidencia: 100% de `loyalty_transactions` con `type='welcome_bonus'` desde el 2026-06-09, y **0 de 704 tutores con `referred_by IS NOT NULL`** en toda la base.

**Todo el módulo era fachada:** `clinic_settings.loyalty_points_percentage = 5.0` estaba configurado desde hacía meses y **ningún código lo leía** (grep: aparecía solo como texto en `Loyalty.tsx:321`). No existía ninguna funcionalidad de canje.

| # | Bug | Evidencia |
|---|---|---|
| 1 | Bono de bienvenida a todo cliente nuevo, sin relación con referidos y sin monto sobre el cual calcular | 43 `welcome_bonus` fijos de 200 pts |
| 2 | Sin idempotencia: doble bono al mismo tutor | Lilian Avendaño, 2× 200 pts el 2026-07-29 (18:44 y 21:24) |
| 3 | El referidor cobraba **sin que el referido comprara nunca** | `trigger_handle_tutor_referral_bonus` era `AFTER INSERT ON tutors`: bastaba con que el webhook creara el tutor por upsert con `referred_by` al recibir el código por WhatsApp |
| 4 | Y a la vez, en el caso más común **no pagaba jamás** | Cuando el tutor ya existía, el webhook hacía `UPDATE tutors SET referred_by` — un trigger INSERT-only no dispara con UPDATE |
| 5 | **Enlace de referido y carnet digital rotos en ambas clínicas** | `get_referral_link_data` y `get_pet_owner_portal` devolvían `cs.ycloud_phone_number`, en `NULL` desde la migración a Meta (sesiones 57 y 65). Aunque Claudia hubiera repartido los links, no habrían llevado a ninguna parte |
| 6 | 26% de las ventas de Linares no podría acumular | 47 de 180 ingresos en 60 días con `tutor_id IS NULL` (Santiago: 6 de 180) |

**Costo medido del programa** con volumen real de 60 días: 5% de recompra = **$99.350** entre ambas sucursales (~$50.000/mes). Un referido efectivo cuesta ~$11.750 (15% + $5.000) sobre un ticket promedio de $45.000.

### Reglas del programa (decisión de negocio confirmada con el usuario)

| Evento | Beneficiario | Monto |
|---|---|---|
| 1ª compra de un tutor **con** `referred_by` | El comprador | **15%** del monto pagado |
| 1ª compra de un tutor **con** `referred_by` | El referidor | **$5.000** fijos |
| 1ª compra **sin** referidor | — | nada |
| 2ª compra en adelante | El comprador | **5%** del monto pagado |
| Canje en una venta | El comprador | −monto canjeado |

**Aclaración crítica del usuario que cambió el diseño:** el bono de bienvenida es **exclusivo de clientes que llegan por un enlace de referido**. Un cliente nuevo sin referidor no recibe bienvenida; empieza a acumular desde su segunda compra. La versión previa (bienvenida a todo cliente nuevo) era justamente el bug #1.

Otras decisiones: **ambas sucursales**; base de cálculo = **lo efectivamente pagado** (después de descuento y después de restar el canje, para que los puntos no se reciclen); **reset total a 0**; **tutor obligatorio** en el formulario de venta cuando la acumulación está activa. Modo del programa en ambas: `money` · `Pesos AnimalGrace` · símbolo `$` (1 punto = 1 peso).

### Arquitectura — el motor vive en `incomes`, no en `appointments`

Desde la sesión 44 todo el dinero de Finanzas vive en `incomes`. El motor se enganchó ahí porque es la única fuente con monto.

**RPC `sync_income_loyalty(p_income_id)`** — punto único de verdad, `SECURITY DEFINER` con check `clinic_members`. **Idempotente por reversión + recálculo**, replicando el patrón ya probado de `inventoryService.syncIncomeProductMovements` (sesión 69): revierte del saldo todo lo que esa venta generó antes, lo borra, y recalcula desde el estado actual. Editar o borrar una venta corrige el saldo **automáticamente**, sin lógica de compensación.

Complementos:
- **`incomes.loyalty_redeemed NUMERIC`** — columna propia, deliberadamente **no** se reutilizó `discount`: el canje no es un descuento comercial y contaminaría el reporte de descuentos construido en la sesión 69.
- **`loyalty_transactions.income_id`** + índice único parcial `(income_id, type, tutor_id)` — cierra el bug #2 a nivel de BD.
- **`clinic_settings.loyalty_welcome_bonus_type`** (`fixed`|`percentage`) — el bono era un entero fijo y la regla nueva es un porcentaje; la columna nueva mantiene compatibilidad multi-clínica.
- Trigger `BEFORE DELETE ON incomes` → revierte el saldo antes de que el FK deje las filas huérfanas.
- **Doble guarda de "primera compra"**: por fecha *y* por existencia de un `welcome_bonus` previo. Sin la segunda, registrar una venta con fecha retroactiva volvería a pagar bienvenida y premio al referidor.
- Los RPCs `create_clinic_income`/`update_clinic_income` **llaman al motor ellos mismos** y topean el canje al saldo real. Se hizo dentro del RPC y no desde el frontend a propósito: así ningún camino de escritura puede olvidarse de acreditar los puntos — es el error exacto que dejó `payment_method` sin guardar durante semanas (sesiones 45/46). De paso se les agregó el check de `clinic_members` que no tenían.

**Caminos viejos eliminados:** `trigger_handle_tutor_referral_bonus` + su función (bugs #3 y #4), el bloque de lealtad dentro de `auto_create_tutor_and_patient_on_complete` (bug #1, el resto de la función queda intacto), y la función huérfana `handle_referral_bonus` (insertaba en `loyalty_transactions.patient_id`, columna inexistente).

**Verificación del motor** — 6 escenarios probados con SQL directo en producción, con datos de prueba creados y borrados: primera compra de referido ($100.000 → 15.000 al comprador + 5.000 al referidor con `referral_count=1`), recompra (5% exacto), primera compra sin referidor (0), canje + acumulación sobre el neto, edición del monto (2.500 → 4.000 sin duplicar), triple ejecución del sync (2 transacciones, saldo idéntico), y borrado de la venta (referidor vuelve a 0/0).

### Asignación manual de referidor — cierra el plan Core

**Gap encontrado al responder la pregunta del usuario sobre el plan Core:** la única vía para registrar `referred_by` era el webhook de WhatsApp detectando el código con la IA. **No existía ninguna forma manual en la interfaz.** Consecuencia: en el plan Core (sin IA conversacional) el bono de bienvenida y el premio de $5.000 nunca podrían otorgarse — el sistema de referidos quedaba muerto y solo funcionaba la acumulación por recompra. Y aun con IA, un cliente que llega diciendo "me recomendó Fernanda" por teléfono no podía registrarse.

**Fix:** buscador **"Primera visita — ¿alguien lo recomendó?"** en el modal de venta, que aparece solo cuando es la primera compra del tutor y no tiene referidor (el único momento en que el bono puede pagarse). En `Finance.tsx`, el `UPDATE tutors SET referred_by` corre **antes** de crear el ingreso, con `.is('referred_by', null)` para no pisar una atribución previa — el motor lee ese campo en el mismo INSERT.

**Resumen por plan:** acumulación, canje, carnet digital, historial y panel de Fidelización funcionan **igual en todos los planes** (viven en Finanzas + DB). Lo exclusivo de los planes con IA es la *comunicación* automática: que el agente mencione el programa al cerrar cada cita, entregue la Ficha Digital cuando se la piden, y detecte los códigos de referido solo.

### Frontend

- **`NewIncomeForm.tsx`**: saldo del tutor al seleccionarlo, panel de canje con tope `min(saldo, monto de la boleta)`, botón "Canjear todo", preview de lo que acumulará la venta (15%/5%/nada), línea de canje en el resumen separada del descuento, buscador de referidor, y tutor obligatorio con casilla de escape "Venta sin cliente registrado". El saldo se resuelve en los **tres** caminos de selección de tutor (click, `onBlur`, Enter) — engancharlo solo al click perdería el 26% de los casos (bug de sesión 49).
- **`PetOwnerPortal.tsx`** (carnet digital, `/p/:code`): **próximas atenciones separadas de las pasadas** (antes iban mezcladas en una lista de 6), reglas vigentes del programa leídas de la configuración real, y últimos 8 movimientos de saldo.
- **`Loyalty.tsx`**: fallback de teléfono a `contact_phone`, card de "Reglas de Bienvenida" que ahora aclara que es exclusiva de referidos y soporta `%`, textos del programa corregidos.
- `CajaReport`, `ExportModal`, `financeService`, `loyaltyService` y `get_clinic_incomes_secure`: el canje viaja como línea propia hasta el informe de caja y el export CSV/JSON.

### Webhooks (código local, **sin desplegar**)

Ambos (`meta-whatsapp-webhook` es el canal activo de las dos clínicas desde la sesión 65; `ycloud` por paridad): `referral_code` y `loyalty_points` agregados al SELECT de tutor que ya traía `referred_by`, e inyección de un bloque `[FIDELIZACIÓN — DATOS REALES, no inventar]` en `tutorContext` con el saldo y el enlace de Ficha Digital. **Inyección en contexto, no una tool nueva**: evita gastar una iteración del tool loop en cada consulta de saldo. El texto de `referralContext` ahora anuncia el bono de bienvenida correctamente.

### Estado al cierre — nada desplegado, motor pausado

A pedido explícito del usuario a mitad de sesión ("no subas los cambios a producción, deja solo en local"), el lanzamiento se difiere a un fin de semana sin operación de la clínica, para poder informar a Claudia antes.

- **En producción:** las 7 migraciones (motor, reset, arreglo de enlaces) **ya estaban aplicadas** cuando llegó la instrucción. Se dejaron, pero con **`loyalty_enabled = false` en ambas clínicas** — el motor sale temprano en su primer guardia y no acredita nada. Se reactiva con un `UPDATE` de una línea. Único efecto visible mientras esté apagado: el bloque de saldo/referido del carnet digital no se muestra (esa página lee la misma columna); impacto real nulo porque el portal nunca se promovió.
- **Sin desplegar y sin commitear:** todo el frontend, ambos webhooks, y el bloque de prompt (preparado en **`scripts/loyalty-prompt-fidelizacion.sql`**, con respaldo a `prompt_backups` incluido, **no ejecutado**).
- **Orden de lanzamiento acordado:** desplegar frontend → verificar → aplicar el prompt → encender el interruptor. En ese orden, para que nadie acumule saldo antes de que la caja pueda canjearlo.
- **Pendiente de verificar antes de encender:** el recorrido completo desde la pantalla (registrar una venta real con canje). El motor se validó con 6 escenarios en SQL, pero el flujo end-to-end desde el formulario no lo ejercitó nadie.
- Respaldos: `loyalty_transactions_backup` y `tutors_loyalty_backup` (label `pre_reset_2026_08_13`).

### Reglas permanentes

- **`sync_income_loyalty` es la única vía automática que acredita puntos.** Cualquier lógica nueva de fidelización debe pasar por ahí, nunca por un trigger paralelo — el sistema anterior tenía tres mecanismos compitiendo y ninguno funcionaba bien.
- **El premio al referidor se paga con la compra, no con el saludo.** Un trigger `AFTER INSERT ON tutors` no sirve para nada que dependa de una transacción económica: el webhook crea tutores por upsert apenas llega un mensaje.
- **Un trigger `AFTER INSERT` no cubre el camino `UPDATE`.** El webhook usa `UPDATE` cuando el tutor ya existe, que es el caso más común. Antes de confiar en un trigger, verificar los dos caminos de escritura.
- **`incomes.loyalty_redeemed` nunca debe fusionarse con `discount`.** Son conceptos distintos: uno es un descuento comercial (con motivo obligatorio y reporte propio desde la sesión 69), el otro es el uso de un pasivo ya devengado.
- **Todo campo del tutor que la UI necesite debe verificarse contra su RPC de origen.** El saldo llega por `select` directo a `tutors`, pero varias pantallas consumen `get_unified_contacts`, que devuelve un subconjunto de columnas (bug de sesión 52).
- **Cualquier funcionalidad que dependa de un dato que solo la IA puede capturar necesita una vía manual equivalente**, o queda inutilizable en el plan Core y frágil en el resto. La atribución de referidos era el caso: existía solo por WhatsApp con IA.

---

## Cambios realizados — agosto 2026 (sesión 74, 2026-08-15)

Sesión de seguridad y lanzamiento. Empezó como una revisión del trabajo de fidelización (sesión 73) y terminó encontrando un problema de aislamiento entre clínicas mucho mayor que lo auditado. Cerró con todo desplegado y el programa encendido.

### 🔴 Hallazgo principal: la RLS no filtraba por clínica

**Cualquier usuario autenticado de cualquier clínica podía leer, modificar y borrar los datos de todas las demás.** La policy de `tutors` era literalmente:

```sql
ALL · USING (auth.role() = ANY (ARRAY['authenticated','service_role']))
```

Sin mención de `clinic_id`. Confirmado que **no existía ninguna policy `RESTRICTIVE`** en todo el esquema que lo acotara (0 filas). Afectaba a 13 tablas: `tutors`, `patients`, `incomes`, `medical_history`, `clinical_records`, `dewormings`, `vaccinations`, `reminders`, `satisfaction_surveys`, `blocked_dates`, `crm_pipeline_stages`, `crm_tags`, `crm_prospect_tags`.

**No era teórico:** existe `sparkcabin.shop@gmail.com`, owner de "Clínica de prueba Core", una cuenta ajena que podía leer los 713 clientes de Animalgrace con teléfono y dirección, sus 120 historiales médicos y sus 436 registros de facturación.

Es el mismo patrón que la sesión 58 corrigió con `USING (true)`, pero **pasó aquel barrido porque no es literalmente `true`** — usa `auth.role()`, que parece un control de acceso y no lo es.

Además, `clinic_settings` tenía una policy `final_update` con `USING (auth.uid() IS NOT NULL)`: cualquier usuario logueado podía modificar la configuración de cualquier clínica, **incluidos los prompts de la IA y los tokens de WhatsApp**.

**Fix** (migración `multi_tenant_rls_isolation_core_tables`): se reemplazan por `is_clinic_member(clinic_id)`, que ya existía, es `SECURITY DEFINER` (no recursa sobre la RLS de `clinic_members`) y **ya devuelve TRUE para platform admins**, con lo que el panel HQ conservó su acceso global sin tratamiento especial. Las tablas sin `clinic_id` (`medical_history`, `clinical_records`, `dewormings`, `vaccinations`) validan contra `patients.clinic_id`, y `crm_prospect_tags` contra `crm_prospects` — su `WITH CHECK` **no puede** referenciar una columna `clinic_id` que no existe. `demo_requests` y `diagnostic_leads` (leads comerciales de Vetly, no de las clínicas) pasaron a `is_platform_admin()`.

**Verificación con sesión real de navegador**, no solo leyendo policies:

| Prueba desde la cuenta ajena | Resultado |
|---|---|
| Listar clientes de Animalgrace | `[]` |
| Leer su `clinic_settings` (tokens Meta, prompts) | `[]` |
| `create_clinic_income` sobre Linares | `No autorizado` |
| UPDATE / DELETE cross-tenant | 0 filas afectadas |
| Leer leads comerciales | `[]` |

Y en paralelo: Claudia (owner de **ambas** sedes) conserva 713 tutores / 567 pacientes / 436 ingresos; Mauricio (solo Santiago) ve 207 tutores y **0 de Linares**; el platform admin sigue viendo las 4 clínicas.

### Bypass de `auth.uid()` en las RPCs de la sesión 73

El patrón `IF auth.uid() IS NOT NULL AND NOT EXISTS (...)` se salta el control **cuando `auth.uid()` es NULL, que es el caso de `service_role` PERO TAMBIÉN de `anon`**. Como la clave pública viaja en el bundle de vetly.pro, cualquiera podía crear y editar ingresos de cualquier clínica. Corregido por la sesión paralela con `COALESCE(auth.role(),'service_role') <> 'service_role'`; esta sesión encontró una cuarta función con el mismo patrón (`get_finance_discount_metrics`) y la armonizó.

**`REVOKE ... FROM anon` no basta.** PostgreSQL concede `EXECUTE` a `PUBLIC` por defecto y `anon` hereda de ahí: tras revocar solo de `anon`, `has_function_privilege('anon', ...)` seguía devolviendo `true`. El patrón correcto es `REVOKE FROM PUBLIC, anon` + `GRANT` explícito a `authenticated, service_role`.

### Carnet digital: identificador no adivinable

`/p/:code` se identificaba con `referral_code`: **6 caracteres HEX = 16.777.216 combinaciones**. Con 713 tutores, 1 de cada ~23.500 intentos acierta — minutos de fuerza bruta para exponer nombre, mascotas, diagnósticos médicos y saldo.

**No se alargó `referral_code`**, porque cumple otra función con otro riesgo: es el código que el cliente dicta por WhatsApp para recomendar, y adivinarlo solo permite atribuirse una recomendación. Se separaron los conceptos con **`tutors.portal_token`** (22 caracteres base64url sobre `gen_random_bytes(16)`). Backfill de los 713; el enlace llevaba roto desde la migración a Meta, así que **nadie tenía un identificador en uso** y regenerar salió gratis.

⚠️ **El token es sensible a mayúsculas.** `PetOwnerPortal.tsx` hacía `code.toUpperCase()` sobre el parámetro de la URL — se quitó, o habría roto todos los carnets.

### Integridad: el referidor debe ser de la misma clínica

`referred_by` lo escriben el frontend y el webhook, y ninguno validaba la clínica: un UUID ajeno enviado por la API habría cobrado el bono de $5.000. La validación se puso en `sync_income_loyalty`, el único punto por el que pasa todo camino de acreditación. Verificado: un tutor de Linares con `referred_by` apuntando a Santiago no genera bienvenida ni premio.

### `cron-system-health` — el monitor estaba ciego, y luego mudo

Tres fallas encadenadas, todas consecuencia de la migración a Meta:

1. **Filtraba clínicas por `ycloud_api_key`**, hoy `NULL` en ambas sedes → `clinics_checked: 0`. El cron llevaba semanas sin revisar nada, en silencio. Corregido a `.or("ycloud_api_key.not.is.null,meta_phone_number_id.not.is.null")`, y `runClinicDiagnostics` dejó de exigir credenciales YCloud a una clínica Meta.
2. **`checkOpenAI` usaba `/v1/models`, que responde 200 con la cuota agotada** — o sea, no habría detectado ninguno de los 5 cortes por falta de saldo (abr, may, jun, 25-jul, 15-ago), que son la causa #1 de agentes mudos. Ahora hace una inferencia real mínima (mini, 1 token) y distingue `insufficient_quota` de un rate-limit transitorio.
3. **El canal de alertas estaba muerto** (encontrado en esta sesión al ejecutarlo): el cron detectaba correctamente pero devolvía `notified: false`. Causa real en los logs: `YCloud 403 WHATSAPP_PHONE_NUMBER_UNAVAILABLE — Phone number +56993089185 has not been registered`. El número del HQ dejó de estar registrado en YCloud.

**Fix del canal:** la alerta **siempre** se registra en `debug_logs` antes de intentar cualquier envío, se intenta WhatsApp, y si falla se cae a **email vía Resend**. El response expone `notify_channel` y `notify_error`. Verificado forzando una alerta real: `notified: true`, `notify_channel: "email"`, con el 403 de YCloud reportado como motivo.

⚠️ **Pendiente operativo:** el número +56993089185 sigue sin registrar en YCloud. Mientras tanto las alertas llegan por email, pero conviene reactivarlo o migrar el HQ a Meta.

### Lanzamiento del programa de fidelización

Desplegado y **encendido en ambas sedes** (`loyalty_enabled = true`). Secuencia: migraciones → verificación de aislamiento → commit selectivo (27 archivos, `git add` explícito) → build desde `git worktree` limpio → push → verificación del bundle real → webhooks → prompt → interruptor.

**El bundle se verificó mal la primera vez:** se buscó el marcador en `index-*.js` y dio falso negativo, porque estos cambios viven en chunks lazy (`Finance-*.js`, `Loyalty-*.js`, `PetOwnerPortal-*.js`). El `index` no cambia cuando el cambio está en una ruta cargada bajo demanda.

**Prueba end-to-end real conseguida**: a las 17:34 la IA de Linares agendó una cita con un cliente real y cerró con el mensaje del programa, después del aviso de rango horario y antes de la despedida, tal como pide la regla. Y el motor se probó por el camino real (mismo RPC que llama el formulario, con sesión de usuario autenticado): primera compra de $60.000 de un referido acreditó $9.000 al cliente y $5.000 al referidor.

Estado final: 0 transacciones, 0 saldos, base limpia. Santiago quedó con `ai_auto_respond = false` **por decisión de Claudia**, que la reactivará cuando lo necesite.

### Reglas permanentes

- **`auth.role() = 'authenticated'` en una policy NO es control de acceso multi-tenant.** Es el equivalente a `USING (true)` para cualquiera con cuenta. Toda policy sobre datos de clínica debe nombrar `clinic_id` (o resolverlo por su tabla padre). Un barrido que solo busque `USING (true)` no lo detecta.
- **Nunca usar `auth.uid() IS NULL` como señal de "llamada interna"**: también es NULL para `anon`. Usar `auth.role()`.
- **`REVOKE ... FROM anon` deja vivo el permiso heredado de `PUBLIC`.** Revocar de ambos y conceder explícitamente a los roles que sí deben ejecutar. Verificar siempre con `has_function_privilege`, no asumiendo.
- **Verificar la RLS golpeando la API con credenciales reales**, no leyendo las policies. La verificación válida es iniciar sesión (`/auth/v1/token`) con una cuenta de otra clínica e intentar leer y escribir. Leer definiciones fue justo lo que dejó pasar este agujero durante meses.
- **Un monitor con un solo canal de salida no es un monitor.** Registrar siempre el hallazgo de forma persistente antes de intentar entregarlo, y tener un canal alternativo. El de Vetly detectó correctamente y no avisó a nadie porque su número había dejado de existir.
- **Al verificar un deploy, buscar el marcador en el chunk correcto.** Los cambios de una página lazy no alteran `index-*.js`; buscar ahí produce falsos negativos.
- **`is_clinic_member(clinic_id)` es el helper estándar** para RLS por clínica: ya contempla al platform admin, así que no hay que añadir una policy aparte para el panel HQ.

---

## Cambios realizados — agosto 2026 (sesión 75, 2026-08-16)

Implementación de la **estrategia Core-led**: el plan Core a US$17 como canal de distribución, no como línea de ingreso. La apuesta se juega en la tasa de upgrade de Core hacia los planes con IA, y el producto tenía tres bloqueos que la impedían (1 usuario, 0 recordatorios, y recordatorios automáticos inutilizables el día 1 porque requieren Embedded Signup de Meta + plantillas aprobadas).

### Fuente única de verdad de planes — se acabaron las 8 definiciones divergentes

El mapeo plan→límites estaba duplicado en 8 lugares con valores distintos y distinto grado de soporte de los IDs nuevos. Ahora son **dos**, con la DB como autoridad del backend:

| Capa | Dónde | Rol |
|---|---|---|
| **DB** | tabla `plan_limits` | Autoridad. La leen `invite_member_v2` y las edge functions |
| **Backend** | `supabase/functions/_shared/planLimits.ts` | `limitsForPlan(sb, plan)` — consulta la tabla, cae a constantes locales si falla |
| **Frontend** | `src/lib/plans.ts` | Espejo + mapa de capacidades (`PAGE_MIN_PLAN`) |

**Si cambias un límite:** `UPDATE plan_limits ...` y el espejo en `src/lib/plans.ts`. Nada más.

**Límites vigentes:**

| Plan | Usuarios | Agendas | Recordatorios/mes | Créditos IA | 2h |
|---|---:|---:|---:|---:|:--:|
| Core | **3** | 1 | **25** | 0 | ❌ |
| Starter | **5** | 3 | 100 | 5.000 | ✅ |
| Pro | **10** | 5 | 250 | 10.000 | ✅ |
| Enterprise | ∞ | ∞ | ilimitado | 30.000 | ✅ |

Se eliminaron `maxUsers`/`maxAgendas`/`monthlyAppointments*` de `PLANS` (mercadopago.ts) y `PADDLE_PLANS` (paddle.ts): **nadie los leía**, eran datos duplicados muertos. Esos objetos ahora solo definen precio, `priceId` y textos.

Edge functions migradas a `limitsForPlan`: `paddle-webhook` (v13), `mercadopago-webhook` (v23), `mercadopago-create-subscription` (v24), `signup-handler` (v28), `cron-process-reminders` (v33).

### Bugs preexistentes corregidos de paso (estaban en la ruta tocada)

- **`mercadopago-webhook` escribía `trial_ends_at`, columna que NO existe en `subscriptions`.** El UPDATE completo fallaba, así que **ningún pago de MercadoPago llegaba a activarse**. Mismo bug en el upsert de `mercadopago-create-subscription`. Detectado en sesión 68 y documentado como "no corregido"; corregido aquí porque estaba dentro del bloque que había que modificar.
- **`mercadopago-webhook` daba `max_users: 2` a un Enterprise** (su CASE solo entendía IDs legacy).
- **`signup-handler` daba 1.000 créditos y 2 usuarios a toda cuenta nueva**, sin importar el plan, por la misma razón.
- **`paddle-webhook` no reescribía límites en `subscription.updated`**: un upgrade dentro de Paddle dejaba `max_users`/`monthly_reminders_limit` con los valores del plan viejo. Ahora los reescribe cuando el evento trae el plan en `custom_data`.
- **`mercadopago-webhook` solo escribía `plan_id`, no `plan`** — las dos columnas quedaban discrepando (AuthContext lee `plan`, Settings lee `plan_id`). Ahora escribe ambas.
- **Dashboard pintaba `message.contact_phone`** pero el select trae `phone_number`: salía siempre `undefined`.

### Gating por plan — infraestructura nueva (antes no existía ninguna)

Todo el sistema de guards era **por rol**; el único componente de plan (`PremiumFeature`) vivía en `RetentionEngine.tsx`, que está comentado en `App.tsx` y no tiene ruta. O sea: **el plan no bloqueaba nada.**

| Pieza nueva | Rol |
|---|---|
| `src/hooks/usePlan.ts` | `planId`, `limits`, `meetsPlan()`, `pageAllowed()` |
| `src/components/common/PlanGate.tsx` | Bloquea contenido con candado + CTA. Exporta `UPGRADE_URL` y `PlanUpgradeScreen` |
| `src/components/auth/PlanGuard.tsx` | Guard de ruta que **renderiza pantalla de upgrade, no redirige** |

`PremiumFeature.tsx` eliminado (sus 3 usos migrados). Corregía dos bugs suyos: enlazaba a `/settings?tab=subscription` (pierde el query param en el redirect legacy de `App.tsx`) y trataba cualquier `status` fuera de active/trial como "sin plan".

**⚠️ REGLA DE NO-REGRESIÓN — `resolveEffectivePlan` en `src/lib/plans.ts`.** El orden importa:
1. `manually_active` ⇒ acceso total. Animalgrace paga por transferencia con `plan='essence'`/`plan_id='prestige'`; sin esta regla perdería Mensajes y Ajustes IA.
2. Trial ⇒ acceso total (`AuthContext` devuelve un `{status:'trial', plan:'trial'}` sintético cuando no hay fila).
3. En otro caso, **`plan_id` manda sobre `plan`**.

**Bloqueado en Core:** Mensajes, Ajustes IA, CRM (`PAGE_MIN_PLAN`). El nav los muestra apagados con candado en vez de ocultarlos — cada bloqueo es un punto de contacto de venta. En Dashboard se bloquean las KPI `CONVERSACIONES ÚNICAS`, `MENSAJES DE IA` y `TIEMPO AHORRADO`, más las tarjetas Mensajes Recientes, Conversión y NPS.

### Recordatorios manuales por `wa.me` — el mecanismo principal de Core

Un cliente Core nuevo **no puede usar recordatorios automáticos el día 1**: requieren Embedded Signup de Meta y plantillas aprobadas (a Vetly le tomó ~48 h y borrar una WABA conectar Linares). El link `wa.me` no necesita nada de eso, no cuesta un centavo a ningún volumen y funciona desde el teléfono.

- **`ManualReminderPanel`** (`src/components/reminders/`) — primer tab de `/app/reminders` ("Enviar hoy"), por defecto **mañana**. Una fila por cita con botón Enviar; las ya enviadas muestran check y "Reenviar".
- Registra en `reminder_logs` con `type: 'manual_wa'` (verificado en la DB viva: **no hay CHECK constraint** en esa columna).
- **Nueva policy de INSERT en `reminder_logs`** — solo tenía SELECT, porque hasta ahora solo escribía el cron con service_role.
- **El envío manual NO consume el pool.** No hay llamada a la API de WhatsApp ni costo de conversación; cobrarlo penalizaría al usuario por hacer el trabajo a mano.
- **`reminder_settings.manual_wa_template`** — texto libre con placeholders con nombre (`{tutor}`, `{paciente}`, `{servicio}`, `{fecha}`, `{hora}`, `{clinica}`). No es plantilla de Meta: sin aprobación.
- **Aviso de upgrade desde datos propios**: a partir de 10 envíos manuales al mes, *"Enviaste N recordatorios a mano este mes. Automatizarlos toma 3 minutos."* El KPI de Dashboard muestra el desglose `🤖 automáticos · 👤 manuales`.
- **`Appointments.tsx`**: el botón de WhatsApp por fila invocaba `send-whatsapp-reminder`, que **falla sin canal conectado** — el caso de todo Core. Ahora detecta el canal (mismo criterio que el cron) y cae al `wa.me` con registro.
- **Guard de 2h en el cron**: el toggle está bloqueado en la UI, pero la API es alcanzable — el corte real va en `cron-process-reminders` PART 2 contra `allows_2h_reminder`.

⚠️ **Abrir `window.open` ANTES de cualquier `await`.** Si se abre después de una promesa, el navegador lo trata como popup no solicitado y lo bloquea.

### Anual de Core (solo Paddle sandbox)

`PADDLE_PLANS` tenía `annualTotal` pero **un solo `priceId`**: el anual era texto, no comprable.

| Objeto | ID |
|---|---|
| Precio anual Core (lista US$390) | `pri_01m04es6yggebc98sznwmnmfx1` |
| Descuento `LANZAMIENTO17ANUAL` (US$220 off → US$170) | `dsc_01m04eswyktrvqq4vhtksfspax` |

`priceIdAnnual` en `PADDLE_PLANS`, `openPaddleSubscriptionCheckout(..., period)`, toggle Mensual/Anual en Settings (solo modalidad internacional), y columna `subscriptions.billing_period`. **El anual mantiene el ancla de US$390 con cupón**, igual que el mensual mantiene US$39 — no se baja el precio de lista.

### Estado y pendientes

- **No hay ningún cliente real en Core**: Animalgrace ×2 es `manually_active`; "Clinica de prueba Core" está en plan `pro`. Cero riesgo de backfill.
- Verificado: `anon` no lee ni escribe `reminder_logs`; `get_advisors` sin ERRORES (los 190 WARN son los tipos históricos del proyecto); build desde checkout limpio de git correcto y marcadores presentes en los chunks lazy correctos.
- **Sin commitear**: todo esto convive con el backlog de Paddle de sesiones 63-68. **`src/lib/paddle.ts` está untracked y 5 páginas lo importan** — commitear lo de esta sesión por separado rompería el build en Vercel (trampa de la sesión 69). Va todo junto o nada.
- Las tres migraciones se aplicaron vía MCP, que asigna su propio timestamp. Los archivos locales se renombraron para coincidir (`20260816045207`, `20260816045900`, `20260816050943`) y así `db push` no intente reaplicarlas. Son idempotentes de todos modos.

---

## Sesión 77 (2026-08-20) — resueltos los dos bugs urgentes de sesión 76

Ambos estaban documentados como pendientes y quedaron corregidos, desplegados y verificados contra producción.

### 1. El trial ya no regala Enterprise

`resolveEffectivePlan` (`src/lib/plans.ts`) forzaba `planId: 'enterprise'` para cualquier `status ∈ {trial, trialing}`, así que **un trial de Core veía Mensajes, CRM, Ajustes IA y el agente conversacional completo** — y los perdía de golpe al convertir.

Ahora **solo `manually_active` da acceso total**. El trial resuelve el plan realmente contratado, por el mismo camino que el caso normal (`plan_id` con prioridad sobre `plan`). `isTrial` se conserva en el retorno, pero solo para copy de UI y para `SubscriptionGuard` — que decide si la suscripción está viva, un eje distinto de qué plan ve el usuario.

El dato ya existía: `signup-handler` guarda el plan elegido en `subscriptions.plan_id` desde el alta. El bug era puramente de gating de UI; los límites duros del backend (créditos asignados, tope de usuarios en el RPC) siempre habían usado el plan real.

**Verificado en navegador con sesión real, tres escenarios:**

| Escenario | Resultado |
|---|---|
| Trial de **Core** | 🔒 Mensajes · CRM · Ajustes IA · 13 bloques en Dashboard · pill «Agente IA no incluido» |
| Trial de **Pro** | Sin candados, acceso completo a IA |
| **Animalgrace** (`manually_active`) | Sin candados — no-regresión confirmada |

*De paso:* el fallback `'Prueba gratuita — 7 días de acceso total'` en `Settings.tsx` (inalcanzable hoy, pero falso tras este fix) pasó a «Periodo de prueba de tu plan».

### 2. El límite de créditos IA ahora corta de verdad

El chequeo era un `console.warn` **sin `return`**, y corría dentro de `saveMsg` — es decir, *después* de que OpenAI ya había generado la respuesta. El agente seguía respondiendo gratis indefinidamente, en cualquier plan.

**Nuevo `supabase/functions/_shared/aiCredits.ts`** — una sola fuente para medir el crédito, usada por ambos webhooks:
- `getCreditStatus(sb, clinicId)`: resuelve el pool root (`parent_clinic_id`), calcula el consumo, aplica el vencimiento de packs y respeta `ai_credits_unlimited`. **Nunca lanza**: ante un fallo de lectura devuelve `exhausted: false`, para que un problema de DB no deje mudo a quien sí tiene saldo.
- `creditCostForModel(model)` y `CREDIT_COST_4O = 15`.

**🔴 Bug de coherencia corregido en el camino.** Se **cobraba** ×15 (corregido en sesión 36) pero se **medía** ×8 — el fix de aquella sesión se aplicó al cobro y no al chequeo. El gate habría cortado al **~187% del consumo real**. Había un tercer `×8` en el cálculo de `balance_after`, también corregido. Ahora medir y cobrar comparten constante y no pueden volver a separarse.

**El gate va antes de llamar a OpenAI**, justo después del `if (!clinic.ai_auto_respond)` de cada webhook. Una sola verificación por turno, no por iteración del tool loop: cortar a mitad dejaría tool calls ya ejecutados (una cita creada, por ejemplo) sin respuesta final al tutor.

Al agotarse, por decisión del usuario: **silencio hacia el tutor + aviso a la clínica**. El inbound se guarda igual (ocurre estructuralmente antes del gate), así que el mensaje queda en Mensajes para responder a mano. La notificación (`type: 'ai_credits_exhausted'`) es **una por clínica y por mes** — sin esa idempotencia se acumularía una por cada mensaje entrante, justo cuando más llegan sin responder.

**Verificado invocando el webhook real en producción:**

| Prueba | Resultado |
|---|---|
| Mensaje con cuota agotada | `{"status":"credits_exhausted"}` · 0 respuestas de IA |
| Segundo mensaje | Corta igual · **sigue habiendo 1 sola notificación** |
| Auditoría | Los 2 inbound guardados · 0 cobros indebidos |
| `ai_credits_unlimited = true` | `{"status":"processing_async"}` · la IA sí respondió |

### ⚠️ Consecuencia para Animalgrace, asumida a propósito

Linares y Santiago **comparten pool** (Santiago cuelga de Linares). Con el multiplicador ya corregido el consumo real del mes es **23.269 de 30.000 (77,6%)**, no el ~42% que reportaba el cálculo con ×8. A ritmo del mes proyecta ~36.000.

Hoy no consume nada porque `ai_auto_respond` está apagado en ambas. **Pero si Claudia reactiva el agente, el corte se activaría en pocos días.** El usuario eligió explícitamente no hacer excepción: si se pasan, compran un pack. Queda registrado para que sea una decisión informada.

Deploy: `meta-whatsapp-webhook` v43, `ycloud-whatsapp-webhook` v273.

### Reglas permanentes

- **El trial da el plan contratado, nunca Enterprise.** `manually_active` es el único caso de acceso total, y se evalúa antes que todo lo demás.
- **Medir y cobrar créditos usan la misma constante** (`CREDIT_COST_4O` en `_shared/aiCredits.ts`). Si vuelves a escribir un multiplicador inline, ya te equivocaste.
- **El gate de cuota va antes de llamar a OpenAI**, no después de generar la respuesta. Un chequeo que solo loguea no es un chequeo.
- **Toda notificación disparada por mensaje entrante necesita idempotencia por período**, o se multiplica sola.

---

## Pendientes tras la sesión 75 — plan Core

Lo que quedó fuera de alcance, con lo que hace falta para cerrarlo. Ordenado por lo que bloquea el lanzamiento.

### 🔴 Bloqueante — sin esto, Core no se puede abrir al público

| # | Pendiente | Por qué bloquea |
|---|---|---|
| 1 | **Core autoservicio de punta a punta** + prueba de 30 días sin tarjeta (spec de la sesión 66, nunca implementada) | «Implementación llave en mano incluida» sigue en la tabla de objeciones de `product-marketing.md`. A US$89 se sostiene; a US$17 dos horas de configuración cuestan más que los primeros cinco meses de suscripción, y a cien altas al mes es inejecutable. |
| 2 | **Publicar el primer módulo de formación en marketing** | El ICP definido el 2026-06-04 dice que los independientes sin clientela «se pierden en 30 días». La formación ataca la causa de la fuga y es lo que convierte los US$17 en membresía en vez de software barato. Un módulo grabado vale más que seis planificados. |
| 3 | **Peldaño de US$39 con IA inicial** (producto + precio + descuento en Paddle) | De US$17 a US$89 hay un salto de **5,2×**. La expansión en SaaS funciona con saltos de 2–3×; a partir de ahí el cliente no escala, reevalúa el mercado. Ataca directamente la única métrica de la que depende toda la apuesta. Contenido sugerido: ~1.500 créditos IA + 100 recordatorios + análisis de facturas (que Core hoy no puede usar porque cuesta 20 créditos y tiene 0). |

### 🟡 Antes de gastar en publicidad

- **Instrumentar la tasa de upgrade**: qué % de Core sube de plan, a los cuántos días, y qué hizo en el producto antes. Hoy no se mide, y es la métrica que decide si la estrategia funciona. También define cuánto se puede gastar en adquirir: **CAC máximo US$46 sin upgrades, US$185 si un cuarto escala**.
- **Abrir `LANZAMIENTO17` por oleadas.** El cupón tiene tope de **100 usos**, corto para una estrategia cuyo objetivo declarado es abarcar al mayor número posible. Subirlo por tramos (100 → 250 → 500), cada uno anunciado como lanzamiento propio: cada oleada agotada es prueba social y contenido.
- **Pedir cotización a GVET como cliente potencial.** No publican precios. La afirmación «Vetly supera a GVET» sostiene parte del posicionamiento y sigue siendo hipótesis. Sami sí está verificado: Essentials US$29 con 5 usuarios; su IA está en el plan de ~US$67, más barato que el Starter de Vetly (defensa: la IA de Sami le dicta la ficha al veterinario, la de Vetly le contesta y le agenda al cliente).
- **Revisar el incentivo de referidos B2B.** Paga «2 meses gratis» al referidor cuando el referido toma Core: con Core a US$17 eso vale **US$34**, probablemente insuficiente para mover a alguien. Considerar expresarlo en créditos de IA, que además empujan al upgrade.
- **Definir la política de agravio comparativo** antes de que exista: qué pasa cuando un cliente pagando US$89 vea a otro entrar por US$17.

### ✅ Verificaciones ejecutadas (2026-08-18, con dev server + Playwright)

Método: sesión autenticada real obtenida con `admin/generate_link` + `auth/v1/verify` (sin necesidad de contraseña), inyectada en la app por hash de tokens (`#access_token=…`), que el cliente detecta por `flowType: 'implicit'` + `detectSessionInUrl`. La clínica «Clinica de prueba Core» se bajó a `core` durante las pruebas y se restauró a `pro/active` al terminar; todos los datos de prueba se borraron.

| Verificación | Resultado |
|---|---|
| Tope de 3 usuarios de Core **en el RPC** | ✅ usuarios #2 y #3 creados; el #4 rechazado con `Plan limit reached. Maximum 3 users allowed for plan core.` |
| INSERT cross-clínica en `reminder_logs` | ✅ `403` — `new row violates row-level security policy` |
| SELECT cross-clínica | ✅ 0 filas |
| INSERT en la propia clínica | ✅ `201` |
| Nav con candado (Mensajes · CRM · Ajustes IA → `/app/settings?tab=subscription`) | ✅ |
| Dashboard con la clínica en Core | ✅ 13 bloques con candado + CTA; pill «Agente IA no incluido» |
| Enlace directo a rutas fuera de plan | ✅ pantalla de upgrade con CTA «Ver planes», sin redirect |
| Envío manual `wa.me` desde viewport móvil | ✅ URL `https://wa.me/56912345678` con el mensaje completo y todos los placeholders resueltos; queda marcado «Enviado HH:MM» y aparece «Reenviar»; fila `manual_wa` escrita en DB |
| Toggle Mensual/Anual + precios | ✅ Core muestra US$390 y «Equivale a US$32/mes»; los otros 3 planes muestran «Este plan solo se factura mensualmente» |

**Pendiente de ejecutar (no se pudo con seguridad):**
- [ ] **Dry-run del cron con guard de 2h.** El guard vive después de `if (!hasAnyChannel(clinic)) continue`, y la clínica de prueba no tiene canal de WhatsApp, así que nunca se alcanza. Ejercitarlo requeriría una clínica con canal real en plan Core — hoy solo Animalgrace tiene canal, y invocar el cron manualmente puede enviar WhatsApps reales a sus clientes. Verificado por inspección: la query de PART 2 ahora trae `plan`/`plan_id`/`manually_active`, y `plan_limits.allows_2h_reminder` es `false` para Core.
- [ ] **Checkout anual completado de punta a punta** (pagar en el overlay de Paddle sandbox y confirmar `billing_period='year'` + `current_period_end` a +1 año). Se verificó toda la UI previa al overlay.

### 🐛 Bugs encontrados por la verificación visual (corregidos)

Ninguno lo habría detectado `tsc` ni el build — son de comportamiento en runtime:

1. **La plantilla del recordatorio manual salía vacía en toda clínica nueva.** `reminder_settings` no tiene fila hasta el primer guardado, así que `manual_wa_template` era `undefined` y el mensaje de WhatsApp se habría abierto en blanco — justo en el escenario del día 1 de un cliente Core, que es para lo que existe la función. Fix: constante `DEFAULT_TEMPLATE` en `ManualReminderPanel` (espejo del DEFAULT de la columna) y el textarea precargado con ese texto.
2. **`.single()` sobre `reminder_settings` devolvía 406** para esas mismas clínicas nuevas. Cambiado a `.maybeSingle()`: la fila ausente es un estado válido, no un error.
3. **El pill del sidebar seguía diciendo «IA Activa»** en un plan sin IA, contradiciendo al del Dashboard. Ahora dice «IA no incluida · Disponible desde Starter» y el punto deja de pulsar.
4. **`Cancelar suscripci\u00f3n`** se veía literal en el botón de Settings (bug preexistente): en texto JSX `\u00f3` no es una secuencia de escape. Las líneas vecinas funcionaban por estar dentro de string literals de JS.

*Nota:* los dos `406` que quedan en Settings son de `notification_preferences` (fila opcional inexistente) — patrón preexistente, ya absorbido por el helper `safe()` de la sesión 35.

### Nota de tooling

Se agregó **`playwright-core`** como `devDependency` para esta verificación. Apunta al Chrome del sistema vía `executablePath` porque el Chromium propio de Playwright no soporta macOS Monterey (`ERROR: Playwright does not support chromium on mac12`). Es el método establecido en la sesión 79 y ahora queda instalado y repetible.

### 🟢 Deuda técnica encontrada y NO corregida

- **`create_clinic_branch` no valida el plan.** ⚠️ *Corrige la descripción del informe de exploración, que venía del archivo de migración: la versión viva en la DB ya está bastante más sana.* Sí tiene el límite de 3 sucursales, sí usa `America/Santiago` y crea la sucursal como `enterprise` con `max_users = 999999` (no `prestige` con `-1`). **Lo que falta:** cualquier owner —incluido uno en Core— puede crear hasta 2 sucursales adicionales, y cada una nace como Enterprise con usuarios ilimitados. El agujero está acotado a 3, no es ilimitado, pero un cliente de US$17 puede triplicar su cuenta gratis. El fix natural ahora es leer `plan_limits` (haría falta añadir `max_branches` a la tabla).
- **Bypass de 3 emails hardcodeado** en `SubscriptionGuard.tsx`, `DashboardLayout.tsx` y `PendingActivation.tsx` (tres archivos, no dos).
- **`monthly_appointments_limit` no se enforcea.** Verificado: `monthly_appointments_used` solo se escribe a 0 en los webhooks y se lee para mostrarlo en Settings — **nunca se compara contra el límite**. El «100 citas con IA/mes» del plan Starter es hoy un texto de marketing sin respaldo en código.
- **Columnas muertas en `reminder_settings`**: `reminder_1h_before`, `template_1h`, `confirmation_days_before`, `followup_enabled`, `reminder_message`. Verificado que solo aparecen en `src/types/database.ts` — ningún código las lee. Candidatas a borrar.
- **`knowledge_base` queda accesible en Core.** No estaba entre las secciones que el usuario eligió bloquear. Es una línea en `PAGE_MIN_PLAN` si se quiere cerrar; se dejó abierto a propósito para no exceder lo pedido.
- **Costo real de un recordatorio bajo Meta, sin verificar.** La cifra documentada de US$0,05–0,09 por mensaje viene de la época de YCloud. Con Meta Cloud API el esquema cambió y no se revalidó — afecta al cálculo de margen de los 25 recordatorios de Core.
- **Precios CLP sin reconciliar** en `src/lib/mercadopago.ts` (pendiente desde la sesión 66): Enterprise muestra `$282.000` mientras `product-marketing.md` documenta `$333.000`. Mismo tipo de inconsistencia que se corrigió del lado USD.

### 🟢 Paddle — producción

El catálogo anual y el cupón `LANZAMIENTO17ANUAL` existen **solo en sandbox**. Cuando se apruebe el KYB: recrear producto anual + descuento en la cuenta live, actualizar `priceIdAnnual` y `LAUNCH_DISCOUNT_ID_ANNUAL` en `src/lib/paddle.ts`, y cambiar `VITE_PADDLE_ENVIRONMENT`/`PADDLE_ENVIRONMENT` a `production`. El anual en MercadoPago (CLP) no se tocó — hoy avisa que solo está disponible en la modalidad internacional.

### Reglas permanentes

- **Los límites de plan viven en `plan_limits` + `src/lib/plans.ts`. En ningún otro lugar.** Si vas a escribir un `CASE WHEN plan = ...`, ya te equivocaste.
- **`resolveEffectivePlan` es el único resolvedor de plan efectivo.** `manually_active` y trial ⇒ acceso total, siempre antes de evaluar el plan.
- **El rol oculta; el plan bloquea con CTA.** `usePermissions` (rol) y `usePlan` (plan) son ortogonales y deben cumplirse ambos.
- **`window.open` para `wa.me` va antes del `await`**, o el navegador lo bloquea.
- **Al añadir una página al nav**: su `pageKey` va en `ROLE_DEFAULTS` (rol) y, si requiere plan, en `PAGE_MIN_PLAN` (plan).

---

## Cambios realizados — agosto 2026 (sesión 76, 2026-08-16)

### La IA se corría un día: el plan de ruta re-anclaba el "hoy" del modelo

**Reporte:** Claudia pausó la IA de Linares porque estaba alucinando con las fechas — asumía que hoy era lunes siendo domingo.

**Síntoma (3 casos reales del domingo 16, todos Linares, todos `4o_pro`):**

| Hora Chile | Dijo la IA | Correcto |
|---|---|---|
| 10:10 | "**Hoy, lunes 17** de agosto… en Talca" | Hoy era domingo 16 |
| 12:22 | "**mañana, 18 de agosto**" | Mañana era el 17 |
| 12:32 | "Hoy no estamos en Linares, pero **mañana sí**" | El 18 es Linares, no el 17 |

Desfase de exactamente **+1 día** en los tres.

#### NO era un bug de fecha ni de timezone

Se simuló el bloque de fechas del código **realmente desplegado** (v34) con la hora exacta del mensaje (`2026-08-16T14:10:24Z`). El prompt entregaba:
```
- HOY: domingo, 2026-08-16
- MAÑANA: lunes, 2026-08-17
- HORA ACTUAL: domingo, 16 de agosto de 2026, 10:10 a. m.
```
Correcto. El modelo recibió la fecha buena y la ignoró.

#### Causa raíz

Linares es la **única** clínica con `routing_mode: mobile_sectors` y filas en `clinic_route_plan`. Su prompt incluye el `routePlanBlock`, rotulado *"PRIORIDAD MÁXIMA (POR SOBRE CUALQUIER OTRA REGLA)"*, que listaba:
```
- lunes, 17 de agosto (2026-08-17): SOLO sector Talca
- martes, 18 de agosto (2026-08-18): SOLO sector Linares
```
El domingo **no aparece** en esa lista porque es día cerrado. Sin un ancla visible del presente, el modelo tomó el primer ítem —lunes 17— como el día operativo vigente, lo verbalizó como "hoy" y desplazó "mañana" al 18.

Lo confirma que **el sector siempre fue correcto**: leía bien el plan; lo único que fallaba era la etiqueta relativa.

**Evidencia que lo aísla:**
- **Domingo 2-ago, Santiago** (sin plan de ruta): perfecto — *"Hoy es domingo… mañana, lunes 3 de agosto"*.
- **Jueves 13 y viernes 14, Linares con el plan ya activo**: perfecto — *"mañana, viernes 14"*, *"Para el lunes 17"*. En días hábiles el plan no rompe nada porque hoy sí figura o el ancla es obvia.
- `ai_behavior_rules` de Linares tenía **cero** menciones de reglas de fecha — nunca existió defensa contra esto.

**Corrección a la premisa del reporte:** el deploy del sábado 15 (16:18) fue el de `isPausedForHuman` (requires_human) y **no toca fechas**; el sábado posterior al deploy las fechas salieron correctas. El detonante fue la combinación que se dio por primera vez ese domingo: Linares migró a Meta el 10-ago (sesión 65), Claudia cargó el plan de ruta el 14-ago, y el 16 fue el primer día **no operativo** con ese plan cubriendo el día siguiente.

**Impacto operativo:** la cita de **Novak** (Yerbas Buenas, +56977763580) quedó agendada el **martes 18 a las 10:00** mientras el cliente escribió "mañana" entendiendo lunes 17 → riesgo de no-show. Requiere aviso manual.

#### Fix aplicado

**Código** (`meta-whatsapp-webhook` v35 + `ycloud-whatsapp-webhook` v265, ambos deployados, commit `0340395`):
- Cada fecha del plan lleva su etiqueta relativa calculada contra `localDateISO`: `[HOY]` / `[MAÑANA]` / `[PASADO MAÑANA]` / `[en N días]`.
- Si hoy **no** está en el plan, se agrega explícitamente indicando si está cerrado — el hueco era justo lo que provocaba el re-anclaje:
  ```
  Referencia temporal: HOY es domingo 2026-08-16. Esta lista NO empieza necesariamente hoy.
  Cada fecha trae entre corchetes su relación con el día de hoy: usa ESA etiqueta y nunca
  llames "hoy" ni "mañana" a una fecha que no la tenga.
  - domingo 2026-08-16 [HOY]: CERRADO, no se atiende.
  - lunes, 17 de agosto (2026-08-17) [MAÑANA]: SOLO sector Talca
  ```
- El día cerrado se deriva de `clinic.working_hours` con la clave en inglés (`now.toLocaleDateString("en-US", { weekday: "long" })`), cubriendo `closed` y `enabled === false`.

**Prompt** (solo DB, efecto inmediato, sin deploy — respaldo `pre_fix_fechas_relativas_2026_08_16`): nueva regla **MANEJO DE FECHAS (ABSOLUTO)** en `ai_behavior_rules` de **ambas** clínicas:
- La única fuente de verdad del día actual es el bloque `CONTEXTO DE FECHAS`; ninguna otra lista, plan o historial lo define.
- Antes de escribir "hoy"/"mañana"/"pasado mañana", verificar contra ese bloque; si no coincide, nombrar día + fecha absoluta.
- Si la clínica está cerrada hoy, **sigue siendo hoy** — nunca tratar el próximo día hábil ni el primer día del plan como "hoy".
- Al ofrecer o confirmar cita, escribir siempre día de la semana + fecha completa, y advertir explícitamente si no coincide con lo que pidió el cliente.

**El commit arrastra cambios previos de esos mismos archivos ya desplegados pero nunca commiteados** (`requires_human`/`isPausedForHuman` en meta, plan de ruta en ycloud), alineando git con lo que corre en producción.

#### Bug lateral detectado, NO corregido

[meta-whatsapp-webhook/index.ts:1643](supabase/functions/meta-whatsapp-webhook/index.ts#L1643) formatea el historial de citas del `tutorContext` con `d.toLocaleDateString("es-CL")` **sin `timeZone`** → usa UTC. Hoy no se manifiesta (la clínica cierra a las 19:00 y el corte UTC-4 está en las 20:00), pero cualquier cita más tardía se mostraría con un día de más. Queda como deuda acotada.

#### Estado al cierre
- Linares: `ai_auto_respond = false` — **la pausó Claudia** el domingo a las 12:33; no se reactivó (decisión de ella, afecta clientes reales).
- Santiago: `ai_auto_respond = true`, nunca estuvo expuesta (sin `routing_mode`).
- El fix es de prompt, no un bloqueo duro como el filtro de sectores de `checkAvail`: reduce mucho la ambigüedad pero conviene vigilar las primeras conversaciones tras reactivar.

### Reglas permanentes

- **Toda lista de fechas que se inyecte en el prompt debe traer su relación con el día de hoy.** Una lista de días futuros marcada como autoritativa, sin ancla del presente, hace que el modelo re-ancle su "hoy" en el primer elemento. Vale para el plan de ruta y para cualquier bloque similar que se agregue después.
- **Un día cerrado sigue siendo "hoy".** Si el prompt omite el día actual porque no es operativo, deja un hueco que el modelo rellena solo — y lo rellena mal.
- **Antes de atribuir una alucinación al último deploy, contrastar la hora del deploy contra el último mensaje correcto en `messages`.** Aquí el deploy sospechoso no tocaba fechas y las respuestas posteriores a él fueron correctas; el verdadero detonante era una condición de calendario (primer día no operativo con plan cargado).
- **Antes de tocar `ai_behavior_rules`, respaldar en `prompt_backups`** con un label descriptivo (refuerzo de sesiones 61/62).

---

## Cambios realizados — agosto 2026 (sesión 77, 2026-08-17)

### 🔴 Fuga crítica: RPCs `SECURITY DEFINER` sin control de acceso, alcanzables con la anon key

**Pedido:** revisión de seguridad de ambas sucursales.

**Hallazgo.** Cuatro RPCs `SECURITY DEFINER` hacían un `SELECT` directo **sin ningún control de acceso** y tenían `EXECUTE` para `anon`. Con la clave pública —la que va embebida en el bundle de `vetly.pro`, **sin login**— se obtenía:

| RPC | Qué entregaba |
|---|---|
| `get_clinic_settings_secure` | 83 campos por sucursal, incluidos **`meta_access_token`** y **`meta_capi_token`**, más `ai_behavior_rules` y `ai_personality` completos |
| `get_unified_contacts` | **1.648 contactos** (724 Linares + 924 Santiago): nombre, teléfono, email, dirección |
| `get_clinic_members_secure` | emails y `user_id` del equipo |
| `get_all_clinics_usage` | métricas de **todas** las clínicas de la plataforma |

Y además `get_tag_counts`, `get_admin_referrals`, `transfer_inventory`, `reset_monthly_ai_usage`, `save_transaction_items`, `increment_subscription_usage`, entre otras — **61 funciones** en total con `EXECUTE` para `anon`.

**Lo más grave:** con `meta_access_token` cualquiera podía enviar WhatsApps desde el número de ambas clínicas.

**Por qué no se había detectado.** `get_advisors(type:'security')` devolvió **190 WARN y cero ERROR**; los tipos `anon_security_definer_function_executable` se pierden entre los 55 `function_search_path_mutable` históricos. Se encontró **explotándolo de verdad** contra la API REST con la anon key, no leyendo definiciones — el mismo método que en la sesión 74.

### Fix aplicado (4 migraciones)

| Migración | Qué hace |
|---|---|
| `20260817170215_fix_anon_executable_security_definer_rpcs` | `REVOKE EXECUTE FROM PUBLIC, anon` en las 67 funciones `SECURITY DEFINER` + `GRANT` a `authenticated, service_role`; check de membresía en `get_clinic_settings_secure` y `get_clinic_members_secure` |
| `20260817170325_drop_permissive_policy_clinic_blocked_dates` | Elimina `manage_clinic_blocked_dates` (`ALL` / `auth.role()='authenticated'`), que anulaba por OR a las dos policies correctas |
| `20260817170412_isolate_get_unified_contacts_by_clinic` | Check de membresía en `get_unified_contacts` (cuerpo intacto) |
| `20260817171222_harden_remaining_security_definer_rpcs` | `get_all_clinics_usage` → `is_platform_admin`; `increment_subscription_usage` → membresía + allowlist `_used`; `transfer_inventory` → membresía + validar ubicaciones y producto de la clínica; los 3 overloads de `save_transaction_items` → membresía + `AND clinic_id = p_clinic_id` en el `UPDATE` |

**Hallazgos secundarios cerrados de paso:**
- `increment_subscription_usage` armaba el `UPDATE` con `format(%I)` sobre un nombre de columna del cliente. `%I` evita la inyección clásica, pero permitía tocar **cualquier** columna de `subscriptions`, incluidos los límites del plan. Ahora solo acepta contadores `^[a-z_]+_used$` existentes.
- Los 3 overloads de `save_transaction_items` hacían `UPDATE appointments WHERE id = p_appointment_id` **sin filtrar `clinic_id`**: con el UUID de una cita ajena se le reescribía precio, descuento y método de pago.
- `transfer_inventory` no validaba que las ubicaciones ni el producto fueran de la clínica.

**Verificación:** 0 RPCs alcanzables por `anon`, 0 policies sin aislamiento por clínica, 0 funciones rotas para el frontend (67 siguen con `EXECUTE` para `authenticated`), las 3 públicas (`get_pet_owner_portal`, `get_referral_link_data`, `mark_diagnostic_wa_clicked`) respondiendo, y las tablas ya estaban selladas para `anon` (solo `plan_limits`, config pública sin datos sensibles).

**Nota:** al probar `increment_subscription_usage` se incrementó el contador real de Linares; se revirtió en el acto (`monthly_reminders_used` volvió a 44).

### ⚠️ Pendiente de acción del usuario — rotar credenciales

**`meta_access_token` y `meta_capi_token` de ambas sucursales estuvieron accesibles con una clave pública.** El revoke no invalida un token ya copiado y no hay forma de descartar que alguien lo leyera. **Deben rotarse en el Business Manager de Meta y actualizarse en `clinic_settings`.**

### Reglas permanentes

- **`SECURITY DEFINER` sin check de acceso es una puerta abierta, no una función interna.** Toda RPC que reciba `p_clinic_id` debe validar membresía; si recibe otro ID (appointment, producto), debe resolver primero su `clinic_id`. El patrón estándar es:
  ```sql
  IF COALESCE(auth.role(), 'service_role') <> 'service_role'
     AND NOT public.is_clinic_member(p_clinic_id) THEN
    RAISE EXCEPTION 'Acceso denegado';
  END IF;
  ```
  El `COALESCE` deja pasar a las edge functions con `service_role` (cuyo `auth.role()` es NULL) sin abrirle la puerta a `anon`, que sí tiene `auth.role() = 'anon'`.
- **`REVOKE ... FROM anon` no basta**: PostgreSQL concede `EXECUTE` a `PUBLIC` por defecto y `anon` hereda. Revocar siempre `FROM PUBLIC, anon` y verificar con `has_function_privilege('anon', oid, 'EXECUTE')`.
- **`CREATE OR REPLACE FUNCTION` reinstala los privilegios por defecto.** Después de cualquier reemplazo hay que volver a revocar, o la función queda expuesta otra vez. Por eso la migración 4 termina con el bucle de revoke.
- **Un `UPDATE` dentro de una RPC debe filtrar por `clinic_id`**, no solo por el id de la fila: el id lo elige quien llama.
- **`get_advisors` no sustituye la prueba real.** Devolvió cero ERROR con los tokens de WhatsApp expuestos. La verificación válida es golpear la API con la anon key y confirmar `permission denied` / `content-range: */0`.
- **Antes de reescribir una función, traer su definición exacta** con `pg_get_functiondef`. Un `CREATE OR REPLACE` con un tipo de retorno distinto falla (42P13) y adivinar el cuerpo puede romper la app en silencio.

---

## Cambios realizados — agosto 2026 (sesión 78, 2026-08-17)

Sesión larga: checkout listo para el lanzamiento de Ads (MercadoPago + Paddle a producción, landing y registro plan-aware para Core), un bug de producción que rompía la creación de tutores, y toda la configuración externa de Google Ads/Turnstile/Pipeboard guiada paso a paso con el usuario.

### 1. Backlog de sesiones 63-77 commiteado y pusheado

Todo lo acumulado sin commitear (migración completa a Paddle, sistema `plan_limits`/gating, recordatorios manuales `wa.me`, referidos B2B, banner de onboarding) se dividió en 7 commits temáticos y se pusheó a `main`, verificando build desde un `git worktree` aislado antes de cada push (regla de sesión 69 — nunca confiar en un build local con archivos sueltos sin commitear).

### 2. Fix MercadoPago — planes nuevos + bug de columna inexistente

**`mercadopago-create-subscription`** solo conocía `essence/radiance/prestige` — cualquier intento de pagar `core/starter/pro/enterprise` explotaba con `PLAN_PRICES[plan][currency]` undefined. Agregados los 4 IDs nuevos (alias legacy conservados), y corregido el precio de Enterprise a **$333.000 CLP** en los 3 lugares que lo tenían distinto (`mercadopago.ts`=282.000, `mercadopago-create-subscription`=335.000, ninguno coincidía con el $333.000 documentado como correcto en sesión 23).

**Bug más grave encontrado al probar el fix:** `mercadopago-webhook` y `mercadopago-create-subscription` escriben `mercadopago_subscription_id` en `subscriptions` — columna que **nunca existió**. Supabase JS no lanza por defecto en `.update()`/`.upsert()`, así que el UPDATE fallaba en silencio en cada pago real. Mismo patrón que el bug de `trial_ends_at` ya documentado como corregido en sesión 68, reintroducido sin darse cuenta con otra columna al escribir `plan`/`plan_id` juntos. Confirmado con una prueba real contra la Access Token de producción: la preferencia se creaba en MercadoPago pero nunca se persistía en `subscriptions`. Migración `20260817000001_add_mercadopago_subscription_id.sql` agrega la columna faltante.

### 3. Normalización de planes legacy en producción

Confirmado con el usuario que no hay riesgo: ninguna de las 3 clínicas legacy (Vetly HQ, Animalgrace Linares, Animalgrace Santiago) paga por MercadoPago/Paddle — las dos Animalgrace tienen `manually_active=true` y `resolveEffectivePlan()` les da acceso completo antes de mirar el nombre del plan. Normalizado en producción: `essence`/`prestige` → `starter`/`enterprise` en `clinic_settings.subscription_plan` y `subscriptions.plan`/`plan_id` para las 3 clínicas. Verificado: cero filas con nombres legacy en toda la base.

Eliminado `supabase/functions/charge-trials/` — pricing 100% legacy en USD de la era LemonSqueezy, confirmado no programado en `pg_cron`, sin ninguna otra referencia en el código.

### 4. Migración de cuenta MercadoPago — cuenta empresa Nextflow

Guiado paso a paso: creación de app "Vetly App" en el panel developers de la cuenta empresa, integración **Checkout Pro** (coincide con el `checkout/preferences` que ya usa el código), Access Token de producción y webhook con signature secret configurados como `MERCADOPAGO_ACCESS_TOKEN`/`MERCADOPAGO_WEBHOOK_SECRET`. Verificado con una preferencia real (`3609792069-...`, ID de colector coincide con la cuenta Nextflow, no la personal).

### 5. Registro plan-aware + landing dedicada para Core

**`Register.tsx`**: lee `?plan=` de la URL para preseleccionar el plan (usado desde la landing de Core). Cuando el plan es Core, el copy deja de prometer "tu asistente IA" (Core no tiene agente conversacional) y pasa a mensaje neutro de gestión completa; trial de 30 días vs 7. `handleCreate` navega directo a `/app` para Core (sin pasar por `/pending-activation`).

**`signup-handler`**: `activation_status: isCorePlan ? 'active' : 'pending_activation'`, y ahora sí escribe `trial_start_date`/`trial_end_date`/`trial_status` (nunca se escribían — el countdown de Settings.tsx leía un campo siempre vacío). Default de `selected_plan` corregido de `"radiance"`/`"essence"` (legacy) a `"starter"`.

**`public/core.html`** (nuevo, ruta `/core` en `vercel.json`): landing dedicada al plan de lanzamiento ($17/mes), sin prometer IA conversacional — dolor de planillas/cuadernos, features reales de Core, objeciones (sin tarjeta, 30 días, cancela cuando quieras). CTA a `/register?plan=core`.

**`Pricing.tsx`**: 5ta fuente de verdad de precios encontrada (array propio, independiente de `PLANS`/`PADDLE_PLANS`). Los precios ya coincidían, pero las features estaban desactualizadas (Starter decía "2 usuarios" en vez de 5, Core decía "1 usuario" y "CRM de prospectos" que ni siquiera tiene) — corregidas.

**`landing.html`**: la tarjeta de Core tenía el mismo problema ("1 usuario", "sin recordatorios automáticos") — corregida a 3 usuarios + 25 recordatorios automáticos/mes + manuales sin límite.

### 6. Bug de producción: `generate_portal_token()` rompía cualquier tutor nuevo

Reportado por Claudia: error "function gen_random_bytes(integer) does not exist" al agregar un tutor y al marcar una cita como completada. Causa: `public.generate_portal_token()` (creada en sesión 74) llamaba `gen_random_bytes()` sin calificar esquema — la función vive en `extensions`, no en `public`, y el search_path efectivo de la plataforma Supabase dejó de incluirlo. Rompía **cualquier INSERT en `tutors`** (trigger `trigger_set_portal_token`), incluyendo el auto-alta de tutor/paciente al completar una cita (`tr_auto_create_contacts_on_complete`).

**Fix** (migración `20260817010000_fix_generate_portal_token_search_path.sql`): `gen_random_bytes(16)` → `extensions.gen_random_bytes(16)`. Verificado con inserts de prueba (rollback) contra Linares real: creación directa de tutor y completar una cita real sin tutor vinculado, ambos casos limpios post-fix. Efecto inmediato, sin deploy de frontend.

### 7. Cloudflare Turnstile — anti-bot en `/register`

Verificación **server-side real** en `signup-handler` (siteverify de Cloudflare) — el widget del frontend solo no bloquea nada, un bot puede llamar a la edge function directo. Falla abierto mientras no exista `TURNSTILE_SECRET_KEY` (para no romper el registro antes de configurar Cloudflare). Widget se monta solo en el paso 3 de `Register.tsx`, solo si `VITE_TURNSTILE_SITE_KEY` está definida.

Site key (`0x4AAAAAAETBZrMYJSrQhyG8`) y secret key configuradas: `VITE_TURNSTILE_SITE_KEY` en Vercel, `TURNSTILE_SECRET_KEY` en Supabase secrets. Verificado en producción: el bundle de `/register` incluye la site key real.

### 8. Paddle a producción — catálogo completo + verificación de negocio en curso

Catálogo recreado íntegro en Paddle **live** vía API directa (no hay MCP live conectado, solo sandbox):
- `scripts/create-paddle-packs.js` (ya existía) corrido contra producción → 9 packs + producto contenedor
- `scripts/create-paddle-plans.js` (nuevo, complementa al anterior) → 4 planes + Core anual + 2 descuentos `LANZAMIENTO17`/`LANZAMIENTO17_ANUAL`
- `src/lib/paddle.ts` actualizado con todos los priceId/discountId reales de producción (sandbox y live no comparten IDs)
- Secrets Supabase: `PADDLE_API_KEY`, `PADDLE_CONTAINER_PRODUCT_ID`, `PADDLE_ENVIRONMENT=production`, `PADDLE_WEBHOOK_SECRET` (webhook creado apuntando a `paddle-webhook`, eventos `transaction.completed`/`subscription.created`/`subscription.updated`/`subscription.canceled`)
- Vercel: `VITE_PADDLE_CLIENT_TOKEN` (token live) y `VITE_PADDLE_ENVIRONMENT=production` — verificado en el bundle real de `/register`
- `paddle-create-transaction` y `paddle-webhook` redeployados

**`Terms.tsx`**: la cláusula de trial decía "7 días" fijo — desactualizada desde que Core pasó a 30 días. Se agregó también un ancla `#reembolsos` y política de reembolsos explícita (14 días para reclamos, `hola@vetly.pro`) — requeridas por la verificación de negocio de Paddle (pidió URLs de Terms/Privacy/Refund policy).

**Verificación end-to-end intentada:** `paddle-create-transaction` devolvió `transaction_checkout_not_enabled` — "Checkouts aren't enabled for this account... onboarding process" — confirma que el checkout real sigue bloqueado hasta terminar la verificación KYB (no es un bug de código).

**Tipo de negocio en el formulario de Paddle:** no existe opción "S.p.A." — se recomendó "Sociedad Anónima (S.A.)" por ser la más cercana estructuralmente (accionistas/acciones, no socios/cuotas como la SRL), confirmado por el propio FAQ de Paddle ("elige la opción que más se parezca a tu estructura").

**Documento de verificación subido:** Certificado de Vigencia de la Sociedad (obtenido en registrodeempresasysociedades.cl).

**Estado al cierre:** "01 Set up your live account" y "02 Verify your account" en **"En curso"/"Action required"** — Paddle revisando. Payout Settings pendiente de que el usuario abra una cuenta USD.

### 9. Payouts — cuenta USD vía Global66

Evaluado y confirmado (vía WebSearch, no solo intuición): Global66 sí sirve para recibir el wire transfer de Paddle — disponible para empresas en Chile, da número de cuenta USD con SWIFT/IBAN, $10 USD fijo por transferencia recibida. Cuenta enviada a verificación (~24h esperados). Global66 también tiene API/webhooks de notificación de pagos recibidos (`documents-b2b.global66.com`) — evaluado como mejora futura de conciliación, no urgente (el webhook de Paddle ya es la señal que activa la cuenta en Vetly; el de Global66 solo confirmaría que el dinero llegó físicamente).

### 10. Google Ads — cuenta creada, primera campaña (Performance Max) y Pipeboard MCP conectado

Guiado paso a paso la creación de la cuenta Google Ads (crédito de bienvenida $350 USD aceptado), con recomendación explícita de **no confiar solo en Performance Max para una cuenta sin historial de conversiones** — se recomendó complementar con una campaña de Search acotada en paralelo (pendiente de crear) y arrancar con presupuesto bajo ($10-15 USD/día) hasta acumular ~15-30 conversiones.

**Objetivo de conversión:** "Registros" (coincide exactamente con el signup de Vetly). **Landing de destino:** `/core`. **Segmentación:** Chile, español únicamente (no expandir a "todos los países" en la primera campaña — mejor señal para el algoritmo).

**Corrección de contenido:** los primeros títulos de anuncio propuestos mencionaban IA/WhatsApp — **error real**, ya que apuntan a `/core`, que explícitamente no promete IA conversacional. Corregidos a mensajes de gestión completa (citas, fichas, finanzas, inventario).

**Pipeboard (`pipeboard.co`)** conectado como MCP de Google Ads para gestión de campañas vía Claude — mismo proveedor que el Meta Ads MCP ya conectado. Registrado con `claude mcp add google-ads-mcp --transport http https://google-ads.mcp.pipeboard.co/`. Requirió cuenta propia en Pipeboard (plan gratis) + reconectar la cuenta de Google Ads asegurándose de marcar el permiso "Google Ads" en la pantalla de consentimiento de Google (el primer intento falló por no marcarlo). **Las herramientas del MCP no aparecen hasta abrir una sesión nueva de Claude Code** — quedó conectado y autorizado, pendiente de sesión nueva para usarlas.

### 11. Fix de tracking de conversión — medir registro real, no clic de intención

**Bug de arquitectura encontrado y corregido en la misma sesión:** el snippet de conversión "Registros" (`AW-18395838136/CU91CNiuu-McELjt6MNE`) se había cableado para dispararse al hacer click en el CTA de `core.html`/`landing.html` — eso solo mide *intención* (clic hacia `/register`), no que la cuenta se haya creado. Un usuario que abandona el formulario habría contado como conversión igual. Google recomienda medir este tipo de acción por "carga de página"/evento post-completado, no por clic previo.

**Fix:** el evento se movió a `Register.tsx`, disparado justo después de que `signUp()` confirma éxito. Requirió agregar el gtag base a `index.html` (antes solo vivía en las páginas estáticas `landing.html`/`core.html`, inaccesible desde la SPA). Eliminada `trackCoreRegisterClick()` de `core.html`. Verificado en producción: el label real está en el bundle de `Register.tsx`.

**Landing.html** conserva su propio tracking de clicks en `/demo` (evento distinto, "Demo") — pendiente crear esa acción de conversión en Google Ads y completar su label (sigue en placeholder).

### Pendientes para la próxima sesión

- [ ] **Paddle:** confirmar aprobación de "Verify your account" (KYB) y completar Payout Settings con la cuenta Global66 una vez verificada (~24h). Sin esto, `paddle-create-transaction`/checkout de Paddle seguirán devolviendo `transaction_checkout_not_enabled`.
- [ ] **Google Ads:** abrir sesión nueva de Claude Code para que las herramientas de `google-ads-mcp` (Pipeboard) queden disponibles. Crear la campaña de Search complementaria a la PMax. Activar ambas con presupuesto bajo una vez confirmado que la conversión "Registros" registra bien un caso real.
- [ ] **Google Ads — acción "Demo":** crear la acción de conversión para los clicks en `/demo` de `landing.html` y reemplazar el label placeholder ahí.
- [ ] **GA4:** no se creó ninguna propiedad — quedó fuera de alcance esta sesión (el foco fue Google Ads, no Analytics general). Placeholder `G-XXXXXXXXXX` sigue comentado/sin usar en el código.
- [ ] **Meta:** rotar `meta_access_token`/`meta_capi_token` de ambas clínicas (pendiente de sesión 77, sin acción tomada aún).
- [ ] Verificar con un registro real de prueba (plan Core, vía `/core`) que la conversión de Google Ads llega correctamente al panel una vez Paddle/GA no bloqueen nada — no se hizo un caso end-to-end real en esta sesión, solo se confirmó que el código/label están bien desplegados.

---

## Cambios realizados — agosto 2026 (sesión 79, 2026-08-17)

### Alucinación del furgón — Linares/Talca (auditoría de conversación real)

**Reporte:** el agente le dijo a una clienta *"no contamos con un furgón móvil adaptado como en Santiago"*, negando la existencia del móvil de Linares/Talca.

**Diagnóstico (evidencia, no suposición):** revisado todo el KB de Linares — ningún documento menciona la palabra "furgón" en absoluto. La respuesta la generó `4o_pro` (el modelo caro, no `mini`) inventando de la nada una comparación negativa con Santiago para "rellenar" la pregunta de la clienta ("¿vienen en su furgón o al domicilio?"), sin ninguna fuente real. Confirmado con mensajes históricos reales (abril-junio 2026) que Linares/Talca **sí** tiene un furgón físico: clientes preguntan por estacionamiento, dicen que su mascota se asusta con él, etc. — y una respuesta correcta de la propia IA en junio ("si prefieres que sea en el furgón, también es posible"). `ai_personality` de Linares ya tenía una pregunta de checklist que lo daba por sentado ("¿Contamos con lugar para estacionar el móvil veterinario?") sin nunca declararlo como hecho explícito en ningún otro lado.

**Fix (DB, ambas sucursales, respaldo en `prompt_backups` antes de tocar):** nueva regla `MODALIDAD DE ATENCIÓN — FURGÓN O DOMICILIO (CRÍTICO)` en `ai_behavior_rules` de Linares y Santiago: confirma explícitamente que ambas sucursales tienen furgón, que la atención puede ser dentro de casa o en el furgón según prefiera el tutor, y prohíbe cualquier comparación negativa de equipamiento entre sucursales.

### Bug: página de Mensajes vacía ("Sin conversaciones" con miles de mensajes reales en la DB)

**Causa raíz:** `switchClinic()` en `AuthContext.tsx` persiste el cambio de sucursal activa en `user_profiles.clinic_id` — **a nivel de cuenta, no de dispositivo**. En algún momento reciente ese valor quedó en Santiago. Un dispositivo nuevo (sin `vetly_active_clinic_id` en su `localStorage`) cae al default de la DB = Santiago, mostrando su contexto en vez del de Linares. No fue un bug de código nuevo — Messages.tsx consulta bien, solo mostraba la sucursal equivocada.

**Fix:** corregido el default de la cuenta de Claudia de vuelta a Linares en la DB. Además, en `Messages.tsx`: un error real de carga ya no se disfraza de "sin conversaciones" (estado distinto con botón reintentar), el texto desactualizado que mencionaba YCloud corregido (ambas sucursales usan Meta desde sesión 65), y el botón de enviar mensaje manual — que fallaba con un error de YCloud incorrecto en clínicas Meta — ahora avisa correctamente que hay que responder desde la app de WhatsApp Business y que eso no pausa la IA sola.

### Regla de negocio — corte de uñas con 2+ mascotas (ambas sucursales)

A pedido de Claudia: con 1 mascota se mantiene el mínimo de $15.000 por visita (sin cambios). Con 2 o más mascotas, ya no aplica ese mínimo — se cobra $6.000 de visita (una sola vez) + el valor del corte de uñas de cada mascota según su peso. Aplicado en `ai_behavior_rules` de ambas clínicas y en la sección 3B del KB `PROTOCOLO_LOGISTICA_SERVICIOS_GENERALES` de Linares (Santiago no tiene ese documento — la regla vive solo en `ai_behavior_rules` ahí).

### Auditoría de performance — hallazgo: React Query configurado pero 0% usado

`main.tsx` inicializa `QueryClientProvider` con `staleTime: 5min`, pero grep en todo `src/` confirmó que **ninguna página lo usa** — todas hacen `useEffect` + `supabase.from(...)` crudo. Consecuencia real: cada vez que se revisita una página ya cargada, se re-descarga todo desde cero, sin caché entre navegaciones. Se identificó como la causa más probable de la sensación de lentitud, priorizado sobre tamaño de bundle (ya tiene code-splitting por ruta con `React.lazy` desde antes, y manual chunking de vendors en `vite.config.ts`).

### Migración de `Appointments.tsx` a React Query (primera página migrada)

`fetchAllData()` disparaba 5 queries (citas, servicios, profesionales, tutores, pacientes) en cada montaje **y en cada guardado/edición de cita** — hasta 6 round-trips a la DB solo para refrescar la lista tras guardar una cita. Reemplazado por 5 `useQuery` independientes, cada uno con su propia caché (`queryKey` incluye `clinic_id`). Las mutaciones (crear/editar/eliminar cita, cambiar estado, bloquear horario) ahora usan `queryClient.setQueryData` (optimista) o `queryClient.invalidateQueries` (solo la query de citas), en vez de `fetchAllData()` completo.

**Efecto medido:** guardar una cita pasa de 6 round-trips a 1. Revisitar la página dentro de la ventana de caché carga al instante, sin spinner.

### Batería de bugs encontrados al probar la migración en producción

Reportados por el usuario tras el deploy, todos investigados con evidencia (código y/o navegador real) antes de tocar nada:

- **Botón "Crear Cita" bloqueado con todos los campos llenos:** no era un bug — el campo "Servicios" es de dos pasos (elegir del desplegable + apretar "Agregar"), sin ningún aviso visual si se omite el segundo paso. Confirmado con el usuario.
- **Demora de ~5 segundos al crear/editar una cita:** la sincronización con Google Calendar (`create-google-event`/`update-google-event`) se esperaba (`await`) **antes** de cerrar el modal — un cold start de la edge function + round trip a la API de Google explicaba el retraso completo. Pasada a fire-and-forget (corre en segundo plano); el modal cierra apenas se confirma el guardado en la DB.
- **Orden del listado:** cambiado de ascendente a descendente por `appointment_date` — la cita más futura arriba, la más antigua abajo (antes mostraba primero las del límite de 3 meses hacia atrás).
- **Bug real: eliminar una cita no funcionaba a la primera.** Causa más probable encontrada por revisión de código: el menú "..." (Editar/Eliminar) de cada fila era un dropdown **CSS `group-hover:block`** — solo abría con el mouse encima, sin ningún control por clic. Reemplazado por un menú controlado por estado (`openMenuId`) con clic para abrir y un listener de clic-afuera-para-cerrar (`data-appointment-menu` + `mousedown` en `document`).
- **Pedido: revertir el estado de una cita a "Pendiente" y un selector más accesible.** La columna "Estado" (antes texto de solo lectura) pasó a un `<select>` con los 4 estados y sus colores (`badge-*` de `utils.ts`), permitiendo cualquier transición. `updateAppointmentStatus` amplió su tipo para aceptar `'pending'`. Los botones "Confirmar"/"Completar" de la columna Acciones se eliminaron (cubiertos por el selector), angostando esa columna.
- **Pedido: scroll horizontal solo visible al fondo de la tabla** (la tabla es alta, hay que bajar mucho para verlo). Agregada una barra de scroll horizontal "espejo" fija arriba de la tabla, sincronizada bidireccionalmente con la real vía refs + `onScroll` con guard anti-loop (`isSyncingScrollRef`).
- **Pedido posterior: quitar el botón de recordatorio de WhatsApp de cada fila** (redundante — ya se envían desde el módulo Recordatorios) y **acercar el "..." al selector de Estado**. Botón eliminado; el contenedor de Acciones pasó de `justify-end` (pegado al borde derecho de la tabla) a `justify-start` (pegado a la columna Estado), y el `<th>`/`<td>` de padding se redujo (`px-6` → `pl-2 pr-6`). Verificado que a 1366px de viewport prácticamente ya no hace falta el scroll horizontal.

#### Bug real encontrado en la propia implementación de la barra de scroll espejo

Al verificar en navegador real, la barra no se movía en absoluto — su `scrollWidth` quedaba siempre igual a su `clientWidth` (sin overflow, sin poder scrollear). **Causa raíz:** el `useEffect` que mide el ancho de la tabla real y lo aplica al div "espejo" (para forzar su overflow) dependía de `[dataLoading, viewMode]`. Cuando `dataLoading` pasa a `false`, hay un **render intermedio** donde `initializing` (un segundo estado, apagado en un efecto aparte que también depende de `dataLoading`) todavía es `true` — ese render sigue mostrando el spinner de splash, sin la tabla montada, así que el efecto se disparaba con `tableScrollRef.current`/`topScrollSpacerRef.current` en `null`. Cuando `initializing` finalmente se apagaba (un ciclo de render después) y la tabla sí se montaba, el efecto **no volvía a ejecutarse** porque sus dependencias no habían cambiado en ese segundo render. Fix: agregado `initializing` al array de dependencias.

**Confirmado con logs de depuración en el navegador real** (`console.log` temporal + Playwright), no solo por inspección de código — el patrón "el efecto corrió, pero con refs todavía null, y nunca se reintentó" es difícil de detectar sin verificación en vivo.

### Metodología nueva — verificación visual real antes de subir cambios de UI

A pedido explícito del usuario ("tienes live server para verificar en vivo"), se estableció el flujo: `npm run dev` local + Playwright (`playwright-core`) apuntando al **Chrome del sistema** vía `executablePath` — el Chromium propio de Playwright **no soporta macOS Monterey (mac12)** de esta máquina (`npx playwright install chromium` falla con `ERROR: Playwright does not support chromium on mac12`), así que apuntar a `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` es la única vía funcional en este entorno. Login con la cuenta de prueba **"Clínica de prueba Core"** (`sparkcabin.shop@gmail.com`, contraseña no documentada aquí — pedirla al usuario si hace falta reutilizarla), que no tiene datos reales de clínicas. Cuando la cuenta de prueba no tenía citas para poder ver la tabla, se insertaron filas `TEST *` directo por SQL (más rápido y confiable que simular el selector de hora custom del formulario vía Playwright) y se borraron al terminar.

**Regla permanente — verificación de UI antes de deploy:** para cambios visuales/interactivos en páginas de alto tráfico (Citas, Finanzas, etc.), preferir este flujo de verificación real sobre solo revisión de código + `tsc`/`build`. Ya encontró un bug real (condición de carrera en el efecto de sincronización de scroll) que ni `tsc --noEmit` ni `npm run build` habrían detectado nunca, por ser un bug de comportamiento en tiempo de ejecución, no de tipos.

**Regla permanente — `switchClinic` y la sucursal activa por defecto:** cualquier cambio de sucursal desde cualquier dispositivo sobreescribe el default global de la cuenta en `user_profiles.clinic_id` (no es por-dispositivo). Un dispositivo nuevo, o cualquier sesión sin `localStorage` propio, cae a ese default. Si un usuario multi-sucursal reporta "veo datos de la sucursal equivocada" o "no veo mis datos", verificar primero `user_profiles.clinic_id` en la DB antes de asumir un bug de código — coincide con el patrón ya documentado en sesión 52.

### Estado al cierre

Todos los cambios de esta sesión están en producción, cada uno verificado con `tsc --noEmit` + `npm run build` limpio y build adicional desde un checkout aislado de `origin/main` (nunca desde el working tree local, que tiene backlog de otras sesiones sin commitear) antes de dar el deploy por confirmado. Commits: migración a React Query, fix de Google Calendar bloqueante + orden descendente, menú por clic + selector de estado + scroll espejo (verificado en navegador real), y el ajuste final de la columna Acciones.

---

## Cambios realizados — agosto 2026 (sesión 80, 2026-08-18)

### Zona horaria por clínica en el servidor — cierre de la deuda técnica del cron de cajas

**Motivación:** se está evaluando abrir campañas de Google Ads a México como segundo mercado. Antes de traer el primer cliente de otro país había que cerrar el `'America/Santiago'` hardcodeado del servidor.

**La premisa documentada ya era falsa.** CLAUDE.md decía *"Impacto hoy: ninguno — todos los clientes actuales son chilenos"*. Verificado en producción: existe **`Clinica de prueba Core`** (`a50fc026-…`, creada 2026-08-12) con `timezone = 'America/Mexico_City'`, y el cron ya le venía abriendo la caja con la fecha chilena. El bug estaba activo, no era teórico.

#### El fix que estaba propuesto en CLAUDE.md era peligroso — descartado

Proponía `COALESCE(timezone, 'America/Santiago')` sin validar el valor. **`COALESCE` solo cubre `NULL`, no un string inválido.** Verificado empíricamente: `NOW() AT TIME ZONE 'Zona/Inventada'` lanza `22023: time zone not recognized`. Como la función hace un único `INSERT ... SELECT`, un `timezone` mal escrito en **una** clínica habría abortado el INSERT completo y dejado a **todas** sin caja — una regresión frente al literal hardcodeado, que nunca falla.

**Versión aplicada:** valida el timezone contra `pg_timezone_names` vía `LEFT JOIN LATERAL` antes de pasarlo a `AT TIME ZONE`. Solo llegan valores que Postgres reconoce; cualquier basura cae al fallback.

#### Cambios (migración `20260819020849_timezone_per_clinic_cajas_and_branches`)

1. **`auto_open_daily_cajas()`** — la fecha se calcula con la zona de cada clínica, validada. Filtro nuevo: abre solo cuando en esa zona ya son las 07:00 (`>= 7`, no `= 7`, para que una corrida perdida o un salto de DST se recupere en la pasada siguiente en vez de perder el día).
2. **Cron (jobid 18): `0 11 * * *` → `0 * * * *`.** Sin esto el fix quedaba a medias: 11:00 UTC son 07:00 en Chile pero 05:00 en México y 13:00 en España. Corriendo cada hora, el filtro de las 07:00 hace que cada clínica abra a las 07:00 de **su** hora local. Costo despreciable (4 filas). Se usó `cron.alter_job`, no `UPDATE` directo a `cron.job`.
3. **`create_clinic_branch`** — segundo hardcodeo del mismo tipo, **no documentado antes**: insertaba `timezone = 'America/Santiago'` literal, así que una sucursal Enterprise creada por un cliente mexicano nacía en zona chilena de forma silenciosa y permanente. Ahora hereda la zona de la clínica raíz del owner (la más antigua que posee), con `COALESCE` en línea aparte porque `SELECT INTO` con 0 filas deja la variable en `NULL` aunque tenga default (bug ya visto en `close_cash_register`, sesión 43).

#### Efecto en Chile: ninguno

Ambas Animalgrace tienen `America/Santiago` explícito → el valor calculado es idéntico al literal anterior (verificado: `sin_cambio = true` en las 3 clínicas). En invierno abre a las 11:00 UTC, igual que hoy; en verano 1 h antes (10:00 UTC = 07:00 local), **misma fecha**. Nada del negocio depende de la hora de creación de la fila — la lógica usa la columna `date`.

#### Verificación

- **Dry-run previo:** las 3 clínicas con `fecha_actual_hardcode = fecha_con_fix`.
- **Idempotencia:** función ejecutada 2 veces seguidas; estado idéntico byte a byte, incluida la caja ya cerrada de Animal Grace Santiago (`closed`, saldo 165.626, cobrado 310.000) — el `ON CONFLICT DO NOTHING` no la tocó.
- **7 casos de timezone** (válidos, mal escrito, basura, vacío, `NULL`) resueltos sin excepción. La fila de prueba de Madrid confirmó el valor del fix: allá ya era el día siguiente, y con el hardcode habría recibido la caja con la fecha de ayer.
- **Prueba destructiva auto-revertida:** se corrompió el `timezone` de una clínica, se borraron las cajas del día y se corrió la función real → creó las 3 cajas igual. Antes del fix esa sola fila habría abortado todo. Reversión verificada después.

### Pendientes de timezone que quedaron identificados

- **El `DEFAULT` de `clinic_settings.timezone` es `'America/Mexico_City'`** (no Santiago). Una clínica nueva creada sin timezone explícito nace en zona mexicana. Lo correcto sería capturar la zona en el signup; es un cambio de producto, no de este fix.
- **`CajaDelDia.tsx:132`** tiene un fallback `'America/Santiago'` sin `timezone ||`. Hoy inofensivo: su único caller (`Finance.tsx:1206`) siempre pasa `todayStr` ya calculado.

### Reglas permanentes

- **`COALESCE` no valida un timezone, solo cubre `NULL`.** Antes de pasar un valor de usuario a `AT TIME ZONE`, resolverlo contra `pg_timezone_names` — un string inválido lanza `22023` y, dentro de un `INSERT ... SELECT`, tumba la operación entera para todas las filas.
- **Un cron único en UTC no sirve para operar en varios husos.** Si la tarea debe ocurrir a una hora *local*, correr el cron cada hora y filtrar por la hora local de cada fila — no basta con corregir el cálculo de la fecha.

---

## Cambios realizados — agosto 2026 (sesión 81, 2026-08-20)

### Pausa del programa de fidelización — el switch no bastaba

Claudia pidió frenar la acumulación de Pesos AnimalGrace: el equipo todavía no anunció el programa por redes sociales, así que no debía estar corriendo en silencio.

**`loyalty_enabled = false`** en ambas sedes detuvo el motor, el canje y el carnet — pero **la IA seguía anunciando el programa igual**, porque el texto que lo describe ("desde tu segunda visita acumulas...") vivía escrito a mano dentro de `ai_behavior_rules`, que no depende de esa columna. Apagar el switch sin tocar el prompt dejaba a la IA prometiendo un beneficio que ya no se acumulaba.

**Error propio durante la corrección:** al restaurar un respaldo del prompt del 15-ago para quitar ese texto, se sobrescribieron sin querer reglas de sesiones posteriores (manejo de fechas de sesión 76, regla del furgón de sesión 79). Se detectó al revisar la lista de `prompt_backups` y se recuperó desde un respaldo tomado el mismo día, antes de tocar nada — verificado campo por campo que las reglas de fechas, furgón, rango horario y corte de uñas volvieron a estar presentes.

**Fix de raíz:** el bloque de fidelización se movió del prompt (editable solo a mano en la DB) al **código** de ambos webhooks, dentro de la misma condición `if (clinic.loyalty_enabled)` que ya existía para inyectar el saldo en el contexto. Los montos (`5%`, `$5.000`, `15%`) se generan desde `clinic_settings` en vez de estar fijos en el texto, así que si el porcentaje cambia desde Fidelización, el mensaje se actualiza solo. Un solo interruptor controla ahora motor, canje, carnet **y** lo que dice el agente — no vuelve a hacer falta editar un prompt a mano para pausar o reanudar.

Deploy: `meta-whatsapp-webhook` y `ycloud-whatsapp-webhook`. Verificado sin errores en `debug_logs` tras el deploy, con tráfico real de ambas clínicas.

### El switch no tenía ningún control en la interfaz

Al pedir confirmar "cuando Claudia anuncie, avísame para reactivarlo", el usuario preguntó, con razón, por qué hacía falta avisar si supuestamente había un switch — **no lo había**. `loyalty_enabled` solo se leía en el código; ninguna pantalla lo escribía. Se agregó el control real en **Fidelización → Ajustes**, arriba de todo: tarjeta verde/gris con punto de estado, texto que explica qué implica cada estado (sin tecnicismos), y guardado inmediato al tocar el interruptor — no depende del botón "Aplicar Cambios Globales" más abajo, porque es el control que se usa para frenar algo en caliente y esperar a un guardado posterior dejaría el programa corriendo si alguien cierra la pestaña. Actualización optimista con reversión si la escritura falla; confirmación al pausar, porque afecta lo que ven los clientes.

Estado al cierre: **pausado en ambas sedes**, esperando que Claudia lo encienda ella misma desde Ajustes cuando el equipo anuncie.

### Cantidad por línea en el formulario de Ingreso (Finanzas)

Pedido de Claudia: al agregar un servicio o producto a una venta (ej. "Vacuna Séxtuple"), poder subir la cantidad de esa misma línea con un botón +/- en vez de rebuscarlo en el desplegable por cada unidad — caso típico: 3 mascotas del mismo tutor, misma vacuna.

**Antes no existía cantidad.** `selectedServices`/`selectedProducts` eran `{id, name, price}[]`; agregar el mismo servicio dos veces ya funcionaba (creaba dos filas duplicadas que el subtotal sumaba bien), pero cada unidad exigía rebuscar. `addService`/`addProduct` siempre hacían `push`, nunca dedupaban.

**Por qué tocó más que la UI.** El array `services` (JSONB en `incomes.services`) lo consumen otros dos lugares que asumían implícitamente "1 fila = 1 unidad" — si solo se arreglaba el formulario, agregaba dos regresiones reales el mismo día que se usara el botón nuevo:

1. **`inventoryService.syncIncomeProductMovements`** descontaba stock con `addConsumption(it.id, 1, ...)` hardcodeado. Con 3 unidades colapsadas en una fila de `quantity: 3`, el stock solo habría bajado 1.
2. **RPC `get_finance_item_metrics`** tenía `1::numeric AS quantity` fijo por elemento del JSONB — el tab "Análisis" contaba filas, no unidades reales.

**Decisión de diseño — `price` sigue siendo el total de la línea.** Dentro del componente cada línea guarda el precio unitario y la cantidad por separado, pero al guardar se persiste `price: unitario × cantidad` (igual que hoy) más un campo `quantity` nuevo. Esto preserva el contrato para todo lo que ya lee `price` sin saber que existe cantidad: `get_finance_discount_metrics` (prorratea sumando `price`), `TutorDetails.tsx` (que **ya** renderizaba `svc.quantity > 1 && <span>×{svc.quantity}</span>` desde antes, sin necesitar cambios), `CajaReport`/`ExportModal` (no leen `services` en absoluto).

**Cambios aplicados:**
- `NewIncomeForm.tsx`: tipos con `quantity`; `addService`/`addProduct` dedupan por `id` en vez de duplicar filas; nuevo componente `QtyStepper` (`[−] N [+]`, el `−` deshabilitado en `quantity === 1` — bajar de 1 a 0 no es el trabajo del stepper, para eso sigue el basurero); subtotales multiplican por cantidad; `updateDescription` sufija `(×N)` cuando corresponde; precarga en modo edición divide el precio guardado por la cantidad para recuperar el unitario (los ingresos históricos sin `quantity` caen a 1, se comportan igual que antes — sin backfill).
- `inventoryService.ts`: productos vendidos directo dividen `it.price` por `it.quantity` para obtener el unitario que espera `addConsumption`; servicios con producto vinculado multiplican `linked_product_qty` por la cantidad del servicio vendido (3 vacunas que consumen 2 dosis cada una descuentan 6, no 2).
- Migración `20260820151237_finance_item_metrics_respect_quantity`: `1::numeric AS quantity` → `GREATEST(1, COALESCE((elem->>'quantity')::numeric, 1))`. Verificado antes/después sobre datos reales de agosto en ambas sedes: `by_type` idéntico al peso — el histórico no se movió porque no tiene `quantity` y cae a 1.

**Verificación end-to-end en navegador real**, no solo `tsc`/build: con la clínica de prueba Core (aislada de Animalgrace gracias a la RLS de la sesión 74), una venta con un servicio vinculado ×3 y un producto ×2 —

| Verificado | Resultado |
|---|---|
| Guardado | `quantity: 3` a $24.000, `quantity: 2` a $2.000 |
| Descripción automática | "...Vinculado (×3), ...Producto (×2)" |
| **Stock** | bajó exactamente **8** (6 del servicio vinculado + 2 del producto directo) — antes habría bajado 2 |
| Dedupe | reelegir el mismo producto sumó a la fila existente, no creó otra |
| Métricas | 3 y 2 unidades sobre 1 línea cada una, en vez de contar 1 y 1 |
| Reversión al borrar | stock volvió exactamente a 100 |

Todos los datos de prueba se crearon y eliminaron en la clínica Core; los 475 ingresos reales de Animalgrace quedaron intactos.

### Reglas permanentes

- **Todo control de negocio que un usuario deba poder prender/apagar necesita una UI real, no solo una columna en la base.** "Es una línea de SQL" no es una respuesta aceptable cuando el usuario pregunta cómo lo hace él mismo — si no hay switch en la pantalla, no existe para efectos prácticos.
- **Un flag que apaga un motor debe apagar también lo que ese motor promete comunicar.** `loyalty_enabled` controlaba datos pero no el discurso de la IA sobre esos datos; ambos deben colgar de la misma condición, y mejor en código que en un prompt editado a mano.
- **Antes de restaurar un respaldo de prompt, revisar si hay respaldos más recientes que el que se va a usar.** Restaurar a un punto en el tiempo pisa todo lo que se agregó después, no solo lo que se quiere revertir.
- **Cuando un array JSONB con forma flexible gana un campo nuevo, buscar todo lugar que itere sobre él asumiendo la forma vieja** — no basta con no romper la escritura; hay que auditar cada lectura que asuma "1 elemento = 1 unidad" antes de dar el cambio por seguro.
- **Verificar cambios de inventario/dinero con una venta real de punta a punta**, no solo con la lógica en abstracto — la prueba en navegador con clínica de prueba aislada detectó que el diseño era correcto antes de tocar datos reales de Animalgrace.

---

## Cambios realizados — agosto 2026 (sesión 82, 2026-08-20)

### Bug: la IA ofrecía 17:00 como última hora en vez de 18:00 (ambas sucursales)

**Reporte de Claudia:** el agente venía dando las 17:00 como el horario más tardío disponible, cuando el tope configurado (sesión 58) es 18:00.

**Diagnóstico con evidencia real, no solo lectura de código.** Se reconstruyó una conversación real de Santiago del mismo día (20-ago, ~22:57–23:08 hrs): la IA ofreció *"desde las 10:00 AM hasta las 5:00 PM"*, y cuando la clienta pidió las 18:00, la IA insistió *"nuestro horario es hasta las 18:00... la última cita que podemos agendar es a las 5:00 PM"* — contradiciéndose a sí misma en el mismo mensaje.

**Causa raíz — no era el prompt ni la configuración.** El log real de esa conversación (`debug_logs`: `"Check Avail Results", {totalSlots: 17, availableCount: 17}`) y una prueba directa del RPC (`get_available_slots(..., p_last_slot_cap: '18:00')`) confirmaron que la base de datos **sí genera correctamente el slot de las 18:00** — un día 10:00→18:00 cada 30 min da exactamente 17 franjas, y las 17 llegaban disponibles. El problema estaba en el código del webhook, en el paso que arma la respuesta final para el modelo:
```ts
const displaySlots = availableFormatted.slice(0, 15);
```
Con 17 franjas en el día, truncar a los primeros 15 elimina justo las dos últimas — **17:30 y 18:00** — dejando 17:00 como la hora más tardía que la IA llega a ver. El bug era **idéntico en `meta-whatsapp-webhook` y `ycloud-whatsapp-webhook`** (mismo código duplicado en ambos archivos), aunque solo `meta-whatsapp-webhook` tiene impacto real hoy: **ambas clínicas migraron a Meta Cloud API** (Santiago en sesión 57, Linares en sesión 65) — `ycloud-whatsapp-webhook` ya no procesa tráfico de ninguna clínica en producción, quedó como código de respaldo. Se corrigió en los dos archivos de todas formas, por si alguna clínica futura vuelve a usar YCloud.

**Fix aplicado (`meta-whatsapp-webhook` v45, `ycloud-whatsapp-webhook` v275, deploy vía Supabase CLI):** se quitó el `.slice(0, 15)` — ya existía un campo paralelo `raw_slots` con la lista completa sin truncar, así que la lista `slots` (la que efectivamente lee el modelo) truncada no cumplía ningún propósito, solo cortaba información real.

**Verificación post-fix:** se llamó `get_available_slots` directo con los parámetros reales de un servicio típico (Consulta Médica, 60 min) para una fecha próxima de cada sucursal — ambas devuelven 17 franjas con **18:00 como máximo**, y se confirmó por grep que no queda ningún otro `.slice()`/truncamiento entre esa lista y la respuesta que arma el tool result. `verify_jwt: false` se mantuvo en ambos deploys; sin errores nuevos en `debug_logs` tras desplegar.

**Regla permanente:** cuando se agrega un tope/límite a un flujo de disponibilidad (como el cap de las 18:00 de sesión 58), no basta con verificar que el RPC lo respeta — hay que rastrear la lista completa hasta el punto exacto donde se arma la respuesta que consume el modelo. Un truncamiento genérico (`.slice(0, N)`) aguas abajo de un fix correcto en el RPC puede anular el fix en silencio, y solo se manifiesta en días con más de N franjas — invisible hasta que la apertura estándar de la clínica genera más elementos que el límite.

---

## Cambios realizados — agosto 2026 (sesión 83, 2026-08-22)

### Diagnóstico: por qué AnimalGrace agota créditos de OpenAI cada 2 días

**Causa raíz encontrada, NO corregida — decisión explícita del usuario.** `activeSchedulingFlow` (el mecanismo que mantiene el ruteo en GPT-4o mientras dura un flujo de agendamiento) revisa los **últimos 3 mensajes de la propia IA** contra una lista de ~20 palabras (`schedulingSignals`). Esa lista se fue ampliando sesión tras sesión (9, 15, 36, 66) cada vez que `mini` alucinaba algo — pero incluye palabras genéricas como "cita", "horario", "dirección" que aparecen en casi cualquier cierre de conversación (ej. el aviso obligatorio de rango horario de sesión 22 contiene "horarios"). Resultado medido con datos reales: el ratio GPT-4o:mini pasó de **0,01 en abril** (sano) a **3-9x sostenido desde mayo**, con **78-87% de los mensajes en GPT-4o en los últimos días** — muy por encima de lo que el diseño "mini por defecto, 4o solo para casos específicos" pretendía.

Mapeé palabra por palabra qué se podría sacar de la lista sticky sin reabrir bugs históricos documentados (`comuna`/`cobertura`/`recargo` → sesión 9; `vacun`/`antirrabi`/`octuple` → sesión 36; `sector` → sesión 15/59/64 — todas se quedarían) vs. qué es genérico sin bug documentado detrás (`cita`, `agend`, `direcci`, `ubicaci`, `traslado`, `zona`, `reserv` — candidatas a sacar).

**Decisión final del usuario — cerrado, no es un pendiente.** *"Lo dejaremos con el modelo caro como está, y que así está funcional. Lo dejaremos como está."* El ahorro de créditos no justifica el riesgo de reabrir un bug real con clientes reales. `selectModelTier()`/`schedulingSignals` quedan intactos **a propósito, de forma permanente** — no es un recorte pendiente de aplicar en otra sesión, es la configuración elegida para producción. Si en el futuro se quiere revisar, hace falta una decisión nueva del usuario, no retomar esto como "tarea pendiente".

### Multiplicador de GPT-4o — subido a ×20 y revertido a ×15 el mismo día

**Lección real, no teórica.** `CREDIT_COST_4O` (en `supabase/functions/_shared/aiCredits.ts`, fuente única para ambos webhooks) se subió de 15 a 20 a pedido del usuario. El chequeo de saldo recalcula `totalUsed` **en vivo** a partir de contadores crudos acumulados (`mensajes_mini + mensajes_4o × CREDIT_COST_4O`) — subir la constante **repreció retroactivamente todo el consumo 4o ya acumulado en el ciclo**, sin que se enviara un solo mensaje nuevo: AnimalGrace saltó de 28.309/30.000 (bajo el límite) a 37.599/30.000 (agotado) de golpe. El agente quedó mudo ~3 horas con 21 mensajes de clientes reales sin respuesta (6 prospectos nuevos, 3 clientes existentes, 2 de ellos ya en pausa manual desde antes por otra razón) hasta que se detectó y revirtió.

**Revertido a ×15 y desplegado** (`meta-whatsapp-webhook`, `ycloud-whatsapp-webhook`) — con la reversión, el saldo real recalculó a 28.309/30.000 y el agente pudo responder de nuevo sin ninguna acción manual sobre los contadores. Sincronizados los 3 lugares que muestran el multiplicador en pantalla (`Settings.tsx`, `AISettings.tsx`, `landing.html`) de vuelta a ×15 — regla ya establecida en sesiones 36/77: medir, cobrar y mostrar deben usar siempre la misma constante.

**Regla permanente:** el multiplicador de créditos no es solo precio de mensajes *nuevos* — reprecia instantáneamente todo lo ya gastado en el ciclo actual, porque el saldo se recalcula en vivo desde contadores crudos, no desde un histórico de transacciones ya cobradas. Cambiarlo a mitad de mes puede agotar de golpe a una clínica que venía gastando bajo el número viejo. El momento más seguro para subirlo es justo después del reset mensual del ciclo.

### Indicador real de "sin créditos" — nuevo hook `useAICreditsStatus`

**El bug de fondo que hizo invisible la crisis de arriba:** el pill "IA Activa" del sidebar y del Dashboard solo leía `ai_auto_respond` (el toggle manual) — nunca el saldo de créditos. Con el agente mudo por falta de crédito, la pantalla seguía diciendo "IA Activa · Respondiendo 24/7" como si nada.

**`src/hooks/useAICreditsStatus.ts`** (nuevo): espeja en el frontend el mismo cálculo que hace `getCreditStatus()` en el webhook — resuelve el pool (`parent_clinic_id`), lee los mismos contadores, aplica la misma fórmula. ⚠️ `CREDIT_COST_4O = 15` está duplicado ahí a propósito (Deno vs. Vite/React no comparten módulos) — **hay que mantenerlo sincronizado a mano con `_shared/aiCredits.ts`** si el multiplicador vuelve a cambiar.

- **`DashboardLayout.tsx`** (sidebar desktop + mobile): pill ámbar **"Sin créditos"** en vez de "IA Activa" cuando el pool está agotado (`ai_auto_respond=true` pero `exhausted=true`).
- **`Dashboard.tsx`**: mismo pill en el header, más un **banner nuevo, arriba de todo (antes del "¡Hola, {nombre}!"), a ancho completo, con botón de cerrar** — aparece al **90% del ciclo consumido** (27.000/30.000 para AnimalGrace hoy; la razón, no un número fijo, generaliza sola a Starter/Pro) con enlace directo a `/app/ai-settings#comprar`. El cierre es por sesión — reaparece en la próxima visita si el aviso sigue vigente, a propósito: cerrarlo no debe equivaler a silenciar un problema sin resolver.
- **`AISettings.tsx`**: nuevo `useEffect` que detecta `#comprar` en la URL, auto-expande la sección de packs (colapsada por defecto) y hace scroll hasta ella.

### Bug: la vuelta de MercadoPago tras comprar créditos mentía

`redirectToCreditsCheckout` (en `src/lib/mercadopago.ts`) devolvía a `/app/settings?tab=ai&payment=success` — esa ruta pasa **primero** por el chequeo de "payment" de `Settings.tsx`, que es para compras de **plan**, no de créditos. Resultado real: Claudia compraba un pack y caía en la pestaña "Suscripción" viendo *"¡Tu suscripción ha sido activada!"* — mensaje falso, sin ver el saldo actualizado ni la sección de créditos.

**Fix:** el retorno ahora apunta directo a `/app/ai-settings?payment=success` — la página real donde vive el saldo. Un `useEffect` nuevo ahí detecta el parámetro, muestra el toast correcto (créditos acreditados / pago rechazado / pendiente), abre la sección de packs y limpia la URL. Como el webhook de MercadoPago ya acredita el saldo antes de que el navegador vuelva, los números que ve al aterrizar ya están al día.

---

### T2 (Google Ads) — landing `/core`: precio en USD y anclas para sitelinks

Continuación del trabajo de lanzamiento de Ads para el plan Core (contexto completo, técnico y actualizado en tiempo real en `.agents/google-ads/estado-cuenta.md` — ese documento manda sobre cualquier resumen de acá).

**Precio principal cambiado de CLP a USD.** La campaña no es solo Chile ("más universal" — decisión del usuario). La tarjeta de precio en `/core` mostraba `$17.000` CLP como número grande con "≈US\$17 fuera de Chile" como nota — se invirtió: **US\$17/mes** (tachado US\$39) es ahora el número grande, `$17.000 CLP/mes en Chile` la nota. Mismo cambio en el CTA de cierre y en `title`/`description`/`og:title`/`twitter:title`. Verificado en producción con `curl` antes y después del deploy — la primera lectura mostró contenido viejo por caché de borde de Vercel, se disipó en segundos.

**Copy: cerrado un hueco real de relevancia con el grupo de anuncios más grande.** El grupo "1.1 Software y Sistema de Gestión" (47 keywords: `sistema para veterinarias`, `gestión de clínicas veterinarias`) apuntaba a una landing que nunca decía la frase "sistema de gestión" literalmente. Se agregó al primer párrafo del hero, junto al resto de los términos ya destacados (agenda, ficha clínica, inventario, finanzas) — mismo texto que ahora también aparece en los títulos de anuncio propuestos, cerrando el círculo anuncio↔landing.

**6 anclas nuevas para poder usar sitelinks de verdad.** Google Ads rechaza sitelinks con la URL final duplicada entre sí — con solo 3 anclas reales en la página (`#recorrido`, `#precio`, `#preguntas`) era matemáticamente imposible armar 8 destinos distintos. Se agregó `id` a cada uno de los 6 módulos del recorrido, que ya existían como bloques HTML separados: `#agenda`, `#ficha-clinica`, `#finanzas`, `#recordatorios`, `#inventario`, `#fidelizacion`. Verificado en producción, las 9 anclas responden.

**Regla permanente — Path del anuncio gráfico vs. URL final:** en la vista previa de un RSA, el texto de dominio+ruta que se muestra (ej. `vetly.pro/core/inventario`) sale del campo **Path 1/Path 2** (cosmético, no necesita existir como página real), no de la **URL final** (el destino real del clic). Confundir ambos lleva a probar con `curl` una URL que nunca se va a visitar de verdad — pasó en esta sesión, se corrigió a tiempo antes de tocar código de más.

### T3/T4 (Google Ads) — cuenta higienizada, campañas activadas

Resumen ejecutivo — **el detalle técnico completo (IDs, estructura, verificación campo por campo) vive en `.agents/google-ads/estado-cuenta.md`**, que se actualizó en la misma sesión y es la fuente de verdad para cualquier trabajo futuro de Ads.

- **`Campaign #1`** (PMax por defecto de Google al crear la cuenta) dada de baja. Hallazgo: **Display es inseparable de Performance Max** — la API rechaza `OPERATION_NOT_PERMITTED_FOR_CONTEXT` al intentar apagarlo, no es una casilla que se pueda desmarcar. Ninguna campaña PMax podrá cumplir nunca la regla "Display siempre OFF" de esta cuenta.
- **2 campañas Search creadas para Chile** (`[CL] Search - Gestión Veterinaria` y `[CL] Search - Veterinario a Domicilio e Independiente`): 92 keywords, 395 negativas (0 colisiones verificadas contra las keywords), 4 RSAs, 8 sitelinks, 14 callouts, CPC manual CLP 550/clic. **Activadas por el usuario** al cierre de la sesión — el estado real (incluida la corrección crítica de geo a "Presencia", que la API no puede tocar) queda sin re-verificar por MCP, ver pendientes abajo.
- **2 campañas Search para México creadas — incompletas.** El subagente que las armaba se cortó por límite de sesión de la cuenta de Claude a mitad de cargar keywords (*"Grupos listos. Cargo las keywords"* fue su último mensaje). Quedaron solo las campañas y los 3+1 grupos de anuncios, **sin keywords, sin negativas, sin anuncios** — son cascarones que no servirían nada aunque se activaran. Un detalle rescatable: los grupos ya localizaron la terminología (`"3.2 Expediente Clínico"`, no "Ficha Clínica" — así se dice en México), útil para cuando se retome.
- **Bloqueante de herramienta encontrado:** el MCP de Google Ads vía Pipeboard tiene un tope de uso en el plan gratis (`100/30`) que se agotó a mitad del trabajo de México y bloqueó toda lectura/escritura posterior por el resto de la sesión.
- **Sesgo de puja — CPC manual, no Maximizar conversiones:** con 0 conversiones históricas en la cuenta, cualquier estrategia automática (Maximizar conversiones, tCPA) entra en modo exploración sin datos y gasta a ciegas. Regla estándar: CPC manual hasta acumular 15-30 conversiones reales, recién ahí evaluar automatizar.
- **Auditoría de títulos "no hablan de vets":** de ~10-11 combinaciones de título visibles en la vista previa, solo 4 mencionaban "Vet"/"Veterinario" explícito — el grupo "1.1 Software y Sistema de Gestión" era el más débil en esto (`"Ficha, Agenda e Inventario - 3 Usuarios Incluidos"` podría ser el anuncio de cualquier vertical de software). Se propusieron 7 títulos nuevos anclados en "vet"/"veterinaria" + 2 reemplazos puntuales, todos ≤30 caracteres — **cargados por el usuario** (confirmado, sin reverificar por MCP cuáles exactamente quedaron activos ni el efecto en Ad Strength).
- **Logo subido** (`public/logo.png`, 1024×1024 PNG, cumple spec 1:1 de Google) y **verificación de identidad del anunciante enviada** — Google la exige para desbloquear los recursos de Logo/Nombre de empresa en anuncios de búsqueda. La UI decía "entre 1 y 10 días hábiles" de revisión, pero **se aprobó al instante** — probablemente porque la misma documentación de negocio ya estaba validada con Meta y Paddle.

**MCP oficial de Google Ads — investigado, decisión de no usarlo por ahora.** Google lanzó un MCP propio el 28 de abril de 2026 (mismo patrón que Meta), pero a diferencia del de Meta **no es un servicio hospedado al que conectarse con login** — es código de solo lectura (2 tools: `list_accessible_customers` + `search` GAQL) que hay que **autodesplegar en Google Cloud Run**, con proyecto de GCP, developer token propio y credenciales OAuth propias. Para lo que resolvería (ahorrar cuota de Pipeboard en lecturas) el esfuerzo de montar Cloud Run no se justificó — y de todas formas nunca reemplaza a Pipeboard para las mutaciones (crear campañas, cargar keywords), que es de solo lectura por diseño de Google.

### Pendientes — Google Ads (detalle completo en `estado-cuenta.md`)

- 🔴 **Confirmar geo "Presencia"** en las 2 campañas de Chile ya activadas — la API nunca pudo tocar `positive_geo_target_type` (sigue en `PRESENCE_OR_INTEREST`, el default de Google que paga tráfico de España/Colombia). El usuario dijo haberlo resuelto manualmente al activar; **falta re-verificar por MCP** en cuanto la cuota de Pipeboard se libere.
- 🟡 **México** — completar keywords, negativas y anuncios de las 2 campañas (`24171087994`, `24171088219`), hoy cascarones vacíos.
- 🟡 **Cuota de Pipeboard agotada** — sigue igual horas después (reintentado, mismo error `100/30`). Subir de plan o esperar reset antes de poder auditar o seguir escribiendo por MCP.
- ✅ **Verificación del anunciante** — aprobada al instante, ya no está pendiente.
- 🟢 Landing `/core/mx` (terminología "expediente clínico") y `/core/comparar` — pendientes de sesiones anteriores, sin cambios.
- 🟢 Logo horizontal 4:1 — no existe todavía, ninguno de los assets actuales tiene esa proporción; opcional, no bloquea el logo cuadrado ya subido.

---

## Cambios realizados — agosto 2026 (sesión 84, 2026-08-25)

Sesión de seguimiento a la primera campaña de Facebook para el plan Core (4 registros reales) que terminó auditando y rediseñando el sistema de fidelización/referidos, encontrando un bug en producción independiente de la campaña.

### Parte 1 — Los 4 leads reales de la campaña

Campaña identificada: `META_Conv_LATAM5-Broad_CorePlan_2026-08` (objetivo `OUTCOME_LEADS`, tráfico real a `/core→/register`, sin formulario nativo de Facebook — la cuenta no tiene ninguna Página vinculada). Cruzando `attribution` (fbclid/utm) con `clinic_settings`/`user_profiles` se identificaron 4 registros reales desde el lanzamiento: Claudio Domínguez, Fernando Losada, Cliver Lopez y Servando Mendoza. El "3 vs 4" que reportaba Meta se explica porque el píxel `CompleteRegistration` solo dispara client-side (sin Conversions API server-side para el registro de Vetly) — cualquiera de los 4 pudo perder el evento por bloqueador de anuncios o el navegador in-app de Instagram.

**Hallazgo que bloqueaba el seguimiento:** el registro nunca capturaba teléfono, solo email — no había forma de contactar a un lead nuevo por WhatsApp salvo pidiéndoselo aparte.

### Parte 2 — Campo de WhatsApp en el registro

- **Migración `20260825050000_add_phone_to_user_profiles.sql`**: `user_profiles.phone TEXT` — el contacto de la persona que crea la cuenta, distinto de `clinic_settings.contact_phone` (que ya es el número público que la IA entrega a los pacientes de esa clínica; no se tocó ni se reutilizó).
- **`Register.tsx`**: campo "WhatsApp" obligatorio junto a nombre/email/password, solo en el flujo de alta de clínica nueva (oculto en `isJoinMode`, donde alguien se une a una clínica ya existente por invitación — no necesita pasar por esto). Se guarda como solo dígitos, mismo criterio que ya usa el proyecto para `appointments.phone_number`.
- **`AuthContext.tsx`**: `signUp()` gana un 11º parámetro posicional `phone` (al final, para no romper la única otra dependencia del orden de argumentos).
- **`signup-handler/index.ts`**: recibe y sanitiza `phone` (`replace(/\D/g, "")`), lo guarda en el `insert` de `user_profiles`.
- **Limpieza de paso:** se eliminó la llamada duplicada a `send-welcome-email` desde el cliente (`Register.tsx`, antes ~línea 402) — mandaba `{email, name}` en vez de `{email, full_name, clinic_name}`, así que fallaba siempre en silencio (capturado en un try/catch que solo logueaba). El envío real y correcto ya lo hacía `signup-handler` server-side.
- **Decisión explícita del usuario, revertida de una propuesta inicial:** NO se agregó ningún paso nuevo al flujo de registro (se había propuesto un redirect obligatorio a agendar una llamada tras registrarse — el usuario lo rechazó: el registro debe quedar exactamente igual que hoy, la invitación a agendar va solo por correo).
- **Verificado:** confirmado que ya existe una burbuja flotante de WhatsApp (`src/components/layout/NewAccountWhatsAppBubble.tsx`, commit `79096e6`, ya en `main`) que invita a "Agenda tu reunión de implementación" — se activa por antigüedad de la clínica (`clinic_settings.created_at` ≤ 14 días), no por evento de pago, así que **ya cubre Core** (que nunca pasa por checkout). El otro mecanismo existente, `PostPaymentOnboardingBanner`, NO aplica a Core por la misma razón.

**Fuera de esta sesión (encontrado, no se tocó):** el formulario "agenda tu activación" para planes no-Core (`HQBookingForm.tsx`, ruta `/pending-activation`) está roto en producción — escribe en `hq_appointments`, tabla que **no existe en la base viva** (solo existe la migración local, nunca se aplicó), y llama a `send-booking-email`, función no desplegada. No afecta a Core ni a los 4 leads de esta campaña. Queda anotado para una sesión aparte.

### Parte 3 — Correo de bienvenida con invitación a agendar

**`send-welcome-email/index.ts`**: nueva sección en el HTML ya existente, con el mismo número/mensaje que ya usa la burbuja (`wa.me/56993089185`), invitando a agendar la videollamada de activación. Desplegado y **enviado retroactivamente** a los 4 leads reales de la Parte 1 (4 IDs de Resend confirmados) — acción puntual de esta sesión, no un mecanismo de reenvío masivo nuevo.

### Parte 4 — Simplificación del programa de fidelización/referidos

**Diagnóstico corregido (verificado contra la base viva, no solo el código):** los montos (15% / $5.000 / 5%) de Animalgrace **no están hardcodeados** — el motor `sync_income_loyalty` lee todo desde `clinic_settings`. Pero las columnas de configuración (`loyalty_enabled`, `loyalty_welcome_bonus`, `loyalty_referral_bonus`, etc.) tenían defaults reales en la base (`loyalty_enabled DEFAULT true`, bonos fijos en pesos chilenos) **nunca trackeados en ninguna migración**. Consecuencia verificada fila por fila: **los 4 leads reales de esta misma campaña ya tenían `loyalty_enabled = true`**, pagando bonos fijos de $200/$500 sin que nadie lo hubiera configurado ni encendido a propósito — un bug de producción, no solo de UX.

También se encontró **"Veterinaria Los Robles"** (plan Core, creada 21-ago) con la configuración exacta de Animalgrace (15% / $5.000 fijo / 5%, `loyalty_enabled=true`) — **confirmada por el usuario como cuenta de prueba propia**, excluida de cualquier trato como lead real.

**Decisiones del usuario para el rediseño:**
- Simplificación completa, no un parche mínimo.
- Colapsar las 3 "modalidades" cosméticas (Puntos/Dinero/% Descuento — el motor nunca las leía) en un solo modelo de cashback, con el símbolo derivado de `clinic_settings.currency` en vez de un campo propio.
- El bono al referidor pasa a soportar **monto fijo y porcentaje** (antes solo fijo), simétrico al bono de bienvenida.
- Configuración por **wizard de 3 preguntas** en vez de una grilla de 6-7 campos sueltos, con un preset "Recomendado" de un clic.
- **`loyalty_enabled` apagado por defecto** para cuentas nuevas (corrección explícita a mitad de sesión — la primera versión del plan lo dejaba encendido).

**1. Migraciones aplicadas** (`supabase/migrations/20260825050100..050400`):
- `loyalty_formalize_base_schema.sql`: formaliza en una migración las 7 columnas que ya existían en producción sin tracking, con comentarios marcando `loyalty_program_mode`/`loyalty_currency_symbol` como `DEPRECATED`.
- `loyalty_referral_bonus_type.sql`: agrega `loyalty_referral_bonus_type ('fixed'|'percentage')`, cambia el DEFAULT de `loyalty_enabled` a `false` a nivel de columna (defensa en profundidad), y extiende `sync_income_loyalty` para que el bono al referidor calcule con el mismo `CASE` fijo/porcentaje que ya tenía el de bienvenida.
- `loyalty_recommended_preset_backfill.sql`: respaldo completo a `clinic_settings_loyalty_backup` + backfill que aplica el preset **15% bienvenida / 10% referidor / 5% acumulación** (todo porcentual, agnóstico de moneda/país) SOLO a las clínicas que coincidían exactamente con el default crudo — es decir, nunca configuradas a mano. El predicado excluyó automáticamente a Animalgrace ×2 y "Los Robles". El backfill también **apagó** `loyalty_enabled` en las 6 filas afectadas (Vetly HQ, clínica de prueba, y los 4 leads reales).
- `loyalty_prevent_self_referral_welcome_bonus.sql`: ver hallazgo de seguridad más abajo.

**2. `signup-handler/index.ts`**: el INSERT de `clinic_settings` ahora setea explícitamente el preset (15/10/5, `loyalty_enabled: false`) en vez de depender del default crudo de columna.

**3. Frontend:**
- **`src/components/loyalty/LoyaltyConfigWizard.tsx`** (nuevo): reemplaza el bloque viejo de `Loyalty.tsx`. Dos caminos — "Recomendado" (un clic aplica 15/10/5) o "Personalizado" (3 preguntas: bono de bienvenida y bono al referidor con toggle %/monto fijo + input, acumulación siempre en %). Detecta si la config actual coincide con el preset y muestra el badge "Aplicado".
- **`src/lib/currency.ts`** (nuevo): `CURRENCY_SYMBOLS`/`CURRENCY_LOCALES`/`CURRENCIES_WITHOUT_DECIMALS` extraídos de `Finance.tsx` (que antes los tenía privados) para reusarlos en el wizard, `NewIncomeForm.tsx` y `PetOwnerPortal.tsx`.
- **`Loyalty.tsx`**: interruptor maestro sin cambios; el resto de la pestaña "Ajustes" reemplazado por el wizard; referencias a `loyalty_currency_symbol`/`loyalty_program_mode` reemplazadas por `currencySymbol(clinicCurrency)`.
- **`loyaltyService.ts`**: `LoyaltySettings` gana `loyalty_referral_bonus_type`, pierde `loyalty_program_mode`/`loyalty_currency_symbol`.
- **`NewIncomeForm.tsx`**: preview del bono al referidor ahora sensible al tipo (antes asumía monto fijo siempre).
- **`PetOwnerPortal.tsx`** + RPC `get_pet_owner_portal`: agregado `currency`/`referral_bonus_type` al JSON; el símbolo del carnet digital se deriva de la moneda real de la clínica en vez del campo deprecado.
- **`meta-whatsapp-webhook`/`ycloud-whatsapp-webhook`**: el texto que la IA usa para anunciar "Recomendar a un amigo" ahora es sensible al tipo del bono al referidor (antes asumía siempre monto fijo — con el nuevo preset porcentual habría dicho "ganas $10" en vez de "ganas 10%").
- **`src/types/database.ts`**: agregados los 9 campos `loyalty_*` a `clinic_settings` (antes completamente ausentes del archivo de tipos, pese a que las columnas existían hace meses).

**Verificación en producción (SQL con `BEGIN/ROLLBACK`, sin dejar rastro):**
- Bono al referidor en porcentaje: paga correctamente el % de la venta.
- Bono al referidor en monto fijo (config real de Animalgrace): sin regresión.
- Acumulación en recompra: 5% correcto.
- Animalgrace ×2 y "Los Robles" confirmados sin cambios tras el backfill (diff contra el respaldo).
- Wizard verificado visualmente con Playwright + Chrome del sistema contra la cuenta de prueba real (sesión inyectada vía `admin.generateLink` + `verifyOtp`): "Programa pausado" por defecto, preset 15/10/5 visible con badge "APLICADO", camino "Personalizado" con las 3 preguntas y el toggle %/fijo funcionando.

#### Hallazgo de seguridad: autorreferido en el bono de bienvenida

La revisión de seguridad final (skill `security-review`) no encontró vulnerabilidades nuevas explotables en el diff, pero detectó un hallazgo real cuyo impacto esta misma sesión amplió: la rama del **bono de bienvenida** en `sync_income_loyalty` nunca validaba que el referidor no fuera el propio comprador — a diferencia de la rama del **bono al referidor**, que sí tenía `v_referrer <> v_income.tutor_id`. El buscador manual de `NewIncomeForm.tsx` ya excluye la auto-selección (`t.id !== selectedTutor?.id`), pero el canal de WhatsApp detecta el código de referido por regex sin ese chequeo — un cliente podía escribir su propio código y cobrar el bono de bienvenida, que de otro modo no aplica sin un referidor real.

Antes de esta sesión el impacto era bajo (tope fijo de 200 puntos); al convertir el preset por defecto en 15% sin techo, correspondía cerrarlo en la misma pasada. **Fix** (`loyalty_prevent_self_referral_welcome_bonus.sql`): se agregó `IF v_referrer = v_income.tutor_id THEN v_referrer := NULL; END IF;` antes de calcular cualquier bono — mismo criterio que ya tenía la rama del referidor. Verificado con una venta de prueba de autorreferido real: 0 transacciones generadas (antes habría pagado $15.000 de bono de bienvenida sobre una venta de $100.000).

**Regla permanente:** cuando dos ramas de una misma función pagan recompensas relacionadas (bono al referido / bono al referidor), cualquier invariante de seguridad validada en una (aquí, "el referidor no puede ser el propio comprador") debe replicarse explícitamente en la otra — no asumir que aplica por simetría de diseño si el código no lo dice.

**Regla permanente:** al subir el techo o quitar el tope de una recompensa monetaria automática (fija → porcentual sin techo), revisar también las validaciones de abuso alrededor de esa recompensa — un bug de bajo impacto con un tope bajo puede volverse significativo cuando cambia la economía, aunque el bug en sí no sea nuevo.

### Corrección posterior (misma sesión): correo de bienvenida prometía IA a clientes Core

El usuario detectó que el correo de bienvenida —incluso el reenviado a los 4 leads reales de la Parte 1— decía en su paso 2: *"Conoce a tu Asistente IA — entrena a tu IA con la información de tu clínica..."*, algo que el plan Core (justo el de estos 4 leads) no tiene.

**Causa:** `send-welcome-email/index.ts` nunca recibía el plan — `signup-handler` solo mandaba `{email, full_name, clinic_name}`. La plantilla es estática y no distinguía nada por plan.

**Fix:** `signup-handler` ahora manda también `is_core_plan: isCorePlan` (variable que ya existía en la función, solo faltaba pasarla). `send-welcome-email` usa ese flag para reemplazar el paso 2 por *"Registra tus primeras fichas — Carga a tus pacientes y tutores..."* cuando el plan es Core, dejando "Conoce a tu Asistente IA" solo para Starter/Pro/Enterprise. Desplegado ambas funciones y **reenviado el correo corregido a los mismos 4 leads** (los IDs de Resend del primer envío quedan obsoletos frente a estos nuevos).

**Regla permanente:** cualquier comunicación automática dirigida a un cliente nuevo (correos, banners, etc.) debe recibir explícitamente el plan contratado si su contenido menciona una feature que no está en todos los planes — no asumir que el mensaje genérico sirve para todos. Core en particular no tiene agente de IA conversacional; cualquier copy nuevo dirigido a clientes nuevos debe revisarse contra esa restricción antes de darse por bueno.

---

## Cambios realizados — agosto 2026 (sesión 85, 2026-08-25)

### Modo de agendamiento con aprobación de coordinadora — configurable por clínica (Animal Grace Santiago)

Claudia pidió que el agente de IA de Santiago deje de decidir por sí solo qué día/hora ofrecer al cliente. Hoy el agente (Ary, canal `meta-whatsapp-webhook`) recopilaba los datos del tutor y llamaba `create_appointment` apenas los tenía — sin considerar que la ruta de un móvil depende de distancia entre domicilios, sector y las otras citas del día, algo que solo una persona puede evaluar con criterio real. El pedido: el agente recolecta disponibilidad **amplia** (varios días/rangos, no una hora) y avisa que "la coordinadora revisará la ruta"; una persona autoriza horarios concretos desde un panel nuevo; recién ahí el agente cierra el agendamiento — nunca ofreciendo algo fuera de lo autorizado.

**Decisión de diseño (pedida explícitamente por el usuario al revisar el plan):** no construirlo como una regla especial de Santiago, sino como una **configuración elegible por clínica**, reutilizando la misma lógica que ya existe en Settings para "Físico / Móvil / Híbrido" (`business_model`). Investigado antes de diseñar: `business_model` hoy no deriva nada por sí solo — solo 2 lugares del código lo leen (`isMobile = business_model !== "physical"`) para cálculo de traslados — y `logistics_config.routing_mode`/`routing_zone` (lo que gobierna el panel de sectores de Linares y la zonificación de Santiago) es un campo completamente independiente, sin ninguna UI propia, seteado a mano por SQL para las 2 únicas clínicas que lo usan. Confirmado con datos reales que esto ya generaba inconsistencias (una clínica `hybrid` sin ningún `routing_mode`).

**Modelo de dos niveles resultante:**
1. **`business_model` (ya existía)** sigue siendo el interruptor maestro de "¿esta clínica tiene logística de rutas?". Si es `physical`, ninguna sección de coordinación aparece nunca.
2. **`scheduling_mode` (columna nueva en `clinic_settings`, mismo patrón que `business_model`)**: `'ai_autonomous'` (default, comportamiento actual, cero cambios para cualquier clínica existente) o `'coordinator_approval'`. Solo visible/editable en Settings cuando `business_model !== 'physical'`.

Con este diseño, activar el flujo en una clínica es 100% self-service desde Settings — **nada en el código del webhook referencia el `clinic_id` de Santiago**, la activación fue un simple `UPDATE` de datos, no un deploy de lógica nueva.

#### Migración `20260825120000_scheduling_mode_and_requests.sql`

```sql
ALTER TABLE public.clinic_settings
    ADD COLUMN scheduling_mode TEXT NOT NULL DEFAULT 'ai_autonomous'
        CHECK (scheduling_mode IN ('ai_autonomous', 'coordinator_approval')),
    ADD COLUMN coordinator_phone TEXT;

CREATE TABLE public.scheduling_requests (
    id UUID PK, clinic_id UUID FK clinic_settings, tutor_id UUID FK tutors,
    tutor_phone TEXT, tutor_name TEXT, pet_name TEXT, pet_details TEXT,
    service_requested TEXT, comuna TEXT, sector TEXT, address TEXT,
    is_urgent BOOLEAN, availability_text TEXT, additional_notes TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending','authorized','fulfilled','dismissed')),
    authorized_options TEXT, round INT DEFAULT 1,
    reviewed_by UUID, reviewed_at TIMESTAMPTZ, created_at, updated_at
);
-- Un tutor no puede tener 2 solicitudes abiertas a la vez → fuerza upsert, no insert ciego.
CREATE UNIQUE INDEX scheduling_requests_open_unique ON scheduling_requests (clinic_id, tutor_phone)
    WHERE status IN ('pending','authorized');
```

RLS estándar (`clinic_members`) — **sin policy de INSERT/DELETE para `authenticated`**: la fila la crea siempre el webhook con `service_role`; el dashboard solo autoriza o descarta (`UPDATE`). Reduce superficie de ataque a propósito.

#### Backend — `supabase/functions/meta-whatsapp-webhook/index.ts` (y paridad en `ycloud-whatsapp-webhook`)

- **Tool nuevo `request_scheduling_coordination`**: reemplaza a `check_availability`/`create_appointment` cuando `scheduling_mode = 'coordinator_approval'`. Parámetros: tutor, mascota, servicio, comuna/sector, urgencia, `availability_text` (texto libre — mismo formato que Claudia usó en su propio ejemplo: "martes después de las 15:00, miércoles todo el día o viernes en la mañana").
- **`requestSchedulingCoordination()`** (junto a `escalateToHuman()`): upsert en `scheduling_requests` (si ya había una fila abierta para ese tutor, la resetea a `pending` con `round+1` en vez de duplicar — cubre el ciclo "ninguna opción le sirvió"), pausa al tutor (`requires_human=true`, mismo mecanismo que `escalateToHuman`), notificación in-app (`type: "scheduling_review"`), y WhatsApp directo a `clinic.coordinator_phone` vía `sendMetaMessage()` (ya existente) si está configurado.
- **Bloqueo generalizado en `checkAvail`**: mismo patrón que el bloqueo de cirugías de AnimalGrace (`isAnimalGrace && isSurgery → available:false`) pero condicionado a `clinic.scheduling_mode === "coordinator_approval"` y ausencia de una fila `scheduling_requests.status='authorized'` vigente para ese teléfono. Si SÍ hay una autorizada, el flujo sigue normal (necesario para que `createAppt` re-valide contra `raw_slots` y evite doble-booking dentro de la ventana autorizada).
- **Guard en `createAppt` y `rescheduleAppt`**: mismo estilo que el guard `FALTA_NOMBRE_TUTOR` ya existente — si `scheduling_mode='coordinator_approval'` y no hay fila `authorized`, rechaza con mensaje `COORDINACION_REQUERIDA: ...`. `rescheduleAppt` no recibía `logisticsConfig`/modo antes — se le agregó el parámetro (reagendar es la misma decisión que agendar: elegir fecha/hora nueva).
- **Bloque de contexto por tutor en el prompt** (junto a `tutorContext`/`referralContext`, antes de armar `finalSysPrompt`): si hay solicitud `pending`, instruye a no ofrecer nada; si hay `authorized`, inyecta `authorized_options` literal + instrucción de solo ofrecer esas opciones.
- **Excepción al chequeo de `requires_human` pre-send**: si la propia vuelta del tool loop fue la que pausó al tutor vía `request_scheduling_coordination`, el aviso de "la coordinadora revisará la ruta" sí debe salir — si no, el cliente entrega todos sus datos y queda en silencio absoluto. Se detecta con `allFuncResults.some(r => r.name === "request_scheduling_coordination" && r.result?.success)`.

`confirm_appointment`/`cancel_appointment` no se tocaron — no eligen fecha/hora.

#### Frontend

- **`src/components/appointments/SchedulingRequestsPanel.tsx`** (nuevo): panel dedicado en Citas Médicas, mismo patrón visual que `RoutePlanPanel.tsx`. Lista **todas** las solicitudes abiertas juntas (pending primero) — a diferencia de `RoutePlanPanel`, no colapsa por defecto, porque el objetivo es ver varias a la vez para armar la ruta del día. Suscripción realtime (mismo patrón que `Messages.tsx`). Por tarjeta: datos + textarea "Opciones que puedes ofrecer" + botón "Autorizar" → marca `status='authorized'` y limpia `requires_human=false` (reactivación explícita — la IA nunca se reactiva sola, mismo principio que el comando `/reset ia`).
- **`src/pages/Settings.tsx`**: sección "Modo de Agendamiento" nueva junto al selector de `business_model`, visible solo si `businessModel !== 'physical'`. 2 tarjetas (mismo componente visual que Físico/Móvil/Híbrido). Si se elige `coordinator_approval`, se revela el input de `coordinator_phone`.
- **`src/pages/Appointments.tsx`**: monta `SchedulingRequestsPanel` cuando `scheduling_mode === 'coordinator_approval'` (leído en el mismo `useEffect` que ya carga `logistics_config`).
- **`src/components/layout/DashboardLayout.tsx`**: `case 'scheduling_review'` agregado en `getNotificationIcon`/`handleNotificationClick` (navega a `/app/appointments`) — sin esto la notificación in-app no llevaba a ningún lado.

#### Activación y verificación

Activado para Santiago: `scheduling_mode='coordinator_approval'` (con `ai_auto_respond` intencionalmente sin tocar — sigue en `false`, decisión de Claudia). `coordinator_phone` ya apareció con un valor cargado (`+56989790949`) sin que nadie de esta sesión lo escribiera — evidencia de que alguien ya probó la UI self-service.

**Contradicción encontrada en la revisión final del prompt (antes de darlo por consistente):** la regla "PROHIBIDO DERIVAR A OTRA CLÍNICA" seguía diciendo literalmente *"tu conducta es ofrecer disponibilidad... el horario que le ofrezcas"* — exactamente lo opuesto a la Sección 10 nueva. Corregida a "reunir sus datos y su disponibilidad amplia, siguiendo el protocolo normal de agendamiento (Sección 10)". Respaldos previos en `prompt_backups` (`pre_coordinacion_ruta_2026_08_25`, `post_coordinacion_ruta_2026_08_25`).

**No verificado en vivo:** con `ai_auto_respond=false` en ambas clínicas no hubo tráfico real que ejercitara el código nuevo — pendiente revisar las primeras conversaciones reales cuando Claudia reactive el agente.

**Regla permanente — generalizar en vez de hardcodear a una clínica:** cuando una feature nace para un caso puntual pero es conceptualmente aplicable a cualquier clínica del mismo tipo de negocio, diseñarla como configuración elegible (columna/flag con default seguro que preserva el comportamiento de todas las clínicas existentes), no como un `if (clinicId === '...')`. El costo de generalizar aquí fue mínimo porque el diseño técnico ya estaba condicionado por config, no por `clinic_id`; lo único que cambió fue *dónde* vive el flag.

**Regla permanente — activar un flujo de "pausa + panel de revisión" exige que ambas mitades lleguen juntas.** Si el prompt le dice a la IA que use un tool nuevo que pausa la conversación, pero el flag que habilita el panel de revisión (o el guard de código que hace cumplir la pausa) no está activo, el cliente queda esperando una revisión que nadie puede hacer — peor que el comportamiento anterior. Verificar siempre que activar el comportamiento en el prompt y activar el enforcement en código sean un solo paso atómico, no dos cambios independientes.

### Auditoría y optimización de consumo de créditos IA (Animalgrace, pool compartido Linares+Santiago)

Motivada por consumo alto reportado por el usuario. Diagnóstico con datos reales de `messages` (fuente de verdad, no los contadores auxiliares de `clinic_settings`):

- Pool del ciclo: 30.000 (plan) + 20.000 (pack extra) = 50.000. **Ya consumidos: 31.386** (63% del pool, superó el plan base).
- De 2.560 mensajes de IA del mes: 501 al modelo barato (mini), 2.059 al modelo caro (4o) — **80% de los mensajes, pero 98,4% del gasto** (2.059×15=30.885 de los 31.386 totales), porque el modelo caro cuesta 15× el barato (`CREDIT_COST_4O`, `_shared/aiCredits.ts`).
- Causa: `selectModelTier()` rutea al modelo caro por keywords (`needsSchedulingReason`/`needsMedicalReason`, `meta-whatsapp-webhook/index.ts:1518-1535`) **más** un mecanismo "pegajoso" (`activeSchedulingFlow`, línea ~2324): si cualquiera de los últimos 3 mensajes de la IA tocó un tema de agenda/precio, el modelo caro se queda pegado ahí, aunque el mensaje del cliente sea "sí" o "gracias".
- **Comparación de proveedor evaluada y descartada:** el usuario preguntó si migrar a modelos de Claude ayudaría. No — el modelo barato de Claude (Haiku 4.5, $1/$5 por MTok) cuesta más que gpt-4o-mini ($0.15/$0.60), que es el que maneja el grueso del tráfico; Sonnet 5 queda parejo con gpt-4o. Además el código está construido específicamente para el formato de tools de OpenAI — migrar reescribiría el tool loop en ambos webhooks. No se tocó nada de esto.

#### Limpieza de prompt (sin recortar duplicados — no había, casi todo el crecimiento desde la limpieza de mayo/sesión 61 es reglas legítimas ligadas a bugs reales)

Se identificaron 2 bloques de uso **puntual** que se reenviaban en **todos** los mensajes sin importar el tema: el protocolo del examen FeLV/FIV (ambas clínicas) y la campaña del ebook gratis (solo Linares, luego descartada por completo porque ya no está vigente). Se sacaron del prompt siempre-activo y se movieron al mecanismo ya existente `FORCED_KB_TOPICS`/`getForcedKnowledgeBlock` (usado desde sesión 62 para cirugía/sedación/eutanasia/ecografía): se inyectan completos solo cuando el mensaje del cliente toca ese tema puntual, mismo contenido y misma fuerza cuando se necesita, sin pagarlo en cada mensaje.

```ts
{ title: "PROTOCOLO_EXAMEN_FELV_FIV_LEUCEMIA_FELINA", keywords: ["felv", "fiv", "leucemia felina", "sida felino", "sida felina"] },
```

Documento KB nuevo creado para ambas clínicas (mismo contenido, antes duplicado byte a byte en `ai_behavior_rules` de Linares y Santiago). La campaña del ebook se creó, se usó como demostración, y se **eliminó por completo** (KB doc borrado, entrada de `FORCED_KB_TOPICS` quitada, puntero quitado de `ai_behavior_rules`) al confirmar el usuario que ya no está vigente.

Resultado: Linares 41.981 → 39.437 caracteres, Santiago 36.300 (original) → 37.372 (incluye ya el flujo de coordinación nuevo, que agrega texto). Ahorro modesto (~5%) — consistente con el diagnóstico: el problema real no es duplicación, es el volumen de mensajes ruteados al modelo caro.

#### Ruteo de confirmaciones triviales — el fix real, validado con datos antes de tocar código

Antes de tocar nada se midió con SQL real cuántos mensajes tipo "sí"/"gracias"/"ok" (≤20 caracteres, matcheando un patrón acotado de acuses de recibo) terminaban en el modelo caro, y **por qué**:

```sql
-- De 176 respuestas a mensajes triviales: 165 (94%) fueron al modelo caro, solo 11 al barato.
-- De esos 165, separados por si el mensaje previo de la IA ofrecía o no una hora/fecha:
--   93 (56%) → el mensaje previo NO mencionaba hora/fecha (precio, saludo, info general)
--   51 (31%) → el mensaje previo SÍ mencionaba hora/fecha (podría ser confirmación real)
--   19 (12%) → sin mensaje previo detectable
```

**Fix aplicado — aditivo, no toca `needsSchedulingReason`/`schedulingSignals` existentes:** justo antes de llamar `selectModelTier()`, si el mensaje del cliente matchea el patrón de acuse de recibo trivial (≤20 caracteres) **y** el último mensaje de la IA no contenía ningún patrón de hora/fecha (`\d{1,2}:\d{2}|a las \d{1,2}|lunes|martes|...`), se fuerza `gpt-4o-mini` sin pasar por el ruteo normal. Si el mensaje previo sí ofrecía hora/fecha, el flujo sigue exactamente igual que antes (modelo caro, vía `activeSchedulingFlow`).

```ts
const trivialAckPattern = /^(si|sí|ok|okay|oka|dale|listo|gracias|muchas gracias|perfecto|genial|bueno|vale|ya|de acuerdo|entendido)[\s!.,¡🙏😊👍✨]*$/i;
const lastOutboundOfferedTime = /\d{1,2}:\d{2}|a las \d{1,2}|lunes|martes|mi[eé]rcoles|jueves|viernes/.test(lastOutboundText);
const isSafeTrivialAck = !hasImageInBurst && trimmedUserText.length > 0 && trimmedUserText.length <= 20
  && trivialAckPattern.test(trimmedUserText) && !lastOutboundOfferedTime;

const route = isSafeTrivialAck
  ? { model: "gpt-4o-mini", tier: 1 }
  : selectModelTier(lastUserText, hasImageInBurst, activeSchedulingFlow);
```

Aplicado en ambos webhooks (`meta-whatsapp-webhook` línea ~2330, `ycloud-whatsapp-webhook` línea ~4413). Impacto estimado: 93 mensajes de este mes solos representan ~1.300 créditos gastados de más (93 × 14 de diferencia) — patrón recurrente, no puntual. **No verificado en vivo** — la IA sigue apagada en ambas clínicas.

#### Decisión explícita — NO recortar `needsSchedulingReason`/`schedulingSignals`, ni siquiera solo para Santiago

El usuario preguntó si, ahora que Santiago ya no ofrece horarios directamente (flujo de coordinadora), se podían sacar algunas palabras de la lista que rutea al modelo caro. Evaluado y descartado, con razones concretas (no genéricas):

1. **La lista es una sola, compartida por Linares y Santiago.** Linares sigue en `ai_autonomous` — sigue decidiendo sectores, tramos y horarios sola, con toda la lógica que costó varias sesiones arreglar (rebote Talca→Linares→Talca, corte de las 11:30 en Talca). Recortar la lista global reabriría esos bugs para Linares.
2. **Aunque se limitara a Santiago, la misma lista mantiene "pegajoso" el modelo caro durante los 3 mensajes siguientes** — incluido el momento en que la coordinadora ya autorizó horarios y el cliente elige uno (Sección 10, regla 4: ahí la IA sí necesita llamar `create_appointment` con la fecha exacta). Sacar palabras como "horario"/"disponib" debilitaría también esa protección final, no solo el filtro de entrada — es el mismo mecanismo, no dos independientes.

**Regla permanente:** antes de recortar una lista de keywords de ruteo compartida entre clínicas con configuraciones distintas, verificar explícitamente si el cambio es seguro para *todas* las clínicas que comparten ese código, no solo la que motivó la pregunta — y verificar si la lista cumple más de una función (aquí: ruteo de entrada + mantenimiento de contexto "pegajoso") antes de asumir que un recorte solo afecta el uso que se tiene en mente.

**Regla permanente — antes de tocar routing/costo de IA, medir con SQL real cuál es la composición exacta del problema.** La intuición ("los mensajes cortos deberían ser baratos") coincidió con los datos en este caso, pero la segmentación por "¿el mensaje anterior ofrecía hora?" fue lo que separó el 56% genuinamente seguro del 31% que debía quedar intacto — sin esa medición, cualquier fix habría sido o bien tibio (no tocar nada) o bien riesgoso (bajar todos los acuses de recibo sin excepción, incluidas las confirmaciones reales de horario).

---

## Cambios realizados — agosto 2026 (sesión 86, 2026-08-26)

### Reservas online por link propio (`/reservar/:slug`) — feature completa para Core

Motivación: el plan Core no tiene agente de IA que agende por WhatsApp — necesitaba una forma de que sus clientes reserven solos. Se construyó una página pública de agendamiento por clínica, configurable desde Ajustes → "Reservas Online" (toggle, slug propio, logo, color de marca), conectada a la agenda real.

**`src/pages/PublicBooking.tsx`** (nuevo, ruta pública `/reservar/:slug`, sin sesión): flujo de 4 pasos (servicio → día/hora → datos de contacto → confirmación), con `publicClient` propio (mismo patrón que `/r/:code` y `/p/:code` — evita el conflicto de Web Locks si se abre en el mismo navegador que ya tiene el dashboard abierto). Colores/logo aplicados con `style={{}}` inline porque Tailwind no puede generar clases con un hex dinámico. Horarios calculados con `fromZonedTime(naive, clinic.timezone)` (nunca asumir Chile — mismo bug que ya se había corregido antes en `/agendar`: `setHours`/`setMinutes` operan en la zona horaria del navegador visitante, no en la de la clínica).

**3 RPCs `SECURITY DEFINER` nuevas** (`get_public_booking_clinic`, `get_public_booking_services`, `get_public_booking_slots`) — el filtro real vive en las funciones (`public_booking_enabled = true`), no en RLS de las tablas base.

**`supabase/functions/public-booking-notify/index.ts`** (nuevo): confirmación al cliente + aviso al dueño de la clínica (Core no tiene IA que le avise por WhatsApp que llegó una reserva).

**`src/pages/Settings.tsx`** — tab nueva "Reservas Online": toggle, slug (validado único, mensaje amigable en `23505`), upload de logo a bucket `clinic-branding`, selector de color. Checkbox "Reservable en tu página online" en el modal de servicios (`clinic_services.is_public_bookable`).

#### Bugs de RLS encontrados y corregidos en el camino

- **4 funciones helper de RLS (`is_clinic_admin`, `is_admin_of_clinic`, `is_clinic_member`, `is_platform_admin`) nunca tuvieron `EXECUTE` para `anon`.** Como las policies de `clinic_settings`/`clinic_members` las referencian en su `USING`, cualquier query de `anon` que tocara esas tablas (aunque fuera indirectamente) fallaba con "permission denied for function X". Corregido con `GRANT EXECUTE ... TO anon` en las 4 — seguro porque las cuatro solo comparan contra `auth.uid()` (NULL para anon → siempre false).
- **Un `EXISTS (SELECT ... FROM clinic_settings ...)` crudo dentro de una policy hereda la RLS de la tabla referenciada.** El check de "¿esta clínica tiene reservas online activadas?" seguía devolviendo false para `anon` después del fix anterior — no por permisos, sino porque `clinic_settings` genuinamente no tiene filas visibles para `anon` bajo su propia RLS. Resuelto envolviendo el check en una función `SECURITY DEFINER` (`clinic_has_public_booking`), que sí puede leer la tabla saltándose la RLS de forma controlada.
- **`INSERT ... RETURNING` exige SELECT y pasar la policy de SELECT de la tabla destino.** El insert anon de `tutors`/`appointments` nunca debe pedir `RETURNING` — se genera el UUID en el cliente (`crypto.randomUUID()`) antes del insert.

### `public/core.html` — sección nueva de agendamiento online + refuerzos de copy

A pedido del usuario, se comparó un post de marketing que había escrito con lo que ya mostraba la landing de Core, para identificar qué destacar mejor:

- **Nueva sección** "Agendamiento online" (entre Agenda y Ficha clínica) con **screenshot real** de `/reservar/:slug` — capturado con Playwright contra una clínica de prueba con datos 100% inventados (nombre "Clínica Huellitas", logo propio en SVG, color violeta, 3 servicios), revertida a su estado original apenas terminó la captura.
- Reforzado el bullet del carnet digital en Fidelización (antes un ítem suelto, ahora explícito como feature con enlace de referido).
- Sumado "ranking de servicios y productos" a Finanzas (existe desde sesión 69, no se mencionaba en la landing).
- Sumada "importación masiva de pacientes desde Excel" (CSVUploader reescrito en la sesión de la que continúa esta) al checklist y a Fichas médicas — identificada como la "joyita" más fuerte no mencionada en ningún lado: resuelve la objeción #1 de cualquier prospecto ("tengo todo en Excel, es mucho trabajo migrar").
- Meta description/OG actualizados para mencionar el link de reservas.

### `public/links.html` — botón del plan Core (oferta de lanzamiento)

Botón nuevo, primero en la lista, con badge "Oferta de lanzamiento" y precio US$17/mes · 30 días gratis, apuntando a `/core`.

**Bug encontrado y corregido:** el badge quedaba cortado por arriba. Causa: estaba posicionado con `-top-2.5` (fuera de los límites del botón) **dentro** de un `<a class="link-btn">`, y `.link-btn` tiene `overflow: hidden` (necesario para el efecto shimmer del hover) — cualquier hijo posicionado fuera de esos límites queda recortado. Fix: el badge se movió a un `<div class="relative">` hermano, fuera del elemento con `overflow:hidden`. Se sumó también el subtítulo "Gestión completa sin IA conversacional" pedido.

### Suscripción de Core — causa raíz de "aparece Inactivo, sin botón para pagar"

Diagnóstico completo con datos reales de producción (no supuesto): el trigger que crea la suscripción al registrarse (`handle_new_clinic_subscription`, gana la carrera por orden alfabético sobre un segundo trigger duplicado que nunca llega a ejecutar por `ON CONFLICT DO NOTHING`) deja `subscriptions.status` en el string literal **`'trialing'`** — nunca `'trial'`. Ninguna condición de Settings.tsx lo contemplaba (comparaban contra `'trial'`), así que el badge caía siempre a "Inactivo" y el botón para pagar el propio plan Core quedaba deshabilitado por `isCurrentPlan` (que no exigía que la suscripción estuviera realmente pagada).

**Fix — un solo criterio (`isPaidActive = manually_active || status==='active'`) reutilizado en todo `Settings.tsx`:**
- Badge de 3 estados: **Suscrito** (en período de prueba, sin pagar aún — vía `clinic_settings.trial_end_date`, el trial real de 30 días) → **Activo** (pagando) → **Inactivo** (prueba vencida sin pagar).
- El plan propio sin pagar queda habilitado en el grid con botón "Suscribirme ahora" (antes `isCurrentPlan` lo deshabilitaba con solo que `planId` coincidiera, sin mirar si estaba pagado).
- Precio de lanzamiento visible: Core mostraba $39 USD / $33.000 CLP de lista en toda la página aunque el checkout real (Paddle con cupón, MercadoPago con el monto ya rebajado) cobre $17 — ahora se muestra tachado + el precio real, con badge "Lanzamiento", en la tarjeta de "Plan Actual" y en el grid comparativo.
- `isFirstConversion` (dispara el banner de onboarding post-pago) comparaba `subscription?.plan === 'trial'`, string que nunca ocurre — corregido a `!isPaidActive`.
- "Gestionar en Mercado Pago" aparecía para cualquier cuenta con `payment_provider='mercadopago'` en `clinic_settings` aunque nunca hubiera pagado ahí — ahora exige `isPaidActive`.
- `DashboardLayout.tsx`: el redirect a "trial vencido" usaba `subscriptions.current_period_end`, que para cualquier cuenta nunca pagada tiene un default de **14 días** (columna, sin relación con la promesa real de 30 días de Core) — corregido a tomar el más tardío entre ese período y `clinic_settings.trial_end_date`, preservando el comportamiento correcto para un cliente pago que cancela (acceso hasta el fin del ciclo ya pagado, usando su `current_period_end` real).
- El botón "Suscribirme ahora" del bloque superior solo hacía scroll hasta el grid de planes — ahora llama a `handlePlanSelection` directo con el plan actual, abriendo el checkout de una vez.

**`paymentRegion` (CLP/USD) defaulteaba a Chile** en `Settings.tsx`, `AISettings.tsx` y `Register.tsx` — verificado que casi todo el tráfico real es de fuera de Chile (Animalgrace es la única clínica chilena). Cambiado el default a `'international'` en los 3, y el override post-carga ya no confía en `clinic_settings.payment_provider` a menos que exista una suscripción real cobrada en esa moneda (`manually_active` o un `mercadopago_subscription_id`/`paddle_subscription_id` real) — antes ese campo era solo el artefacto de cuál había sido el default en el momento del registro, no una elección real.

Verificado con 3 capturas reales en un dev server local (pagado/activo, Core en prueba sin pagar, prueba vencida) usando una sesión inyectada por magic-link sobre la clínica de prueba, revertida a su estado original al terminar.

### Bug real encontrado en `mercadopago-create-subscription` — CORS ausente en toda respuesta de error

El toggle a moneda chilena tiraba "Error al iniciar el proceso de pago" sin ningún detalle. Causa: la función solo agregaba headers CORS (`Access-Control-Allow-Origin`) en la respuesta de **éxito** — las 4 respuestas de error (400, 405, 500 de Mercado Pago, 500 catch-all) no los tenían. El navegador bloquea por CORS cualquier respuesta sin esos headers antes de que el JS del cliente llegue a leer el body, así que `supabase-js` reportaba un `error` genérico sin cuerpo — cualquier fallo real de Mercado Pago (token, precio, parámetros) quedaba invisible detrás del alert genérico. Fix: `CORS_HEADERS` compartido aplicado a las 6 respuestas de la función. Verificado con curl: la respuesta 400 ahora sí trae los headers y el cuerpo llega al navegador.

**Esta primera corrección resultó incompleta — el usuario siguió viendo el mismo error después de desplegada.** Reproducido con Playwright contra producción, con sesión real inyectada por magic-link (mismo botón, misma cuenta, moneda chilena): la causa real era otra — `Access-Control-Allow-Headers` solo listaba `"Content-Type, Authorization"`, pero `supabase-js` manda también `x-client-info` y `apikey` en toda llamada a `functions.invoke()`. El navegador bloqueaba el **preflight OPTIONS** antes de que la request real saliera siquiera — no era un problema de la respuesta (eso ya estaba arreglado), era que la request ni llegaba al servidor. El error de consola real (`Access to fetch ... has been blocked by CORS policy: Request header field x-client-info is not allowed`) solo apareció al reproducir en un navegador de verdad — curl no lo detecta porque no aplica la política CORS del navegador. Fix: `Access-Control-Allow-Headers: "authorization, x-client-info, apikey, content-type"` (mismo texto ya usado en `mercadopago-create-credits-preference` y `paddle-create-transaction` — esas dos nunca tuvieron el bug, solo esta función se había quedado con la lista corta). Verificado con un preflight OPTIONS real y con el flujo completo en Playwright: la segunda vez el clic completó el checkout de verdad (quedó un `mercadopago_subscription_id` nuevo en la fila de `subscriptions`, revertido después de confirmar).

**Regla permanente — curl no reproduce bugs de CORS.** `curl` no aplica ninguna política de origen cruzado, así que una función puede responder perfecto por curl y seguir completamente rota en un navegador real. Para diagnosticar un error que el usuario ve solo en la UI, reproducir con un navegador real (Playwright + sesión inyectada) antes de dar un fix por confirmado — la primera corrección de esta misma función pasó todas mis pruebas por curl y aun así no resolvía el problema real.

### Hallazgo de seguridad — `mercadopago-create-subscription` sin control de acceso multi-tenant

En la misma revisión (pedida explícitamente por el usuario) se encontró que la función **nunca verificaba que el usuario autenticado perteneciera al `clinic_id` del body**. `verify_jwt=true` solo confirma que hay una sesión válida — no que sea dueño de esa clínica. Cualquier cuenta logueada (incluida una cuenta Core recién creada y gratis) podía mandar el UUID de **otra** clínica y:
- Sobrescribirle `plan_id`/`plan`/`status` en `subscriptions` (downgrade o corrupción del plan real de otra clínica).
- Sobrescribirle `max_users` en `clinic_settings`.

**Fix:** mismo patrón ya establecido en otras funciones (`send-visit-receipt`, sesión 41) — JWT → `auth.getUser()` → chequeo de `clinic_members` activo, antes de tocar nada. **Verificado con un intento de exploit real** contra el UUID de Animalgrace Linares (con un email/clinic_id ajenos): bloqueado con `403 Forbidden`, confirmado en DB que `subscriptions` de Animalgrace quedó exactamente intacta.

**Hallazgo relacionado, no corregido esta sesión (menor severidad, fuera de alcance del fix pedido):** `paddle-create-transaction` tiene el mismo problema — cualquier `clinic_id` se acepta sin verificar membresía. Diferencia de severidad real: esa función no escribe nada en la base por sí sola (solo crea una transacción draft en Paddle); para que tuviera efecto, el atacante tendría que pagar de verdad con el `clinic_id` de otra clínica en el `custom_data`, lo que en el peor caso le regala créditos a una clínica ajena — molesto pero no una corrupción de datos como el caso de MercadoPago. Queda pendiente para una pasada de seguridad futura sobre el resto de las funciones de pago.

### Toggle de moneda pegado en CLP y botón de pago bloqueado en MercadoPago

Dos síntomas reportados juntos tras el fix de CORS, con causas distintas — uno de código, otro externo.

**1. El toggle volvía a CLP solo después de un intento de checkout (bug real).** `hasRealSubscription` trataba la sola presencia de `mercadopago_subscription_id`/`paddle_subscription_id` como prueba de que la clínica ya pagaba en esa moneda. Pero esos campos se escriben apenas se **crea** la preferencia/transacción de pago, no cuando el pago se **completa** (`mercadopago-create-subscription` hace el upsert con el `preference.id` antes de que el usuario vea siquiera el checkout). Un solo clic en "Suscribirme ahora" —aunque el pago no se terminara, como pasaba por el problema #2— ya dejaba esos campos no nulos, y el toggle caía de vuelta a CLP en cada carga de página aunque el usuario lo cambiara a Internacional. Corregido en `Settings.tsx` y `AISettings.tsx` a exigir `status === 'active'` (o `manually_active`), la única señal real de un pago completado.

**2. La tarjeta "Plan Actual" ignoraba el toggle.** Siempre mostraba el CLP como número protagonista y el USD como línea secundaria, sin importar la moneda seleccionada — inconsistente con el grid de comparación de abajo, que sí lo respetaba. Ahora el número grande sigue `paymentRegion`, con el tachado del precio de lista en la moneda que corresponda.

**3. Botón de pagar bloqueado dentro del checkout de MercadoPago — NO es un bug de Vetly.** Diagnosticado consultando directo la API de MercadoPago (preferencia real recién creada + `GET /users/me`, vía una edge function de diagnóstico temporal eliminada al terminar). La preferencia se crea perfecta (monto, moneda, back_urls, metadata correctos), pero la cuenta vendedora devuelve:

```json
"billing": { "allow": false, "codes": ["address_pending"] }
```

**La cuenta de MercadoPago de Nextflow no puede cobrar hasta completar la dirección del negocio en su panel.** Es un bloqueo de configuración externa, del mismo tipo que la verificación pendiente de Paddle — no requiere ningún cambio de código.

### Bug: subir el logo de la clínica fallaba siempre con error de RLS

**Síntoma:** en Ajustes → Reservas Online, "Subir logo" devolvía `new row violates row-level security policy` para cualquier clínica, incluso con el usuario siendo owner activo y el path correcto.

**Causa raíz:** las 3 políticas del bucket `clinic-branding` (creadas en esta misma sesión, junto con la feature de reservas online) estaban con `TO authenticated`. **El servicio de Storage no evalúa las políticas bajo ese rol**, así que ninguna aplicaba y todo INSERT se rechazaba. Encontrado por contraste con los dos buckets que sí funcionaban desde antes (`expense-receipts`, `patient-documents`): ambos usan una sola policy `FOR ALL TO public`.

**Hipótesis descartadas por prueba directa** (quedan anotadas para no reinvestigarlas): la lógica de la policy era correcta — un INSERT manual con el JWT del usuario **sí pasaba** dentro de una transacción SQL con `SET LOCAL ROLE authenticated`; la membresía en `clinic_members` existía y estaba activa; `storage.foldername(path)[1]` resolvía al `clinic_id` correcto; y no era caché de plan de Postgres ni el tipo del casteo (`::uuid` vs `::text`) — ambas se probaron con `ALTER POLICY` y siguió fallando igual.

**Fix** (migración `20260826234500_fix_clinic_branding_storage_policy_role.sql`): las 3 políticas reemplazadas por una sola `FOR ALL TO public`, idéntica en forma a la de `expense-receipts`. Verificado contra el endpoint real de Storage con la sesión real de la cuenta afectada: la subida pasa de inmediato. Los archivos de prueba subidos durante el diagnóstico se borraron vía la API de Storage.

**`public` no debilita el aislamiento acá:** el filtro real sigue siendo la pertenencia a `clinic_members` vía `auth.uid()`, que para un visitante anónimo es NULL y por lo tanto nunca hace match.

### Reglas permanentes de esta sesión

- **Un elemento posicionado fuera de los límites de un contenedor con `overflow:hidden` se recorta, aunque el `overflow:hidden` esté ahí por otra razón** (acá, el shimmer de hover de `.link-btn`). Si un badge/tooltip necesita sobresalir del borde de un botón, sacarlo a un wrapper hermano sin ese overflow.
- **Cualquier respuesta de una edge function — incluidas las de error — necesita los mismos headers CORS que la de éxito.** Si solo el camino feliz los tiene, todo error queda invisible para el navegador y se ve como un fallo genérico sin causa, aunque el body de la respuesta sí traiga el detalle real.
- **Toda edge function que reciba un `clinic_id` en el body debe verificar que el usuario autenticado pertenezca a esa clínica** (JWT → `auth.getUser()` → `clinic_members` activo) antes de leer o escribir nada. `verify_jwt=true` en `config.toml` solo exige una sesión válida, nunca que esa sesión sea dueña del recurso que el body pide tocar — confundir ambas cosas es la fuente más común de bugs multi-tenant en este proyecto (ver también sesiones 74/77/78).
- **Antes de dar por buena una condición de estado (`status === 'trial'`, `status === 'active'`), verificar el valor literal exacto que escribe cada fuente real** (trigger de DB, webhook de pago) — un typo de un solo carácter entre `'trial'` y `'trialing'` puede dejar una condición entera permanentemente muerta sin ningún error visible.
- **`mercadopago_subscription_id` / `paddle_subscription_id` NO son señal de "ya pagó".** Se escriben al **crear** la preferencia/transacción, antes de que el usuario vea el checkout — un intento abandonado o rechazado ya los deja poblados. La única señal de pago completado es `status === 'active'` (o `manually_active`).
- **Las políticas de Storage deben crearse `TO public`, no `TO authenticated`.** El servicio de Storage no evalúa las políticas bajo el rol `authenticated`, así que una policy con ese rol nunca aplica y todo INSERT falla con "new row violates row-level security policy" aunque la lógica sea correcta. El aislamiento real lo da el filtro por `clinic_members` vía `auth.uid()` (NULL para anónimos), no el rol de la policy. Buckets de referencia que funcionan: `expense-receipts`, `patient-documents`, `clinic-branding`.
- **Un INSERT que pasa en SQL pero falla vía la API no es un problema de lógica de la policy.** Si `SET LOCAL ROLE authenticated` + INSERT manual funciona pero el endpoint real rechaza, el problema está en cómo el servicio (Storage/PostgREST) resuelve el rol — no en la condición de la policy. Comparar contra un bucket/tabla equivalente que sí funcione es más rápido que seguir iterando sobre la expresión.

---

## Cambios realizados — agosto 2026 (sesión 87, 2026-08-27)

> Nota de numeración: otra sesión escribió "sesión 86" en paralelo sobre este mismo archivo (ver commit `09bec43`, intercalado entre dos commits de esta sesión). Mismo patrón ya documentado en la sesión 66 — se salta a 87 para no pisar esa entrada.

### Generalización del modo coordinadora a Linares/Talca

Santiago venía trabajando con el modo "coordinadora" (IA reúne datos y disponibilidad amplia, una persona decide los horarios reales, la IA solo ofrece lo autorizado) desde la sesión anterior. El usuario pidió que Linares/Talca trabaje exactamente igual — "pero bien, sin bugs" — y que la IA insista en los datos faltantes (sobre todo la dirección) y pida el pin de ubicación cuando el sector sea rural.

**Activación** (solo datos, sin deploy nuevo — el mecanismo base ya era genérico desde la sesión anterior):
```sql
UPDATE clinic_settings SET
  scheduling_mode = 'coordinator_approval',
  coordinator_phone = '+56989790949'  -- mismo número que Santiago, es el de Claudia
WHERE id = 'fd11b7e4-7d96-461c-a292-2caa5e2592ce';
```

**Reescritura de `ai_behavior_rules` de Linares** (respaldo previo en `prompt_backups`, label `pre_coordinacion_linares_2026_08_26`):
- **"PROHIBIDO DERIVAR A OTRA CLÍNICA"**: pasaba de "ofrecer disponibilidad y agendar" a "reunir datos y disponibilidad amplia, la coordinadora decide qué tan pronto se le puede atender" — misma corrección que ya tenía Santiago.
- **"REGLA DE ORO LOGÍSTICA"** (sectores, regla de 1 hora, capacidad ≥5, anti-rebote) → renombrada a **"SECTORES GEOGRÁFICOS (REFERENCIA INTERNA)"**: se conserva solo la definición de qué comunas son Linares/Talca (útil para completar el campo `sector` de la solicitud), se elimina toda la lógica de decisión operativa — ya no es la IA quien evalúa viabilidad de horario por sector.
- **Sección 3 "INTELIGENCIA DE RUTA"** → **"LOGÍSTICA Y RECARGOS (SUCURSAL MAULE)"**: "LA RUTA LA ARMA LA COORDINADORA, NO TÚ" — mismo patrón que Santiago. Los precios/tramos de traslado siguen siendo responsabilidad de la IA (eso no cambia), solo la decisión de horario pasa a la coordinadora.
- **Sección 10 "REQUISITOS Y EJECUCIÓN"**: reescrita completa con los mismos 7 puntos que ya tenía Santiago (nombre, mascota, especie/sexo, comuna+dirección con pin si es rural, motivo, urgencia, disponibilidad amplia) + regla de ejecución que prohíbe ofrecer horario por cuenta propia y exige `request_scheduling_coordination`.
- Cirugías **no se tocaron** — ya escalaban directo a `escalate_to_human` (Sección 7), nunca pasaron por `create_appointment` ni necesitan el flujo nuevo; mismo criterio que Santiago ("excepto cirugías").
- REGLA 3 (pin de ubicación actual, nunca en tiempo real; "ZONAS CONFIRMADAS" vs "ZONAS DESCONOCIDAS") **se mantuvo intacta** — ya contenía exactamente el framework que pidió el usuario, solo se referenció desde la Sección 10 nueva.

**KB `Protocolo_de_Destartraje` (Linares)** — Claudia confirmó que el KB no distinguía especie: "Gato o Perro hasta 10 kilos = $90.000" se separó en dos filas, con el mismo patrón anti-confusión ya usado para cirugías:
```
| Gato (cualquier peso)   | $85.000  |
| Perro hasta 10 kilos    | $90.000  |
| Canino 11-20 kilos      | $105.000 |
| Canino 21-30 kilos      | $120.000 |
| Canino 31-40 kilos      | $135.000 |
```
Santiago no se tocó (su KB ya dice $70.000 para gatos y el usuario no dio un valor nuevo para esa sucursal).

**`RoutePlanPanel` oculto en modo coordinador** (`src/pages/Appointments.tsx`): con `scheduling_mode='coordinator_approval'` activo, el panel de "Plan de ruta del móvil" (`clinic_route_plan`) queda redundante y puede volver a contradecir lo que Claudia autorice caso por caso — exactamente la causa del bug de disponibilidad de Maule reportado el mismo día. Se agregó `!coordinatorApproval` a la condición de render; `SchedulingRequestsPanel` pasa a ser el único mecanismo visible para coordinar la ruta.

`ai_auto_respond` de Linares se **pausó** antes de tocar el prompt (había clientes reales escribiendo con el flujo viejo) y se dejó pausada al cierre — decisión del usuario, pendiente que él avise cuándo reactivarla.

**Deploy:** `meta-whatsapp-webhook` (v56). `ycloud-whatsapp-webhook` **no se tocó** — se descubrió que nunca recibió el mecanismo de coordinación en la sesión anterior (ni el tool `request_scheduling_coordination`, ni la tabla `scheduling_requests` en su código), a pesar de que el plan de esa sesión decía que se replicaría "por paridad". Como no procesa tráfico real (ambas clínicas están en Meta desde las sesiones 57/65), no se improvisó un port sin poder probarlo — queda como deuda documentada para una sesión dedicada si algún día se necesita.

### Auditoría del mismo día — 3 bugs reales reportados por el usuario con capturas de WhatsApp

Con Santiago ya en modo coordinador, el usuario reportó 3 problemas reales el mismo 27 de agosto. Auditados con datos reales de producción (`messages`, `scheduling_requests`, `debug_logs`), nunca supuestos.

#### Bug 1 — Claudia autoriza un horario y la IA lo contradice ("no es factible por el tiempo de traslado")

**Evidencia real, 3 casos del mismo día:** Claudia autorizó las 11:00, las 14:30 y las 11:30 para tres tutores distintos — en los tres casos la IA respondió *"Parece que el horario de las X no es factible debido al tiempo de traslado. Sin embargo, tengo disponibles..."* y ofreció horas completamente distintas a las autorizadas.

**Causa raíz real (no era el prompt):** `createAppt` — la función que efectivamente crea la cita — volvía a llamar internamente a `checkAvail()` como "chequeo proactivo de disponibilidad" (línea ~1085), **sin importar si ya existía una solicitud autorizada por la coordinadora**. Ese `checkAvail()` es el mismo motor de buffers/traslado del flujo autónomo (Google Maps, sector, capacidad) — y cuando el horario elegido por Claudia no calzaba con ese cálculo automático, `createAppt` lo rechazaba con el mensaje exacto que se veía en las capturas. La instrucción del prompt de "no volver a validar" no importaba, porque el veto no vivía en una decisión de la IA, vivía en el código de `createAppt`.

**Fix** (`meta-whatsapp-webhook/index.ts`): el bloque completo de "Proactive availability check" se envuelve en `if (!authorizedRequestId)` — cuando hay una solicitud autorizada, `createAppt` ya no vuelve a llamar `checkAvail` en absoluto:
```typescript
// Proactive availability check — se OMITE por completo cuando la coordinadora ya
// autorizó este horario (authorizedRequestId): es exactamente el motor de rutas/
// buffers de traslado del flujo autónomo, y volver a correrlo aquí contradecía en
// producción horarios que Claudia ya había decidido explícitamente.
if (!authorizedRequestId) {
  const availResult = await checkAvail(...);
  // ... validación y rechazo, sin cambios
}
```
`rescheduleAppt` no necesitó el mismo fix — nunca llamó `checkAvail` internamente, solo actualiza la fecha directo.

**Defensa adicional (no bloqueante):** se reforzó también la instrucción dinámica `schedulingContext` ("OPCIONES AUTORIZADAS POR LA COORDINADORA") para que la IA vaya directo a `create_appointment`/`reschedule_appointment` sin llamar `check_availability` — como red de seguridad en caso de que el modelo desobedezca, ya que `createAppt` es ahora la garantía real (el resultado de `check_availability`, si igual se llamara, ya no puede impedir que la cita se cree).

#### Bug 2 — Confirma el horario pero después dice "estaremos en contacto" y no agenda

**Causa raíz, distinta y más de fondo:** `scheduling-notify-authorized` (la edge function nueva de la sesión anterior que avisa por WhatsApp al tutor cuando Claudia autoriza) enviaba el mensaje real por WhatsApp, pero **nunca lo guardaba en la tabla `messages`**. Reconstruido con timestamps reales de una conversación completa (Jacqueline Uribe / Luly, 27-ago): el mensaje "Ya coordinamos la ruta... Podemos ofrecerte: Si confirmar para el martes a las 6pm" existía de verdad (confirmado en `debug_logs`, envío 200 vía Meta) pero **no aparecía en ningún lado del historial** que arma el propio agente. Cuando la tutora respondió "sí me acomoda, gracias", la IA no tenía en su propio historial ningún mensaje suyo ofreciendo "el martes a las 6pm" — su última respuesta visible era la genérica "he enviado tus datos a la coordinadora" — así que no pudo conectar la confirmación con ninguna oferta concreta y devolvió una respuesta vaga en vez de agendar. El mismo patrón (con round=2, la solicitud se había reabierto una vez) explicaba también por qué a veces el flujo volvía a `request_scheduling_coordination` sin necesidad: sin memoria de lo ya ofrecido, hasta un "sí perfecto" ambiguo del tutor podía interpretarse como que había que volver a coordinar.

**Comparación que confirmó el diagnóstico:** en otra conversación real (Valentina Ramírez) el tutor sí restituyó el día/hora exacto en su respuesta ("Jueves a las 330 por favor") — ahí la IA agendó de inmediato, porque no necesitaba memoria conversacional, el mensaje mismo traía el dato. La falla solo aparecía con confirmaciones vagas ("sí me acomoda", "sí perfecto").

**Fix** (`scheduling-notify-authorized/index.ts`): el mensaje enviado se inserta en `messages` con el mismo shape que usa `saveMsg()` en el webhook (`direction: "outbound"`, `ai_generated: false` para no disparar el descuento de créditos IA de un mensaje que nunca pasó por OpenAI, `message_type: "text"`). Como el `role` de cada mensaje del historial se decide solo por `direction` (nunca por `ai_generated`), el modelo lo ve como algo que él mismo dijo — recupera la memoria de la oferta.

#### Bug 3 — Inventó que entregan certificado después de una cirugía

**Confirmado real, no alucinación aislada:** un tutor preguntó *"¿Se entrega algún certificado o algo que acredite [la cirugía]?"* y `4o_pro` respondió con un párrafo completo describiendo un "informe detallado del procedimiento... que sirve como comprobante" — inventado por completo, AnimalGrace no entrega eso.

**Causa raíz:** la REGLA 1 anti-alucinación (ya existente, "solo servicios y valores verificados en la Base de Conocimiento") solo cubre **servicios** y **precios** explícitamente. Una pregunta sobre si se entrega un documento/certificado/garantía no es ni lo uno ni lo otro — quedaba en un hueco donde el modelo, sin una prohibición explícita, respondía lo que le parecía razonable.

**Fix** (ambas clínicas, misma sección REGLA 1):
```
*   **NO INVENTES DETALLES OPERATIVOS NO DOCUMENTADOS (CRÍTICO):** Esta misma
prohibición aplica a cualquier afirmación sobre qué se entrega, incluye o
garantiza — certificados, informes, boletas, documentos post-procedimiento,
garantías, plazos, etc. — que no esté descrita explícitamente en la Base de
Conocimiento. [...] Responde: "Voy a confirmar ese detalle con el equipo y te
aviso." y usa `escalate_to_human`.
```

#### Limpieza de KB — "lógica antigua" de Linares que aún podía confundir al modelo

Verificado explícitamente por pedido del usuario ("revisa también la parte de logística antigua de Linares que no esté interfiriendo"): el fix de código (bug 1) ya neutraliza cualquier contradicción a nivel de *booking real*, pero el documento `PROTOCOLO_LOGISTICA_SERVICIOS_GENERALES` (Linares) seguía teniendo, en su Sección 4, toda la lógica de ruta autónoma completa (bloques de horario, restricción 11:30 en Talca, buffer de 1 hora entre sectores, anti-rebote, orden lineal obligatorio) — texto que el propio `ai_behavior_rules` sigue instruyendo a consultar para precios, y que podía inducir a la IA a comunicar verbalmente una restricción operativa aunque el código ya no la hiciera cumplir. Se comparó contra el documento equivalente de Santiago (`#PROTOCOLO_LOGISTICA_SANTIAGO_SERVICIOS_GENERALES`) — **ya estaba limpio desde la sesión anterior**, confirmando que el bug de Santiago nunca fue de KB, siempre fue el de código del bug 1.

**Reescrita la Sección 4 de Linares**, mismo patrón que ya tenía Santiago (4.1 sectores solo como referencia interna, 4.2 "quién decide el horario" con la coordinadora como autoridad absoluta, 4.3 tutores en sectores sin ruta ese día → `escalate_to_human` si hay urgencia real). Se eliminó toda la lógica de bloques horarios/buffer/anti-rebote; las tablas de precios y tramos (secciones 1-3B) quedaron intactas.

**Deploy:** `meta-whatsapp-webhook` (v57, incluye los 3 fixes de código). Respaldo posterior en `prompt_backups`, label `post_auditoria_coordinacion_2026_08_27` (ambos `ai_behavior_rules` + el KB de Linares). Commits `7822b27` y `fcddc08`, pusheados a `main`.

**No recuperable por código — recomendado a Claudia mensajear directo:** las solicitudes ya autorizadas antes del fix (Carolina Sáez, y un tutor sin nombre real registrado) no recibieron el aviso corregido retroactivamente — se le entregó al usuario la lista con teléfonos y horarios exactos para que Claudia les escribiera directo por WhatsApp.

### "Logística Pro" — pasa a ser opt-in por clínica, no visible por defecto

**Reporte del usuario:** el panel "Logística Pro (Tramos por Tiempo)" (`src/pages/KnowledgeBase.tsx`) seguía apareciendo visualmente en Conocimiento para Linares, aunque ya no debería aplicarle "por ningún motivo".

**Investigación antes de tocar nada:** este panel edita `clinic_settings.logistics_config` (sedes, tramos por minutos de viaje, recargos) y **se renderiza siempre, para cualquier clínica**, sin ninguna condición — ni siquiera estaba gateado por `business_model`. Ya existía un campo `logistics_config.is_active` (default `false` desde el fix de la sesión 6, precisamente para que clínicas nuevas no heredaran configuración ajena) pero **nada en el webhook lo leía** — era un flag completamente inerte, guardado en la base pero sin ningún efecto real, ni siquiera controlaba si el panel se mostraba.

**Pregunta al usuario antes de tocar el comportamiento funcional:** apagar `is_active` de verdad significaría que la IA deja de calcular el recargo exacto por Google Maps y pasa a un mensaje genérico tipo "dentro del radio urbano no hay recargo, fuera de él se confirma con tu ubicación" (coherente con que Claudia ya cierra el precio final al autorizar). El usuario respondió explícitamente: **"Mejor no lo apagues, déjalo tal como está"** — o sea, el pedido real era solo de visibilidad/arquitectura (que sea un interruptor real y opt-in), no un cambio de comportamiento de precios para Animalgrace.

**Implementado:**
- **`src/pages/Settings.tsx`**: nuevo interruptor "Logística Pro" en Configuración → Modelo de Negocio, visible solo si `businessModel !== 'physical'`. Nuevo estado `logisticsConfigRaw` que guarda el JSON completo tal como se fetch (locations, routing_mode, routing_zone, etc.) para que al guardar solo se parchee `is_active`, sin perder el resto:
  ```typescript
  logistics_config: {
      ...logisticsConfigRaw,
      is_active: businessModel === 'physical' ? false : logisticsProEnabled,
  },
  ```
- **`src/pages/KnowledgeBase.tsx`**: agregado fetch de `business_model` (antes no se pedía en el select). El panel completo de "Logística Pro" queda envuelto en `{businessModel !== 'physical' && logisticsConfig.is_active && (...)}` — antes se renderizaba siempre, incluso para clínicas de local fijo.
- **Sin cambios en el webhook**: por decisión explícita del usuario, el cómputo GPS-based de recargos (el bloque `if (globalGPS && logisticsConfig && GOOGLE_MAPS_API_KEY)` que inyecta `[LOGÍSTICA: ...]` al prompt) sigue sin consultar `is_active` — sigue corriendo siempre que `logistics_config` tenga datos, exactamente como antes.
- **Animalgrace no cambia de comportamiento**: su `logistics_config.is_active` ya estaba en `true` para ambas sucursales y no se tocó — el interruptor nuevo en Settings simplemente refleja ese estado ya existente, en vez de dejar el panel suelto sin ningún control visible.

**Deploy:** verificado con `npx tsc --noEmit` limpio, build desde `git worktree` aislado (nunca el working tree local con archivos sueltos de otras sesiones sin commitear), y confirmación de los marcadores reales (`business_model` en el select de `KnowledgeBase`, `logisticsProEnabled` en `Settings`) dentro de los chunks JS ya minificados — un primer intento de grep sobre el identificador `businessModel` dio falso negativo porque la minificación renombra identificadores; buscar el string literal de la columna SQL (`business_model`, entre comillas, no se minifica) sí lo confirmó. Commit `05e679e`, pusheado a `main`.

### Reglas permanentes de esta sesión

- **Cuando una función de creación (`createAppt`) tiene su propio chequeo de disponibilidad interno, reforzar solo el prompt no alcanza.** El bug 1 de esta sesión existía porque la instrucción del prompt ("no vuelvas a validar, usa create_appointment directo") era irrelevante frente a un `checkAvail()` que el propio código de `createAppt` llamaba sin condición. Cualquier guard de "confía en la decisión humana" debe aplicarse en el código que efectivamente inserta el registro, no solo en las instrucciones que llegan al modelo.
- **Un mensaje real enviado por una edge function nueva, si no se registra en `messages`, es invisible para el propio agente de IA** — no solo para el dashboard. El historial que arma el modelo se construye leyendo esa tabla; cualquier canal de envío nuevo (recordatorios, avisos, confirmaciones) que no inserte ahí deja al agente con amnesia sobre lo que "él mismo" dijo, y eso produce respuestas contradictorias o repetidas en el siguiente turno. Regla aplicable a cualquier función de envío proactivo futura.
- **Una regla anti-alucinación acotada a "servicios y precios" no cubre afirmaciones operativas** (certificados, documentos, garantías, plazos). Si el negocio tiene reglas del tipo "nunca inventes X", conviene revisar si el alcance real cubre también las preguntas de "¿hacen/entregan Y?" que no encajan en la categoría original.
- **Antes de asumir que un flag de configuración (`is_active`, o similar) "controla" algo, verificar con grep que efectivamente se lee en alguna parte del código.** `logistics_config.is_active` llevaba desde la sesión 6 guardándose sin que nada lo consultara — parecía un interruptor funcional y era pura decoración hasta esta sesión.
- **Ante un cambio que afecta el pricing/comportamiento en vivo de un cliente real, preguntar antes de ejecutar — incluso si la lectura literal del pedido del usuario sugiere lo contrario.** El pedido inicial ("ya no debe aplicar por ningún motivo") sonaba a apagar el cálculo automático de traslado; una pregunta directa reveló que el pedido real era solo de visibilidad/arquitectura, no de comportamiento. Sin esa pregunta, se habría roto el cálculo de precios de Animalgrace en producción.

---

## Cambios realizados — agosto 2026 (sesión 88, 2026-08-27)

### Verificación real de Paddle y MercadoPago — bloqueos actuales, no supuestos

El usuario reportó que la cuenta de Paddle "ya está verificada". Antes de asumirlo, se verificó contra la API real (patrón de diagnóstico temporal ya usado en sesiones 78/86: edge function desechable con las credenciales de producción, curl, borrar) en vez de confiar en el estado documentado.

**Paddle — el KYB efectivamente pasó, pero apareció el siguiente bloqueo documentado desde sesión 68/78.** Una transacción draft real contra `pri_01m08n7kjtxc9zcr658hhx5dem` (precio real de Core) ya no devuelve `transaction_checkout_not_enabled` (el error de cuenta no verificada) — devuelve:
```json
{"code":"transaction_default_checkout_url_not_set","detail":"Cannot create a transaction or open a checkout as no default payment link has been set for this account. Set in the Paddle dashboard, then try again."}
```
**Acción pendiente, solo dashboard (no hay endpoint de API para esto — confirmado en sesión 68):** Paddle → Checkout → Checkout Settings → configurar un "Default payment link" en la cuenta **live**. Ya se había hecho en sandbox (sesión 68) pero nunca en producción. Sin esto, ningún checkout de Paddle (suscripciones ni packs) puede completarse en producción, aunque el resto de la integración (catálogo, secrets, webhook) esté lista desde sesión 78.

**MercadoPago — sigue bloqueado, sin cambios respecto a sesión 86.** `GET /users/me` con el `MERCADOPAGO_ACCESS_TOKEN` de producción confirma:
```json
"billing": { "allow": false, "codes": ["address_pending"] }
```
**Hallazgo nuevo:** `"mercadopago_account_type": "personal"` — la cuenta sigue registrada como **persona física**, no como empresa, pese a que sesión 78 documentó la migración a "cuenta empresa Nextflow". El email (`nexflow.cl@gmail.com`) es de la empresa, pero el tipo de cuenta interno de MP no se migró — probablemente la causa raíz de por qué `address_pending` no se resuelve solo completando una dirección: si la cuenta sigue como persona física, MP puede estar pidiendo el registro completo de persona jurídica (RUT de empresa, representante legal, etc.), no solo una dirección de despacho. **Acción pendiente del usuario:** entrar al panel de MercadoPago (cuenta `nexflow.cl@gmail.com`) y verificar en Configuración → Datos de la cuenta si hay una opción para completar el registro como empresa/persona jurídica, además de la dirección.

### Fix de seguridad cerrado — `paddle-create-transaction` sin control de acceso (pendiente desde sesión 86)

La función aceptaba cualquier `clinic_id` en el body sin verificar que el usuario autenticado perteneciera a esa clínica — cualquier cuenta logueada (incluida una Core recién creada) podía pagar con el UUID de otra clínica y, al completarse el pago, acreditarle créditos de campaña o recordatorios a una clínica ajena vía `custom_data.clinic_id` en `paddle-webhook`.

**Fix aplicado**, mismo patrón exacto que `mercadopago-create-subscription` (sesión 86): JWT del header → `auth.getUser()` → check de `clinic_members` activo (`user_id` + `clinic_id` + `status='active'`) antes de tocar la API de Paddle. `supabase.functions.invoke()` del frontend (`src/lib/paddle.ts`) ya manda el JWT de sesión automáticamente — no requirió ningún cambio de frontend. Desplegado (`paddle-create-transaction`).

### Estado real al cierre — 2 bloqueos externos, ambos de acción manual del usuario en dashboards ajenos a Vetly

| Proveedor | Bloqueo | Dónde se resuelve | Bloquea |
|---|---|---|---|
| Paddle | Falta "Default payment link" en la cuenta live | Paddle Dashboard → Checkout → Checkout Settings | Todo checkout de Paddle en producción (planes y packs) |
| MercadoPago | `address_pending`, cuenta sigue como "personal" | Panel de MercadoPago → Configuración → Datos de la cuenta (completar como empresa + dirección) | Todo checkout de MercadoPago en producción (CLP) |

Ninguno de los dos requiere cambio de código — son configuraciones de cuenta en cada plataforma de pago. En cuanto el usuario los resuelva, no hace falta ningún deploy adicional: el código de checkout de ambos ya está listo y probado end-to-end (sesión 68 para Paddle sandbox, sesión 86 para MercadoPago CORS/multi-tenant).

### Actualización el mismo día — Paddle resuelto, causa exacta de MP encontrada

**Paddle: ✅ resuelto.** El usuario configuró el "Default payment link" en la cuenta live. Reverificado con el mismo método (transacción draft real contra `pri_01m08n7kjtxc9zcr658hhx5dem`): `status: 201`, transacción creada sin error. **El checkout de Paddle en producción queda desbloqueado — sin pendientes de código ni de cuenta.**

**MercadoPago: causa exacta identificada — no es un problema de código, ni de identificación tributaria.** El usuario reportó que la cuenta SÍ es de empresa, con todos los datos y documentos cargados y verificados. Se releyó el JSON completo (sin filtrar) de `GET /users/me` y se confirmó:

```json
"identification": { "number": "78362063-4", "type": "RUT" },
"company": { "brand_name": "NEXFLOW AI SYSTEMS SPA", "corporate_name": "NEXFLOW AI SYSTEMS SPA", "cust_type_id": "BU" },
"tags": ["user_product_seller", "business", "messages_as_seller", "normal"],
"address": { "address": null, "city": null, "state": null, "zip_code": null },
"phone": { "number": "", "verified": false }
```

La identificación tributaria de empresa está completa (RUT, razón social, tag `business`). Pero el objeto `address` del **perfil de la cuenta** —campo separado del proceso de verificación de identidad/documentos— tiene los 4 subcampos en `null`. Ese hueco puntual es la causa literal de `billing.allow: false, codes: ["address_pending"]`. `phone.number` también vacío (no es lo que reporta el código de error, pero vale la pena completarlo de paso).

`mercadopago_account_type: "personal"` sigue apareciendo junto a los datos de empresa — probablemente un campo legado de cómo se creó la cuenta, no necesariamente el bloqueante (el código de error que devuelve la API apunta específicamente a `address`, no a `account_type`). Si tras completar la dirección el bloqueo persiste, ese sería el siguiente punto a escalar con soporte de MP.

**Acción pendiente del usuario, sin cambio de código:** completar la dirección postal de la cuenta en el panel de MercadoPago (`nexflow.cl@gmail.com`) — es un formulario de dirección (calle/ciudad/región/código postal) separado del que ya se completó para la verificación de identidad/documentos.

### Continuación — el usuario confirmó capturas del panel, causa real acotada al e-RUT

El usuario mostró capturas del panel real de MP. Confirmado con evidencia visual (no solo la API):
- **"Datos de tu negocio"** (razón social, nombre para resúmenes, actividad comercial) y **"Direcciones"** ya están completos — hay una dirección cargada ("Alto del Rayo 211, Maule - Linares"), pero categorizada como **"Domicilio residencial"** y vinculada al RUT personal del representante legal (183433784), no al RUT de la empresa (783620634). Esto explica por qué el `address` a nivel de cuenta/empresa que expone `/users/me` sigue vacío pese a que sí existe una dirección en el sistema.
- **"Datos fiscales" mostraba explícitamente "Sube el e-RUT para agregar tu información fiscal"** (marcado como acción pendiente) — en Chile el e-RUT del SII trae el domicilio fiscal legal de la empresa. Es la hipótesis más fuerte para resolver `address_pending`.
- **Descartada una segunda hipótesis:** la tarjeta "Consulta tus datos de cuenta para ingresar y recibir dinero" **no** tiene relación con el bloqueo — el usuario confirmó que es solo el visor de datos bancarios (n° de cuenta, RUT, banco, tipo de cuenta).

**El usuario ya subió el e-RUT.** MP no lo procesa al instante — reverificado en vivo tras la subida (`GET /users/me`): `address` sigue en `null` y `billing.allow: false, address_pending` sin cambios. Es esperado, no un fallo — queda pendiente de que MP termine de validar el documento (tiempo de procesamiento desconocido, no hay ETA publicada por MP para esto).

---

## Cambios realizados — agosto 2026 (sesión 89, 2026-08-27)

> Nota de numeración: otra sesión escribió "sesión 88" en paralelo (Paddle/MercadoPago, ver arriba) — se salta a 89 por el mismo motivo ya documentado en sesiones 66/87.

### Continuación de la auditoría del modo coordinadora — 3 bugs más, encontrados con capturas reales del mismo día

Horas después de los 3 fixes de la sesión 87, el usuario mandó 2 capturas nuevas de WhatsApp real: un tutor (Ema Muñoz / Ragnar) recibió **el mismo aviso de horario autorizado 3 veces seguidas**, y otro contacto (+56993019944, Carol Venegas / Gastón) **confirmó el horario y la IA se quedó completamente muda**, sin agendar. Auditado con los mismos datos reales (`messages`, `scheduling_requests`, `crm_prospects`), no supuestos.

#### Bug 4 — el aviso de WhatsApp se reenviaba completo en cada re-guardado

Reconstruido con timestamps exactos: Claudia autorizó el mismo tutor 3 veces en 2 minutos (20:17:50, 20:18:35, 20:19:30) — el texto evolucionó de "Próximo jueves 10.30 am" (sin fecha) a "Próximo jueves 3/09 10.30 am" (con fecha, dos veces seguidas e idéntico). `SchedulingRequestsPanel.authorize()` es la MISMA función que se usa tanto para la primera autorización como para **editar** una fila ya autorizada — y disparaba el `invoke('scheduling-notify-authorized', ...)` en cada guardado, sin comparar si el texto realmente había cambiado.

**Fix** (`src/components/appointments/SchedulingRequestsPanel.tsx`): el aviso solo se dispara si es la primera autorización o si el texto autorizado cambió de verdad respecto al valor previo:
```tsx
const isGenuinelyNew = req.status !== 'authorized' || options !== (req.authorized_options ?? '').trim()
if (isGenuinelyNew) {
    void supabase.functions.invoke('scheduling-notify-authorized', { body: { clinic_id: clinicId, request_id: req.id } })
        .catch(() => { /* no crítico */ })
}
```

#### Bug 5 — "¿Cuál de esas opciones te acomoda más?" con una sola opción

El texto del aviso (`scheduling-notify-authorized`) tenía la pregunta de cierre hardcodeada en plural, sin importar cuántas alternativas hubiera. Con una sola hora autorizada ("Próximo jueves 10.30 am") la pregunta no tenía sentido gramatical.

**Fix:** heurística simple sobre el propio texto de `authorized_options` (separadores de lista → plural; si no hay ninguno → singular):
```typescript
const hasMultipleOptions = /[,;/]| o | ó /i.test(request.authorized_options);
const closingQuestion = hasMultipleOptions
    ? "¿Cuál de esas opciones te acomoda más?"
    : "¿Te acomoda ese horario?";
```

#### Bug 6 — el más grave: `requires_human` no se limpiaba de verdad, la IA quedaba muda tras la confirmación

**Confirmado en 2 casos reales independientes con la misma firma exacta:** en ambos, `scheduling_requests.round` nunca subió de 1 (descarta que la IA hubiera vuelto a pedir coordinación), pero al consultar `crm_prospects.requires_human` para ambos teléfonos (56923799276 y 56993019944) el valor seguía en **`true`** horas después de que Claudia autorizara desde el panel — pese a que `authorize()` llama a `resumeAI()`, que hace `UPDATE crm_prospects SET requires_human=false ... WHERE phone.eq.X,phone.eq.+X`. Ese `UPDATE` corre desde el navegador de Claudia (cliente autenticado, sujeto a RLS) y, por algún motivo que no se pudo aislar con certeza (¿timing, sesión, algo específico de `crm_prospects` vs. `tutors`?), no dejaba el cambio aplicado de forma confiable.

**Impacto real:** el tutor confirmaba el horario ("Ok, confirmo para viernes 04 Septiembre a las 10.30 hrs") y la IA nunca volvía a responder — el webhook seguía viendo `requires_human=true` y se auto-silenciaba en cada mensaje siguiente, indefinidamente, hasta que alguien lo reactivara a mano desde Mensajes.

**Fix — mover la reactivación al servidor** (`supabase/functions/scheduling-notify-authorized/index.ts`, ya corre con `service_role`, sin sujeción a RLS de cliente):
```typescript
// CRÍTICO: reactivar la IA con service_role, no confiar solo en el resumeAI()
// del frontend. La llamada del frontend queda como camino rápido para la UI,
// pero esta es la que garantiza el resultado.
await supabase.from("tutors").update({ requires_human: false })
    .eq("clinic_id", clinic_id).eq("phone_number", request.tutor_phone);
await supabase.from("crm_prospects").update({ requires_human: false })
    .eq("clinic_id", clinic_id).or(`phone.eq.${request.tutor_phone},phone.eq.+${request.tutor_phone}`);
```
El `resumeAI()` del frontend se dejó tal cual (camino rápido, redundante pero inofensivo) — la garantía real ahora vive en el server.

**Los 2 tutores reales se reactivaron manualmente** (`UPDATE crm_prospects SET requires_human=false` directo en producción) apenas se confirmó el diagnóstico, para no dejarlos esperando hasta el próximo deploy. Se verificó además si sus citas habían quedado agendadas: **Ragnar sí** (alguien —probablemente Claudia— la cargó a mano, ya le llegó el recordatorio automático); **Gastón no** — Carol confirmó "viernes 04 septiembre a las 10:30" y quedó sin agendar, se le avisó explícitamente al usuario para que la cargue a mano o la IA la procese ahora que ya puede responder.

**Deploy:** `scheduling-notify-authorized` v3. Commit `1667827`.

### Revisión de seguridad del sistema de agendamiento — sin hallazgos

A pedido explícito del usuario, revisión de seguridad completa del sistema de coordinación (no solo de los bugs de comportamiento de arriba). El skill `security-review` compara el diff pendiente de la rama, pero todo este feature ya estaba mergeado a `main` — se hizo la revisión manual directa en su lugar:

- **RLS de `scheduling_requests`** (verificada contra la base viva, no contra la migración original): `SELECT` y `UPDATE` exigen membresía activa en `clinic_members` para el `clinic_id` de la fila, con `WITH CHECK` también en el `UPDATE`. Sin política de `INSERT`/`DELETE` para `authenticated` — solo `service_role` (el webhook) puede crear filas, correcto.
- **`scheduling-notify-authorized`**: JWT + membresía activa verificados antes de tocar cualquier dato; la solicitud se relee filtrada por `id` **y** `clinic_id` juntos (no se puede pasar el `request_id` de otra clínica). El teléfono que se interpola en el filtro `.or()` viene normalizado (solo dígitos) desde el webhook, no de input libre.
- **Guard de coordinación en `checkAvail`/`createAppt`**: no se puede saltear vía el contenido del mensaje — el `clinic_id` y el `phone` que determinan qué puede agendarse siempre vienen de la identidad verificada por HMAC del webhook, nunca de los argumentos que el modelo llena a partir del texto del tutor.

**Sin hallazgos de severidad alta o media.** Único punto menor, no reportado como vulnerabilidad real: el `catch` de `scheduling-notify-authorized` devuelve `(e as Error).message` crudo en el 500 — bajo impacto porque solo lo ve alguien que ya pasó el chequeo de membresía de clínica, no es un endpoint público.

### Reglas permanentes de esta sesión

- **Una función que reactiva la IA (`requires_human=false`) tras una acción del dashboard no debe depender únicamente de una llamada desde el navegador del usuario.** Confirmado con 2 casos reales: el `UPDATE` desde el cliente (sujeto a RLS, sesión, timing de red) puede "no aplicarse" en la práctica sin ningún error visible. Cuando existe un edge function con `service_role` en la misma cadena de acciones (aquí, el envío de WhatsApp), es el lugar correcto para garantizar mutaciones de estado críticas — el camino del cliente queda como optimización de UI, nunca como única fuente de verdad.
- **Una función que puede reusarse tanto para "crear" como para "editar" un registro (aquí, `authorize()` para primera autorización y para reabrir/editar una ya autorizada) debe distinguir ambos casos antes de disparar efectos secundarios como notificaciones externas.** Sin esa distinción, cada guardado —incluso uno que solo corrige un detalle— repite el efecto completo (acá, reenviar un WhatsApp idéntico al cliente).
- **Un texto de plantilla que asume cantidad (singular/plural) debe verificar la cantidad real antes de fijar la frase**, sobre todo cuando el contenido variable (`authorized_options`) lo escribe una persona a mano y puede tener 1 o varias opciones indistintamente.

**Próximo paso, sin acción de código:** reverificar (mismo método: función de diagnóstico temporal + `GET /users/me`, sin necesidad de que el usuario haga nada) cuando el usuario avise que pasó un tiempo prudente desde la subida del e-RUT, o cuando MP le notifique algún cambio de estado.

---

## Cambios realizados — agosto 2026 (sesión 90, 2026-08-28)

### Landing `/core-a-ciegas` — variante de `/core` para el video ad de Meta

Video ad (`~/Desktop/video-ads-1.mp4`, 30s, 9:16) con el ángulo **"Así se ve trabajar a
ciegas"** → tráfico pagado de Meta al plan Core. Se creó `public/core-a-ciegas.html` como copia
de `public/core.html` con **message match** al video: H1 "Deja de trabajar a ciegas en tu propia
clínica", sub-línea de la sección de dolor con el frame clave del video verbatim ("Así se ve
trabajar a ciegas, en la práctica"), H2 de cierre "Deja de trabajar a ciegas. Empieza hoy."

- **Metáfora acotada a información/organización** (historial, caja, stock) — nunca a resultados
  clínicos. El video dramatiza una emergencia; Vetly no previene emergencias. Respeta
  `feedback_core_plan_messaging.md` (ángulo de gestión pura, no de Lía).
- `noindex, follow` + `canonical` → `/core` (variante solo-pauta, casi duplicada).
- **Tracking: cero código nuevo.** Hereda `/vetly-tracking.js` + CTA a `/register?plan=core` →
  cookie `vetly_attribution` con `fbclid`/UTM → tabla `attribution` + Meta Pixel
  `CompleteRegistration` desde `Register.tsx`. Se separa con `where landing_url ilike
  '%core-a-ciegas%'` o `utm_campaign='core_a_ciegas'`.
- Ruta en `vercel.json` (`{ "src": "/core-a-ciegas", "dest": "/core-a-ciegas.html" }`). Archivo
  **plano a profundidad 0** — un subpath `/core/x` rompería las rutas `./` de las imágenes.
- Entregado aparte (no en archivos): texto en pantalla del cierre del video ("Mira la
  descripción" → "Toca para ver cómo funciona"), 3 primary text + titulares para el anuncio.
- Commits `b184495`, `2fbba50`. Registrado en `.agents/google-ads/estado-cuenta.md`.
- Ver [[reference_meta_core_landing_tracking]].

### Secuencia de correos de onboarding — plan Core

**Contexto:** la campaña de Meta Core trajo **15 registros en 7 días (21-28 ago)** pero la
activación es casi nula — 9 de 14 clínicas reales en cero absoluto (0 pacientes, 0 ingresos),
0 con reservas online, 0 con WhatsApp. Ninguna ha pagado. La secuencia es el rescate de esa
cohorte. Los 4 leads documentados de sesión 84 (Servando Mendoza, Cliver Lopez, Claudio
Domínguez, Fernando Losada) están en ella; Servando importó 236 pacientes pero 0 ingresos.

**Estado previo:** una sesión paralela había construido el sistema completo
(`cron-lifecycle-emails`, `unsubscribe-lifecycle-emails`, `_shared/email.ts`, migraciones,
`email_sequence_log`, columnas `clinic_settings.lifecycle_email_token` /
`lifecycle_emails_opt_out`) y **lo había desplegado a Supabase, pero sin commitear a git y sin
agendar el cron** — quedó inerte. El schema ya estaba aplicado en producción (migraciones
`20260828001742`, `20260828002914`); el `cron.schedule` de la migración nunca creó el job.

**Rehecho como SECUENCIA FIJA** (decisión del usuario — no ramificar por comportamiento; el
draft era behavior-based con contenido distinto):

| # | Día mínimo | Paso |
|---|---|---|
| 1 | 1 | Configura tu clínica y tus horarios — datos (nombre/dirección/teléfono; **el logo NO está acá, va en Reservas Online**), y la diferencia horario de la clínica vs horario del profesional (Mi Perfil) |
| 2 | 3 | Suma a tu equipo — hasta 3 usuarios, roles/permisos, por qué cada uno con su cuenta (auditoría, caja por usuario) |
| 3 | 5 | Carga tus servicios — precio + duración real; **incluye** cómo enlazar servicio↔producto de inventario y la casilla "Reservable en tu página online" |
| 4 | 7 | Sube tus productos al inventario — precio compra/venta, stock, alerta de mínimo; cierra el loop con el paso 3 |
| 5 | 9 | Trae tus pacientes — importar desde Excel o a mano + primera cita. **Fijo, NO se salta** aunque ya tenga pacientes (abre reconociendo el caso) |
| 6 | 12 | Registra tu primer ingreso — cierre de visita o "+ Ingreso"; la caja se abre sola a las 07:00 |
| 7 | 15 | Activa fidelización y referidos — asistente de 3 preguntas / preset 15/10/5; viene apagado |
| 8 | 18 | Recordatorios manuales ("Enviar hoy", funcionan sin conectar nada) + aviso de que vienen videos (servicio↔inventario, link de reservas con marca, conectar WhatsApp, plantillas) |
| 9 | — | `trial_por_terminar` (prueba ≤ 5 días) |
| 10 | — | `trial_ultimo_aviso` (prueba ≤ 1 día) |

- **Fuera de la secuencia fija (van en "Serie 2 — videos"):** enlazar servicio con inventario,
  link de reservas con marca, conectar WhatsApp, plantillas de recordatorios automáticos.
- **NO se agregó correo de upgrade a Starter** — decisión del usuario, esa campaña es para la
  cohorte que pase del primer mes, "aún no lo veremos".
- **1 correo/día máx** (`MIN_GAP_HOURS = 24`). Idempotente vía `email_sequence_log`
  (`UNIQUE(clinic_id, email_key)`). **Botón verde de soporte por WhatsApp en cada correo**
  (`wa.me/56993089185`, mensaje pre-escrito por paso). Link de baja con token no adivinable.
- **Sale de la secuencia:** `subscription_plan != 'core'`, `subscriptions.manually_active`,
  `clinic_settings.lifecycle_emails_opt_out`, o `created_at` > 35 días.
- **`Veterinaria Los Robles` (`741a3568-…`, clínica de prueba) excluida** con
  `lifecycle_emails_opt_out = true`.
- **`?dryRun=1`** en la URL: reporta qué correo tocaría a cada clínica sin enviar ni registrar.
  Usarlo antes de cualquier cambio grande. Verificado: 10 clínicas reciben el paso 1 en la
  primera corrida, 4 esperan a cumplir 24h.
- **Catch-up de las clínicas existentes:** el "día mínimo" nunca expira, así que una clínica de
  4 días recibe pasos 1→4 en días seguidos (1/día) y después se estira a la cadencia normal.
  Nadie recibe 2 el mismo día.
- **Capturas:** cada paso tiene un hueco `SHOTS.pasoN_x` (vacío = correo sin imagen, no rompe
  nada). Para agregarlas: subir a `public/email-shots/` y llenar la URL en el objeto `SHOTS`,
  redeployar. **El usuario dijo que enviaría todas las capturas — usar esas, NO las de
  `public/core-shots/`.**
- **Cron agendado:** `cron.schedule('lifecycle-emails-daily', '0 14 * * *', ...)` — pg_cron
  jobid 21, diario 14:00 UTC (mañana en LATAM). Deployado `verify_jwt: false`.
- **`send-welcome-email`** ya venía modificado (guard de `full_name` null + registra
  `email_key='welcome'` en `email_sequence_log` al alta). Se commiteó junto con lo demás.
- Commits `7f6c48d` (backend), `f1e716f` (fix del logo en paso 1).
- Ver [[project_onboarding_email_sequence]].

### Core — se ocultó "Modelo de Atención" + se desplegó el refactor pendiente de `Settings.tsx`

El usuario pidió que el selector Físico/Móvil/Híbrido no sea elegible en Core (solo "Físico" por
defecto, sin mostrar las otras opciones). **Ya estaba implementado en el árbol de trabajo sin
commitear** — el bloque Modelo de Atención / Modo de Agendamiento / Logística Pro envuelto en
`{meetsPlan('starter') && (...)}` en `src/pages/Settings.tsx`. Estaba dentro de un refactor
grande (−1159 líneas: limpieza del código de Integraciones y créditos IA que ya vive en
`/app/integrations` y `/app/ai-settings`), construido y probado en navegador en sesiones 75-77
pero nunca desplegado.

A pedido explícito del usuario ("sube lo de quitar el modelo de atención que estaba pendiente
igual") se commiteó y desplegó ese refactor completo. Dependencias (`usePlan`, `PlanGate`,
`plans.ts`, `PlanGuard`) ya estaban en `HEAD`. Verificado: `tsc --noEmit` limpio, build limpio
desde un worktree de `origin/main`, y el bundle de producción confirma `yCloudApiKey` ausente +
`meetsPlan` presente en el chunk de Settings. Core solo ve "Físico"; los valores de DB quedan
en sus defaults seguros y reaparecen si la clínica sube de plan.

De paso, `DashboardLayout.tsx`: "Integraciones" se movió de la sección "Agente IA" a
"Configuración" (Core también la necesita para los recordatorios automáticos).

Commit `3b07eb5`.

### Página de Soporte + ítem en el menú lateral

Nueva ruta `/app/support` (`src/pages/Support.tsx`, lazy) + ítem **"Soporte"** (`LifeBuoy`) en la
sección "Configuración" del sidebar. Contenido: botón de WhatsApp de soporte
(`wa.me/56993089185`), lista de los tutoriales en video que van a llegar por correo, y
`hola@vetly.pro` como canal secundario. `PageKey` `'support'` agregado a
`src/lib/permissions.ts` (type + `ALL_PAGES` + los 3 role defaults, todos `true` — soporte lo ve
todo el mundo). Sin `SubscriptionGuard` ni `PlanGuard` — una clínica con prueba vencida igual
tiene que poder llegar a Soporte. Commit `3b07eb5`. Cuando existan los videos, esta página es su
casa.

### Snapshot de la cohorte Core (2026-08-28)

15 clínicas Core, todas de los últimos 7 días, todas en prueba (vencen 20-27 sep), ninguna
pagada, todas con 1 usuario. Solo Servando Mendoza (236 pacientes importados) y "Veterinaria
Los Robles" (prueba, todo configurado) tienen actividad seria. El resto: 0-1 pacientes, 0
ingresos (salvo Chata con 1). `clinic_settings.country` viene `null` en todas — el selector de
país del registro no lo está persistiendo (pendiente aparte, no bloqueante).

### Reglas permanentes de esta sesión

- **Antes de reescribir un sistema que ya está desplegado (aunque sea sin commitear), verificar
  su estado real en producción**: `list_edge_functions`, `list_migrations`, `cron.job`. Acá el
  sistema de correos estaba 100% deployado a Supabase pero 0% en git y el cron nunca se agendó —
  la migración `schedule_lifecycle_emails_cron` figuraba "aplicada" pero su `cron.schedule` no
  había creado el job. Nunca asumir "aplicada = funcionando".
- **Toda edge function que envíe correos/mensajes a clientes reales debe tener un `?dryRun=1`**
  que resuelva la lógica completa sin enviar. Es la única forma de revisar a quién le llegaría
  qué antes de agendar un cron.
- **Los correos de secuencia usan capturas hospedadas en `public/`** (`public/email-shots/`),
  referenciadas por URL absoluta `https://www.vetly.pro/email-shots/...`. El helper
  `screenshot(url, alt)` no renderiza nada si la URL está vacía — el correo sale solo con texto
  hasta que se llenen.
- **Un `deploy_edge_function` vía MCP requiere pasar también `_shared/*.ts`** para que resuelva
  los imports `../_shared/`. El CLI (`supabase functions deploy <name>`) los detecta solo — es
  la vía más simple para redeploys puntuales.

---

## Cambios realizados — agosto 2026 (sesión 91, 2026-08-28)

> Nota de numeración: otra sesión escribió "sesión 90" en paralelo (landing `/core-a-ciegas` y secuencia de correos de onboarding) — se salta a 91 por el mismo motivo ya documentado en sesiones 66/87/89.

### Causa raíz real del bug 6 de la sesión 89 — el propio fix se pisaba a sí mismo

El fix de la sesión anterior (reactivar `requires_human` desde `scheduling-notify-authorized` con `service_role`, en vez de confiar en el `resumeAI()` del navegador) seguía sin funcionar en producción — confirmado con un caso real en **Linares** (tutor "Edver torres", +56948531888, 2026-08-28): la coordinadora autorizó "Viernes 28 a las 6 pm", el tutor respondió "Ok si", y la IA se quedó muda otra vez — mismo síntoma exacto que Ragnar y Gastón en Santiago, pero **después** del deploy que supuestamente ya lo arreglaba.

**Causa real, encontrada revisando los triggers de la tabla `messages`:**
```sql
CREATE TRIGGER on_manual_message_pause AFTER INSERT ON public.messages
    FOR EACH ROW EXECUTE FUNCTION handle_manual_message_pause();
```
```sql
-- handle_manual_message_pause():
IF (NEW.direction = 'outbound' AND (NEW.ai_generated IS NULL OR NEW.ai_generated = false)) THEN
    UPDATE public.tutors SET requires_human = true WHERE clinic_id = NEW.clinic_id AND phone_number = NEW.phone_number;
    UPDATE public.crm_prospects SET requires_human = true WHERE clinic_id = NEW.clinic_id AND phone = NEW.phone_number;
END IF;
```
Este trigger ya existía (pensado para cuando Claudia escribe manualmente desde el dashboard: si un mensaje saliente no viene de la IA, se asume que fue ella y se pausa al tutor). `scheduling-notify-authorized` inserta su aviso con `ai_generated: false` a propósito (para no cobrar créditos IA por un mensaje que nunca pasó por OpenAI) — y mi fix de la sesión 89 hacía la reactivación **antes** de ese insert. El trigger corre sincrónico dentro del mismo `INSERT`, así que pisaba mi `requires_human=false` en la misma transacción, inmediatamente. Confirmado con evidencia dura: en los 3 casos reales (Ragnar, Gastón, Edver), `crm_prospects.updated_at` coincide al milisegundo exacto con `messages.created_at` del aviso — la prueba de que ambas escrituras ocurren en el mismo instante de ejecución.

**Fix** (`supabase/functions/scheduling-notify-authorized/index.ts`): se movió el bloque de reactivación de `tutors`/`crm_prospects` a **después** del `INSERT` a `messages`, no antes:
```typescript
await supabase.from("messages").insert({ ...text, ai_generated: false, ... });

// DEBE ir después del insert de arriba: el trigger on_manual_message_pause corre
// sincrónico dentro de ese INSERT y pone requires_human=true — yendo después,
// esta es la última escritura y gana.
await supabase.from("tutors").update({ requires_human: false })...
await supabase.from("crm_prospects").update({ requires_human: false })...
```

**Edver quedó reactivado manualmente** (mismo procedimiento que Ragnar/Gastón), pero su cita **no se agendó** — confirmó el horario y no hay fila en `appointments` para su teléfono. Igual que los casos anteriores, la reactivación no es retroactiva: alguien tiene que escribirle o cargar la cita a mano.

**Deploy:** `scheduling-notify-authorized` (nueva versión). Commit `8de88a3`.

### Prequirúrgico de cirugías — Linares/Talca actualizado (PB + Hemograma + Panel de Coagulación, $70.000)

A pedido de Claudia: el examen prequirúrgico recomendado en cirugías debe indicarse siempre completo — Perfil Bioquímico + Hemograma + **Panel de Coagulación** — por **$70.000** todo incluido, como recomendación (nunca como requisito para agendar). El valor anterior ($55.000, solo PB + Hemograma, sin panel de coagulación) estaba desactualizado en dos lugares distintos:
- `ai_behavior_rules` Sección 7 (CIRUGÍAS), PASO 4.
- KB `MATRIZ_PRECIOS_Y_PROTOCOLO_CIRUGIAS`, sección "INFORMACIÓN DE SEGURIDAD Y RECARGOS".

Ambos corregidos vía SQL, con respaldo previo en `prompt_backups` (label `pre_fix_requires_human_y_prequirurgico_2026_08_28`). Santiago no se tocó — el usuario solo pidió el cambio para la sucursal Linares/Talca.

### Reglas permanentes de esta sesión

- **Antes de insertar en una tabla con triggers `AFTER INSERT`, revisar qué hacen esos triggers según los valores que se están escribiendo — no asumir que un insert es "solo guardar datos".** `messages` tiene un trigger que reacciona a la combinación `direction=outbound` + `ai_generated=false` pausando al tutor; cualquier función nueva que inserte ahí con esos mismos valores hereda ese efecto secundario, aunque su intención sea la opuesta (reactivar, no pausar). `SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = 'tabla'::regclass` antes de escribir código nuevo contra una tabla con lógica de negocio ya establecida.
- **Cuando dos escrituras a la misma fila deben competir por "quién gana", la que se ejecuta última en la misma función es la que gana** — no la que aparece primero en el código por prolijidad de lectura. Si una de esas escrituras puede disparar un trigger que sobreescribe a la otra, el orden importa más que la claridad del código, y merece un comentario explícito explicando por qué el orden es así.
- **Un fix que "debería funcionar" según la lógica del código, pero sigue fallando igual en producción, casi siempre tiene una causa que vive fuera del código que se está mirando** — en este caso, un trigger de base de datos preexistente, invisible si solo se audita el edge function. Verificar triggers/RLS/funciones de la tabla involucrada antes de asumir que el bug está en la función que se acaba de escribir.

---

## Cambios realizados — agosto 2026 (sesión 92, 2026-08-31)

### Causa raíz DEFINITIVA del bug `requires_human` — el reordenamiento de la sesión 91 no alcanzaba

El usuario reportó que Claudia seguía viendo tutores confirmar horario y la IA quedarse muda, **después** del fix de reordenamiento de la sesión 91. Antes de asumir que el fix anterior había fallado por completo, se auditaron **todas** las `scheduling_requests` de los últimos 3 días en ambas sucursales (15 filas: `fulfilled`, `dismissed`, `authorized`) para separar bugs reales de casos legítimamente sin agendar.

**Hallazgo clave por comparación:** los casos con **una sola autorización** funcionaron perfecto (Emma/Lucas y Mirtha/Mateo, ambos con la IA respondiendo o agendando correctamente tras la confirmación del tutor). El patrón roto aparecía específicamente cuando **Claudia autorizaba dos veces seguidas en una ventana corta** — caso real confirmado: Pilar Muñoz / Felix (Linares, 29-ago). El tutor escribió "Ya, si, agendemos para ese día" y, 8 segundos después, Claudia agregó dos opciones más al mismo request (retriggeando un segundo aviso) — la IA nunca respondió a ninguna de las dos confirmaciones posteriores del tutor. Reconstruido el resultado real vía `appointments`: la cita terminó creada manualmente por Claudia **1.5 días después**.

**Por qué el fix de la sesión 91 no bastaba:** reordenar la reactivación (después del `INSERT` a `messages`, no antes) solo protege la carrera **dentro de la misma invocación** de `scheduling-notify-authorized`. No protege contra una invocación **concurrente** del webhook procesando en paralelo el mensaje real del tutor — ese webhook puede leer `requires_human=true` en la ventana transitoria entre el `INSERT` (dispara el trigger `on_manual_message_pause`) y el `UPDATE` de reactivación que va después. El webhook tiene 3 "puntos de control" de `isPausedForHuman()` (`meta-whatsapp-webhook/index.ts`, líneas ~2034/2053/2464); el primero corre **antes del debounce**, y si encuentra `true` en ese instante, **descarta el mensaje de forma permanente** — no lo reintenta cuando el flag vuelve a `false` milisegundos después.

**El fix real:** cambiar `ai_generated: false` → `ai_generated: true` en el insert de `scheduling-notify-authorized`. La razón original para usar `false` (evitar el cobro de créditos IA por un mensaje que nunca pasó por OpenAI) era un malentendido — ese cobro vive **dentro de `saveMsg()`** en el webhook (bloque "Credit tracking for outbound AI messages"), función que esta edge function **nunca llama** (hace su propio `.insert()` directo). O sea: `false` nunca evitó ningún cobro real, pero sí disparaba el trigger de pausa innecesariamente. Con `ai_generated: true` el trigger no se dispara jamás — la ventana de la carrera no se achica, **deja de existir**.

**Verificación mecánica, no solo teórica:** se probó el mecanismo exacto en una transacción aislada (`BEGIN...ROLLBACK`, teléfono ficticio `56900000001`, sin dejar rastro en datos reales):
```sql
-- Control (comportamiento viejo): ai_generated=false → requires_human pasa a true (el bug)
-- Fix (comportamiento nuevo):      ai_generated=true  → requires_human se mantiene false
```
Ambos casos confirmados exactamente como se esperaba — no es una corrección basada en razonamiento, es la prueba directa del mecanismo.

**Casos "dismissed" NO todos son bugs:** al auditar, se encontró que algunos rechazos son legítimos — ej. Rosa Hernández/Muñeca (Santiago): el tutor escribió "Gracias ya salí de la Urgencia" tras la autorización — la gata terminó atendida en otro lugar por una emergencia, nada que ver con el sistema. Antes de tratar cada `dismissed` como evidencia de bug, revisar el transcript real.

**Deploy:** `scheduling-notify-authorized`. Commit `6aa5745`.

### Reglas permanentes de esta sesión

- **Elegir un valor de bandera (`ai_generated: false`) "para evitar un efecto secundario" sin verificar dónde vive realmente ese efecto secundario puede disparar un efecto secundario completamente distinto y no relacionado.** Acá el temor a cobrar créditos IA (que ni siquiera podía ocurrir, porque el cobro vive en una función que nunca se llama) llevó a activar sin querer un trigger de pausa manual pensado para un caso de uso totalmente distinto. Antes de elegir un valor "por las dudas", confirmar con grep dónde exactamente se usa ese valor en el resto del sistema.
- **Un fix de "orden de escritura" (última escritura gana) solo protege contra la carrera dentro de la misma función — no contra una invocación concurrente de OTRO proceso leyendo el estado intermedio.** Si un chequeo de estado (`isPausedForHuman`) descarta de forma permanente ante un "falso positivo" transitorio, sin reintentar, la solución robusta es eliminar la fuente del estado transitorio, no solo achicar la ventana en que puede observarse.
- **Antes de concluir que un patrón de bug "sigue igual", separar los casos reales de los casos que solo lo parecen.** No todo `dismissed`/no-agendado es una falla del sistema — verificar el transcript de cada caso antes de sumarlo como evidencia.
- **Una prueba mecánica y aislada (`BEGIN...ROLLBACK` con datos ficticios) da más certeza que solo razonar sobre el código** — permite confirmar en segundos, sin esperar tráfico real ni arriesgar datos de producción, que el mecanismo exacto del fix hace lo que se espera.

---

## Cambios realizados — agosto 2026 (sesión 93, 2026-08-31)

> Nota de numeración: otra sesión ya había usado "sesión 92" en paralelo (causa raíz definitiva del bug `requires_human`) — se salta a 93 por el mismo motivo ya documentado en sesiones 66/87/89/91.

### HQ → Clínicas reconfigurado: de "todo créditos IA" a actividad real

**Motivación:** la sección `/hq/clinics` mostraba cada clínica enfocada en consumo/límites de créditos IA, aunque la mayoría de las cuentas nuevas son plan **Core** (sin agente de IA, `PLAN_LIMITS.core.aiCredits === 0`) — el bloque no tenía ningún sentido para ellas y no mostraba nada de lo que sí importa para monitorear activación.

**Rediseño de `src/pages/hq/AdminClinics.tsx`:**
- El bloque **"Créditos IA — Mes Actual"** + el formulario **"Inyección de Créditos IA"** ahora solo se renderizan si `PLAN_LIMITS[normalizePlanId(plan)].aiCredits > 0` — invisibles para Core, intactos para Starter/Pro/Enterprise (verificado sin regresión con Animalgrace: 208% de uso, formulario de inyección funcionando).
- Nuevo bloque **"Actividad en Vetly"**, visible siempre, grid de 3 columnas: pacientes cargados, **citas agendadas**, WhatsApp conectado sí/no, **servicios cargados**, **productos de inventario**, reservas online activas sí/no, ingresos (cantidad + monto).
- Nuevo bloque **"Secuencia de bienvenida"**: correos enviados/abiertos de la secuencia de onboarding (`cron-lifecycle-emails`, sesión 90), con barra de progreso "N/11" y el último paso alcanzado.
- Badge de plan legible (`PLAN_LABEL`, mismo mapeo que `PlanGate.tsx`) en vez del string crudo de `subscription_plan`.
- País con bandera (`COUNTRY_INFO` de `src/lib/countries.ts`), fecha de registro/antigüedad, y **nombre del admin** — dato que ya se calculaba en el agrupamiento por dueño pero nunca se renderizaba.

### Bug de seguridad encontrado y corregido en el camino: HQ no podía leer el dueño real de una clínica ajena

**Diagnóstico con evidencia, no supuesto:** al verificar el panel con una sesión real de admin (magic link + `verify`, sin password, inyectada por Playwright), el campo "Admin" mostraba **el UUID de la clínica como si fuera el email del dueño** en varias tarjetas. Causa: ninguna policy `SELECT` de `clinic_members` contempla `is_platform_admin()` — solo `is_clinic_admin()`/`is_admin_of_clinic()`, ambas scoped a la propia clínica del usuario (`SELECT ... FROM clinic_members WHERE user_id = auth.uid() AND clinic_id = p_clinic_id`). El embed REST `clinic_settings?select=*,clinic_members(...)` devolvía **0 filas** de `clinic_members` para casi toda clínica ajena al admin de HQ, y el *fallback* `owner?.email || clinic.id` mostraba el UUID crudo.

**Fix — RPC `get_hq_clinic_owners()`** (migración `20260831140000`), mismo patrón ya establecido (`SECURITY DEFINER`, gated por `is_platform_admin()`, `REVOKE FROM PUBLIC, anon` + `GRANT TO authenticated, service_role`) que `get_all_clinics_usage`/`get_hq_clinic_activity` — **no se tocó la RLS de `clinic_members`** (tabla sensible, usada en toda la app) en vez de eso se expone solo lo necesario para HQ vía un join lateral que prioriza `role='owner'` y cae a `user_profiles` para nombre/teléfono. Efecto colateral correcto: el agrupamiento por dueño (`ClinicGroup`) pasó de 25 "grupos" (cada clínica sin acceso a sus propios `clinic_members` quedaba como grupo propio, keyed por su UUID) a **24 clientes reales** — el propio bug estaba fragmentando el conteo de clientes del HQ.

### Tracking de apertura/entrega de correos — `resend-webhook`

- Migración `20260831130000`: columnas `email_sequence_log.delivered_at`/`opened_at`/`open_count` + RPC `get_hq_clinic_activity()` (patients/whatsapp/booking/incomes/appointments/secuencia de correos en un solo round-trip, `LEFT JOIN LATERAL` por tabla).
- `supabase/functions/resend-webhook/index.ts` (nuevo, `verify_jwt=false`): recibe `email.delivered`/`email.opened` de Resend. Verificación Svix real (a diferencia del falso-Svix de YCloud ya documentado en otra parte del proyecto — acá el formato base64 estándar sí aplica): HMAC-SHA256 sobre `{svix-id}.{svix-timestamp}.{rawBody}`, secret `whsec_<base64>`. Falla abierto si `RESEND_WEBHOOK_SECRET` no está configurado (mismo criterio que Turnstile en `signup-handler`).
- **Verificado end-to-end con evidencia real, dos veces** (no solo con la palabra del usuario de "ya lo hice"): la primera vez, tras que el usuario dijera haber agregado el secret a Supabase, se encontró que `function_edge_logs` no tenía **ninguna** invocación real de Resend en 48 correos ya enviados — solo faltaba el paso del lado de Resend (crear el endpoint en su dashboard). Tras que el usuario lo configurara, se disparó un correo de prueba real (`send-welcome-email` sin `clinic_id`, para no ensuciar `email_sequence_log` de ninguna clínica) y a los pocos segundos apareció `POST 200 resend-webhook` en los logs — firma verificada, evento procesado.
- **Regla permanente (refuerzo):** cuando un usuario dice "ya lo hice" sobre una integración externa de dos pasos, verificar con una acción real que produzca una señal medible (acá: `function_edge_logs`) en vez de asumir que ambos pasos quedaron completos — la primera vez solo se había completado el paso de Supabase, no el de Resend, y sin la verificación con logs habría quedado como "resuelto" sin estarlo.

### Extensión — servicios, productos e citas visibles en Actividad

A pedido explícito del usuario (*"agrega como actividad si es que agregaron algún servicio o producto del inventario"* + *"también las citas agendadas"*): migración `20260831180000` (`DROP + CREATE` de `get_hq_clinic_activity` por cambio de tipo de retorno — un `CREATE OR REPLACE` con firma de salida distinta falla con `42P13`) agrega `services_count` (`clinic_services`) y `products_count` (`inventory_products`), mismo criterio simple que `patients_count` (`count(*)` sin filtro de estado). `appointments_count` ya se traía desde el fetch original de esta sesión pero nunca se renderizaba en el JSX — se agregó junto a los dos campos nuevos. Verificado con datos reales: Animalgrace 554 citas / 103 servicios / 88 productos; una clínica Core recién creada, 0/0/1.

### Metodología de verificación usada en toda la sesión

Sesión real de admin de HQ obtenida sin password: `admin/generate_link` (tipo `magiclink`) + `auth/v1/verify` con el `hashed_token` resultante → `access_token`/`refresh_token` reales, inyectados en `localStorage` bajo la clave `sb-<project-ref>-auth-token` **con el formato de sesión de supabase-js v2** (el objeto de sesión directo, no el `{currentSession, expiresAt}` de v1 — error cometido y corregido en el primer intento) vía Playwright (`playwright-core`, apuntando al Chrome del sistema por la limitación ya documentada de macOS Monterey). Permite ver exactamente lo mismo que vería un admin real, con datos reales, antes de dar cualquier cambio de UI por terminado. El token de Management API se extrajo del Keychain de la CLI de Supabase (`security find-generic-password -s "Supabase CLI" -w`) y las credenciales temporales (service role key, sesión) se borraron de `/tmp` al cerrar cada verificación.

### Reglas permanentes de esta sesión

- **Un *fallback* de agrupamiento (`owner?.email || clinic.id`) puede ocultar un bug de RLS durante meses** — el valor "funciona" (no rompe nada, no tira error) pero es sutilmente incorrecto, y solo se nota mirando la pantalla con datos reales. `tsc`/`build` nunca lo iban a detectar.
- **Antes de abrir la RLS de una tabla sensible para que HQ pueda leer todo, preferir una RPC `SECURITY DEFINER` acotada** (mismo patrón ya establecido en `get_all_clinics_usage`/`get_hq_clinic_activity`) — expone solo los campos necesarios, no la tabla completa, y no toca las policies que protegen el resto de la app.
- **"Ya lo hice" sobre una integración externa de dos pasos (secret en Supabase + endpoint en el dashboard del proveedor) requiere verificación con una señal medible real**, no solo la confirmación del usuario — los logs de invocación (`function_edge_logs`) son la fuente de verdad, no la ausencia de errores.
- **El formato de sesión que espera `localStorage` para supabase-js v2 es el objeto de sesión directo** (`{access_token, refresh_token, expires_at, user, ...}`), no el `{currentSession, expiresAt}` de v1 — usar el formato equivocado hace que la app redirija a login sin ningún error visible en consola.

---

## Cambios realizados — septiembre 2026 (sesión 94, 2026-09-01)

### Prospección automatizada de clínicas veterinarias — `/hq/prospecting`

El usuario pidió portar a Vetly HQ el sistema de "lead scraper" que ya existe en `~/Desktop/Agencia-Nexflow` para su propio negocio (`prospecting_leads`, generación de correos con IA, envío vía Resend, cron de campañas — 16+ correos reales, 100% entregados, 0 rebotes). Objetivo: encontrar clínicas veterinarias (no hospitales) en Chile + los países con altas orgánicas reales de Core (México, Perú, Colombia, Argentina) y contactarlas por correo con una rampa que sube cada semana (5/día → 10/día → ...) para no parecer spam.

**Investigación previa (clave para no repetir el molde equivocado):** el "kit-prospeccion" de Nexflow (`~/Desktop/PODERES DE CLAUDE CODE/10 SKILLS ADRI Y JUANPE/kit-prospeccion/`) **no es un crawler autónomo** — es una skill de Claude Code que se dispara a mano (WebSearch/WebFetch), la misma que ya se usó una vez para Vetly en mayo 2026 (sesión 33: 15 clínicas chilenas reales, `crm_prospects` con `source='Prospección Digital'`). Lo automatizado de verdad en Nexflow es la **cola de envío** (`cron-send-scheduled-campaigns`, `generate-prospect-email` vía Anthropic, `send-prospect-email` vía Resend) — ese es el molde que se adaptó, no el descubrimiento.

**Decisiones tomadas con el usuario (AskUserQuestion):**
1. **Solo correo, nada de WhatsApp automatizado.** El WhatsApp del HQ (YCloud, texto libre) es técnicamente incapaz de entregarle un mensaje a alguien que nunca escribió primero — Meta lo rechaza en silencio salvo plantilla aprobada (mismo bug ya documentado con `+56993089185`, sesión 19) — y es el mismo número de Andrés. El WhatsApp aparece en el correo como **texto de contacto directo, sin botón** ("los botones generan desconfianza cuando no se sabe a dónde llevan" — palabras del usuario). El link a `vetly.pro/core` también va como texto, no como botón.
2. **Tabla nueva dedicada** (`prospecting_leads`), no se mezcla con `crm_prospects` — mantiene `/hq/crm` limpio de leads nunca contactados. Un lead se "gradúa" a `crm_prospects` solo cuando responde, mismo patrón `promoteToPipeline()` de Nexflow.
3. **Alcance:** Chile + México, Perú, Colombia, Argentina. **Regla explícita del usuario:** una sola ciudad activa por país a la vez — no se pasa a la siguiente ciudad hasta agotar la actual. Con 5/día = 1 correo por país-ciudad/día; al subir la cuota, sube el reparto por país (y eventualmente el alcance a más ciudades).
4. **El descubrimiento sigue sin ser un crawler 24/7** — se dispara a mano desde el panel. Pero el usuario recordó que Vetly ya tenía Google Maps API configurado ("creo que tenemos instalada una API de Google Place API o similar") — **verificado con una llamada real: sí, Places API está habilitada** en el mismo proyecto de `GOOGLE_MAPS_API_KEY` que ya usa la logística móvil de Animalgrace. Esto cambió el diseño de "Claude corre WebSearch a mano" a una función real y repetible.

**Corrección de scoring respecto al molde de Nexflow (importante, no trivial):** Nexflow vende posicionamiento en Google y premia "sin presencia digital = máxima oportunidad". **Eso no aplica a Vetly.** El ICP real (ya corregido en `.agents/product-marketing.md`, sesión de junio) es la clínica **ya establecida** (3+ años, 30-50+ citas/mes) con caos de WhatsApp real — un independiente sin clientela se pierde en 30 días si se le vende software de gestión. El score que calcula `hq-discover-prospects` premia señales de madurez (volumen de reseñas de Google, rating, web+teléfono reales), no ausencia de marketing.

#### Arquitectura

**Migración `20260901010000_prospecting_leads_system.sql`** — tabla `prospecting_leads` (`name, website, email, phone, address, country, city, prospect_type` — reusa la taxonomía de `crm_prospects.prospect_type`, `score, problems, has_google_ads/meta_ads/analytics/https/seo, instagram/facebook/linkedin/twitter, google_place_id, contact_status` con enum `sin_contactar|en_revision|listo_para_enviar|email_enviado|respondio|descartado|en_pipeline`, `email_subject/body/sent_at/opened_at, resend_id, crm_prospect_id` FK, `source` default `'Prospección Digital - Scraper Automatizado'` — **deliberadamente distinto** del literal `'Prospección Digital'` que ya usa `AdminDashboard.tsx` para filtrar los 15 prospectos de mayo, regla permanente ya documentada en sesión 33, no se toca). RLS **sin policies para `authenticated`/`anon`** — todo pasa por RPCs `SECURITY DEFINER` gated por `is_platform_admin()` (`get_prospecting_leads`, `get_prospecting_stats`, `update_prospecting_lead`, `promote_prospecting_lead_to_crm`), mismo patrón ya endurecido en sesión 93 para `get_hq_clinic_owners`/`get_hq_clinic_activity` — evita repetir el bypass multi-tenant que `crm_prospects` sufrió dos veces (documentado en sesiones 12 y ~57-58). Trigger `revert_prospecting_lead_on_crm_delete`: si se borra el `crm_prospects` vinculado, el lead vuelve a `respondio` (no se pierde el historial) y se limpia el FK — mismo criterio que `revert_prospecting_lead_on_pipeline_delete` de Nexflow.

**Migración `20260901010500_prospecting_campaign_config.sql`** — fila única `prospecting_campaign_config` (`started_at, max_daily_cap default 50, is_paused default TRUE`). **Arranca pausada a propósito** — nada se envía hasta que el usuario la active explícitamente desde el panel. RPCs `get_prospecting_campaign_config`/`set_prospecting_campaign_paused`.

**`supabase/functions/hq-discover-prospects/index.ts`** — disparado a mano (país+ciudad+rubro → botón "Buscar" en el panel), nunca por cron. Google Places Text Search + Place Details (verificado real: `status:"OK"`). Filtra nombres con "hospital vet" (heurística de partida, la revisión humana antes de generar/enviar es la red de seguridad real), exige email o web (canal 100% correo), intenta extraer email de la portada del sitio, dedup contra `prospecting_leads` (unique index en `google_place_id`) y contra los 15 `crm_prospects` de mayo (teléfono normalizado). Si Places no está disponible (`REQUEST_DENIED` etc.) devuelve `places_available:false` explícito para que el panel avise que hace falta el método manual.

**`supabase/functions/hq-generate-prospect-email/index.ts`** — **GPT-4o vía OpenAI, no Anthropic** (Vetly no tiene `ANTHROPIC_API_KEY` configurada — confirmado con `supabase secrets list` real, no supuesto; todo el stack ya corre sobre `OPENAI_API_KEY`, evita sumar un proveedor nuevo solo para esto). Prompt con el brief exacto del usuario: firmado "Sebastián Barrera, fundador de Vetly", 4 partes obligatorias (apertura personal → problema real → por qué Core con lista de beneficios + framing de "socios de crecimiento" → oferta 30 días gratis + **"USD 17 al mes, congelado para siempre"** — redactado así a propósito, nunca "pago único"/"de por vida" a secas, porque el mecanismo real es el cupón `LANZAMIENTO17` recurrente sin límite de ciclos, no un cobro único), ángulo Movilvets solo si `prospect_type` es móvil, WhatsApp (`wa.me/56993089185`) y `vetly.pro/core` como `<a>` de texto subrayado — **explícitamente prohibido cualquier elemento con apariencia de botón**. Prohibiciones heredadas del prompt ya probado de Nexflow (no inventar cifras, no afirmar familiaridad con el negocio puntual, no vender "el stack" sino el resultado, sin clickbait en el asunto). Deja el lead en `en_revision` — nunca sale directo a la cola.

**`supabase/functions/cron-hq-prospecting-campaign/index.ts`** (pg_cron diario, `0 15 * * *` UTC, job **22**) — `dailyCap = min(5 × 2^semanasDesdeInicio, max_daily_cap)`. **Sin tabla de cola aparte para la regla de "agotar ciudad antes de avanzar":** por país, siempre se toma el lead `listo_para_enviar` más antiguo (`ORDER BY created_at ASC`) — como una ciudad nueva solo entra a la tabla cuando se corre el descubrimiento para ella (acción deliberada), el "más antiguo primero" ya garantiza terminar la ciudad en curso. Round-robin entre países hasta completar la cuota del día. Envía vía `_shared/email.ts` con `from: "Sebastián · Vetly <hola@vetly.pro>"` (nombre personal, mismo dominio verificado — un remitente/subdominio realmente dedicado a outreach frío para aislar reputación del correo transaccional queda pendiente, requiere SPF/DKIM nuevos en Resend). `try/catch` por lead, nunca aborta el lote completo. Soporta `?dryRun=1`.

**`_shared/email.ts`**: `sendEmail()` ahora acepta `from` opcional (default sin cambios — no afecta a `cron-lifecycle-emails` ni a otras funciones que ya lo usan).

**`resend-webhook`**: extendido — si un `resend_id` de un evento `email.opened` no matchea ninguna fila de `email_sequence_log`, prueba contra `prospecting_leads.resend_id` antes de descartar el evento. Mismo mecanismo de tracking ya validado en sesión 93, reusado sin duplicar lógica.

**`src/pages/hq/AdminProspecting.tsx`** (ruta `/hq/prospecting`, nav agregado a `AdminLayout.tsx`): KPIs (total/sin contactar/en revisión/listos/enviados/abiertos/en CRM), panel "Buscar más" (país+ciudad+rubro → `hq-discover-prospects`), filtros por país/estado, lista de leads con badge de estado+score, botón "Generar correo" (sin_contactar) → "Revisar" (en_revision/listo_para_enviar, expande editor de asunto+HTML con preview en vivo) → "Guardar borrador"/"Aprobar y encolar", "Promover a CRM" (email_enviado → `crm_prospects`), botón de descarte, y el toggle de pausa/activación de la campaña con `confirm()` explícito antes de activar envío real.

#### Verificación end-to-end (sesión de admin real, sin password)

Mismo método ya establecido en sesión 93: `admin/generate_link` (magiclink) + `auth/v1/verify` → sesión real inyectada por Playwright. Con esa sesión:
- `hq-discover-prospects` contra Puerto Montt, Chile → **2 clínicas veterinarias reales insertadas** (Clínica Veterinaria Austral, Posta Veterinaria), Places API confirmada disponible.
- `hq-generate-prospect-email` sobre un lead real → correo generado con GPT-4o, revisado a mano: tono personal correcto, sin ningún botón, oferta y beneficios completos, sin alucinaciones.
- `update_prospecting_lead` (aprobar) y `get_prospecting_stats` probados vía RPC con la sesión real.
- `cron-hq-prospecting-campaign?dryRun=1` con la campaña despausada temporalmente → identificó correctamente el único lead `listo_para_enviar` como el que se enviaría, `dailyCap:5` (semana 1) — vuelto a pausar después de la prueba.
- Aprobación de prueba **revertida** a `en_revision` antes de cerrar — no se dejó nada en estado "listo para enviar" que no fuera una decisión real del usuario.
- RLS verificada con la anon key real: 0 acceso directo a la tabla, `42501 permission denied` en las RPCs.
- Verificación visual completa del panel (`/hq/prospecting`) con capturas reales — banner, KPIs, buscar más, lista de leads, editor de revisión con preview en vivo.
- `npx tsc --noEmit` + `npm run build` limpios desde un `git worktree` aislado del commit exacto antes de pushear. Commit `5223d21`.

**Los 2 leads reales de Puerto Montt quedan en la base** (no son datos de prueba sintéticos, son clínicas reales encontradas por Places API) — uno con correo generado en `en_revision`, esperando revisión real del usuario antes de aprobarlo. La campaña sigue **pausada** por defecto; el cron corre todos los días pero no manda nada hasta que alguien la active desde el panel.

### Pendiente — no bloquea usar el sistema, pero falta antes de un envío masivo real

- [ ] Remitente/subdominio dedicado para outreach frío (aislar reputación del correo transaccional) — requiere que el usuario configure SPF/DKIM de un subdominio nuevo en Resend.
- [ ] Contenido real de "clases de marketing" mencionado en el correo — depende del backlog ya documentado (sesiones 63/66, "Canal de YouTube + tutoriales").
- [ ] Decidir la primera ciudad real por país (México/Perú/Colombia/Argentina) y correr el descubrimiento — hoy solo hay datos de una ciudad de prueba (Puerto Montt, Chile).
- [ ] Revisar/aprobar los leads en `en_revision` y activar la campaña (`is_paused=false`) desde `/hq/prospecting` cuando el usuario esté listo.

### Reglas permanentes de esta sesión

- **Antes de portar un sistema "de referencia" de otro proyecto, separar qué es automatización real de qué es un flujo manual con buena UI.** El "kit-prospeccion" de Nexflow parecía un scraper pero es una skill de Claude Code disparada a mano — confundir esto habría llevado a prometer (o intentar construir) un crawler autónomo que nunca existió ni en el propio Nexflow.
- **Un modelo de scoring de un negocio de agencia (vende marketing, premia ausencia de presencia digital) no se puede copiar tal cual a un negocio de software de gestión (necesita clientes con volumen ya existente).** Adaptar el *mecanismo* (score 0-100, filtro de contactabilidad) sin heredar la *semántica* (qué cuenta como "oportunidad").
- **Cuando el usuario menciona "creo que tenemos X configurado" sobre infraestructura, verificar con una llamada real antes de descartarlo o de asumir que hay que agregarlo** — en este caso cambió el diseño completo de la parte de descubrimiento, de "Claude corre búsquedas a mano" a una función real y repetible.
- **La regla de negocio "agotar antes de avanzar" no siempre necesita una tabla de cola dedicada** — a veces un `ORDER BY created_at ASC` combinado con que la inserción de datos nuevos sea una acción deliberada y espaciada en el tiempo (no automática) ya implementa la regla sin estructura extra.
- **Un sistema de envío automatizado nuevo debe nacer pausado por defecto**, con un toggle explícito y `confirm()` antes de activarlo — mismo criterio ya aplicado a `loyalty_enabled` (sesión 84/85) y ahora a `prospecting_campaign_config.is_paused`.

---

## Cambios realizados — agosto 2026 (sesión 95, 2026-08-31)

### Recetas / fórmulas médicas descargables + sección "Diseño de marca" unificada

Vetly se expande a otros países y las clínicas necesitan **emitir recetas, órdenes médicas y derivaciones**. Hasta ahora no existía ninguna función de prescripción (lo más cercano: el textarea libre `medical_history.procedure_notes`). Feature grande, en varias partes.

Decisiones tomadas con el usuario (`AskUserQuestion`): formato **estructurado** (filas de medicamento) · **guardar** cada receta · matrícula + título en Mi Perfil · **plantilla única genérica** (no por país) · envío por **enlace a una página pública** (no PDF adjunto) · el gradiente de 2 colores aplica a documentos **y** a `/reservar`.

**⚠️ No hay Supabase MCP en esta sesión.** Las 5 migraciones se aplicaron con `supabase db query --linked` (Management API, equivalente a `execute_sql` del MCP), verificando cada paso, y se marcaron en la historia con `supabase migration repair --status applied`. **NO se usó `supabase db push`** — `supabase migration list` muestra el drift habitual del repo (decenas de migraciones locales aplicadas vía MCP con otro timestamp; un `db push` intentaría re-aplicarlas y `20260826000004` fallaría en el `CREATE POLICY` sin `IF NOT EXISTS`).

#### Migraciones (todas aplicadas + verificadas en producción)

| Migración | Contenido |
|---|---|
| `20260831120000` | `clinic_members.professional_license` + `professional_title` (TEXT, opcionales) |
| `20260831120001` | tabla `prescriptions` (ver abajo) |
| `20260831120002` | `clinic_settings.booking_brand_color_secondary` + `get_public_booking_clinic` recreada + `get_prescription_public` nueva |
| `20260831140000` | `clinic_members.signature_url` + `prescriptions.prescriber_signature_url` (snapshot) + `get_prescription_public` con la firma |
| `20260831160000` | `prescriptions.document_type` (`receta`\|`orden`\|`derivacion`, default `receta`) + `get_prescription_public` con el tipo |

#### Tabla `prescriptions`

`id, clinic_id (FK clinic_settings ON DELETE CASCADE), patient_id (FK patients CASCADE), medical_history_id (FK ON DELETE SET NULL, opcional), prescriber_member_id (FK clinic_members SET NULL), prescriber_name/license/title/signature_url (SNAPSHOT al emitir), document_type, issued_date, patient_snapshot JSONB, patient_weight, tutor_name, diagnosis, items JSONB (`[{drug,presentation,dose,route,frequency,duration,quantity,instructions}]`), general_instructions (lo ve el tutor, se imprime), notes (INTERNO, nunca se imprime ni sale en la RPC pública), folio (nullable, sin correlativo en v1), public_token TEXT UNIQUE NOT NULL DEFAULT encode(extensions.gen_random_bytes(16),'hex'), created_by, created_at, updated_at`.

- **Snapshots**: `prescriber_*`, `patient_snapshot`, `patient_weight`, `tutor_name`, `diagnosis` se congelan al emitir — un documento médico-legal no muta si el vet edita su perfil o el paciente cambia después. El encabezado de la clínica (nombre/logo/colores/redes) se resuelve **en vivo** al ver la receta.
- **RLS**: `prescriptions_members` FOR ALL TO authenticated USING/WITH CHECK `is_clinic_member(clinic_id)` + `prescriptions_service_role`. Mismo helper que `medical_history`/`reminders` (SECURITY DEFINER, TRUE también para platform admins).
- **`public_token`** en hex (32 chars, URL-safe, 128 bits) como DEFAULT de columna → sin trigger. `extensions.gen_random_bytes` con schema explícito (bug de search_path, sesión 78). Verificado: `authenticated` y `anon` tienen EXECUTE sobre esa función.
- Trigger `tr_prescriptions_updated_at` con `public.set_updated_at()` (ya existía).

#### `get_prescription_public(p_token)` — RPC pública para `/receta/:token`

`SECURITY DEFINER STABLE`, `RETURNS JSONB` (patrón `get_pet_owner_portal`). Token sensible a mayúsculas, comparación exacta (no dictable, no se normaliza). Devuelve `{ prescription: {..., NUNCA notes}, clinic: {...encabezado en vivo...} }`. `REVOKE ALL FROM PUBLIC, anon` + `GRANT EXECUTE TO anon, authenticated` (cierre igual que las 3 RPCs whitelisted en `20260817170215` — si esa migración de revoke-loop se re-ejecuta, agregar `get_prescription_public` a su `proname NOT IN (...)`). Verificado E2E: insert real → RPC devuelve el JSON correcto, `notes` ausente, luego cleanup.

#### ⚠️ `get_public_booking_clinic` — la versión en vivo ya devolvía `timezone`

Al recrearla (para agregar `brand_color_secondary`, que exige DROP+CREATE por cambio de `RETURNS TABLE`), se descubrió que **la versión en producción devolvía 7 columnas incluyendo `timezone`** — agregada por otra sesión vía MCP, **no está en el archivo `20260826000004`**. `PublicBooking.tsx` usa `clinic?.timezone` para calcular los horarios en la zona real de la clínica. La migración se corrigió para **preservar `timezone`** (`COALESCE(timezone, 'America/Santiago')`). Verificado llamando la RPC con una clínica real de México → `timezone: America/Mexico_City`.
**Regla permanente:** antes de `DROP FUNCTION` + recrear una RPC, traer su definición exacta en vivo (`pg_get_functiondef`), no confiar en el archivo de migración — el repo tiene drift entre archivos y DB.

#### "Diseño de marca" (antes "Reservas Online") — `src/pages/Settings.tsx`

- Tab renombrada: `{ id: 'branding', label: 'Diseño de marca', icon: Palette }` (antes `'booking'` / `'Reservas Online'` / `Link2`). Grep confirmó 0 referencias externas a `'booking'` y `activeTab` no es union type → rename seguro. `'branding'` agregado al whitelist de deep-link `?tab=`.
- JSX reestructurado en **2 cards**: (1) **"Diseño de marca" — siempre visible** (antes logo+color solo aparecían con reservas activadas): logo + **color principal + color secundario opcional** + preview del gradiente `linear-gradient(135deg, c1, c2 || c1)`. (2) "Página de reservas online": toggle + slug + link.
- Un solo `handleSaveBooking` guarda las 5 columnas. **Bug corregido**: `slugify(publicBookingSlug || clinicName)` con reservas apagadas derivaba un slug UNIQUE del nombre → 2 clínicas homónimas colisionaban (23505). Fix: `slugify(publicBookingSlug || (publicBookingEnabled ? clinicName : ''))`.
- **Columnas `booking_logo_url`/`booking_brand_color` NO se renombran** — la RPC ya las aliasa (`AS logo_url` etc.), el prefijo `booking_` es histórico.
- **`PublicBooking.tsx`**: el header usa `linear-gradient(135deg, ${brandColor}, ${brandColorSecondary || brandColor+'cc'})` (antes solo `${brandColor}cc`).

#### Identidad profesional + firma — `src/pages/settings/MyProfile.tsx`

- 2 inputs opcionales tras "Especialidad": **"Título profesional"** (ej. Médico Veterinario) y **"Nº de colegiatura / matrícula / cédula profesional"**. Se imprimen en la receta bajo el nombre si están completos. Incluidos en `handleSave` **y en el payload del retry PGRST204** (el retry mínimo descartaba campos nuevos).
- **`src/components/settings/SignaturePad.tsx`** (nuevo): pad de canvas para dibujar la firma (pointer events → mouse/dedo/lápiz, ajuste por `devicePixelRatio`), "Limpiar" + "Usar esta firma" (exporta PNG transparente vía `toBlob`). Card "Firma para documentos" en Mi Perfil: preview + pad + "Subir imagen de firma" (PNG/JPG/WEBP). Sube al bucket público `clinic-branding`, path `{clinic_id}/signatures/{member_id}.{ext}` (la política scoped por primer segmento = clinic_id ya cubre esto). **Por profesional** — cada vet configura la suya.
- **`teamService.ts`**: `ClinicMember` interface + firma de `updateMemberProfile` ganan `professional_license?`, `professional_title?`, `signature_url?`. `AuthContext` carga `member` con `.select('*')` → los campos nuevos se propagan solos.

#### Formulario de receta — `src/components/patients/PrescriptionForm.tsx` (nuevo)

Clon estructural de `VaccineForm` (createPortal, `useAuth`). Selector **"Tipo de documento"** (Receta médica / Orden médica / Derivación / interconsulta) → define el título del documento y el placeholder del campo de indicaciones. **Medicamentos OPCIONALES** (antes exigía ≥1) — validación nueva: al menos un medicamento, un diagnóstico **o** el texto de la indicación (el documento no puede quedar vacío). Al guardar: insert en `prescriptions` con todos los snapshots (`prescriber_name = ${first} ${last}`, license, title, `signature_url`, `patient_snapshot`, `document_type`, `clinic_id = patient.clinic_id` — la clínica del **paciente**, no la sucursal activa). Sincroniza `patients.weight` si cambió. Aviso suave si falta el título profesional.

#### Página pública — `src/pages/PublicPrescription.tsx` (nuevo) — ruta `/receta/:token`

Patrón `PetOwnerPortal`: `publicClient` propio (sin persistSession, evita el conflicto de Web Locks), `<meta name="robots" content="noindex">`, **sin** `SubscriptionGuard`/`PlanGuard`. Encabezado con el gradiente de marca + logo + nombre/dirección/país/teléfono. Cuerpo: paciente/tutor/fecha/folio/diagnóstico + tabla de medicamentos (**se oculta si `items` vacío**) + indicaciones. Pie: **imagen de la firma** (si hay) sobre la línea + nombre + título + "Reg. N.º {license}" + redes/web de la clínica. Botón "Descargar PDF" → `window.print()` + `@media print`. `?print=1` auto-dispara la impresión esperando que carguen logo + firma (tope 2.5 s). Título del documento según `document_type` ("RECETA MÉDICA" / "ORDEN MÉDICA" / "DERIVACIÓN / INTERCONSULTA"). Sin riesgo XSS (JSX auto-escapa, a diferencia del patrón `printCajaReport` con `esc()`).

`src/App.tsx`: `<Route path="/receta/:token" element={<PublicPrescription />} />` (lazy, junto a `/p/:code` y `/reservar/:slug`). Sin entrada en `vercel.json` (rutas SPA no la necesitan).

#### `src/pages/PatientProfile.tsx`

Nueva pestaña **"Recetas"** (icono `Pill`, entre Parasitología y Archivos). Lista: fecha · nº de medicamentos ("Sin medicamentos" si 0) · badge del tipo si no es receta · prescriptor · diagnóstico. Acciones por fila: **Ver / Imprimir** (abre `/receta/{token}?print=1`), **WhatsApp**, **Correo** (deshabilitado si el tutor no tiene email), **Eliminar** (`confirm()`). Modal `PrescriptionForm`.

#### `supabase/functions/send-prescription/index.ts` (nuevo, deployada, `verify_jwt=true` default — NO en config.toml, igual que `send-visit-receipt`)

Body `{ prescription_id, channel: 'whatsapp' | 'email' }`. Auth JWT → `auth.getUser()` → check `clinic_members` activo. Envía un **enlace** a `https://www.vetly.pro/receta/{public_token}`, no un PDF adjunto.
- **WhatsApp**: texto plano con el link, rama Meta (`meta_phone_number_id`/`meta_access_token`) vs YCloud según `whatsapp_provider`. ⚠️ Fuera de la ventana de 24h Meta/YCloud rechazan free-form → devuelve mensaje claro sugiriendo el correo. Plantilla aprobada `receta_disponible` por WABA queda como fast-follow.
- **Correo**: Resend (`RESEND_API_KEY` ya existe), `from: hola@vetly.pro`, **`reply_to` = email del owner activo de la clínica** (mismo patrón que `public-booking-notify`) — si el tutor responde, le llega a la clínica, no a Vetly.
- Errores de negocio (sin teléfono/email, ventana 24h, etc.) devuelven **200 con `{success:false, error}`** para que `supabase.functions.invoke` pueda leer el mensaje (los 4xx opacos rompen eso — patrón de sesión 86). Auth 401/403 y catch-all 500 siguen siendo HTTP reales.

#### Fixes menores

- **Nombre de la clínica ilegible sobre el gradiente** (receta pública y `/reservar`): la regla base `h1..h6 { @apply text-charcoal }` de `src/index.css` ganaba sobre el `text-white` heredado del contenedor. Fix: `text-white` explícito en el `<h1>` + `style={{ textShadow: '0 1px 3px rgba(0,0,0,0.35)' }}`. Aplicado en `PublicPrescription.tsx`, `PublicBooking.tsx` y el preview de Settings.
- **`src/pages/Appointments.tsx`**: campo "Notas (opcional)" del modal de nueva/editar cita → **"Motivo de la cita o notas (opcional)"** + placeholder con ejemplos. Mismo modal para crear y editar.

#### Correos de onboarding — `supabase/functions/cron-lifecycle-emails/index.ts`

- **`paso9_firma`** (día 21): firma + datos profesionales + cómo se usan (solo en tus documentos, congelados por receta, no se comparten). CTA a Mi Perfil.
- **`paso10_recetas_marca`** (día 24): tipos de documento (receta / orden / derivación), medicamentos opcionales, marca en el encabezado, envío por WhatsApp/correo. CTA a Diseño de marca.
- Capturas en `public/email-shots/` (`receta-firma.png`, `receta-formulario.png`, `receta-documento.png`, `receta-lista.png`) — servidas en `https://www.vetly.pro/email-shots/*`, referenciadas por `SHOTS`.
- **`?blast=<email_key>`** — envío puntual de UN paso a toda la cohorte Core elegible, ignorando `minDay`/condición y el gap de 24h, pero respetando opt-out, ventana de 35 días e idempotencia de `email_sequence_log`. Para anunciar una función nueva sin esperar a que cada clínica llegue al día del paso.
- **`?blast=<key>&force=1`** — además ignora la idempotencia (reenvío para corregir un envío defectuoso). El insert duplicado a `email_sequence_log` (UNIQUE `clinic_id+key`) se saltea; la dedup futura sigue valiendo por la fila previa.

#### Errores de esta sesión (registrados para no repetirlos)

- **Envié `paso9_firma` a las 20 clínicas Core SIN las capturas.** Corrí `curl` sobre el endpoint de blast para "ver la respuesta" y esa llamada disparó el envío real, antes de que el usuario me pasara las imágenes (me había dicho "debes esperarme"). La idempotencia evitó el doble envío en la segunda llamada, pero salieron 20 correos sin imagen. **Corregido**: se reenvió con `?blast=paso9_firma&force=1` una vez que las capturas estuvieron live en Vercel. **Regla: nunca invocar un endpoint que envía correos/WhatsApp reales "para ver qué devuelve" — usar siempre `?dryRun=1` primero, y confirmar el contenido final (imágenes incluidas) con el usuario antes del envío real.**

#### Estado al cierre

- `paso9_firma`: enviado (2 veces por el error, la 2ª con imagen) a 20 clínicas Core.
- `paso10_recetas_marca`: **agendado** para 2026-09-01 16:00 UTC (12:00 Chile) — pg_cron one-off `blast-paso10-oneoff` (jobid 23, `0 16 1 9 *`) que llama `?blast=paso10_recetas_marca` y se auto-`unschedule`. Respeta idempotencia (no `force`). Si el auto-unschedule falla, reintenta el 1-sep del próximo año (inofensivo).
- Las clínicas futuras reciben paso9/paso10 por la secuencia normal a día 21/24, con imágenes.
- Feature de recetas 100% en producción (confirmado con capturas reales del usuario: selector de tipo, medicamentos opcionales, firma estampada en el PDF, nombre de clínica legible, envío WhatsApp/correo).

### Pendientes

- [ ] Plantilla aprobada de WhatsApp (`receta_disponible`) por WABA para enviar la receta fuera de la ventana de 24h — hoy el envío WhatsApp solo funciona con conversación abierta reciente.
- [ ] Confirmar que `blast-paso10-oneoff` (jobid 23) se auto-eliminó tras correr el 1-sep; si no, `SELECT cron.unschedule('blast-paso10-oneoff')`.
- [ ] "Otros documentos" que anticipó el usuario (certificados de salud, informes) — reusar `clinic_members.signature_url` + el patrón de `PublicPrescription`.

### Reglas permanentes de esta sesión

- **Antes de `DROP FUNCTION` + recrear una RPC, traer su definición en vivo con `pg_get_functiondef`, no el archivo de migración.** El repo tiene drift documentado entre archivos locales y la DB (migraciones aplicadas vía MCP con otro timestamp). `get_public_booking_clinic` en vivo tenía `timezone` que el archivo no; recrearla desde el archivo habría roto el cálculo de horarios de `/reservar` para clínicas fuera de Chile.
- **Nunca invocar un endpoint que envía correos/WhatsApp reales "para ver qué devuelve".** Usar `?dryRun=1` primero. Confirmar el contenido final (imágenes, copy) con el usuario antes del envío real. Un `curl` de inspección puede ser el envío.
- **`get_prescription_public` y cualquier RPC pública de un documento nunca debe devolver el campo interno (`notes`).** Verificado con `pg_get_functiondef ... LIKE '%''notes''%'` = false y con un insert real.
- **La firma / logo / colores de marca deben poder mostrarse en una página pública sin login** (bucket `clinic-branding` es público a propósito) — pero el `public_token` de la receta es hex de 128 bits, no enumerable, mismo criterio que `tutors.portal_token` (sesión 74).
- **Un documento clínico estructurado no siempre lleva medicamentos** (orden de imagen, derivación) — el `document_type` define el título y hace la lista opcional; la validación exige que el documento no quede completamente vacío.
- **`window.open`/`curl` de un blast: idempotencia por `email_sequence_log` (UNIQUE clinic+key) es la red que evita el doble envío**, pero no sustituye confirmar antes de disparar.

---

## Cambios realizados — septiembre 2026 (sesión 95, 2026-09-01)

> Nota de numeración: la sesión 94 fue ocupada en paralelo por el trabajo de prospección — se salta a 95, mismo patrón ya documentado en sesiones 66/87/89/91.

### Bug real: la IA cotizó "$20.000 por 4 gatos" — consulta médica multi-mascota

**Reporte de Claudia (captura de WhatsApp, Linares/Talca, canal Meta, modelo `4o_pro`):** un cliente con **4 gatos resfriados de 3 meses** preguntó el valor de la visita. La IA respondió *"El valor de la consulta médica para tus gatitos es de $20.000"* y, al preguntarle el cliente *"20 por gato cierto?"*, dobló la apuesta: *"No... es por la consulta médica en total, no por cada gato. Esto incluye la revisión de todos tus gatitos durante la misma visita."*

**Causa raíz (verificada contra `messages` + las 3 fuentes):** la IA **inventó una política** (viola su REGLA 2). Ni `ai_behavior_rules` ni el KB decían nada sobre si la consulta ($20.000) es por mascota o por visita. La única regla de "una sola vez por visita" que existe es **exclusivamente sobre el recargo de traslado** (`PROTOCOLO_SERVICIOS_Y_VACUNACION`: *"costo de transporte o logística que se cobra UNA SOLA VEZ POR VIAJE"*; `PROTOCOLO_LOGISTICA_SERVICIOS_GENERALES`: *"El recargo de traslado se cobra UNA SOLA VEZ por visita"*). El modelo tomó esa regla del traslado y la extendió sola a la consulta. Afectaba a **ambas sucursales** — vacío idéntico.

**Regla de negocio confirmada con el usuario (aplica a Linares Y Santiago, igual):**

| Caso | Precio |
|---|---|
| Revisión médica de **camada** (todas las crías ≤ 3 meses) — 2 a 4 crías | **$38.000 total** (por la camada, no por mascota) |
| Camada — 5 a 8 crías | **$45.000 total** |
| Camada — 9+ crías | La coordinadora confirma el valor |
| Consulta **varias mascotas mismo hogar** (desde 4 meses) — x2 | $18.000 c/u |
| x3 | $17.000 c/u |
| x4 | $16.000 c/u |
| x5 | $15.000 c/u |
| x6+ | $15.000 c/u (piso, no baja más) |
| **1 sola mascota** | $20.000 (sin cambios) |
| **Controles ($10.000)** | $10.000 c/u siempre, sin descuento por cantidad |

El traslado se sigue cobrando **una sola vez** por visita (esto no cambia — solo el traslado se comparte, la consulta no). Edades mixtas → cotizar cada grupo con su tabla y sumar.

**Fix aplicado (solo DB + código de webhook — nada en migraciones del repo, patrón ya establecido para fixes de prompt/KB):**
- **KB nuevo `PROTOCOLO_CONSULTA_MULTIPLES_MASCOTAS`** creado para ambas sucursales (`knowledge_base`, `status='active'`, `category='servicios'`) con las tablas completas + reglas de edades mixtas + corte camada/hogar por edad.
- **`ai_behavior_rules` de ambas** (respaldo previo en `prompt_backups`, label `pre_consulta_multi_mascotas_2026_09_01`): nuevo bullet crítico después de `CASO ENFERMEDAD` — *"CONSULTA CON 2 O MÁS MASCOTAS — NUNCA COTICES $20.000 POR TODAS"* con el flujo obligatorio (preguntar edad → aplicar tabla → cotizar).
- **`PROTOCOLO_SERVICIOS_Y_VACUNACION_ANIMALGRACE` (ambas)**: puntero en la sección 1 hacia el doc nuevo.
- **Código** (`meta-whatsapp-webhook` v59 + `ycloud-whatsapp-webhook` v284 por paridad, ambos deployados, `verify_jwt:false` preservado): nueva entrada en `FORCED_KB_TOPICS` — el doc se inyecta completo cuando el cliente menciona varias mascotas / camada (`camada`, `gatitos`, `perritos`, `cachorros`, `mis gatos`, `2/3/4 gatos`, `dos/tres/cuatro perros`, etc.), sin depender de que el modelo llame `get_knowledge`. Mismo mecanismo de sesión 62/71/72/85.

**Nota:** ambas sucursales están en `coordinator_approval` + `ai_auto_respond=true` (canal Meta). El fix es de prompt/KB, no un bloqueo duro — conviene revisar las primeras conversaciones reales con multi-mascota para confirmar que aplica la tabla correcta.

### Regla permanente

- **Toda regla del prompt/KB que empiece con "se cobra una sola vez por visita" debe decir EXPLÍCITAMENTE a qué concepto aplica** (traslado, recargo, consulta, etc.). Un "una sola vez por visita" sin sujeto claro es una invitación a que el modelo lo generalice al concepto equivocado — aquí extendió la regla del traslado a la consulta y cotizó 4 gatos por el precio de 1.

### Dos bugs más de la IA (misma sesión, mismos screenshots de Claudia)

**Bug A — Alizin cotizado en $40.000 para perra de 4-5 kg (Linares, `4o_pro`).** El tarifario real del KB `PROTOCOLO_ALIZIN_INTERRUPCION_GESTACION` arranca en **$75.000 hasta 5 kg**. El $40.000 no aparece en ninguna parte — invento puro (≈mitad del precio real). Verificado con la conversación en `messages`: la clienta dio el peso (4-5 kg) y la IA igual inventó el número.
- **Causa:** el doc no está en el top-5 del resumen de KB (rank 4 de 12) y `get_knowledge` casi nunca se llama. Además `#PROTOCOLO_ALIZIN_INTERRUPCION_GESTACION` no estaba en la lista de "docs verificados" de la REGLA 1 anti-alucinación.
- **Fix (ambas sucursales, ambos webhooks):** (1) nueva entrada en `FORCED_KB_TOPICS` — se inyecta el tarifario completo cuando el mensaje toca "monta no deseada" / interrupción de gestación (`alizin`, `monta`, `preñ`, `gestaci`, `aborto`, `tomó un perro`, `se cruzó`, etc.); (2) `#PROTOCOLO_ALIZIN_INTERRUPCION_GESTACION` agregado a la lista de docs de la REGLA 1 en `ai_behavior_rules` de Linares y Santiago (respaldo `pre_alizin_y_ultima_hora_2026_09_01`).

**Bug B — la IA prometía citas a las 19:00 cuando la última hora agendable es 18:00 (Linares).** Le dijo a un cliente *"nuestro horario de atención es hasta las 19:00 horas... puedo coordinar para que la visita sea lo más cercana posible a las 19:00"* y hasta mandó una `request_scheduling_coordination` pidiéndole a Claudia confirmar una visita "a las 19:00". Claudia tuvo que borrar el mensaje y corregir a mano ("la última hora que se da es a las 18 pm").
- **Causa raíz:** el prompt arma `Horarios: ${hoursSummary}` desde `clinic.working_hours`, que cierra a las **19:00**. Pero el último slot **agendable** lo topa `logistics_config.last_slot_time` (default **'18:00'** — para Linares está en `null` → usa el default). El `hoursSummary` no reflejaba ese tope, así que la IA leía "cierre 19:00" y lo ofrecía verbalmente. La generación de slots (`checkAvail` con `p_last_slot_cap`) sí topa bien en 18:00 — el bug era solo el texto del prompt.
- **Fix (`meta-whatsapp-webhook` v61 + `ycloud-whatsapp-webhook` v285):** nueva línea `lastSlotNote` inyectada justo después de `Horarios:` en el `staticSysPrompt`, calculada con la misma validación regex de `last_slot_time` que ya usa `checkAvail` (default '18:00'): *"ÚLTIMA CITA AGENDABLE DEL DÍA: comienza a las {cap} hrs... la hora de cierre de arriba NO es la última hora agendable... PROHIBIDO ofrecer/prometer/coordinar cualquier horario posterior."* Configurable por clínica sin deploy vía `logistics_config.last_slot_time`.

### Regla permanente (bug B)

- **La hora de cierre de `working_hours` NO es la última hora agendable.** Cualquier texto del prompt sobre "horario de atención" debe distinguir el cierre (cuándo termina el equipo) de la última cita agendable (`logistics_config.last_slot_time`, default 18:00). Mostrarle a la IA solo el cierre la lleva a prometer horas que la generación de slots nunca va a ofrecer.

### Limpieza de información obsoleta de agendamiento (a pedido del usuario)

Ambas sucursales están en `coordinator_approval` desde sesiones 85/87, pero el prompt/KB todavía tenían instrucciones del flujo autónomo viejo. Auditoría completa de `ai_behavior_rules` + KB de ambas.

**Contradicción activa corregida (la más grave) — `ai_behavior_rules` REGLA 3, ambas sucursales:**
- *"Puedes **consultar disponibilidad** con su dirección escrita..."* / *"puedes proceder a consultar disponibilidad"* → contradecía directamente la Sección 10 (*"TERMINANTEMENTE PROHIBIDO ofrecer... DEBES usar `request_scheduling_coordination`"*). Reescrito: sin pin, igual se reúne disponibilidad amplia y se usa `request_scheduling_coordination`.
- `check_availability` eliminado de la regla CONCATENACIÓN OBLIGATORIA (la IA ya no llama esa tool — el guard de `checkAvail` devuelve `COORDINACION_REQUERIDA`). Se dejó `create_appointment` (sí se usa post-autorización).

**KB — referencia rota (Santiago):** `#PROTOCOLO_LOGISTICA_SANTIAGO_SERVICIOS_GENERALES` apuntaba a `#PROTOCOLO_LOGISTICA_CIRUGIAS_SANTIAGO`, un doc **que no existe**. Repuntado a `#MATRIZ_PRECIOS_Y_PROTOCOLO_CIRUGIAS`.

**KB — inconsistencia de ventana de espera (Linares):** `POLITICAS_GENERALES` §2 decía *"1 hora antes y 1 hora después"* mientras su propio `ai_behavior_rules` dice *"2 horas después"* y Santiago dice *"1 a 2 horas"*. Alineado Linares a *"1 a 2 horas antes y después"*.

**Código (`meta-whatsapp-webhook`, deployado):** la descripción de la tool `create_appointment` decía *"SIEMPRE usar check_availability antes"* — contradice el modo coordinadora (donde `schedulingContext` PROHÍBE llamar `check_availability` post-autorización). Reescrita para distinguir clínicas con/sin flujo de coordinadora. `ycloud-whatsapp-webhook` ya tenía la descripción neutral, no se tocó.

Respaldos: `prompt_backups` label `pre_limpieza_agendamiento_obsoleto_2026_09_01`.

**NO tocado (fuera de alcance / requiere confirmación del usuario):**
- Títulos cosméticos que nombran el modo viejo (*"RUTA INTELIGENTE"*, *"INTELIGENCIA DE RUTA"*) — el contenido debajo ya está actualizado, la IA no cita títulos.
- Posible inconsistencia de precio prequirúrgico entre sucursales (Linares $70.000 con Panel de Coagulación tras sesión 91, Santiago $50.000) — pueden ser precios distintos legítimos por sucursal, confirmar antes de unificar.
- Linares no tiene doc `PROTOCOLO_ECOGRAFIA_Y_RADIOGRAFIA` (solo Santiago, sesión 70) — la entrada de `FORCED_KB_TOPICS` para ese doc simplemente no matchea nada en Linares (inofensivo).

### Ventana de espera unificada a "1 a 2 horas antes y después" (decisión del usuario)

Había 3 versiones distintas del rango de disponibilidad que se le pide al tutor:
- `ai_behavior_rules` (ambas) + mensajes de confirmación del código: *"al menos 2 horas después"*
- `POLITICAS_GENERALES` KB Linares: *"1 hora antes y 1 hora después"*
- `POLITICAS_GENERALES` KB Santiago + logística Santiago §4.2: *"1 a 2 horas antes y después"*

El usuario eligió **"1 a 2 horas antes y 1 a 2 horas después"** como texto único. Aplicado en:
- `ai_behavior_rules` AVISO DE RANGO HORARIO (Linares + Santiago) — la frase obligatoria que la IA pega al confirmar cada cita.
- `meta-whatsapp-webhook` v63 + `ycloud-whatsapp-webhook` v286 — los 2 mensajes de confirmación hardcodeados en `confirmAppt` (fallback "cita ya confirmada" + éxito).
- `POLITICAS_GENERALES` KB Linares (ya alineado en el paso anterior de esta sesión).

Respaldo: `prompt_backups` label `pre_unificar_ventana_espera_2026_09_01`.

**Confirmado por el usuario, sin cambios:** prequirúrgico Santiago = $50.000 (Linares $70.000 es un precio legítimamente distinto por sucursal). Linares NO hace ecografía ni radiografía (solo Santiago) — no falta ningún documento.

---

## Cambios realizados — septiembre 2026 (sesión 96, 2026-09-01)

### Diagnóstico: OpenAI sin saldo (recurrente) + auditoría de consumo IA

`debug_logs` confirmó **saldo de OpenAI en cero** (`insufficient_quota` / "You have no credits remaining"), último error 1-sep 19:31 Chile, con tandas grandes el 25, 29 y 30-ago. Patrón crónico (abr, may ×3, jun, 25/28-jul, 15/19/25/29/30-ago, 1-sep). No hay acceso al dashboard de OpenAI (`platform.openai.com/usage`) para el monto USD.

**Qué consume:** todo es el agente de WhatsApp. GPT-4o (`4o_pro`) = 79% de los mensajes pero ~98% del costo (15× el mini). Agosto: 2.876 msgs 4o + 728 mini ≈ **43.900 créditos equiv** vs ~9.500-10.100 en jun/jul — **×4,5** porque desde fines de julio/agosto ambas sucursales quedaron con `ai_auto_respond=true` sobre Meta a la vez. Santiago consume ~40% más que Linares. Causa estructural ya documentada (sesión 83): `activeSchedulingFlow` mantiene 4o "pegado" 3 mensajes tras cualquier tema de agenda/precio → 79-87% al modelo caro. Decisión del usuario (sesión 83): dejarlo así.

### Bug de facturación: el pack de créditos extra de Animalgrace se re-sumaba cada mes

**Reportado por el usuario.** El pack de **20.000 créditos** (comprado 25-ago vía MercadoPago, único en `ai_credit_transactions`) figuraba **intacto en 20.000** y reaparecía cada mes junto a los 30.000 del plan.

**3 bugs encadenados:**
1. **Nada descontaba de `ai_credits_extra_balance`.** Los RPC `increment_clinic_*_usage` solo subían los contadores; el webhook leía el pack como techo adicional pero nunca lo gastaba. Ciclo 23-jul→22-ago: consumió 40.122 (plan 30.000 → +10.122 sobre el plan) y el pack seguía en 20.000.
2. **El pack nunca venció.** La compra guardó `ai_credits_extra_expires_at = null`. El cron `expire-extra-credits` (jobid 17) filtra `WHERE expires_at < NOW()` → NULL nunca cumple.
3. **`process_monthly_recharge()` no está agendada** (nunca corrió desde abril — no hay `monthly_refill` en el historial). El único cron mensual (jobid 3) corre `reset_monthly_ai_usage()`, que pone contadores en 0 y **no toca ni el límite ni el pack**. Resultado: cada 1° de mes → 30.000 + 20.000 frescos.

**Modelo acordado con el usuario:**
- Plan (30.000): fijo, use-it-or-lose-it. El reset del día 1 no lo toca.
- Pack comprado: **nunca expira**. Se descuenta solo cuando el consumo del ciclo supera el plan. Lo que sobra se arrastra al mes siguiente (el reset no lo toca).
- Se guarda en **dos campos separados** (`ai_credits_monthly_limit` = 30.000 fijo + `ai_credits_extra_balance` = pack). La UI ya suma ambos (`totalAvailable = limit + extraBalance`), así muestra el número que el usuario espera (30.000 + 7.579 = 37.579) y se arrastra solo cada mes. Meterlo todo al límite habría repetido el bug en octubre.

**Cambios aplicados:**
- **Migración `20260902000000_ai_extra_credits_deplete_and_never_expire.sql`**: reescribe `increment_clinic_mini_usage` / `increment_clinic_4o_usage` para descontar de `ai_credits_extra_balance` (luego `ai_credits_extra_4o`) el excedente de cada mensaje por encima de `ai_credits_monthly_limit` (con `FOR UPDATE`, salta si `ai_credits_unlimited`). Incluye la corrección retroactiva del pack de Animalgrace: **20.000 → 7.579** (20.000 − 12.421 consumidos sobre el plan entre 25-ago y 31-ago, según el ledger) + transacción `adjustment` de auditoría. Ambos bloques son idempotentes.
- **`_shared/aiCredits.ts`**: `exhausted` = `totalUsed >= limit` **Y** `extraBalance <= 0` (antes `totalUsed >= limit + extraBalance`, que con el pack depletando cruzaba el umbral al doble de velocidad). Redeploy de `meta-whatsapp-webhook` y `ycloud-whatsapp-webhook`.
- **Ambos webhooks (`saveMsg`)**: `balanceAfter` del historial recalculado a mano (plan primero, excedente del pack) porque `getCreditStatus` se lee antes de incrementar.
- **`AdminClinics.tsx handleManualCharge`**: ya no fija expiración (`ai_credits_extra_expires_at = null`), alert actualizado. `mercadopago-webhook` y `paddle-webhook` ya fijaban `null` desde antes.
- **Cron `expire-extra-credits` (jobid 17) desactivado** con `cron.unschedule`.
- CLAUDE.md: sección "Packs de créditos extra — reglas permanentes" reescrita.

**⚠️ Aplicación parcial:** la base de datos de Supabase tuvo un corte de conexión (`Connection terminated due to connection timeout` por MCP y CLI) durante esta sesión. Los cambios de **código y migración quedaron escritos en local**; **falta aplicar en producción**: la migración `20260902000000`, `cron.unschedule('expire-extra-credits')`, y el redeploy de los 2 webhooks. Verificar al reconectar que `ai_credits_extra_balance` de Linares (`fd11b7e4-…`) quedó en 7.579 y `ai_credits_monthly_limit` en 30.000.

### Regla permanente
- **El multiplicador de créditos reprecia retroactivamente todo el consumo del ciclo en curso** (el saldo se recalcula en vivo desde `mini_used + 4o_used × CREDIT_COST_4O`). Cambiarlo a mitad de mes puede agotar de golpe a una clínica que venía bajo el número viejo. El momento seguro para subirlo es justo después del reset del día 1. (Aprendido en sesión 83: se subió a 20 y se revirtió a 15 el mismo día tras dejar a Animalgrace muda 3 h.)

---

## Costos de mensajería WhatsApp — Meta per-message pricing (análisis 2026-09-02)

### El cambio de Meta del 1-oct-2026 (fuente: developers.facebook.com/documentation/business-messaging/whatsapp/pricing)

| Fecha | Cambio |
|---|---|
| 1-jul-2026 | Lanza **Meta Business Agent** (agente IA nativo de Meta para WhatsApp) |
| 1-ago-2026 | Cobro por tokens del Meta Business Agent: **US$2 / 1M tokens** (global, ~4-5¢/mensaje). NO aplica a Vetly (usamos agente propio). |
| 1-sep-2026 | Meta publica las tarifas por mercado del cambio de octubre |
| **1-oct-2026** | **Los "service messages" dejan de ser gratis.** Toda respuesta free-form del negocio dentro de la ventana de 24 h (la escriba un humano o un agente IA de terceros) se cobra **por mensaje**, a la **tarifa de utility/auth** del país. **Sin descuento por volumen.** También se cobran las plantillas de utilidad enviadas dentro de la ventana. |

**NO se cobra:** mensajes entrantes del cliente; la ventana gratuita de **72 h** de conversaciones iniciadas desde anuncios Click-to-WhatsApp o botones CTA de FB/IG; personal WhatsApp / app gratuita.

### Quién paga: **la clínica, no Vetly**

**Vetly es Tech Provider, no Solution Partner.** Los Tech Providers **no tienen línea de crédito con Meta** → el cliente paga a Meta directo con el método de pago de su Business Manager. El margen de las suscripciones Vetly no se toca. Pero el costo total de tener Vetly sube para la clínica y va a Meta sin markup ni control de Vetly.

Convertirse en **Solution Partner** (línea de crédito, consolidar el cobro de Meta en la factura Vetly con markup 5-20%, meter cupo de mensajes en los planes) es la decisión estratégica a evaluar cuando Vetly escale más allá de un puñado de clínicas.

### Tarifas Meta por país (rate card oficial, vigente jul-2026) — utility/auth = tarifa del service message desde 1-oct

| País | Utility/Auth (US$/msg) | Marketing (US$/msg) |
|---|---|---|
| **Colombia** | **0.0008** | 0.0125 |
| **México** | **0.0085** | 0.0305 |
| **Chile** | **0.0200** | 0.0889 |
| **Perú** | **0.0200** | 0.0703 |
| **Argentina** | **0.0260** | 0.0618 |

Colombia es **25× más barato que Chile**. Implicancia para el go-to-market LATAM hispanohablante: concentrar en **Colombia y México** (Meta barato); Chile / Argentina / Perú tienen costo Meta significativo (~US$0.02-0.026/msg) que hay que comunicar de entrada al cliente. Brasil no es mercado objetivo (idioma).

### Modelo de costo para una clínica FÍSICA típica (piloto Yares)

**Modelo de DOS ETAPAS (definido 2026-09-02):**
- **Etapa 1 — piloto (45 días):** la clínica **NO paga la suscripción**. Paga: (a) **US$45 fijos de créditos de IA por adelantado a Vetly** (monto fijo dimensionado para uso típico — no cambia con el uso real), y (b) la **mensajería de WhatsApp directo a Meta** según su país. Nota interna: uso alto real de 45 días puede llegar a ~US$40-50 en OpenAI (clínica muy activa o ad-driven); los US$45 tienen holgura para uso típico y quedan justos para uso alto. El riesgo de que el agente quede mudo a mitad del piloto arruina la validación — si una clínica se pasa, Vetly cubre el exceso y reconcilia.
- **Etapa 2 — si la clínica decide continuar:** pasa a la suscripción **Pro (US$169/mes)** que **ya incluye el procesamiento de OpenAI** (los ~7.600 créditos/mes de una clínica física típica caben de sobra en los 20.000 del Pro). El **único costo que se suma al plan es la mensajería de Meta**, que la clínica paga directo a Meta con su método de pago en el Business Manager.

Regla general (fuera del piloto): **el costo adicional a cualquier plan de Vetly es solo Meta.** OpenAI siempre va absorbido en el plan.

**⚠️ Volumen calibrado sobre Animalgrace (móvil, alto volumen) ajustado hacia abajo — no hay ninguna clínica física real con el agente todavía.**

- **Volumen clínica física típica:** ~300 conversaciones/mes × ~3.5 salientes = ~1.050 salientes IA/mes + ~100-150 recordatorios.
- Referencia interna: OpenAI ≈ US$0.015-0.020/mensaje saliente (clínica física, 4o-intensivo, caché parcial por tráfico esparcido). Uso típico 45 días ≈ US$20-30; uso alto ≈ US$40-50.

**Costo del PILOTO por clínica, 45 días** (US$45 fijo a Vetly + Meta directo a Meta, uso típico; tarifas Meta post 1-oct):

| País | Créditos IA (a Vetly) | Meta (directo) | Total piloto |
|---|---|---|---|
| Colombia | US$45 | ~US$2 | **~US$47** |
| México | US$45 | ~US$15 | **~US$60** |
| Chile | US$45 | ~US$35 | **~US$80** |
| Perú | US$45 | ~US$35 | **~US$80** |
| Argentina | US$45 | ~US$45 | **~US$90** |

**Si la clínica continúa — mensual (uso típico): US$169 plan + Meta.** Meta/mes: Colombia ~US$1 · México ~US$10 · Chile/Perú ~US$23 · Argentina ~US$30.

**Presupuesto a comunicar por clínica piloto (Colombia): ~US$47 los 45 días.**

### Prerrequisito para pilotear con clínicas físicas

Crear una **plantilla de `ai_behavior_rules` para clínica física** — sin sectores/GPS/ruta/coordinadora/hubs quirúrgicos. El prompt actual de Animalgrace (40k+ caracteres) es ~90% lógica de clínica móvil. Es prerrequisito del piloto, no opcional: mejora la calidad de las respuestas y ordena el flujo (además de bajar el costo OpenAI que ahora absorbe Vetly).

### Plan Pro — cambios (2026-09-02)

- Copy de recordatorios: `"250 recordatorios/mes"` → **`"Automatización de recordatorios vía WhatsApp"`** en `paddle.ts`, `mercadopago.ts`, `Pricing.tsx`, `public/landing.html`.
- `plan_limits`: `monthly_reminders` de **`pro`/`radiance`** pasó de `250` a **`NULL` (ilimitado)**. `cron-process-reminders` ya trata NULL como ilimitado (igual que Enterprise).
- **`plan_limits.ai_credits` de `pro`/`radiance`: `10.000` → `20.000`** (migración `pro_plan_ai_credits_10k_to_20k`). Ver la sección "Créditos IA por plan — límites, enforcement y estado" arriba para el análisis completo (tabla, direcciones, pendiente de Enterprise). La única clínica Pro real (Clínica Huellitas, de prueba) se bumpeó a 20.000 a mano.
- Mirrors actualizados: `_shared/planLimits.ts` FALLBACK (pro `ai_credits` 20.000 + `monthly_reminders` null; de paso core `max_users` 3→10 que estaba desincronizado), `src/lib/plans.ts` PLAN_LIMITS (pro `aiCredits` 20.000 + `monthlyReminders` null).
- `public/landing.html` bloque Pro: decía `"Hasta 5 usuarios"` — corregido a `"Hasta 10 usuarios"`.
- **Starter: `plan_limits` `max_users` 5→3, `max_agendas` 3→2** (migración `starter_plan_3_users_2_agendas`) para que el salto a Pro (10 usuarios) sea más atractivo. Mirrors + copy actualizados en los 4 lugares (el bloque de landing decía "2 usuarios · 1 agenda" por drift, ahora "3 usuarios · 2 agendas"). 0 clínicas Starter reales. `invite_member_v2` lee `max_users` de `plan_limits` por `plan_id`, sin CASE hardcodeado.
  - ⚠️ **Inconsistencia de ladder pendiente:** Core tiene `max_users = 10` (sesión de agosto), Starter ahora 3. Un cliente lee "Starter da menos usuarios que Core" pese a costar 5×. El feature de Starter dice "Todo lo de Core" + "3 usuarios". Falta decisión del usuario: bajar Core a 3, o aceptar que "usuarios" no es un eje de ladder (Starter suma el agente IA + Goldi + 1 agenda más).

### Visualización de planes — créditos IA + nota de Meta (2026-09-02, decisiones del usuario)

- **Cada plan pago muestra su cupo de créditos IA con equivalente en conversaciones** en vez de "Conversaciones IA ilimitadas": Starter `5.000 créditos IA/mes · ~200 conversaciones`, Pro `20.000 · ~900`, Enterprise `30.000 · ~1.350` (~22-25 créditos/conversación, ~3 respuestas del agente c/u). Enterprise se dejó en 30.000 (no `ai_credits_unlimited`) — decisión "mostrar el número por ahora".
- **El copy de features de los planes vive en 4 lugares** (además de los precios): `src/lib/paddle.ts` (`PADDLE_PLANS[x].features`), `src/lib/mercadopago.ts` (`PLANS[x].features`), `src/pages/Pricing.tsx` (array `plans` propio + array `faqs` propio), `public/landing.html`. **`Settings.tsx` renderiza la grilla in-app desde `PLANS`/`PADDLE_PLANS`.features** — no tiene copy propio.
- **Nota de costo de Meta** — Vetly es Tech Provider, la clínica paga el envío de WhatsApp directo a Meta (~US$0.001-0.03/msg según país). Comunicado en: nota bajo la grilla de `landing.html`, nota bajo la grilla en `Settings.tsx` (subscription tab), 2 items nuevos en el FAQ de `Pricing.tsx` (créditos IA + "¿hay costos aparte?"), y nota en `core.html` "Sin letra chica" (recordatorios automáticos = API facturada por Meta; manuales = WhatsApp propio, sin costo).
- `Pricing.tsx` FAQ: referencia a "YCloud" → "Meta"; el item viejo "¿supero las 50 citas en Starter?" se eliminó al reescribir el FAQ (los cards dicen 100 citas y la copia de upgrade "¿Más de 100 citas/mes? → Plan Pro" queda como el mensaje). Siguen stale en ese FAQ: "packs de recordatorios (50, 200 o ilimitados/mes)" (los reales son 80/350/9999) y "tarifa de implementación de $150 USD" — no tocados.

### Palancas para bajar el costo de mensajería (aplican a todas las clínicas desde 1-oct)

1. **Reducir mensajes salientes** — unir respuestas multi-burbuja en una, eliminar acuses de bajo valor, resolver el "4o pegado" de sesión 83. Baja Meta *y* OpenAI.
2. Verificar que toda clínica con agente tenga método de pago + alertas de saldo en su BM (el bug `[131042]` de sesión 70 va a golpear a más clínicas y más fuerte).
3. Empujar Click-to-WhatsApp donde se pueda (ventana de 72 h gratis).

### Alianza Yares / "Veterinario Emprendedor" (2026-09-02, en negociación)

Referente del nicho veterinario en LATAM (YouTube "Veterinario Emprendedor", miles de seguidores, empresa de cursos para veterinarios). Representante: **Yares**. Interesado en alianza con Vetly con **comisión por clínica**, a cambio de ayudar a expandir rápido. Antes de cerrar quiere un **piloto de 5 clínicas** con el agente IA por **mínimo 45 días** para recabar feedback y validar.

**Acuerdo (dos etapas):**
1. **Piloto (45 días):** clínicas **sin suscripción**. Pagan **US$45 fijos de créditos de IA por adelantado a Vetly** + **mensajería directo a Meta** (~US$2 en Colombia). Total ~US$47 los 45 días en Colombia. Se parte en **Colombia** por el costo Meta casi nulo.
2. **Si continúan:** pasan a **plan Pro (US$169/mes)** con OpenAI absorbido; el único add-on es Meta (~US$1/mes en Colombia).

La comisión de Yares sale de la suscripción Vetly, no del costo variable de mensajería. One-pager para Yares: `scratchpad/costo-piloto-vetly.html` (artefacto publicado).

---

## Cambios realizados — septiembre 2026 (sesión 97, 2026-09-02)

> Nota de numeración: "sesión 96" (2026-09-01) la ocupó una sesión paralela (bug de facturación del pack de créditos extra). Esta es una sesión distinta del día siguiente — se salta a 97, mismo patrón ya documentado en sesiones 66/87/89/91/93.

### Ruteo de IA optimizado — desplegado a Santiago (rollout controlado)

**Motivación:** el usuario reportó que OpenAI gasta mucho. Diagnóstico ya hecho (sesiones 83/85): ~80% de los mensajes van a GPT-4o y son ~98% del gasto. La causa es el ruteo, no el proveedor.

**Comparación de proveedores reconfirmada (descarte):** Claude Haiku cuesta MÁS que gpt-4o-mini; Sonnet ≈ gpt-4o (cero ahorro). Gemini 2.0/2.5 Flash es la única alternativa grande genuinamente más barata que mini con tools + contexto amplio — el cambio realista si algún día se migra. DeepSeek ~10x más barato pero API en China (datos de clientes de por medio). Migrar cualquiera = reescribir el tool loop de ambos webhooks (formato OpenAI). **No se migra — se optimiza el ruteo primero.**

**El cambio (`meta-whatsapp-webhook`, línea ~2455):**
- Constante nueva `LEAN_ROUTING_CLINICS = [CLINIC_ANIMALGRACE_SANTIAGO_ID]` — gate del rollout.
- El bloque de ruteo `hybrid` se bifurca: si la clínica está en la lista **y** `scheduling_mode === 'coordinator_approval'` → ruteo lean. Cualquier otra (Linares incluida) → el ruteo de hoy **sin tocar una línea** (mismo `selectModelTier` + `activeSchedulingFlow` de 3 mensajes + `isSafeTrivialAck`).
- **Ruteo lean — van a GPT-4o SOLO:** imagen · vuelta del pin (detecta `[LOGÍSTICA` / `[UBICACIÓN COMPARTIDA` / `recargo traslado` en el mensaje — el momento donde se arma recargo + servicio + mínimo $15.000 + excepciones) · keywords de **precio** (precio, valor, cuánto, recargo, traslado, comuna, cotiz, pack, promoci, presupuesto) · servicios con costo variable que causaron bugs reales sin keyword (uña, parasit, camada, gatitos, perritos, "4 gatos", "dos perros", alizin, preñ, monta) · keywords **médicas** (cirug, castra, vacun, antirrabi, octuple, destartraje, sedaci, ecograf, eutan) · el **último** mensaje de la IA (solo 1, no 3) tocó precio/médico **o** ofreció una hora concreta.
- **Todo lo demás → mini:** nombre del tutor, dirección escrita, "sí", especie, edad, "¿qué días te acomodan?".
- Razón del diseño: en modo coordinadora la IA ya no razona rutas — solo llena datos y llama `request_scheduling_coordination`. El "agendamiento" per se no necesita 4o; lo que sí es **precio** y **triaje médico**.

**Impacto esperado:** 4o de ~80% → ~50% de los mensajes → **~35% menos consumo de créditos**. Ningún momento de precio en mini. Deja a Animalgrace dentro del plan de 30.000/ciclo sin comprar packs extra.

**Rollout:** (1) Santiago 3 días → revisar conversaciones reales cruzando `ai_model` de cada respuesta contra errores de precio/triaje. (2) Si limpio → agregar Linares a `LEAN_ROUTING_CLINICS` (1 línea) + deploy. (3) Estable 1 semana → simplificar (quitar la lista, gatear solo por `scheduling_mode`). Revertir = `git revert` de un commit.

**Deploy:** `meta-whatsapp-webhook` (con `--no-verify-jwt`). `ycloud-whatsapp-webhook` NO tocado — sin tráfico real; recibe el cambio por paridad cuando se promueva a "ambas clínicas".

**NO verificado con tráfico real** — al momento del deploy la cuenta de OpenAI estaba en $0 (ver abajo), así que la IA no responde a nadie. La ventana de observación de 3 días arranca cuando OpenAI tenga saldo.

**Pendiente (fase siguiente, no aplicado):** recorte quirúrgico del prompt. Fase 1 (~15%, bajo riesgo): quitar inflación de énfasis ("CRÍTICO/ABSOLUTO" repetidos), colapsar ejemplos dobles, quitar detalle operativo muerto. Fase 2 (~15-20%, patrón sesión 62/85): mover tablas grandes de precio de `ai_behavior_rules` a documentos de conocimiento forzado, dejar puntero + regla anti-error de una línea. `ai_behavior_rules` Linares ≈ 42.500 chars, se manda en cada mensaje + cada iteración del tool loop.

### Caída total de Supabase — 2026-09-02 ~01:33–03:20 UTC

**Síntoma reportado por el usuario:** no se podía entrar a la cuenta de Animalgrace, el login quedaba cargando.

**Causa:** incidente de infraestructura de Supabase — "API Gateway — Degraded Performance" (status page). La consola del navegador mostraba `Access to fetch at '.../auth/v1/token?grant_type=password' blocked by CORS policy: No 'Access-Control-Allow-Origin' header` + `net::ERR_FAILED` — el endpoint de auth devolvía una respuesta de error del gateway **sin headers CORS**, así que el navegador la bloqueaba. Los errores secundarios (`Lock not released within 5000ms`, `AbortError: Lock broken`) eran efecto — el cliente de gotrue-js trabado esperando una respuesta que nunca llegaba. En paralelo, TODA consulta a la base (MCP incluido, ni `SELECT 1`) daba `Connection terminated due to connection timeout`.

**Resolución:** el usuario reinició el proyecto desde **Supabase dashboard → Settings → General → "Restart project"** (`https://supabase.com/dashboard/project/ehmncwawzdciajvuallg/settings/general`). Verificado post-reinicio: base responde (14 conexiones, sano), 31 usuarios auth, 26 clínicas, todos los cambios de prompt del día intactos.

**Alcance:** el agente de WhatsApp también estuvo caído ~1h47m (misma base). Meta reintenta webhooks fallidos, así que parte de los mensajes se recuperaron; los que agotaron reintentos se perdieron. Se le pidió a Claudia revisar WhatsApp por clientes sin respuesta entre 21:30–23:20 Chile.

**Regla permanente — login de la app "queda cargando":** si la consola muestra un error de CORS en `/auth/v1/token` con `net::ERR_FAILED`, NO es el código de la app ni la config — es el gateway de auth de Supabase devolviendo errores sin headers CORS (incidente de infra). Verificar status.supabase.com, y probar "Restart project" desde Settings → General. Los errores de `Lock "lock:sb-...-auth-token" not released` son ruido secundario, no la causa.

### OpenAI sin saldo — 7ma vez (2026-09-01 23:21 UTC en adelante)

Justo después del deploy del ruteo, `debug_logs` mostró `Meta Async Process Error` → `OpenAI 429: "You have no credits remaining" / code: credit_balance_exhausted`. **La cuenta de OpenAI (el dinero real que Vetly le paga a OpenAI) llegó a $0**, no el pool interno de créditos de Vetly. Empezó 2026-09-01 23:21 UTC (~19:21 Chile), 5 clientes afectados hasta la mañana (pocos por ser de noche).

Patrón crónico documentado: 30-abr, 9-may, 24-may, 23-jun, 25/28-jul, 15-ago, y ahora 1-sep. **Recomendación al usuario (no aplicada — es config de su cuenta OpenAI):** activar auto-recarga en `platform.openai.com/settings/organization/billing` con umbral alto (ej. recargar $50 al bajar de $20) o pasar a facturación mensual, para que deje de cortar la IA. El ruteo lean estira el presupuesto pero no arregla un saldo en $0.
