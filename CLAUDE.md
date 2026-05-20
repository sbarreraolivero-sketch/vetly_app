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
1. Verificación HMAC-SHA256 de firma YCloud
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
| `cron-process-reminders` | Envía recordatorios de citas por WhatsApp |
| `cron-process-surveys` | Encuestas post-cita |
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
- Firma HMAC-SHA256 verificada vía `verifyYCloudSignature()` antes de procesar cualquier payload
- Secret configurado via: `supabase secrets set YCLOUD_WEBHOOK_SECRET=<secret>`

### Formato de tools OpenAI
Todo el código usa el formato moderno (`tools`/`tool_choice`/`tool_call_id`), no el deprecado (`functions`/`function_call`). El `ai-simulator` fue migrado en mayo 2026.

---

## Cambios realizados — mayo 2026

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

## Tareas pendientes

### Alta prioridad
- [ ] **`logistics_config.routing_mode`** — mover la lógica de `CLINIC_ANIMALGRACE_ID` y `CLINIC_SANTIAGO_ID` a un campo en `clinic_settings` para que sea configurable sin deploy. Requiere migración de datos y actualizar `checkAvail()` para leer `logisticsConfig.routing_mode` en vez de comparar por ID.
- [ ] **`YCLOUD_WEBHOOK_SECRET` en producción** — verificar que el secret esté seteado en el proyecto de Supabase de producción (`supabase secrets list`).

### Media prioridad
- [ ] **N+1 en `processFunc`** — `check_availability` hace múltiples queries seriales a Supabase (servicios, profesionales, slots, citas del día). Candidato a `Promise.all` donde no haya dependencia.
- [ ] **`getKnowledge` en el simulador** — usa filtrado por `ilike` directo en DB en vez del scoring en memoria del webhook. Considerar unificar el approach.
- [ ] **Sincronizar definición de tools** — `SIMULATOR_TOOLS` en `ai-simulator` y `functions` en el webhook están desincronizados (el simulador no tiene `escalate_to_human`, `reschedule_appointment`, `confirm_appointment`). Evaluar si es intencional o un bug.

### Baja prioridad
- [ ] **`_shared/cors.ts`** — el CORS de `chat-agent` usa este archivo (`*`). Documentar explícitamente por qué es `*` (browser widget, no webhook) para que nadie lo "corrija" innecesariamente.
- [ ] **Cleanup de archivos `check_*.js`** en la raíz — scripts de debugging acumulados, no forman parte del proyecto, pueden eliminarse.
