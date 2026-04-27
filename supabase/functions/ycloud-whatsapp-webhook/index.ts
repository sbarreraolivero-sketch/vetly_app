import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
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
  role: "system" | "user" | "assistant" | "function";
  content: string | any[];
  name?: string;
  function_call?: { name: string; arguments: string };
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
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
): Promise<{ duration: number; distance: number }> => {
  if (!GOOGLE_MAPS_API_KEY) return { duration: 0, distance: 0 };
  try {
    const url =
      `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin.lat},${origin.lng}&destinations=${destination.lat},${destination.lng}&key=${GOOGLE_MAPS_API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.status === "OK" && data.rows[0].elements[0].status === "OK") {
      return {
        duration: data.rows[0].elements[0].duration.value, // seconds
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
          description: "Nombre completo del tutor/dueño",
        },
        patient_name: { type: "string", description: "Nombre de la mascota" },
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

  // Convert gpt-4o-mini to 'mini' and gpt-4o to '4o' for our simplified model tracking
  const simplifiedModel = aiModel === "gpt-4o-mini"
    ? "mini"
    : (aiModel === "gpt-4o" ? "4o" : null);
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
    // 1. Try partial match
    let found = allServices.find((s) =>
      s.name.toLowerCase().includes(name.toLowerCase())
    );

    // 2. Try matching by the first/last word (fuzzy fallback)
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
      // Logically fallback to a standard block if it sounds like a service
      totalDuration += 30;
      matchedNames.push(name);
    }
  }

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

  const { data: clinic } = await sb.from("clinic_settings").select(
    "business_model, latitude, longitude, logistics_config",
  ).eq("id", clinicId).single();
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
        clinicBase = { lat: nearestLoc.lat, lng: nearestLoc.lng, name: nearestLoc.name };
        console.log(`[checkAvail] Nearest ${isSurgery ? 'Hub' : 'Base'} found: ${nearestLoc.name} (${minDistance.toFixed(2)}km away)`);
      }
    } else {
      // Legacy fallback
      clinicBase = finalLogistics.base_coordinates || (clinic?.latitude && clinic?.longitude
        ? { lat: Number(clinic.latitude), lng: Number(clinic.longitude) }
        : null);
    }
  }

  // FEAT: Use Fuzzy/Multiple Service Matching
  const serviceDetails = await getServiceDetails(
    sb,
    clinicId,
    serviceName || "",
  );
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

  if (professionalId) {
    try {
      const { data, error } = await sb.rpc("get_professional_available_slots", {
        p_clinic_id: String(clinicId).trim(),
        p_member_id: String(professionalId).trim(),
        p_date: String(date).trim(),
        p_duration: duration,
        p_interval: searchInterval,
        p_timezone: String(timezone).trim(),
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

  if (date === localDate) {
    // Determine buffer based on address/zone
    const addressLower = (address || "").toLowerCase();
    const isRemote = ["talca", "maule", "san javier", "villa alegre"].some(
      (z) => addressLower.includes(z),
    );
    const bufferMinutes = isRemote ? 120 : 60;
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
  // appointment_date stores full timestamps, must use gte/lte range (not eq)
  const { data: existingAppts } = await sb.from("appointments")
    .select("appointment_time")
    .eq("clinic_id", clinicId)
    .gte("appointment_date", `${date}T00:00:00`)
    .lte("appointment_date", `${date}T23:59:59`)
    .neq("status", "cancelled");

  const bookedTimes = (existingAppts || [])
    .map((a: any) => (a.appointment_time || "").substring(0, 5))
    .filter(Boolean);
  if (bookedTimes.length > 0) {
    console.log(
      `[checkAvail] Found ${bookedTimes.length} real appointments, filtering slots...`,
    );
    filteredSlots = filteredSlots.filter((s: { slot_time: string }) =>
      !bookedTimes.includes(s.slot_time.substring(0, 5))
    );
  }

  // Fetch day summary for better routing logic
  const { data: dayApptsSummary } = await sb.from("appointments")
    .select("address, status")
    .eq("clinic_id", clinicId)
    .gte("appointment_date", `${date}T00:00:00`)
    .lte("appointment_date", `${date}T23:59:59`)
    .neq("status", "cancelled");

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
    // Fetch appointments for that day with coordinates and duration
    const { data: dayAppts } = await sb.from("appointments")
      .select("id, latitude, longitude, appointment_date, duration")
      .eq("clinic_id", clinicId)
      .gte("appointment_date", `${date}T00:00:00`)
      .lte("appointment_date", `${date}T23:59:59`)
      .neq("status", "cancelled")
      .not("latitude", "is", null)
      .order("appointment_date", { ascending: true });

    const TRAVEL_BUFFER_MINUTES = 10; // Extra buffer for parking, etc.

    // For each available slot, verify if there's enough time to travel to/from it
    const finalValidSlots = [];
    for (const slot of filteredSlots) {
      const slotStart = new Date(`${date}T${slot.slot_time}`);
      const slotEnd = new Date(slotStart.getTime() + (duration * 60000));

      // 1. Find Prev and Next appointment relative to this slot
      const prevAppt = dayAppts?.filter((a) =>
        new Date(a.appointment_date) < slotStart
      ).slice(-1)[0];
      const nextAppt = dayAppts?.filter((a) =>
        new Date(a.appointment_date) >= slotEnd
      )[0];

      // 2. Determine Origins and Destinations
      const originLocation = prevAppt
        ? { lat: Number(prevAppt.latitude), lng: Number(prevAppt.longitude) }
        : clinicBase;
      const destinationLocation = nextAppt
        ? { lat: Number(nextAppt.latitude), lng: Number(nextAppt.longitude) }
        : clinicBase;

      let isPossible = true;

      // 3. Check Travel from Origin (Prev Appt or Clinic Base)
      if (originLocation) {
        let travelTimeMinutes = 30; // Default fallback
        try {
          const travelDetails = await getTravelDetails(
            originLocation,
            tutorCoords,
          );
          travelTimeMinutes = Math.ceil(travelDetails.duration / 60);
        } catch (err) {
          console.error(
            "[checkAvail] Google Maps API failed (Origin), using fallback:",
            err,
          );
        }
        const travelTime = travelTimeMinutes * 60;

        // CRITICAL FIX: If date is TODAY, we must also ensure we have enough time FROM NOW to reach the slot
        const isToday = date ===
          new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(
            new Date(),
          );
        const now = new Date();

        let availableGapSecs = 0;
        if (prevAppt) {
          availableGapSecs = (slotStart.getTime() -
            (new Date(prevAppt.appointment_date).getTime() +
              (prevAppt.duration * 60000))) / 1000;
        } else if (isToday) {
          // If no prev appt today, we start travel FROM NOW (or from clinic start, whichever is later)
          const clinicStartToday = new Date(`${date}T08:00:00`);
          const travelStartBase = now > clinicStartToday
            ? now
            : clinicStartToday;
          availableGapSecs = (slotStart.getTime() - travelStartBase.getTime()) /
            1000;
        } else {
          availableGapSecs =
            (slotStart.getTime() - new Date(`${date}T08:00:00`).getTime()) /
            1000; // Assume 8 AM start if no prev on future days
        }

        if (availableGapSecs < (travelTime + (TRAVEL_BUFFER_MINUTES * 60))) {
          isPossible = false;
        }
      }

      // 4. Check Travel to Next (Next Appt or Clinic Base)
      if (isPossible && destinationLocation) {
        let travelTimeMinutes = 30; // Default fallback
        try {
          const travelDetails = await getTravelDetails(
            tutorCoords,
            destinationLocation,
          );
          travelTimeMinutes = Math.ceil(travelDetails.duration / 60);
        } catch (err) {
          console.error(
            "[checkAvail] Google Maps API failed (Destination), using fallback:",
            err,
          );
        }
        const travelTime = travelTimeMinutes * 60;

        const availableGapSecs = nextAppt
          ? (new Date(nextAppt.appointment_date).getTime() -
            slotEnd.getTime()) / 1000
          : (new Date(`${date}T20:00:00`).getTime() - slotEnd.getTime()) / 1000; // Assume 8 PM end if no next

        if (availableGapSecs < (travelTime + (TRAVEL_BUFFER_MINUTES * 60))) {
          isPossible = false;
        }
      }

      if (isPossible) {
        finalValidSlots.push(slot);
        if (prevAppt || nextAppt) {
          recommendedSlot = `(Optimizado para su zona)`;
        }
      }
    }

    // --- EMERGENCY FALLBACK ---
    // If the mobile/travel filter is too restrictive or fails, show all slots
    if (finalValidSlots.length === 0 && filteredSlots.length > 0) {
      console.log(
        `[checkAvail] Mobile filter returned 0 but agenda has ${filteredSlots.length} slots. Falling back to open agenda.`,
      );
      finalValidSlots.push(...filteredSlots);
      recommendedSlot = `(Sujeto a confirmación de ruta logística)`;
    }

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

  const displaySlots = availableFormatted.slice(0, 15);
  const routingMsg = recommendedSlot
    ? `📍 Contamos con disponibilidad ese día en su zona. `
    : "";

  let travelInfo = null;
  if (tutorCoords && clinicBase) {
    try {
      const td = await getTravelDetails(clinicBase, tutorCoords);
      travelInfo = {
        distance_km: (td.distance / 1000).toFixed(1),
        travel_time_minutes: Math.ceil(td.duration / 60),
      };
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
          const locConfig = finalLogistics.locations?.find((l: any) => 
            l.lat === clinicBase.lat && l.lng === clinicBase.lng
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
    patient_name: string;
    date: string;
    time: string;
    service_name: string;
    address?: string;
    tutor_name?: string;
    professional_name?: string;
    notes?: string;
  },
  timezone: string = "America/Santiago",
  refId?: string,
  logisticsConfig?: any,
) => {
  const normalizedPhone = normalizePhone(phone);

  // Save address if provided in creation
  if (args.address) {
    await sb.from("tutors").update({ address: args.address }).eq(
      "clinic_id",
      clinicId,
    ).eq("phone_number", normalizedPhone);
    await sb.from("crm_prospects").update({ address: args.address }).eq(
      "clinic_id",
      clinicId,
    ).eq("phone", normalizedPhone);
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

  // Get coordinates from tutor if they exist
  const { data: tutorGeo } = await sb.from("tutors")
    .select("latitude, longitude, name, address")
    .eq("clinic_id", clinicId)
    .eq("phone_number", normalizedPhone)
    .limit(1)
    .maybeSingle();

  const { data, error } = await sb.from("appointments").insert({
    clinic_id: clinicId,
    patient_name: args.patient_name,
    tutor_name: args.tutor_name || tutorGeo?.name || null,
    phone_number: normalizedPhone,
    service: args.service_name,
    appointment_date: appointmentDateWithOffset,
    address: args.address || tutorGeo?.address || null,
    status: "pending",
    duration: duration,
    price: price,
    professional_id: professionalId,
    latitude: tutorGeo?.latitude || null,
    longitude: tutorGeo?.longitude || null,
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
  const { data: appt } = await sb.from("appointments").select("*").eq(
    "clinic_id",
    clinicId,
  ).eq("phone_number", normalizedPhone).eq("status", "pending").gte(
    "appointment_date",
    new Date().toISOString(),
  ).order("appointment_date", { ascending: true }).limit(1).single();
  if (!appt) return { message: "No hay citas pendientes." };
  const status = response === "yes" ? "confirmed" : "cancelled";
  await sb.from("appointments").update({
    status,
    confirmation_received: true,
    confirmation_response: response,
  }).eq("id", appt.id);
  return status === "confirmed"
    ? { message: "¡Cita confirmada! 😊" }
    : { message: "Cita cancelada. ¿Reagendar?" };
};

// CRM logic removed to simplify clinical flow

const getKnowledge = async (
  sb: ReturnType<typeof createClient>,
  clinicId: string,
  query: string,
) => {
  try {
    const { data: clinic } = await sb.from("clinics").select("ref_id").eq(
      "id",
      clinicId,
    ).single();
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

    let queryBuilder = sb.from("knowledge_base")
      .select("title, content, category")
      .eq("clinic_id", clinicId)
      .eq("status", "active");

    if (searchKeywords.length > 0) {
      const orFilters = searchKeywords.flatMap((kw) => [
        `title.ilike.%${kw}%`,
        `content.ilike.%${kw}%`,
        `category.ilike.%${kw}%`,
      ]).join(",");
      queryBuilder = queryBuilder.or(orFilters);
    }

    const { data: docs } = await queryBuilder.limit(10);
    if (!docs || docs.length === 0) return "";

    const rankedDocs = docs.map((d) => {
      let score = 0;
      const docText = `${d.title} ${d.content} ${d.category}`.toLowerCase();
      allKeywords.forEach((kw) => {
        if (d.title.toLowerCase().includes(kw)) score += 10;
        if (d.category?.toLowerCase().includes(kw)) score += 5;
        if (d.content.toLowerCase().includes(kw)) score += 1;
      });
      return { ...d, score };
    }).sort((a, b) => b.score - a.score).slice(0, 5);

    let content = rankedDocs.map((d: any) =>
      `📄 ${d.title} (${d.category}):\n${d.content}`
    ).join("\n\n---\n\n");

    return content;
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
      title: "Atención Requerida 🚨",
      message:
        `El paciente ${normalizedPhone} fue derivado a humano por la IA.`,
      link: `/app/messages?phone=${normalizedPhone}`,
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

    // 2. Find the patient by phone number and clinic
    let patientId: string | null = null;

    const { data: existingPatient } = await sb.from("patients")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("phone_number", phone)
      .limit(1)
      .maybeSingle();

    if (existingPatient) {
      patientId = existingPatient.id;
    } else {
      // CRM tagging removed. We prioritize clinical tagging for existing patients.
      console.log(
        `[tagPatient] Patient not found for ${phone}, skipping tagging as CRM is secondary`,
      );
      return {
        success: false,
        message: "Paciente no encontrado para etiquetar.",
      };
    }

    // 3. Assign tag to patient (skip if already assigned)
    const { data: existingLink } = await sb.from("patient_tags")
      .select("patient_id")
      .eq("patient_id", patientId)
      .eq("tag_id", tagId)
      .limit(1)
      .maybeSingle();

    if (!existingLink) {
      const { error: linkError } = await sb.from("patient_tags")
        .insert({ patient_id: patientId, tag_id: tagId });

      if (linkError) {
        console.error("[tagPatient] Error linking tag:", linkError);
        return { success: false, message: "Error al asignar etiqueta." };
      }
    }

    console.log(
      `[tagPatient] Tagged ${phone} with "${tagName}" (tag: ${tagId}, patient: ${patientId})`,
    );
    return {
      success: true,
      tag_name: tagName,
      message:
        `Etiqueta "${tagName}" asignada al paciente. (Esto es interno, NO lo menciones al paciente.)`,
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
    const { data: docs } = await sb.from("knowledge_base")
      .select("title, content, category")
      .eq("clinic_id", clinicId)
      .eq("status", "active")
      .limit(10);

    if (!docs || docs.length === 0) return "";

    const rawKnowledge = docs.map((
      d: { title: string; content: string; category: string },
    ) => `- ${d.title} (${d.category}): ${d.content.substring(0, 4000)}`).join(
      "\n",
    );

    return "\n\nBase de Conocimiento de la Clínica:\n" + rawKnowledge;
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
          routeContext = `\n[INFO LOGÍSTICA: Ese día el médico ya tiene citas agendadas en hacia estas zonas: ${zones}. Evalúa si el tutor queda "de camino" para optimizar la logística.]`;
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
const selectModelTier = (content: string, hasImage: boolean = false): { model: string, tier: number } => {
  const text = content.toLowerCase();
  
  // Tier 3: Critical cases, surgeries, or complex medical inquiries + Images
  const isComplex = hasImage || 
                    text.includes("cirug") || 
                    text.includes("esterili") || 
                    text.includes("castra") || 
                    text.includes("grave") || 
                    text.includes("sangre") || 
                    text.includes("emergencia");
  
  if (isComplex) return { model: "gpt-5.5", tier: 3 };

  // Tier 1: Very simple interactions
  const isSimple = text.length < 30 && (
    text.includes("hola") || 
    text.includes("gracias") || 
    text.includes("chau") || 
    text.includes("ok") || 
    text.includes("bueno") ||
    text.match(/^[\p{Emoji}\s]+$/u)
  );

  if (isSimple) return { model: "gpt-5.4-mini", tier: 1 };

  // Default Tier 2: Standard conversation
  return { model: "gpt-5.4", tier: 2 };
};

const callOpenAI = async (
  key: string,
  model: string,
  msgs: Msg[],
  useFns = true,
  blockedTools: string[] = [],
) => {
  // Use the models directly as available in the user's OpenAI account
  let realModel = model || "gpt-5.4-mini";
  
  // Clean up prefix if any (e.g. "openai/gpt-5.4" -> "gpt-5.4")
  if (realModel.startsWith("openai/")) {
    realModel = realModel.replace("openai/", "");
  }

  // Ensure naming consistency with OpenAI IDs
  if (realModel === "pro" || realModel === "gpt-5-pro") realModel = "gpt-5.5";
  if (realModel === "hybrid") realModel = "gpt-5.4";
  if (realModel === "mini" || realModel === "gpt-5.4-mini") realModel = "gpt-5.4-mini";
  if (realModel === "gpt-5") realModel = "gpt-5.5"; // Fallback for anyone saying gpt-5

  const apiUrl = "https://api.openai.com/v1/chat/completions";
  const authHeader = `Bearer ${key}`;

  let functions = [
    {
      name: "check_availability",
      description:
        "Consulta horarios disponibles para una fecha y servicio sugerido. MUY IMPORTANTE: Usa YYYY-MM-DD.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Fecha (YYYY-MM-DD)" },
          service_name: {
            type: "string",
            description: "Nombre del servicio (p.ej. Consulta)",
          },
          professional_name: {
            type: "string",
            description: "Nombre opcional del profesional",
          },
          address: {
            type: "string",
            description: "Dirección opcional del cliente",
          },
        },
        required: ["date", "address"],
      },
    },
    {
      name: "create_appointment",
      description: "Crea una cita en el calendario.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Fecha (YYYY-MM-DD)" },
          time: { type: "string", description: "Hora (HH:MM)" },
          service_name: { type: "string" },
          pet_name: { type: "string" },
          tutor_name: { type: "string" },
          professional_name: { type: "string" },
          address: { type: "string" },
        },
        required: ["date", "time", "service_name", "pet_name", "tutor_name"],
      },
    },
    {
      name: "get_services",
      description:
        "Obtiene la lista de servicios y precios base de la clínica.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "get_knowledge",
      description:
        "Busca información detallada sobre precios, vacunas y procedimientos en la base de conocimiento.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Término de búsqueda (p.ej. 'precios cirugias')",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "confirm_appointment",
      description:
        "Confirma o Cancela una cita cuando el usuario responde a un recordatorio.",
      parameters: {
        type: "object",
        properties: {
          response: { type: "string", enum: ["yes", "no"] },
        },
        required: ["response"],
      },
    },
    {
      name: "escalate_to_human",
      description:
        "Marca la conversación para atención humana y pausa la IA. Úsalo cuando el cliente esté molesto o sea un caso complejo como cirugías.",
      parameters: { type: "object", properties: {} },
    },
  ];

  // Filter out blocked tools
  if (blockedTools.length > 0) {
    functions = functions.filter((f) => !blockedTools.includes(f.name));
  }

  const r = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify({
      model: realModel,
      messages: msgs,
      functions: useFns
        ? (functions.length > 0 ? functions : undefined)
        : undefined,
      function_call: useFns
        ? (functions.length > 0 ? "auto" : undefined)
        : undefined,
      temperature: 0,
      max_completion_tokens: 800,
    }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
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
    console.error(
      `[sendWA] Error sending to ${cleanTo} from ${cleanFrom}:`,
      errText,
    );
    throw new Error(errText);
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

  const sb = getSupabase();

  if (req.method === "GET") {
    const { data } = await sb.from("debug_logs").select("*").order(
      "created_at",
      { ascending: false },
    ).limit(100);
    return new Response(JSON.stringify(data), { headers: corsHeaders });
  }

  try {
    let p: any;
    try {
      p = await req.json();
    } catch (e) {
      console.warn("Received empty or non-JSON body, ignoring.");
      return new Response(
        JSON.stringify({ status: "ok", message: "Empty body ignored" }),
        { headers: corsHeaders },
      );
    }

    // Log incoming payload for debugging
    await debugLog(sb, `Incoming payload`, p);

    // --- NEW: UNIVERSAL DISPATCHER (Supports YCloud and Vetly Simulator) ---
    let from = "";
    let to = "";
    let text = "";
    let type = "";
    let latitude: number | undefined;
    let longitude: number | undefined;

    if (
      p.type === "whatsapp.inbound_message.received" && p.whatsappInboundMessage
    ) {
      const m = p.whatsappInboundMessage;
      from = m.from || "";
      to = m.to || "";
      type = m.type || "";
      if (m.type === "text") text = m.text?.body || "";
      if (m.type === "location") {
        latitude = m.location?.latitude;
        longitude = m.location?.longitude;
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
      .select("id, name, patients(id, name, species)")
      .eq("clinic_id", clinic.id)
      .eq("phone_number", from)
      .limit(1)
      .maybeSingle();

    let tutorContext = "";
    if (tutor) {
      const petNames = tutor.patients?.map((p: any) =>
        `${p.name} (${p.species || "mascota"})`
      ).join(", ");
      tutorContext =
        `\n\nCLIENTE RECONOCIDO: Estás hablando con ${tutor.name}. Sus mascotas registradas son: ${
          petNames || "ninguna aún"
        }. Trátalo como cliente recurrente y evita pedirle datos que ya conoces.`;
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
    } else if (msgObj?.type === "interactive" && msgObj.interactive) {
      const interactive = msgObj.interactive;
      if (interactive.type === "button_reply") {
        body = interactive.button_reply?.title || "";
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

      // INJECT IMMEDIATE CONTEXT TO BYPASS DB LAG
      immediateContext = {
        gps: { lat, lng },
        ruralMins: minRuralMins,
        aiContext: payloadExtra.ai_context
      };
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
      console.log(`[LINK-DETECTOR] Maps link found in message: ${body}`);
      let resolvedCoords = await resolveGoogleMapsUrl(body);

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

    if (!clinic.ai_auto_respond) {
      return new Response(JSON.stringify({ status: "saved" }), {
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
      try {
        const realClinicId = clinic.ref_id || clinic.id;
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

        if (latestMsg && latestMsg.id !== msgRowId) {
          // WE ARE NOT THE LATEST MESSAGE! Abort silently and let the latest one handle everything.
          await debugLog(sb, `Debounced message`, { msgRowId });
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
            const urbanResults = await Promise.all((logisticsConfig.urban_bases || []).map(async (base: any) => {
              const details = await getTravelDetails(googleMapsApiKey, `${base.lat},${base.lng}`, `${globalGPS.lat},${globalGPS.lng}`);
              return { ...base, ...details };
            }));

            const surgeryResults = await Promise.all((logisticsConfig.surgery_hubs || []).map(async (hub: any) => {
              const details = await getTravelDetails(googleMapsApiKey, `${hub.lat},${hub.lng}`, `${globalGPS.lat},${globalGPS.lng}`);
              return { ...hub, ...details };
            }));

            const closestUrban = urbanResults.sort((a, b) => (a.duration || 999) - (b.duration || 999))[0];
            const closestSurgery = surgeryResults.sort((a, b) => (a.duration || 999) - (b.duration || 999))[0];

            if (closestUrban) {
              const threshold = closestUrban.urban_threshold !== undefined ? closestUrban.urban_threshold : 10;
              const extraMins = Math.max(0, (closestUrban.duration || 0) - threshold);
              let logNote = `[LOGÍSTICA: Base Urbana: ${closestUrban.name} | Tiempo al Centro: ${closestUrban.duration} min | Extra Ciudad: +${extraMins} min]`;
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

        // Fetch knowledge base summary for system prompt
        const knowledgeSummary = await getKnowledgeSummary(sb, clinic.id);

        // Fetch REAL services from the 'clinic_services' table (not the legacy JSON field)
        const { data: realServices } = await sb.from("clinic_services")
          .select("name, duration, price, ai_description")
          .eq("clinic_id", clinic.id);

        const servicesForPrompt = realServices && realServices.length > 0
          ? realServices.map((s) => ({
            nombre: s.name,
            duracion: `${s.duration} min`,
            precio: `$${s.price.toLocaleString("es-CL")}`,
            info_importante: s.ai_description || "Sin detalles específicos.",
          }))
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

        const sysPrompt = `
${clinic.ai_personality || "Eres un asistente veterinario profesional."}

Clínica: ${clinic.clinic_name}
Dirección: ${clinic.clinic_address || clinic.address || "No especificada."}
Horarios: ${hoursSummary}

CONTEXTO DE FECHAS:
- HOY: ${todayDay}, ${localDateISO}
- HORA ACTUAL: ${localTime}

Servicios OFICIALES: ${JSON.stringify(servicesForPrompt)}
${knowledgeSummary}

Reglas Adicionales:
${(clinic.ai_behavior_rules || "").replace(/`/g, "'")}
`;

        const sysPromptHQ = `Eres un Asesor Especialista de Vetly. Tu meta es que el prospecto descubra por sí mismo que NECESITA mejorar su gestión, y que Vetly es el camino más sencillo.`;

        // The 'history' variable is already fetched and reversed at the top of the asyncProcess.
        const orderedMsgs = history;

        // --- MOTOR DE PERSISTENCIA GEOGRÁFICA GLOBAL ---
        const finalSysPrompt = (clinic.id === HQ_ID ? sysPromptHQ : (
          globalLocContext
            ? `### INFO SISTEMA: GEO-DATA ###\n${globalLocContext}\n\n${sysPrompt}`
            : sysPrompt
        )) + (tutorContext || "");

        const historyArr = (history && Array.isArray(history)) ? history : [];

        // Find where the last outbound message is so we can group all recent inbound ones
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

        // --- NEW: INTELLIGENT MODEL ROUTING ---
        let targetModel = "gpt-5.4-mini";
        let tierUsed = 2;

        if (clinic.ai_active_model === "hybrid") {
          const lastUserText = userContentBlocks.map(b => b.text || "").join(" ");
          const hasImageInBurst = userContentBlocks.some(b => b.type === "image_url");
          const route = selectModelTier(lastUserText, hasImageInBurst);
          targetModel = route.model;
          tierUsed = route.tier;
          console.log(`[Router] Selecting Tier ${tierUsed} (${targetModel}) based on content complexity.`);
        } else if (clinic.ai_active_model === "pro") {
          targetModel = "gpt-5.5";
          tierUsed = 3;
        } else {
          targetModel = "gpt-5.4-mini";
          tierUsed = 1;
        }

        const blockedTools: string[] = [];

        let res = await callOpenAI(
          openaiApiKey,
          targetModel,
          msgs,
          true,
          blockedTools,
        );
        let assistant = res.choices[0].message;
        let funcResult: Record<string, unknown> | null = null;
        let allFuncResults: Record<string, unknown>[] = [];

        // Handle function calls (support multiple sequential calls)
        let maxCalls = 3;
        while (assistant.function_call && maxCalls > 0) {
          const fnArgs = JSON.parse(assistant.function_call.arguments);
          funcResult = await processFunc(
            sb,
            clinic.id,
            from,
            assistant.function_call.name,
            fnArgs,
            clinic.timezone || "America/Santiago",
            clinic,
            msgs,
          );
          allFuncResults.push({
            name: assistant.function_call.name,
            result: funcResult,
          });

          msgs.push(
            {
              role: "assistant",
              content: "",
              function_call: assistant.function_call,
            },
            {
              role: "function",
              name: assistant.function_call.name,
              content: JSON.stringify(funcResult),
            },
          );

          // --- FIX: Pass blockedTools also in the recursive loop calls! ---
          res = await callOpenAI(
            openaiApiKey,
            targetModel,
            msgs,
            true,
            blockedTools,
          );
          assistant = res.choices[0].message;
          maxCalls--;
        }

        let reply = assistant.content || "Error. ¿Puedes repetir?";
        const diagnosticLine = "";

        const finalReply = diagnosticLine + reply;

        await saveMsg(sb, clinic.id, from, finalReply, "outbound", {
          ai_generated: true,
          ai_function_called: allFuncResults.length > 0
            ? allFuncResults.map((r) => (r as Record<string, unknown>).name)
              .join(", ")
            : null,
          ai_function_result: allFuncResults.length > 0 ? allFuncResults : null,
        }, targetModel);

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
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});

