/**
 * meta-whatsapp-webhook
 *
 * Webhook de Meta Cloud API para clínicas migradas a Meta directo (sin YCloud).
 * Es un port completo de ycloud-whatsapp-webhook adaptado a la capa de transporte Meta.
 *
 * Diferencias clave vs ycloud-whatsapp-webhook:
 * - HMAC global (APP_SECRET), no por-clínica
 * - Lookup de clínica por meta_phone_number_id
 * - Envío vía sendMetaMessage (Meta Graph API), no sendWA (YCloud API)
 * - Descarga de media en 2 pasos (get URL from mediaId → fetch URL with Bearer)
 * - Sin modo simulador
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCreditStatus, notifyCreditsExhausted, creditCostForModel } from "../_shared/aiCredits.ts";

// ── Env ───────────────────────────────────────────────────────────────────────
const VERIFY_TOKEN = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN") ?? "";
const APP_SECRET   = Deno.env.get("META_APP_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// ── Interfaces ────────────────────────────────────────────────────────────────
interface Msg {
  role: "system" | "user" | "assistant" | "function" | "tool";
  content: string | any[] | null;
  name?: string;
  function_call?: { name: string; arguments: string };
  tool_calls?: any[];
  tool_call_id?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const TRAVEL_BUFFER_MINUTES = 15;
const KB_CACHE_TTL_MS = 5 * 60 * 1000;
const HQ_ID = "00000000-0000-0000-0000-000000000000";
// Kept for reference; logic now reads from logistics_config in DB
const CLINIC_ANIMALGRACE_ID = "fd11b7e4-7d96-461c-a292-2caa5e2592ce";
const CLINIC_ANIMALGRACE_SANTIAGO_ID = "13472ea4-4da6-461c-9a80-a5c970d9ec73";

// Ruteo optimizado (sesión 95): en modo coordinadora la IA solo llena datos y llama
// request_scheduling_coordination — el "agendamiento" ya no necesita GPT-4o. Solo PRECIO,
// triaje médico, imágenes y la vuelta del pin (donde se arma recargo + servicio + mínimo
// $15.000 + excepciones) van al modelo caro. Rollout controlado: Santiago primero, después
// se agrega Linares y finalmente se simplifica a un chequeo de scheduling_mode.
const LEAN_ROUTING_CLINICS = [CLINIC_ANIMALGRACE_SANTIAGO_ID];

// Matriz de precios de esterilización/castración de Linares — refleja EXACTO
// el documento KB #MATRIZ_PRECIOS_Y_PROTOCOLO_CIRUGIAS. Vive en código (no
// solo en el prompt) porque cruzar especie+sexo+peso+tramo en una tabla de 14
// celdas es exactamente el tipo de lookup en el que el modelo se ha
// equivocado repetidamente en producción — incluso con la tabla completa en
// su contexto (ver sesiones 9, 40, y el caso real de sesión 100: perra de
// 30 kg cotizada en $85.000, precio real de la tabla equivocada — $115.000
// era el correcto). Igual que con la promesa-sin-acción del agendamiento: un
// tercer intento de arreglarlo solo con el prompt no era razonable — se
// mueve el cálculo a código, y el modelo solo copia el resultado.
const LINARES_SURGERY_PRICES = {
  gato: {
    hembra: { T1: 65000, T2: 73000, T3: 81000 },
    macho: { T1: 60000, T2: 66000, T3: 74000 },
  },
  perro: {
    hembra: [
      { maxKg: 5, T1: 80000, T2: 88000, T3: 96000 },
      { maxKg: 12, T1: 85000, T2: 93000, T3: 101000 },
      { maxKg: 17, T1: 90000, T2: 98000, T3: 106000 },
      { maxKg: 22, T1: 95000, T2: 103000, T3: 111000 },
      { maxKg: 28, T1: 105000, T2: 113000, T3: 121000 },
      { maxKg: 35, T1: 115000, T2: 123000, T3: 131000 },
      { maxKg: 40, T1: 122000, T2: 130000, T3: 138000 },
    ],
    macho: [
      { maxKg: 10, T1: 70000, T2: 78000, T3: 86000 },
      { maxKg: 15, T1: 75000, T2: 83000, T3: 91000 },
      { maxKg: 22, T1: 80000, T2: 88000, T3: 96000 },
      { maxKg: 30, T1: 85000, T2: 93000, T3: 101000 },
      { maxKg: 40, T1: 90000, T2: 98000, T3: 106000 },
      { maxKg: 100, T1: 100000, T2: 108000, T3: 116000 },
    ],
  },
} as const;

const calculateSurgeryPriceLinares = (args: any) => {
  const sp = String(args.species || "").toLowerCase();
  const isCat = /gat/.test(sp);
  const isDog = /perr|can/.test(sp);
  if (!isCat && !isDog) {
    return { success: false, message: "Especie no reconocida — usa 'gato' o 'perro'. Confírmasela al tutor antes de reintentar." };
  }
  const sx = String(args.sex || "").toLowerCase();
  const isFemale = /hembra|femenin/.test(sx);
  const isMale = /macho|masculin/.test(sx);
  if (!isFemale && !isMale) {
    return { success: false, message: "Sexo no reconocido — usa 'hembra' o 'macho'. Confírmaselo al tutor antes de reintentar." };
  }
  const travelMinutes = Number(args.travel_minutes);
  if (!Number.isFinite(travelMinutes) || travelMinutes < 0) {
    return { success: false, message: "Falta travel_minutes — usa el número exacto del bloque [LOGÍSTICA: Pabellón más cercano... a N min] de tu contexto." };
  }
  const tramo = travelMinutes <= 25 ? "T1" : travelMinutes <= 35 ? "T2" : travelMinutes <= 45 ? "T3" : null;
  if (!tramo) {
    return { success: false, message: "Fuera de rango de tramo (más de 45 min al pabellón) — no hay valor automático. Usa escalate_to_human." };
  }

  let base: number;
  if (isCat) {
    base = LINARES_SURGERY_PRICES.gato[isFemale ? "hembra" : "macho"][tramo];
  } else {
    const weightKg = Number(args.weight_kg);
    if (!Number.isFinite(weightKg) || weightKg <= 0) {
      return { success: false, message: "Falta weight_kg — es obligatorio para perros. Pídele el peso al tutor antes de reintentar." };
    }
    const brackets = LINARES_SURGERY_PRICES.perro[isFemale ? "hembra" : "macho"];
    const bracket = brackets.find((b) => weightKg <= b.maxKg);
    if (!bracket) {
      return { success: false, message: `Peso de ${weightKg}kg fuera de la tabla — escala a un humano, no inventes un valor.` };
    }
    base = bracket[tramo];
  }

  const surcharge = args.in_heat_or_pregnant === true ? 20000 : 0;
  return {
    success: true,
    price_total: base + surcharge,
    tramo,
    breakdown: surcharge > 0 ? `Base $${base.toLocaleString("es-CL")} + $20.000 (celo/preñez)` : `Base $${base.toLocaleString("es-CL")}, sin recargos`,
    instruction: "Usa EXCLUSIVAMENTE price_total como el valor a comunicar. No lo recalcules ni lo ajustes.",
  };
};

const surgeryPrompt = `
[NORMATIVA NUCLEAR - BLACKOUT QUIRÚRGICO]:
1. ESTE SERVICIO TIENE LA AGENDA BLOQUEADA PARA TI.
2. TIENES PROHIBIDO decir que vas a "verificar disponibilidad" o "ver cupos".
3. TIENES PROHIBIDO dar horarios, aunque creas verlos.
4. Una vez validada la ubicación y aceptado el precio, debes pedir: Nombre del tutor, Nombre mascota, Dirección exacta y QUÉ DÍA DE LA SEMANA PREFIERE.
5. DEBES informar: (a) Recomendación de exámenes pre-operatorios. (b) Recargo de $20.000 si está en celo o preñez.
6. DEBES explicar que "Claudia (nuestra encargada de logística) te contactará personalmente para coordinar el día y la hora de la cirugía".
7. Cierra la conversación ahí. No intentes usar herramientas de agenda.`;

// Clínicas con scheduling_mode = 'coordinator_approval': la ruta del día la arma
// una persona, no la IA. Un cupo libre en la agenda no significa que sea viable.
const coordinatorPrompt = `
[NORMATIVA NUCLEAR - COORDINACIÓN DE RUTA]:
1. TIENES PROHIBIDO decir que vas a "revisar disponibilidad", ofrecer un día o dar horarios, aunque creas ver cupos libres.
2. La agenda de este tutor está bloqueada hasta que la coordinadora autorice horarios concretos.
3. Si aún te faltan datos, síguelos pidiendo con calidez y de a uno: nombre del tutor, mascota (especie/edad/peso si aplica), motivo o servicio, comuna y dirección si corresponde, si necesita atención urgente, y su DISPONIBILIDAD AMPLIA (varios días y rangos horarios posibles, no uno solo).
4. Para la disponibilidad pregunta algo como: "¿Qué días de esta semana podrías recibirnos y en qué horarios? Si tienes más de una alternativa, indícamelas para revisar cuál coincide mejor con nuestra ruta 😊".
5. Cuando tengas todo, usa request_scheduling_coordination. NUNCA uses create_appointment ni ofrezcas una hora tú misma.
6. Explícale que la coordinadora revisará la ruta del día y le escribirá por este mismo medio con las opciones.`;

// ── HMAC Verification (Meta global secret) ────────────────────────────────────
async function verifyMetaSignature(rawBody: string, signatureHeader: string | null): Promise<boolean> {
  if (!signatureHeader || !APP_SECRET) return false;
  const received = signatureHeader.replace("sha256=", "");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(APP_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  const expected = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
  return expected === received;
}

// ── Meta Media Download (2-step) ──────────────────────────────────────────────
const downloadMetaMedia = async (mediaId: string, accessToken: string): Promise<Blob> => {
  // Step 1: get the URL
  const urlRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const urlData = await urlRes.json();
  if (!urlData.url) throw new Error(`Meta media URL not found for ${mediaId}`);

  // Step 2: fetch the actual bytes
  const mediaRes = await fetch(urlData.url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return mediaRes.blob();
};

// ── Audio Transcription ───────────────────────────────────────────────────────
const transcribeAudioData = async (audioBlob: Blob, openAiKey: string): Promise<string> => {
  const formData = new FormData();
  formData.append("file", audioBlob, "audio.ogg");
  formData.append("model", "whisper-1");
  formData.append("language", "es");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openAiKey}` },
    body: formData,
  });
  const data = await res.json();
  return data.text || "";
};

// ── Meta CAPI ─────────────────────────────────────────────────────────────────
const sendMetaCAPIEvent = async (
  pixelId: string,
  accessToken: string,
  eventName: string,
  phone: string,
  ctwaClid?: string,
  customData?: any,
  testEventCode?: string,
  pageId?: string,
): Promise<{ status: number; body: unknown } | { error: string }> => {
  if (!ctwaClid) return { error: "ctwa_clid required for business_messaging events" };
  try {
    const encoder = new TextEncoder();
    const hashBuf = await crypto.subtle.digest("SHA-256", encoder.encode(phone.replace(/\D/g, "")));
    const hashedPhone = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("");

    const eventPayload: any = {
      data: [{
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        action_source: "business_messaging",
        messaging_channel: "whatsapp",
        user_data: {
          ph: [hashedPhone],
          ctwa_clid: ctwaClid,
          ...(pageId ? { page_id: pageId } : {}),
        },
        ...(customData ? { custom_data: customData } : {}),
      }],
    };
    if (testEventCode) eventPayload.test_event_code = testEventCode;

    const res = await fetch(`https://graph.facebook.com/v21.0/${pixelId}/events`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(eventPayload),
    });
    const body = await res.json();
    return { status: res.status, body };
  } catch (e) {
    return { error: (e as Error).message };
  }
};

// ── Geo Helpers ───────────────────────────────────────────────────────────────
const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY") ?? "";

const resolveGoogleMapsUrl = async (url: string): Promise<{ lat: number; lng: number } | null> => {
  try {
    let resolved = url;
    if (url.includes("goo.gl") || url.includes("maps.app.goo.gl")) {
      const res = await fetch(url, { method: "HEAD", redirect: "follow" });
      resolved = res.url;
    }
    const match = resolved.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (match) return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };
    const qMatch = resolved.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (qMatch) return { lat: parseFloat(qMatch[1]), lng: parseFloat(qMatch[2]) };
    return null;
  } catch { return null; }
};

const geocodeAddress = async (address: string): Promise<{ lat: number; lng: number } | null> => {
  if (!address || !GOOGLE_MAPS_API_KEY) return null;
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_MAPS_API_KEY}&language=es&region=cl`
    );
    const data = await res.json();
    if (data.status === "OK" && data.results?.length > 0) {
      return data.results[0].geometry.location;
    }
    return null;
  } catch { return null; }
};

// Confirmado real en producción (Hachi/Javiera y Pantro/Daniel, Linares,
// 2026-09-01/08-31): la técnica anterior (formatear con toLocaleString y volver
// a parsear el string resultante con `new Date(...)`) produjo offsets erróneos
// y NO uniformes (-08:00 en un caso, +02:00 en otro) para citas cuya IA había
// confirmado correctamente "12:30 PM" al tutor — el texto de confirmación se
// arma directo desde args.time (sin pasar por Date), así que no reflejaba el
// error; solo la hora GUARDADA en la base quedaba mal. Re-parsear un string
// como "9/3/2026, 8:00:00 AM" con `new Date()` es implementation-defined según
// el spec de ECMAScript (solo ISO 8601 está garantizado) — funciona la mayoría
// de las veces pero no es confiable. `formatToParts` con `timeZoneName:
// "shortOffset"` lee el offset directo del motor de Intl, sin ese round-trip.
const getOffset = (timeZone: string, date: Date, sb?: ReturnType<typeof createClient>): string => {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" }).formatToParts(date);
    const tzPart = parts.find((p) => p.type === "timeZoneName")?.value || "";
    const m = tzPart.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/);
    if (m) {
      const h = parseInt(m[1], 10);
      const mins = m[2] ? parseInt(m[2], 10) : 0;
      const sign = h < 0 ? "-" : "+";
      const result = `${sign}${String(Math.abs(h)).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
      // Chequeo de sanidad: para Chile el offset real siempre está entre -03:00 y
      // -05:00 (invierno/verano, con margen). Si algún día el motor de Intl del
      // runtime devuelve algo fuera de ese rango, no confiar en él en silencio
      // como pasó antes — usar el default seguro y dejar rastro para auditar.
      if (timeZone === "America/Santiago" && (h < -5 || h > -3)) {
        if (sb) debugLog(sb, "[TZ OFFSET SANITY] Offset fuera de rango para Chile, usando fallback", { timeZone, date: date.toISOString(), computed: result });
        return "-04:00";
      }
      return result;
    }
  } catch { /* cae al fallback de abajo */ }
  return "-04:00";
};

