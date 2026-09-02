import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCreditStatus, notifyCreditsExhausted, creditCostForModel } from "../_shared/aiCredits.ts";

// Travel buffer in minutes added to Google Maps travel time between appointments
const TRAVEL_BUFFER_MINUTES = 15;

const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "https://ycloud.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-API-Key, YCloud-Signature",
};

interface YCloudPayload {
  id: string;
  type: string;
  createTime: string;
  whatsappInboundMessage?: {
    id: string;
    from: string;
    to: string;
    type: string;
    text?: { body: string };
    audio?: { id: string; link: string; mime_type: string };
    image?: { id: string; link: string; mime_type: string; caption?: string };
    interactive?: {
      type: string;
      button_reply?: { id: string; title: string };
      list_reply?: { id: string; title: string; description?: string };
    };
    referral?: {
      id: string;
      source_id: string;
      source_type: string;
      headline: string;
      body: string;
      media_type: string;
      thumbnail_url: string;
      video_url?: string;
      image_url?: string;
      source_url?: string;
      ctwa_clid?: string;
    };
    wamid?: string;
    context?: any;
    customerProfile?: { name: string };
  };
}

interface Msg {
  role: "system" | "user" | "assistant" | "function" | "tool";
  content: string | any[] | null;
  name?: string;
  function_call?: { name: string; arguments: string };
  tool_calls?: any[];
  tool_call_id?: string;
}

// ====== Helper: Download Media from YCloud ======
const downloadYCloudMedia = async (
  link: string,
  ycloudKey: string,
): Promise<Blob> => {
  const res = await fetch(link, {
    headers: { "X-API-Key": ycloudKey },
  });
  if (!res.ok) throw new Error(`Media fetch failed: ${await res.text()}`);
  return await res.blob();
};

// ====== Helper: Transcribe Audio using OpenAI Whisper ======
const transcribeAudioData = async (
  audioBlob: Blob,
  openAiKey: string,
): Promise<string> => {
  const formData = new FormData();
  formData.append("file", audioBlob, "audio.ogg");
  formData.append("model", "whisper-1");
  // Ensure text output
  formData.append("response_format", "text");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${openAiKey}` },
    body: formData,
  });
  if (!res.ok) throw new Error(`Transcription failed: ${await res.text()}`);
  return await res.text();
};

// ====== Helper: Send Meta Conversions API Event ======
const sendMetaCAPIEvent = async (
  pixelId: string,
  accessToken: string,
  eventName: string,
  phone: string,
  ctwaClid?: string,
  customData?: { value?: number; currency?: string; content_name?: string },
  testEventCode?: string,
  pageId?: string,
): Promise<{ status: number; body: unknown } | { error: string }> => {
  try {
    const normalized = phone.replace(/\D/g, "");
    const hashBuffer = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(normalized),
    );
    const hashedPhone = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const userData: Record<string, unknown> = { ph: [hashedPhone] };
    if (ctwaClid) userData.ctwa_clid = ctwaClid;
    if (pageId) userData.page_id = pageId;

    const payload: Record<string, unknown> = {
      data: [{
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        action_source: "business_messaging",
        messaging_channel: "whatsapp",
        event_id: `${eventName}_${normalized}_${Date.now()}`,
        user_data: userData,
        ...(customData ? { custom_data: customData } : {}),
      }],
    };
    if (testEventCode) payload.test_event_code = testEventCode;

    const res = await fetch(
      `https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${accessToken}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } catch (e) {
    return { error: (e as Error).message };
  }
};

// ====== Helper: Resolve Google Maps Short URL and Extract Coordinates ======
const resolveGoogleMapsUrl = async (
  url: string,
): Promise<{ lat: number; lng: number; finalUrl?: string } | null> => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s

    let currentUrl = url;
    let finalUrl = url;

    // Follow up to 5 redirects manually using HEAD first
    for (let i = 0; i < 5; i++) {
      const res = await fetch(currentUrl, {
        method: "HEAD",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });

      const nextUrl = res.headers.get("location");
      if (!nextUrl) {
        // If HEAD yields no location, try a GET before giving up
        const resGet = await fetch(currentUrl, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
        });
        const nextUrlGet = resGet.headers.get("location");
        if (!nextUrlGet) break;
        currentUrl = nextUrlGet;
      } else {
        currentUrl = nextUrl;
      }
      finalUrl = currentUrl;
    }

    const patterns = [
      /@(-?\d+\.\d+),(-?\d+\.\d+)/,
      /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
      /q=(-?\d+\.\d+),(-?\d+\.\d+)/,
      /ll=(-?\d+\.\d+),(-?\d+\.\d+)/,
    ];

    for (const regex of patterns) {
      const match = finalUrl.match(regex);
      if (match) {
        clearTimeout(timeoutId);
        return {
          lat: parseFloat(match[1]),
          lng: parseFloat(match[2]),
          finalUrl,
        };
      }
    }

    clearTimeout(timeoutId);
    return { lat: 0, lng: 0, finalUrl: finalUrl.substring(0, 60) };
  } catch (e: any) {
    return { lat: 0, lng: 0, finalUrl: `ERR:${e.message?.substring(0, 10)}` };
  }
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  "";
const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY") || "";

/**
 * Verify the HMAC-SHA256 signature that YCloud sends on every webhook.
 * The secret is fetched per-clinic from clinic_settings.ycloud_webhook_secret
 * (looked up by the `to` phone number before this is called).
 *
 * If the clinic has no secret configured, verification is skipped with a warning
 * so existing setups keep working while secrets are being rolled out.
 */
const verifyYCloudSignature = async (
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): Promise<boolean> => {
  if (!secret) {
    console.warn(
      "[SECURITY] No ycloud_webhook_secret configured for this clinic — skipping verification.",
    );
    return true;
  }
  if (!signatureHeader) {
    console.error("[SECURITY] YCloud-Signature header missing — rejecting request.");
    return false;
  }
  try {
    // Header format: "t={timestamp},s={signature}"
    // Signed payload: "{timestamp}.{rawBody}"
    const parts: Record<string, string> = {};
    for (const part of signatureHeader.split(",")) {
      const idx = part.indexOf("=");
      if (idx > 0) parts[part.substring(0, idx).trim()] = part.substring(idx + 1).trim();
    }
    const timestamp = parts["t"];
    const receivedSig = parts["s"];
    if (!timestamp || !receivedSig) {
      console.error("[SECURITY] Invalid YCloud-Signature format:", signatureHeader);
      return false;
    }

    const signedPayload = `${timestamp}.${rawBody}`;
    const encoder = new TextEncoder();
    // YCloud uses the full secret string as UTF-8 key (not base64-decoded)
    const secretBytes = encoder.encode(secret);
    const key = await crypto.subtle.importKey(
      "raw",
      secretBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload));
    const digest = Array.from(new Uint8Array(mac))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const valid = digest === receivedSig;
    if (!valid) {
      console.error(
        `[SECURITY] Signature mismatch. Expected ${digest}, got ${receivedSig}`,
      );
    }
    return valid;
  } catch (e) {
    console.error("[SECURITY] Signature verification threw:", e);
    return false;
  }
};

// ====== Helper: Geocode Address using Google Maps ======
const geocodeAddress = async (
  address: string,
): Promise<{ lat: number; lng: number } | null> => {
  if (!GOOGLE_MAPS_API_KEY) return null;
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${
      encodeURIComponent(address)
    }&key=${GOOGLE_MAPS_API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.status === "OK") {
      return data.results[0].geometry.location;
    }
    console.error("[Geocode] Error:", data.status);
    return null;
  } catch (e) {
    console.error("[Geocode] Exception:", e);
    return null;
  }
};

// Helper to get timezone offset (e.g. "-03:00")
const getOffset = (timeZone: string = "America/Santiago", date: Date) => {
  try {
    const str = date.toLocaleString("en-US", {
      timeZone,
      timeZoneName: "longOffset",
    });
    const match = str.match(/GMT([+-]\d{2}:\d{2})/);
    return match ? match[1] : "-03:00";
  } catch (e) {
    console.error("getOffset error", e);
    return "-03:00";
  }
};

