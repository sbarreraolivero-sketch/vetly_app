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

const surgeryPrompt = `
[NORMATIVA NUCLEAR - BLACKOUT QUIRÚRGICO]:
1. ESTE SERVICIO TIENE LA AGENDA BLOQUEADA PARA TI.
2. TIENES PROHIBIDO decir que vas a "verificar disponibilidad" o "ver cupos".
3. TIENES PROHIBIDO dar horarios, aunque creas verlos.
4. Una vez validada la ubicación y aceptado el precio, debes pedir: Nombre del tutor, Nombre mascota, Dirección exacta y QUÉ DÍA DE LA SEMANA PREFIERE.
5. DEBES informar: (a) Recomendación de exámenes pre-operatorios. (b) Recargo de $20.000 si está en celo o preñez.
6. DEBES explicar que "Claudia (nuestra encargada de logística) te contactará personalmente para coordinar el día y la hora de la cirugía".
7. Cierra la conversación ahí. No intentes usar herramientas de agenda.`;

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

const getOffset = (timeZone: string, date: Date): string => {
  try {
    const utcDate = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
    const tzDate = new Date(date.toLocaleString("en-US", { timeZone }));
    const diff = tzDate.getTime() - utcDate.getTime();
    const hours = Math.floor(Math.abs(diff) / 3600000);
    const mins = Math.floor((Math.abs(diff) % 3600000) / 60000);
    const sign = diff >= 0 ? "+" : "-";
    return `${sign}${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
  } catch { return "-04:00"; }
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
    description: "Crea una cita. SIEMPRE usar check_availability antes para confirmar el slot. Nunca inventar placeholders para tutor_name.",
    parameters: {
      type: "object",
      properties: {
        tutor_name: { type: "string", description: "Nombre real del dueño. NUNCA usar placeholders como [NOMBRE] o 'Cliente'. Si no tienes el nombre, NO llames esta función." },
        patient_name: { type: "string", description: "Nombre de la mascota" },
        pet_details: { type: "string", description: "Detalles adicionales de la mascota (especie, raza, edad)" },
        visit_reason: { type: "string", description: "Motivo de la consulta" },
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
        const creditCost = model === "mini" ? 1 : 15;

        const { data: poolRow } = await sb.from("clinic_settings")
          .select("parent_clinic_id").eq("id", clinicId).single();
        const creditPoolId: string = poolRow?.parent_clinic_id || clinicId;

        const { data: pool } = await sb.from("clinic_settings")
          .select("ai_credits_unlimited,ai_credits_monthly_mini_used,ai_credits_monthly_4o_used,ai_credits_monthly_limit,ai_credits_extra_balance,ai_credits_extra_4o,ai_credits_extra_expires_at")
          .eq("id", creditPoolId).single();

        if (pool && !pool.ai_credits_unlimited) {
          const miniUsed = pool.ai_credits_monthly_mini_used || 0;
          const oUsed = pool.ai_credits_monthly_4o_used || 0;
          const totalUsed = miniUsed + (oUsed * 8);
          const monthlyLimit = pool.ai_credits_monthly_limit || 500;
          const extrasExpired = pool.ai_credits_extra_expires_at
            ? new Date(pool.ai_credits_extra_expires_at) < new Date() : false;
          const extraBalance = extrasExpired ? 0 : ((pool.ai_credits_extra_balance || 0) + (pool.ai_credits_extra_4o || 0));

          if (extrasExpired && ((pool.ai_credits_extra_balance || 0) + (pool.ai_credits_extra_4o || 0)) > 0) {
            sb.from("clinic_settings")
              .update({ ai_credits_extra_balance: 0, ai_credits_extra_4o: 0, ai_credits_extra_expires_at: null })
              .eq("id", creditPoolId);
          }

          if (totalUsed >= monthlyLimit + extraBalance) {
            console.warn(`[saveMsg] Clinic ${creditPoolId} has insufficient credits — message saved but not counted`);
          }
        }

        if (model === "mini") {
          await sb.rpc("increment_clinic_mini_usage", { p_clinic_id: clinicId });
        } else if (["4o", "4o_standard", "4o_pro"].includes(model || "")) {
          await sb.rpc("increment_clinic_4o_usage", { p_clinic_id: clinicId });
        }

        let balanceAfter = 0;
        if (pool) {
          const miniUsed = (pool.ai_credits_monthly_mini_used || 0) + (model === "mini" ? 1 : 0);
          const oUsed = (pool.ai_credits_monthly_4o_used || 0) + (model !== "mini" ? 1 : 0);
          const totalUsedNow = miniUsed + (oUsed * 8);
          const extrasExpired = pool.ai_credits_extra_expires_at
            ? new Date(pool.ai_credits_extra_expires_at) < new Date() : false;
          const extraBalance = extrasExpired ? 0 : ((pool.ai_credits_extra_balance || 0) + (pool.ai_credits_extra_4o || 0));
          balanceAfter = Math.max(0, (pool.ai_credits_monthly_limit || 0) + extraBalance - totalUsedNow);
        }

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

  // Parallel fetch: clinic_settings + serviceDetails + existingAppts
  const [{ data: clinic }, serviceDetails, { data: existingAppts }] = await Promise.all([
    sb.from("clinic_settings").select("*").eq("id", clinicId).single(),
    getServiceDetails(sb, clinicId, serviceName || ""),
    sb.from("appointments").select("id,appointment_date,address,latitude,longitude,status,duration,phone_number")
      .eq("clinic_id", clinicId).neq("status", "cancelled"),
  ]);

  const isAnimalGrace = (clinic?.logistics_config as any)?.routing_mode === "mobile_sectors";
  const isMobile = clinic?.business_model !== "physical";
  const duration = serviceDetails.duration;

  // Surgery hard block for mobile/AnimalGrace
  const lowerService = (serviceName || "").toLowerCase();
  const isSurgery = lowerService.includes("cirug") || lowerService.includes("esterili") || lowerService.includes("castra");
  if (isAnimalGrace && isSurgery) {
    return { available: false, reason: "surgery_manual", message: surgeryPrompt };
  }

  // Get available slots
  const rpcName = profName ? "get_professional_available_slots" : "get_available_slots";
  const rpcParams: any = { p_clinic_id: clinicId, p_date: date, p_duration: duration };
  if (profName) rpcParams.p_professional_name = profName;

  const { data: slots, error: slotError } = await sb.rpc(rpcName, rpcParams);
  if (slotError) {
    console.error("[checkAvail] RPC error:", slotError);
    return { available: false, reason: "rpc_error", message: "Error consultando disponibilidad." };
  }

  // Filter slots already booked
  let filteredSlots = (slots || []).filter((slot: any) => {
    const slotTime = slot.slot_time?.substring(0, 5);
    const tzOffset = getOffset(timezone, new Date(`${date}T12:00:00`));
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
    const tzOffset = getOffset(timezone, now);
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

    const tzOffset = getOffset(timezone, new Date(`${date}T12:00:00`));
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

  const displaySlots = availableFormatted.slice(0, 15);

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

// ── Create Appointment ────────────────────────────────────────────────────────
const createAppt = async (
  sb: ReturnType<typeof createClient>,
  clinicId: string,
  phone: string,
  args: any,
  timezone = "America/Santiago",
  refId?: string,
  logisticsConfig?: any,
) => {
  const normalizedPhone = normalizePhone(phone);

  // Guard against placeholder names
  const tutorNameRaw = (args.tutor_name || "").trim();
  const tutorNameNorm = tutorNameRaw.toLowerCase();
  const isPlaceholderName =
    !tutorNameRaw ||
    tutorNameRaw.includes("[") || tutorNameRaw.includes("]") ||
    tutorNameRaw.includes("{") || tutorNameRaw.includes("}") ||
    ["tutor", "cliente", "dueño", "dueno", "nombre", "sin nombre", "n/a", "na", "no especificado", "desconocido", "pendiente"].includes(tutorNameNorm) ||
    tutorNameNorm.startsWith("nombre del") || tutorNameNorm.startsWith("nombre de");
  if (isPlaceholderName) {
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

  const offset = getOffset(timezone, new Date(`${args.date}T12:00:00`));
  const appointmentDateWithOffset = `${args.date}T${args.time}:00${offset}`;

  // Deduplication check
  const { data: existingAppt } = await sb.from("appointments").select("id, status")
    .eq("clinic_id", clinicId).eq("phone_number", normalizedPhone)
    .eq("appointment_date", appointmentDateWithOffset).neq("status", "cancelled").maybeSingle();
  if (existingAppt) {
    return { success: true, message: existingAppt.status === "confirmed" ? "Ya tienes esta cita confirmada en nuestra agenda. ¡Te esperamos!" : "Ya registré esta solicitud y está pendiente de pago." };
  }

  // Proactive availability check
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
    service: args.service_name,
    appointment_date: appointmentDateWithOffset,
    address: args.address || tutorGeo?.address || null,
    address_references: args.address_references || null,
    status: "pending",
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
      if (confirmedAppt) return { message: "Tu cita ya está confirmada 😊 ¡Te esperamos! Recuerda estar disponible al menos 2 horas después de la hora asignada, ya que el móvil trabaja por rangos horarios." };
    }
    return { message: "No hay citas pendientes." };
  }

  const status = response === "yes" ? "confirmed" : "cancelled";
  await sb.from("appointments").update({ status, confirmation_received: true, confirmation_response: response }).eq("id", appt.id);
  return status === "confirmed"
    ? { message: "¡Cita confirmada! 😊 Recuerda que el móvil trabaja por rangos horarios, por lo que te pedimos estar disponible al menos 2 horas después de la hora asignada, por si hay algún retraso en la ruta." }
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

// ── Tag Patient ───────────────────────────────────────────────────────────────
const tagPatient = async (sb: ReturnType<typeof createClient>, clinicId: string, phone: string, args: { tag_name: string; tag_color?: string }) => {
  const normalizedPhone = normalizePhone(phone);
  const tagName = (args.tag_name || "").trim();
  if (!tagName) return { success: false, message: "Nombre de etiqueta vacío." };

  // Find or create tag
  let tagId: string;
  const { data: existingTag } = await sb.from("tags").select("tag_id").eq("clinic_id", clinicId)
    .ilike("tag_name", tagName).limit(1).maybeSingle();
  if (existingTag) {
    tagId = existingTag.tag_id;
  } else {
    const { data: newTag } = await sb.from("tags").insert({ clinic_id: clinicId, tag_name: tagName, tag_color: args.tag_color || "#6b7280" }).select("tag_id").single();
    if (!newTag) return { success: false, message: "Error creando etiqueta." };
    tagId = newTag.tag_id;
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
const rescheduleAppt = async (sb: ReturnType<typeof createClient>, clinicId: string, phone: string, args: { new_date: string; new_time: string }, timezone: string) => {
  const normalizedPhone = normalizePhone(phone);
  const { data: appt } = await sb.from("appointments").select("*")
    .eq("clinic_id", clinicId).eq("phone_number", normalizedPhone)
    .in("status", ["pending", "confirmed"]).gte("appointment_date", new Date().toISOString())
    .order("appointment_date", { ascending: true }).limit(1).maybeSingle();
  if (!appt) return { success: false, message: "No hay citas próximas para reagendar." };

  const offset = getOffset(timezone, new Date(`${args.new_date}T12:00:00`));
  const newDate = `${args.new_date}T${args.new_time}:00${offset}`;
  await sb.from("appointments").update({ appointment_date: newDate, status: "pending", reminder_sent: false }).eq("id", appt.id);
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
  switch (name) {
    case "check_availability":
      return checkAvail(sb, clinicId, phone, args.date, args.service_name, timezone, args.professional_name, null, args.address, logisticsConfig);
    case "create_appointment":
      return createAppt(sb, clinicId, phone, args, timezone, clinicId, logisticsConfig);
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
      return rescheduleAppt(sb, clinicId, phone, args, timezone);
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
      if (change.field !== "messages") continue;

      const value = change.value;
      const metadata = value?.metadata;
      const phoneNumberId: string = metadata?.phone_number_id || "";
      const messages: any[] = value?.messages ?? [];
      const statuses: any[] = value?.statuses ?? [];

      // Status updates: mark messages as delivered/read
      for (const status of statuses) {
        if (status.id) {
          await sb.from("messages").update({ status: status.status })
            .eq("ycloud_message_id", status.id).catch(() => {/* non-critical */});
        }
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
        .select("id, name, referred_by, patients(id, name, species)")
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
              referralContext = `\n[SISTEMA: Este cliente llegó REFERIDO por ${referrer.name} (código ${code}). Menciónale que la recomendación fue registrada y dale una bienvenida cálida.]`;
              break;
            }
          }
        }
      }

      // CAPI: LeadSubmitted (before ai_auto_respond check — fires even when AI is off)
      if (!tutor && ctwaClid && clinic.meta_pixel_id && clinic.meta_capi_token) {
        const capiResult = await sendMetaCAPIEvent(clinic.meta_pixel_id, clinic.meta_capi_token, "LeadSubmitted", from, ctwaClid, undefined, clinic.meta_test_event_code || undefined, clinic.meta_page_id || undefined);
        await debugLog(sb, `[META CAPI] LeadSubmitted for ${from}`, capiResult);
      }

      // CRM auto-sync
      try {
        const normalizedFrom = normalizePhone(from);
        const { data: existingProspect } = await sb.from("crm_prospects").select("id")
          .eq("clinic_id", clinic.id).or(`phone.eq.${from},phone.eq.+${normalizedFrom}`).limit(1).maybeSingle();
        if (!existingProspect && !tutor) {
          await sb.from("crm_prospects").insert({ clinic_id: clinic.id, phone: normalizedFrom, source: "whatsapp_inbound", status: "new" });
        }
      } catch { /* non-critical */ }

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

          // requires_human check
          const normalizedFrom = normalizePhone(from);
          const { data: tutorCheck } = await sb.from("tutors").select("requires_human")
            .eq("clinic_id", clinic.id).eq("phone_number", from).limit(1).maybeSingle();
          const { data: crmCheck } = await sb.from("crm_prospects").select("requires_human")
            .eq("clinic_id", clinic.id).or(`phone.eq.${from},phone.eq.+${normalizedFrom}`).limit(1).maybeSingle();
          if (tutorCheck?.requires_human || crmCheck?.requires_human) {
            console.log(`[Meta] requires_human=true for ${from}, skipping AI`);
            return;
          }

          // Reset IA command
          const lowerBody = body.toLowerCase().trim();
          if (lowerBody === "/reset ia" || lowerBody === "reset ia") {
            await sb.from("tutors").update({ requires_human: false }).eq("clinic_id", clinic.id).eq("phone_number", from);
            await sb.from("crm_prospects").update({ requires_human: false }).eq("clinic_id", clinic.id).or(`phone.eq.${from},phone.eq.+${normalizedFrom}`);
            await sendMetaMessage(clinic.meta_phone_number_id, clinic.meta_access_token, from, "✅ IA reactivada. ¿En qué puedo ayudarte?");
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
          const knowledgeSummary = await getKnowledgeSummary(sb, clinic.id);
          const { data: realServices } = await sb.from("clinic_services").select("name, duration, price, ai_description").eq("clinic_id", clinic.id);
          const servicesForPrompt = realServices && realServices.length > 0
            ? realServices.map((s: any) => ({ nombre: s.name, duracion: `${s.duration} min`, precio: `$${s.price.toLocaleString("es-CL")}`, info_importante: s.ai_description || "Sin detalles específicos." }))
            : clinic.services || [];

          const daysMap: Record<string, string> = { monday: "lunes", tuesday: "martes", wednesday: "miércoles", thursday: "jueves", friday: "viernes", saturday: "sábado", sunday: "domingo" };
          const hoursSummary = Object.entries(clinic.working_hours || {}).map(([day, h]: [string, any]) => {
            const dayName = daysMap[day.toLowerCase()] || day;
            if (!h || h.closed || h.enabled === false) return `${dayName}: CERRADO`;
            const lunch = h.lunch_break;
            return `${dayName}: ${h.open || h.start || "10:00"} - ${h.close || h.end || "18:30"}${lunch?.enabled ? ` (Colación: ${lunch.start}-${lunch.end})` : ""}`;
          }).join(", ");

          // Survey feedback context
          const normalizedFromPhone = normalizePhone(from);
          const { data: pendingFeedbackSurvey } = await sb.from("satisfaction_surveys").select("id, rating")
            .or(`phone_number.eq.${from},phone_number.eq.${normalizedFromPhone},phone_number.eq.+${normalizedFromPhone}`)
            .eq("status", "responded").lte("rating", 2).is("feedback_context", null)
            .order("responded_at", { ascending: false }).limit(1).maybeSingle();

          // Build system prompt
          const sysPrompt = `
${clinic.ai_personality || "Eres un asistente veterinario profesional."}

Clínica: ${clinic.clinic_name}
Dirección: ${clinic.clinic_address || clinic.address || "No especificada."}
Horarios: ${hoursSummary}${clinic.contact_phone ? `\nTeléfono de Contacto Clínico: ${clinic.contact_phone}` : ""}${clinic.transfer_details ? `\nDatos de Pago/Transferencia: ${clinic.transfer_details}` : ""}

CONTEXTO DE FECHAS:
- HOY: ${todayDay}, ${localDateISO}
- MAÑANA: ${tomorrowDay}, ${tomorrowISO}
- PASADO MAÑANA: ${dayAfterDay}, ${dayAfterISO}
- HORA ACTUAL: ${localTime}
${pendingFeedbackSurvey ? `\n⚠️ CONTEXTO ESPECIAL — ENCUESTA DE SATISFACCIÓN NEGATIVA ⚠️\nEste cliente acaba de calificar su última atención con ${pendingFeedbackSurvey.rating} estrella/s. Escucha activamente, muestra empatía, NO intentes vender nada.\n` : ""}
⚠️ PROTOCOLOS DE ATENCIÓN Y REGLAS DE COMPORTAMIENTO ⚠️
${(clinic.ai_behavior_rules || "").replace(/`/g, "'")}
--------------------------------------------------------

LISTA OFICIAL DE SERVICIOS Y PRECIOS:
${JSON.stringify(servicesForPrompt)}

BASE DE CONOCIMIENTO (PROTOCOLOS Y DETALLES ACTUALIZADOS):
${knowledgeSummary}

⚠️ NOTA PARA IA: Si existe una discrepancia entre la 'Lista Oficial' y la 'Base de Conocimiento', prioriza SIEMPRE la Base de Conocimiento.
`;

          const finalSysPrompt = (globalLocContext
            ? `### INFO SISTEMA: GEO-DATA ###\n${globalLocContext}\n\n${sysPrompt}`
            : sysPrompt) + (tutorContext || "") + (referralContext || "");

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
            const recentOutbound = history.filter(m => m.direction === "outbound").slice(-3).map(m => (m.content || "").toLowerCase());
            const schedulingSignals = ["cita", "agend", "disponib", "horario", "slot", "hora disponible", "reserv", "sector", "direcci", "ubicaci", "traslado", "zona", "comuna", "cobertura", "recargo", "castr", "cirug", "esteril", "vacun", "antirrabi", "octuple", "sextuple", "triple felina"];
            const activeSchedulingFlow = recentOutbound.some(msg => schedulingSignals.some(s => msg.includes(s)));
            const route = selectModelTier(lastUserText, hasImageInBurst, activeSchedulingFlow);
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

          while (assistant && (assistant.function_call || (assistant.tool_calls && assistant.tool_calls.length > 0)) && maxCalls > 0) {
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

          const reply = assistant?.content || "Error. ¿Puedes repetir?";

          await saveMsg(sb, clinic.id, from, reply, "outbound", {
            ai_generated: true,
            ai_function_called: allFuncResults.length > 0 ? allFuncResults.map(r => r.name).join(", ") : null,
            ai_function_result: allFuncResults.length > 0 ? allFuncResults : null,
          }, modelForTracking);

          await sendMetaMessage(clinic.meta_phone_number_id, clinic.meta_access_token, from, reply);
          await debugLog(sb, "Meta AI Response Sent", { to: from, msgId });

        } catch (err) {
          console.error("Meta Async Process Error:", err);
          await debugLog(sb, "Meta Async Process Error", { error: (err as Error).message, phone: from });
          const fallbackReply = "Lo siento, tuve un problema técnico procesando tu mensaje. Por favor intenta consultarme en unos minutos.";
          await saveMsg(sb, clinic.id, from, fallbackReply, "outbound", { error_fallback: true }, targetModel);
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
    }
  }

  // Meta requiere 200 inmediato siempre
  return new Response("OK", { status: 200 });
});