const getTravelDetails = async (
  origin: { lat: number; lng: number } | string,
  destination: { lat: number; lng: number } | string,
): Promise<{ duration: number; distance: number }> => {
  if (!GOOGLE_MAPS_API_KEY) return { duration: 30, distance: 0 };
  const fmt = (p: any) => typeof p === "string" ? p : `${p.lat},${p.lng}`;
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(fmt(origin))}&destinations=${encodeURIComponent(fmt(destination))}&key=${GOOGLE_MAPS_API_KEY}&language=es&region=cl`
    );
    const data = await res.json();
    const elem = data.rows?.[0]?.elements?.[0];
    if (elem?.status === "OK") {
      return {
        duration: Math.ceil(elem.duration.value / 60), // seconds → minutes
        distance: elem.distance.value,                  // meters
      };
    }
    return { duration: 30, distance: 0 };
  } catch { return { duration: 30, distance: 0 }; }
};

// ── OpenAI Tool Definitions ───────────────────────────────────────────────────
const functions = [
  {
    name: "check_availability",
    description: "Consulta la disponibilidad de citas para una fecha y servicio específicos. Si el cliente tiene cita futura confirmada, no consultes disponibilidad para reagendar sin su solicitud explícita.",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "Fecha en formato YYYY-MM-DD" },
        service_name: { type: "string", description: "Nombre del servicio" },
        professional_name: { type: "string", description: "Nombre del profesional (opcional)" },
        address: { type: "string", description: "Dirección del cliente para calcular traslado" },
      },
      required: ["date"],
    },
  },
  {
    name: "create_appointment",
    description: "Crea una cita con una fecha y hora YA definidas. En clínicas con flujo de coordinadora, úsala SOLO para agendar una de las opciones que la coordinadora ya autorizó (nunca antes, y nunca llames check_availability antes en ese flujo). En clínicas sin ese flujo, confirma el slot con check_availability primero. Nunca inventar placeholders para tutor_name.",
    parameters: {
      type: "object",
      properties: {
        tutor_name: { type: "string", description: "Nombre real del dueño. NUNCA usar placeholders como [NOMBRE] o 'Cliente'. Si no tienes el nombre, NO llames esta función." },
        patient_name: { type: "string", description: "Nombre de la mascota" },
        pet_details: { type: "string", description: "Detalles adicionales de la mascota (especie, raza, edad)" },
        visit_reason: { type: "string", description: "Motivo de la consulta" },
        email: { type: "string", description: "Correo electrónico del tutor (opcional). Pídelo siempre al agendar, pero si el cliente no quiere darlo o no responde, agenda igual sin él — nunca es un requisito." },
        date: { type: "string", description: "Fecha en formato YYYY-MM-DD" },
        time: { type: "string", description: "Hora en formato HH:MM (24h)" },
        service_name: { type: "string", description: "Nombre del servicio" },
        address: { type: "string", description: "Dirección completa del cliente" },
        address_references: { type: "string", description: "Referencias de la dirección" },
        professional_name: { type: "string", description: "Nombre del profesional (opcional)" },
        notes: { type: "string", description: "Notas adicionales" },
      },
      required: ["tutor_name", "patient_name", "date", "time", "service_name", "address", "notes"],
    },
  },
  {
    name: "get_services",
    description: "Obtiene la lista de servicios disponibles con precios y duración.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "confirm_appointment",
    description: "Confirma o cancela la próxima cita pendiente del cliente.",
    parameters: {
      type: "object",
      properties: {
        response: { type: "string", enum: ["yes", "no"], description: "'yes' para confirmar, 'no' para cancelar" },
      },
      required: ["response"],
    },
  },
  {
    name: "get_knowledge",
    description: "Busca en la base de conocimiento de la clínica. Usar para preguntas sobre protocolos, precios especiales, políticas o información no contenida en el sistema prompt.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Consulta de búsqueda" },
      },
      required: ["query"],
    },
  },
  {
    name: "escalate_to_human",
    description: "Deriva la conversación a un agente humano cuando el cliente lo solicita explícitamente o cuando la situación supera las capacidades del AI.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "reschedule_appointment",
    description: "Reagenda la próxima cita del cliente a una nueva fecha/hora.",
    parameters: {
      type: "object",
      properties: {
        new_date: { type: "string", description: "Nueva fecha en formato YYYY-MM-DD" },
        new_time: { type: "string", description: "Nueva hora en formato HH:MM (24h)" },
      },
      required: ["new_date", "new_time"],
    },
  },
  {
    name: "request_scheduling_coordination",
    description: "Envía la solicitud de agenda a la coordinadora para que ella defina los horarios según la ruta del día. Úsala SOLO cuando ya tengas todos los datos del tutor y su disponibilidad amplia (varios días y rangos horarios posibles). En las clínicas que trabajan con este flujo, reemplaza por completo a check_availability y create_appointment: nunca decidas tú el horario. IMPORTANTE: NO la llames de nuevo si este tutor ya tiene opciones autorizadas por la coordinadora vigentes (verás un bloque 'OPCIONES AUTORIZADAS' en tu contexto) — en ese caso, interpreta su respuesta como aceptación de una de esas opciones y usa create_appointment directamente. Solo vuelve a llamar esta función si el tutor rechaza explícitamente TODAS las opciones ofrecidas y da disponibilidad nueva.",
    parameters: {
      type: "object",
      properties: {
        tutor_name: { type: "string", description: "Nombre real del tutor. Nunca un placeholder." },
        pet_name: { type: "string", description: "Nombre de la mascota" },
        pet_details: { type: "string", description: "Especie, edad y peso si aplica al servicio" },
        service_name: { type: "string", description: "Servicio o motivo de la atención" },
        comuna: { type: "string", description: "Comuna del tutor" },
        sector: { type: "string", description: "Sector/zona interna según el protocolo de logística, si se puede inferir de la comuna" },
        address: { type: "string", description: "Dirección exacta (calle, número y referencias) que el tutor entregó por escrito o mediante su pin de ubicación. OBLIGATORIA: nunca un placeholder ni un valor inventado. Si el tutor no la ha dado, NO llames esta función — pídesela primero." },
        is_urgent: { type: "boolean", description: "true si necesita atención urgente; false si puede esperar los próximos días" },
        availability_text: { type: "string", description: "Disponibilidad amplia en las palabras del tutor: varios días y rangos horarios. Ej: 'martes después de las 15:00, miércoles todo el día o viernes en la mañana'" },
        additional_notes: { type: "string", description: "Cualquier antecedente adicional relevante para el servicio solicitado" },
      },
      required: ["tutor_name", "service_name", "comuna", "address", "is_urgent", "availability_text"],
    },
  },
  {
    name: "calculate_surgery_price",
    description: "SOLO Linares. Calcula el precio EXACTO de esterilización/castración — úsala SIEMPRE en vez de leer la tabla de precios tú mismo, ni siquiera para hacer un cálculo mental rápido. Cruzar especie+sexo+peso+tramo a mano ya causó cotizaciones incorrectas reales. Requiere especie y sexo confirmados con el tutor, peso (obligatorio si es perro) y los minutos de traslado del bloque [LOGÍSTICA: Pabellón más cercano... a N min] de tu contexto — nunca inventes esos minutos. Usa EXCLUSIVAMENTE el price_total que te devuelva.",
    parameters: {
      type: "object",
      properties: {
        species: { type: "string", enum: ["perro", "gato"], description: "Especie de la mascota" },
        sex: { type: "string", enum: ["hembra", "macho"], description: "Sexo de la mascota" },
        weight_kg: { type: "number", description: "Peso en kilos. Obligatorio si species='perro'; se ignora para gatos." },
        travel_minutes: { type: "number", description: "Minutos al pabellón quirúrgico más cercano, tomados literalmente del bloque [LOGÍSTICA] de tu contexto." },
        in_heat_or_pregnant: { type: "boolean", description: "true si la hembra está en celo o preñada (agrega $20.000 de recargo)" },
      },
      required: ["species", "sex", "travel_minutes"],
    },
  },
  {
    name: "tag_patient",
    description: "Asigna una etiqueta al tutor/cliente para segmentación futura.",
    parameters: {
      type: "object",
      properties: {
        tag_name: { type: "string", description: "Nombre de la etiqueta" },
        tag_color: { type: "string", description: "Color hex de la etiqueta (opcional)" },
      },
      required: ["tag_name"],
    },
  },
];

// ── Supabase Client ───────────────────────────────────────────────────────────
const getSupabase = () =>
  createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

// ── Debug Logger ──────────────────────────────────────────────────────────────
const debugLog = async (sb: ReturnType<typeof createClient>, msg: string, payload: any) => {
  try {
    await sb.from("debug_logs").insert({ message: msg, payload });
  } catch (e) {
    console.error("Debug log failed:", e);
  }
};

// ── Phone Normalization ───────────────────────────────────────────────────────
const normalizePhone = (phone: string): string => {
  if (!phone) return "";
  return phone.replace(/\D/g, "");
};

const isValidUUID = (uuid: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);

// ── Coordinación de agenda (scheduling_mode = 'coordinator_approval') ─────────
const needsCoordinatorApproval = (clinic: any) =>
  clinic?.scheduling_mode === "coordinator_approval";

// Solicitud ya autorizada por la coordinadora para este tutor, si existe.
// Falla ABIERTO por diseño: si la query falla no dejamos a la clínica sin agendar.
const getAuthorizedRequest = async (
  sb: ReturnType<typeof createClient>,
  clinicId: string,
  phone: string,
): Promise<{ id: string; authorized_options: string | null } | null> => {
  try {
    const { data } = await sb.from("scheduling_requests")
      .select("id, authorized_options")
      .eq("clinic_id", clinicId)
      .eq("tutor_phone", normalizePhone(phone))
      .eq("status", "authorized")
      .order("updated_at", { ascending: false })
      .limit(1).maybeSingle();
    return (data as any) || null;
  } catch (e) {
    console.error("[Meta] getAuthorizedRequest failed:", e);
    return null;
  }
};

// ── ¿La conversación está pausada (tomada por un humano)? ──
// Debe re-consultarse en CADA punto de control, no una sola vez al recibir el mensaje:
// entre que llega el mensaje y se envía la respuesta pasan ~25-70s (debounce de 20s +
// tool loop de OpenAI). Si sólo se chequea al inicio, un clic en "Silenciar IA" hecho
// dentro de esa ventana se ignora y la IA responde igual — el bug de "no se pausa a la primera".
// Falla ABIERTO a propósito: si la query falla no bloqueamos al agente, sólo dejamos rastro.
const isPausedForHuman = async (
  sb: ReturnType<typeof createClient>,
  clinicId: string,
  from: string,
): Promise<boolean> => {
  try {
    const normalized = normalizePhone(from);
    const withPlus = `+${normalized}`;
    const [tutorRes, crmRes] = await Promise.all([
      sb.from("tutors").select("requires_human")
        .eq("clinic_id", clinicId)
        .or(`phone_number.eq.${from},phone_number.eq.${withPlus},phone_number.eq.${normalized}`)
        .eq("requires_human", true).limit(1),
      sb.from("crm_prospects").select("requires_human")
        .eq("clinic_id", clinicId)
        .or(`phone.eq.${from},phone.eq.${withPlus},phone.eq.${normalized}`)
        .eq("requires_human", true).limit(1),
    ]);
    return ((tutorRes.data?.length ?? 0) > 0) || ((crmRes.data?.length ?? 0) > 0);
  } catch (e) {
    console.error("[Meta] isPausedForHuman check failed:", e);
    return false;
  }
};

// ── Save Message (same as ycloud webhook, column ycloud_message_id reused for Meta WAMIDs) ──
const saveMsg = async (
  sb: ReturnType<typeof createClient>,
  clinicId: string,
  phone: string,
  content: string,
  direction: string,
  extra = {} as any,
  aiModel?: string,
): Promise<string> => {
  const extraCopy = { ...extra };
  const simplifiedModel = aiModel === "gpt-4o-mini" || aiModel === "mini" || aiModel?.includes("mini")
    ? "mini"
    : (aiModel === "gpt-4o" || aiModel === "4o" || (aiModel?.includes("gpt-4o") && !aiModel?.includes("mini"))
      ? "4o"
      : (["4o_standard", "4o_pro"].includes(aiModel!) ? aiModel : null));

  if (extraCopy.campaign_id && !isValidUUID(extraCopy.campaign_id)) {
    delete extraCopy.campaign_id;
  }

  try {
    const standardColumns = [
      "clinic_id", "phone_number", "content", "direction", "ai_generated",
      "ai_function_called", "ai_function_result", "ycloud_message_id",
      "message_type", "campaign_id", "ai_model", "customer_id", "status",
      "is_archived", "topic", "extension", "event", "private",
    ];

    const payload: Record<string, any> = {};
    const filteredExtra: Record<string, any> = {};
    for (const key in extraCopy) {
      if (standardColumns.includes(key)) filteredExtra[key] = extraCopy[key];
      else payload[key] = extraCopy[key];
    }

    const insertPayload: any = { clinic_id: clinicId, phone_number: phone, content, direction, payload, ...filteredExtra };
    if (simplifiedModel) insertPayload.ai_model = simplifiedModel;

    const { data, error } = await sb.from("messages").insert(insertPayload).select("id").single();
    if (error) {
      if (error.message.includes("Could not find") && error.message.includes("column")) {
        const { data: retryData, error: retryError } = await sb.from("messages")
          .insert({ clinic_id: clinicId, phone_number: phone, content, direction })
          .select("id").single();
        if (retryError) throw new Error(retryError.message);
        return retryData.id;
      }
      throw new Error(error.message);
    }

    // Credit tracking for outbound AI messages
    if (direction === "outbound" && insertPayload.ai_generated) {
      try {
        const model = insertPayload.ai_model;
        // Medir y cobrar usan la MISMA constante (ver _shared/aiCredits.ts):
        // antes se cobraba ×15 pero se medía ×8, así que el chequeo de cuota
        // creía que se había gastado la mitad de lo real.
        const creditCost = creditCostForModel(model);
        const credits = await getCreditStatus(sb, clinicId);
        const creditPoolId = credits.poolId;

        if (model === "mini") {
          await sb.rpc("increment_clinic_mini_usage", { p_clinic_id: clinicId });
        } else if (["4o", "4o_standard", "4o_pro"].includes(model || "")) {
          await sb.rpc("increment_clinic_4o_usage", { p_clinic_id: clinicId });
        }

        // Saldo tras registrar este mensaje, para el historial de transacciones.
        // `credits` se leyó ANTES de incrementar/descontar, así que calculamos a
        // mano el estado posterior: primero se consume el plan, el excedente
        // sale del pack extra (mismo criterio que increment_clinic_*_usage).
        const newTotalUsed = credits.totalUsed + creditCost;
        const overage = Math.max(0, newTotalUsed - Math.max(credits.totalUsed, credits.limit));
        const planLeft = Math.max(0, credits.limit - newTotalUsed);
        const extraLeft = Math.max(0, credits.extraBalance - overage);
        const balanceAfter = credits.unlimited ? 0 : planLeft + extraLeft;

        await sb.from("ai_credit_transactions").insert({
          clinic_id: creditPoolId,
          type: "consumption",
          amount: -creditCost,
          balance_after: balanceAfter,
          description: `Consumo IA: ${model}${creditPoolId !== clinicId ? " (sucursal)" : ""}`,
          metadata: { model, source_clinic_id: clinicId },
        });
      } catch (countErr) {
        console.warn("[saveMsg] Failed to increment usage counters:", countErr);
      }
    }

    return data.id;
  } catch (e) {
    console.error("[saveMsg] Severe failure:", e);
    throw e;
  }
};

// ── Service Matching ──────────────────────────────────────────────────────────
const getServiceDetails = async (sb: any, clinicId: string, serviceName: string) => {
  if (!serviceName) return { name: "Consulta", duration: 60, price: 0, service_ids: [] };

  const names = serviceName.split(/ y | \+ | y\/o |,/i).map((s: string) => s.trim()).filter((s: string) => s.length > 2);
  let totalDuration = 0, totalPrice = 0;
  const matchedNames: string[] = [], serviceIds: string[] = [];

  const { data: allServices } = await sb.from("clinic_services").select("*").eq("clinic_id", clinicId);
  if (!allServices || allServices.length === 0) return { name: serviceName, duration: 60, price: 0, service_ids: [] };

  for (const name of names) {
    let found = allServices.find((s: any) => s.name.toLowerCase().includes(name.toLowerCase()));
    if (!found) found = allServices.find((s: any) => name.toLowerCase().includes(s.name.toLowerCase()));
    if (!found && name.includes(" ")) {
      const words = name.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
      for (const word of words) {
        found = allServices.find((s: any) => s.name.toLowerCase().includes(word));
        if (found) break;
      }
    }
    if (found) {
      totalDuration += found.duration || 30;
      totalPrice += found.price || 0;
      matchedNames.push(found.name);
      serviceIds.push(found.id);
    } else {
      const nameLower = name.toLowerCase();
      let fallbackDuration = 30;
      if (nameLower.includes("destartraje") || nameLower.includes("dental") || nameLower.includes("limpieza")) fallbackDuration = 120;
      else if (nameLower.includes("cirugía") || nameLower.includes("castr") || nameLower.includes("esterili")) fallbackDuration = 60;
      else if (nameLower.includes("consulta") || nameLower.includes("control") || nameLower.includes("evaluación")) fallbackDuration = 60;
      totalDuration += fallbackDuration;
      matchedNames.push(name);
    }
  }

  if (totalDuration === 0) totalDuration = 60;
  return { name: matchedNames.length > 0 ? matchedNames.join(" + ") : serviceName, duration: totalDuration, price: totalPrice, service_ids: serviceIds, is_multiple: names.length > 1 };
};

const calculateHaversine = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// ── Check Availability ────────────────────────────────────────────────────────
const checkAvail = async (
  sb: ReturnType<typeof createClient>,
  clinicId: string,
  phone: string,
  date: string,
  serviceName?: string,
  timezone = "America/Santiago",
  profName?: string,
  _clinicWorkingHours?: any,
  address?: string,
  logisticsConfig?: any,
) => {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!date || !dateRegex.test(date)) {
    return { available: false, reason: "invalid_date", message: "Fecha inválida. Usa formato YYYY-MM-DD." };
  }

  // Geocode address if provided
  let tutorCoords: { lat: number; lng: number } | null = null;
  if (address) {
    tutorCoords = await geocodeAddress(address);
    if (tutorCoords) {
      const normalizedPhone = normalizePhone(phone);
      await sb.from("tutors").update({ latitude: tutorCoords.lat, longitude: tutorCoords.lng, address })
        .eq("clinic_id", clinicId).eq("phone_number", normalizedPhone);
      await sb.from("crm_prospects").update({ address })
        .eq("clinic_id", clinicId).or(`phone.eq.${normalizedPhone},phone.eq.+${normalizedPhone}`);
    }
  } else {
    // Try stored coords
    const normalizedPhone = normalizePhone(phone);
    const { data: tutorGeo } = await sb.from("tutors").select("latitude, longitude")
      .eq("clinic_id", clinicId).eq("phone_number", normalizedPhone).limit(1).maybeSingle();
    if (tutorGeo?.latitude) tutorCoords = { lat: Number(tutorGeo.latitude), lng: Number(tutorGeo.longitude) };
  }

  // Horizonte del plan de ruta: el día consultado + 21 días, para poder decirle al
  // cliente cuándo SÍ se atiende su sector si el día pedido está restringido.
  const planHorizon = new Date(`${date}T12:00:00Z`);
  planHorizon.setUTCDate(planHorizon.getUTCDate() + 21);
  const planHorizonEnd = planHorizon.toISOString().slice(0, 10);

  // Parallel fetch: clinic_settings + serviceDetails + existingAppts + routePlan
  const [{ data: clinic }, serviceDetails, { data: existingAppts }, { data: routePlanRows, error: errRoutePlan }] = await Promise.all([
    sb.from("clinic_settings").select("*").eq("id", clinicId).single(),
    getServiceDetails(sb, clinicId, serviceName || ""),
    sb.from("appointments").select("id,appointment_date,address,latitude,longitude,status,duration,phone_number")
      .eq("clinic_id", clinicId).neq("status", "cancelled"),
    sb.from("clinic_route_plan")
      .select("date, allowed_sectors, note")
      .eq("clinic_id", clinicId)
      .gte("date", date)
      .lte("date", planHorizonEnd)
      .order("date", { ascending: true }),
  ]);

  // Fallar abierto: si el plan de ruta no carga, se agenda como siempre (sin
  // restricción de sector) en vez de dejar a la clínica sin agendamiento.
  if (errRoutePlan) console.error("[checkAvail] Error cargando clinic_route_plan (se ignora el plan):", errRoutePlan);
  const routePlan = (routePlanRows || []).filter(
    (p: any) => Array.isArray(p.allowed_sectors) && p.allowed_sectors.length > 0,
  );

  const isAnimalGrace = (clinic?.logistics_config as any)?.routing_mode === "mobile_sectors";
  const isMobile = clinic?.business_model !== "physical";
  const duration = serviceDetails.duration;

  // Surgery hard block for mobile/AnimalGrace
  const lowerService = (serviceName || "").toLowerCase();
  const isSurgery = lowerService.includes("cirug") || lowerService.includes("esterili") || lowerService.includes("castra");
  if (isAnimalGrace && isSurgery) {
    return { available: false, reason: "surgery_manual", message: surgeryPrompt };
  }

  // Bloqueo por coordinación de ruta: mientras la coordinadora no autorice
  // horarios para este tutor, la IA no ve ningún cupo.
  // NOTA (2026-08-27): si YA hay una solicitud autorizada, este check ya no debe
  // usarse para validar el horario elegido — createAppt deja de invocar checkAvail
  // por completo en ese caso (bypass explícito ahí), porque este motor de buffers/
  // traslados es el mismo del flujo autónomo y contradecía en producción horarios
  // que la coordinadora ya había decidido. El prompt instruye a la IA a NO llamar
  // check_availability una vez autorizado; si igual lo hiciera, esta función sigue
  // corriendo su cálculo normal más abajo (no se bloqueó por completo a propósito,
  // para no reescribir el motor completo bajo presión de incidente) — el resultado
  // ya no puede impedir la creación de la cita, solo podría producir un mensaje
  // inicial desactualizado si el modelo desobedece la instrucción.
  if (needsCoordinatorApproval(clinic) && !(await getAuthorizedRequest(sb, clinicId, phone))) {
    return { available: false, reason: "coordinator_approval_required", message: coordinatorPrompt };
  }

  // --- ÚLTIMO HORARIO DEL DÍA ---
  // El último slot ofrecido es el tope (18:00 por defecto) aunque el servicio
  // termine pasado el horario de cierre. No aplica a cirugías: ahí se mantiene
  // la regla de que el servicio debe caber completo antes del cierre.
  // Configurable por clínica vía logistics_config.last_slot_time, sin deploy.
  // Se valida el formato: logistics_config es editable desde el dashboard y un
  // valor inválido haría fallar el cast a TIME del RPC, dejando a la clínica sin
  // agendamiento ("problema técnico"). Ante un valor malo se cae al default.
  const rawSlotCap = (clinic?.logistics_config as any)?.last_slot_time;
  const validSlotCap = typeof rawSlotCap === "string" &&
      /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(rawSlotCap.trim())
    ? rawSlotCap.trim()
    : "18:00";
  const lastSlotCap = isSurgery ? null : validSlotCap;

  // Get available slots
  const rpcName = profName ? "get_professional_available_slots" : "get_available_slots";
  const rpcParams: any = { p_clinic_id: clinicId, p_date: date, p_duration: duration };
  if (profName) rpcParams.p_professional_name = profName;
  if (lastSlotCap) rpcParams.p_last_slot_cap = lastSlotCap;

  const { data: slots, error: slotError } = await sb.rpc(rpcName, rpcParams);
  if (slotError) {
    console.error("[checkAvail] RPC error:", slotError);
    return { available: false, reason: "rpc_error", message: "Error consultando disponibilidad." };
  }

  // Filter slots already booked
  let filteredSlots = (slots || []).filter((slot: any) => {
    const slotTime = slot.slot_time?.substring(0, 5);
    const tzOffset = getOffset(timezone, new Date(`${date}T12:00:00`), sb);
    const slotStart = new Date(`${date}T${slotTime}:00${tzOffset}`);
    const slotEnd = new Date(slotStart.getTime() + duration * 60000);

    const hasConflict = (existingAppts || []).some((a: any) => {
      const apptStart = new Date(a.appointment_date);
      const apptEnd = new Date(apptStart.getTime() + (a.duration || 60) * 60000);
      return slotStart < apptEnd && slotEnd > apptStart;
    });
    return !hasConflict;
  });

  // Today buffer: 2 hours from now
  const isToday = date === new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
  if (isToday) {
    const now = new Date();
    const tzOffset = getOffset(timezone, now, sb);
    filteredSlots = filteredSlots.filter((slot: any) => {
      const slotTime = slot.slot_time?.substring(0, 5);
      const slotStart = new Date(`${date}T${slotTime}:00${tzOffset}`);
      return (slotStart.getTime() - now.getTime()) >= 2 * 60 * 60 * 1000;
    });
  }

  // Day context (for AI)
  const activeZones = [...new Set((existingAppts || [])
    .filter((a: any) => {
      const localDateStr = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(a.appointment_date));
      return localDateStr === date;
    })
    .map((a: any) => a.address?.split(",")[1]?.trim() || "zona desconocida")
  )];
  const dayContext = activeZones.length
    ? `Ruta existente el ${date} en zonas: ${activeZones.join(", ")}.`
    : "Sin rutas previas para este día.";

  let recommendedSlot = "";

  // Mobile logistics filter
  if (isMobile && tutorCoords && filteredSlots.length > 0) {
    const allDayAppts = (existingAppts || [])
      .filter((a: any) => {
        if (!a.appointment_date) return false;
        const localDateStr = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(a.appointment_date));
        return localDateStr === date;
      })
      .sort((a: any, b: any) => new Date(a.appointment_date).getTime() - new Date(b.appointment_date).getTime());

    // Sector helper — Linares communes checked BEFORE Talca to prevent region "Maule" false match
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

    if (isAnimalGrace) {
      const linaresCount = allDayAppts.filter((a: any) => getSectorAG(a.address, a.latitude) === "Linares").length;
      const targetSector = getSectorAG(address || null, tutorCoords.lat);

      // --- PLAN DE RUTA DEL DÍA (override esporádico cargado por la clínica) ---
      // Si el equipo definió que ese día solo se recorre un sector, no se ofrece
      // ninguna hora para los demás. Se hace ANTES del chequeo de capacidad porque
      // es una decisión explícita del equipo, no una inferencia del sistema.
      const dayPlan = routePlan.find((p: any) => p.date === date);
      if (dayPlan && targetSector && !dayPlan.allowed_sectors.includes(targetSector)) {
        const fmtDay = (d: string) =>
          new Date(`${d}T12:00:00`).toLocaleDateString("es-CL", {
            weekday: "long", day: "numeric", month: "long",
          });
        const nextDays = routePlan
          .filter((p: any) => p.date > date && p.allowed_sectors.includes(targetSector))
          .slice(0, 3)
          .map((p: any) => `${fmtDay(p.date)} (${p.date})`);

        console.log(`[AnimalGrace] Plan de ruta ${date}: solo ${dayPlan.allowed_sectors.join("/")}. Sector ${targetSector} bloqueado.`);
        return {
          available: false,
          reason: "sector_not_scheduled",
          message: `SISTEMA: El ${fmtDay(date)} (${date}) la ruta del móvil está planificada ÚNICAMENTE para el sector ${dayPlan.allowed_sectors.join(" y ")}. NO se atiende ${targetSector} ese día bajo ninguna circunstancia.${dayPlan.note ? ` Nota interna del equipo: ${dayPlan.note}.` : ""} ${
            nextDays.length > 0
              ? `Los próximos días con ruta a ${targetSector} son: ${nextDays.join(", ")}. Ofrécele esas fechas al cliente y consulta disponibilidad para el día que elija.`
              : `No hay otro día con ruta a ${targetSector} planificada en las próximas semanas. Explícale al cliente que ese día solo se recorre ${dayPlan.allowed_sectors.join(" y ")}, pregúntale qué otra fecha le acomoda y consulta disponibilidad para esa fecha.`
          } Explícaselo de forma natural y amable, como una coordinación de ruta del equipo móvil. NUNCA menciones que existe un "sistema", un "plan" o una "restricción técnica".`,
        };
      }

      if (linaresCount >= 5 && targetSector === "Talca") {
        return { available: false, reason: "daily_capacity_reached", message: `SISTEMA: Para el día ${date}, la agenda de Linares ya tiene ${linaresCount} cupos (límite 5). Por logística, con 5 citas en Linares NO se realizan traslados a Talca para proteger la ruta.` };
      }
    }

    // Enrich appointments with virtual coords if GPS missing
    const finalLogistics = logisticsConfig || {};
    const dayAppts = (allDayAppts || []).map((a: any) => {
      if (a.latitude !== null) return a;
      const norm = (a.address || "").toLowerCase();
      if ((clinic?.logistics_config as any)?.routing_zone === "rm_santiago") {
        return { ...a, latitude: -33.4975, longitude: -70.6558 };
      }
      if (getSectorAG(a.address, a.latitude) === "Talca") {
        return { ...a, latitude: -35.4264, longitude: -71.6554 };
      }
      return { ...a, latitude: -35.8467, longitude: -71.5936 };
    });

    const targetSectorAG = isAnimalGrace ? getSectorAG(address || null, tutorCoords.lat) : null;

    // Talca 11:30 AM minimum (code-level, inviolable)
    if (targetSectorAG === "Talca") {
      filteredSlots = filteredSlots.filter((s: any) => {
        const [h, m] = s.slot_time.split(":").map(Number);
        return h * 60 + m >= 11 * 60 + 30;
      });
    }

    // Clinic base from logistics config
    const urbanBases = finalLogistics.locations?.filter((l: any) => l.type === "operational") || [];
    let clinicBase: any = urbanBases[0] || { lat: -33.4975, lng: -70.6558, name: "Base" };
    if (tutorCoords && urbanBases.length > 1) {
      const closest = urbanBases.map((b: any) => ({ ...b, dist: calculateHaversine(b.lat, b.lng, tutorCoords!.lat, tutorCoords!.lng) }))
        .sort((a: any, b: any) => a.dist - b.dist)[0];
      clinicBase = closest;
    }

    const tzOffset = getOffset(timezone, new Date(`${date}T12:00:00`), sb);
    const travelKey = (a: any, b: any) => {
      const as = typeof a === "string" ? a : `${a.lat},${a.lng}`;
      const bs = typeof b === "string" ? b : `${b.lat},${b.lng}`;
      return `${as}|${bs}`;
    };

    const slotMeta = filteredSlots.map((slot: any) => {
      const slotTimeParts = (slot.slot_time as string).replace(/:/g, "").padStart(6, "0");
      const slotTimeISO = `${slotTimeParts.substring(0, 2)}:${slotTimeParts.substring(2, 4)}:${slotTimeParts.substring(4, 6)}`;
      const slotStart = new Date(`${date}T${slotTimeISO}${tzOffset}`);
      const slotEnd = new Date(slotStart.getTime() + duration * 60000);
      const prevAppt = dayAppts.filter((a: any) => new Date(a.appointment_date) < slotStart).slice(-1)[0];
      const nextAppt = dayAppts.filter((a: any) => new Date(a.appointment_date) >= slotEnd)[0];
      const originLocation = prevAppt ? { lat: Number(prevAppt.latitude), lng: Number(prevAppt.longitude) } : clinicBase;
      const destinationLocation = nextAppt ? { lat: Number(nextAppt.latitude), lng: Number(nextAppt.longitude) } : clinicBase;
      return { slot, slotStart, slotEnd, prevAppt, nextAppt, originLocation, destinationLocation };
    });

    // Parallel travel prefetch
    const travelCache = new Map<string, { duration: number; distance: number }>();
    const seen = new Set<string>();
    const prefetchPairs: Array<[string, any, any]> = [];
    for (const { originLocation, destinationLocation } of slotMeta) {
      const k1 = travelKey(originLocation, tutorCoords);
      if (!seen.has(k1)) { seen.add(k1); prefetchPairs.push([k1, originLocation, tutorCoords]); }
      const k2 = travelKey(tutorCoords, destinationLocation);
      if (!seen.has(k2)) { seen.add(k2); prefetchPairs.push([k2, tutorCoords, destinationLocation]); }
    }
    await Promise.all(prefetchPairs.map(async ([key, origin, destination]) => {
      try { travelCache.set(key, await getTravelDetails(origin, destination)); }
      catch { travelCache.set(key, { duration: 30, distance: 0 }); }
    }));

    const finalValidSlots = [];
    for (const { slot, slotStart, slotEnd, prevAppt, nextAppt, originLocation, destinationLocation } of slotMeta) {
      let isPossible = true;

      // Travel from origin
      if (originLocation) {
        const cached = travelCache.get(travelKey(originLocation, tutorCoords));
        const travelTimeMinutes = cached ? cached.duration : 30;
        let finalRequiredTravelSecs = travelTimeMinutes * 60 + TRAVEL_BUFFER_MINUTES * 60;
        if (isAnimalGrace) {
          const originSector = prevAppt ? getSectorAG(prevAppt.address, prevAppt.latitude) : "Linares";
          if (originSector && targetSectorAG && originSector !== targetSectorAG) {
            finalRequiredTravelSecs = Math.max(finalRequiredTravelSecs, 60 * 60);
          }
        }
        const isTodaySlot = date === new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
        const now = new Date();
        let availableGapSecs = 0;
        if (prevAppt) {
          availableGapSecs = (slotStart.getTime() - (new Date(prevAppt.appointment_date).getTime() + (prevAppt.duration * 60000))) / 1000;
        } else if (isTodaySlot) {
          const clinicStartToday = new Date(`${date}T08:00:00${tzOffset}`);
          const travelStartBase = now > clinicStartToday ? now : clinicStartToday;
          availableGapSecs = (slotStart.getTime() - travelStartBase.getTime()) / 1000;
        } else {
          availableGapSecs = (slotStart.getTime() - new Date(`${date}T08:00:00${tzOffset}`).getTime()) / 1000;
        }
        if (availableGapSecs < finalRequiredTravelSecs) isPossible = false;
      }

      // Travel to destination
      if (isPossible && destinationLocation) {
        const cached = travelCache.get(travelKey(tutorCoords, destinationLocation));
        const travelTimeMinutes = cached ? cached.duration : 30;
        let finalRequiredTravelSecs = travelTimeMinutes * 60 + TRAVEL_BUFFER_MINUTES * 60;
        if (isAnimalGrace) {
          const destSector = nextAppt ? getSectorAG(nextAppt.address, nextAppt.latitude) : "Linares";
          if (targetSectorAG && destSector && targetSectorAG !== destSector) {
            finalRequiredTravelSecs = Math.max(finalRequiredTravelSecs, 60 * 60);
          }
        }
        const availableGapSecs = nextAppt
          ? (new Date(nextAppt.appointment_date).getTime() - slotEnd.getTime()) / 1000
          : (new Date(`${date}T20:00:00${tzOffset}`).getTime() - slotEnd.getTime()) / 1000;
        if (availableGapSecs < finalRequiredTravelSecs) isPossible = false;
      }

      // Anti-rebound: block Talca→Linares→Talca
      if (isPossible && isAnimalGrace && targetSectorAG) {
        const seq: string[] = [];
        let inserted = false;
        for (const a of dayAppts) {
          if (!inserted && new Date(a.appointment_date) >= slotStart) { seq.push(targetSectorAG); inserted = true; }
          if (!a.address || a.address.trim() === "") continue;
          const s = getSectorAG(a.address, a.latitude);
          if (s) seq.push(s);
        }
        if (!inserted) seq.push(targetSectorAG);
        let sawTalca = false, sawLinaresAfterTalca = false;
        for (const s of seq) {
          if (s === "Talca") { if (sawLinaresAfterTalca) { isPossible = false; break; } sawTalca = true; }
          else if (s === "Linares" && sawTalca) sawLinaresAfterTalca = true;
        }
      }

      if (isPossible) {
        finalValidSlots.push(slot);
        if (prevAppt || nextAppt) recommendedSlot = "(Optimizado para su zona)";
      }
    }

    filteredSlots = finalValidSlots;
  }

  await debugLog(sb, "Check Avail Results", { totalSlots: (slots || []).length, availableCount: filteredSlots.length });

  const availableFormatted = filteredSlots.map((s: { slot_time: string }) => {
    const t = s.slot_time.substring(0, 5);
    const h = parseInt(t.split(":")[0]);
    return `${h > 12 ? h - 12 : h}:${t.split(":")[1]} ${h >= 12 ? "PM" : "AM"}`;
  });

  // Bug encontrado 2026-08-20: truncar a 15 cortaba las últimas 2 franjas
  // (17:30/18:00) en cualquier día con apertura 10:00 y cap de cierre 18:00
  // (17 slots de 30 min = índices 0-16; slice(0,15) dejaba fuera los índices
  // 15-16). El agente ofrecía 17:00 como "última hora" contradiciendo el tope
  // real de 18:00. `slots` ahora va sin truncar — `raw_slots` ya duplicaba
  // la lista completa sin truncar, así que no hay motivo real para dos listas.
  const displaySlots = availableFormatted;

  // Travel info summary
  let travelInfo: any = null;
  const urbanBases2 = (logisticsConfig || {}).locations?.filter((l: any) => l.type === "operational") || [];
  const clinicBase2: any = urbanBases2[0] || null;
  if (tutorCoords && clinicBase2) {
    try {
      const td = await getTravelDetails(clinicBase2, tutorCoords);
      travelInfo = { distance_km: (td.distance / 1000).toFixed(1), travel_time_minutes: td.duration };
    } catch { /* non-critical */ }
  }

  return availableFormatted.length
    ? {
      available: true,
      day_context: dayContext,
      slots: displaySlots,
      raw_slots: filteredSlots.map((s: { slot_time: string }) => s.slot_time.substring(0, 5)),
      duration_used: duration,
      total_price: serviceDetails.price,
      service_found: serviceDetails.name,
      travel_details: travelInfo,
    }
    : {
      available: false,
      day_context: dayContext,
      reason: filteredSlots.length === 0 && (slots || []).length > 0 ? "restricted_by_buffer_or_travel" : "fully_booked",
      message: `No hay disponibilidad para ${date} en ese horario específico (considerando traslados y preparación).`,
    };
};

// ── Placeholder guard (nombres/direcciones inventados por el modelo para satisfacer el schema) ──
const GENERIC_NAME_WORDS = ["tutor", "cliente", "dueño", "dueno", "nombre", "sin nombre", "n/a", "na", "no especificado", "desconocido", "pendiente"];
const GENERIC_ADDRESS_WORDS = ["direccion", "dirección", "sin direccion", "sin dirección", "domicilio", "n/a", "na", "no especificado", "desconocido", "pendiente"];
const GENERIC_PET_WORDS = ["mascota", "sin nombre", "n/a", "na", "no especificado", "desconocido", "pendiente"];

const isPlaceholderValue = (raw: string, genericWords: string[] = GENERIC_NAME_WORDS): boolean => {
  const value = (raw || "").trim();
  const norm = value.toLowerCase();
  return (
    !value ||
    value.includes("[") || value.includes("]") ||
    value.includes("{") || value.includes("}") ||
    genericWords.includes(norm) ||
    norm.startsWith("nombre del") || norm.startsWith("nombre de") ||
    norm.startsWith("direccion del") || norm.startsWith("dirección del") ||
    norm.startsWith("direccion exacta") || norm.startsWith("dirección exacta")
  );
};

// ── Create Appointment ────────────────────────────────────────────────────────
const createAppt = async (
  sb: ReturnType<typeof createClient>,
  clinicId: string,
  phone: string,
  args: any,
  timezone = "America/Santiago",
  refId?: string,
  logisticsConfig?: any,
  schedulingMode?: string,
) => {
  const normalizedPhone = normalizePhone(phone);

  // Coordinación de ruta: sin autorización previa de la coordinadora, la IA no
  // puede agendar aunque el horario esté libre.
  let authorizedRequestId: string | null = null;
  if (needsCoordinatorApproval({ scheduling_mode: schedulingMode })) {
    const authorized = await getAuthorizedRequest(sb, clinicId, phone);
    if (!authorized) {
      return { success: false, message: "COORDINACION_REQUERIDA: No puedes agendar directamente para este tutor. Reúne sus datos y su disponibilidad amplia (varios días y rangos horarios) y usa request_scheduling_coordination. La coordinadora autorizará los horarios antes de que puedas agendar." };
    }
    authorizedRequestId = authorized.id;
  }

  // Guard against placeholder names
  if (isPlaceholderValue(args.tutor_name)) {
    return { success: false, message: "FALTA_NOMBRE_TUTOR: No se puede agendar sin el nombre real del tutor. Pregunta al cliente su nombre completo antes de volver a intentar crear la cita." };
  }

  if (!args.patient_name && args.pet_name) args.patient_name = args.pet_name;

  const additionalNotes = [
    args.pet_details ? `Detalles del paciente: ${args.pet_details}` : "",
    args.visit_reason ? `Motivo de visita: ${args.visit_reason}` : "",
  ].filter(Boolean).join(" | ");
  if (additionalNotes) args.notes = args.notes ? `${args.notes}\n${additionalNotes}` : additionalNotes;

  if (args.address) {
    await sb.from("tutors").update({ address: args.address, address_references: args.address_references || null })
      .eq("clinic_id", clinicId).eq("phone_number", normalizedPhone);
    await sb.from("crm_prospects").update({ address: args.address, address_references: args.address_references || null })
      .eq("clinic_id", clinicId).eq("phone", normalizedPhone);
  }

  // Propaga el correo a la ficha del tutor para que quede como dato de contacto.
  const tutorEmail = (args.email || "").trim() || null;
  if (tutorEmail) {
    await sb.from("tutors").update({ email: tutorEmail })
      .eq("clinic_id", clinicId).eq("phone_number", normalizedPhone);
  }

  const serviceDetails = await getServiceDetails(sb, clinicId, args.service_name || "");
  let duration = serviceDetails.duration, price = serviceDetails.price;
  const serviceId = serviceDetails.service_ids[0] || null;
  args.service_name = serviceDetails.name;

  let professionalId: string | null = null;
  const profName = args.professional_name;
  if (profName) {
    const { data: prof } = await sb.from("clinic_members").select("id").eq("clinic_id", clinicId)
      .or(`first_name.ilike.%${profName}%,last_name.ilike.%${profName}%,job_title.ilike.%${profName}%`).limit(1).maybeSingle();
    if (prof) professionalId = prof.id;
  }
  if (!professionalId && serviceId) {
    const { data: profs } = await sb.from("service_professionals").select("member_id, is_primary").eq("service_id", serviceId);
    if (profs && profs.length > 0) {
      const primary = profs.find((p: any) => p.is_primary);
      professionalId = primary ? primary.member_id : profs[0].member_id;
    }
  }

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  let cleanTime = args.time || "";
  const timeMatch = typeof cleanTime === "string" ? cleanTime.match(/\d{1,2}:\d{2}/) : null;
  if (timeMatch) {
    cleanTime = timeMatch[0];
    if (cleanTime.length === 4) cleanTime = "0" + cleanTime;
  }
  const timeRegex = /^\d{2}:\d{2}$/;
  if (!args.date || !args.time || !dateRegex.test(args.date) || !timeRegex.test(cleanTime)) {
    return { success: false, message: "Error: No tengo el horario completo. Por favor pídeme 'Agendar cita el [FECHA] a las [HORA]'." };
  }
  args.time = cleanTime;

  const offset = getOffset(timezone, new Date(`${args.date}T12:00:00`), sb);
  const appointmentDateWithOffset = `${args.date}T${args.time}:00${offset}`;

  // Deduplication check
  const { data: existingAppt } = await sb.from("appointments").select("id, status")
    .eq("clinic_id", clinicId).eq("phone_number", normalizedPhone)
    .eq("appointment_date", appointmentDateWithOffset).neq("status", "cancelled").maybeSingle();
  if (existingAppt) {
    return { success: true, message: existingAppt.status === "confirmed" ? "Ya tienes esta cita confirmada en nuestra agenda. ¡Te esperamos!" : "Ya registré esta solicitud y está pendiente de pago." };
  }

  // Proactive availability check — se OMITE por completo cuando la coordinadora ya
  // autorizó este horario (authorizedRequestId): es exactamente el motor de rutas/
  // buffers de traslado del flujo autónomo, y volver a correrlo aquí contradecía en
  // producción horarios que Claudia ya había decidido explícitamente (confirmado con
  // datos reales el 2026-08-27: este mismo bloque generaba el mensaje "no es factible
  // por el tiempo de traslado" incluso cuando la IA llegaba directo a create_appointment
  // sin pasar por check_availability — el veto vivía aquí, no en el tool call). Bajo
  // coordinación humana, la decisión de la coordinadora reemplaza a este chequeo.
  if (!authorizedRequestId) {
    const availResult = await checkAvail(sb, refId || clinicId, normalizedPhone, args.date, args.service_name, timezone, profName, null, args.address, logisticsConfig);
    const availableRawSlots = availResult.raw_slots || [];
    const isSpecificTimeAvailable = availResult.available && availableRawSlots.includes(args.time);

    if (!isSpecificTimeAvailable) {
      let rejectionMsg = "Lo siento, ese horario ya no está disponible.";
      if (!availResult.available || availableRawSlots.length === 0) {
        rejectionMsg = `Lo siento, consultando con su dirección, no tenemos disponibilidad para ese día considerando los traslados necesarios.`;
      } else {
        const alternatives = (availResult.slots || []).slice(0, 3).join(", ");
        rejectionMsg = `Lo siento, el horario de las ${args.time} no es factible por el tiempo de traslado. Los horarios más cercanos disponibles son: ${alternatives}. ¿Le acomoda alguno?`;
      }
      return { success: false, message: rejectionMsg };
    }

    if (availResult.total_price) price = availResult.total_price;
  }

  // Geocode appointment address
  const { data: tutorGeo } = await sb.from("tutors").select("latitude, longitude, name, address")
    .eq("clinic_id", clinicId).eq("phone_number", normalizedPhone).limit(1).maybeSingle();
  let resolvedLat: number | null = tutorGeo?.latitude || null;
  let resolvedLng: number | null = tutorGeo?.longitude || null;
  const addressToGeocode = args.address || tutorGeo?.address || null;
  if (addressToGeocode) {
    const freshCoords = await geocodeAddress(addressToGeocode);
    if (freshCoords && freshCoords.lat !== 0 && freshCoords.lng !== 0) {
      resolvedLat = freshCoords.lat;
      resolvedLng = freshCoords.lng;
      await sb.from("tutors").update({ latitude: resolvedLat, longitude: resolvedLng })
        .eq("clinic_id", clinicId).eq("phone_number", normalizedPhone);
    }
  }

  const { data, error } = await sb.from("appointments").insert({
    clinic_id: clinicId,
    patient_name: args.patient_name,
    tutor_name: args.tutor_name || tutorGeo?.name || null,
    phone_number: normalizedPhone,
    email: tutorEmail,
    service: args.service_name,
    appointment_date: appointmentDateWithOffset,
    address: args.address || tutorGeo?.address || null,
    address_references: args.address_references || null,
    status: "pending",
    booking_source: "ai_agent",
    duration,
    price,
    professional_id: professionalId,
    latitude: resolvedLat,
    longitude: resolvedLng,
    notes: args.notes || null,
  }).select().single();

  if (error) {
    await debugLog(sb, "DB Create Appt Error", { error, args, clinicId });
    return { success: false, message: "Error DB-AG-01: No pudimos registrar la cita. Por favor confirma el nombre de tu mascota y vuelve a intentarlo." };
  }

  // La solicitud de coordinación quedó resuelta con esta cita.
  if (authorizedRequestId) {
    try {
      await sb.from("scheduling_requests").update({ status: "fulfilled" }).eq("id", authorizedRequestId);
    } catch (e) { console.error("[createAppt] No se pudo cerrar la solicitud de coordinación:", e); }
  }

  try {
    await sb.from("notifications").insert({
      clinic_id: clinicId,
      type: "new_appointment",
      title: "Nueva Cita (AI)",
      message: `Nueva cita para ${args.patient_name} (${args.service_name}) el ${args.date} a las ${args.time}.`,
      link: "/app/appointments",
      is_read: false,
    });
  } catch { /* non-critical */ }

  const d = new Date(`${args.date}T${args.time}:00`);
  const h = parseInt(args.time.split(":")[0]);

  if (!data) return { success: false, message: "Error técnico: Cita no guardada correctamente." };

  return {
    success: true,
    appointment_id: data.id,
    message: `¡Cita agendada!\n\n📅 ${d.toLocaleDateString("es-MX", { weekday: "long", month: "long", day: "numeric" })}\n🕐 ${h > 12 ? h - 12 : h}:${args.time.split(":")[1]} ${h >= 12 ? "PM" : "AM"}\n💆 ${args.service_name}${professionalId ? " (Profesional Asignado)" : ""}`,
  };
};

// ── Get Services ──────────────────────────────────────────────────────────────
const getServices = async (sb: ReturnType<typeof createClient>, clinicId: string) => {
  const { data: svcRows } = await sb.from("clinic_services").select("name, duration, price").eq("clinic_id", clinicId);
  if (svcRows && svcRows.length > 0) {
    return { services: svcRows, message: `Servicios:\n\n${svcRows.map((s: any) => `• ${s.name} (${s.duration}min) - $${s.price}`).join("\n")}` };
  }
  const { data } = await sb.from("clinic_settings").select("services").eq("id", clinicId).single();
  const svcs = data?.services || [];
  if (!svcs.length) return { message: "No hay servicios disponibles." };
  return { services: svcs, message: `Servicios:\n\n${svcs.map((s: any) => `• ${s.name} (${s.duration}min) - $${s.price}`).join("\n")}` };
};

// ── Confirm Appointment ───────────────────────────────────────────────────────
const confirmAppt = async (sb: ReturnType<typeof createClient>, clinicId: string, phone: string, response: string) => {
  const normalizedPhone = normalizePhone(phone);
  const phoneVariants = `phone_number.eq.${normalizedPhone},phone_number.eq.+${normalizedPhone}`;
  const { data: appt } = await sb.from("appointments").select("*")
    .eq("clinic_id", clinicId).or(phoneVariants).eq("status", "pending")
    .gte("appointment_date", new Date().toISOString())
    .order("appointment_date", { ascending: true }).limit(1).maybeSingle();

  if (!appt) {
    if (response === "yes") {
      const { data: confirmedAppt } = await sb.from("appointments").select("id")
        .eq("clinic_id", clinicId).or(phoneVariants).eq("status", "confirmed")
        .gte("appointment_date", new Date().toISOString())
        .order("appointment_date", { ascending: true }).limit(1).maybeSingle();
      if (confirmedAppt) return { message: "Tu cita ya está confirmada 😊 ¡Te esperamos! Recuerda que el móvil trabaja por rangos horarios, por lo que te pedimos estar disponible entre 1 y 2 horas antes y 1 a 2 horas después de la hora asignada." };
    }
    return { message: "No hay citas pendientes." };
  }

  const status = response === "yes" ? "confirmed" : "cancelled";
  await sb.from("appointments").update({ status, confirmation_received: true, confirmation_response: response }).eq("id", appt.id);
  return status === "confirmed"
    ? { message: "¡Cita confirmada! 😊 Recuerda que el móvil trabaja por rangos horarios, por lo que te pedimos estar disponible entre 1 y 2 horas antes y 1 a 2 horas después de la hora asignada, por si el móvil se adelanta o hay algún retraso en la ruta." }
    : { message: "Cita cancelada. ¿Reagendar?" };
};

// ── Knowledge Base Cache ──────────────────────────────────────────────────────
const kbCache = new Map<string, { docs: any[]; fetchedAt: number }>();

const getKnowledgeDocs = async (sb: ReturnType<typeof createClient>, clinicId: string): Promise<any[]> => {
  const cached = kbCache.get(clinicId);
  if (cached && Date.now() - cached.fetchedAt < KB_CACHE_TTL_MS) return cached.docs;
  const { data: docs } = await sb.from("knowledge_base").select("title, content, category")
    .eq("clinic_id", clinicId).eq("status", "active").order("updated_at", { ascending: false }).limit(20);
  const result = docs || [];
  kbCache.set(clinicId, { docs: result, fetchedAt: Date.now() });
  return result;
};

const getKnowledge = async (sb: ReturnType<typeof createClient>, clinicId: string, query: string) => {
  try {
    const genericWords = ["valor", "precio", "costo", "cuanto", "vale", "informacion", "clinica", "servicio", "tratamiento", "precios", "valores", "costos", "procedimiento", "sesion"];
    const allKeywords = query.toLowerCase().replace(/[¿?¡!.,]/g, " ").split(/\s+/).filter(w => w.length > 2);
    const specificKeywords = allKeywords.filter(w => !genericWords.map(g => g.normalize("NFD").replace(/[̀-ͯ]/g, "")).includes(w.normalize("NFD").replace(/[̀-ͯ]/g, "")));
    const searchKeywords = specificKeywords.length > 0 ? specificKeywords : allKeywords;
    const docs = await getKnowledgeDocs(sb, clinicId);
    if (docs.length === 0) return "";
    const scoredDocs = docs.map(d => {
      let score = 0;
      if (searchKeywords.length > 0) {
        searchKeywords.forEach(kw => {
          if (d.title.toLowerCase().includes(kw)) score += 10;
          if (d.category?.toLowerCase().includes(kw)) score += 5;
          if (d.content.toLowerCase().includes(kw)) score += 1;
        });
      } else {
        score = d.category?.toLowerCase().includes("general") || d.category?.toLowerCase().includes("protocol") ? 5 : 1;
      }
      return { ...d, score };
    }).sort((a, b) => b.score - a.score);
    let finalDocs: any[] = [], currentLen = 0;
    const MAX_KB_CHARS = 15000;
    for (const d of scoredDocs) {
      const docText = `📄 ${d.title} (${d.category}):\n${d.content}`;
      if (currentLen + docText.length < MAX_KB_CHARS) { finalDocs.push(d); currentLen += docText.length; }
      else break;
    }
    if (finalDocs.length === 0 && scoredDocs.length > 0) finalDocs = [scoredDocs[0]];
    return finalDocs.map(d => `📄 ${d.title} (${d.category}):\n${d.content}`).join("\n\n---\n\n");
  } catch { return ""; }
};

const getKnowledgeSummary = async (sb: ReturnType<typeof createClient>, clinicId: string) => {
  const docs = await getKnowledgeDocs(sb, clinicId);
  return docs.slice(0, 5).map(d => `- [${d.category}] ${d.title}: ${d.content.substring(0, 500)}...`).join("\n");
};

// --- CONOCIMIENTO FORZADO (sesión 62) — mismo mecanismo que ycloud-whatsapp-webhook.
// El resumen de arriba solo trae los 5 docs KB más recientes truncados a 500 chars;
// verificado que documentos con tabla de precios sin respaldo en clinic_services
// (cirugía, sedación) quedan fuera de ese top 5, y la tool get_knowledge casi nunca se
// llama en la práctica. Estos 3 se fuerzan completos cuando el mensaje toca el tema.
const FORCED_KB_TOPICS: { title: string; keywords: string[] }[] = [
  { title: "MATRIZ_PRECIOS_Y_PROTOCOLO_CIRUGIAS", keywords: ["cirug", "ester", "castra", "pabell"] },
  { title: "Protocolo_de_Sedación_a_Domicilio", keywords: ["sedaci", "agresiv", "anestesi", "inquiet", "dificil de manejar", "difícil de manejar", "no se deja"] },
  { title: "POLITICAS_GENERALES_Y_CONDICIONES_SERVICIO", keywords: ["reembols", "devuelv", "cancela", "no habra nadie", "no habrá nadie", "si no estoy", "si nadie atiende", "visita fallida", "no asisti", "no asistí"] },
  { title: "PROTOCOLO_SERVICIOS_Y_VACUNACION_ANIMALGRACE", keywords: ["eutan", "sacrific", "dormir a mi", "dormirlo", "dormirla", "dormir al", "dormir a la", "que no sufra", "no siga sufriendo", "no sufra mas", "no sufra más", "descanse en paz", "quitarle el sufrimiento", "dejarla ir", "dejarlo ir", "ponerle fin"] },
  { title: "PROTOCOLO_ECOGRAFIA_Y_RADIOGRAFIA_ANIMALGRACE", keywords: ["ecograf", "radiograf", "rayos x", "eco abdominal", "eco de abdomen", "imagenolog"] },
  // Sesión 95: la IA cotizó Alizin en $40.000 para una perra de 4-5 kg (el tarifario real
  // parte en $75.000 hasta 5 kg). Puro invento — el doc no está en el top-5 del resumen y
  // get_knowledge casi nunca se llama. Se fuerza completo cuando el mensaje toca "monta no
  // deseada" / interrupción de gestación.
  { title: "PROTOCOLO_ALIZIN_INTERRUPCION_GESTACION", keywords: [
    "alizin", "alicin", "monta", "montó", "monto un perro", "la montó", "lo montó",
    "preñ", "preña", "prenada", "gestaci", "gestacion", "interrupci", "aborto", "abortar",
    "no quede embaraz", "no quiero que quede", "que no quede", "no quiero cachorros",
    "pastilla del dia despues", "pastilla del día después", "pastilla post",
    "tomó un perro", "tomo un perro", "la tomó", "la agarró un perro", "se cruzó", "se cruzo",
    "cruza no deseada", "método post", "metodo post", "no deseada",
  ] },
  // Sesión 85: sacado de ai_behavior_rules (se reenviaba en TODOS los mensajes pese a ser
  // de uso puntual) para bajar el tamaño del prompt sin perder la reinstrucción — solo se
  // inyecta completo cuando el tema realmente aparece en la conversación.
  { title: "PROTOCOLO_EXAMEN_FELV_FIV_LEUCEMIA_FELINA", keywords: ["felv", "fiv", "leucemia felina", "sida felino", "sida felina"] },
  // Sesión 94: la IA cotizó "$20.000 por 4 gatos" — inventó que una consulta cubre a
  // todas las mascotas del hogar (sobre-generalizó la regla del traslado "una vez por
  // visita"). Ni el prompt ni el KB tenían la tabla de consulta multi-mascota. Se fuerza
  // completo cuando el mensaje menciona varias mascotas / camada, para que la tabla real
  // (camada ≤3 meses = precio total; varios en el hogar desde 4 meses = precio por
  // mascota) siempre esté disponible sin depender de get_knowledge.
  { title: "PROTOCOLO_CONSULTA_MULTIPLES_MASCOTAS", keywords: [
    "camada", "camadita", "camaditas",
    "gatitos", "perritos", "cachorros", "cachorritos", "gaticos", "michis",
    "varios gatos", "varios perros", "varias mascotas", "varios michis", "varios cachorros",
    "mis gatos", "mis perros", "mis michis", "mis mascotas", "mis cachorros", "mis 2", "mis 3", "mis 4",
    "2 gatos", "3 gatos", "4 gatos", "5 gatos", "6 gatos",
    "2 perros", "3 perros", "4 perros", "5 perros", "6 perros",
    "2 gatitos", "3 gatitos", "4 gatitos", "2 perritos", "3 perritos", "4 perritos",
    "dos gatos", "tres gatos", "cuatro gatos", "cinco gatos",
    "dos perros", "tres perros", "cuatro perros", "cinco perros",
  ] },
  // Sesión 71: el resumen top-5/500-chars corta este doc justo antes de la tabla real
  // de comunas Tramo A/B/C/D — la IA solo veía la intro y alucinaba recargos (ej: San
  // Bernardo, que es Tramo A/$0, cotizado como $6.000). Se fuerza completo cuando el
  // cliente menciona cualquier comuna de cobertura, para que la tabla real (y la regla
  // anti-error de $6.000 exclusivo a Las Condes) siempre esté disponible sin depender
  // de que la IA decida llamar get_knowledge.
  { title: "#PROTOCOLO_LOGISTICA_SANTIAGO_SERVICIOS_GENERALES", keywords: [
    "recargo", "traslado",
    "santiago centro", "ñuñoa", "nunoa", "conchali", "conchalí", "recoleta", "cerro navia",
    "pudahuel", "quinta normal", "maipu", "maipú", "san bernardo", "cerrillos",
    "san joaquin", "san joaquín", "peñalolen", "penalolen", "peñalolén", "puente alto",
    "san ramon", "san ramón", "la granja", "providencia", "independencia", "huechuraba",
    "renca", "quilicura", "lo prado", "estacion central", "estación central", "lo espejo",
    "el bosque", "san miguel", "la reina", "la florida", "macul", "la pintana",
    "pedro aguirre cerda", "la cisterna", "las condes", "vitacura", "ciudad satelite",
    "ciudad satélite", "ciudad de los valles", "pirque", "buin", "padre hurtado", "valle grande",
  ] },
];

const getForcedKnowledgeBlock = async (
  sb: ReturnType<typeof createClient>,
  clinicId: string,
  userText: string,
): Promise<string> => {
  const text = (userText || "").toLowerCase();
  const matched = FORCED_KB_TOPICS.filter((t) => t.keywords.some((kw) => text.includes(kw)));
  if (matched.length === 0) return "";
  try {
    const docs = await getKnowledgeDocs(sb, clinicId);
    const blocks = matched
      .map((t) => docs.find((d: any) => d.title === t.title))
      .filter((d): d is any => !!d)
      .map((d: any) => `📄 ${d.title} (contenido completo — consulta obligatoria para este tema):\n${d.content}`);
    if (blocks.length === 0) return "";
    return `\n\n⚠️ INFORMACIÓN FORZADA — EL MENSAJE DEL CLIENTE TOCA UN TEMA CRÍTICO DE PRECIO/POLÍTICA ⚠️\nUsa ESTA información como fuente, no la inventes ni la deduzcas de otro servicio:\n${blocks.join("\n\n")}`;
  } catch { return ""; }
};

// ── Escalate to Human ─────────────────────────────────────────────────────────
const escalateToHuman = async (sb: ReturnType<typeof createClient>, clinicId: string, phone: string) => {
  const normalizedPhone = normalizePhone(phone);
  await sb.from("tutors").update({ requires_human: true })
    .eq("clinic_id", clinicId).eq("phone_number", normalizedPhone);
  await sb.from("crm_prospects").update({ requires_human: true })
    .eq("clinic_id", clinicId).or(`phone.eq.${phone},phone.eq.+${normalizedPhone}`);
  try {
    await sb.from("notifications").insert({
      clinic_id: clinicId, type: "human_handoff",
      title: "Derivación a Humano", message: `El cliente ${phone} solicitó hablar con una persona.`,
      link: "/app/messages", is_read: false,
    });
  } catch { /* non-critical */ }
  return { success: true, message: "El chat ha sido derivado a un agente humano. Nuestro equipo se pondrá en contacto contigo a la brevedad." };
};

// ── Solicitud de coordinación de agenda ───────────────────────────────────────
// La IA reunió los datos y la disponibilidad amplia del tutor; ahora una persona
// decide qué horarios ofrecer según la ruta del día. La conversación queda pausada
// hasta que se autoricen opciones desde el dashboard.
const requestSchedulingCoordination = async (
  sb: ReturnType<typeof createClient>,
  clinicId: string,
  phone: string,
  args: any,
  clinic?: any,
) => {
  const normalizedPhone = normalizePhone(phone);
  const tutorName = (args.tutor_name || "").trim();
  const availability = (args.availability_text || "").trim();
  const address = (args.address || "").trim();

  // Guard anti-placeholder: el modelo puede inventar "[Nombre del Tutor]" o
  // "[Dirección exacta]" para satisfacer el schema cuando el tutor aún no dio
  // el dato real. Sin esto, la coordinadora recibe solicitudes inservibles
  // (verificado en producción: 4 de 6 solicitudes reales llegaron sin dirección
  // utilizable). No escribe nada en scheduling_requests hasta tener datos reales.
  if (!availability) {
    return { success: false, message: "FALTAN_DATOS: Necesitas la disponibilidad amplia del tutor (varios días y rangos horarios) antes de enviar la solicitud a la coordinadora." };
  }
  if (isPlaceholderValue(tutorName)) {
    return { success: false, message: "FALTA_NOMBRE_TUTOR: No se puede enviar la solicitud sin el nombre real del tutor. Pregúntaselo explícitamente y no llames a esta función hasta tenerlo." };
  }
  if (isPlaceholderValue(address, GENERIC_ADDRESS_WORDS)) {
    return { success: false, message: "FALTA_DIRECCION: No se puede enviar la solicitud sin la dirección real del domicilio (calle, número y referencias). Es indispensable para que la coordinadora pueda armar la ruta. Pídesela explícitamente al tutor — insiste si no la da a la primera — y no llames a esta función hasta tenerla." };
  }
  if (args.pet_name !== undefined && isPlaceholderValue(args.pet_name, GENERIC_PET_WORDS)) {
    return { success: false, message: "FALTA_NOMBRE_MASCOTA: No se puede enviar la solicitud sin el nombre real de la mascota. Pregúntaselo al tutor antes de volver a intentar." };
  }

  // Guard: si el tutor solo ofreció "hoy" y/o "mañana" (sin dar ningún otro día
  // concreto) y ESE/ESOS día(s) la clínica no atiende, la solicitud no debe
  // llegar a la coordinadora tal cual — eso le hace creer que hay una opción
  // real cuando no la hay. Caso real confirmado (Aaron Llanos/Noah, Santiago,
  // sábado 2026-09-05): el tutor ofreció "hoy o mañana" (sábado y domingo,
  // ambos cerrados) y la solicitud se envió igual, sin que nadie lo notara
  // hasta que Claudia la vio en su WhatsApp. No bloquea si el tutor YA
  // mencionó otro día de la semana o una fecha explícita como alternativa.
  const availLower = availability.toLowerCase();
  const mentionsExplicitDay = /\b(lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bado|domingo)\b/.test(availLower)
    || /\d{1,2}[\/\-]\d{1,2}/.test(availLower);
  if (!mentionsExplicitDay) {
    const clinicTz = clinic?.timezone || "America/Santiago";
    const dayKeyEn = (offsetDays: number) =>
      new Date(Date.now() + offsetDays * 86400000).toLocaleDateString("en-US", { timeZone: clinicTz, weekday: "long" }).toLowerCase();
    const isDayClosed = (key: string) => {
      const h = (clinic?.working_hours || {})[key];
      return !h || h.closed === true || h.enabled === false;
    };
    const mentioned: { closed: boolean }[] = [];
    if (/\bhoy\b/.test(availLower)) mentioned.push({ closed: isDayClosed(dayKeyEn(0)) });
    if (/\bmañana\b/.test(availLower)) mentioned.push({ closed: isDayClosed(dayKeyEn(1)) });
    if (mentioned.length > 0 && mentioned.every((d) => d.closed)) {
      return { success: false, message: "FALTA_DISPONIBILIDAD_VALIDA: El tutor solo ofreció \"hoy\" y/o \"mañana\", pero la clínica no atiende ese/esos día(s) (está cerrada). Dile con claridad que ese día no hay atención y pídele una alternativa de día hábil real — luego vuelve a llamar a esta función con la nueva disponibilidad. Si el caso es realmente urgente y no puede esperar ningún día hábil, usa escalate_to_human en su lugar." };
    }
  }

  const { data: tutor } = await sb.from("tutors").select("id")
    .eq("clinic_id", clinicId).eq("phone_number", normalizedPhone).limit(1).maybeSingle();

  const payload = {
    clinic_id: clinicId,
    tutor_id: (tutor as any)?.id || null,
    tutor_phone: normalizedPhone,
    tutor_name: tutorName,
    pet_name: args.pet_name || null,
    pet_details: args.pet_details || null,
    service_requested: (args.service_name || "").trim() || "Sin especificar",
    comuna: args.comuna || null,
    sector: args.sector || null,
    address: args.address || null,
    is_urgent: args.is_urgent === true,
    availability_text: availability,
    additional_notes: args.additional_notes || null,
    status: "pending",
  };

  // Una solicitud abierta por tutor: si ya existe (ninguna opción le sirvió),
  // se reabre la misma fila en vez de duplicarla.
  const { data: existing } = await sb.from("scheduling_requests")
    .select("id, round")
    .eq("clinic_id", clinicId).eq("tutor_phone", normalizedPhone)
    .in("status", ["pending", "authorized"])
    .limit(1).maybeSingle();

  if (existing) {
    const { error } = await sb.from("scheduling_requests").update({
      ...payload,
      round: ((existing as any).round || 1) + 1,
      authorized_options: null,
      reviewed_by: null,
      reviewed_at: null,
    }).eq("id", (existing as any).id);
    if (error) {
      await debugLog(sb, "Scheduling Request Update Error", { error, clinicId, phone: normalizedPhone });
      return { success: false, message: "Error técnico al registrar la solicitud. Intenta nuevamente." };
    }
  } else {
    const { error } = await sb.from("scheduling_requests").insert(payload);
    if (error) {
      await debugLog(sb, "Scheduling Request Insert Error", { error, clinicId, phone: normalizedPhone });
      return { success: false, message: "Error técnico al registrar la solicitud. Intenta nuevamente." };
    }
  }

  // Pausa la IA hasta que la coordinadora autorice horarios.
  await sb.from("tutors").update({ requires_human: true })
    .eq("clinic_id", clinicId).eq("phone_number", normalizedPhone);
  await sb.from("crm_prospects").update({ requires_human: true })
    .eq("clinic_id", clinicId).or(`phone.eq.${phone},phone.eq.+${normalizedPhone}`);

  const resumen = [
    `Tutor: ${tutorName}`,
    args.pet_name ? `Mascota: ${args.pet_name}${args.pet_details ? ` (${args.pet_details})` : ""}` : null,
    `Servicio: ${payload.service_requested}`,
    args.comuna ? `Comuna/sector: ${args.comuna}${args.sector ? ` — ${args.sector}` : ""}` : null,
    `Dirección: ${address}`,
    `Urgencia: ${payload.is_urgent ? "SÍ ⚠️" : "No, puede esperar"}`,
    `Disponibilidad: ${availability}`,
    args.additional_notes ? `Antecedentes: ${args.additional_notes}` : null,
  ].filter(Boolean).join("\n");

  try {
    await sb.from("notifications").insert({
      clinic_id: clinicId,
      type: "scheduling_review",
      title: `Solicitud de agenda: ${tutorName}`,
      message: `${payload.service_requested}${args.comuna ? ` — ${args.comuna}` : ""}. Disponibilidad: ${availability}`,
      link: "/app/appointments",
      is_read: false,
    });
  } catch { /* non-critical */ }

  // Aviso directo por WhatsApp a quien coordina la ruta (trabaja en terreno,
  // puede pasar horas sin abrir el dashboard).
  const coordinatorPhone = clinic?.coordinator_phone;
  if (coordinatorPhone && clinic?.meta_phone_number_id && clinic?.meta_access_token) {
    try {
      // sendMetaMessage NUNCA lanza por un status no-2xx de Meta (solo por fallo de
      // red) — un catch solo no detecta un rechazo real de la API. Se registra el
      // resultado siempre, igual que scheduling-notify-authorized, porque este envío
      // no tenía NINGÚN rastro en producción hasta ahora (confirmado real 2026-08-31:
      // la solicitud de Leonardo/Benji se guardó bien en scheduling_requests y en
      // notifications, pero no hay evidencia de que el WhatsApp a la coordinadora
      // haya llegado ni de que haya fallado — no quedaba registrado ninguno de los
      // dos casos).
      // Con plantilla aprobada (clinic.coordinator_alert_template): funciona
      // sin importar la ventana de 24h de WhatsApp — es la vía recomendada.
      // Sin plantilla: texto libre, como antes (solo llega si hay una
      // conversación abierta reciente con ese número).
      const coordResult = clinic.coordinator_alert_template
        ? await sendMetaCoordinatorTemplate(
            clinic.meta_phone_number_id, clinic.meta_access_token, clinic.meta_waba_id,
            normalizePhone(coordinatorPhone), clinic.coordinator_alert_template,
            { tutor: tutorName, mascota: args.pet_name || "", servicio: payload.service_requested, direccion: address, disponibilidad: availability },
          )
        : await sendMetaMessage(
            clinic.meta_phone_number_id,
            clinic.meta_access_token,
            normalizePhone(coordinatorPhone),
            `🐾 Nueva solicitud de agenda — revisar ruta\n\n${resumen}\n\nTeléfono: +${normalizedPhone}\n\nAutoriza los horarios en Citas Médicas.`,
          );
      await debugLog(sb, "[COORDINATOR ALERT] Aviso de solicitud nueva", { to: coordinatorPhone, viaTemplate: !!clinic.coordinator_alert_template, result: coordResult });

      // Persistir con el WAMID para que el handler de whatsapp.message.updated
      // (más abajo en este archivo) pueda correlacionar delivered/failed — Meta
      // acepta el envío (200 + message.id) pero puede rechazarlo asíncronamente
      // después (ej. ventana de 24h vencida). Sin esto, ese rechazo queda
      // invisible para siempre — mismo bug de "ENVIADO que nunca llegaba" ya
      // resuelto para recordatorios (ver reminder_logs.ycloud_message_id).
      // Insert DIRECTO (no vía saveMsg): saveMsg cobra créditos IA cuando
      // ai_generated=true, y este texto fijo no es una respuesta de OpenAI.
      const coordWamid = (coordResult as any)?.messages?.[0]?.id;
      if (coordWamid) {
        await sb.from("messages").insert({
          clinic_id: clinicId,
          phone_number: normalizePhone(coordinatorPhone),
          content: `[Aviso a coordinadora] ${resumen}`,
          direction: "outbound",
          ai_generated: true,
          message_type: "text",
          status: "sent",
          ycloud_message_id: coordWamid,
        });
      }
    } catch (e) {
      console.error("[requestSchedulingCoordination] WhatsApp a coordinadora falló:", e);
      await debugLog(sb, "[COORDINATOR ALERT] Excepción al enviar aviso", { to: coordinatorPhone, error: String(e) });
    }
  }

  return {
    success: true,
    message: "Solicitud enviada a la coordinadora. Informa al cliente que revisará la ruta y le escribirá por este mismo medio con las opciones. NO ofrezcas ningún horario ni sigas usando herramientas de agenda.",
  };
};

// ── Tag Patient ───────────────────────────────────────────────────────────────
const tagPatient = async (sb: ReturnType<typeof createClient>, clinicId: string, phone: string, args: { tag_name: string; tag_color?: string }) => {
  const normalizedPhone = normalizePhone(phone);
  const tagName = (args.tag_name || "").trim();
  if (!tagName) return { success: false, message: "Nombre de etiqueta vacío." };

  // Find or create tag
  // Columnas reales de "tags": id, name, color (no tag_id/tag_name/tag_color) — el select+insert
  // originales fallaban siempre contra columnas inexistentes. Ver ycloud-whatsapp-webhook.
  let tagId: string;
  const { data: existingTag } = await sb.from("tags").select("id").eq("clinic_id", clinicId)
    .ilike("name", tagName).limit(1).maybeSingle();
  if (existingTag) {
    tagId = existingTag.id;
  } else {
    const { data: newTag } = await sb.from("tags").insert({ clinic_id: clinicId, name: tagName, color: args.tag_color || "#6b7280" }).select("id").single();
    if (!newTag) return { success: false, message: "Error creando etiqueta." };
    tagId = newTag.id;
  }

  // Find tutor
  const { data: tutor } = await sb.from("tutors").select("id").eq("clinic_id", clinicId).eq("phone_number", normalizedPhone).limit(1).maybeSingle();
  if (!tutor) return { success: false, message: "Tutor no encontrado." };

  // Insert in tutor_tags (source of truth for frontend)
  const { error } = await sb.from("tutor_tags").insert({ tutor_id: tutor.id, tag_id: tagId });
  if (error && error.code !== "23505") return { success: false, message: "Error asignando etiqueta." };
  return { success: true, message: `Etiqueta "${tagName}" asignada.` };
};

// ── Reschedule Appointment ────────────────────────────────────────────────────
const rescheduleAppt = async (sb: ReturnType<typeof createClient>, clinicId: string, phone: string, args: { new_date: string; new_time: string }, timezone: string, schedulingMode?: string) => {
  const normalizedPhone = normalizePhone(phone);

  // Elegir una fecha/hora nueva es la misma decisión que agendar: también requiere
  // que la coordinadora haya autorizado horarios.
  let authorizedRequestId: string | null = null;
  if (needsCoordinatorApproval({ scheduling_mode: schedulingMode })) {
    const authorized = await getAuthorizedRequest(sb, clinicId, phone);
    if (!authorized) {
      return { success: false, message: "COORDINACION_REQUERIDA: No puedes reagendar directamente. Pregúntale al tutor su nueva disponibilidad amplia (varios días y rangos horarios) y usa request_scheduling_coordination. La coordinadora autorizará el nuevo horario." };
    }
    authorizedRequestId = authorized.id;
  }

  const { data: appt } = await sb.from("appointments").select("*")
    .eq("clinic_id", clinicId).eq("phone_number", normalizedPhone)
    .in("status", ["pending", "confirmed"]).gte("appointment_date", new Date().toISOString())
    .order("appointment_date", { ascending: true }).limit(1).maybeSingle();
  if (!appt) return { success: false, message: "No hay citas próximas para reagendar." };

  const offset = getOffset(timezone, new Date(`${args.new_date}T12:00:00`), sb);
  const newDate = `${args.new_date}T${args.new_time}:00${offset}`;
  await sb.from("appointments").update({ appointment_date: newDate, status: "pending", reminder_sent: false }).eq("id", appt.id);

  if (authorizedRequestId) {
    try {
      await sb.from("scheduling_requests").update({ status: "fulfilled" }).eq("id", authorizedRequestId);
    } catch (e) { console.error("[rescheduleAppt] No se pudo cerrar la solicitud de coordinación:", e); }
  }

  return { success: true, message: `Cita reagendada para el ${args.new_date} a las ${args.new_time}.` };
};

// ── Process Tool Call ─────────────────────────────────────────────────────────
const processFunc = async (
  sb: ReturnType<typeof createClient>,
  clinicId: string,
  phone: string,
  name: string,
  args: any,
  timezone: string,
  clinic?: any,
  _history: Msg[] = [],
) => {
  const logisticsConfig = clinic?.logistics_config || null;
  const schedulingMode = clinic?.scheduling_mode;
  switch (name) {
    case "check_availability":
      return checkAvail(sb, clinicId, phone, args.date, args.service_name, timezone, args.professional_name, null, args.address, logisticsConfig);
    case "create_appointment":
      return createAppt(sb, clinicId, phone, args, timezone, clinicId, logisticsConfig, schedulingMode);
    case "get_services":
      return getServices(sb, clinicId);
    case "confirm_appointment":
    case "cancel_appointment":
      return confirmAppt(sb, clinicId, phone, args.response || "yes");
    case "get_knowledge":
      return getKnowledge(sb, clinicId, args.query || "");
    case "escalate_to_human":
      return escalateToHuman(sb, clinicId, phone);
    case "reschedule_appointment":
      return rescheduleAppt(sb, clinicId, phone, args, timezone, schedulingMode);
    case "request_scheduling_coordination":
      return requestSchedulingCoordination(sb, clinicId, phone, args, clinic);
    case "calculate_surgery_price":
      if (clinicId !== CLINIC_ANIMALGRACE_ID) return { error: "Esta herramienta solo está disponible para Linares." };
      return calculateSurgeryPriceLinares(args);
    case "tag_patient":
      return tagPatient(sb, clinicId, phone, args);
    default:
      return { error: `Tool "${name}" not implemented.` };
  }
};

// ── Model Routing ─────────────────────────────────────────────────────────────
const selectModelTier = (content: string, hasImage = false, activeSchedulingFlow = false) => {
  const text = content.toLowerCase();
  const needsSchedulingReason =
    text.includes("disponib") || text.includes("agend") || text.includes("cita") ||
    text.includes("horario") || text.includes("reserv") || text.includes("sector") ||
    text.includes("direcci") || text.includes("ubicaci") || text.includes("traslado") ||
    text.includes("zona") || text.includes("precio") || text.includes("valor") ||
    text.includes("cuánto") || text.includes("cuanto") || text.includes("cuesta") ||
    text.includes("costo") || text.includes("recargo") || text.includes("tarifa") ||
    text.includes("cotiz") || text.includes("comuna") || text.includes("cobertura");
  const needsMedicalReason =
    hasImage || text.includes("cirug") || text.includes("esterili") || text.includes("castra") ||
    text.includes("vacun") || text.includes("antirrabi") || text.includes("octuple") ||
    text.includes("sextuple") || text.includes("triple felina") || text.includes("puppy") ||
    text.includes("kcnasal") || text.includes("leucemia felina");
  if (needsSchedulingReason || needsMedicalReason || activeSchedulingFlow) return { model: "gpt-4o", tier: 3 };
  return { model: "gpt-4o-mini", tier: 1 };
};

// ── OpenAI Call ───────────────────────────────────────────────────────────────
const callOpenAI = async (key: string, model: string, msgs: Msg[], useTools = true) => {
  const normalizedModel = model === "pro" ? "gpt-4o" : model === "mini" ? "gpt-4o-mini" : model;
  const body: any = { model: normalizedModel, messages: msgs, temperature: 0, max_completion_tokens: 800 };
  if (useTools) { body.tools = functions.map(f => ({ type: "function", function: f })); body.tool_choice = "auto"; }
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  // Sin este chequeo, un 429/401 de OpenAI se colaba como respuesta "válida":
  // choices quedaba undefined, salía el fallback "Error. ¿Puedes repetir?" al
  // cliente y el error real no llegaba a debug_logs. Lanzar deja el detalle en
  // el catch de asyncProcess y le da al cliente el mensaje de reintento.
  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  return res.json();
};

const callAI = async (model: string, msgs: Msg[], useTools = true) => {
  const key = Deno.env.get("OPENAI_API_KEY") || "";
  return callOpenAI(key, model, msgs, useTools);
};

// ── Send Message via Meta ─────────────────────────────────────────────────────
const sendMetaMessage = async (phoneNumberId: string, accessToken: string, to: string, text: string) => {
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body: text } }),
  });
  return res.json();
};

// Cuenta las variables {{n}} del body de una plantilla aprobada, consultando
// directo el WABA de Meta. Mismo patrón que getVarCount() en
// cron-process-reminders — sin caché (esto se llama una vez por solicitud
// nueva, no en un loop), y sin fallback silencioso: si no se puede confirmar
// el conteo real, se retorna null para NO enviar parámetros que Meta podría
// rechazar por no calzar con la plantilla real.
const getTemplateVarCount = async (wabaId: string, accessToken: string, tplName: string): Promise<number | null> => {
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/message_templates?fields=name,components&limit=200`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const d = await res.json();
    const tpl = (d.data || []).find((t: any) => t.name === tplName);
    const body = tpl?.components?.find((c: any) => c.type === "BODY");
    const matches = body?.text?.match(/\{\{\d+\}\}/g);
    return matches ? matches.length : 0;
  } catch { return null; }
};