// ====== Helper: Get Travel Duration and Distance between points ======
const getTravelDetails = async (
  origin: any,
  destination: any,
): Promise<{ duration: number; distance: number }> => {
  if (!GOOGLE_MAPS_API_KEY && !Deno.env.get("GOOGLE_MAPS_API_KEY")) return { duration: 0, distance: 0 };
  const apiKey = GOOGLE_MAPS_API_KEY || Deno.env.get("GOOGLE_MAPS_API_KEY");
  
  try {
    const originStr = typeof origin === 'string' ? origin : `${origin.lat},${origin.lng}`;
    const destStr = typeof destination === 'string' ? destination : `${destination.lat},${destination.lng}`;
    
    const url =
      `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${originStr}&destinations=${destStr}&key=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.status === "OK" && data.rows[0].elements[0].status === "OK") {
      return {
        duration: Math.ceil(data.rows[0].elements[0].duration.value / 60), // Convert to minutes
        distance: data.rows[0].elements[0].distance.value, // meters
      };
    }
    return { duration: 0, distance: 0 };
  } catch (e) {
    console.error("[DistanceMatrix] Exception:", e);
    return { duration: 0, distance: 0 };
  }
};

// =============================================
// OpenAI Function Definitions (Agent Tools)
// =============================================
const functions = [
  {
    name: "check_availability",
    description:
      "Verifica disponibilidad general (Vacunas, Consultas). PROHIBIDO usar para CIRUGÍAS, ESTERILIZACIONES o CASTRACIONES (Claudia coordina manualmente). Si la clínica es móvil/híbrida, es OBLIGATORIO solicitar primero el PIN GPS o Link Maps.",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "Fecha YYYY-MM-DD" },
        service_name: {
          type: "string",
          description: "Nombre del servicio inferido del contexto",
        },
        professional_name: {
          type: "string",
          description: "Nombre del profesional solicitado (opcional)",
        },
        address: {
          type: "string",
          description:
            "Dirección inferida del GPS/contexto para la validación interna de la zona.",
        },
      },
      required: ["date"],
    },
  },
  {
    name: "create_appointment",
    description:
      "Crea nueva cita. REQUERIDO: Formato YYYY-MM-DD y hora 24h (HH:MM). Para clínicas móviles, incluye la 'address' confirmada.",
    parameters: {
      type: "object",
      properties: {
        tutor_name: {
          type: "string",
          description:
            "Nombre REAL y completo del tutor/dueño, tal como él lo indicó en la conversación. NUNCA uses placeholders como '[Nombre del Tutor]', 'Cliente' o 'Tutor'. Si el cliente aún no ha dicho su nombre, NO llames esta función: pregúntale primero su nombre completo.",
        },
        patient_name: { type: "string", description: "Nombre de la mascota" },
        email: {
          type: "string",
          description:
            "Correo electrónico del tutor (opcional). Pídelo siempre al agendar, pero si el cliente no quiere darlo o no responde, agenda igual sin él — nunca es un requisito.",
        },
        date: { type: "string", description: "Fecha YYYY-MM-DD" },
        time: { type: "string", description: "Hora HH:MM (24h)" },
        service_name: { type: "string" },
        professional_name: {
          type: "string",
          description: "Nombre del profesional (opcional)",
        },
        address: {
          type: "string",
          description:
            "Dirección completa de atención (requerida para móviles)",
        },
        notes: {
          type: "string",
          description:
            "Breve resumen del motivo de la visita o síntomas (triaje)",
        },
      },
      required: [
        "tutor_name",
        "patient_name",
        "date",
        "time",
        "service_name",
        "address",
        "notes",
      ],
    },
  },
  {
    name: "get_services",
    description:
      "Obtén la lista de servicios médicos, sus precios y duraciones para informar al cliente.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "confirm_appointment",
    description: "Confirma o cancela cita pendiente",
    parameters: {
      type: "object",
      properties: { response: { type: "string", enum: ["yes", "no"] } },
      required: ["response"],
    },
  },
  {
    name: "get_knowledge",
    description:
      "Busca información detallada en la base de conocimiento (precios, tratamientos, cuidados, valores, promociones). ÚSALO SIEMPRE ante preguntas sobre costos o temas específicos que no estén en tu configuración básica.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Palabras clave simplificadas para la búsqueda (ej: 'precios', 'labios', 'cuidados', 'promocion')",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "escalate_to_human",
    description:
      "ÚSALA si el paciente pide hablar con una persona, si te hace una pregunta que no puedes responder con seguridad, si tiene una urgencia médica o si detectas frustración. Esta función notificará al equipo y desactivará tus respuestas automáticas para este chat.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "reschedule_appointment",
    description:
      "Reagenda una cita existente del paciente a una nueva fecha y hora. Úsala cuando el paciente quiera cambiar la fecha/hora de su cita. Primero verifica disponibilidad con check_availability, luego usa esta función para mover la cita.",
    parameters: {
      type: "object",
      properties: {
        new_date: { type: "string", description: "Nueva fecha YYYY-MM-DD" },
        new_time: { type: "string", description: "Nueva hora HH:MM (24h)" },
      },
      required: ["new_date", "new_time"],
    },
  },
  {
    name: "tag_patient",
    description:
      "Asigna una etiqueta al paciente para segmentación y marketing médico. ÚSALA PROACTIVAMENTE cuando: (1) El paciente muestra interés en un servicio específico → etiqueta 'Interés [Servicio]' (ej: 'Interés Cirugía'). (2) Se agenda una cita → etiqueta 'Cliente [Servicio]'. (3) Detectas condiciones o comportamientos → ej: 'Agresivo', 'Mascota Senior', 'Rescatado', 'Alérgico'. (4) Es la primera vez → 'Primera Vez'. Puedes llamar esta función múltiples veces. La etiqueta se crea automáticamente si no existe.",
    parameters: {
      type: "object",
      properties: {
        tag_name: {
          type: "string",
          description:
            "Nombre de la etiqueta. Ej: 'Interés Vacunación', 'Agresivo', 'Mascota Senior', 'Primera Vez', 'Control Sano'",
        },
        tag_color: {
          type: "string",
          description:
            "Color hex. Sugerencias: #10B981 (verde/positivo), #3B82F6 (azul/interés), #F59E0B (amarillo/cuidado), #EF4444 (rojo/médico-alerta), #8B5CF6 (morado/VIP). Opcional, default azul.",
        },
      },
      required: ["tag_name"],
    },
  },
];

// =============================================
// Supabase & Helper Functions
// =============================================
const getSupabase = () =>
  createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

const HQ_ID = "00000000-0000-0000-0000-000000000000";
// Clinics with bespoke routing logic hard-coded here.
// TODO: move these checks to clinic_settings.logistics_config.routing_mode
const CLINIC_ANIMALGRACE_ID = "fd11b7e4-7d96-461c-a292-2caa5e2592ce";
const CLINIC_SANTIAGO_ID = "13472ea4-4da6-461c-9a80-a5c970d9ec73";

const surgeryPrompt = `
[NORMATIVA NUCLEAR - BLACKOUT QUIRÚRGICO]:
1. ESTE SERVICIO TIENE LA AGENDA BLOQUEADA PARA TI.
2. TIENES PROHIBIDO decir que vas a "verificar disponibilidad" o "ver cupos".
3. TIENES PROHIBIDO dar horarios, aunque creas verlos.
4. Una vez validada la ubicación y aceptado el precio, debes pedir: Nombre del tutor, Nombre mascota, Dirección exacta y QUÉ DÍA DE LA SEMANA PREFIERE.
5. DEBES informar: (a) Recomendación de exámenes pre-operatorios. (b) Recargo de $20.000 si está en celo o preñez.
6. DEBES explicar que "Claudia (nuestra encargada de logística) te contactará personalmente para coordinar el día y la hora de la cirugía".
7. Cierra la conversación ahí. No intentes usar herramientas de agenda.`;

// Debug Logger
const debugLog = async (
  sb: ReturnType<typeof createClient>,
  msg: string,
  payload: any,
) => {
  try {
    await sb.from("debug_logs").insert({ message: msg, payload });
  } catch (e) {
    console.error("Debug log failed:", e);
  }
};

/**
 * Normalizes phone numbers for consistent DB lookups and API calls.
 * Removes '+' and leading zeros, keeping only digits.
 */
const normalizePhone = (phone: string): string => {
  if (!phone) return "";
  return phone.replace(/\D/g, "");
};

// ── ¿La conversación está pausada (tomada por un humano)? ──
// Debe re-consultarse en CADA punto de control, no una sola vez al recibir el mensaje:
// entre que llega el mensaje y se envía la respuesta pasan ~25-70s (debounce de 20s +
// tool loop de OpenAI). Si sólo se chequea al inicio, un clic en "Silenciar IA" hecho
// dentro de esa ventana se ignora y la IA responde igual.
// Falla ABIERTO a propósito: si la query falla no bloqueamos al agente.
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
    console.error("[isPausedForHuman] check failed:", e);
    return false;
  }
};

const getClinic = async (
  sb: ReturnType<typeof createClient>,
  phone: string,
) => {
  console.log(`[getClinic] Looking up clinic for phone: ${phone}`);
  const normalized = normalizePhone(phone);
  // Try matching exact, or with +, or without +
  const { data, error } = await sb.from("clinic_settings")
    .select("*")
    .or(
      `ycloud_phone_number.eq.${phone},ycloud_phone_number.eq.+${normalized},ycloud_phone_number.eq.${normalized}`,
    )
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(`[getClinic] Error looking up clinic:`, error);
    throw new Error(error.message);
  }
  if (!data) {
    console.warn(
      `[getClinic] No clinic found for phone: ${phone} (normalized: ${normalized})`,
    );
  } else {
    console.log(`[getClinic] Found clinic: ${data.id} (${data.clinic_name})`);
  }
  return data;
};

const getHistory = async (
  sb: ReturnType<typeof createClient>,
  clinicId: string,
  phone: string,
) => {
  const { data } = await sb.from("messages").select("direction, content").eq(
    "clinic_id",
    clinicId,
  ).eq("phone_number", phone).order("created_at", { ascending: false }).limit(
    15,
  );
  return data?.reverse() || [];
};

const isValidUUID = (uuid: string) => {
  const regex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return regex.test(uuid);
};

const saveMsg = async (
  sb: ReturnType<typeof createClient>,
  clinicId: string,
  phone: string,
  content: string,
  direction: string,
  extra = {},
  aiModel?: string,
) => {
  // Prevent crash if campaign_id is not a valid UUID (e.g. numeric Meta Ad ID)
  const extraCopy = { ...extra } as any;

  // Convert models to tracking labels: 'mini', '4o_standard', '4o_pro'
  const simplifiedModel = aiModel === "gpt-4o-mini" || aiModel === "mini" || aiModel?.includes("mini")
    ? "mini"
    : (aiModel === "gpt-4o" || aiModel === "4o" || (aiModel?.includes("gpt-4o") && !aiModel?.includes("mini")) ? "4o" : (["4o_standard", "4o_pro"].includes(aiModel!) ? aiModel : null));
  if (extraCopy.campaign_id && !isValidUUID(extraCopy.campaign_id)) {
    console.warn(
      `[saveMsg] Invalid UUID for campaign_id: ${extraCopy.campaign_id}. Setting to null.`,
    );
    delete extraCopy.campaign_id;
  }

  try {
    // Define standard columns that exist directly in the table
    const standardColumns = [
      "clinic_id",
      "phone_number",
      "content",
      "direction",
      "ai_generated",
      "ai_function_called",
      "ai_function_result",
      "ycloud_message_id",
      "message_type",
      "campaign_id",
      "ai_model",
      "customer_id",
      "status",
      "is_archived",
      "topic",
      "extension",
      "event",
      "private",
    ];

    const payload: Record<string, any> = {};
    const filteredExtra: Record<string, any> = {};

    for (const key in extraCopy) {
      if (standardColumns.includes(key)) {
        filteredExtra[key] = extraCopy[key];
      } else {
        payload[key] = extraCopy[key];
      }
    }

    const insertPayload: any = {
      clinic_id: clinicId,
      phone_number: phone,
      content,
      direction,
      payload,
      ...filteredExtra,
    };

    if (simplifiedModel) {
      insertPayload.ai_model = simplifiedModel;
    }

    const { data, error } = await sb.from("messages").insert(insertPayload)
      .select("id").single();
    if (error) {
      // Check if error is due to missing column (e.g. 'payload')
      if (
        error.message.includes("Could not find") &&
        error.message.includes("column")
      ) {
        console.warn(
          `[saveMsg] Missing column detected. Retrying without extra fields. Error: ${error.message}`,
        );
        // Retry without any extra fields that might be causing the issue
        const { data: retryData, error: retryError } = await sb.from("messages")
          .insert({
            clinic_id: clinicId,
            phone_number: phone,
            content,
            direction,
          }).select("id").single();
        if (retryError) throw new Error(retryError.message);
        return retryData.id;
      }
      throw new Error(error.message);
    }
    console.log(`[saveMsg] Saved message (dir: ${direction}) id: ${data.id}`);

    // --- INCREMENT CONSUMPTION COUNTERS IN CLINIC_SETTINGS ---
    if (direction === "outbound" && insertPayload.ai_generated) {
      try {
        const model = insertPayload.ai_model;
        // Medir y cobrar usan la MISMA constante (ver _shared/aiCredits.ts):
        // antes se cobraba ×15 pero se medía ×8, así que el chequeo de cuota
        // creía que se había gastado la mitad de lo real.
        const creditCost = creditCostForModel(model);
        const credits = await getCreditStatus(sb, clinicId);
        const creditPoolId = credits.poolId;

        // Increment counters
        if (model === "mini") {
          await sb.rpc('increment_clinic_mini_usage', { p_clinic_id: clinicId });
        } else if (["4o", "4o_standard", "4o_pro"].includes(model)) {
          await sb.rpc('increment_clinic_4o_usage', { p_clinic_id: clinicId });
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

        // Register consumption transaction
        await sb.from("ai_credit_transactions").insert({
          clinic_id: creditPoolId,
          type: 'consumption',
          amount: -creditCost,
          balance_after: balanceAfter,
          description: `Consumo IA: ${model}${creditPoolId !== clinicId ? ` (sucursal)` : ''}`,
          metadata: { model, source_clinic_id: clinicId }
        });
      } catch (countErr) {
        console.warn("[saveMsg] Failed to increment usage counters:", countErr);
      }
    }

    return data.id;
  } catch (e) {
    console.error(`[saveMsg] Severe failure:`, e);
    throw e;
  }
};

// =============================================
// Helper: Service Matching & Summation
// =============================================
const getServiceDetails = async (
  sb: any,
  clinicId: string,
  serviceName: string,
) => {
  if (!serviceName) {
    return { name: "Consulta", duration: 60, price: 0, service_ids: [] };
  }

  // Split combined services (e.g. "Consulta y Vacuna" or "Consulta + Vacuna")
  const names = serviceName.split(/ y | \+ | y\/o |,/i).map((s) => s.trim())
    .filter((s) => s.length > 2);

  let totalDuration = 0;
  let totalPrice = 0;
  let matchedNames: string[] = [];
  let serviceIds: string[] = [];

  const { data: allServices } = await sb.from("clinic_services").select("*").eq(
    "clinic_id",
    clinicId,
  );

  if (!allServices || allServices.length === 0) {
    return { name: serviceName, duration: 60, price: 0, service_ids: [] };
  }

  for (const name of names) {
    // 1. Try partial match: does DB name include query?
    let found = allServices.find((s) =>
      s.name.toLowerCase().includes(name.toLowerCase())
    );

    // 2. Try reverse partial match: does query include DB name?
    if (!found) {
      found = allServices.find((s) =>
        name.toLowerCase().includes(s.name.toLowerCase())
      );
    }

    // 3. Try matching by significant words (fuzzy fallback)
    if (!found && name.includes(" ")) {
      const words = name.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      for (const word of words) {
        found = allServices.find((s) => s.name.toLowerCase().includes(word));
        if (found) break;
      }
    }

    if (found) {
      totalDuration += found.duration || 30;
      totalPrice += found.price || 0;
      matchedNames.push(found.name);
      serviceIds.push(found.id);
    } else {
      // Smart fallback duration based on service type keyword
      const nameLower = name.toLowerCase();
      let fallbackDuration = 30;
      if (nameLower.includes("destartraje") || nameLower.includes("dental") || nameLower.includes("limpieza")) {
        fallbackDuration = 120; // Dental procedures are always long
      } else if (nameLower.includes("cirugía") || nameLower.includes("cirugia") || nameLower.includes("castración") || nameLower.includes("esterilización")) {
        fallbackDuration = 60;
      } else if (nameLower.includes("consulta") || nameLower.includes("control") || nameLower.includes("evaluación")) {
        fallbackDuration = 60;
      }
      totalDuration += fallbackDuration;
      matchedNames.push(name);
    }
  }

  // Pass 2: Handle Vaccination + Consultation price bundle ($0 consultation)
  // This should be handled by the AI based on its prompt rules.
  // We keep the totalPrice as calculated from the database services.

  // Ensure we don't return 0 duration
  if (totalDuration === 0) totalDuration = 60;

  return {
    name: matchedNames.length > 0 ? matchedNames.join(" + ") : serviceName,
    duration: totalDuration,
  price: totalPrice,
    service_ids: serviceIds,
    is_multiple: names.length > 1,
  };
};
// Helper to calculate Haversine distance (straight line) across multiple potential bases
const calculateHaversine = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371; // Earth radius in KM
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// =============================================
// Tool Implementations
// =============================================
const checkAvail = async (
  sb: ReturnType<typeof createClient>,
  clinicId: string,
  phone: string,
  date: string,
  serviceName?: string,
  timezone: string = "America/Santiago",
  profName?: string,
  clinicWorkingHours?: any,
  address?: string,
  logisticsConfig?: any,
) => {
  // No hardcoded blocks

  // 1. Validate date format (must be YYYY-MM-DD to prevent Postgres RPC from crashing)
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(String(date).trim())) {
    console.warn(
      `[checkAvail] Invalid date format received from AI: '${date}'`,
    );
    return {
      available: false,
      reason: "invalid_date_format",
      message:
        `CRÍTICO: El formato de fecha '${date}' es inválido. DEBES usar exactamente YYYY-MM-DD (ej: 2026-04-20). Autocorrígete llamando a la función de nuevo con el formato correcto.`,
    };
  }

  // CRM stage update removed (handled by direct clinical flow)

  // 2. If address provided, geocode and save it
  let tutorCoords: { lat: number; lng: number } | null = null;
  if (address) {
    const normalizedPhone = normalizePhone(phone).trim();
    tutorCoords = await geocodeAddress(address);

    // Fallback: If geocoding the string fails (e.g. "📍 Ubicación compartida"), look up persisted coordinates
    if (!tutorCoords || (tutorCoords.lat === 0 && tutorCoords.lng === 0)) {
      const { data: tutor } = await sb.from("tutors").select(
        "latitude, longitude",
      ).eq("clinic_id", clinicId).eq("phone_number", normalizedPhone)
        .maybeSingle();
      if (tutor?.latitude && tutor?.longitude) {
        tutorCoords = {
          lat: Number(tutor.latitude),
          lng: Number(tutor.longitude),
        };
        console.log(
          `[checkAvail] Using persisted coordinates from DB: ${tutorCoords.lat}, ${tutorCoords.lng}`,
        );
      }
    }

    const updates: any = { address: address };
    if (tutorCoords && tutorCoords.lat !== 0) {
      updates.latitude = tutorCoords.lat;
      updates.longitude = tutorCoords.lng;
      await sb.from("tutors").update(updates).eq(
        "clinic_id",
        String(clinicId).trim(),
      ).eq("phone_number", normalizedPhone);
      await sb.from("crm_prospects").update(updates).eq(
        "clinic_id",
        String(clinicId).trim(),
      ).eq("phone", normalizedPhone);
    }
  }

  // Horizonte del plan de ruta: el día consultado + 21 días, para poder decirle al
  // cliente cuándo SÍ se atiende su sector si el día pedido está restringido.
  const planHorizon = new Date(`${date}T12:00:00Z`);
  planHorizon.setUTCDate(planHorizon.getUTCDate() + 21);
  const planHorizonEnd = planHorizon.toISOString().slice(0, 10);

  // Paralelizar: clinic_settings + serviceDetails + existingAppts + routePlan son independientes
  const [{ data: clinic, error: errClinic }, serviceDetails, { data: existingAppts, error: errAppts }, { data: routePlanRows, error: errRoutePlan }] = await Promise.all([
    sb.from("clinic_settings").select("business_model, latitude, longitude, logistics_config").eq("id", clinicId).single(),
    getServiceDetails(sb, clinicId, serviceName || ""),
    sb.from("appointments")
      .select("id, appointment_date, duration_minutes, duration, professional_id, latitude, longitude, address")
      .eq("clinic_id", clinicId)
      .neq("status", "cancelled"),
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

  // CRÍTICO: si clinic no carga, toda la lógica de sectores (isAnimalGrace,
  // anti-rebote, buffer 60min, filtro Talca 11:30) queda silenciosamente
  // desactivada. Loguear explícitamente para no repetir el bug de la columna
  // inexistente `is_mobile_vet` (regresión 2026-05-28 → 2026-06-24).
  if (errClinic || !clinic) {
    console.error(`[checkAvail] FALLO al cargar clinic_settings — lógica de sectores DESACTIVADA. Error:`, errClinic);
    await debugLog(sb, "checkAvail clinic load FAILED", { clinicId, error: errClinic?.message ?? "clinic null" });
  }

  const isMobile = clinic?.business_model !== "physical";

  // Use the provided config, or the one from the DB, or a default
  const finalLogistics = logisticsConfig || clinic?.logistics_config || {};

  // SUPPORT MULTIPLE LOCATIONS: Find the nearest base if multiple exist
  let clinicBase = null;
  if (tutorCoords) {
    const lowerService = serviceName?.toLowerCase() || "";
    // Detect if this is a surgery request
    const isSurgery = lowerService.includes("cirug") ||
                     lowerService.includes("esterili") ||
                     lowerService.includes("castra");

    if (finalLogistics.locations && finalLogistics.locations.length > 0) {
      let minDistance = Infinity;
      let nearestLoc = null;

      // Filter locations based on service type
      const relevantLocations = finalLogistics.locations.filter((l: any) =>
        isSurgery ? l.type === 'surgical_hub' : l.type === 'operational'
      );

      // If no locations of that type exist, fallback to all locations
      const locsToSearch = relevantLocations.length > 0 ? relevantLocations : finalLogistics.locations;

      for (const loc of locsToSearch) {
        const d = calculateHaversine(tutorCoords.lat, tutorCoords.lng, loc.lat, loc.lng);
        if (d < minDistance) {
          minDistance = d;
          nearestLoc = loc;
        }
      }

      if (nearestLoc) {
        clinicBase = { ...nearestLoc };
        console.log(`[checkAvail] Nearest ${isSurgery ? 'Hub' : 'Base'} found: ${nearestLoc.name} (${minDistance.toFixed(2)}km away)`);
      }
    } else {
      // Legacy fallback
      clinicBase = finalLogistics.base_coordinates || (clinic?.latitude && clinic?.longitude
        ? { lat: Number(clinic.latitude), lng: Number(clinic.longitude) }
        : null);
      if (clinicBase) {
        clinicBase = { ...clinicBase, name: clinicBase.name || "Clinic Base" };
      }
    }
  }
  const duration = serviceDetails.duration;
  const serviceId = serviceDetails.service_ids[0] || null;
  let professionalId: string | null = null;

  // Try to find requested professional BY NAME/TITLE
  if (profName) {
    const { data: prof } = await sb.from("clinic_members")
      .select("id")
      .eq("clinic_id", clinicId)
      .or(
        `first_name.ilike.%${profName}%,last_name.ilike.%${profName}%,job_title.ilike.%${profName}%`,
      )
      .limit(1)
      .maybeSingle();

    if (prof) {
      professionalId = prof.id;
    }
  }

  // Fallback to service professional if NO specific professional was requested or found
  if (!professionalId && serviceId) {
    const { data: profs } = await sb.from("service_professionals")
      .select("member_id, is_primary")
      .eq("service_id", serviceId);

    if (profs && profs.length > 0) {
      const primary = profs.find((p: { is_primary: boolean }) => p.is_primary);
      professionalId = primary ? primary.member_id : profs[0].member_id;
    }
  }

  // LAST-RESORT FALLBACK: If still no professional found (e.g. solo admin/owner clinic),
  // pick the first active non-receptionist member (admin, owner, vet_assistant all count)
  if (!professionalId) {
    const { data: anyMember } = await sb.from("clinic_members")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("status", "active")
      .not("role", "eq", "receptionist")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (anyMember) {
      professionalId = anyMember.id;
      console.log(`[checkAvail] Using last-resort fallback member: ${professionalId}`);
    }
  }

  console.log(
    `[checkAvail] Service: '${serviceName}' (ID: ${serviceId}), Duration: ${duration}min, Professional: ${
      professionalId || "Global"
    }`,
  );
  await debugLog(sb, "Check Avail Params", {
    clinicId,
    date,
    serviceName,
    professionalId,
    duration,
  });

  let slots: { slot_time: string; is_available: boolean }[] = [];

  // Strategy: Try professional-specific slots first if we have a professional
  // Use a fixed 30-min interval to provide more starting options even for long services
  const searchInterval = 30;

  // --- HARD BLOCK FOR SURGERIES ---
  const lowerService = String(serviceName || "").toLowerCase();
  if (
    lowerService.includes("ciru") || lowerService.includes("esteri") ||
    lowerService.includes("castra") || lowerService.includes("pabell")
  ) {
    return {
      error:
        "SISTEMA: Tienes PROHIBIDO usar esta herramienta para cirugías. Debes informar que Claudia (logística) coordina manualmente y usar 'escalate_to_human' de inmediato.",
    };
  }

  // --- ÚLTIMO HORARIO DEL DÍA ---
  // El último slot ofrecido es el tope (18:00 por defecto) aunque el servicio
  // termine pasado el horario de cierre. Solo aplica a servicios normales: las
  // cirugías ya quedaron bloqueadas en el hard block de arriba, así que todo lo
  // que llega hasta acá es agenda regular.
  // Configurable por clínica vía logistics_config.last_slot_time, sin deploy.
  // Se valida el formato: logistics_config es editable desde el dashboard y un
  // valor inválido haría fallar el cast a TIME del RPC, dejando a la clínica sin
  // agendamiento ("problema técnico"). Ante un valor malo se cae al default.
  const rawSlotCap = (clinic?.logistics_config as any)?.last_slot_time;
  const lastSlotCap = typeof rawSlotCap === "string" &&
      /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(rawSlotCap.trim())
    ? rawSlotCap.trim()
    : "18:00";

  if (professionalId) {
    try {
      const { data, error } = await sb.rpc("get_professional_available_slots", {
        p_clinic_id: String(clinicId).trim(),
        p_member_id: String(professionalId).trim(),
        p_date: String(date).trim(),
        p_duration: duration,
        p_interval: searchInterval,
        p_timezone: String(timezone).trim(),
        p_last_slot_cap: lastSlotCap,
      });

      if (!error && data) {
        slots = data;
      } else {
        console.warn(
          "[checkAvail] Professional slot check failed/empty, falling back to global:",
          error,
        );
      }
    } catch (e) {
      console.error("[checkAvail] RPC error:", e);
    }
  }

  if (slots.length === 0) {
    console.log(
      `[checkAvail] No slots found for professional ${professionalId}, trying global clinic slots...`,
    );
    const { data, error } = await sb.rpc("get_available_slots", {
      p_clinic_id: String(clinicId).trim(),
      p_date: String(date).trim(),
      p_duration: duration,
      p_interval: searchInterval,
      p_timezone: String(timezone).trim(),
      p_last_slot_cap: lastSlotCap,
    });
    if (error) {
      console.error(
        "[checkAvail] get_available_slots failed (Final Fallback):",
        error,
      );
      // One last attempt with minimal params just in case of signature mismatch
      const { data: data2 } = await sb.rpc("get_available_slots", {
        p_clinic_id: String(clinicId),
        p_date: String(date),
        p_duration: duration,
      });
      slots = data2 || [];
    } else {
      slots = data || [];
    }
  }

  // Filter available slots
  let filteredSlots = slots.filter((s: { is_available: boolean }) =>
    s.is_available
  );

  // Filter slots in the past if targeted date is TODAY
  const now = new Date();
  const localDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  // Get current local time in minutes for comparison
  const timeParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const currentH = parseInt(
    timeParts.find((p) => p.type === "hour")?.value || "0",
  );
  const currentM = parseInt(
    timeParts.find((p) => p.type === "minute")?.value || "0",
  );
  const nowLocalMinutes = currentH * 60 + currentM;

  // Configurable desde DB — no requiere comparar UUID hardcodeado
  const isAnimalGrace = (clinic?.logistics_config as any)?.routing_mode === 'mobile_sectors';

  if (date === localDate) {
    // Determine buffer based on address/zone
    const addressLower = (address || "").toLowerCase();

    let bufferMinutes = 60; // Default

    // Default buffer logic
    if (date === localDate) {
      bufferMinutes = 120; // 2 hour buffer for same-day
    }

    const cutoffMinutes = nowLocalMinutes + bufferMinutes;

    filteredSlots = filteredSlots.filter((s: any) => {
      const [h, m] = s.slot_time.split(":").map(Number);
      const slotMinutes = h * 60 + m;
      return slotMinutes >= cutoffMinutes;
    });

    console.log(
      `[checkAvail] Today detected. LocalTime: ${currentH}:${currentM}. Buffer: ${bufferMinutes}m. Filtered same-day slots. Remaining: ${filteredSlots.length}`,
    );
  }

  // --- SAFETY NET: Manual Booked Slots Filter ---
  // existingAppts ya fue cargado en paralelo al inicio de checkAvail
  if (errAppts) console.error("[checkAvail] Error fetching existing appts:", errAppts);

  const blockedSlots: string[] = [];
  
  (existingAppts || []).forEach((a: any) => {
    // Check if the professional matches (or if this is a global slot check)
    if (professionalId && a.professional_id && a.professional_id !== professionalId) return;

    if (!a.appointment_date) return;
    
    // Get local date string for the appointment
    const _d = new Date(a.appointment_date);
    const localDateStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(_d);

    if (localDateStr === date) {
      // Extract local hour/minute
      const timeParts = new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).formatToParts(_d);
      const h = parseInt(timeParts.find((p) => p.type === "hour")?.value || "0");
      const m = parseInt(timeParts.find((p) => p.type === "minute")?.value || "0");
      
      const apptMinutes = h * 60 + m;
      const apptDuration = a.duration_minutes || 60; // default 1 hour if not specified
      
      // Block all slots that overlap with [apptMinutes, apptMinutes + apptDuration)
      for (let s = 0; s < filteredSlots.length; s++) {
        const [sh, sm] = filteredSlots[s].slot_time.split(":").map(Number);
        const slotMin = sh * 60 + sm;
        // If the slot starts during the appointment
        if (slotMin >= apptMinutes && slotMin < apptMinutes + apptDuration) {
           blockedSlots.push(filteredSlots[s].slot_time);
        }
        // If the appointment starts during the slot
        if (apptMinutes > slotMin && apptMinutes < slotMin + duration) {
           blockedSlots.push(filteredSlots[s].slot_time);
        }
      }
    }
  });

  if (blockedSlots.length > 0) {
    console.log(`[checkAvail] Found overlapping real appointments, filtering out: ${blockedSlots.join(', ')}`);
    filteredSlots = filteredSlots.filter((s: { slot_time: string }) =>
      !blockedSlots.includes(s.slot_time)
    );
  }

  // Fetch day summary for better routing logic (do it based on local date string now that we have memory logic)
  const dayApptsSummary = (existingAppts || []).filter((a: any) => {
    if (!a.appointment_date) return false;
    const localDateStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric", month: "2-digit", day: "2-digit"
    }).format(new Date(a.appointment_date));
    return localDateStr === date;
  });

  const activeZones = [
    ...new Set((dayApptsSummary || []).map((a: any) => {
      const addrRows = (a.address || "").split(",");
      return addrRows[addrRows.length - 1]?.trim() || "Local";
    })),
  ];

  const dayContext = activeZones.length > 0
    ? `Ruta existente el ${date} en zonas: ${activeZones.join(", ")}.`
    : "Sin rutas previas para este día.";

  let routingAdvice = "";
  if (activeZones.length > 0) {
    routingAdvice = "ℹ️ Nota: Ya existen rutas coordinadas para este día. Intenta agrupar la cita en horarios cercanos a las zonas mencionadas.";
  }

  let recommendedSlot = "";

  // 6. IF MOBILE CLINIC: Filter slots based on Travel Time (Travel Block)
  if (isMobile && tutorCoords && filteredSlots.length > 0) {
    // Derivar allDayAppts de existingAppts ya cargado en memoria (sin query adicional)
    const allDayAppts = (existingAppts || [])
      .filter((a: any) => {
        if (!a.appointment_date) return false;
        const localDateStr = new Intl.DateTimeFormat("en-CA", {
          timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
        }).format(new Date(a.appointment_date));
        return localDateStr === date;
      })
      .sort((a: any, b: any) => new Date(a.appointment_date).getTime() - new Date(b.appointment_date).getTime());

    // --- ANIMALGRACE SECTOR HELPER (única fuente de verdad de sectorización) ---
    // Clasifica una dirección/cita en sector "Linares" o "Talca". Las comunas de
    // Linares se evalúan PRIMERO, de modo que una dirección como "..., Linares, Maule"
    // (donde "Maule" es la REGIÓN, no la comuna del sector Talca) resuelva a Linares.
    const getSectorAG = (addr: string | null, lat: number | null): "Linares" | "Talca" | null => {
      const norm = (addr || "").toLowerCase();
      const linaresCommunes = ["linares", "colbun", "colbún", "longavi", "longaví", "parral", "retiro", "san javier", "villa alegre", "yerbas buenas"];
      const talcaCommunes = ["talca", "constitucion", "constitución", "curepto", "empedrado", "maule", "pelarco", "pencahue", "rio claro", "río claro", "san clemente", "san rafael"];
      if (linaresCommunes.some(k => norm.includes(k))) return "Linares";
      if (talcaCommunes.some(k => norm.includes(k))) return "Talca";
      // Fallback por latitud: San Javier (-35.59) vs Maule (-35.51)
      if (lat !== null) return lat <= -35.55 ? "Linares" : "Talca";
      if (!addr || addr.trim() === "") return "Linares"; // vacío/Bloqueo → base Linares
      return null;
    };

    // --- ANIMALGRACE LOGISTICS ENHANCEMENTS ---
    if (isAnimalGrace) {
      const linaresCount = allDayAppts?.filter(a => getSectorAG(a.address, a.latitude) === "Linares").length || 0;
      const targetSector = getSectorAG(address, tutorCoords.lat);

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
        console.log(`[AnimalGrace] Capacity reached for LINARES (${linaresCount}/5). Blocking TALCA.`);
        return {
          available: false,
          reason: "daily_capacity_reached",
          message: `SISTEMA: Para el día ${date}, la agenda de Linares ya tiene ${linaresCount} cupos (límite 5). Por logística, con 5 citas en Linares NO se realizan traslados a Talca para proteger la ruta. Linares sigue disponible si hay huecos.`
        };
      }
    }

    // Enrich appointments with virtual coordinates if GPS is missing for routing
    const dayAppts = (allDayAppts || []).map(a => {
      if (a.latitude !== null) return a;
      const norm = (a.address || "").toLowerCase();
      
      // SANTIAGO RM: Commune detection from text address (configurable via logistics_config)
      if ((clinic?.logistics_config as any)?.routing_zone === 'rm_santiago') {
        const rmCommunes = ["santiago", "ñuñoa", "providencia", "las condes", "vitacura", "maipu", "maipú", "puente alto", "la florida", "san miguel", "la cisterna", "la reina", "peñalolen", "peñalolén", "quilicura", "pudahuel", "macul", "san joaquin", "san joaquín", "estacion central", "estación central", "recoleta", "independencia", "conchali", "conchalí", "huechuraba", "lo prado", "cerro navia", "renca"];
        if (rmCommunes.some(c => norm.includes(c))) {
          return { ...a, latitude: -33.4975, longitude: -70.6558 }; // Fallback to San Miguel for routing
        }
        // No address or unrecognized commune → assign base coordinates (San Miguel)
        return { ...a, latitude: -33.4975, longitude: -70.6558 };
      }

      // LINARES/TALCA BRANCH: sectoriza con el helper compartido (comunas Linares
      // primero), evitando que el sufijo de región "..., Maule" clasifique mal una
      // dirección de Linares como Talca.
      if (getSectorAG(a.address, a.latitude) === "Talca") {
        return { ...a, latitude: -35.4264, longitude: -71.6554 }; // Talca Center
      }
      // Linares / no reconocido / vacío (Bloqueos) → base Linares (bloquea tiempo en base).
      return { ...a, latitude: -35.8467, longitude: -71.5936 }; // Linares Center/Base
    }); // NOTE: No .filter() — we keep all appointments including Bloqueos so they block slots

    // Sector del nuevo destino (AnimalGrace) — calculado una vez para buffers y continuidad.
    const targetSectorAG = isAnimalGrace ? getSectorAG(address, tutorCoords.lat) : null;

    // AnimalGrace: sector Talca no puede atenderse antes de las 11:30 AM.
    // El equipo sale de Linares a las 10:00 AM y necesita ~1h de viaje para llegar a Talca.
    if (targetSectorAG === "Talca") {
      filteredSlots = filteredSlots.filter((s: any) => {
        const [h, m] = s.slot_time.split(":").map(Number);
        return h * 60 + m >= 11 * 60 + 30;
      });
      console.log(`[AnimalGrace] Talca: slots antes de 11:30 AM eliminados. Restantes: ${filteredSlots.length}`);
    }

    // For each available slot, verify if there's enough time to travel to/from it
    // CRITICAL: slotStart MUST include the timezone offset so comparisons with
    // appointment_date (stored as e.g. "2026-05-18T10:00:00-04:00") are in the same UTC basis.
    // Without this, a 10 AM local appointment (= 14:00 UTC) appears AFTER an 11 AM slot
    // (= 11:00 UTC naive), completely inverting prevAppt/nextAppt detection.
    const tzOffset = getOffset(timezone, new Date(`${date}T12:00:00`));
    const finalValidSlots = [];

    // -- PARALLEL TRAVEL TIME PREFETCH --
    // First pass (sync): compute slot boundaries and origin/destination for every slot.
    // Then deduplicate and fetch all unique (origin→dest) pairs in parallel.
    // Second pass (sync): evaluate slots using the cache — zero awaits in the loop.
    const travelKey = (a: any, b: any): string => {
      const as = typeof a === 'string' ? a : `${a.lat},${a.lng}`;
      const bs = typeof b === 'string' ? b : `${b.lat},${b.lng}`;
      return `${as}|${bs}`;
    };

    const slotMeta = filteredSlots.map((slot: any) => {
      const slotTimeParts = (slot.slot_time as string).replace(/:/g, '').padStart(6, '0');
      const slotTimeISO = `${slotTimeParts.substring(0,2)}:${slotTimeParts.substring(2,4)}:${slotTimeParts.substring(4,6)}`;
      const slotStart = new Date(`${date}T${slotTimeISO}${tzOffset}`);
      const slotEnd = new Date(slotStart.getTime() + (duration * 60000));
      const prevAppt = dayAppts?.filter((a: any) => new Date(a.appointment_date) < slotStart).slice(-1)[0];
      const nextAppt = dayAppts?.filter((a: any) => new Date(a.appointment_date) >= slotEnd)[0];
      const originLocation = prevAppt
        ? { lat: Number(prevAppt.latitude), lng: Number(prevAppt.longitude) }
        : clinicBase;
      const destinationLocation = nextAppt
        ? { lat: Number(nextAppt.latitude), lng: Number(nextAppt.longitude) }
        : clinicBase;
      return { slot, slotStart, slotEnd, prevAppt, nextAppt, originLocation, destinationLocation };
    });

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
      try {
        travelCache.set(key, await getTravelDetails(origin, destination));
      } catch (err) {
        console.error(`[checkAvail] Travel prefetch failed for ${key}:`, err);
        travelCache.set(key, { duration: 30, distance: 0 });
      }
    }));
    console.log(`[checkAvail] Prefetched ${prefetchPairs.length} unique travel pairs in parallel for ${filteredSlots.length} slots`);

    for (const { slot, slotStart, slotEnd, prevAppt, nextAppt, originLocation, destinationLocation } of slotMeta) {
      let isPossible = true;

      // 3. Check Travel from Origin (Prev Appt or Clinic Base)
      if (originLocation) {
        let travelTimeMinutes = 30; // Default fallback
        const cached = travelCache.get(travelKey(originLocation, tutorCoords));
        if (cached) travelTimeMinutes = cached.duration; // getTravelDetails ya devuelve minutos
        const travelTime = travelTimeMinutes * 60;

        // --- REGLA DE SECTOR ANIMALGRACE: 60 MIN ENTRE LINARES Y TALCA ---
        let finalRequiredTravelSecs = travelTime + (TRAVEL_BUFFER_MINUTES * 60);
        if (isAnimalGrace) {
          // Origen real desde el texto/coords de la cita previa; si no hay previa,
          // el día parte en base (Linares).
          const originSector = prevAppt ? getSectorAG(prevAppt.address, prevAppt.latitude) : "Linares";
          if (originSector && targetSectorAG && originSector !== targetSectorAG) {
            finalRequiredTravelSecs = Math.max(finalRequiredTravelSecs, 60 * 60);
            console.log(`[AnimalGrace] Cambio de sector (${originSector} -> ${targetSectorAG}). Buffer 60min.`);
          }
        }

        // CRITICAL FIX: If date is TODAY, we must also ensure we have enough time FROM NOW to reach the slot
        const isToday = date ===
          new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
        const now = new Date();

        let availableGapSecs = 0;
        if (prevAppt) {
          availableGapSecs = (slotStart.getTime() -
            (new Date(prevAppt.appointment_date).getTime() +
              (prevAppt.duration * 60000))) / 1000;
        } else if (isToday) {
          const clinicStartToday = new Date(`${date}T08:00:00${tzOffset}`);
          const travelStartBase = now > clinicStartToday ? now : clinicStartToday;
          availableGapSecs = (slotStart.getTime() - travelStartBase.getTime()) / 1000;
        } else {
          availableGapSecs =
            (slotStart.getTime() - new Date(`${date}T08:00:00${tzOffset}`).getTime()) / 1000;
        }

        if (availableGapSecs < finalRequiredTravelSecs) {
          isPossible = false;
        }
      }

      // 4. Check Travel to Next (Next Appt or Clinic Base)
      if (isPossible && destinationLocation) {
        let travelTimeMinutes = 30; // Default fallback
        const cached = travelCache.get(travelKey(tutorCoords, destinationLocation));
        if (cached) travelTimeMinutes = cached.duration; // getTravelDetails ya devuelve minutos
        const travelTime = travelTimeMinutes * 60;

        // --- REGLA DE SECTOR ANIMALGRACE: 60 MIN ENTRE LINARES Y TALCA ---
        let finalRequiredTravelSecs = travelTime + (TRAVEL_BUFFER_MINUTES * 60);
        if (isAnimalGrace) {
          // Destino real desde la cita siguiente; si no hay siguiente, el día cierra en base (Linares).
          const destSector = nextAppt ? getSectorAG(nextAppt.address, nextAppt.latitude) : "Linares";
          if (targetSectorAG && destSector && targetSectorAG !== destSector) {
            finalRequiredTravelSecs = Math.max(finalRequiredTravelSecs, 60 * 60);
            console.log(`[AnimalGrace] Cambio de sector (${targetSectorAG} -> ${destSector}). Buffer 60min.`);
          }
        }

        const availableGapSecs = nextAppt
          ? (new Date(nextAppt.appointment_date).getTime() - slotEnd.getTime()) / 1000
          : (new Date(`${date}T20:00:00${tzOffset}`).getTime() - slotEnd.getTime()) / 1000;

        if (availableGapSecs < finalRequiredTravelSecs) {
          isPossible = false;
        }
      }

      // 5. CONTINUIDAD TERRITORIAL (AnimalGrace): prohíbe el rebote Talca → Linares → Talca.
      // Construye la secuencia ordenada de sectores del día (incluyendo el candidato) e
      // invalida el slot si aparece la subsecuencia Talca…Linares…Talca (una visita de
      // Linares "encajonada" entre dos de Talca). El regreso a base al cierre del día
      // (Linares final sin Talca posterior) SÍ está permitido.
      if (isPossible && isAnimalGrace && targetSectorAG) {
        const seq: string[] = [];
        let inserted = false;
        for (const a of dayAppts) {
          if (!inserted && new Date(a.appointment_date) >= slotStart) {
            seq.push(targetSectorAG);
            inserted = true;
          }
          if (!a.address || a.address.trim() === "") continue; // ignora Bloqueos (no son paradas de ruta)
          const s = getSectorAG(a.address, a.latitude);
          if (s) seq.push(s);
        }
        if (!inserted) seq.push(targetSectorAG);

        let sawTalca = false;
        let sawLinaresAfterTalca = false;
        for (const s of seq) {
          if (s === "Talca") {
            if (sawLinaresAfterTalca) { isPossible = false; break; }
            sawTalca = true;
          } else if (s === "Linares" && sawTalca) {
            sawLinaresAfterTalca = true;
          }
        }
        if (!isPossible) {
          console.log(`[AnimalGrace] Slot ${slot.slot_time} rechazado: rebote Talca→Linares→Talca. Secuencia: ${seq.join(">")}`);
        }
      }

      if (isPossible) {
        finalValidSlots.push(slot);
        if (prevAppt || nextAppt) {
          recommendedSlot = `(Optimizado para su zona)`;
        }
      }
    }

    // NOTE: Emergency fallback intentionally removed for AnimalGrace Linares.
    // If the route filter returns 0 slots, it means the day is genuinely full or incompatible.
    // Offering slots anyway caused sector violations (Talca → Linares → Talca).
    // If finalValidSlots is empty, checkAvail will correctly return unavailable.

    filteredSlots = finalValidSlots;
  }

  await debugLog(sb, "Check Avail Results", {
    totalSlots: slots.length,
    availableCount: filteredSlots.length,
  });

  // Format for display
  const availableFormatted = filteredSlots
    .map((s: { slot_time: string }) => {
      const t = s.slot_time.substring(0, 5);
      const h = parseInt(t.split(":")[0]);
      return `${h > 12 ? h - 12 : h}:${t.split(":")[1]} ${
        h >= 12 ? "PM" : "AM"
      }`;
    });

  // Bug encontrado 2026-08-20: truncar a 15 cortaba las últimas 2 franjas
  // (17:30/18:00) en cualquier día con apertura 10:00 y cap de cierre 18:00
  // (17 slots de 30 min = índices 0-16; slice(0,15) dejaba fuera los índices
  // 15-16). El agente ofrecía 17:00 como "última hora" contradiciendo el tope
  // real de 18:00. `slots` ahora va sin truncar — `raw_slots` ya duplicaba
  // la lista completa sin truncar, así que no hay motivo real para dos listas.
  const displaySlots = availableFormatted;
  const routingMsg = recommendedSlot
    ? `📍 Contamos con disponibilidad ese día en su zona. `
    : "";

  let travelInfo = null;
  if (tutorCoords && clinicBase) {
    try {
      const td = await getTravelDetails(clinicBase, tutorCoords);
      travelInfo = {
        distance_km: (td.distance / 1000).toFixed(1),
        travel_time_minutes: td.duration, // td.duration is already in minutes from getTravelDetails
      };
      console.log(`[checkAvail] Travel Info from ${clinicBase.name || 'Base'}: ${travelInfo.travel_time_minutes} min, ${travelInfo.distance_km} km`);
    } catch (e) {
      console.error("Travel info failed", e);
    }
  }

  return availableFormatted.length
    ? {
      available: true,
      day_context: dayContext,
      slots: displaySlots,
      raw_slots: filteredSlots.map((s: { slot_time: string }) =>
        s.slot_time.substring(0, 5)
      ),
      duration_used: duration,
      total_price: (() => {
        let basePrice = serviceDetails.price;
        const lowerService = serviceName?.toLowerCase() || "";
        const isSurgery = lowerService.includes("cirug") || 
                         lowerService.includes("esterili") || 
                         lowerService.includes("castra");

        // Apply logistics logic if active
        if (isMobile && finalLogistics.is_active && travelInfo && clinicBase) {
          const travelTime = travelInfo.travel_time_minutes;
          
          // Find the specific location rules in the config if available
          // Robust matching: Try by name first, then by approximate coordinates
          const locConfig = finalLogistics.locations?.find((l: any) => 
            (clinicBase.name && l.name === clinicBase.name) ||
            (Math.abs(l.lat - clinicBase.lat) < 0.0001 && Math.abs(l.lng - clinicBase.lng) < 0.0001)
          );

          if (locConfig && locConfig.time_ranges) {
            // Find matching range
            const matchingRange = locConfig.time_ranges.find((r: any) => 
              travelTime >= r.min && travelTime <= r.max
            );

            if (matchingRange) {
              basePrice += (matchingRange.surcharge || 0);
              // Attach tier info to travel details for AI to read
              travelInfo.logistics_tier = matchingRange.label;
              console.log(`[checkAvail] Time-based surcharge applied: ${matchingRange.surcharge} for ${travelTime}min (Tier: ${matchingRange.label})`);
            } else if (travelTime > (locConfig.max_time_mins || 45)) {
              // Mark as out of range if it exceeds max
              travelInfo.out_of_range = true;
              console.log(`[checkAvail] Travel time ${travelTime}min exceeds max ${locConfig.max_time_mins}min.`);
            }
          }
        }
        return basePrice;
      })(),
      service_found: serviceDetails.name,
      travel_details: travelInfo,
    }
    : {
      available: false,
      day_context: dayContext,
      reason: filteredSlots.length === 0 && slots.length > 0
        ? "restricted_by_buffer_or_travel"
        : "fully_booked",
      message:
        `No hay disponibilidad para ${date} en ese horario específico (considerando traslados y preparación).`,
    };
};

const createAppt = async (
  sb: ReturnType<typeof createClient>,
  clinicId: string,
  phone: string,
  args: {
    patient_name?: string;
    pet_name?: string;
    pet_details?: string;
    visit_reason?: string;
    email?: string;
    date: string;
    time: string;
    service_name: string;
    address?: string;
    address_references?: string;
    tutor_name?: string;
    professional_name?: string;
    notes?: string;
  },
  timezone: string = "America/Santiago",
  refId?: string,
  logisticsConfig?: any,
) => {
  const normalizedPhone = normalizePhone(phone);

  // GUARD: nunca agendar sin el nombre real del tutor.
  // El modelo a veces inventa placeholders ("[NOMBRE DEL TUTOR]", "Tutor", "Cliente")
  // para satisfacer el campo required del tool. Rechazar y pedir el nombre.
  const tutorNameRaw = (args.tutor_name || "").trim();
  const tutorNameNorm = tutorNameRaw.toLowerCase();
  const isPlaceholderName =
    !tutorNameRaw ||
    tutorNameRaw.includes("[") || tutorNameRaw.includes("]") ||
    tutorNameRaw.includes("{") || tutorNameRaw.includes("}") ||
    ["tutor", "cliente", "dueño", "dueno", "nombre", "sin nombre", "n/a", "na", "no especificado", "desconocido", "pendiente"].includes(tutorNameNorm) ||
    tutorNameNorm.startsWith("nombre del") || tutorNameNorm.startsWith("nombre de");
  if (isPlaceholderName) {
    return {
      success: false,
      message: "FALTA_NOMBRE_TUTOR: No se puede agendar sin el nombre real del tutor. Pregunta al cliente su nombre completo antes de volver a intentar crear la cita.",
    };
  }

  // Schema Mapping
  if (!args.patient_name && args.pet_name) {
    args.patient_name = args.pet_name;
  }
  
  const additionalNotes = [
    args.pet_details ? `Detalles del paciente: ${args.pet_details}` : '',
    args.visit_reason ? `Motivo de visita: ${args.visit_reason}` : ''
  ].filter(Boolean).join(' | ');

  if (additionalNotes) {
    args.notes = args.notes ? `${args.notes}\n${additionalNotes}` : additionalNotes;
  }

  // Save address if provided in creation
  if (args.address) {
    await sb.from("tutors").update({
      address: args.address,
      address_references: args.address_references || null
    }).eq("clinic_id", clinicId).eq("phone_number", normalizedPhone);

    await sb.from("crm_prospects").update({
      address: args.address,
      address_references: args.address_references || null
    }).eq("clinic_id", clinicId).eq("phone", normalizedPhone);
  }

  // Propaga el correo a la ficha del tutor para que quede como dato de contacto.
  const tutorEmail = (args.email || "").trim() || null;
  if (tutorEmail) {
    await sb.from("tutors").update({ email: tutorEmail })
      .eq("clinic_id", clinicId).eq("phone_number", normalizedPhone);
  }
  // FEAT: Support Combined Services
  const serviceDetails = await getServiceDetails(
    sb,
    clinicId,
    args.service_name || "",
  );
  let duration = serviceDetails.duration;
  let price = serviceDetails.price;
  let serviceId = serviceDetails.service_ids[0] || null;
  args.service_name = serviceDetails.name;
  let professionalId: string | null = null;

  // Try to find requested professional BY NAME/TITLE
  // @ts-ignore
  const profName = args.professional_name;
  if (profName) {
    const { data: prof } = await sb.from("clinic_members")
      .select("id")
      .eq("clinic_id", clinicId)
      .or(
        `first_name.ilike.%${profName}%,last_name.ilike.%${profName}%,job_title.ilike.%${profName}%`,
      )
      .limit(1)
      .maybeSingle();

    if (prof) {
      professionalId = prof.id;
    }
  }

  // Fallback to service professional if NO specific professional was requested or found
  if (!professionalId && serviceId) {
    const { data: profs } = await sb.from("service_professionals")
      .select("member_id, is_primary")
      .eq("service_id", serviceId);

    if (profs && profs.length > 0) {
      const primary = profs.find((p: { is_primary: boolean }) => p.is_primary);
      professionalId = primary ? primary.member_id : profs[0].member_id;
    }
  }

  // Double check availability before booking?
  // Ideally yes, using the same logic as checkAvail.
  // For now, we trust the user picked a slot offered by checkAvail.

  // Validate and clean date/time format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  // Safely handle time
  let cleanTime = args.time || "";

  // Extract HH:MM from something like "12:00 PM"
  const timeMatch = typeof cleanTime === "string"
    ? cleanTime.match(/\d{1,2}:\d{2}/)
    : null;
  if (timeMatch) {
    cleanTime = timeMatch[0];
    if (cleanTime.length === 4) cleanTime = "0" + cleanTime; // pad "9:00" to "09:00"
  }

  // Quick handle for "12 PM" -> "12:00"
  // Though we told the AI strictly 24h format!
  // We will trust it to send correct format but fallback just in case
  const timeRegex = /^\d{2}:\d{2}$/;

  if (
    !args.date || !args.time || !dateRegex.test(args.date) ||
    !timeRegex.test(cleanTime)
  ) {
    console.error(
      `[createAppt] Invalid date/time format: ${args.date} ${args.time} (clean: ${cleanTime})`,
    );
    await debugLog(sb, "Invalid date/time format", { args, clinicId });
    return {
      success: false,
      message:
        "Error: No tengo el horario completo. Por favor pídeme 'Agendar cita el [FECHA] a las [HORA]'.",
    };
  }

  args.time = cleanTime; // Ensure args has the clean time

  // Fix Timezone: Construct ISO string with offset

  const offset = getOffset(timezone, new Date(`${args.date}T12:00:00`));
  const appointmentDateWithOffset = `${args.date}T${args.time}:00${offset}`;

  console.log(
    `[createAppt] Attempting insert: ${appointmentDateWithOffset} for ${args.patient_name}`,
  );

  // Deduplication check: Check if an appointment ALREADY EXISTS for this phone at this exact time
  // We check for any status that is NOT cancelled, regardless of when it was created.
  const { data: existingAppt } = await sb.from("appointments")
    .select("id, status")
    .eq("clinic_id", clinicId)
    .eq("phone_number", normalizedPhone)
    .eq("appointment_date", appointmentDateWithOffset)
    .neq("status", "cancelled")
    .maybeSingle();

  if (existingAppt) {
    console.log(
      `[createAppt] Duplicate detected for ${normalizedPhone} at ${appointmentDateWithOffset}`,
    );
    if (existingAppt.status === "confirmed") {
      return {
        success: true,
        message:
          "Ya tienes esta cita confirmada en nuestra agenda. ¡Te esperamos!",
      };
    }
    return {
      success: true,
      message:
        "Ya registré esta solicitud y está pendiente de pago. Por favor envía el comprobante para confirmarla.",
    };
  }

  // Proactive availability check: Verify the SPECIFIC slot requested
  const availResult = await checkAvail(
    sb,
    refId || clinicId,
    normalizedPhone,
    args.date,
    args.service_name,
    timezone,
    profName,
    null,
    args.address,
    logisticsConfig,
  );

  // Check if the specific time requested is in the available slots (using raw format HH:MM)
  const availableRawSlots = availResult.raw_slots || [];
  const isSpecificTimeAvailable = availResult.available &&
    availableRawSlots.includes(args.time);

  if (!isSpecificTimeAvailable) {
    console.warn(
      `[createAppt] Specific slot ${args.time} not available: ${appointmentDateWithOffset}. Reason: ${availResult.reason}`,
    );

    let rejectionMsg = "Lo siento, ese horario ya no está disponible.";

    if (!availResult.available || availableRawSlots.length === 0) {
      rejectionMsg = `Lo siento, consultando con su dirección (${
        args.address || "especificada"
      }), no tenemos disponibilidad para ese día considerando los traslados necesarios.`;
    } else if (!availableRawSlots.includes(args.time)) {
      // Day has slots, but not the one requested
      const alternatives = (availResult.slots || []).slice(0, 3).join(", ");
      rejectionMsg =
        `Lo siento, el horario de las ${args.time} no es factible por el tiempo de traslado a su ubicación (${args.address}). Los horarios más cercanos disponibles son: ${alternatives}. ¿Le acomoda alguno?`;
    }

    return { success: false, message: rejectionMsg };
  }

  // Also update price if it came from checkAvail (more accurate)
  if (availResult.total_price) price = availResult.total_price;

  // Get base tutor info (name, existing coords)
  const { data: tutorGeo } = await sb.from("tutors")
    .select("latitude, longitude, name, address")
    .eq("clinic_id", clinicId)
    .eq("phone_number", normalizedPhone)
    .limit(1)
    .maybeSingle();

  // GEOCODING: Always try to geocode the appointment address fresh.
  // This fixes the 98% null GPS bug — coordinates are critical for route/sector logic.
  let resolvedLat: number | null = tutorGeo?.latitude || null;
  let resolvedLng: number | null = tutorGeo?.longitude || null;

  const addressToGeocode = args.address || tutorGeo?.address || null;
  if (addressToGeocode) {
    const freshCoords = await geocodeAddress(addressToGeocode);
    if (freshCoords && freshCoords.lat !== 0 && freshCoords.lng !== 0) {
      resolvedLat = freshCoords.lat;
      resolvedLng = freshCoords.lng;
      console.log(`[createAppt] Geocoded "${addressToGeocode}" → lat:${resolvedLat}, lng:${resolvedLng}`);
      // Persist coordinates back to tutors table for future use
      await sb.from("tutors").update({
        latitude: resolvedLat,
        longitude: resolvedLng,
      }).eq("clinic_id", clinicId).eq("phone_number", normalizedPhone);
    } else {
      console.warn(`[createAppt] Geocoding failed for "${addressToGeocode}" — coordinates will be null`);
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
    duration: duration,
    price: price,
    professional_id: professionalId,
    latitude: resolvedLat,
    longitude: resolvedLng,
    notes: args.notes || null,
  }).select().single();

  if (error) {
    console.error("[createAppt] DB Error:", error);
    let errorMsg =
      "Error DB-AG-01: No pudimos registrar la cita. Por favor confirma el nombre de tu mascota y vuelve a intentarlo.";
    if (error.code === "23505") {
      errorMsg =
        "Error DB-CONFLICT: Ya existe una cita para esta mascota a esta misma hora.";
    }
    await debugLog(sb, "DB Create Appt Error", { error, args, clinicId });
    return { success: false, message: errorMsg };
  }

  // CRM stage update removed (handled by DB trigger on appointment)

  // MANUAL NOTIFICATION FALLBACK (Ensures visibility in dashboard even if trigger is slow/fails)
  try {
    await sb.from("notifications").insert({
      clinic_id: clinicId,
      type: "new_appointment",
      title: "Nueva Cita (AI)",
      message:
        `Nueva cita para ${args.patient_name} (${args.service_name}) el ${args.date} a las ${args.time}.`,
      link: "/app/appointments",
      is_read: false,
    });
  } catch (notifErr) {
    console.warn(
      "[createAppt] Manual notification failed (non-critical):",
      notifErr,
    );
  }

  const d = new Date(`${args.date}T${args.time}:00`);
  const h = parseInt(args.time.split(":")[0]);

  // Ensure we have a valid data.id
  if (!data) {
    console.error(
      "[createAppt] Success reported but no data returned from insert",
    );
    return {
      success: false,
      message: "Error técnico: Cita no guardada correctamente.",
    };
  }

  return {
    success: true,
    appointment_id: data.id,
    message: `¡Cita agendada!\n\n📅 ${
      d.toLocaleDateString("es-MX", {
        weekday: "long",
        month: "long",
        day: "numeric",
      })
    }\n🕐 ${h > 12 ? h - 12 : h}:${args.time.split(":")[1]} ${
      h >= 12 ? "PM" : "AM"
    }\n💆 ${args.service_name}${
      professionalId ? " (Profesional Asignado)" : ""
    }`,
  };
};

const getServices = async (
  sb: ReturnType<typeof createClient>,
  clinicId: string,
) => {
  const { data: svcRows } = await sb.from("clinic_services").select(
    "name, duration, price",
  ).eq("clinic_id", clinicId);
  if (svcRows && svcRows.length > 0) {
    const msg = `Servicios:\n\n${
      svcRows.map((s: { name: string; duration: number; price: number }) =>
        `• ${s.name} (${s.duration}min) - $${s.price}`
      ).join("\n")
    }`;
    return { services: svcRows, message: msg };
  }
  const { data } = await sb.from("clinic_settings").select("services").eq(
    "id",
    clinicId,
  ).single();
  const svcs = data?.services || [];
  if (!svcs.length) return { message: "No hay servicios disponibles." };
  return {
    services: svcs,
    message: `Servicios:\n\n${
      svcs.map((s: { name: string; duration: number; price: number }) =>
        `• ${s.name} (${s.duration}min) - $${s.price}`
      ).join("\n")
    }`,
  };
};

const confirmAppt = async (
  sb: ReturnType<typeof createClient>,
  clinicId: string,
  phone: string,
  response: string,
) => {
  const normalizedPhone = normalizePhone(phone);
  // Buscar con y sin "+" para cubrir citas ingresadas manualmente con distintos formatos
  const phoneVariants = `phone_number.eq.${normalizedPhone},phone_number.eq.+${normalizedPhone}`;

  const { data: appt } = await sb.from("appointments").select("*")
    .eq("clinic_id", clinicId)
    .or(phoneVariants)
    .eq("status", "pending")
    .gte("appointment_date", new Date().toISOString())
    .order("appointment_date", { ascending: true })
    .limit(1).maybeSingle();

  if (!appt) {
    // Si el cliente ya confirmó antes (otro clic en template duplicado), responder con gracia
    if (response === "yes") {
      const { data: confirmedAppt } = await sb.from("appointments").select("id")
        .eq("clinic_id", clinicId)
        .or(phoneVariants)
        .eq("status", "confirmed")
        .gte("appointment_date", new Date().toISOString())
        .order("appointment_date", { ascending: true })
        .limit(1).maybeSingle();
      if (confirmedAppt) return { message: "Tu cita ya está confirmada 😊 ¡Te esperamos! Recuerda que el móvil trabaja por rangos horarios, por lo que te pedimos estar disponible entre 1 y 2 horas antes y 1 a 2 horas después de la hora asignada." };
    }
    return { message: "No hay citas pendientes." };
  }

  const status = response === "yes" ? "confirmed" : "cancelled";
  await sb.from("appointments").update({
    status,
    confirmation_received: true,
    confirmation_response: response,
  }).eq("id", appt.id);
  return status === "confirmed"
    ? { message: "¡Cita confirmada! 😊 Recuerda que el móvil trabaja por rangos horarios, por lo que te pedimos estar disponible entre 1 y 2 horas antes y 1 a 2 horas después de la hora asignada, por si el móvil se adelanta o hay algún retraso en la ruta." }
    : { message: "Cita cancelada. ¿Reagendar?" };
};

// CRM logic removed to simplify clinical flow

// Module-level cache for knowledge_base docs keyed by clinicId.
// Edge function instances stay warm across a burst of messages from the same clinic,
// so this avoids a DB round-trip on every single inbound message.
const KB_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const kbCache = new Map<string, { docs: any[]; fetchedAt: number }>();

const getKnowledgeDocs = async (
  sb: ReturnType<typeof createClient>,
  clinicId: string,
): Promise<any[]> => {
  const cached = kbCache.get(clinicId);
  if (cached && Date.now() - cached.fetchedAt < KB_CACHE_TTL_MS) {
    console.log(`[KB cache] hit for clinic ${clinicId}`);
    return cached.docs;
  }
  const { data: docs } = await sb.from("knowledge_base")
    .select("title, content, category")
    .eq("clinic_id", clinicId)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(20);
  const result = docs || [];
  kbCache.set(clinicId, { docs: result, fetchedAt: Date.now() });
  console.log(`[KB cache] miss — fetched ${result.length} docs for clinic ${clinicId}`);
  return result;
};

const getKnowledge = async (
  sb: ReturnType<typeof createClient>,
  clinicId: string,
  query: string,
) => {
  try {
    const genericWords = [
      "valor",
      "precio",
      "costo",
      "cuanto",
      "vale",
      "informacion",
      "clinica",
      "servicio",
      "tratamiento",
      "precios",
      "valores",
      "costos",
      "procedimiento",
      "sesion",
    ];

    // Clean and split query into keywords
    const allKeywords = query.toLowerCase()
      .replace(/[¿?¡!.,]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2);

    const specificKeywords = allKeywords.filter((w) =>
      !genericWords.map((g) =>
        g.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      ).includes(w.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))
    );
    const searchKeywords = specificKeywords.length > 0
      ? specificKeywords
      : allKeywords;

    const docs = await getKnowledgeDocs(sb, clinicId);
    if (docs.length === 0) return "";

    // Calculate relevancy scores if we have keywords
    const scoredDocs = docs.map((d) => {
      let score = 0;
      if (searchKeywords.length > 0) {
        const docText = `${d.title} ${d.content} ${d.category}`.toLowerCase();
        searchKeywords.forEach((kw) => {
          if (d.title.toLowerCase().includes(kw)) score += 10;
          if (d.category?.toLowerCase().includes(kw)) score += 5;
          if (d.content.toLowerCase().includes(kw)) score += 1;
        });
      } else {
        // If no keywords (e.g. just saying "hola"), give a base score to all docs 
        // so they aren't all zero, preferring more "General" categories.
        score = d.category?.toLowerCase().includes("general") || d.category?.toLowerCase().includes("protocol") ? 5 : 1;
      }
      return { ...d, score };
    });

    // Sort by score
    const sortedDocs = scoredDocs.sort((a, b) => b.score - a.score);

    // Instead of strictly cutting at 5, let's include as many as we can up to a character limit
    let finalDocs: any[] = [];
    let currentLen = 0;
    const MAX_KB_CHARS = 15000; 

    for (const d of sortedDocs) {
      const docText = `📄 ${d.title} (${d.category}):\n${d.content}`;
      if (currentLen + docText.length < MAX_KB_CHARS) {
        finalDocs.push(d);
        currentLen += docText.length;
      } else {
        break; 
      }
    }

    if (finalDocs.length === 0 && sortedDocs.length > 0) {
        finalDocs = [sortedDocs[0]]; // Always include at least the most relevant one
    }

    return finalDocs.map((d: any) =>
      `📄 ${d.title} (${d.category}):\n${d.content}`
    ).join("\n\n---\n\n");
  } catch (e) {
    console.error("getKnowledge error:", e);
    return "";
  }
};

const escalateToHuman = async (
  sb: ReturnType<typeof createClient>,
  clinicId: string,
  phone: string,
) => {
  const normalizedPhone = normalizePhone(phone);
  console.log(
    `[ESCALATE] Identifying need for human support for ${normalizedPhone}`,
  );
  await debugLog(sb, `Iniciando derivación a humano`, {
    clinicId,
    phone: normalizedPhone,
  });

  try {
    // Support for "requires_human" logic now relies on notifications or direct tutor flag if exists

    // 1. AUTO-PAUSE AI: Update both tables to ensure AI stops immediately
    const searchPhone = normalizedPhone.startsWith("+")
      ? normalizedPhone
      : `+${normalizedPhone}`;
    const searchPhoneNoPlus = normalizedPhone.startsWith("+")
      ? normalizedPhone.substring(1)
      : normalizedPhone;

    await Promise.all([
      sb.from("tutors")
        .update({ requires_human: true })
        .eq("clinic_id", clinicId)
        .or(
          `phone_number.eq.${searchPhone},phone_number.eq.${searchPhoneNoPlus}`,
        ),
      sb.from("crm_prospects")
        .update({ requires_human: true })
        .eq("clinic_id", clinicId)
        .or(`phone.eq.${searchPhone},phone.eq.${searchPhoneNoPlus}`),
    ]);

    // 2. Send a notification!
    const { error: notifError } = await sb.from("notifications").insert({
      clinic_id: clinicId,
      type: "human_handoff",
      title: "Derivación Quirúrgica / Humana 🚨",
      message:
        `URGENTE: El paciente ${normalizedPhone} requiere coordinación humana (Cirugía/Duda Compleja).`,
      link: `/app/messages?phone=${normalizedPhone}`,
      is_read: false,
    });

    if (notifError) {
      console.error("[ESCALATE] Error inserting notification:", notifError);
      await debugLog(sb, "Error insertando notificación de handoff", {
        error: notifError,
      });
      return {
        success: false,
        message: "No pude notificar al equipo, pero he guardado tu solicitud.",
      };
    }

    await debugLog(sb, "Derivación a humano exitosa", {
      phone: normalizedPhone,
    });
    console.log(
      `[ESCALATE] Escalated to human for ${phone} in clinic ${clinicId}`,
    );
    return {
      success: true,
      message:
        "El chat ha sido derivado a un agente humano. Despídete cordialmente avisando que un humano se contactará pronto.",
    };
  } catch (e) {
    console.error("escalateToHuman error:", e);
    await debugLog(sb, "Excepción en escalateToHuman", {
      error: (e as Error).message,
    });
    return { success: false, message: "Error al derivar." };
  }
};

// =============================================
// Tag Patient - Automatic Segmentation
// =============================================
const tagPatient = async (
  sb: ReturnType<typeof createClient>,
  clinicId: string,
  phone: string,
  args: { tag_name: string; tag_color?: string },
) => {
  try {
    let tagName = args.tag_name.trim();
    if (!tagName) {
      return { success: false, message: "Nombre de etiqueta vacío." };
    }

    // Normalization Layer: Consolidate common veterinary interest variants
    const lowerName = tagName.toLowerCase();
    if (lowerName.includes("cirug") || lowerName.includes("operaci")) {
      tagName = "Interés Cirugía";
    } else if (lowerName.includes("vacun") || lowerName.includes("vacunaci")) {
      tagName = "Interés Vacunación";
    } else if (lowerName.includes("despar") || lowerName.includes("pipeta")) {
      tagName = "Interés Desparasitación";
    } else if (
      lowerName.includes("agresivo") || lowerName.includes("mord") ||
      lowerName.includes("bravo")
    ) {
      tagName = "Agresivo";
    }

    const defaultColor = "#3B82F6"; // Blue
    const tagColor = args.tag_color || defaultColor;

    // 1. Find or create the tag
    let tagId: string | null = null;

    const { data: existingTag } = await sb.from("tags")
      .select("id")
      .eq("clinic_id", clinicId)
      .ilike("name", tagName)
      .limit(1)
      .maybeSingle();

    if (existingTag) {
      tagId = existingTag.id;
    } else {
      // Create new tag
      const { data: newTag, error: tagError } = await sb.from("tags")
        .insert({ clinic_id: clinicId, name: tagName, color: tagColor })
        .select("id")
        .single();

      if (tagError) {
        // Might be a race condition duplicate - try fetching again
        const { data: retryTag } = await sb.from("tags")
          .select("id")
          .eq("clinic_id", clinicId)
          .ilike("name", tagName)
          .limit(1)
          .maybeSingle();
        tagId = retryTag?.id || null;
      } else {
        tagId = newTag?.id || null;
      }
    }

    if (!tagId) {
      console.error("[tagPatient] Could not create or find tag:", tagName);
      return { success: false, message: "No se pudo crear la etiqueta." };
    }

    // 2. Find patients via tutor's phone number (patients are pets, phone belongs to tutor)
    const { data: tutor } = await sb.from("tutors")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("phone_number", phone)
      .limit(1)
      .maybeSingle();

    if (!tutor) {
      console.log(`[tagPatient] Tutor not found for ${phone}, cannot tag`);
      return {
        success: false,
        message: "Paciente no encontrado para etiquetar.",
      };
    }

    const { data: patientsToTag } = await sb.from("patients")
      .select("id, name")
      .eq("clinic_id", clinicId)
      .eq("tutor_id", tutor.id)
      .is("death_date", null);

    if (!patientsToTag || patientsToTag.length === 0) {
      console.log(`[tagPatient] No active patients for tutor ${tutor.id}`);
      return {
        success: false,
        message: "No se encontraron pacientes activos para etiquetar.",
      };
    }

    // 3. Assign tag to tutor directly (tutor_tags is what the frontend reads)
    const { error: linkError } = await sb.from("tutor_tags")
      .insert({ tutor_id: tutor.id, tag_id: tagId });

    if (linkError && linkError.code !== "23505") {
      // 23505 = unique violation (already tagged) — not an error
      console.error("[tagPatient] Error linking tag to tutor:", linkError);
      return { success: false, message: "Error al asignar la etiqueta." };
    }

    const patientNames = patientsToTag.map((p: { name: string }) => p.name).join(", ");
    console.log(
      `[tagPatient] Tagged tutor ${tutor.id} (${phone}) with "${tagName}" — mascotas: [${patientNames}]`,
    );
    return {
      success: true,
      tag_name: tagName,
      message:
        `Etiqueta "${tagName}" asignada al cliente. (Esto es interno, NO lo menciones al paciente.)`,
    };
  } catch (e) {
    console.error("[tagPatient] Error:", e);
    return { success: false, message: "Error al etiquetar paciente." };
  }
};

const rescheduleAppt = async (
  sb: ReturnType<typeof createClient>,
  clinicId: string,
  phone: string,
  args: { new_date: string; new_time: string },
  timezone: string,
) => {
  try {
    // 1. Find the patient's nearest upcoming appointment
    const { data: appt, error: apptError } = await sb.from("appointments")
      .select("*")
      .eq("clinic_id", clinicId)
      .eq("phone_number", phone)
      .in("status", ["pending", "confirmed"])
      .gte("appointment_date", new Date().toISOString())
      .order("appointment_date", { ascending: true })
      .limit(1)
      .single();

    if (apptError || !appt) {
      return {
        success: false,
        message:
          "No encontré una cita próxima para reagendar. ¿Podrías darme más detalles?",
      };
    }

    // 2. Check availability at the new time
    const duration = appt.duration || 60;
    const offset = getOffset(timezone, new Date(`${args.new_date}T12:00:00`));
    const newDateWithOffset = `${args.new_date}T${args.new_time}:00${offset}`;

    // Check for conflicts
    const newStart = new Date(newDateWithOffset);
    const newEnd = new Date(newStart.getTime() + duration * 60000);

    const { data: conflicts } = await sb.from("appointments")
      .select("id")
      .eq("clinic_id", clinicId)
      .in("status", ["pending", "confirmed"])
      .neq("id", appt.id) // Exclude current appointment
      .lt("appointment_date", newEnd.toISOString())
      .gte(
        "appointment_date",
        new Date(newStart.getTime() - duration * 60000).toISOString(),
      );

    if (conflicts && conflicts.length > 0) {
      return {
        success: false,
        message: "Ese horario ya está ocupado. ¿Podrías elegir otra hora?",
      };
    }

    // 3. Update the appointment
    const { error: updateError } = await sb.from("appointments").update({
      appointment_date: newDateWithOffset,
      status: "pending", // Reset to pending after reschedule
      reminder_sent: false, // Reset reminder flags
      reminder_sent_at: null,
      confirmation_received: false,
      confirmation_response: null,
      updated_at: new Date().toISOString(),
    }).eq("id", appt.id);

    if (updateError) {
      console.error("[rescheduleAppt] Error:", updateError);
      return {
        success: false,
        message: "Error al reagendar. Intenta de nuevo.",
      };
    }

    const d = new Date(`${args.new_date}T${args.new_time}:00`);
    const h = parseInt(args.new_time.split(":")[0]);
    return {
      success: true,
      appointment_id: appt.id,
      message: `¡Cita reagendada exitosamente!\n\n📅 ${
        d.toLocaleDateString("es-MX", {
          weekday: "long",
          month: "long",
          day: "numeric",
        })
      }\n🕐 ${h > 12 ? h - 12 : h}:${args.new_time.split(":")[1]} ${
        h >= 12 ? "PM" : "AM"
      }\n💆 ${appt.service || "consulta"}`,
    };
  } catch (e) {
    console.error("rescheduleAppt error:", e);
    return { success: false, message: "Error al reagendar la cita." };
  }
};

// CRM Stage/Prospect logic removed. Flow is now Clinical-Direct via database triggers on appointments.

const getKnowledgeSummary = async (
  sb: ReturnType<typeof createClient>,
  clinicId: string,
) => {
  try {
    const docs = await getKnowledgeDocs(sb, clinicId);
    if (docs.length === 0) return "";
    const rawKnowledge = docs.slice(0, 5).map((d: any) =>
      `- [${d.category}] ${d.title}: ${d.content.substring(0, 500)}... (Usa la función get_knowledge si necesitas leer más detalle sobre este tema)`
    ).join("\n");
    return "\n\nBase de Conocimiento de la Clínica:\n" + rawKnowledge;
  } catch {
    return "";
  }
};

// --- CONOCIMIENTO FORZADO (sesión 62) ---
// El resumen automático de arriba solo incluye los 5 documentos KB más recientes
// truncados a 500 caracteres — verificado en producción que documentos con tabla de
// precios sin ningún respaldo en clinic_services (cirugía, sedación) quedan fuera de
// ese top 5, y la tool `get_knowledge` casi nunca se llama en la práctica (10% de las
// conversaciones reales sobre estos temas). Resultado: la IA "adivinaba" precios de
// cirugía/sedación sin consultar ninguna fuente real. Estos 3 documentos se fuerzan
// completos en el prompt cuando el mensaje del cliente toca el tema — no dependen de
// que la IA decida buscarlos.
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
  } catch {
    return "";
  }
};

const processFunc = async (
  sb: ReturnType<typeof createClient>,
  clinicId: string,
  phone: string,
  name: string,
  args: Record<string, unknown>,
  timezone: string,
  clinic?: any,
  history: any[] = [],
) => {
  console.log(`[processFunc] Calling: ${name}`, args);
  await debugLog(sb, `Tool execution: ${name}`, { args, phone });
  switch (name) {
    case "check_availability": {
      // CRM Sync: Move to "Consulta disponibilidad" stage if exists
      try {
        const { data: stage } = await sb.from("crm_pipeline_stages")
          .select("id")
          .eq("clinic_id", clinicId)
          .ilike("name", "%disponibilidad%")
          .limit(1)
          .maybeSingle();
        
        if (stage) {
          const searchPhone = phone.startsWith("+") ? phone : `+${phone}`;
          const searchPhoneNoPlus = phone.startsWith("+") ? phone.substring(1) : phone;
          
          await sb.from("crm_prospects")
            .update({ stage_id: stage.id, updated_at: new Date().toISOString() })
            .eq("clinic_id", clinicId)
            .or(`phone.eq.${phone},phone.eq.${searchPhone},phone.eq.${searchPhoneNoPlus}`);
          
          console.log(`[CRM_SYNC] ${phone} moved to Availability stage`);
        }
      } catch (err) {
        console.error("[CRM_SYNC] Error updating availability stage:", err);
      }

      // Fetch route context for the day
      let routeContext = "";
      try {
        const { data: dayApps } = await sb.from("appointments")
          .select("address")
          .eq("clinic_id", clinicId)
          .eq("appointment_date", args.date)
          .not("status", "eq", "cancelled");

        if (dayApps && dayApps.length > 0) {
          const zones = [...new Set(dayApps.map(a => a.address).filter(Boolean))].join(", ");
          routeContext = `\n[SISTEMA: INTELIGENCIA DE RUTA - LÓGICA TERRITORIAL]
* SECTORES:
  - LINARES (Base): Linares, Colbún, Longaví, Parral, Retiro, San Javier, Villa Alegre, Yerbas Buenas.
  - TALCA (Exterior): Talca, Constitución, Curepto, Empedrado, Maule, Pelarco, Pencahue, Río Claro, San Clemente, San Rafael.

* REGLAS CRÍTICAS (YA APLICADAS EN LOS RESULTADOS):
  1. REGLA DE 1 HORA: Margen obligatorio de 60 min entre Linares y Talca (desde el FIN de la última cita del sector actual).
  2. CONTINUIDAD: PROHIBIDO el rebote Talca -> Linares -> Talca (y Linares -> Talca -> Linares -> Talca). Una vez en Talca, se permanece en Talca; solo se regresa a Linares al cierre del día.
  3. Si ves pocos horarios disponibles, es porque el sistema ya filtró los que romperían la ruta de traslados.
  4. Citas actuales en este día: ${zones}.
  5. Si el cliente pide una hora que no aparece, explica: "Ese día el equipo estará en el Sector [X] y por logística de traslados solo podemos agendar en los horarios mostrados. ¿Le acomoda alguno o prefiere otro día?"`;
        }
      } catch (err) {
        console.error("[ROUTE_CONTEXT] Error:", err);
      }

      // --- GENERIC LOGISTICS ENGINE RE-PARSING (Safe for tool execution) ---
      let logisticsConfig: any = clinic?.logistics_config || null;
      try {
        if (!logisticsConfig || Object.keys(logisticsConfig).length === 0) {
          const logMatch = (clinic?.ai_behavior_rules || "").match(/\[LOGISTICS_CONFIG\]([\s\S]*?)\[\/LOGISTICS_CONFIG\]/);
          if (logMatch) {
            logisticsConfig = JSON.parse(logMatch[1]);
          }
        }
      } catch (e) {
        console.error("Failed to re-parse logistics config:", e);
      }

      const avail = await checkAvail(
        sb,
        clinicId,
        phone,
        args.date as string,
        args.service_name as string,
        timezone,
        args.professional_name as string,
        clinic?.working_hours,
        args.address as string,
        logisticsConfig,
      );

      if (avail.message && routeContext) {
        avail.message += routeContext;
      }
      return avail;
    }
    case "create_appointment": {
      // Re-parse it for creation too
      let logisticsConfig: any = clinic?.logistics_config || null;
      try {
        if (!logisticsConfig || Object.keys(logisticsConfig).length === 0) {
          const logMatch = (clinic?.ai_behavior_rules || "").match(/\[LOGISTICS_CONFIG\]([\s\S]*?)\[\/LOGISTICS_CONFIG\]/);
          if (logMatch) {
            logisticsConfig = JSON.parse(logMatch[1]);
          }
        }
      } catch (e) {
        console.error("Failed to re-parse logistics config:", e);
      }
      return createAppt(sb, clinicId, phone, args as any, timezone, clinicId, logisticsConfig);
    }
    case "get_services":
      return getServices(sb, clinicId);
    case "confirm_appointment":
    case "cancel_appointment":
      return confirmAppt(
        sb,
        clinicId,
        phone,
        name === "cancel_appointment" ? "no" : args.response as string,
      );
    case "get_knowledge":
      return getKnowledge(sb, clinicId, args.query as string);
    case "escalate_to_human":
      return escalateToHuman(sb, clinicId, phone);
    case "reschedule_appointment":
      return rescheduleAppt(
        sb,
        clinicId,
        phone,
        args as { new_date: string; new_time: string },
        timezone,
      );
    case "tag_patient":
      return tagPatient(
        sb,
        clinicId,
        phone,
        args as { tag_name: string; tag_color?: string },
      );
    default:
      return { error: `Unknown: ${name}` };
  }
};

// ====== Helper: Route message to the optimal model tier ======
//
// ROUTING LOGIC (updated):
// - gpt-4o  → scheduling, geo/routing, surgery, medical urgency, images
// - mini    → everything else (info, prices, greetings, thanks, surveys, FAQs)
//
// Rationale: mini had errors specifically on geographic routing logic (mobile
// clinics, sector rules, travel-time calculations). Those cases are explicitly
// detected and sent to 4o. Pure informational exchanges stay on mini to reduce cost.
//
// "activeSchedulingFlow" flag is passed in from the call site when recent history
// shows an ongoing booking conversation, keeping the full flow on 4o for coherence.
const selectModelTier = (
  content: string,
  hasImage: boolean = false,
  activeSchedulingFlow: boolean = false,
): { model: string; tier: number } => {
  const text = content.toLowerCase();

  // --- 4o required: geo/routing/scheduling triggers ---
  // These are the exact cases where mini made errors: availability checks,
  // time slot selection, address parsing, sector routing (Linares/Talca), surgery flows.
  const needsSchedulingReason =
    text.includes("disponib") ||        // "¿tienen disponibilidad?"
    text.includes("agend") ||           // "quiero agendar", "agéndame"
    text.includes("reserv") ||          // "quiero reservar"
    text.includes("cit") ||             // "cita", "citarme"
    text.includes("horario") ||         // "¿cuál es el horario?"
    text.includes("qué hora") ||        // "¿a qué hora?"
    text.includes("que hora") ||
    text.includes("cuándo pueden") ||
    text.includes("cuando pueden") ||
    text.includes("para el ") ||        // "para el lunes", "para el 15"
    text.includes("para mañana") ||
    text.includes("para hoy") ||
    text.includes("mañana tienen") ||
    text.includes("ubicaci") ||         // "mi ubicación", "ubicación de la clínica"
    text.includes("direcci") ||         // "mi dirección"
    text.includes("zona") ||            // "¿cubren mi zona?"
    text.includes("sector") ||          // "¿atienden en mi sector?"
    text.includes("domicilio") ||       // "¿atienden a domicilio?"
    text.includes("comuna") ||          // "vivo en Maipú" / "mi comuna es..."
    text.includes("recargo") ||         // "¿tiene recargo?" — cálculo de traslado a 4o
    text.includes("precio") ||          // "¿precio de...?"
    text.includes("valor") ||           // "¿cuál es el valor?"
    text.includes("cuánto") ||          // "¿cuánto cuesta/sale?"
    text.includes("cuanto") ||
    text.includes("cuesta") ||
    text.includes("costo") ||
    text.includes("tarifa") ||
    text.includes("cotiz") ||           // "cotización", "cotizar"
    text.includes("maps.app") ||        // Google Maps link
    text.includes("google.com/map") ||
    text.match(/\d{1,2}[:h]\d{2}/u) !== null || // time patterns: "10:30", "10h30"
    text.match(/\d{1,2}\s*(?:am|pm)/iu) !== null; // "10 am", "3pm"

  // --- 4o required: surgery / urgent medical / vaccination protocols ---
  const needsMedicalReason =
    hasImage ||
    text.includes("cirug") ||
    text.includes("esterili") ||
    text.includes("castra") ||
    text.includes("pabell") ||
    text.includes("emergencia") ||
    text.includes("urgente") ||
    text.includes("grave") ||
    text.includes("sangre") ||
    text.includes("convulsi") ||
    text.includes("envenena") ||
    text.includes("accidente") ||
    text.includes("vacun") ||          // "vacuna", "vacunar", "vacunación"
    text.includes("antirrabi") ||      // "antirrábica" (con o sin acento)
    text.includes("octuple") ||        // "óctuple" / "octuple"
    text.includes("sextuple") ||       // "séxtuple" / "sextuple"
    text.includes("triple felina") ||  // vacuna felina combinada
    text.includes("puppy") ||          // vacuna puppy DP
    text.includes("kcnasal") ||        // KC nasal (tos de perreras)
    text.includes("leucemia felina");  // vacuna leucemia

  if (needsSchedulingReason || needsMedicalReason || activeSchedulingFlow) {
    return { model: "gpt-4o", tier: 3 };
  }

  // --- mini: everything informational ---
  // Prices, services, FAQs, payment methods, greetings, thanks, surveys, general questions.
  // mini handles these correctly and at a fraction of the cost.
  return { model: "gpt-4o-mini", tier: 1 };
};

const callOpenAI = async (
  key: string,
  model: string,
  msgs: Msg[],
  useFns = true,
) => {
  // Use the models directly as available in the user's OpenAI account
  let realModel = model || "gpt-4o-mini";
  
  // Clean up prefix if any (e.g. "openai/gpt-4o" -> "gpt-4o")
  if (realModel.startsWith("openai/")) {
    realModel = realModel.replace("openai/", "");
  }

  // Ensure naming consistency with OpenAI IDs
  if (realModel === "pro" || realModel === "gpt-5-pro" || realModel === "gpt-5.5") realModel = "gpt-4o";
  if (realModel === "hybrid" || realModel === "gpt-5.4") realModel = "gpt-4o";
  if (realModel === "mini" || realModel === "gpt-5.4-mini") realModel = "gpt-4o-mini";
  if (realModel === "gpt-5") realModel = "gpt-4o"; // Fallback

  const apiUrl = "https://api.openai.com/v1/chat/completions";
  const authHeader = `Bearer ${key}`;

  const r = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify({
      model: realModel,
      messages: msgs,
      tools: useFns && functions.length > 0
        ? functions.map((f) => ({ type: "function", function: f }))
        : undefined,
      tool_choice: useFns && functions.length > 0 ? "auto" : undefined,
      temperature: 0,
      max_completion_tokens: 800,
    }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
};

const callAI = async (model: string, msgs: Msg[], useTools = true) => {
    const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_KEY) {
        throw new Error("OPENAI_API_KEY not configured.");
    }
    return await callOpenAI(OPENAI_KEY, model, msgs, useTools);
};

const sendWA = async (key: string, to: string, from: string, msg: string) => {
  const cleanTo = normalizePhone(to);
  const cleanFrom = normalizePhone(from);
  const r = await fetch("https://api.ycloud.com/v2/whatsapp/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": key },
    body: JSON.stringify({
      from: cleanFrom,
      to: cleanTo,
      type: "text",
      text: { body: msg },
    }),
  });
  if (!r.ok) {
    const errText = await r.text();
    let friendlyError = errText;
    if (r.status === 401) {
      friendlyError = "CRITICAL: YCloud Unauthorized (401). Check API Key and Account Balance/Status.";
    }
    console.error(
      `[sendWA] Error sending to ${cleanTo} from ${cleanFrom}:`,
      friendlyError,
    );
    throw new Error(friendlyError);
  }
  return r.json();
};

// =============================================
// Main Webhook Handler
// =============================================
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Fix: GET endpoint removed — it exposed debug_logs publicly with no auth.
  // To inspect logs use the Supabase dashboard or a service-role authenticated query.
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ status: "method_not_allowed" }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  const sb = getSupabase();

  try {
    // --- SECURITY: Read raw body once, then verify YCloud HMAC signature ---
    // We must read as text first so we can verify the signature over the exact
    // bytes YCloud signed, then parse JSON from the same string.
    let rawBody = "";
    let p: any;
    try {
      rawBody = await req.text();
      if (!rawBody || rawBody.trim() === "") {
        console.warn("Received empty body, ignoring.");
        return new Response(
          JSON.stringify({ status: "ok", message: "Empty body ignored" }),
          { headers: corsHeaders },
        );
      }
      p = JSON.parse(rawBody);
    } catch (e) {
      console.warn("Received non-JSON body, ignoring.");
      return new Response(
        JSON.stringify({ status: "ok", message: "Invalid JSON ignored" }),
        { headers: corsHeaders },
      );
    }

    // Verify YCloud webhook signature (HMAC-SHA256) per clinic.
    // Only real YCloud inbound messages carry a signature — the simulator does not.
    // Detection: real YCloud payloads always have `whatsappInboundMessage`.
    if (p.type === "whatsapp.inbound_message.received" && p.whatsappInboundMessage) {
      const toNumber = p.whatsappInboundMessage.to || "";
      const { data: clinicForVerify } = await sb
        .from("clinic_settings")
        .select("ycloud_webhook_secret")
        .eq("ycloud_phone_number", toNumber)
        .maybeSingle();
      const clinicSecret = clinicForVerify?.ycloud_webhook_secret || "";
      const signatureHeader = req.headers.get("YCloud-Signature");
      const signatureValid = await verifyYCloudSignature(rawBody, signatureHeader, clinicSecret);
      if (!signatureValid) {
        console.error("[SECURITY] Rejected webhook — invalid signature for number:", toNumber);
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: corsHeaders,
        });
      }
    }

    // Log incoming payload for debugging
    await debugLog(sb, `Incoming payload`, p);

    // --- DELIVERY STATUS EVENTS (whatsapp.message.updated) ---
    // YCloud reporta el estado real de cada mensaje saliente (sent → delivered →
    // read, o failed/undelivered) vía este evento. Antes se descartaba, por lo que
    // reminder_logs quedaba fijo en 'sent' aunque Meta rechazara el mensaje.
    // Aquí actualizamos el estado real en reminder_logs y messages, y retornamos.
    if (p.type === "whatsapp.message.updated" && p.whatsappMessage) {
      const wm = p.whatsappMessage;
      const ycloudId: string = wm.id || "";
      const rawStatus: string = (wm.status || "").toLowerCase();
      const fromNumber: string = wm.from || "";

      // Verificar firma HMAC per-clínica (buscada por el número emisor).
      // Modo permisivo igual que inbound: sin secret configurado → warn y continúa.
      const { data: clinicForVerify } = await sb
        .from("clinic_settings")
        .select("ycloud_webhook_secret")
        .eq("ycloud_phone_number", fromNumber)
        .maybeSingle();
      const statusSecret = (clinicForVerify as any)?.ycloud_webhook_secret || "";
      if (statusSecret) {
        const sigHeader = req.headers.get("YCloud-Signature");
        const sigValid = await verifyYCloudSignature(rawBody, sigHeader, statusSecret);
        if (!sigValid) {
          console.error("[SECURITY] Rejected status event — invalid signature for:", fromNumber);
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: corsHeaders,
          });
        }
      } else {
        console.warn("[status] No webhook secret for", fromNumber, "— accepting status event permissively");
      }

      if (ycloudId && rawStatus) {
        const isFailure = rawStatus === "failed" || rawStatus === "undelivered";
        const errMsg = wm.errorMessage || wm.whatsappApiError?.message || null;
        const errCode = wm.errorCode || wm.whatsappApiError?.code || null;

        if (isFailure) {
          const failText = errCode ? `[${errCode}] ${errMsg || "Message undeliverable"}` : (errMsg || "Message undeliverable");
          // Fallo terminal: sobrescribe cualquier estado previo.
          await sb.from("reminder_logs")
            .update({ status: "failed", error_message: failText })
            .eq("ycloud_message_id", ycloudId);
          await sb.from("messages")
            .update({ status: "failed" })
            .eq("ycloud_message_id", ycloudId);
          // `reminders` = recordatorios médicos (PART 4 del cron). No tiene columna
          // de mensaje de error, solo status.
          await sb.from("reminders")
            .update({ status: "failed" })
            .eq("ycloud_message_id", ycloudId);
        } else if (rawStatus === "delivered" || rawStatus === "read") {
          // Escalón positivo. No pisar un 'failed' terminal (los eventos llegan
          // fuera de orden y repetidos): solo actualizar filas aún no fallidas.
          await sb.from("reminder_logs")
            .update({ status: rawStatus })
            .eq("ycloud_message_id", ycloudId)
            .neq("status", "failed");
          await sb.from("messages")
            .update({ status: rawStatus })
            .eq("ycloud_message_id", ycloudId)
            .neq("status", "failed");
          await sb.from("reminders")
            .update({ status: rawStatus })
            .eq("ycloud_message_id", ycloudId)
            .neq("status", "failed");
        }
        // rawStatus === "sent" se ignora: ya se registró al momento de enviar.
      }

      return new Response(JSON.stringify({ status: "status_processed" }), {
        headers: corsHeaders,
      });
    }

    // Los eventos de eco de la app de negocio no requieren procesamiento.
    if (p.type === "whatsapp.smb.message.echoes") {
      return new Response(JSON.stringify({ status: "ignored_echo" }), {
        headers: corsHeaders,
      });
    }

    // --- NEW: UNIVERSAL DISPATCHER (Supports YCloud and Vetly Simulator) ---
    let from = "";
    let to = "";
    let text = "";
    let type = "";
    let latitude: number | undefined;
    let longitude: number | undefined;
    let ctwaClid: string | undefined = undefined;

    if (
      p.type === "whatsapp.inbound_message.received" && p.whatsappInboundMessage
    ) {
      const m = p.whatsappInboundMessage;
      from = m.from || "";
      to = m.to || "";
      type = m.type || "";
      ctwaClid = m.referral?.ctwa_clid || undefined;
      if (m.type === "text") text = m.text?.body || "";
      if (m.type === "location") {
        latitude = m.location?.latitude;
        longitude = m.location?.longitude;
      }
      
      // Handle revoke (message deleted by user)
      if (m.type === "revoke") {
        await debugLog(sb, `Message Revoked (Deleted by user)`, { msgId: m.id, from });
        return new Response(JSON.stringify({ status: "ignored_revoke" }), {
          headers: corsHeaders,
        });
      }
    } else if (p.from && p.text) {
      // Simulator fallback
      from = p.from;
      to = p.to || "simulator";
      text = typeof p.text === "string" ? p.text : p.text.body;
      type = "text";
    } else {
      await debugLog(sb, "Unrecognized payload structure", p);
      return new Response(
        JSON.stringify({
          status: "ignored",
          message: "Unrecognized payload structure",
        }),
        { headers: corsHeaders },
      );
    }

    if (!from) {
      return new Response(JSON.stringify({ status: "ignored" }), {
        headers: corsHeaders,
      });
    }

    const clinic = await getClinic(sb, to);

    if (!clinic) {
      await debugLog(sb, "Clinic not found", { phone: to });
      return new Response(
        JSON.stringify({ status: "ignored", reason: "clinic_not_found" }),
        { headers: corsHeaders, status: 200 },
      );
    }

    const msgId = p.whatsappInboundMessage?.id || `sim-${Date.now()}-${from}`;
    let msgRowId: string | null = null;
    let immediateContext: any = null;

    // 1. ATOMIC IDEMPOTENCY LOCK: Try to insert the inbound message NOW.
    // If it fails due to UNIQUE constraint on ycloud_message_id, it's already being handled.
    try {
      msgRowId = await saveMsg(sb, clinic.id, from, text, "inbound", {
        ycloud_message_id: msgId,
        message_type: type,
        ai_generated: false,
      });
      console.log(`[WEBHOOK] Locked and processing: ${msgId} (row: ${msgRowId})`);
    } catch (e: any) {
      if (e.message?.includes("unique_ycloud_message_id")) {
        console.warn(`[WEBHOOK] Ignored duplicate message ID: ${msgId}`);
        return new Response(JSON.stringify({ status: "ignored_duplicate" }), {
          headers: corsHeaders,
        });
      }
      console.error(`[WEBHOOK] SaveMsg lock error:`, e.message);
    }

    // Check if this user is already a known Tutor (Client)
    const { data: tutor } = await sb.from("tutors")
      .select(
        "id, name, referred_by, referral_code, portal_token, loyalty_points, ctwa_clid, capi_lead_sent_at, capi_purchase_sent_at, patients(id, name, species)",
      )
      .eq("clinic_id", clinic.id)
      .eq("phone_number", from)
      .limit(1)
      .maybeSingle();

    // Fetch recent appointments for this client
    const { data: recentAppts } = await sb.from("appointments")
      .select("appointment_date, service, status, notes")
      .eq("clinic_id", clinic.id)
      .eq("phone_number", from)
      .order("appointment_date", { ascending: false })
      .limit(3);

    let tutorContext = "";
    if (tutor) {
      const petNames = tutor.patients?.map((p: any) =>
        `${p.name} (${p.species || "mascota"})`
      ).join(", ");

      const nowLocal = new Date().toLocaleString("en-CA", { timeZone: clinic.timezone || "America/Santiago" }).split(',')[0];
      let hasPendingAppointmentToday = false;

      const apptHistory = (recentAppts || []).map((a: any) => {
        const d = new Date(a.appointment_date);
        const apptDateStr = d.toLocaleString("en-CA", { timeZone: clinic.timezone || "America/Santiago" }).split(',')[0];
        let statusMarker = "";
        
        if (apptDateStr === nowLocal && (a.status === 'pending' || a.status === 'confirmed')) {
            statusMarker = " (PENDIENTE PARA HOY)";
            hasPendingAppointmentToday = true;
        } else if (d > new Date() && (a.status === 'pending' || a.status === 'confirmed')) {
            statusMarker = " (FUTURA)";
        } else {
            statusMarker = " (PASADA)";
        }

        return `- ${d.toLocaleDateString("es-CL")}: ${a.service} (${a.status})${statusMarker}${a.notes ? ` Obs: ${a.notes}` : ""}`;
      }).join("\n");

      tutorContext =
        `\n\n### CLIENTE RECONOCIDO: ${tutor.name} ###\n` +
        `Mascotas registradas: ${petNames || "ninguna aún"}.\n` +
        `Historial de Citas:\n${apptHistory || "Sin citas previas registradas."}\n` +
        `INSTRUCCIÓN: Trátalo como cliente recurrente. Si tuvo una cita reciente, pregúntale cómo sigue su mascota (Post-Venta).\n`;

      if (hasPendingAppointmentToday) {
        tutorContext += `[¡ATENCIÓN CRÍTICA! ESTE CLIENTE TIENE UNA CITA PENDIENTE PARA HOY. Si dice "voy en camino", "estoy llegando" o manda su ubicación, NO le pidas datos para agendar ni actúes como si fuera la primera vez. Confírmale que el equipo está avisado y esperándolo.]\n`;
      }

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
    }

    // ===== REFERRAL CODE DETECTION =====
    // Detect a 6-char uppercase alphanumeric code (e.g. DBD77A) in the first message.
    // If the tutor has no referrer yet, look up the code and mark referred_by.
    let referralContext = "";
    if (!tutor?.referred_by) {
      const refMatch = (text || "").match(/\b([A-Za-z0-9]{6})\b/g);
      if (refMatch) {
        const normalizedSender = normalizePhone(from);
        for (const rawCode of refMatch) {
          const code = rawCode.toUpperCase();
          const { data: referrer } = await sb.from("tutors")
            .select("id, name")
            .eq("clinic_id", clinic.id)
            .eq("referral_code", code)
            .limit(1)
            .maybeSingle();
          if (referrer && referrer.id) {
            if (tutor) {
              // Tutor exists: mark referred_by (only if not already set)
              await sb.from("tutors")
                .update({ referred_by: referrer.id })
                .eq("id", tutor.id)
                .is("referred_by", null);
            } else {
              // Tutor doesn't exist yet: create minimal record with referred_by
              await sb.from("tutors").upsert({
                clinic_id: clinic.id,
                phone_number: normalizedSender,
                name: "Sin nombre",
                referred_by: referrer.id,
              }, { onConflict: "clinic_id,phone_number", ignoreDuplicates: false });
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

    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
    const googleMapsApiKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
    if (!openaiApiKey) {
      await debugLog(sb, "Missing global OPENAI_API_KEY", {
        clinic_id: clinic.id,
      });
      return new Response(JSON.stringify({ error: "Missing config" }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    let body = text;
    let isImage = false;
    let base64ImageObj: any = null;
    let payloadExtra: any = {};

    const msgObj = p.whatsappInboundMessage;
    if (msgObj?.type === "audio" && msgObj.audio) {
      try {
        // If link exists, use it, otherwise fall back to fetching via ID
        let downloadUrl = msgObj.audio.link;
        if (!downloadUrl) {
          downloadUrl =
            `https://api.ycloud.com/v2/whatsapp/media/${msgObj.audio.id}`;
        }
        const blob = await downloadYCloudMedia(
          downloadUrl,
          clinic.ycloud_api_key,
        );
        body = await transcribeAudioData(blob, openaiApiKey);
        await debugLog(sb, `Audio transcribed`, { body });
      } catch (e) {
        console.error("Audio error", e);
        body =
          "[Mensaje de audio que no pude procesar. Pide amablemente que te escriban.]";
      }
    } else if (msgObj?.type === "image" && msgObj.image) {
      try {
        let downloadUrl = msgObj.image.link;
        if (!downloadUrl) {
          downloadUrl =
            `https://api.ycloud.com/v2/whatsapp/media/${msgObj.image.id}`;
        }
        const blob = await downloadYCloudMedia(
          downloadUrl,
          clinic.ycloud_api_key,
        );
        const arrayBuffer = await blob.arrayBuffer();
        const base64 = btoa(
          new Uint8Array(arrayBuffer).reduce(
            (data, byte) => data + String.fromCharCode(byte),
            "",
          ),
        );
        base64ImageObj = {
          type: "image_url",
          image_url: {
            url: `data:${blob.type || "image/jpeg"};base64,${base64}`,
          },
        };
        payloadExtra = {
          image_base64: `data:${blob.type || "image/jpeg"};base64,${base64}`,
        };
        body = msgObj.image?.caption ||
          "[La persona te acaba de enviar una imagen]";
        isImage = true;
        await debugLog(sb, `Image received`, { type: blob.type });
      } catch (e) {
        console.error("Image error", e);
        body =
          "[La persona envió una imagen pero no pude verla. Pídele que te describa lo que envió.]";
      }
    } else if (msgObj?.type === "button" && msgObj.button) {
      body = msgObj.button.text || msgObj.button.payload || "";
    } else if (msgObj?.type === "interactive" && msgObj.interactive) {
      const interactive = msgObj.interactive;
      if (interactive.type === "button_reply") {
        body = interactive.button_reply?.title || interactive.button_reply?.id || "";
      } else if (interactive.type === "list_reply") {
        body = interactive.list_reply?.title || "";
      }
    } else if (msgObj.type === "location" && msgObj.location) {
      const loc = msgObj.location;
      const lat = loc.latitude;
      const lng = loc.longitude;
      let detectedCity = "";
      let formattedAddress = "";

      try {
        const mapsKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
        if (mapsKey) {
          const geoRes = await fetch(
            `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${mapsKey}&language=es`,
          );
          const geoData = await geoRes.json();
          if (geoData.status === "OK" && geoData.results?.length > 0) {
            formattedAddress = geoData.results[0].formatted_address;
            const locality = geoData.results[0].address_components.find((c: any) =>
              c.types.includes("locality") || c.types.includes("administrative_area_level_2")
            );
            if (locality) detectedCity = locality.long_name;
          }
        }
      } catch (e) {
        console.error("Geocoding failed", e);
      }

      body = `📍 [UBICACIÓN COMPARTIDA: ${formattedAddress || "Ver Mapa"}]`;

      await sb.from("crm_prospects").update({
        address: formattedAddress || `Coords: ${lat}, ${lng}`,
        updated_at: new Date().toISOString(),
      }).eq("clinic_id", clinic.id).or(`phone.eq.${from},phone.eq.+${from.replace(/^\+/, "")}`);

      immediateContext = {
        gps: { lat, lng },
        aiContext: `[SISTEMA: GPS RECIBIDO - UBICACIÓN: ${formattedAddress || "Validada"} - CIUDAD: ${detectedCity}]`
      };

      await debugLog(sb, `Location received and saved`, {
        lat,
        lng,
        address: formattedAddress,
        city: detectedCity,
      });

      // --- PERSIST COORDINATES FOR FOLLOW-UP TOOLS ---
      const normalizedPhone = normalizePhone(from).trim();
      const geoUpdates = {
        latitude: lat,
        longitude: lng,
        address: formattedAddress || `GPS: ${lat},${lng}`,
      };

      await sb.from("tutors").update(geoUpdates).eq("clinic_id", clinic.id).eq(
        "phone_number",
        normalizedPhone,
      );
      await sb.from("crm_prospects").update(geoUpdates).eq(
        "clinic_id",
        clinic.id,
      ).eq("phone", normalizedPhone);

      // Location processing complete
    }

    // Add context from Facebook Ad referral if present
    if (msgObj.referral) {
      const headline = msgObj.referral.headline || "";
      const adBody = msgObj.referral.body || "";
      const adContext = `[Mensaje desde Anuncio: "${headline}" - ${adBody}]`
        .trim();
      body = `${adContext}\n${body}`.trim();
    }

    // --- NEW: GOOGLE MAPS LINK DETECTION (SYNC WITH SIMULATOR) ---
    const msgLow = (body || "").toLowerCase();
    if (
      msgLow.includes("maps.app.goo.gl") || msgLow.includes("google.com/maps")
    ) {
      await debugLog(sb, `Link Detector Found`, { body });
      
      // Extract the actual URL to avoid fetch errors if there's text around it
      const urlMatch = (body || "").match(/https?:\/\/(?:maps\.app\.goo\.gl|www\.google\.com\/maps)[^\s]+/);
      const urlToResolve = urlMatch ? urlMatch[0] : body;

      let resolvedCoords = await resolveGoogleMapsUrl(urlToResolve);

      if (resolvedCoords && resolvedCoords.lat !== 0) {
        const { lat, lng } = resolvedCoords;

        // --- ENHANCED MULTI-HUB DISTANCE CALCULATION ---
        // No hardcoded hubs
        const gpsContext = `[SISTEMA: GPS VALIDADO VIA LINK - COORDENADAS: ${lat}, ${lng}]`;

        payloadExtra.ai_context = (payloadExtra.ai_context || "") +
          `\n${gpsContext}`;

        // PERSIST COORDINATES FROM LINK
        const normalized = normalizePhone(from).trim();
        await sb.from("tutors").update({
          latitude: lat,
          longitude: lng,
          address: `Link Maps: ${lat},${lng}`,
        }).eq("clinic_id", clinic.id).eq("phone_number", normalized);
      }
    }

    if (msgRowId) {
      await sb.from("messages").update({
        content: body,
        message_type: msgObj.type,
        payload: payloadExtra,
      }).eq("id", msgRowId);
    }

    // --- WHATSAPP QUICK REPLY BUTTON INTERCEPTION ---
    if ((msgObj?.type === "interactive" && msgObj.interactive?.type === "button_reply") || msgObj?.type === "button") {
      const lowerTitle = (body || "").toLowerCase();

      // ---- SATISFACTION SURVEY BUTTONS ----
      // Map button titles to numeric ratings
      const surveyRatingMap: Record<string, number> = {
        "excelente": 5,
        "bueno": 3,
        "regular": 1,
        "mal": 1,
        "regular / mal": 1,
      };
      const matchedRatingKey = Object.keys(surveyRatingMap).find(k => lowerTitle.includes(k));

      if (matchedRatingKey) {
        const score = surveyRatingMap[matchedRatingKey];
        const normalizedPhone = normalizePhone(from);

        // Find the most recent open survey for this phone
        const { data: openSurvey } = await sb
          .from("satisfaction_surveys")
          .select("id, clinic_id")
          .or(`phone_number.eq.${from},phone_number.eq.${normalizedPhone},phone_number.eq.+${normalizedPhone}`)
          .eq("status", "sent")
          .order("sent_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (openSurvey) {
          // Update rating and mark as responded
          await sb.from("satisfaction_surveys").update({
            rating: score,
            status: "responded",
            responded_at: new Date().toISOString(),
          }).eq("id", openSurvey.id);
        }

        // Save inbound button message
        await sb.from("messages").insert({
          clinic_id: clinic.id,
          phone_number: from,
          direction: "inbound",
          content: body,
          message_type: "button",
        });

        let replyMsg = "";

        if (score === 5) {
          // Excellent — thank them warmly and close
          replyMsg = `¡Qué alegría escuchar eso! 😊🐾 Nos esforzamos cada día para darle la mejor atención a ${tutor?.name ? tutor.name.split(" ")[0] + " y su" : "tu"} mascota. ¡Hasta la próxima!`;
          await sendWA(clinic.ycloud_api_key, from, clinic.ycloud_phone_number || to, replyMsg);
          await sb.from("messages").insert({
            clinic_id: clinic.id,
            phone_number: from,
            direction: "outbound",
            content: replyMsg,
            ai_generated: true,
            status: "sent",
          });
          return new Response(JSON.stringify({ status: "survey_excellent" }), { headers: corsHeaders });

        } else if (score === 3) {
          // Good — acknowledge and ask if there's anything to improve
          replyMsg = `¡Gracias por tu respuesta! 😊 Nos alegra que haya sido una buena experiencia. Si hay algo en lo que podamos mejorar, con gusto te escuchamos. 🐾`;
          await sendWA(clinic.ycloud_api_key, from, clinic.ycloud_phone_number || to, replyMsg);
          await sb.from("messages").insert({
            clinic_id: clinic.id,
            phone_number: from,
            direction: "outbound",
            content: replyMsg,
            ai_generated: true,
            status: "sent",
          });
          return new Response(JSON.stringify({ status: "survey_good" }), { headers: corsHeaders });

        } else {
          // Bad rating — ask for details and flag for human review
          replyMsg = `Lamentamos que tu experiencia no haya sido la mejor 😔. Para nosotros es muy importante mejorar. ¿Nos podrías contar qué fue lo que no estuvo bien? Tu comentario nos ayuda mucho.`;
          await sendWA(clinic.ycloud_api_key, from, clinic.ycloud_phone_number || to, replyMsg);
          await sb.from("messages").insert({
            clinic_id: clinic.id,
            phone_number: from,
            direction: "outbound",
            content: replyMsg,
            ai_generated: true,
            status: "sent",
          });
          // Flag conversation for human review
          await sb.from("conversations").update({ requires_human: true })
            .eq("clinic_id", clinic.id)
            .eq("phone_number", from);
          return new Response(JSON.stringify({ status: "survey_bad_pending_feedback" }), { headers: corsHeaders });
        }
      }
      // ---- END SATISFACTION SURVEY BUTTONS ----

      // Detect appointment confirmation
      if (lowerTitle.includes("confirmo") || lowerTitle.includes("confirmar") || lowerTitle === "sí" || lowerTitle === "si") {
        const confirmRes = await confirmAppt(sb, clinic.id, from, "yes");
        await sendWA(clinic.ycloud_api_key, from, clinic.ycloud_phone_number || to, confirmRes.message);
        await sb.from("messages").insert({
          clinic_id: clinic.id,
          phone_number: from,
          direction: "outbound",
          content: confirmRes.message,
          ai_generated: true,
          status: "sent",
          metadata: { type: "system_confirmation" }
        });
        return new Response(JSON.stringify({ status: "confirmed_via_button" }), { headers: corsHeaders });
      } 
      // Detect cancellation
      else if (lowerTitle.includes("no confirmo") || lowerTitle.includes("cancelar") || lowerTitle === "no") {
        const cancelRes = await confirmAppt(sb, clinic.id, from, "no");
        await sendWA(clinic.ycloud_api_key, from, clinic.ycloud_phone_number || to, cancelRes.message);
        await sb.from("messages").insert({
          clinic_id: clinic.id,
          phone_number: from,
          direction: "outbound",
          content: cancelRes.message,
          ai_generated: true,
          status: "sent",
          metadata: { type: "system_cancellation" }
        });
        return new Response(JSON.stringify({ status: "cancelled_via_button" }), { headers: corsHeaders });
      }
    }

    // CRM auto-sync restored: Create prospect if not exists and not a tutor
    if (!tutor) {
      try {
        const { data: existingProspect, error: pError } = await sb.from("crm_prospects")
          .select("id")
          .eq("clinic_id", clinic.id)
          .or(`phone.eq.${from},phone.eq.${searchPhone},phone.eq.${searchPhoneNoPlus}`)
          .limit(1)
          .maybeSingle();

        if (!existingProspect && !pError) {
          // Get the default stage for this clinic
          const { data: stages } = await sb.from("crm_pipeline_stages")
            .select("id")
            .eq("clinic_id", clinic.id)
            .order("position", { ascending: true })
            .limit(1);
          
          const defaultStageId = stages?.[0]?.id;

          await sb.from("crm_prospects").insert({
            clinic_id: clinic.id,
            phone: from,
            name: (msgObj.text?.body || "").split(" ").slice(0, 3).join(" ") || "Nuevo Lead",
            source: "whatsapp",
            stage_id: defaultStageId,
            requires_human: false
          });
          console.log(`[CRM_SYNC] Created new prospect for ${from}`);
        }
      } catch (err) {
        console.error("[CRM_SYNC] Error during auto-sync:", err);
      }
    }

    // ===== META CAPI: persistir ctwa_clid del primer contacto =====
    // Meta solo adjunta este dato en el mensaje que resulta de tocar el anuncio.
    // El agendamiento real ocurre varios mensajes (y varias invocaciones del webhook) después,
    // así que hay que guardarlo ahora para poder recuperarlo cuando se dispare el evento Purchase.
    if (ctwaClid && !tutor?.ctwa_clid) {
      if (tutor) {
        await sb.from("tutors").update({ ctwa_clid: ctwaClid }).eq("id", tutor.id).is(
          "ctwa_clid",
          null,
        );
      } else {
        await sb.from("tutors").upsert({
          clinic_id: clinic.id,
          phone_number: normalizePhone(from),
          name: "Sin nombre",
          ctwa_clid: ctwaClid,
        }, { onConflict: "clinic_id,phone_number", ignoreDuplicates: false });
      }
    }

    // ===== META CAPI: LeadSubmitted — solo cuando viene de un anuncio C2W (ctwa_clid requerido) =====
    // Antes se disparaba con el primer mensaje de cualquier contacto nuevo, lo que hacia
    // que "cliente potencial" fuera indistinguible de "conversacion iniciada": Meta optimizaba
    // hacia gente que solo saludaba. Filtrar por palabras clave (comuna, precio, servicio) no
    // sirve — el 98,5% de los leads medidos las menciona. Lo que si discrimina es que el tutor
    // sostenga la conversacion, asi que el evento espera a LEAD_MIN_INBOUND mensajes suyos.
    //
    // El mensaje actual ya fue guardado mas arriba (saveMsg), asi que entra en el conteo.
    const leadCtwaClid = tutor?.ctwa_clid || ctwaClid;
    if (
      leadCtwaClid && !tutor?.capi_lead_sent_at &&
      clinic.meta_pixel_id && clinic.meta_capi_token
    ) {
      const LEAD_MIN_INBOUND = 3;
      const { count: inboundCount } = await sb.from("messages")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinic.id)
        .eq("phone_number", from)
        .eq("direction", "inbound");

      if ((inboundCount ?? 0) >= LEAD_MIN_INBOUND) {
        const capiResult = await sendMetaCAPIEvent(
          clinic.meta_pixel_id,
          clinic.meta_capi_token,
          "LeadSubmitted",
          from,
          leadCtwaClid,
          undefined,
          clinic.meta_test_event_code || undefined,
          clinic.meta_page_id || undefined,
        );
        // Se marca aunque Meta rechace: reintentar en cada mensaje siguiente solo
        // duplicaria el evento si el rechazo fue parcial.
        await sb.from("tutors")
          .update({ capi_lead_sent_at: new Date().toISOString() })
          .eq("clinic_id", clinic.id)
          .eq("phone_number", from)
          .is("capi_lead_sent_at", null);
        await debugLog(
          sb,
          `[META CAPI] LeadSubmitted(qualified, ${inboundCount} msgs) result for ${from}`,
          capiResult,
        );
      }
    }

    if (!clinic.ai_auto_respond) {
      return new Response(JSON.stringify({ status: "saved" }), {
        headers: corsHeaders,
      });
    }

    // ── Cuota de créditos IA ──────────────────────────────────────────────────
    // Se comprueba ANTES de llamar a OpenAI: hasta la sesión 76 el chequeo vivía
    // dentro de saveMsg (después de generar la respuesta) y era un console.warn
    // sin return, así que el agente seguía respondiendo gratis indefinidamente.
    // Una sola verificación por turno, no por iteración del tool loop: cortar a
    // mitad dejaría tool calls ya ejecutados (una cita creada, por ejemplo) sin
    // respuesta final al tutor.
    //
    // Al agotarse: silencio hacia el tutor y aviso a la clínica. El mensaje
    // entrante ya se guardó más arriba, así que queda en Mensajes para responder
    // a mano.
    const creditStatus = await getCreditStatus(sb, clinic.id);
    if (creditStatus.exhausted) {
      await notifyCreditsExhausted(sb, clinic.id, creditStatus.poolId);
      console.warn(
        `[YCloud] Créditos agotados (pool ${creditStatus.poolId}: ${creditStatus.totalUsed}/${creditStatus.limit + creditStatus.extraBalance}) — no se responde a ${from}`,
      );
      return new Response(JSON.stringify({ status: "credits_exhausted" }), {
        headers: corsHeaders,
      });
    }

    // VERIFY IF HUMAN IS REQUIRED (Silent IA) - CHECK BOTH TUTORS AND PROSPECTS
    const searchPhone = from.startsWith("+") ? from : `+${from}`;
    const searchPhoneNoPlus = from.startsWith("+") ? from.substring(1) : from;

    const [tutorHandRes, prospectHandRes] = await Promise.all([
      sb.from("tutors")
        .select("requires_human")
        .eq("clinic_id", clinic.id)
        .or(
          `phone_number.eq.${from},phone_number.eq.${searchPhone},phone_number.eq.${searchPhoneNoPlus}`,
        )
        .limit(1)
        .maybeSingle(),
      sb.from("crm_prospects")
        .select("requires_human")
        .eq("clinic_id", clinic.id)
        .or(
          `phone.eq.${from},phone.eq.${searchPhone},phone.eq.${searchPhoneNoPlus}`,
        )
        .limit(1)
        .maybeSingle(),
    ]);

    // 1. Initial Pause Check
    const isPaused = tutorHandRes.data?.requires_human ||
      prospectHandRes.data?.requires_human;
    const lowerBody = (msgObj.text?.body || "").toLowerCase().trim();

    // 2. Command: Reset IA
    // 2. Command: Reset IA (Case-insensitive)
    if (
      lowerBody === "resetear_ia" || lowerBody === "resetear ia" ||
      lowerBody === "reset_ia"
    ) {
      await Promise.all([
        sb.from("tutors").update({ requires_human: false }).eq(
          "clinic_id",
          clinic.id,
        ).or(
          `phone_number.eq.${searchPhone},phone_number.eq.${searchPhoneNoPlus}`,
        ),
        sb.from("crm_prospects").update({ requires_human: false }).eq(
          "clinic_id",
          clinic.id,
        ).or(`phone.eq.${searchPhone},phone.eq.${searchPhoneNoPlus}`),
      ]);
      await sendWA(
        clinic.ycloud_api_key,
        from,
        clinic.ycloud_phone_number || to,
        "✅ IA Reactivada. Ya puedes volver a consultarme.",
      );
      return new Response(JSON.stringify({ status: "reset_applied" }), {
        headers: corsHeaders,
      });
    }

    // 3. Auto-Reactivate Logic (for Welcome Messages)
    let effectivePaused = isPaused;
    if (
      isPaused && (lowerBody.includes("hola") || lowerBody.includes("buen"))
    ) {
      const { data: lastMsgs } = await sb.from("messages")
        .select("content")
        .eq("clinic_id", clinic.id)
        .eq("phone_number", from)
        .eq("direction", "outbound")
        .order("created_at", { ascending: false })
        .limit(1);

      const lastContent = lastMsgs?.[0]?.content || "";
      if (lastContent.includes("Gracias por escribirnos") || lastContent.includes("Vetly")) {
        await Promise.all([
          sb.from("tutors").update({ requires_human: false }).eq("clinic_id", clinic.id).or(
            `phone_number.eq.${searchPhone},phone_number.eq.${searchPhoneNoPlus}`,
          ),
          sb.from("crm_prospects").update({ requires_human: false }).eq("clinic_id", clinic.id).or(
            `phone.eq.${searchPhone},phone.eq.${searchPhoneNoPlus}`,
          ),
        ]);
        await debugLog(
          sb,
          `Auto-reactivated AI for ${from} (last was auto-reply)`,
          { lastContent },
        );
        effectivePaused = false;
      }
    }

    if (effectivePaused) {
      await debugLog(
        sb,
        `IA silenciosa: Handoff a humano activo para ${from}`,
        { phone: from },
      );
      return new Response(
        JSON.stringify({ status: "saved_silently", reason: "requires_human" }),
        { headers: corsHeaders },
      );
    }

    const asyncProcess = async (
      immediateContext?: {
        gps: { lat: number; lng: number };
        ruralMins: number;
        aiContext: string;
      },
    ) => {
      let targetModel = "gpt-4o-mini";
      let modelForTracking = "mini";
      try {
        const realClinicId = clinic.ref_id || clinic.id;
        const googleMapsApiKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
        // DEBOUNCE / HUMANIZE - WAIT FOR 20 SECONDS
        await new Promise((r) => setTimeout(r, 20000));

        // CHECK IF A NEWER USER MESSAGE ARRIVED WHILE WE WAITED
        const { data: latestMsg } = await sb.from("messages")
          .select("id")
          .eq("clinic_id", clinic.id)
          .or(`phone_number.eq.${from},phone_number.eq.+${from}`)
          .eq("direction", "inbound")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (latestMsg && msgRowId && latestMsg.id !== msgRowId) {
          // WE ARE NOT THE LATEST MESSAGE! Abort silently and let the latest one handle everything.
          console.log(`[asyncProcess] Aborting: current msgRowId ${msgRowId} is not latest ${latestMsg.id}`);
          await debugLog(sb, `Debounced message`, { current: msgRowId, latest: latestMsg.id });
          return;
        }

        // requires_human — re-chequeo post-debounce: capta el clic en "Silenciar IA"
        // ocurrido durante los 20s de espera.
        if (await isPausedForHuman(sb, clinic.id, from)) {
          console.log(`[asyncProcess] requires_human=true for ${from}, skipping AI (post-debounce)`);
          return;
        }

        // --- GENERIC LOGISTICS ENGINE ---
        let logisticsConfig: any = clinic.logistics_config || null;
        try {
          if (!logisticsConfig || Object.keys(logisticsConfig).length === 0) {
            const logMatch = (clinic.ai_behavior_rules || "").match(/\[LOGISTICS_CONFIG\]([\s\S]*?)\[\/LOGISTICS_CONFIG\]/);
            if (logMatch) {
              logisticsConfig = JSON.parse(logMatch[1]);
            }
          }
        } catch (e) {
          console.error("Failed to parse logistics config:", e);
        }

        // --- GLOBAL GEOGRAPHICAL PERSISTENCE ---
        let globalGPS = immediateContext?.gps || null;
        let globalLocContext = immediateContext?.aiContext || "";
        
        // If we don't have immediate context, try historical lookup
        if (!globalGPS) {
          try {
            const { data: gpsMsg } = await sb.from("messages")
              .select("payload")
              .eq("clinic_id", clinic.id)
              .or(`phone_number.eq.${from},phone_number.eq.+${from}`)
              .not("payload", "is", null)
              .order("created_at", { ascending: false });
            
            if (gpsMsg) {
              for (const m of gpsMsg) {
                const p = m.payload as any;
                if (p && p.gps) {
                  globalGPS = p.gps;
                  break;
                }
              }
            }
          } catch (e) {
            console.error("Error fetching global GPS:", e);
          }
        }

        // --- AT THIS POINT, WE ARE THE LATEST MESSAGE. BEGIN PROCESSING. ---
        const { data: rawHistory } = await sb.from("messages")
          .select("content, direction, created_at, ai_generated, payload")
          .eq("clinic_id", clinic.id)
          .or(`phone_number.eq.${from},phone_number.eq.+${from.replace(/^\+/, "")}`)
          .order("created_at", { ascending: false })
          .limit(20);
        
        let history = (rawHistory || []).reverse();

        // Se calcula temprano (antes se calculaba mucho más abajo, después de usarse
        // en el bloque de encuesta/forced-knowledge, lo que lanzaba ReferenceError por
        // TDZ en cada mensaje). orderedMsgs/burstInbound dependen solo de `history`,
        // que ya está disponible aquí y no se reasigna en el resto de la función.
        const orderedMsgs = history;
        let lastOutboundIndex = -1;
        for (let i = orderedMsgs.length - 1; i >= 0; i--) {
          if (orderedMsgs[i].direction === "outbound") {
            lastOutboundIndex = i;
            break;
          }
        }
        const pastContext = lastOutboundIndex >= 0
          ? orderedMsgs.slice(0, lastOutboundIndex + 1)
          : [];
        const burstInbound = lastOutboundIndex >= 0
          ? orderedMsgs.slice(lastOutboundIndex + 1)
          : orderedMsgs;

        // Generic Map Link Processing
        const lastUserMsg = [...history].reverse().find(m => m.direction === "inbound" && !m.ai_generated);
        if (lastUserMsg && googleMapsApiKey && (lastUserMsg.content.includes("maps.app.goo.gl") || lastUserMsg.content.includes("google.com/maps"))) {
          const urlMatch = lastUserMsg.content.match(/https?:\/\/(?:maps\.app\.goo\.gl|www\.google\.com\/maps)[^\s]+/);
          if (urlMatch) {
             const resolvedCoords = await resolveGoogleMapsUrl(urlMatch[0]);
             if (resolvedCoords) {
                globalGPS = resolvedCoords;
                globalLocContext = `[SISTEMA: GPS RECIBIDO VIA LINK - COORDENADAS: ${globalGPS.lat}, ${globalGPS.lng}]`;
             }
          }
        }

        // --- PERFORM LOGISTICS CALCULATIONS IF GPS IS AVAILABLE ---
        if (globalGPS && logisticsConfig && googleMapsApiKey) {
          try {
            const urbanBases = logisticsConfig.locations?.filter((l: any) => l.type === 'operational') || logisticsConfig.urban_bases || [];
            const surgeryHubs = logisticsConfig.locations?.filter((l: any) => l.type === 'surgical_hub') || logisticsConfig.surgery_hubs || [];

            const [urbanResults, surgeryResults] = await Promise.all([
              Promise.all(urbanBases.map(async (base: any) => {
                const details = await getTravelDetails(`${base.lat},${base.lng}`, `${globalGPS.lat},${globalGPS.lng}`);
                return { ...base, ...details };
              })),
              Promise.all(surgeryHubs.map(async (hub: any) => {
                const details = await getTravelDetails(`${hub.lat},${hub.lng}`, `${globalGPS.lat},${globalGPS.lng}`);
                return { ...hub, ...details };
              })),
            ]);

            const closestUrban = urbanResults.sort((a, b) => (a.duration || 999) - (b.duration || 999))[0];
            const closestSurgery = surgeryResults.sort((a, b) => (a.duration || 999) - (b.duration || 999))[0];

            await debugLog(sb, `Logistics Search Results`, { 
                urbanCount: urbanResults.length, 
                surgeryCount: surgeryResults.length,
                closestUrban: closestUrban?.name,
                duration: closestUrban?.duration 
            });

            if (closestUrban) {
              const duration = closestUrban.duration || 0;
              let logNote = `[LOGÍSTICA: Base Urbana: ${closestUrban.name} | Tiempo al Centro: ${duration} min]`;
              
              if (closestUrban.time_ranges && closestUrban.time_ranges.length > 0) {
                 const range = closestUrban.time_ranges.find((r: any) => duration >= r.min && duration <= r.max);
                 if (range) {
                    logNote += ` [RECARGO TRASLADO CORRESPONDIENTE: $${range.surcharge} (${range.label})]`;
                 } else {
                    const maxRange = closestUrban.time_ranges[closestUrban.time_ranges.length - 1];
                    if (duration > maxRange.max) {
                       logNote += ` [ALERTA: FUERA DE RADIO. Tiempo excede el límite máximo de ${maxRange.max} min. Informar al cliente que su ubicación está fuera del área de cobertura estándar.]`;
                    }
                 }
              } else {
                 const threshold = closestUrban.urban_threshold !== undefined ? closestUrban.urban_threshold : 10;
                 const extraMins = Math.max(0, duration - threshold);
                 if (extraMins === 0) {
                     logNote += ` [RECARGO TRASLADO CORRESPONDIENTE: $0 (Radio Urbano)]`;
                 } else {
                     // Si supera el threshold y no hay time_ranges, aplicamos fórmula antigua asumiendo $1000 por minuto extra aprox,
                     // pero para ser seguros solo informamos los minutos y dejamos que la regla de la IA aplique el precio.
                     logNote += ` | Extra Ciudad: +${extraMins} min`;
                 }
              }

              if (closestSurgery) {
                logNote += `\n[LOGÍSTICA: Pabellón más cercano: ${closestSurgery.name} a ${closestSurgery.duration} min]`;
              }
              globalLocContext = logNote;

              // Persist this calculation back to the message so it stays in history
              if (lastUserMsg) {
                await sb.from("messages").update({
                  payload: {
                    ...(lastUserMsg.payload || {}),
                    ai_context: globalLocContext,
                    gps: globalGPS
                  }
                }).eq("id", (lastUserMsg as any).id);
              }
            }
          } catch (e) {
            console.error("Logistics calculation error:", e);
          }
        }

        // Context update for AI if we have any new context
        if (globalLocContext && lastUserMsg) {
           // We already updated above, but ensuring consistency
        }


        // Check if we already answered this exact same prompt recently to avoid loops
        if (history.length >= 2) {
          const lastMsg = history[history.length - 1];
          const prevMsg = history[history.length - 2];
          if (
            lastMsg.direction === "outbound" &&
            lastMsg.content === "¡Hola! ¿En qué puedo ayudarle hoy?"
          ) {
            // Potencial loop detectado - forzar un comportamiento más directo
          }
        }

        const clinicTz = clinic.timezone || "America/Santiago";
        const now = new Date();
        const localTime = now.toLocaleString("es-CL", {
          timeZone: clinicTz,
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });

        // Pre-calculate dates for AI (CRITICAL: use timezone-aware day names, NOT getDay() which is UTC!)
        const localDateISO = now.toLocaleDateString("en-CA", {
          timeZone: clinicTz,
        });
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const dayAfter = new Date(now.getTime() + 48 * 60 * 60 * 1000);
        const tomorrowISO = tomorrow.toLocaleDateString("en-CA", {
          timeZone: clinicTz,
        });
        const dayAfterISO = dayAfter.toLocaleDateString("en-CA", {
          timeZone: clinicTz,
        });
        const todayDay = now.toLocaleDateString("es-CL", {
          timeZone: clinicTz,
          weekday: "long",
        });
        const tomorrowDay = tomorrow.toLocaleDateString("es-CL", {
          timeZone: clinicTz,
          weekday: "long",
        });
        const dayAfterDay = dayAfter.toLocaleDateString("es-CL", {
          timeZone: clinicTz,
          weekday: "long",
        });

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
            // Ver meta-whatsapp-webhook para el detalle: sin la etiqueta relativa el
            // modelo tomaba el primer día del plan como "hoy" y corría todo un día.
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

        // Fetch knowledge base summary for system prompt
        const knowledgeSummary = await getKnowledgeSummary(sb, clinic.id);

        // Fetch REAL services from the 'clinic_services' table (not the legacy JSON field)
        // ORDER BY id: sin esto Postgres no garantiza el mismo orden de filas entre
        // llamadas — un orden que cambiara silenciosamente (autovacuum, HOT update)
        // rompería el prefijo del prompt y anularía el prompt caching de OpenAI.
        const { data: realServices } = await sb.from("clinic_services")
          .select("name, duration, price, ai_description")
          .eq("clinic_id", clinic.id)
          .order("id", { ascending: true });

        // Se omiten los campos vacíos en vez de rellenarlos con texto placeholder: hoy
        // el 100% de los servicios tiene ai_description en null, así que emitir
        // "Sin detalles específicos." en cada uno agregaba ~1.900 caracteres de ruido al
        // prompt en CADA llamada a OpenAI (y el prompt se reenvía completo en cada
        // iteración del tool loop). Igual para duracion cuando es 0.
        const servicesForPrompt = realServices && realServices.length > 0
          ? realServices.map((s) => {
            const item: Record<string, string> = { nombre: s.name };
            if (s.duration) item.duracion = `${s.duration} min`;
            item.precio = `$${s.price.toLocaleString("es-CL")}`;
            if (s.ai_description) item.info_importante = s.ai_description;
            return item;
          })
          : clinic.services || [];

        // Build a readable string of hours in SPANISH to match the AI rules and context
        const daysMap: Record<string, string> = {
          monday: "lunes",
          tuesday: "martes",
          wednesday: "miércoles",
          thursday: "jueves",
          friday: "viernes",
          saturday: "sábado",
          sunday: "domingo",
        };

        const hoursSummary = Object.entries(clinic.working_hours || {})
          .map(([day, h]: [string, any]) => {
            const dayName = daysMap[day.toLowerCase()] || day;
            if (!h || h.closed || h.enabled === false) {
              return `${dayName}: CERRADO`;
            }
            const lunch = h.lunch_break;
            return `${dayName}: ${h.open || h.start || "10:00"} - ${h.close || h.end || "18:30"}${
              lunch?.enabled ? ` (Colación: ${lunch.start}-${lunch.end})` : ""
            }`;
          }).join(", ");
        // La hora de cierre de arriba NO es la última hora agendable: el último slot
        // COMIENZA en logistics_config.last_slot_time (18:00 por defecto). Sin esta nota
        // la IA promete citas a las 19:00 que no existen (bug real, sesión 95).
        const rawPromptSlotCap = (clinic?.logistics_config as any)?.last_slot_time;
        const promptSlotCap = typeof rawPromptSlotCap === "string" &&
            /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(rawPromptSlotCap.trim())
          ? rawPromptSlotCap.trim().slice(0, 5)
          : "18:00";
        const lastSlotNote = `\n⚠️ ÚLTIMA CITA AGENDABLE DEL DÍA: la última visita que se puede agendar COMIENZA a las ${promptSlotCap} hrs. El equipo puede terminar de atender más tarde, pero NO se agenda ninguna visita que empiece después de esa hora. La hora de "cierre" de arriba NO es la última hora agendable. TERMINANTEMENTE PROHIBIDO ofrecer, prometer, "coordinar con la coordinadora" o enviar en la solicitud de agenda cualquier horario posterior a las ${promptSlotCap}. Si el tutor solo puede después de las ${promptSlotCap}, dile con claridad: "La última visita que agendamos comienza a las ${promptSlotCap} hrs" y ofrece esa hora o un día alternativo — nunca insinúes que se puede más tarde.`;

        // --- SURVEY FEEDBACK CONTEXT ---
        // Check if this client has a recent survey pending feedback (score=1, status=responded, no feedback_context yet)
        const normalizedFromPhone = normalizePhone(from);
        const { data: pendingFeedbackSurvey } = await sb
          .from("satisfaction_surveys")
          .select("id, rating")
          .or(`phone_number.eq.${from},phone_number.eq.${normalizedFromPhone},phone_number.eq.+${normalizedFromPhone}`)
          .eq("status", "responded")
          .lte("rating", 2)
          .is("feedback_context", null)
          .order("responded_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        // If the client replied after a bad-rating survey, save their text as feedback_context
        if (pendingFeedbackSurvey && burstInbound.length > 0) {
          const feedbackText = burstInbound.map(m => m.content || "").join(" ").trim();
          if (feedbackText) {
            await sb.from("satisfaction_surveys")
              .update({ feedback_context: feedbackText })
              .eq("id", pendingFeedbackSurvey.id);
          }
        }

        // Texto de los mensajes entrantes recientes, usado para detectar si corresponde
        // forzar alguno de los 3 documentos KB de riesgo (cirugía/sedación/visita fallida).
        // Se escanean los últimos ~20 mensajes del tutor (orderedMsgs), no solo el burst
        // actual: en una cotización real, el tutor dice "quiero esterilizar" en un turno
        // y da el peso/ubicación varios turnos después — si solo se mirara el burst
        // actual, la palabra clave ya no estaría presente justo cuando la IA calcula
        // el precio final, y el bloqueo forzado nunca se activaría.
        const recentUserText = orderedMsgs
          .filter((m) => m.direction === "inbound")
          .map((m) => m.content || "")
          .join(" ");
        const forcedKnowledgeBlock = await getForcedKnowledgeBlock(sb, clinic.id, recentUserText);

        const surveyFeedbackContextBlock = pendingFeedbackSurvey
          ? `
⚠️ CONTEXTO ESPECIAL — ENCUESTA DE SATISFACCIÓN NEGATIVA ⚠️
Este cliente acaba de calificar su última atención con una puntuación baja (${pendingFeedbackSurvey.rating} estrella/s).
Ya recibió el mensaje de disculpa automático. Tu rol ahora es:
1. Escuchar activamente. Si el cliente comparte una queja o comentario, AGRADÉCELE por la retroalimentación.
2. Muestra empatía genuina y brevedad. No prometas cosas que no puedes cumplir.
3. Si el problema es clínico (medicación, evolución, procedimiento), usa escalate_to_human para que el equipo lo atienda directamente.
4. Si el cliente simplemente quiere desahogarse, escúchalo y despídete cordialmente.
5. NO inicies un nuevo flujo de agendamiento ni intentes vender nada en este contexto.
`
          : "";

        // --- BLOQUE ESTÁTICO (idéntico entre mensajes/tutores de esta clínica) ---
        // Va SIEMPRE primero. OpenAI aplica prompt caching (~50% descuento en input)
        // cuando el PREFIJO de la llamada es byte-a-byte igual al de una llamada
        // reciente — pero el descuento se pierde desde el primer carácter que difiere.
        // Con ai_behavior_rules solo de esta clínica en ~39.000 caracteres, reenviado
        // en cada mensaje Y en cada iteración del tool loop (hasta 5 por turno), tener
        // contenido variable (hora, geo del tutor) ANTES de este bloque anulaba el
        // cache para TODO el prompt en cada llamada. Ver sección "Bloque dinámico" abajo.
        const staticSysPrompt = `
${clinic.ai_personality || "Eres un asistente veterinario profesional."}

Clínica: ${clinic.clinic_name}
Dirección: ${clinic.clinic_address || clinic.address || "No especificada."}
Horarios: ${hoursSummary}${lastSlotNote}${clinic.contact_phone ? `\nTeléfono de Contacto Clínico: ${clinic.contact_phone} (Entrégalo si el cliente pide llamar o hablar con un humano)` : ""}${clinic.transfer_details ? `\nDatos de Pago/Transferencia: ${clinic.transfer_details}` : ""}

⚠️ PROTOCOLOS DE ATENCIÓN Y REGLAS DE COMPORTAMIENTO ⚠️
${(clinic.ai_behavior_rules || "").replace(/`/g, "'")}
--------------------------------------------------------

LISTA OFICIAL DE SERVICIOS Y PRECIOS:
${JSON.stringify(servicesForPrompt)}

BASE DE CONOCIMIENTO (PROTOCOLOS Y DETALLES ACTUALIZADOS):
${knowledgeSummary}

⚠️ NOTA PARA IA: Si existe una discrepancia entre la 'Lista Oficial' y la 'Base de Conocimiento', prioriza SIEMPRE la Base de Conocimiento, ya que contiene los protocolos y valores más recientemente actualizados por el equipo médico.
${routePlanBlock}${forcedKnowledgeBlock}${loyaltyRulesBlock}`;

        // --- BLOQUE DINÁMICO (cambia por mensaje/tutor) ---
        // SIEMPRE después del bloque estático — nunca antes — para no romper el cache.
        const dynamicSysPrompt = `

CONTEXTO DE FECHAS:
- HOY: ${todayDay}, ${localDateISO}
- MAÑANA: ${tomorrowDay}, ${tomorrowISO}
- PASADO MAÑANA: ${dayAfterDay}, ${dayAfterISO}
- HORA ACTUAL: ${localTime}
${surveyFeedbackContextBlock}`;

        const sysPromptHQ = `Eres un Asesor Especialista de Vetly. Tu meta es que el prospecto descubra por sí mismo que NECESITA mejorar su gestión, y que Vetly es el camino más sencillo.`;

        // --- MOTOR DE PERSISTENCIA GEOGRÁFICA GLOBAL ---
        // globalLocContext es específico del tutor/conversación actual — va en la cola
        // dinámica, nunca antepuesto al bloque estático (ver nota de prompt caching arriba).
        const finalSysPrompt = (clinic.id === HQ_ID ? sysPromptHQ : (
          staticSysPrompt + dynamicSysPrompt +
          (globalLocContext ? `\n\n### INFO SISTEMA: GEO-DATA ###\n${globalLocContext}` : "")
        )) + (tutorContext || "") + (referralContext || "");

        await debugLog(sb, `Prompt Construction`, { 
            hasLoc: !!globalLocContext, 
            locContext: globalLocContext,
            services: servicesForPrompt,
            knowledgeSnippet: knowledgeSummary.substring(0, 500),
            totalLen: finalSysPrompt.length 
        });

        const historyArr = (history && Array.isArray(history)) ? history : [];

        const msgs: Msg[] = [
          { role: "system", content: finalSysPrompt },
          ...pastContext.map((m) => {
            let content = m.content || "";
            // Capture persisted geographical context from payload
            const aiExtra = m.payload?.ai_context || "";
            if (aiExtra) {
              content = `${content}\n${aiExtra}`;
            }
            return {
              role: (m.direction === "inbound" ? "user" : "assistant") as
                | "user"
                | "assistant",
              content,
            };
          }),
        ];

        // Combine the current inbound burst into a single user message
        let userContentBlocks: any[] = [];
        for (const msg of burstInbound) {
          let text = msg.content || "";
          if (msg.payload?.ai_context) {
            text = `${text}\n${msg.payload.ai_context}`;
          }

          if (msg.message_type === "image" && msg.payload?.image_base64) {
            userContentBlocks.push({ type: "text", text: text || "[Imagen]" });
            userContentBlocks.push({
              type: "image_url",
              image_url: { url: msg.payload.image_base64 },
            });
          } else {
            userContentBlocks.push({ type: "text", text: text || "" });
          }
        }

        if (userContentBlocks.length > 0) {
          msgs.push({ role: "user", content: userContentBlocks });
        }

        // --- INTELLIGENT MODEL ROUTING ---
        targetModel = "gpt-4o-mini";
        let tierUsed = 1;

        if (clinic.ai_active_model === "hybrid") {
          const lastUserText = userContentBlocks.map(b => b.text || "").join(" ");
          const hasImageInBurst = userContentBlocks.some(b => b.type === "image_url");

          // Detect if we're mid-booking: if any of the last 6 messages (outbound)
          // contain scheduling signals, keep the whole flow on 4o for coherence.
          // This prevents the case where a user says "perfecto" mid-agenda and mini
          // loses the routing context built up in the previous 4o turn.
          const recentOutbound = orderedMsgs
            .filter(m => m.direction === "outbound")
            .slice(-3)
            .map(m => (m.content || "").toLowerCase());
          const schedulingSignals = [
            "cita", "agend", "disponib", "horario", "slot", "hora disponible",
            "reserv", "sector", "direcci", "ubicaci", "traslado", "zona",
            "comuna", "cobertura", "recargo", "castr", "cirug", "esteril",
            "vacun", "antirrabi", "octuple", "sextuple", "triple felina",
          ];
          const activeSchedulingFlow = recentOutbound.some(msg =>
            schedulingSignals.some(s => msg.includes(s))
          );

          // Mensajes triviales ("sí", "gracias", "ok"...) no necesitan razonamiento, pero
          // costaban igual que cualquier otro mensaje del modelo caro por la ventana
          // "pegajosa" de 3 mensajes de arriba. Verificado con datos reales (sesión 85):
          // el 56% de estos mensajes respondían a un mensaje de la IA que NO ofrecía
          // ninguna hora/fecha concreta — ahí no hay nada que confirmar, se puede bajar
          // a mini sin riesgo real. Si el mensaje previo SÍ ofreció hora/fecha, se
          // mantiene en el modelo caro a propósito: podría ser la confirmación de un
          // horario real, y ese es justo el escenario donde mini ya falló antes.
          const trivialAckPattern = /^(si|sí|ok|okay|oka|dale|listo|gracias|muchas gracias|perfecto|genial|bueno|vale|ya|de acuerdo|entendido)[\s!.,¡🙏😊👍✨]*$/i;
          const lastOutboundText = recentOutbound[recentOutbound.length - 1] || "";
          const lastOutboundOfferedTime = /\d{1,2}:\d{2}|a las \d{1,2}|lunes|martes|mi[eé]rcoles|jueves|viernes/.test(lastOutboundText);
          const trimmedUserText = lastUserText.trim();
          const isSafeTrivialAck = !hasImageInBurst && trimmedUserText.length > 0 && trimmedUserText.length <= 20
            && trivialAckPattern.test(trimmedUserText) && !lastOutboundOfferedTime;

          const route = isSafeTrivialAck
            ? { model: "gpt-4o-mini", tier: 1 }
            : selectModelTier(lastUserText, hasImageInBurst, activeSchedulingFlow);
          targetModel = route.model;
          tierUsed = route.tier;

          console.log(
            `[Router] hybrid | activeFlow=${activeSchedulingFlow} | text="${lastUserText.substring(0, 60)}" | → ${targetModel} (tier ${tierUsed})`
          );
        } else if (clinic.ai_active_model === "pro") {
          targetModel = "gpt-4o";
          tierUsed = 3;
        } else {
          // "mini" mode: always mini
          targetModel = "gpt-4o-mini";
          tierUsed = 1;
        }

        // Granular tracking for hybrid cost table
        modelForTracking = (targetModel === "gpt-4o")
          ? (tierUsed === 3 ? "4o_pro" : "4o_standard")
          : "mini";

        console.log(`[Router] Strategy: ${clinic.ai_active_model} | Selected Tier ${tierUsed} (${targetModel}) -> Tracking as: ${modelForTracking}`);

        const blockedTools: string[] = [];

        let res = await callAI(
          targetModel,
          msgs,
          true,
        );
        let assistant = res.choices[0].message;
        let funcResult: Record<string, unknown> | null = null;
        let allFuncResults: Record<string, unknown>[] = [];

        // Handle function/tool calls (support multiple sequential calls)
        let maxCalls = 5;
        while ((assistant.function_call || (assistant.tool_calls && assistant.tool_calls.length > 0)) && maxCalls > 0) {
          const assistantMsg = { ...assistant, role: "assistant" };
          msgs.push(assistantMsg);

          if (assistant.tool_calls && assistant.tool_calls.length > 0) {
            for (const toolCall of assistant.tool_calls) {
              const fnName = toolCall.function.name;
              const fnArgs = JSON.parse(toolCall.function.arguments);
              
              const result = await processFunc(
                sb,
                clinic.id,
                from,
                fnName,
                fnArgs,
                clinic.timezone || "America/Santiago",
                clinic,
                msgs,
              );

              allFuncResults.push({ name: fnName, result });

              msgs.push({
                role: "tool",
                tool_call_id: toolCall.id,
                name: fnName,
                content: JSON.stringify(result),
              });
            }
          } else if (assistant.function_call) {
            // Legacy fallback
            const fnName = assistant.function_call.name;
            const fnArgs = JSON.parse(assistant.function_call.arguments);
            
            const result = await processFunc(
              sb,
              clinic.id,
              from,
              fnName,
              fnArgs,
              clinic.timezone || "America/Santiago",
              clinic,
              msgs,
            );

            allFuncResults.push({ name: fnName, result });

            msgs.push({
              role: "function",
              name: fnName,
              content: JSON.stringify(result),
            });
          }

          // Recursive call for next step
          res = await callAI(
            targetModel,
            msgs,
            true,
          );
          assistant = res.choices[0].message;
          maxCalls--;
        }

        // ===== META CAPI: Purchase event — solo cuando viene de anuncio C2W (ctwa_clid requerido) =====
        // El clic al anuncio casi nunca coincide con el mismo mensaje que agenda la cita
        // (son invocaciones separadas del webhook), así que se usa el ctwa_clid persistido
        // en el tutor desde el primer contacto, con fallback al de este mensaje por si acaso.
        // El guard capi_purchase_sent_at evita duplicar con la edge function
        // meta-capi-purchase, que cubre las citas creadas a mano desde el dashboard.
        const effectiveCtwaClid = tutor?.ctwa_clid || ctwaClid;
        if (
          effectiveCtwaClid && !tutor?.capi_purchase_sent_at &&
          clinic.meta_pixel_id && clinic.meta_capi_token
        ) {
          const apptResult = allFuncResults.find(
            (r: any) => r.name === "create_appointment" && r.result?.success === true,
          );
          if (apptResult) {
            const capiLeadResult = await sendMetaCAPIEvent(
              clinic.meta_pixel_id,
              clinic.meta_capi_token,
              "Purchase",
              from,
              effectiveCtwaClid,
              { content_name: (apptResult.result as any)?.service_name },
              clinic.meta_test_event_code || undefined,
              clinic.meta_page_id || undefined,
            );
            await sb.from("tutors")
              .update({ capi_purchase_sent_at: new Date().toISOString() })
              .eq("clinic_id", clinic.id)
              .eq("phone_number", from)
              .is("capi_purchase_sent_at", null);
            await debugLog(sb, `[META CAPI] Purchase(appointment) result for ${from}`, capiLeadResult);
          }
        }

        let reply = assistant.content || "Error. ¿Puedes repetir?";
        const diagnosticLine = "";

        const finalReply = diagnosticLine + reply;

        // requires_human — última barrera antes de enviar: el tool loop de OpenAI puede
        // tardar decenas de segundos y el clic en "Silenciar IA" pudo ocurrir mientras tanto.
        if (await isPausedForHuman(sb, clinic.id, from)) {
          console.log(`[asyncProcess] requires_human=true for ${from}, discarding reply (pre-send)`);
          return;
        }

        await saveMsg(sb, clinic.id, from, finalReply, "outbound", {
          ai_generated: true,
          ai_function_called: allFuncResults.length > 0
            ? allFuncResults.map((r) => (r as Record<string, unknown>).name)
              .join(", ")
            : null,
          ai_function_result: allFuncResults.length > 0 ? allFuncResults : null,
        }, modelForTracking);

        await sendWA(
          clinic.ycloud_api_key,
          from,
          clinic.ycloud_phone_number || to,
          finalReply,
        );
        await debugLog(sb, `AI Response Sent`, { to: from, msgId: msgRowId });
      } catch (err) {
        console.error("Async Process Error:", err);
        await debugLog(sb, "Async Process Error (OpenAI/Otros)", {
          error: (err as Error).message,
          phone: from,
        });

        // Respond to user so it doesn't stay silent
        const fallbackReply =
          "Lo siento, tuve un problema técnico procesando tu mensaje. Por favor intenta consultarme en unos minutos.";
        await saveMsg(sb, clinic.id, from, fallbackReply, "outbound", {
          error_fallback: true,
        }, targetModel);
        await sendWA(
          clinic.ycloud_api_key,
          from,
          clinic.ycloud_phone_number || to,
          fallbackReply,
        ).catch((e) => console.error("Failed sending fallback WA:", e));
      }
    };

    // @ts-ignore: EdgeRuntime is available in Supabase edge functions
    if (
      typeof EdgeRuntime !== "undefined" &&
      typeof EdgeRuntime.waitUntil === "function"
    ) {
      // @ts-ignore
      EdgeRuntime.waitUntil(asyncProcess(immediateContext));
    } else {
      asyncProcess(immediateContext);
    }

    return new Response(JSON.stringify({ status: "processing_async" }), {
      headers: corsHeaders,
    });
  } catch (e) {
    console.error(e);
    const sb = getSupabase();
    await debugLog(sb, "Internal Error", { error: (e as Error).message });
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});