// Envía el aviso de "nueva solicitud" a la coordinadora como plantilla de Meta
// en vez de texto libre — funciona sin importar la ventana de 24h. Orden fijo
// de variables (igual criterio que mkParams en cron-process-reminders): la
// plantilla que Claudia cree en Meta Business debe usar {{1}}..{{n}} en este
// mismo orden. Se recorta al conteo real de la plantilla aprobada.
const sendMetaCoordinatorTemplate = async (
  phoneNumberId: string, accessToken: string, wabaId: string, to: string, tplName: string,
  fields: { tutor: string; mascota: string; servicio: string; direccion: string; disponibilidad: string },
) => {
  const varCount = await getTemplateVarCount(wabaId, accessToken, tplName);
  if (varCount === null) return { error: "No se pudo confirmar la plantilla en Meta (no encontrada o WABA sin acceso)." };
  const safe = (v: string, fallback: string) => ({ type: "text", text: (v || "").trim() || fallback });
  const all = [
    safe(fields.tutor, "un tutor"),
    safe(fields.mascota, "su mascota"),
    safe(fields.servicio, "una visita"),
    safe(fields.direccion, "su domicilio"),
    safe(fields.disponibilidad, "por confirmar"),
  ];
  const params = varCount > 0 ? all.slice(0, varCount) : [];
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: { name: tplName, language: { code: "es" }, components: params.length > 0 ? [{ type: "body", parameters: params }] : [] },
    }),
  });
  return res.json();
};

// ── Main Handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const url = new URL(req.url);

  // GET: Meta webhook verification
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("Webhook verificado por Meta ✅");
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  if (!await verifyMetaSignature(rawBody, signature)) {
    console.error("Firma inválida — request rechazado");
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: any;
  try { payload = JSON.parse(rawBody); }
  catch { return new Response("Bad Request", { status: 400 }); }

  if (payload.object !== "whatsapp_business_account") return new Response("OK", { status: 200 });

  const sb = getSupabase();

  // Process entries
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
     try {
      if (change.field !== "messages") continue;

      const value = change.value;
      const metadata = value?.metadata;
      const phoneNumberId: string = metadata?.phone_number_id || "";
      const messages: any[] = value?.messages ?? [];
      const statuses: any[] = value?.statuses ?? [];

      // Status updates: sent → delivered → read, o failed. Reportado por Meta vía el mismo
      // evento "messages" (no hay un tipo de evento separado como en YCloud). Actualiza
      // messages, reminder_logs (recordatorios de citas) y reminders (recordatorios médicos)
      // por igual — mismo patrón que "whatsapp.message.updated" en ycloud-whatsapp-webhook.
      // Nunca usar .catch() directo sobre un query builder de Supabase — es un thenable, no una
      // Promise nativa, y no tiene ese método (TypeError). Usar Promise.resolve(...).then(ok, err).
      for (const status of statuses) {
        if (!status.id) continue;
        const rawStatus = (status.status || "").toLowerCase();
        const isFailure = rawStatus === "failed" || rawStatus === "undelivered";

        if (isFailure) {
          const errObj = status.errors?.[0];
          const failText = errObj
            ? `[${errObj.code ?? "?"}] ${errObj.title || errObj.message || "Message undeliverable"}`
            : "Message undeliverable";
          await Promise.resolve(
            sb.from("messages").update({ status: "failed" }).eq("ycloud_message_id", status.id)
          ).then(() => {}, () => {/* non-critical */});
          // Fallo terminal: sobrescribe cualquier estado previo.
          await Promise.resolve(
            sb.from("reminder_logs").update({ status: "failed", error_message: failText }).eq("ycloud_message_id", status.id)
          ).then(() => {}, () => {/* non-critical */});
          // `reminders` = recordatorios médicos (PART 4 del cron). No tiene columna de error, solo status.
          await Promise.resolve(
            sb.from("reminders").update({ status: "failed" }).eq("ycloud_message_id", status.id)
          ).then(() => {}, () => {/* non-critical */});
        } else if (rawStatus === "delivered" || rawStatus === "read") {
          // Escalón positivo. No pisar un 'failed' terminal (los eventos llegan fuera de
          // orden y repetidos): solo actualizar filas aún no marcadas como fallidas.
          await Promise.resolve(
            sb.from("messages").update({ status: rawStatus }).eq("ycloud_message_id", status.id).neq("status", "failed")
          ).then(() => {}, () => {/* non-critical */});
          await Promise.resolve(
            sb.from("reminder_logs").update({ status: rawStatus }).eq("ycloud_message_id", status.id).neq("status", "failed")
          ).then(() => {}, () => {/* non-critical */});
          await Promise.resolve(
            sb.from("reminders").update({ status: rawStatus }).eq("ycloud_message_id", status.id).neq("status", "failed")
          ).then(() => {}, () => {/* non-critical */});
        }
        // rawStatus === "sent" se ignora: ya se registró al momento de enviar.
      }

      if (messages.length === 0) continue;

      // Lookup clinic by phone_number_id
      const { data: clinic } = await sb.from("clinic_settings").select("*")
        .eq("meta_phone_number_id", phoneNumberId).maybeSingle();

      if (!clinic) {
        console.warn(`No se encontró clínica para phone_number_id: ${phoneNumberId}`);
        continue;
      }

      await debugLog(sb, "Meta incoming payload", { phoneNumberId, clinicId: clinic.id, messageCount: messages.length });

      // Process the most recent inbound message (debounce handles burst)
      const message = messages[messages.length - 1];
      const from: string = message.from || "";
      const msgId: string = message.id || `meta-${Date.now()}-${from}`;
      const msgType: string = message.type || "text";
      const ctwaClid: string | undefined = message.referral?.ctwa_clid;

      if (!from) continue;

      const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
      if (!openaiApiKey) {
        console.error("Missing OPENAI_API_KEY");
        continue;
      }

      // Extract text based on message type
      let body = "";
      if (msgType === "text") body = message.text?.body || "";
      else if (msgType === "button") body = message.button?.text || message.button?.payload || "";
      else if (msgType === "interactive") {
        const iv = message.interactive;
        body = iv?.button_reply?.title || iv?.list_reply?.title || "";
      }

      let isImage = false;
      let base64ImageObj: any = null;
      let payloadExtra: any = {};
      let immediateContext: any = null;

      // Handle audio
      if (msgType === "audio" && message.audio) {
        try {
          const blob = await downloadMetaMedia(message.audio.id, clinic.meta_access_token);
          body = await transcribeAudioData(blob, openaiApiKey);
          await debugLog(sb, "Meta audio transcribed", { from, text: body.substring(0, 100) });
        } catch (e) {
          console.error("Meta audio error:", e);
          body = "[Mensaje de audio que no pude procesar. Pide amablemente que te escriban.]";
        }
      }

      // Handle image
      if (msgType === "image" && message.image) {
        try {
          const blob = await downloadMetaMedia(message.image.id, clinic.meta_access_token);
          const arrayBuffer = await blob.arrayBuffer();
          const base64 = btoa(new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ""));
          base64ImageObj = { type: "image_url", image_url: { url: `data:${blob.type || "image/jpeg"};base64,${base64}` } };
          payloadExtra = { image_base64: `data:${blob.type || "image/jpeg"};base64,${base64}` };
          body = message.image?.caption || "[La persona te acaba de enviar una imagen]";
          isImage = true;
          await debugLog(sb, "Meta image received", { from, type: blob.type });
        } catch (e) {
          console.error("Meta image error:", e);
          body = "[La persona envió una imagen pero no pude verla. Pídele que te describa lo que envió.]";
        }
      }

      // Handle location
      if (msgType === "location" && message.location) {
        const loc = message.location;
        const lat = loc.latitude, lng = loc.longitude;
        let formattedAddress = loc.address || "";
        let detectedCity = "";

        try {
          const mapsKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
          if (mapsKey && lat && lng) {
            const geoRes = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${mapsKey}&language=es`);
            const geoData = await geoRes.json();
            if (geoData.status === "OK" && geoData.results?.length > 0) {
              formattedAddress = geoData.results[0].formatted_address;
              const locality = geoData.results[0].address_components.find((c: any) => c.types.includes("locality") || c.types.includes("administrative_area_level_2"));
              if (locality) detectedCity = locality.long_name;
            }
          }
        } catch (e) { console.error("Geocoding failed:", e); }

        body = `📍 [UBICACIÓN COMPARTIDA: ${formattedAddress || `${lat}, ${lng}`}]`;
        payloadExtra = { gps: { lat, lng } };

        const normalizedFrom = normalizePhone(from);
        await sb.from("tutors").update({ latitude: lat, longitude: lng, ...(formattedAddress ? { address: formattedAddress } : {}) })
          .eq("clinic_id", clinic.id).eq("phone_number", normalizedFrom);
        await sb.from("crm_prospects").update({ address: formattedAddress || `Coords: ${lat}, ${lng}` })
          .eq("clinic_id", clinic.id).or(`phone.eq.${from},phone.eq.+${normalizedFrom}`);

        const logisticsConfig = clinic.logistics_config;
        if (logisticsConfig) {
          const urbanBases = logisticsConfig.locations?.filter((l: any) => l.type === "operational") || [];
          const surgeryHubs = logisticsConfig.locations?.filter((l: any) => l.type === "surgical_hub") || [];
          if ((urbanBases.length > 0 || surgeryHubs.length > 0) && GOOGLE_MAPS_API_KEY) {
            try {
              const [urbanResults, surgeryResults] = await Promise.all([
                Promise.all(urbanBases.map(async (base: any) => {
                  const details = await getTravelDetails(`${base.lat},${base.lng}`, `${lat},${lng}`);
                  return { ...base, ...details };
                })),
                Promise.all(surgeryHubs.map(async (hub: any) => {
                  const details = await getTravelDetails(`${hub.lat},${hub.lng}`, `${lat},${lng}`);
                  return { ...hub, ...details };
                })),
              ]);
              const closestUrban = urbanResults.sort((a: any, b: any) => (a.duration || 999) - (b.duration || 999))[0];
              const closestSurgery = surgeryResults.sort((a: any, b: any) => (a.duration || 999) - (b.duration || 999))[0];
              let logNote = "";
              if (closestUrban) {
                const dur = closestUrban.duration || 0;
                logNote = `[LOGÍSTICA: Base Urbana: ${closestUrban.name} | Tiempo al Centro: ${dur} min]`;
                if (closestUrban.time_ranges) {
                  const range = closestUrban.time_ranges.find((r: any) => dur >= r.min && dur <= r.max);
                  if (range) logNote += ` [RECARGO TRASLADO CORRESPONDIENTE: $${range.surcharge} (${range.label})]`;
                  else {
                    const maxRange = closestUrban.time_ranges[closestUrban.time_ranges.length - 1];
                    if (dur > maxRange.max) logNote += ` [ALERTA: FUERA DE RADIO. Tiempo excede el límite máximo de ${maxRange.max} min.]`;
                  }
                }
              }
              if (closestSurgery && logNote) logNote += `\n[LOGÍSTICA: Pabellón más cercano: ${closestSurgery.name} a ${closestSurgery.duration} min]`;
              if (logNote) {
                immediateContext = { gps: { lat, lng }, ruralMins: 0, aiContext: logNote };
                payloadExtra.ai_context = logNote;
              }
            } catch (e) { console.error("Logistics calc error:", e); }
          }
        }
      }

      // Atomic idempotency: save inbound message
      let msgRowId: string | null = null;
      try {
        msgRowId = await saveMsg(sb, clinic.id, from, body, "inbound", {
          ycloud_message_id: msgId,
          message_type: msgType,
          ai_generated: false,
          ...(base64ImageObj ? { image_base64: base64ImageObj.image_url?.url } : {}),
          ...payloadExtra,
        });
      } catch (e: any) {
        if (e.message?.includes("unique_ycloud_message_id")) {
          console.warn(`[Meta] Duplicate WAMID ignored: ${msgId}`);
          continue;
        }
        console.error("[Meta] saveMsg error:", e.message);
      }

      // Tutor context
      const { data: tutor } = await sb.from("tutors")
        .select("id, name, referred_by, referral_code, portal_token, loyalty_points, patients(id, name, species)")
        .eq("clinic_id", clinic.id).eq("phone_number", from).limit(1).maybeSingle();

      const { data: recentAppts } = await sb.from("appointments")
        .select("appointment_date, service, status, notes")
        .eq("clinic_id", clinic.id).eq("phone_number", from)
        .order("appointment_date", { ascending: false }).limit(3);

      let tutorContext = "";
      if (tutor) {
        const petNames = tutor.patients?.map((p: any) => `${p.name} (${p.species || "mascota"})`).join(", ");
        const nowLocal = new Date().toLocaleString("en-CA", { timeZone: clinic.timezone || "America/Santiago" }).split(",")[0];
        let hasPendingAppointmentToday = false;
        const apptHistory = (recentAppts || []).map((a: any) => {
          const d = new Date(a.appointment_date);
          const apptDateStr = d.toLocaleString("en-CA", { timeZone: clinic.timezone || "America/Santiago" }).split(",")[0];
          let statusMarker = apptDateStr === nowLocal && (a.status === "pending" || a.status === "confirmed")
            ? (hasPendingAppointmentToday = true, " (PENDIENTE PARA HOY)")
            : d > new Date() && (a.status === "pending" || a.status === "confirmed") ? " (FUTURA)" : " (PASADA)";
          return `- ${d.toLocaleDateString("es-CL")}: ${a.service} (${a.status})${statusMarker}${a.notes ? ` Obs: ${a.notes}` : ""}`;
        }).join("\n");
        tutorContext = `\n\n### CLIENTE RECONOCIDO: ${tutor.name} ###\nMascotas registradas: ${petNames || "ninguna aún"}.\nHistorial de Citas:\n${apptHistory || "Sin citas previas."}\nINSTRUCCIÓN: Trátalo como cliente recurrente.\n`;

        // Datos del programa de fidelización. Se inyectan en el contexto en vez de
        // exponerse como tool: son dos campos que ya vienen en el SELECT del tutor y
        // así no se gasta una iteración del tool loop en cada consulta de saldo.
        if (clinic.loyalty_enabled) {
          const balance = Number((tutor as any).loyalty_points ?? 0);
          // La Ficha Digital usa `portal_token` (largo, no adivinable) y NO el
          // referral_code de 6 caracteres, que sí se entrega para recomendar.
          const token = (tutor as any).portal_token;
          const refCode = (tutor as any).referral_code;
          const unit = clinic.loyalty_points_name || "puntos";
          tutorContext += `[FIDELIZACIÓN — DATOS REALES, no inventar: saldo acumulado = $${balance.toLocaleString("es-CL")} ${unit}.`;
          if (token) tutorContext += ` Ficha Digital de este cliente: vetly.pro/p/${token}`;
          if (refCode) tutorContext += ` Código para recomendar: ${refCode}`;
          tutorContext += `]\n`;
        }
        if (hasPendingAppointmentToday) {
          tutorContext += `[¡ATENCIÓN CRÍTICA! ESTE CLIENTE TIENE UNA CITA PENDIENTE PARA HOY. Si dice "voy en camino", NO le pidas datos para agendar.]\n`;
        }
      }

      // Referral code detection
      let referralContext = "";
      if (!tutor?.referred_by) {
        const refMatch = (body || "").match(/\b([A-Za-z0-9]{6})\b/g);
        if (refMatch) {
          const normalizedSender = normalizePhone(from);
          for (const rawCode of refMatch) {
            const code = rawCode.toUpperCase();
            const { data: referrer } = await sb.from("tutors").select("id, name")
              .eq("clinic_id", clinic.id).eq("referral_code", code).limit(1).maybeSingle();
            if (referrer?.id) {
              if (tutor) {
                await sb.from("tutors").update({ referred_by: referrer.id }).eq("id", tutor.id).is("referred_by", null);
              } else {
                await sb.from("tutors").upsert({ clinic_id: clinic.id, phone_number: normalizedSender, name: "Sin nombre", referred_by: referrer.id }, { onConflict: "clinic_id,phone_number", ignoreDuplicates: false });
              }
              const bonusLabel = clinic.loyalty_welcome_bonus_type === "percentage"
                ? `${clinic.loyalty_welcome_bonus}% de su primera atención`
                : `$${Number(clinic.loyalty_welcome_bonus || 0).toLocaleString("es-CL")}`;
              referralContext = `\n[SISTEMA: Este cliente llegó REFERIDO por ${referrer.name} (código ${code}). Dale una bienvenida cálida y menciónale que, por venir recomendado, recibirá ${bonusLabel} en ${clinic.loyalty_points_name || "puntos"} cuando se atienda por primera vez, para descontar de futuras visitas.]`;
              break;
            }
          }
        }
      }

      // Estado de la solicitud de coordinación de agenda para ESTE tutor.
      let schedulingContext = "";
      if (needsCoordinatorApproval(clinic)) {
        try {
          const { data: schedReq } = await sb.from("scheduling_requests")
            .select("status, availability_text, service_requested, authorized_options")
            .eq("clinic_id", clinic.id).eq("tutor_phone", normalizePhone(from))
            .in("status", ["pending", "authorized"])
            .order("updated_at", { ascending: false }).limit(1).maybeSingle();
          const req = schedReq as any;
          if (req?.status === "pending") {
            schedulingContext = `\n\n### SOLICITUD DE AGENDA EN REVISIÓN ###\nEste tutor ya entregó sus datos y su disponibilidad ("${req.availability_text}") para "${req.service_requested}". La coordinadora está revisando la ruta.\nINSTRUCCIÓN: NO ofrezcas horarios ni uses check_availability, create_appointment o reschedule_appointment. Si pregunta por el estado, dile con calidez que la coordinadora le escribirá por este mismo medio muy pronto. Si quiere corregir o ampliar su disponibilidad, vuelve a usar request_scheduling_coordination con los datos actualizados.\n`;
          } else if (req?.status === "authorized") {
            schedulingContext = `\n\n### OPCIONES AUTORIZADAS POR LA COORDINADORA ###\nSOLO puedes ofrecerle a este tutor estas alternativas:\n"${req.authorized_options}"\nINSTRUCCIÓN CRÍTICA: en tu SIGUIENTE respuesta a este tutor, comunícale estas opciones de inmediato, sin esperar que te lo pregunte — incluso si su mensaje trata de otro tema. Preséntaselas con calidez (puedes adaptar el tono, nunca el contenido).\nSi elige una (o si su mensaje ya confirma/acepta una de estas opciones, aunque sea con un simple "sí" o "me acomoda" — interprétalo como la aceptación de la opción que le acabas de ofrecer), llama DIRECTAMENTE a create_appointment o reschedule_appointment con esa fecha y hora exactas. NO llames a check_availability antes: la coordinadora YA verificó que ese horario es viable considerando la ruta, y check_availability puede devolver una respuesta distinta (calculada para el flujo automático) que contradiría lo que ella decidió — eso ya causó respuestas reales incorrectas, está PROHIBIDO.\nSi el tutor dice explícitamente que NINGUNA opción le sirve, pregúntale qué otros días y rangos horarios le acomodan y usa request_scheduling_coordination con esa disponibilidad nueva. Mientras estas opciones sigan vigentes, TERMINANTEMENTE PROHIBIDO volver a llamar request_scheduling_coordination solo porque el tutor respondió algo ambiguo o breve — en ese caso, confirma tú primero a cuál opción se refiere en vez de reiniciar la coordinación.\nNUNCA ofrezcas un horario que no esté en esta lista.\n`;
          }
        } catch (e) { console.error("[Meta] schedulingContext lookup failed:", e); }
      }

      // CAPI: LeadSubmitted (before ai_auto_respond check — fires even when AI is off)
      if (!tutor && ctwaClid && clinic.meta_pixel_id && clinic.meta_capi_token) {
        const capiResult = await sendMetaCAPIEvent(clinic.meta_pixel_id, clinic.meta_capi_token, "LeadSubmitted", from, ctwaClid, undefined, clinic.meta_test_event_code || undefined, clinic.meta_page_id || undefined);
        await debugLog(sb, `[META CAPI] LeadSubmitted for ${from}`, capiResult);
      }

      // CRM auto-sync
      // "status" no es columna de crm_prospects (tiene stage_id, no status) — el insert
      // fallaba siempre y el catch vacío lo ocultaba. Ver ycloud-whatsapp-webhook para el
      // insert de referencia (clinic_id, phone, name, source, stage_id, requires_human).
      try {
        const normalizedFrom = normalizePhone(from);
        const { data: existingProspect } = await sb.from("crm_prospects").select("id")
          .eq("clinic_id", clinic.id).or(`phone.eq.${from},phone.eq.+${normalizedFrom}`).limit(1).maybeSingle();
        if (!existingProspect && !tutor) {
          const { error: crmInsertError } = await sb.from("crm_prospects")
            .insert({ clinic_id: clinic.id, phone: normalizedFrom, source: "whatsapp_inbound" });
          if (crmInsertError) {
            await debugLog(sb, "CRM auto-sync insert error", { error: crmInsertError.message, phone: normalizedFrom });
          }
        }
      } catch (crmErr) {
        await debugLog(sb, "CRM auto-sync error", { error: (crmErr as Error).message });
      }

      // ── Async Process ────────────────────────────────────────────────────────
      const asyncProcess = async (immediateCtx?: { gps: { lat: number; lng: number }; ruralMins: number; aiContext: string }) => {
        let targetModel = "gpt-4o-mini";
        let modelForTracking = "mini";
        try {
          // Check ai_auto_respond
          if (!clinic.ai_auto_respond) {
            console.log(`[Meta] AI agent disabled for clinic ${clinic.id}`);
            return;
          }

          // ── Cuota de créditos IA ────────────────────────────────────────────
          // Se comprueba ANTES de llamar a OpenAI: hasta la sesión 76 el chequeo
          // vivía dentro de saveMsg (después de generar la respuesta) y era un
          // console.warn sin return, así que el agente seguía respondiendo gratis
          // indefinidamente. Una sola verificación por turno, no por iteración
          // del tool loop: cortar a mitad dejaría tool calls ya ejecutados (una
          // cita creada, por ejemplo) sin respuesta final al tutor.
          //
          // Al agotarse: silencio hacia el tutor y aviso a la clínica. El mensaje
          // entrante ya se guardó más arriba, así que queda en Mensajes para que
          // lo respondan a mano.
          const credits = await getCreditStatus(sb, clinic.id);
          if (credits.exhausted) {
            await notifyCreditsExhausted(sb, clinic.id, credits.poolId);
            console.warn(
              `[Meta] Créditos agotados (pool ${credits.poolId}: ${credits.totalUsed}/${credits.limit + credits.extraBalance}) — no se responde a ${from}`,
            );
            return;
          }

          const normalizedFrom = normalizePhone(from);
          const searchPhone = from.startsWith("+") ? from : `+${from}`;
          const searchPhoneNoPlus = from.startsWith("+") ? from.substring(1) : from;

          // Reset IA command — DEBE ir antes del chequeo de requires_human: si se evalúa
          // después, el `return` de la pausa lo vuelve inalcanzable justo en el único
          // escenario en que sirve (conversación pausada que se quiere reactivar).
          const lowerBody = body.toLowerCase().trim();
          if (
            lowerBody === "/reset ia" || lowerBody === "reset ia" ||
            lowerBody === "resetear_ia" || lowerBody === "resetear ia" || lowerBody === "reset_ia"
          ) {
            await sb.from("tutors").update({ requires_human: false }).eq("clinic_id", clinic.id)
              .or(`phone_number.eq.${searchPhone},phone_number.eq.${searchPhoneNoPlus}`);
            await sb.from("crm_prospects").update({ requires_human: false }).eq("clinic_id", clinic.id).or(`phone.eq.${from},phone.eq.+${normalizedFrom}`);
            await sendMetaMessage(clinic.meta_phone_number_id, clinic.meta_access_token, from, "✅ IA reactivada. ¿En qué puedo ayudarte?");
            return;
          }

          // requires_human — punto de control 1 de 3 (ver isPausedForHuman).
          // Este ahorra el debounce cuando la conversación ya venía pausada.
          if (await isPausedForHuman(sb, clinic.id, from)) {
            console.log(`[Meta] requires_human=true for ${from}, skipping AI (pre-debounce)`);
            return;
          }

          // Debounce 20 seconds
          await new Promise(r => setTimeout(r, 20000));

          // Dedup: abort if a newer message arrived
          const { data: latestMsg } = await sb.from("messages").select("id")
            .eq("clinic_id", clinic.id).or(`phone_number.eq.${from},phone_number.eq.+${from}`)
            .eq("direction", "inbound").order("created_at", { ascending: false }).limit(1).maybeSingle();
          if (latestMsg && msgRowId && latestMsg.id !== msgRowId) {
            console.log(`[Meta asyncProcess] Debounced: ${msgRowId} not latest (${latestMsg.id})`);
            return;
          }

          // requires_human — punto de control 2 de 3: capta el clic en "Silenciar IA"
          // ocurrido durante los 20s de debounce.
          if (await isPausedForHuman(sb, clinic.id, from)) {
            console.log(`[Meta] requires_human=true for ${from}, skipping AI (post-debounce)`);
            return;
          }

          // Logistics config
          let logisticsConfig: any = clinic.logistics_config || null;
          try {
            if (!logisticsConfig || Object.keys(logisticsConfig).length === 0) {
              const logMatch = (clinic.ai_behavior_rules || "").match(/\[LOGISTICS_CONFIG\]([\s\S]*?)\[\/LOGISTICS_CONFIG\]/);
              if (logMatch) logisticsConfig = JSON.parse(logMatch[1]);
            }
          } catch { /* ignore */ }

          // GPS from immediate context or history
          let globalGPS = immediateCtx?.gps || null;
          let globalLocContext = immediateCtx?.aiContext || "";
          if (!globalGPS) {
            try {
              const { data: gpsMsg } = await sb.from("messages").select("payload")
                .eq("clinic_id", clinic.id).or(`phone_number.eq.${from},phone_number.eq.+${from}`)
                .not("payload", "is", null).order("created_at", { ascending: false });
              if (gpsMsg) {
                for (const m of gpsMsg) {
                  const p = m.payload as any;
                  if (p?.gps) { globalGPS = p.gps; break; }
                }
              }
            } catch { /* ignore */ }
          }

          // History fetch
          const { data: rawHistory } = await sb.from("messages")
            .select("content, direction, created_at, ai_generated, payload, message_type")
            .eq("clinic_id", clinic.id).or(`phone_number.eq.${from},phone_number.eq.+${from.replace(/^\+/, "")}`)
            .order("created_at", { ascending: false }).limit(20);
          const history = (rawHistory || []).reverse();

          // Google Maps link detection
          const lastUserMsg = [...history].reverse().find(m => m.direction === "inbound" && !m.ai_generated);
          if (lastUserMsg && GOOGLE_MAPS_API_KEY && (lastUserMsg.content?.includes("maps.app.goo.gl") || lastUserMsg.content?.includes("google.com/maps"))) {
            const urlMatch = lastUserMsg.content.match(/https?:\/\/(?:maps\.app\.goo\.gl|www\.google\.com\/maps)[^\s]+/);
            if (urlMatch) {
              const resolvedCoords = await resolveGoogleMapsUrl(urlMatch[0]);
              if (resolvedCoords) {
                globalGPS = resolvedCoords;
                globalLocContext = `[SISTEMA: GPS RECIBIDO VIA LINK - COORDENADAS: ${globalGPS.lat}, ${globalGPS.lng}]`;
              }
            }
          }

          // Logistics calculations if GPS available
          if (globalGPS && logisticsConfig && GOOGLE_MAPS_API_KEY) {
            try {
              const urbanBases = logisticsConfig.locations?.filter((l: any) => l.type === "operational") || logisticsConfig.urban_bases || [];
              const surgeryHubs = logisticsConfig.locations?.filter((l: any) => l.type === "surgical_hub") || logisticsConfig.surgery_hubs || [];
              const [urbanResults, surgeryResults] = await Promise.all([
                Promise.all(urbanBases.map(async (base: any) => {
                  const details = await getTravelDetails(`${base.lat},${base.lng}`, `${globalGPS!.lat},${globalGPS!.lng}`);
                  return { ...base, ...details };
                })),
                Promise.all(surgeryHubs.map(async (hub: any) => {
                  const details = await getTravelDetails(`${hub.lat},${hub.lng}`, `${globalGPS!.lat},${globalGPS!.lng}`);
                  return { ...hub, ...details };
                })),
              ]);
              const closestUrban = urbanResults.sort((a: any, b: any) => (a.duration || 999) - (b.duration || 999))[0];
              const closestSurgery = surgeryResults.sort((a: any, b: any) => (a.duration || 999) - (b.duration || 999))[0];
              if (closestUrban) {
                const dur = closestUrban.duration || 0;
                let logNote = `[LOGÍSTICA: Base Urbana: ${closestUrban.name} | Tiempo al Centro: ${dur} min]`;
                if (closestUrban.time_ranges) {
                  const range = closestUrban.time_ranges.find((r: any) => dur >= r.min && dur <= r.max);
                  if (range) logNote += ` [RECARGO TRASLADO CORRESPONDIENTE: $${range.surcharge} (${range.label})]`;
                  else {
                    const maxRange = closestUrban.time_ranges[closestUrban.time_ranges.length - 1];
                    if (dur > maxRange.max) logNote += ` [ALERTA: FUERA DE RADIO. Tiempo excede ${maxRange.max} min.]`;
                  }
                }
                if (closestSurgery) logNote += `\n[LOGÍSTICA: Pabellón más cercano: ${closestSurgery.name} a ${closestSurgery.duration} min]`;
                globalLocContext = logNote;
                if (lastUserMsg) {
                  await sb.from("messages").update({ payload: { ...(lastUserMsg.payload || {}), ai_context: globalLocContext, gps: globalGPS } }).eq("id", (lastUserMsg as any).id);
                }
              }
            } catch { /* ignore */ }
          }

          // Date / time context
          const clinicTz = clinic.timezone || "America/Santiago";
          const now = new Date();
          const localTime = now.toLocaleString("es-CL", { timeZone: clinicTz, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
          const localDateISO = now.toLocaleDateString("en-CA", { timeZone: clinicTz });
          const tomorrow = new Date(now.getTime() + 86400000);
          const dayAfter = new Date(now.getTime() + 172800000);
          const tomorrowISO = tomorrow.toLocaleDateString("en-CA", { timeZone: clinicTz });
          const dayAfterISO = dayAfter.toLocaleDateString("en-CA", { timeZone: clinicTz });
          const todayDay = now.toLocaleDateString("es-CL", { timeZone: clinicTz, weekday: "long" });
          const tomorrowDay = tomorrow.toLocaleDateString("es-CL", { timeZone: clinicTz, weekday: "long" });
          const dayAfterDay = dayAfter.toLocaleDateString("es-CL", { timeZone: clinicTz, weekday: "long" });

          // Knowledge and services
          // ORDER BY id: garantiza el mismo orden de filas entre llamadas — necesario
          // para que el prompt caching de OpenAI funcione (ver ycloud-whatsapp-webhook).
          const knowledgeSummary = await getKnowledgeSummary(sb, clinic.id);
          const { data: realServices } = await sb.from("clinic_services").select("name, duration, price, ai_description").eq("clinic_id", clinic.id).order("id", { ascending: true });
          // Campos vacíos omitidos en vez de rellenados con placeholder — hoy el 100% de
          // los servicios tiene ai_description en null, así que "Sin detalles específicos."
          // sumaba ~2.550 caracteres de ruido al prompt en cada llamada a OpenAI.
          const servicesForPrompt = realServices && realServices.length > 0
            ? realServices.map((s: any) => {
              const item: Record<string, string> = { nombre: s.name };
              if (s.duration) item.duracion = `${s.duration} min`;
              item.precio = `$${s.price.toLocaleString("es-CL")}`;
              if (s.ai_description) item.info_importante = s.ai_description;
              return item;
            })
            : clinic.services || [];

          const daysMap: Record<string, string> = { monday: "lunes", tuesday: "martes", wednesday: "miércoles", thursday: "jueves", friday: "viernes", saturday: "sábado", sunday: "domingo" };
          const hoursSummary = Object.entries(clinic.working_hours || {}).map(([day, h]: [string, any]) => {
            const dayName = daysMap[day.toLowerCase()] || day;
            if (!h || h.closed || h.enabled === false) return `${dayName}: CERRADO`;
            const lunch = h.lunch_break;
            return `${dayName}: ${h.open || h.start || "10:00"} - ${h.close || h.end || "18:30"}${lunch?.enabled ? ` (Colación: ${lunch.start}-${lunch.end})` : ""}`;
          }).join(", ");
          // La hora de cierre de arriba NO es la última hora agendable: el último slot
          // COMIENZA en logistics_config.last_slot_time (18:00 por defecto) y el servicio
          // puede terminar pasado el cierre. Sin esta nota la IA lee "cierre 19:00" y le
          // promete a los clientes citas a las 19:00 que no existen (bug real, sesión 95).
          const rawPromptSlotCap = (clinic?.logistics_config as any)?.last_slot_time;
          const promptSlotCap = typeof rawPromptSlotCap === "string" &&
              /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(rawPromptSlotCap.trim())
            ? rawPromptSlotCap.trim().slice(0, 5)
            : "18:00";
          // El texto cambia según el modo de agendamiento. En modo coordinadora la
          // versión antigua ("...y ofrece esa hora") era una orden DIRECTA de ofrecer
          // un horario, en contradicción con la Sección 10 del prompt — y como este
          // bloque va arriba (junto a "Horarios:") le ganaba por posición. Causó un
          // caso real (Daniel Vásquez, Linares, 2026-09-03): la IA respondió "La
          // última visita que podemos agendar comienza a las 18:00 hrs. ¿Te gustaría
          // que coordinemos para esa hora hoy?" — copiado casi textual de esta nota.
          const lastSlotNote = clinic.scheduling_mode === "coordinator_approval"
            ? `\n⚠️ ÚLTIMA CITA AGENDABLE DEL DÍA: la última visita que se puede agendar COMIENZA a las ${promptSlotCap} hrs. El equipo puede terminar más tarde, pero NO se agenda ninguna visita que empiece después de esa hora — la hora de "cierre" de arriba NO es la última hora agendable. Este dato es SOLO un límite que tú debes respetar al reunir la disponibilidad del tutor: NO es un horario para ofrecer. En esta clínica los horarios los decide la coordinadora (ver Sección 10), así que TERMINANTEMENTE PROHIBIDO proponerle al tutor una hora concreta —incluidas las ${promptSlotCap}— o preguntarle si "coordinamos para esa hora". Si el tutor solo puede después de las ${promptSlotCap}, dile con claridad "la última visita que agendamos comienza a las ${promptSlotCap} hrs" y pídele qué otros días y rangos DENTRO de ese margen le acomodan, para enviárselos a la coordinadora.`
            : `\n⚠️ ÚLTIMA CITA AGENDABLE DEL DÍA: la última visita que se puede agendar COMIENZA a las ${promptSlotCap} hrs. El equipo puede terminar de atender más tarde, pero NO se agenda ninguna visita que empiece después de esa hora. La hora de "cierre" de arriba NO es la última hora agendable. TERMINANTEMENTE PROHIBIDO ofrecer, prometer o enviar en la solicitud de agenda cualquier horario posterior a las ${promptSlotCap}. Si el tutor solo puede después de las ${promptSlotCap}, dile con claridad: "La última visita que agendamos comienza a las ${promptSlotCap} hrs" y ofrece esa hora o un día alternativo — nunca insinúes que se puede más tarde.`;

          // Survey feedback context
          const normalizedFromPhone = normalizePhone(from);
          const { data: pendingFeedbackSurvey } = await sb.from("satisfaction_surveys").select("id, rating")
            .or(`phone_number.eq.${from},phone_number.eq.${normalizedFromPhone},phone_number.eq.+${normalizedFromPhone}`)
            .eq("status", "responded").lte("rating", 2).is("feedback_context", null)
            .order("responded_at", { ascending: false }).limit(1).maybeSingle();

          // Texto de mensajes entrantes recientes, para detectar si corresponde forzar
          // alguno de los 3 documentos KB de riesgo (cirugía/sedación/visita fallida).
          // No se usa burstInbound (se define más abajo, después de necesitarlo aquí).
          const recentUserText = history
            .filter((m: any) => m.direction === "inbound")
            .slice(-5)
            .map((m: any) => m.content || "")
            .join(" ");
          const forcedKnowledgeBlock = await getForcedKnowledgeBlock(sb, clinic.id, recentUserText);

          // --- PLAN DE RUTA (overrides esporádicos de sector, cargados por la clínica) ---
          // Solo aplica a clínicas móviles con sectorización (routing_mode = mobile_sectors).
          // El bloqueo real vive en checkAvail; esto es para que la IA sea proactiva y
          // ofrezca la fecha correcta en vez de chocar contra un "no hay disponibilidad".

          // --- REGLAS DEL PROGRAMA DE FIDELIZACIÓN ---
          // Va en el prompt SOLO si el programa está encendido. Antes vivía escrito a
          // mano dentro de ai_behavior_rules, así que apagar `loyalty_enabled` detenía
          // la acumulación pero la IA seguía anunciándola igual (15-ago-2026): había que
          // editar el prompt a mano en cada encendido/apagado. Con esto, un solo switch
          // controla motor, canje, carnet y lo que dice el agente.
          // Los montos se leen de la configuración real: si se cambia el % desde
          // Fidelización, el texto se actualiza solo en vez de quedar mintiendo.
          let loyaltyRulesBlock = "";
          if (clinic.loyalty_enabled) {
            const unitName = clinic.loyalty_points_name || "puntos";
            const earnPct = Number(clinic.loyalty_points_percentage ?? 0);
            const refBonus = Number(clinic.loyalty_referral_bonus ?? 0);
            const welcome = Number(clinic.loyalty_welcome_bonus ?? 0);
            const welcomeLabel = clinic.loyalty_welcome_bonus_type === "percentage"
              ? `${welcome}% de esa primera atención`
              : `$${welcome.toLocaleString("es-CL")}`;
            const refBonusLabel = clinic.loyalty_referral_bonus_type === "percentage"
              ? `${refBonus}% de esa primera atención`
              : `$${refBonus.toLocaleString("es-CL")}`;
            loyaltyRulesBlock = `

## PROGRAMA ${unitName.toUpperCase()}
${earnPct > 0 ? `* **CIERRE DE AGENDAMIENTO:** Justo después del aviso de rango horario, cierra con UNA sola frase breve, nunca un párrafo: "Además, desde tu segunda visita acumulas automáticamente el ${earnPct}% del total de cada atención en ${unitName}, que puedes usar cuando quieras para descontar de futuras visitas 🐾". Si ya lo mencionaste antes en esta conversación, no lo repitas.\n` : ""}* **FICHA DIGITAL:** Si preguntan por su saldo, cómo recomendar o sus próximas atenciones, entrega el enlace de Ficha Digital que aparece en el bloque [FIDELIZACIÓN] del contexto.
* **⚠️ PROHIBIDO INVENTAR SALDOS (ABSOLUTO):** Menciona un monto SOLO si aparece explícitamente en el bloque [FIDELIZACIÓN] del contexto. Si no aparece, di que puede revisarlo en su Ficha Digital. NUNCA estimes ni inventes un saldo.
${refBonus > 0 ? `* **RECOMENDAR A UN AMIGO:** Quien comparte su código gana ${refBonusLabel} en ${unitName} cuando su recomendado se atiende por primera vez, y ese nuevo cliente recibe ${welcomeLabel}. El código aparece en el bloque [FIDELIZACIÓN]; entrégalo solo si lo piden. El premio se paga con la atención, no por mandar el código.` : ""}`;
          }

          let routePlanBlock = "";
          if ((clinic.logistics_config as any)?.routing_mode === "mobile_sectors") {
            const planHorizonISO = new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000)
              .toLocaleDateString("en-CA", { timeZone: clinicTz });
            const { data: planRows, error: planErr } = await sb.from("clinic_route_plan")
              .select("date, allowed_sectors, note")
              .eq("clinic_id", clinic.id)
              .gte("date", localDateISO)
              .lte("date", planHorizonISO)
              .order("date", { ascending: true });
            if (planErr) console.error("[routePlan] Error cargando plan para el prompt:", planErr);

            const activePlan = (planRows || []).filter(
              (p: any) => Array.isArray(p.allowed_sectors) && p.allowed_sectors.length > 0,
            );
            if (activePlan.length > 0) {
              // Cada fecha se etiqueta con su distancia al día de hoy. Sin esto, el
              // modelo tomaba el PRIMER día de la lista como si fuera "hoy" y corría
              // todo el marco temporal un día (bug real: un domingo ofreció "hoy,
              // lunes 17" y agendó como "mañana" una cita que caía pasado mañana).
              // El desfase aparecía cuando hoy es día cerrado y por lo tanto no
              // figura en el plan, dejando al modelo sin ancla visible.
              const dayDiff = (iso: string) => Math.round(
                (Date.parse(`${iso}T12:00:00Z`) - Date.parse(`${localDateISO}T12:00:00Z`)) / 86400000,
              );
              const relLabel = (iso: string) => {
                const n = dayDiff(iso);
                if (n === 0) return " [HOY]";
                if (n === 1) return " [MAÑANA]";
                if (n === 2) return " [PASADO MAÑANA]";
                return ` [en ${n} días]`;
              };
              const planLines = activePlan.map((p: any) => {
                const label = new Date(`${p.date}T12:00:00`).toLocaleDateString("es-CL", {
                  weekday: "long", day: "numeric", month: "long",
                });
                return `- ${label} (${p.date})${relLabel(p.date)}: SOLO sector ${p.allowed_sectors.join(" y ")}${p.note ? ` — ${p.note}` : ""}`;
              }).join("\n");

              // Si hoy no aparece en el plan, decirlo explícitamente: el hueco es
              // justo lo que llevaba al modelo a re-anclar el "hoy" en otra fecha.
              const todayKeyEn = now.toLocaleDateString("en-US", { timeZone: clinicTz, weekday: "long" }).toLowerCase();
              const todayHours = (clinic.working_hours || {})[todayKeyEn];
              const todayClosed = !todayHours || todayHours.closed || todayHours.enabled === false;
              const todayInPlan = activePlan.some((p: any) => p.date === localDateISO);
              const todayNote = todayInPlan
                ? ""
                : `\n- ${todayDay} ${localDateISO} [HOY]: ${todayClosed ? "CERRADO, no se atiende" : "sin restricción de sector (logística normal)"}.`;

              routePlanBlock = `
⚠️ PLAN DE RUTA DEL MÓVIL — PRIORIDAD MÁXIMA (POR SOBRE CUALQUIER OTRA REGLA DE SECTORES) ⚠️
Referencia temporal: HOY es ${todayDay} ${localDateISO}. Esta lista NO empieza necesariamente hoy.
Cada fecha trae entre corchetes su relación con el día de hoy: usa ESA etiqueta y nunca llames "hoy" ni "mañana" a una fecha que no la tenga.
El equipo definió por qué sector se recorre en estas fechas puntuales. Es inviolable:${todayNote}
${planLines}

Cómo aplicarlo:
- En esas fechas SOLO puedes ofrecer y agendar citas de los sectores indicados.
- Si el cliente es de otro sector y pide una de esas fechas, NO le ofrezcas horarios. Explícale con naturalidad que ese día el móvil recorre solo esa zona y ofrécele la fecha más próxima de la lista donde sí se atiende su sector.
- Si el cliente ya te dijo su comuna, adelántate: menciónale tú el día que corresponde a su zona en vez de esperar a que pida uno bloqueado.
- Las fechas que NO aparecen en esta lista funcionan con la logística normal de siempre.
- NUNCA hables de un "plan", un "sistema" ni una "restricción": habla como la coordinación de ruta del equipo móvil.
`;
            }
          }

          // --- BLOQUE ESTÁTICO (idéntico entre mensajes/tutores de esta clínica) ---
          // Va SIEMPRE primero para no romper el prompt caching de OpenAI: el descuento
          // (~50% en input tokens) solo aplica al PREFIJO común entre llamadas, y se
          // pierde desde el primer carácter que difiere. Mismo fix aplicado en
          // ycloud-whatsapp-webhook (sesión 60) — ver ese archivo para más contexto.
          const staticSysPrompt = `
${clinic.ai_personality || "Eres un asistente veterinario profesional."}

Clínica: ${clinic.clinic_name}
Dirección: ${clinic.clinic_address || clinic.address || "No especificada."}
Horarios: ${hoursSummary}${lastSlotNote}${clinic.contact_phone ? `\nTeléfono de Contacto Clínico: ${clinic.contact_phone}` : ""}${clinic.transfer_details ? `\nDatos de Pago/Transferencia: ${clinic.transfer_details}` : ""}

⚠️ PROTOCOLOS DE ATENCIÓN Y REGLAS DE COMPORTAMIENTO ⚠️
${(clinic.ai_behavior_rules || "").replace(/`/g, "'")}
--------------------------------------------------------

LISTA OFICIAL DE SERVICIOS Y PRECIOS:
${JSON.stringify(servicesForPrompt)}

BASE DE CONOCIMIENTO (PROTOCOLOS Y DETALLES ACTUALIZADOS):
${knowledgeSummary}

⚠️ NOTA PARA IA: Si existe una discrepancia entre la 'Lista Oficial' y la 'Base de Conocimiento', prioriza SIEMPRE la Base de Conocimiento.
${forcedKnowledgeBlock}${routePlanBlock}${loyaltyRulesBlock}`;

          // --- BLOQUE DINÁMICO (cambia por mensaje/tutor) — SIEMPRE al final ---
          const dynamicSysPrompt = `

CONTEXTO DE FECHAS:
- HOY: ${todayDay}, ${localDateISO}
- MAÑANA: ${tomorrowDay}, ${tomorrowISO}
- PASADO MAÑANA: ${dayAfterDay}, ${dayAfterISO}
- HORA ACTUAL: ${localTime}
${pendingFeedbackSurvey ? `\n⚠️ CONTEXTO ESPECIAL — ENCUESTA DE SATISFACCIÓN NEGATIVA ⚠️\nEste cliente acaba de calificar su última atención con ${pendingFeedbackSurvey.rating} estrella/s. Escucha activamente, muestra empatía, NO intentes vender nada.\n` : ""}`;

          const finalSysPrompt = staticSysPrompt + dynamicSysPrompt +
            (globalLocContext ? `\n\n### INFO SISTEMA: GEO-DATA ###\n${globalLocContext}` : "") +
            (tutorContext || "") + (referralContext || "") + (schedulingContext || "");

          // Build message history
          let lastOutboundIndex = -1;
          for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].direction === "outbound") { lastOutboundIndex = i; break; }
          }
          const pastContext = lastOutboundIndex >= 0 ? history.slice(0, lastOutboundIndex + 1) : [];
          const burstInbound = lastOutboundIndex >= 0 ? history.slice(lastOutboundIndex + 1) : history;

          const msgs: Msg[] = [
            { role: "system", content: finalSysPrompt },
            ...pastContext.map(m => {
              let content = m.content || "";
              const aiExtra = (m.payload as any)?.ai_context || "";
              if (aiExtra) content = `${content}\n${aiExtra}`;
              return { role: (m.direction === "inbound" ? "user" : "assistant") as "user" | "assistant", content };
            }),
          ];

          const userContentBlocks: any[] = [];
          for (const msg of burstInbound) {
            let text = msg.content || "";
            if ((msg.payload as any)?.ai_context) text = `${text}\n${(msg.payload as any).ai_context}`;
            if (msg.message_type === "image" && (msg.payload as any)?.image_base64) {
              userContentBlocks.push({ type: "text", text: text || "[Imagen]" });
              userContentBlocks.push({ type: "image_url", image_url: { url: (msg.payload as any).image_base64 } });
            } else {
              userContentBlocks.push({ type: "text", text: text || "" });
            }
          }
          if (userContentBlocks.length > 0) msgs.push({ role: "user", content: userContentBlocks });

          // Model routing
          targetModel = "gpt-4o-mini";
          let tierUsed = 1;
          if (clinic.ai_active_model === "hybrid") {
            const lastUserText = userContentBlocks.map((b: any) => b.text || "").join(" ");
            const hasImageInBurst = userContentBlocks.some((b: any) => b.type === "image_url");

            const leanRouting = LEAN_ROUTING_CLINICS.includes(clinic.id)
              && clinic.scheduling_mode === "coordinator_approval";

            let route: { model: string; tier: number };
            if (leanRouting) {
              // Ruteo optimizado para modo coordinadora (sesión 95). Van a GPT-4o SOLO:
              // imagen · vuelta del pin (contexto de logística) · precio/servicio con
              // costo variable · matices médicos · seguimiento a un mensaje de la IA que
              // tocó precio/médico o que ofreció una hora concreta. Todo lo demás (nombre,
              // dirección escrita, "sí", especie, edad, "¿qué días?") va a mini: en modo
              // coordinadora la IA solo llena datos y llama request_scheduling_coordination.
              const t = lastUserText.toLowerCase();
              const lastOut = history.filter(m => m.direction === "outbound").slice(-1).map(m => (m.content || "").toLowerCase())[0] || "";
              const pinContext = t.includes("[logística") || t.includes("[logistica")
                || t.includes("recargo traslado") || t.includes("ubicación compartida") || t.includes("ubicacion compartida");
              const pricingSignals = ["precio", "valor", "cuánto", "cuanto", "cuesta", "costo", "recargo", "tarifa", "cotiz",
                "traslado", "comuna", "cobertura", "promoci", "descuent", "pack", "presupuesto",
                "uña", "parasit", "desparasit", "camada", "gatitos", "perritos", "cachorros",
                "varios", "varias", "mis gatos", "mis perros",
                "2 gatos", "3 gatos", "4 gatos", "2 perros", "3 perros", "4 perros",
                "dos gatos", "tres gatos", "cuatro gatos", "dos perros", "tres perros", "cuatro perros",
                "alizin", "preñ", "monta"];
              const medicalSignals = ["cirug", "esteril", "castra", "vacun", "antirrabi", "octuple", "sextuple", "triple felina",
                "puppy", "leucemia felina", "perrera", "destartraje", "sedaci", "ecograf", "radiograf", "eutan"];
              const currentBig = hasImageInBurst || pinContext
                || pricingSignals.some(s => t.includes(s))
                || medicalSignals.some(s => t.includes(s));
              const lastOutOfferedTime = /\d{1,2}:\d{2}|a las \d{1,2}|lunes|martes|mi[eé]rcoles|jueves|viernes/.test(lastOut);
              const stickyBig = lastOutOfferedTime
                || pricingSignals.some(s => lastOut.includes(s))
                || medicalSignals.some(s => lastOut.includes(s));
              route = (currentBig || stickyBig) ? { model: "gpt-4o", tier: 3 } : { model: "gpt-4o-mini", tier: 1 };
            } else {
              // Ruteo actual — Linares y cualquier clínica fuera de la lista o sin
              // modo coordinadora. SIN CAMBIOS respecto a lo que corre hoy.
              const recentOutbound = history.filter(m => m.direction === "outbound").slice(-3).map(m => (m.content || "").toLowerCase());
              const schedulingSignals = ["cita", "agend", "disponib", "horario", "slot", "hora disponible", "reserv", "sector", "direcci", "ubicaci", "traslado", "zona", "comuna", "cobertura", "recargo", "castr", "cirug", "esteril", "vacun", "antirrabi", "octuple", "sextuple", "triple felina"];
              const activeSchedulingFlow = recentOutbound.some(msg => schedulingSignals.some(s => msg.includes(s)));
              const trivialAckPattern = /^(si|sí|ok|okay|oka|dale|listo|gracias|muchas gracias|perfecto|genial|bueno|vale|ya|de acuerdo|entendido)[\s!.,¡🙏😊👍✨]*$/i;
              const lastOutboundText = recentOutbound[recentOutbound.length - 1] || "";
              const lastOutboundOfferedTime = /\d{1,2}:\d{2}|a las \d{1,2}|lunes|martes|mi[eé]rcoles|jueves|viernes/.test(lastOutboundText);
              const trimmedUserText = lastUserText.trim();
              const isSafeTrivialAck = !hasImageInBurst && trimmedUserText.length > 0 && trimmedUserText.length <= 20
                && trivialAckPattern.test(trimmedUserText) && !lastOutboundOfferedTime;
              route = isSafeTrivialAck
                ? { model: "gpt-4o-mini", tier: 1 }
                : selectModelTier(lastUserText, hasImageInBurst, activeSchedulingFlow);
            }
            targetModel = route.model;
            tierUsed = route.tier;
          } else if (clinic.ai_active_model === "pro") {
            targetModel = "gpt-4o"; tierUsed = 3;
          }
          modelForTracking = targetModel === "gpt-4o" ? (tierUsed === 3 ? "4o_pro" : "4o_standard") : "mini";

          // Tool loop (max 5 iterations)
          let res = await callAI(targetModel, msgs, true);
          let assistant = res.choices?.[0]?.message;
          const allFuncResults: any[] = [];
          let maxCalls = 5;

          // Tools que representan un cierre real del flujo de coordinación —
          // usadas tanto para forzar un reintento dentro del loop como para el
          // aviso post-envío de más abajo. Una sola definición, sin duplicar.
          const dispatchTools = ["request_scheduling_coordination", "create_appointment", "reschedule_appointment", "escalate_to_human"];
          const isCoordinatorClinic = clinic.scheduling_mode === "coordinator_approval";
          let correctionAttempts = 0;

          // Detección de "promesa sin acción". La primera versión de este patrón
          // buscaba cualquier MENCIÓN de la coordinadora — y eso resultó tener 100%
          // de falsos positivos en producción (7 de 7 disparos, 3 tutores afectados
          // el 2026-09-03), porque la respuesta CORRECTA más frecuente del flujo
          // también la menciona: "Para poder enviar la solicitud a nuestra
          // coordinadora, necesito que me confirmes: 1. Tu nombre...". Peor: como
          // ese falso positivo pausaba al tutor (requires_human), dejaba la
          // conversación muda para siempre — el mutismo reportado por Claudia
          // (Guillermo Dodds/Flaca) lo causó exactamente esto.
          //
          // La señal real de promesa rota NO es mencionar a la coordinadora: es
          // AFIRMAR que la solicitud ya se envió o se está enviando ahora. Pedir los
          // datos que faltan es lo correcto y nunca debe dispararlo — por eso van
          // dos capas: verbo de acción consumada/inminente Y ausencia de petición
          // de datos.
          // Sin \b de cierre a propósito: en JavaScript \b se basa en [A-Za-z0-9_],
          // así que una frase terminada en vocal acentuada ("ya envié", "enviaré",
          // "ya le pasé") NUNCA hacía match con \b al final — verificado con un test
          // mecánico antes de desplegar. Los \b de apertura sí se conservan (todas
          // las frases empiezan con letra ASCII).
          const claimsDispatch = (t: string) =>
            /\b(he enviado|ya envi[éeó]|envi[éeó]|voy a enviar|enviar[ée]|estoy enviando|he pasado|ya (le )?pas[ée]|he compartido|voy a compartir|he derivado|voy a derivar)/i.test(t);
          // Acotado a peticiones de dato explícitas — a propósito NO incluye un "¿"
          // genérico: una pregunta de cortesía ("¿necesitas algo más?") no debe
          // silenciar la detección de una promesa realmente rota.
          const asksForData = (t: string) =>
            /necesito (que me |algunos |unos |los |el |tu )?(confirmes|indiques|entregues|datos|detalles|antecedentes|nombre|direcci[óo]n|saber)|me (puedes|podr[íi]as) (confirmar|indicar|decir|entregar|proporcionar)|podr[íi]as (confirmarme|indicarme|decirme|proporcionarme)|\n\s*\d[.)]\s|¿(c[óo]mo se llama|cu[áa]l es (tu|el) nombre|qu[ée] d[íi]as|en qu[ée] comuna)/i.test(t);
          const promisedWithoutAction = (t: string) => claimsDispatch(t) && !asksForData(t);

          // El modelo a veces anuncia "voy a enviar esto a la coordinadora" sin
          // haber llamado realmente al tool — promesa sin acción, confirmada real
          // en producción (Vanesa Torres/Cuki, Linares, 2026-09-02). La misma
          // prohibición ya existía en el prompt casi palabra por palabra y el
          // modelo la violó igual, así que reforzarlo solo en el prompt no bastaba
          // — esto FUERZA en código un reintento con corrección antes de aceptar
          // esa respuesta como final, en vez de solo detectarlo después de enviarla.
          const needsCoordinationCorrection = () =>
            isCoordinatorClinic && !!assistant?.content
            && !(assistant.tool_calls?.length > 0) && !assistant.function_call
            && promisedWithoutAction(assistant.content)
            && !allFuncResults.some(r => dispatchTools.includes(r.name))
            && correctionAttempts < 1;

          while (
            assistant && maxCalls > 0 &&
            (assistant.function_call || (assistant.tool_calls && assistant.tool_calls.length > 0) || needsCoordinationCorrection())
          ) {
            if (assistant.tool_calls?.length > 0 || assistant.function_call) {
              msgs.push({ ...assistant, role: "assistant" });
              if (assistant.tool_calls?.length > 0) {
                for (const toolCall of assistant.tool_calls) {
                  const fnName = toolCall.function.name;
                  const fnArgs = JSON.parse(toolCall.function.arguments);
                  const result = await processFunc(sb, clinic.id, from, fnName, fnArgs, clinicTz, clinic, msgs);
                  allFuncResults.push({ name: fnName, result });
                  msgs.push({ role: "tool", tool_call_id: toolCall.id, name: fnName, content: JSON.stringify(result) });
                }
              } else if (assistant.function_call) {
                const fnName = assistant.function_call.name;
                const fnArgs = JSON.parse(assistant.function_call.arguments);
                const result = await processFunc(sb, clinic.id, from, fnName, fnArgs, clinicTz, clinic, msgs);
                allFuncResults.push({ name: fnName, result });
                msgs.push({ role: "function", name: fnName, content: JSON.stringify(result) });
              }
            } else {
              // needsCoordinationCorrection() fue lo que nos trajo aquí: el
              // modelo respondió solo texto con la promesa rota. Se empuja su
              // propia respuesta + una corrección directa, y se fuerza un
              // reintento — el modelo puede llamar al tool si ya tiene todos
              // los datos, o preguntar por lo que falte, pero nunca repetir la
              // misma frase sin ejecutar nada.
              correctionAttempts++;
              msgs.push({ role: "assistant", content: assistant.content });
              msgs.push({
                role: "system",
                content: "Tu respuesta anterior dijo que ibas a enviar la información a la coordinadora o a coordinar la visita, pero no ejecutaste ninguna función — el tutor se habría quedado sin ninguna solicitud real. Si tienes TODOS los datos requeridos (nombre del tutor, mascota, especie/sexo, dirección, motivo, urgencia y disponibilidad amplia), llama AHORA MISMO a request_scheduling_coordination con esos datos exactos. Si te falta alguno, NO repitas esa frase: pregúntaselo directamente al tutor en tu respuesta.",
              });
              await debugLog(sb, "[COORDINATION PROMISE GAP] Forzando reintento con corrección", {
                phone: from, clinicId: clinic.id, originalReply: assistant.content,
              });
            }
            res = await callAI(targetModel, msgs, true);
            assistant = res.choices?.[0]?.message;
            maxCalls--;
          }

          // CAPI Purchase event
          if (ctwaClid && clinic.meta_pixel_id && clinic.meta_capi_token) {
            const apptResult = allFuncResults.find(r => r.name === "create_appointment" && r.result?.success === true);
            if (apptResult) {
              const capiResult = await sendMetaCAPIEvent(clinic.meta_pixel_id, clinic.meta_capi_token, "Purchase", from, ctwaClid, undefined, clinic.meta_test_event_code || undefined, clinic.meta_page_id || undefined);
              await debugLog(sb, `[META CAPI] Purchase(appointment) for ${from}`, capiResult);
            }
          }

          let reply = assistant?.content;
          if (!reply) {
            // Llamada exitosa a OpenAI (res.ok) pero sin content final — normalmente
            // porque el tool loop agotó las 5 iteraciones sin llegar a una respuesta
            // de texto. No pasa por el catch de abajo, así que sin este log quedaba
            // invisible: el cliente recibía un mensaje de error genérico y nadie se
            // enteraba (caso real: Santiago, 2026-08-25, gata con alergia sin foto
            // procesada, cliente sin respuesta y sin rastro en debug_logs).
            await debugLog(sb, "Meta AI empty content", {
              phone: from,
              hadPendingToolCalls: !!(assistant?.tool_calls?.length || assistant?.function_call),
              maxCallsExhausted: maxCalls <= 0,
              finishReason: res?.choices?.[0]?.finish_reason || null,
            });
            reply = "Lo siento, tuve un problema técnico procesando tu mensaje. Por favor intenta consultarme en unos minutos.";
          }

          // requires_human — punto de control 3 de 3: última barrera antes de enviar.
          // El tool loop de OpenAI puede tardar decenas de segundos; sin este chequeo,
          // un clic en "Silenciar IA" hecho mientras el modelo razonaba se ignoraría.
          // Excepción: si fue ESTA misma vuelta la que pausó al tutor al derivar a la
          // coordinadora, el aviso de "la coordinadora revisará la ruta" sí debe salir —
          // si no, el cliente entrega todos sus datos y queda en silencio absoluto.
          const pausedByThisTurn = allFuncResults.some(
            r => r.name === "request_scheduling_coordination" && r.result?.success === true,
          );
          if (!pausedByThisTurn && await isPausedForHuman(sb, clinic.id, from)) {
            console.log(`[Meta] requires_human=true for ${from}, discarding reply (pre-send)`);
            return;
          }

          await saveMsg(sb, clinic.id, from, reply, "outbound", {
            ai_generated: true,
            ai_function_called: allFuncResults.length > 0 ? allFuncResults.map(r => r.name).join(", ") : null,
            ai_function_result: allFuncResults.length > 0 ? allFuncResults : null,
          }, modelForTracking);

          await sendMetaMessage(clinic.meta_phone_number_id, clinic.meta_access_token, from, reply);
          await debugLog(sb, "Meta AI Response Sent", { to: from, msgId });

          // Última barrera: el loop de arriba ya fuerza un reintento con
          // corrección cuando detecta la promesa-sin-acción DURANTE la
          // conversación (correctionAttempts). Este chequeo es el respaldo
          // para el caso raro en que ni siquiera ese reintento lo corrigió —
          // va DESPUÉS de enviar la respuesta real (nunca antes: pausar aquí
          // arriba dejaría al tutor sin ninguna respuesta, peor que hoy).
          if (isCoordinatorClinic) {
            const actuallyDispatched = allFuncResults.some(r => dispatchTools.includes(r.name));
            if (promisedWithoutAction(reply) && !actuallyDispatched) {
              await debugLog(sb, "[COORDINATION PROMISE GAP] Persistió incluso después del reintento forzado", {
                phone: from, clinicId: clinic.id, reply, correctionAttempts,
              });
              // NO se pausa al tutor (requires_human). La versión anterior sí lo
              // hacía y el costo de un falso positivo era desproporcionado: la
              // conversación quedaba muda de forma permanente, sin que nadie la
              // reactivara (confirmado real, 3 tutores el 2026-09-03). Avisar es
              // suficiente — si el aviso resulta ser falso, no rompe nada.
              await sb.from("notifications").insert({
                clinic_id: clinic.id,
                type: "human_handoff",
                title: "⚠️ Revisar: posible solicitud de agenda no enviada",
                message: `La IA le dijo a +${from} que enviaría sus datos a la coordinadora, pero no se registró ninguna solicitud real. Revisa la conversación en Mensajes y coordina manualmente si corresponde.`,
                link: "/app/messages",
                is_read: false,
              });
            }
          }

        } catch (err) {
          console.error("Meta Async Process Error:", err);
          await debugLog(sb, "Meta Async Process Error", { error: (err as Error).message, phone: from });
          // No molestar con un aviso de error si la conversación ya fue tomada por un humano.
          if (await isPausedForHuman(sb, clinic.id, from)) return;
          // Insert DIRECTO (no vía saveMsg): el trigger on_manual_message_pause
          // pausa la IA para siempre ante cualquier outbound con
          // ai_generated=false/NULL (default de columna), pensado para cuando
          // Claudia responde a mano — pero CADA error técnico (rate limit de
          // OpenAI, timeout, etc.) generaba este mismo mensaje y lo dejaba
          // silenciado sin que nadie se enterara. Confirmado real: la mayoría de
          // los "MANUAL" en la auditoría del 2026-09-03 eran este mensaje, no
          // Claudia. ai_generated:true evita el trigger; el insert directo (en
          // vez de saveMsg) evita que se cobre un crédito IA por un mensaje que
          // nunca fue una respuesta real de OpenAI.
          const fallbackReply = "Lo siento, tuve un problema técnico procesando tu mensaje. Por favor intenta consultarme en unos minutos.";
          await sb.from("messages").insert({
            clinic_id: clinic.id, phone_number: from, content: fallbackReply,
            direction: "outbound", ai_generated: true, message_type: "text",
            payload: { error_fallback: true },
          });
          await sendMetaMessage(clinic.meta_phone_number_id, clinic.meta_access_token, from, fallbackReply)
            .catch(e => console.error("Failed sending Meta fallback:", e));
        }
      };

      // @ts-ignore
      if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
        // @ts-ignore
        EdgeRuntime.waitUntil(asyncProcess(immediateContext));
      } else {
        asyncProcess(immediateContext);
      }
     } catch (syncErr) {
       // Cualquier excepción síncrona previa a asyncProcess (tutorContext, CRM sync, CAPI, etc.)
       // tumbaba TODA la invocación sin dejar rastro — Meta reintentaba indefinidamente el mismo
       // mensaje (tormenta de 500s). Ahora se loguea y se sigue con el resto del payload.
       await debugLog(sb, "Meta Webhook Sync Error", {
         error: (syncErr as Error).message,
         stack: (syncErr as Error).stack,
       });
     }
    }
  }

  // Meta requiere 200 inmediato siempre
  return new Response("OK", { status: 200 });
});
