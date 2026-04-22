"use strict";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, YCloud-Signature"
};
const downloadYCloudMedia = async (link, ycloudKey) => {
  const res = await fetch(link, {
    headers: { "X-API-Key": ycloudKey }
  });
  if (!res.ok) throw new Error(`Media fetch failed: ${await res.text()}`);
  return await res.blob();
};
const transcribeAudioData = async (audioBlob, openAiKey) => {
  const formData = new FormData();
  formData.append("file", audioBlob, "audio.ogg");
  formData.append("model", "whisper-1");
  formData.append("response_format", "text");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${openAiKey}` },
    body: formData
  });
  if (!res.ok) throw new Error(`Transcription failed: ${await res.text()}`);
  return await res.text();
};
const resolveGoogleMapsUrl = async (url) => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1e4);
    let currentUrl = url;
    let finalUrl = url;
    for (let i = 0; i < 5; i++) {
      const res = await fetch(currentUrl, {
        method: "HEAD",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      });
      const nextUrl = res.headers.get("location");
      if (!nextUrl) {
        const resGet = await fetch(currentUrl, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal
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
      /ll=(-?\d+\.\d+),(-?\d+\.\d+)/
    ];
    for (const regex of patterns) {
      const match = finalUrl.match(regex);
      if (match) {
        clearTimeout(timeoutId);
        return {
          lat: parseFloat(match[1]),
          lng: parseFloat(match[2]),
          finalUrl
        };
      }
    }
    clearTimeout(timeoutId);
    return { lat: 0, lng: 0, finalUrl: finalUrl.substring(0, 60) };
  } catch (e) {
    return { lat: 0, lng: 0, finalUrl: `ERR:${e.message?.substring(0, 10)}` };
  }
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY") || "";
const geocodeAddress = async (address) => {
  if (!GOOGLE_MAPS_API_KEY) return null;
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_MAPS_API_KEY}`;
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
const getOffset = (timeZone = "America/Santiago", date) => {
  try {
    const str = date.toLocaleString("en-US", {
      timeZone,
      timeZoneName: "longOffset"
    });
    const match = str.match(/GMT([+-]\d{2}:\d{2})/);
    return match ? match[1] : "-03:00";
  } catch (e) {
    console.error("getOffset error", e);
    return "-03:00";
  }
};
const getTravelDetails = async (origin, destination) => {
  if (!GOOGLE_MAPS_API_KEY) return { duration: 0, distance: 0 };
  try {
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin.lat},${origin.lng}&destinations=${destination.lat},${destination.lng}&key=${GOOGLE_MAPS_API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.status === "OK" && data.rows[0].elements[0].status === "OK") {
      return {
        duration: data.rows[0].elements[0].duration.value,
        // seconds
        distance: data.rows[0].elements[0].distance.value
        // meters
      };
    }
    return { duration: 0, distance: 0 };
  } catch (e) {
    console.error("[DistanceMatrix] Exception:", e);
    return { duration: 0, distance: 0 };
  }
};
const functions = [
  {
    name: "check_availability",
    description: "Verifica disponibilidad general (Vacunas, Consultas). PROHIBIDO usar para CIRUG\xCDAS, ESTERILIZACIONES o CASTRACIONES (Claudia coordina manualmente). Si la cl\xEDnica es m\xF3vil/h\xEDbrida, es OBLIGATORIO solicitar primero el PIN GPS o Link Maps.",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "Fecha YYYY-MM-DD" },
        service_name: {
          type: "string",
          description: "Nombre del servicio inferido del contexto"
        },
        professional_name: {
          type: "string",
          description: "Nombre del profesional solicitado (opcional)"
        },
        address: {
          type: "string",
          description: "Direcci\xF3n inferida del GPS/contexto para la validaci\xF3n interna de la zona."
        }
      },
      required: ["date"]
    }
  },
  {
    name: "create_appointment",
    description: "Crea nueva cita. REQUERIDO: Formato YYYY-MM-DD y hora 24h (HH:MM). Para cl\xEDnicas m\xF3viles, incluye la 'address' confirmada.",
    parameters: {
      type: "object",
      properties: {
        tutor_name: {
          type: "string",
          description: "Nombre completo del tutor/due\xF1o"
        },
        patient_name: { type: "string", description: "Nombre de la mascota" },
        date: { type: "string", description: "Fecha YYYY-MM-DD" },
        time: { type: "string", description: "Hora HH:MM (24h)" },
        service_name: { type: "string" },
        professional_name: {
          type: "string",
          description: "Nombre del profesional (opcional)"
        },
        address: {
          type: "string",
          description: "Direcci\xF3n completa de atenci\xF3n (requerida para m\xF3viles)"
        },
        notes: {
          type: "string",
          description: "Breve resumen del motivo de la visita o s\xEDntomas (triaje)"
        }
      },
      required: [
        "tutor_name",
        "patient_name",
        "date",
        "time",
        "service_name",
        "address",
        "notes"
      ]
    }
  },
  {
    name: "get_services",
    description: "Obt\xE9n la lista de servicios m\xE9dicos, sus precios y duraciones para informar al cliente.",
    parameters: { type: "object", properties: {} }
  },
  {
    name: "confirm_appointment",
    description: "Confirma o cancela cita pendiente",
    parameters: {
      type: "object",
      properties: { response: { type: "string", enum: ["yes", "no"] } },
      required: ["response"]
    }
  },
  {
    name: "get_knowledge",
    description: "Busca informaci\xF3n detallada en la base de conocimiento (precios, tratamientos, cuidados, valores, promociones). \xDASALO SIEMPRE ante preguntas sobre costos o temas espec\xEDficos que no est\xE9n en tu configuraci\xF3n b\xE1sica.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Palabras clave simplificadas para la b\xFAsqueda (ej: 'precios', 'labios', 'cuidados', 'promocion')"
        }
      },
      required: ["query"]
    }
  },
  {
    name: "escalate_to_human",
    description: "\xDASALA si el paciente pide hablar con una persona, si te hace una pregunta que no puedes responder con seguridad, si tiene una urgencia m\xE9dica o si detectas frustraci\xF3n. Esta funci\xF3n notificar\xE1 al equipo y desactivar\xE1 tus respuestas autom\xE1ticas para este chat.",
    parameters: { type: "object", properties: {}, required: [] }
  },
  {
    name: "reschedule_appointment",
    description: "Reagenda una cita existente del paciente a una nueva fecha y hora. \xDAsala cuando el paciente quiera cambiar la fecha/hora de su cita. Primero verifica disponibilidad con check_availability, luego usa esta funci\xF3n para mover la cita.",
    parameters: {
      type: "object",
      properties: {
        new_date: { type: "string", description: "Nueva fecha YYYY-MM-DD" },
        new_time: { type: "string", description: "Nueva hora HH:MM (24h)" }
      },
      required: ["new_date", "new_time"]
    }
  },
  {
    name: "tag_patient",
    description: "Asigna una etiqueta al paciente para segmentaci\xF3n y marketing m\xE9dico. \xDASALA PROACTIVAMENTE cuando: (1) El paciente muestra inter\xE9s en un servicio espec\xEDfico \u2192 etiqueta 'Inter\xE9s [Servicio]' (ej: 'Inter\xE9s Cirug\xEDa'). (2) Se agenda una cita \u2192 etiqueta 'Cliente [Servicio]'. (3) Detectas condiciones o comportamientos \u2192 ej: 'Agresivo', 'Mascota Senior', 'Rescatado', 'Al\xE9rgico'. (4) Es la primera vez \u2192 'Primera Vez'. Puedes llamar esta funci\xF3n m\xFAltiples veces. La etiqueta se crea autom\xE1ticamente si no existe.",
    parameters: {
      type: "object",
      properties: {
        tag_name: {
          type: "string",
          description: "Nombre de la etiqueta. Ej: 'Inter\xE9s Vacunaci\xF3n', 'Agresivo', 'Mascota Senior', 'Primera Vez', 'Control Sano'"
        },
        tag_color: {
          type: "string",
          description: "Color hex. Sugerencias: #10B981 (verde/positivo), #3B82F6 (azul/inter\xE9s), #F59E0B (amarillo/cuidado), #EF4444 (rojo/m\xE9dico-alerta), #8B5CF6 (morado/VIP). Opcional, default azul."
        }
      },
      required: ["tag_name"]
    }
  }
];
const getSupabase = () => createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const HQ_ID = "00000000-0000-0000-0000-000000000000";
const surgeryPrompt = `
[NORMATIVA NUCLEAR - BLACKOUT QUIR\xDARGICO]:
1. ESTE SERVICIO TIENE LA AGENDA BLOQUEADA PARA TI.
2. TIENES PROHIBIDO decir que vas a "verificar disponibilidad" o "ver cupos".
3. TIENES PROHIBIDO dar horarios, aunque creas verlos.
4. Una vez validada la ubicaci\xF3n y aceptado el precio, debes pedir: Nombre del tutor, Nombre mascota, Direcci\xF3n exacta y QU\xC9 D\xCDA DE LA SEMANA PREFIERE.
5. DEBES informar: (a) Recomendaci\xF3n de ex\xE1menes pre-operatorios. (b) Recargo de $20.000 si est\xE1 en celo o pre\xF1ez.
6. DEBES explicar que "Claudia (nuestra encargada de log\xEDstica) te contactar\xE1 personalmente para coordinar el d\xEDa y la hora de la cirug\xEDa".
7. Cierra la conversaci\xF3n ah\xED. No intentes usar herramientas de agenda.`;
const debugLog = async (sb, msg, payload) => {
  try {
    await sb.from("debug_logs").insert({ message: msg, payload });
  } catch (e) {
    console.error("Debug log failed:", e);
  }
};
const normalizePhone = (phone) => {
  if (!phone) return "";
  return phone.replace(/\D/g, "");
};
const getClinic = async (sb, phone) => {
  console.log(`[getClinic] Looking up clinic for phone: ${phone}`);
  const normalized = normalizePhone(phone);
  const { data, error } = await sb.from("clinic_settings").select("*").or(
    `ycloud_phone_number.eq.${phone},ycloud_phone_number.eq.+${normalized},ycloud_phone_number.eq.${normalized}`
  ).limit(1).maybeSingle();
  if (error) {
    console.error(`[getClinic] Error looking up clinic:`, error);
    throw new Error(error.message);
  }
  if (!data) {
    console.warn(
      `[getClinic] No clinic found for phone: ${phone} (normalized: ${normalized})`
    );
  } else {
    console.log(`[getClinic] Found clinic: ${data.id} (${data.clinic_name})`);
  }
  return data;
};
const getHistory = async (sb, clinicId, phone) => {
  const { data } = await sb.from("messages").select("direction, content").eq(
    "clinic_id",
    clinicId
  ).eq("phone_number", phone).order("created_at", { ascending: false }).limit(
    15
  );
  return data?.reverse() || [];
};
const isValidUUID = (uuid) => {
  const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return regex.test(uuid);
};
const saveMsg = async (sb, clinicId, phone, content, direction, extra = {}, aiModel) => {
  const extraCopy = { ...extra };
  const simplifiedModel = aiModel === "gpt-4o-mini" ? "mini" : aiModel === "gpt-4o" ? "4o" : null;
  if (extraCopy.campaign_id && !isValidUUID(extraCopy.campaign_id)) {
    console.warn(
      `[saveMsg] Invalid UUID for campaign_id: ${extraCopy.campaign_id}. Setting to null.`
    );
    delete extraCopy.campaign_id;
  }
  try {
    const insertPayload = {
      clinic_id: clinicId,
      phone_number: phone,
      content,
      direction,
      ...extraCopy
    };
    if (simplifiedModel) {
      insertPayload.ai_model = simplifiedModel;
    }
    const { data, error } = await sb.from("messages").insert(insertPayload).select("id").single();
    if (error) {
      if (error.message.includes("Could not find") && error.message.includes("column")) {
        console.warn(
          `[saveMsg] Missing column detected. Retrying without extra fields. Error: ${error.message}`
        );
        const { data: retryData, error: retryError } = await sb.from("messages").insert({
          clinic_id: clinicId,
          phone_number: phone,
          content,
          direction
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
const getServiceDetails = async (sb, clinicId, serviceName) => {
  if (!serviceName) {
    return { name: "Consulta", duration: 60, price: 0, service_ids: [] };
  }
  const names = serviceName.split(/ y | \+ | y\/o |,/i).map((s) => s.trim()).filter((s) => s.length > 2);
  let totalDuration = 0;
  let totalPrice = 0;
  let matchedNames = [];
  let serviceIds = [];
  const { data: allServices } = await sb.from("clinic_services").select("*").eq(
    "clinic_id",
    clinicId
  );
  if (!allServices || allServices.length === 0) {
    return { name: serviceName, duration: 60, price: 0, service_ids: [] };
  }
  for (const name of names) {
    let found = allServices.find(
      (s) => s.name.toLowerCase().includes(name.toLowerCase())
    );
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
      totalDuration += 30;
      matchedNames.push(name);
    }
  }
  if (totalDuration === 0) totalDuration = 60;
  return {
    name: matchedNames.length > 0 ? matchedNames.join(" + ") : serviceName,
    duration: totalDuration,
    price: totalPrice,
    service_ids: serviceIds,
    is_multiple: names.length > 1
  };
};
const checkAvail = async (sb, clinicId, phone, date, serviceName, timezone = "America/Santiago", profName, clinicWorkingHours, address) => {
  const svc = String(serviceName || "").toLowerCase();
  const isSurgery = svc.includes("ciru") || svc.includes("esteri") || svc.includes("castra") || svc.includes("pabell");
  if (isSurgery && (clinicWorkingHours?.notes?.includes("AnimalGrace") || clinicId.length < 10)) {
    return { error: "BLOQUEO DE CIRUG\xCDA ACTIVO." };
  }
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(String(date).trim())) {
    console.warn(
      `[checkAvail] Invalid date format received from AI: '${date}'`
    );
    return {
      available: false,
      reason: "invalid_date_format",
      message: `CR\xCDTICO: El formato de fecha '${date}' es inv\xE1lido. DEBES usar exactamente YYYY-MM-DD (ej: 2026-04-20). Autocorr\xEDgete llamando a la funci\xF3n de nuevo con el formato correcto.`
    };
  }
  let tutorCoords = null;
  if (address) {
    const normalizedPhone = normalizePhone(phone).trim();
    tutorCoords = await geocodeAddress(address);
    if (!tutorCoords || tutorCoords.lat === 0 && tutorCoords.lng === 0) {
      const { data: tutor } = await sb.from("tutors").select(
        "latitude, longitude"
      ).eq("clinic_id", clinicId).eq("phone_number", normalizedPhone).maybeSingle();
      if (tutor?.latitude && tutor?.longitude) {
        tutorCoords = {
          lat: Number(tutor.latitude),
          lng: Number(tutor.longitude)
        };
        console.log(
          `[checkAvail] Using persisted coordinates from DB: ${tutorCoords.lat}, ${tutorCoords.lng}`
        );
      }
    }
    const updates = { address };
    if (tutorCoords && tutorCoords.lat !== 0) {
      updates.latitude = tutorCoords.lat;
      updates.longitude = tutorCoords.lng;
      await sb.from("tutors").update(updates).eq(
        "clinic_id",
        String(clinicId).trim()
      ).eq("phone_number", normalizedPhone);
      await sb.from("crm_prospects").update(updates).eq(
        "clinic_id",
        String(clinicId).trim()
      ).eq("phone", normalizedPhone);
    }
  }
  const { data: clinic } = await sb.from("clinic_settings").select(
    "business_model, latitude, longitude"
  ).eq("id", clinicId).single();
  const isMobile = clinic?.business_model !== "physical";
  const clinicBase = clinic?.latitude && clinic?.longitude ? { lat: Number(clinic.latitude), lng: Number(clinic.longitude) } : null;
  const serviceDetails = await getServiceDetails(
    sb,
    clinicId,
    serviceName || ""
  );
  const duration = serviceDetails.duration;
  const serviceId = serviceDetails.service_ids[0] || null;
  let professionalId = null;
  if (profName) {
    const { data: prof } = await sb.from("clinic_members").select("id").eq("clinic_id", clinicId).or(
      `first_name.ilike.%${profName}%,last_name.ilike.%${profName}%,job_title.ilike.%${profName}%`
    ).limit(1).maybeSingle();
    if (prof) {
      professionalId = prof.id;
    }
  }
  if (!professionalId && serviceId) {
    const { data: profs } = await sb.from("service_professionals").select("member_id, is_primary").eq("service_id", serviceId);
    if (profs && profs.length > 0) {
      const primary = profs.find((p) => p.is_primary);
      professionalId = primary ? primary.member_id : profs[0].member_id;
    }
  }
  if (!professionalId) {
    const { data: anyMember } = await sb.from("clinic_members").select("id").eq("clinic_id", clinicId).eq("status", "active").not("role", "eq", "receptionist").order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (anyMember) {
      professionalId = anyMember.id;
      console.log(`[checkAvail] Using last-resort fallback member: ${professionalId}`);
    }
  }
  console.log(
    `[checkAvail] Service: '${serviceName}' (ID: ${serviceId}), Duration: ${duration}min, Professional: ${professionalId || "Global"}`
  );
  await debugLog(sb, "Check Avail Params", {
    clinicId,
    date,
    serviceName,
    professionalId,
    duration
  });
  let slots = [];
  const searchInterval = 30;
  const lowerService = String(serviceName || "").toLowerCase();
  if (lowerService.includes("ciru") || lowerService.includes("esteri") || lowerService.includes("castra") || lowerService.includes("pabell")) {
    return {
      error: "SISTEMA: Tienes PROHIBIDO usar esta herramienta para cirug\xEDas. Debes informar que Claudia (log\xEDstica) coordina manualmente y usar 'escalate_to_human' de inmediato."
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
        p_timezone: String(timezone).trim()
      });
      if (!error && data) {
        slots = data;
      } else {
        console.warn(
          "[checkAvail] Professional slot check failed/empty, falling back to global:",
          error
        );
      }
    } catch (e) {
      console.error("[checkAvail] RPC error:", e);
    }
  }
  if (slots.length === 0) {
    console.log(
      `[checkAvail] No slots found for professional ${professionalId}, trying global clinic slots...`
    );
    const { data, error } = await sb.rpc("get_available_slots", {
      p_clinic_id: String(clinicId).trim(),
      p_date: String(date).trim(),
      p_duration: duration,
      p_interval: searchInterval,
      p_timezone: String(timezone).trim()
    });
    if (error) {
      console.error(
        "[checkAvail] get_available_slots failed (Final Fallback):",
        error
      );
      const { data: data2 } = await sb.rpc("get_available_slots", {
        p_clinic_id: String(clinicId),
        p_date: String(date),
        p_duration: duration
      });
      slots = data2 || [];
    } else {
      slots = data || [];
    }
  }
  let filteredSlots = slots.filter(
    (s) => s.is_available
  );
  const now = /* @__PURE__ */ new Date();
  const localDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
  const timeParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(now);
  const currentH = parseInt(
    timeParts.find((p) => p.type === "hour")?.value || "0"
  );
  const currentM = parseInt(
    timeParts.find((p) => p.type === "minute")?.value || "0"
  );
  const nowLocalMinutes = currentH * 60 + currentM;
  if (date === localDate) {
    const addressLower2 = (address || "").toLowerCase();
    const isRemote = ["talca", "maule", "san javier", "villa alegre"].some(
      (z) => addressLower2.includes(z)
    );
    const bufferMinutes = isRemote ? 120 : 60;
    const cutoffMinutes = nowLocalMinutes + bufferMinutes;
    filteredSlots = filteredSlots.filter((s) => {
      const [h, m] = s.slot_time.split(":").map(Number);
      const slotMinutes = h * 60 + m;
      return slotMinutes >= cutoffMinutes;
    });
    console.log(
      `[checkAvail] Today detected. LocalTime: ${currentH}:${currentM}. Buffer: ${bufferMinutes}m. Filtered same-day slots. Remaining: ${filteredSlots.length}`
    );
  }
  const { data: existingAppts } = await sb.from("appointments").select("appointment_time").eq("clinic_id", clinicId).gte("appointment_date", `${date}T00:00:00`).lte("appointment_date", `${date}T23:59:59`).neq("status", "cancelled");
  const bookedTimes = (existingAppts || []).map((a) => (a.appointment_time || "").substring(0, 5)).filter(Boolean);
  if (bookedTimes.length > 0) {
    console.log(
      `[checkAvail] Found ${bookedTimes.length} real appointments, filtering slots...`
    );
    filteredSlots = filteredSlots.filter(
      (s) => !bookedTimes.includes(s.slot_time.substring(0, 5))
    );
  }
  const { data: dayApptsSummary } = await sb.from("appointments").select("address, status").eq("clinic_id", clinicId).gte("appointment_date", `${date}T00:00:00`).lte("appointment_date", `${date}T23:59:59`).neq("status", "cancelled");
  const activeZones = [
    ...new Set((dayApptsSummary || []).map((a) => {
      const addr = (a.address || "").toLowerCase();
      if (addr.includes("talca")) return "Talca";
      if (addr.includes("maule")) return "Maule";
      if (addr.includes("san javier")) return "San Javier";
      if (addr.includes("villa alegre")) return "Villa Alegre";
      return "Linares";
    }))
  ];
  const dayContext = activeZones.length > 0 ? `Ruta existente el ${date}: ${activeZones.join(", ")}.` : "Sin rutas previas para este d\xEDa.";
  const d = /* @__PURE__ */ new Date(date + "T12:00:00");
  const dayBefore = new Intl.DateTimeFormat("en-CA").format(
    new Date(d.getTime() - 864e5)
  );
  const dayAfter = new Intl.DateTimeFormat("en-CA").format(
    new Date(d.getTime() + 864e5)
  );
  const { data: neighborAppts } = await sb.from("appointments").select("address, appointment_date").in("appointment_date", [
    `${dayBefore}T00:00:00`,
    `${dayBefore}T23:59:59`,
    `${dayAfter}T00:00:00`,
    `${dayAfter}T23:59:59`
  ]).neq("status", "cancelled");
  const addressLower = (address || "").toLowerCase();
  const isTalcaZone = ["talca", "maule", "san javier", "villa alegre"].some(
    (z) => addressLower.includes(z)
  );
  const hasTalcaYesterday = (neighborAppts || []).some(
    (a) => a.appointment_date.startsWith(dayBefore) && ["talca", "maule", "san javier", "villa alegre"].some(
      (z) => (a.address || "").toLowerCase().includes(z)
    )
  );
  const hasTalcaTomorrow = (neighborAppts || []).some(
    (a) => a.appointment_date.startsWith(dayAfter) && ["talca", "maule", "san javier", "villa alegre"].some(
      (z) => (a.address || "").toLowerCase().includes(z)
    )
  );
  const hasTalcaToday = activeZones.includes("Talca") || activeZones.includes("Maule");
  const hasLinaresToday = activeZones.includes("Linares") && activeZones.length === 1;
  let routingAdvice = "";
  if (isTalcaZone) {
    if ((hasTalcaYesterday || hasTalcaTomorrow) && !hasTalcaToday) {
      routingAdvice = "\u26A0\uFE0F Sugerencia: Normalmente vamos a Talca d\xEDa por medio. Ayer o ma\xF1ana ya tenemos ruta all\xE1. ";
    }
    if (hasLinaresToday && !hasTalcaToday) {
      routingAdvice = "\u26A0\uFE0F Nota: Ya hay citas en Linares este d\xEDa. Sumar Talca implica tiempos de traslado significativos. ";
    }
  } else if (hasTalcaToday) {
    routingAdvice = "\u2139\uFE0F Nota: Estaremos en Talca. Disponible Linares al inicio/final del d\xEDa. ";
  }
  let recommendedSlot = "";
  if (isMobile && tutorCoords && filteredSlots.length > 0) {
    const { data: dayAppts } = await sb.from("appointments").select("id, latitude, longitude, appointment_date, duration").eq("clinic_id", clinicId).gte("appointment_date", `${date}T00:00:00`).lte("appointment_date", `${date}T23:59:59`).neq("status", "cancelled").not("latitude", "is", null).order("appointment_date", { ascending: true });
    const TRAVEL_BUFFER_MINUTES = 10;
    const finalValidSlots = [];
    for (const slot of filteredSlots) {
      const slotStart = /* @__PURE__ */ new Date(`${date}T${slot.slot_time}`);
      const slotEnd = new Date(slotStart.getTime() + duration * 6e4);
      const prevAppt = dayAppts?.filter(
        (a) => new Date(a.appointment_date) < slotStart
      ).slice(-1)[0];
      const nextAppt = dayAppts?.filter(
        (a) => new Date(a.appointment_date) >= slotEnd
      )[0];
      const originLocation = prevAppt ? { lat: Number(prevAppt.latitude), lng: Number(prevAppt.longitude) } : clinicBase;
      const destinationLocation = nextAppt ? { lat: Number(nextAppt.latitude), lng: Number(nextAppt.longitude) } : clinicBase;
      let isPossible = true;
      if (originLocation) {
        let travelTimeMinutes = 30;
        try {
          const travelDetails = await getTravelDetails(
            originLocation,
            tutorCoords
          );
          travelTimeMinutes = Math.ceil(travelDetails.duration / 60);
        } catch (err) {
          console.error(
            "[checkAvail] Google Maps API failed (Origin), using fallback:",
            err
          );
        }
        const travelTime = travelTimeMinutes * 60;
        const isToday = date === new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(
          /* @__PURE__ */ new Date()
        );
        const now2 = /* @__PURE__ */ new Date();
        let availableGapSecs = 0;
        if (prevAppt) {
          availableGapSecs = (slotStart.getTime() - (new Date(prevAppt.appointment_date).getTime() + prevAppt.duration * 6e4)) / 1e3;
        } else if (isToday) {
          const clinicStartToday = /* @__PURE__ */ new Date(`${date}T08:00:00`);
          const travelStartBase = now2 > clinicStartToday ? now2 : clinicStartToday;
          availableGapSecs = (slotStart.getTime() - travelStartBase.getTime()) / 1e3;
        } else {
          availableGapSecs = (slotStart.getTime() - (/* @__PURE__ */ new Date(`${date}T08:00:00`)).getTime()) / 1e3;
        }
        if (availableGapSecs < travelTime + TRAVEL_BUFFER_MINUTES * 60) {
          isPossible = false;
        }
      }
      if (isPossible && destinationLocation) {
        let travelTimeMinutes = 30;
        try {
          const travelDetails = await getTravelDetails(
            tutorCoords,
            destinationLocation
          );
          travelTimeMinutes = Math.ceil(travelDetails.duration / 60);
        } catch (err) {
          console.error(
            "[checkAvail] Google Maps API failed (Destination), using fallback:",
            err
          );
        }
        const travelTime = travelTimeMinutes * 60;
        const availableGapSecs = nextAppt ? (new Date(nextAppt.appointment_date).getTime() - slotEnd.getTime()) / 1e3 : ((/* @__PURE__ */ new Date(`${date}T20:00:00`)).getTime() - slotEnd.getTime()) / 1e3;
        if (availableGapSecs < travelTime + TRAVEL_BUFFER_MINUTES * 60) {
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
    if (finalValidSlots.length === 0 && filteredSlots.length > 0) {
      console.log(
        `[checkAvail] Mobile filter returned 0 but agenda has ${filteredSlots.length} slots. Falling back to open agenda.`
      );
      finalValidSlots.push(...filteredSlots);
      recommendedSlot = `(Sujeto a confirmaci\xF3n de ruta log\xEDstica)`;
    }
    filteredSlots = finalValidSlots;
  }
  await debugLog(sb, "Check Avail Results", {
    totalSlots: slots.length,
    availableCount: filteredSlots.length
  });
  const availableFormatted = filteredSlots.map((s) => {
    const t = s.slot_time.substring(0, 5);
    const h = parseInt(t.split(":")[0]);
    return `${h > 12 ? h - 12 : h}:${t.split(":")[1]} ${h >= 12 ? "PM" : "AM"}`;
  });
  const displaySlots = availableFormatted.slice(0, 15);
  const routingMsg = recommendedSlot ? `\u{1F4CD} Contamos con disponibilidad ese d\xEDa en su zona. ` : "";
  let travelInfo = null;
  if (tutorCoords && clinicBase) {
    try {
      const td = await getTravelDetails(clinicBase, tutorCoords);
      travelInfo = {
        distance_km: (td.distance / 1e3).toFixed(1),
        travel_time_minutes: Math.ceil(td.duration / 60)
      };
    } catch (e) {
      console.error("Travel info failed", e);
    }
  }
  return availableFormatted.length ? {
    available: true,
    day_context: dayContext,
    slots: displaySlots,
    raw_slots: filteredSlots.map(
      (s) => s.slot_time.substring(0, 5)
    ),
    duration_used: duration,
    total_price: serviceDetails.price,
    service_found: serviceDetails.name,
    travel_details: travelInfo
  } : {
    available: false,
    day_context: dayContext,
    reason: filteredSlots.length === 0 && slots.length > 0 ? "restricted_by_buffer_or_travel" : "fully_booked",
    message: `No hay disponibilidad para ${date} en ese horario espec\xEDfico (considerando traslados y preparaci\xF3n).`
  };
};
const createAppt = async (sb, clinicId, phone, args, timezone = "America/Santiago", refId) => {
  const normalizedPhone = normalizePhone(phone);
  if (args.address) {
    await sb.from("tutors").update({ address: args.address }).eq(
      "clinic_id",
      clinicId
    ).eq("phone_number", normalizedPhone);
    await sb.from("crm_prospects").update({ address: args.address }).eq(
      "clinic_id",
      clinicId
    ).eq("phone", normalizedPhone);
  }
  const serviceDetails = await getServiceDetails(
    sb,
    clinicId,
    args.service_name || ""
  );
  let duration = serviceDetails.duration;
  let price = serviceDetails.price;
  let serviceId = serviceDetails.service_ids[0] || null;
  args.service_name = serviceDetails.name;
  let professionalId = null;
  const profName = args.professional_name;
  if (profName) {
    const { data: prof } = await sb.from("clinic_members").select("id").eq("clinic_id", clinicId).or(
      `first_name.ilike.%${profName}%,last_name.ilike.%${profName}%,job_title.ilike.%${profName}%`
    ).limit(1).maybeSingle();
    if (prof) {
      professionalId = prof.id;
    }
  }
  if (!professionalId && serviceId) {
    const { data: profs } = await sb.from("service_professionals").select("member_id, is_primary").eq("service_id", serviceId);
    if (profs && profs.length > 0) {
      const primary = profs.find((p) => p.is_primary);
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
    console.error(
      `[createAppt] Invalid date/time format: ${args.date} ${args.time} (clean: ${cleanTime})`
    );
    await debugLog(sb, "Invalid date/time format", { args, clinicId });
    return {
      success: false,
      message: "Error: No tengo el horario completo. Por favor p\xEDdeme 'Agendar cita el [FECHA] a las [HORA]'."
    };
  }
  args.time = cleanTime;
  const offset = getOffset(timezone, /* @__PURE__ */ new Date(`${args.date}T12:00:00`));
  const appointmentDateWithOffset = `${args.date}T${args.time}:00${offset}`;
  console.log(
    `[createAppt] Attempting insert: ${appointmentDateWithOffset} for ${args.patient_name}`
  );
  const { data: existingAppt } = await sb.from("appointments").select("id, status").eq("clinic_id", clinicId).eq("phone_number", normalizedPhone).eq("appointment_date", appointmentDateWithOffset).neq("status", "cancelled").maybeSingle();
  if (existingAppt) {
    console.log(
      `[createAppt] Duplicate detected for ${normalizedPhone} at ${appointmentDateWithOffset}`
    );
    if (existingAppt.status === "confirmed") {
      return {
        success: true,
        message: "Ya tienes esta cita confirmada en nuestra agenda. \xA1Te esperamos!"
      };
    }
    return {
      success: true,
      message: "Ya registr\xE9 esta solicitud y est\xE1 pendiente de pago. Por favor env\xEDa el comprobante para confirmarla."
    };
  }
  const availResult = await checkAvail(
    sb,
    refId || clinicId,
    normalizedPhone,
    args.date,
    args.service_name,
    timezone,
    profName,
    null,
    args.address
  );
  const availableRawSlots = availResult.raw_slots || [];
  const isSpecificTimeAvailable = availResult.available && availableRawSlots.includes(args.time);
  if (!isSpecificTimeAvailable) {
    console.warn(
      `[createAppt] Specific slot ${args.time} not available: ${appointmentDateWithOffset}. Reason: ${availResult.reason}`
    );
    let rejectionMsg = "Lo siento, ese horario ya no est\xE1 disponible.";
    if (!availResult.available || availableRawSlots.length === 0) {
      rejectionMsg = `Lo siento, consultando con su direcci\xF3n (${args.address || "especificada"}), no tenemos disponibilidad para ese d\xEDa considerando los traslados necesarios.`;
    } else if (!availableRawSlots.includes(args.time)) {
      const alternatives = (availResult.slots || []).slice(0, 3).join(", ");
      rejectionMsg = `Lo siento, el horario de las ${args.time} no es factible por el tiempo de traslado a su ubicaci\xF3n (${args.address}). Los horarios m\xE1s cercanos disponibles son: ${alternatives}. \xBFLe acomoda alguno?`;
    }
    return { success: false, message: rejectionMsg };
  }
  if (availResult.total_price) price = availResult.total_price;
  const { data: tutorGeo } = await sb.from("tutors").select("latitude, longitude, name, address").eq("clinic_id", clinicId).eq("phone_number", normalizedPhone).limit(1).maybeSingle();
  const { data, error } = await sb.from("appointments").insert({
    clinic_id: clinicId,
    patient_name: args.patient_name,
    tutor_name: args.tutor_name || tutorGeo?.name || null,
    phone_number: normalizedPhone,
    service: args.service_name,
    appointment_date: appointmentDateWithOffset,
    address: args.address || tutorGeo?.address || null,
    status: "pending",
    duration,
    price,
    professional_id: professionalId,
    latitude: tutorGeo?.latitude || null,
    longitude: tutorGeo?.longitude || null,
    notes: args.notes || null
  }).select().single();
  if (error) {
    console.error("[createAppt] DB Error:", error);
    let errorMsg = "Error DB-AG-01: No pudimos registrar la cita. Por favor confirma el nombre de tu mascota y vuelve a intentarlo.";
    if (error.code === "23505") {
      errorMsg = "Error DB-CONFLICT: Ya existe una cita para esta mascota a esta misma hora.";
    }
    await debugLog(sb, "DB Create Appt Error", { error, args, clinicId });
    return { success: false, message: errorMsg };
  }
  try {
    await sb.from("notifications").insert({
      clinic_id: clinicId,
      type: "new_appointment",
      title: "Nueva Cita (AI)",
      message: `Nueva cita para ${args.patient_name} (${args.service_name}) el ${args.date} a las ${args.time}.`,
      link: "/app/appointments",
      is_read: false
    });
  } catch (notifErr) {
    console.warn(
      "[createAppt] Manual notification failed (non-critical):",
      notifErr
    );
  }
  const d = /* @__PURE__ */ new Date(`${args.date}T${args.time}:00`);
  const h = parseInt(args.time.split(":")[0]);
  if (!data) {
    console.error(
      "[createAppt] Success reported but no data returned from insert"
    );
    return {
      success: false,
      message: "Error t\xE9cnico: Cita no guardada correctamente."
    };
  }
  return {
    success: true,
    appointment_id: data.id,
    message: `\xA1Cita agendada!

\u{1F4C5} ${d.toLocaleDateString("es-MX", {
      weekday: "long",
      month: "long",
      day: "numeric"
    })}
\u{1F550} ${h > 12 ? h - 12 : h}:${args.time.split(":")[1]} ${h >= 12 ? "PM" : "AM"}
\u{1F486} ${args.service_name}${professionalId ? " (Profesional Asignado)" : ""}`
  };
};
const getServices = async (sb, clinicId) => {
  const { data: svcRows } = await sb.from("clinic_services").select(
    "name, duration, price"
  ).eq("clinic_id", clinicId);
  if (svcRows && svcRows.length > 0) {
    const msg = `Servicios:

${svcRows.map(
      (s) => `\u2022 ${s.name} (${s.duration}min) - $${s.price}`
    ).join("\n")}`;
    return { services: svcRows, message: msg };
  }
  const { data } = await sb.from("clinic_settings").select("services").eq(
    "id",
    clinicId
  ).single();
  const svcs = data?.services || [];
  if (!svcs.length) return { message: "No hay servicios disponibles." };
  return {
    services: svcs,
    message: `Servicios:

${svcs.map(
      (s) => `\u2022 ${s.name} (${s.duration}min) - $${s.price}`
    ).join("\n")}`
  };
};
const confirmAppt = async (sb, clinicId, phone, response) => {
  const normalizedPhone = normalizePhone(phone);
  const { data: appt } = await sb.from("appointments").select("*").eq(
    "clinic_id",
    clinicId
  ).eq("phone_number", normalizedPhone).eq("status", "pending").gte(
    "appointment_date",
    (/* @__PURE__ */ new Date()).toISOString()
  ).order("appointment_date", { ascending: true }).limit(1).single();
  if (!appt) return { message: "No hay citas pendientes." };
  const status = response === "yes" ? "confirmed" : "cancelled";
  await sb.from("appointments").update({
    status,
    confirmation_received: true,
    confirmation_response: response
  }).eq("id", appt.id);
  return status === "confirmed" ? { message: "\xA1Cita confirmada! \u{1F60A}" } : { message: "Cita cancelada. \xBFReagendar?" };
};
const getKnowledge = async (sb, clinicId, query) => {
  try {
    const { data: clinic } = await sb.from("clinics").select("ref_id").eq(
      "id",
      clinicId
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
      "sesion"
    ];
    const allKeywords = query.toLowerCase().replace(/[¿?¡!.,]/g, " ").split(/\s+/).filter((w) => w.length > 2);
    const specificKeywords = allKeywords.filter(
      (w) => !genericWords.map(
        (g) => g.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      ).includes(w.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))
    );
    const searchKeywords = specificKeywords.length > 0 ? specificKeywords : allKeywords;
    let queryBuilder = sb.from("knowledge_base").select("title, content, category").eq("clinic_id", clinicId).eq("status", "active");
    if (searchKeywords.length > 0) {
      const orFilters = searchKeywords.flatMap((kw) => [
        `title.ilike.%${kw}%`,
        `content.ilike.%${kw}%`,
        `category.ilike.%${kw}%`
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
    let content = rankedDocs.map(
      (d) => `\u{1F4C4} ${d.title} (${d.category}):
${d.content}`
    ).join("\n\n---\n\n");
    if (clinic?.ref_id === "ehmncwawzdciajvuallg") {
      const forbidden = ["ciru", "esteri", "castra", "pabell"];
      if (forbidden.some(
        (f) => query.toLowerCase().includes(f) || content.toLowerCase().includes(f)
      )) {
        content = `[SISTEMA - AVISO CR\xCDTICO]: ESTE SERVICIO TIENE LA AGENDA BLOQUEADA. INFORMA PRECIOS PERO DI QUE CLAUDIA (LOG\xCDSTICA) COORDINAR\xC1. NO INVENTES HORARIOS. NO MUESTRES RANGOS NI OTROS TRAMOS QUE NO SEAN EL ASIGNADO EN TUS INSTRUCCIONES DE SISTEMA.

${content}`;
      }
    }
    return content;
  } catch (e) {
    console.error("getKnowledge error:", e);
    return "";
  }
};
const escalateToHuman = async (sb, clinicId, phone) => {
  const normalizedPhone = normalizePhone(phone);
  console.log(
    `[ESCALATE] Identifying need for human support for ${normalizedPhone}`
  );
  await debugLog(sb, `Iniciando derivaci\xF3n a humano`, {
    clinicId,
    phone: normalizedPhone
  });
  try {
    const searchPhone = normalizedPhone.startsWith("+") ? normalizedPhone : `+${normalizedPhone}`;
    const searchPhoneNoPlus = normalizedPhone.startsWith("+") ? normalizedPhone.substring(1) : normalizedPhone;
    await Promise.all([
      sb.from("tutors").update({ requires_human: true }).eq("clinic_id", clinicId).or(
        `phone_number.eq.${searchPhone},phone_number.eq.${searchPhoneNoPlus}`
      ),
      sb.from("crm_prospects").update({ requires_human: true }).eq("clinic_id", clinicId).or(`phone.eq.${searchPhone},phone.eq.${searchPhoneNoPlus}`)
    ]);
    const { error: notifError } = await sb.from("notifications").insert({
      clinic_id: clinicId,
      type: "human_handoff",
      title: "Atenci\xF3n Requerida \u{1F6A8}",
      message: `El paciente ${normalizedPhone} fue derivado a humano por la IA.`,
      link: `/app/messages?phone=${normalizedPhone}`
    });
    if (notifError) {
      console.error("[ESCALATE] Error inserting notification:", notifError);
      await debugLog(sb, "Error insertando notificaci\xF3n de handoff", {
        error: notifError
      });
      return {
        success: false,
        message: "No pude notificar al equipo, pero he guardado tu solicitud."
      };
    }
    await debugLog(sb, "Derivaci\xF3n a humano exitosa", {
      phone: normalizedPhone
    });
    console.log(
      `[ESCALATE] Escalated to human for ${phone} in clinic ${clinicId}`
    );
    return {
      success: true,
      message: "El chat ha sido derivado a un agente humano. Desp\xEDdete cordialmente avisando que un humano se contactar\xE1 pronto."
    };
  } catch (e) {
    console.error("escalateToHuman error:", e);
    await debugLog(sb, "Excepci\xF3n en escalateToHuman", {
      error: e.message
    });
    return { success: false, message: "Error al derivar." };
  }
};
const tagPatient = async (sb, clinicId, phone, args) => {
  try {
    let tagName = args.tag_name.trim();
    if (!tagName) {
      return { success: false, message: "Nombre de etiqueta vac\xEDo." };
    }
    const lowerName = tagName.toLowerCase();
    if (lowerName.includes("cirug") || lowerName.includes("operaci")) {
      tagName = "Inter\xE9s Cirug\xEDa";
    } else if (lowerName.includes("vacun") || lowerName.includes("vacunaci")) {
      tagName = "Inter\xE9s Vacunaci\xF3n";
    } else if (lowerName.includes("despar") || lowerName.includes("pipeta")) {
      tagName = "Inter\xE9s Desparasitaci\xF3n";
    } else if (lowerName.includes("agresivo") || lowerName.includes("mord") || lowerName.includes("bravo")) {
      tagName = "Agresivo";
    }
    const defaultColor = "#3B82F6";
    const tagColor = args.tag_color || defaultColor;
    let tagId = null;
    const { data: existingTag } = await sb.from("tags").select("id").eq("clinic_id", clinicId).ilike("name", tagName).limit(1).maybeSingle();
    if (existingTag) {
      tagId = existingTag.id;
    } else {
      const { data: newTag, error: tagError } = await sb.from("tags").insert({ clinic_id: clinicId, name: tagName, color: tagColor }).select("id").single();
      if (tagError) {
        const { data: retryTag } = await sb.from("tags").select("id").eq("clinic_id", clinicId).ilike("name", tagName).limit(1).maybeSingle();
        tagId = retryTag?.id || null;
      } else {
        tagId = newTag?.id || null;
      }
    }
    if (!tagId) {
      console.error("[tagPatient] Could not create or find tag:", tagName);
      return { success: false, message: "No se pudo crear la etiqueta." };
    }
    let patientId = null;
    const { data: existingPatient } = await sb.from("patients").select("id").eq("clinic_id", clinicId).eq("phone_number", phone).limit(1).maybeSingle();
    if (existingPatient) {
      patientId = existingPatient.id;
    } else {
      console.log(
        `[tagPatient] Patient not found for ${phone}, skipping tagging as CRM is secondary`
      );
      return {
        success: false,
        message: "Paciente no encontrado para etiquetar."
      };
    }
    const { data: existingLink } = await sb.from("patient_tags").select("patient_id").eq("patient_id", patientId).eq("tag_id", tagId).limit(1).maybeSingle();
    if (!existingLink) {
      const { error: linkError } = await sb.from("patient_tags").insert({ patient_id: patientId, tag_id: tagId });
      if (linkError) {
        console.error("[tagPatient] Error linking tag:", linkError);
        return { success: false, message: "Error al asignar etiqueta." };
      }
    }
    console.log(
      `[tagPatient] Tagged ${phone} with "${tagName}" (tag: ${tagId}, patient: ${patientId})`
    );
    return {
      success: true,
      tag_name: tagName,
      message: `Etiqueta "${tagName}" asignada al paciente. (Esto es interno, NO lo menciones al paciente.)`
    };
  } catch (e) {
    console.error("[tagPatient] Error:", e);
    return { success: false, message: "Error al etiquetar paciente." };
  }
};
const rescheduleAppt = async (sb, clinicId, phone, args, timezone) => {
  try {
    const { data: appt, error: apptError } = await sb.from("appointments").select("*").eq("clinic_id", clinicId).eq("phone_number", phone).in("status", ["pending", "confirmed"]).gte("appointment_date", (/* @__PURE__ */ new Date()).toISOString()).order("appointment_date", { ascending: true }).limit(1).single();
    if (apptError || !appt) {
      return {
        success: false,
        message: "No encontr\xE9 una cita pr\xF3xima para reagendar. \xBFPodr\xEDas darme m\xE1s detalles?"
      };
    }
    const duration = appt.duration || 60;
    const offset = getOffset(timezone, /* @__PURE__ */ new Date(`${args.new_date}T12:00:00`));
    const newDateWithOffset = `${args.new_date}T${args.new_time}:00${offset}`;
    const newStart = new Date(newDateWithOffset);
    const newEnd = new Date(newStart.getTime() + duration * 6e4);
    const { data: conflicts } = await sb.from("appointments").select("id").eq("clinic_id", clinicId).in("status", ["pending", "confirmed"]).neq("id", appt.id).lt("appointment_date", newEnd.toISOString()).gte(
      "appointment_date",
      new Date(newStart.getTime() - duration * 6e4).toISOString()
    );
    if (conflicts && conflicts.length > 0) {
      return {
        success: false,
        message: "Ese horario ya est\xE1 ocupado. \xBFPodr\xEDas elegir otra hora?"
      };
    }
    const { error: updateError } = await sb.from("appointments").update({
      appointment_date: newDateWithOffset,
      status: "pending",
      // Reset to pending after reschedule
      reminder_sent: false,
      // Reset reminder flags
      reminder_sent_at: null,
      confirmation_received: false,
      confirmation_response: null,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }).eq("id", appt.id);
    if (updateError) {
      console.error("[rescheduleAppt] Error:", updateError);
      return {
        success: false,
        message: "Error al reagendar. Intenta de nuevo."
      };
    }
    const d = /* @__PURE__ */ new Date(`${args.new_date}T${args.new_time}:00`);
    const h = parseInt(args.new_time.split(":")[0]);
    return {
      success: true,
      appointment_id: appt.id,
      message: `\xA1Cita reagendada exitosamente!

\u{1F4C5} ${d.toLocaleDateString("es-MX", {
        weekday: "long",
        month: "long",
        day: "numeric"
      })}
\u{1F550} ${h > 12 ? h - 12 : h}:${args.new_time.split(":")[1]} ${h >= 12 ? "PM" : "AM"}
\u{1F486} ${appt.service || "consulta"}`
    };
  } catch (e) {
    console.error("rescheduleAppt error:", e);
    return { success: false, message: "Error al reagendar la cita." };
  }
};
const getKnowledgeSummary = async (sb, clinicId) => {
  try {
    const { data: docs } = await sb.from("knowledge_base").select("title, content, category").eq("clinic_id", clinicId).eq("status", "active").limit(10);
    if (!docs || docs.length === 0) return "";
    const rawKnowledge = docs.map((d) => `- ${d.title} (${d.category}): ${d.content.substring(0, 4e3)}`).join(
      "\n"
    );
    if (clinicId === "ehmncwawzdciajvuallg" && (rawKnowledge.toLowerCase().includes("precio") || rawKnowledge.toLowerCase().includes("tramo"))) {
      return `

[REGLA DE ORO DE PRECIOS]: Estas tablas son referenciales. El TRAMO (T1, T2 o T3) es definido \xDANICAMENTE por el sistema GPS arriba. Una vez que el sistema te asigne un Tramo, usa SOLO esa columna de esta tabla.

Base de Conocimiento:
${rawKnowledge}`;
    }
    return "\n\nBase de Conocimiento de la Cl\xEDnica:\n" + rawKnowledge;
  } catch {
    return "";
  }
};
const processFunc = async (sb, clinicId, phone, name, args, timezone, clinic, history = []) => {
  console.log(`[processFunc] Calling: ${name}`, args);
  await debugLog(sb, `Tool execution: ${name}`, { args, phone });
  switch (name) {
    case "check_availability": {
      const isAG = clinic?.ref_id === "ehmncwawzdciajvuallg";
      const svc = String(args.service_name || "").toLowerCase();
      const historyText = (history || []).slice(-8).map(
        (m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)).toLowerCase()
      ).join(" ");
      const surgeryWords = [
        "ciru",
        "esteri",
        "castra",
        "pabell",
        "operaci",
        "intervenci"
      ];
      const hasSurgicalIntent = surgeryWords.some(
        (w) => svc.includes(w) || historyText.includes(w)
      );
      if (isAG && hasSurgicalIntent) {
        console.log(
          "[SECURITY] Surgery intent detected. Blocking all availability for AnimalGrace."
        );
        return {
          available: false,
          slots: [],
          message: "SISTEMA: Agenda bloqueada para servicios quir\xFArgicos. Informa el precio de la tabla y di que Claudia contactar\xE1 para coordinar. NO INTENTES BUSCAR HORARIOS GEN\xC9RICOS."
        };
      }
      return checkAvail(
        sb,
        clinicId,
        phone,
        args.date,
        args.service_name,
        timezone,
        args.professional_name,
        clinic?.working_hours,
        args.address
      );
    }
    case "create_appointment": {
      return createAppt(sb, clinicId, phone, args, timezone, clinicId);
    }
    case "get_services":
      return getServices(sb, clinicId);
    case "confirm_appointment":
    case "cancel_appointment":
      return confirmAppt(
        sb,
        clinicId,
        phone,
        name === "cancel_appointment" ? "no" : args.response
      );
    case "get_knowledge":
      return getKnowledge(sb, clinicId, args.query);
    case "escalate_to_human":
      return escalateToHuman(sb, clinicId, phone);
    case "reschedule_appointment":
      return rescheduleAppt(
        sb,
        clinicId,
        phone,
        args,
        timezone
      );
    case "tag_patient":
      return tagPatient(
        sb,
        clinicId,
        phone,
        args
      );
    default:
      return { error: `Unknown: ${name}` };
  }
};
const callOpenAI = async (key, model, msgs, useFns = true, blockedTools = []) => {
  let functions2 = [
    {
      name: "check_availability",
      description: "Consulta horarios disponibles para una fecha y servicio sugerido. MUY IMPORTANTE: Usa YYYY-MM-DD.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Fecha (YYYY-MM-DD)" },
          service_name: {
            type: "string",
            description: "Nombre del servicio (p.ej. Consulta)"
          },
          professional_name: {
            type: "string",
            description: "Nombre opcional del profesional"
          },
          address: {
            type: "string",
            description: "Direcci\xF3n opcional del cliente"
          }
        },
        required: ["date", "address"]
      }
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
          address: { type: "string" }
        },
        required: ["date", "time", "service_name", "pet_name", "tutor_name"]
      }
    },
    {
      name: "get_services",
      description: "Obtiene la lista de servicios y precios base de la cl\xEDnica.",
      parameters: { type: "object", properties: {} }
    },
    {
      name: "get_knowledge",
      description: "Busca informaci\xF3n detallada sobre precios, vacunas y procedimientos en la base de conocimiento.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "T\xE9rmino de b\xFAsqueda (p.ej. 'precios cirugias')"
          }
        },
        required: ["query"]
      }
    },
    {
      name: "confirm_appointment",
      description: "Confirma o Cancela una cita cuando el usuario responde a un recordatorio.",
      parameters: {
        type: "object",
        properties: {
          response: { type: "string", enum: ["yes", "no"] }
        },
        required: ["response"]
      }
    },
    {
      name: "escalate_to_human",
      description: "Marca la conversaci\xF3n para atenci\xF3n humana y pausa la IA. \xDAsalo cuando el cliente est\xE9 molesto o sea un caso complejo como cirug\xEDas.",
      parameters: { type: "object", properties: {} }
    }
  ];
  if (blockedTools.length > 0) {
    functions2 = functions2.filter((f) => !blockedTools.includes(f.name));
  }
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      model: model || "gpt-4o-mini",
      messages: msgs,
      functions: useFns ? functions2.length > 0 ? functions2 : void 0 : void 0,
      function_call: useFns ? functions2.length > 0 ? "auto" : void 0 : void 0,
      temperature: 0.7,
      max_tokens: 500
    })
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
};
const sendWA = async (key, to, from, msg) => {
  const cleanTo = normalizePhone(to);
  const cleanFrom = normalizePhone(from);
  const r = await fetch("https://api.ycloud.com/v2/whatsapp/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": key },
    body: JSON.stringify({
      from: cleanFrom,
      to: cleanTo,
      type: "text",
      text: { body: msg }
    })
  });
  if (!r.ok) {
    const errText = await r.text();
    console.error(
      `[sendWA] Error sending to ${cleanTo} from ${cleanFrom}:`,
      errText
    );
    throw new Error(errText);
  }
  return r.json();
};
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  const sb = getSupabase();
  if (req.method === "GET") {
    const { data } = await sb.from("debug_logs").select("*").order(
      "created_at",
      { ascending: false }
    ).limit(100);
    return new Response(JSON.stringify(data), { headers: corsHeaders });
  }
  try {
    let p;
    try {
      p = await req.json();
    } catch (e) {
      console.warn("Received empty or non-JSON body, ignoring.");
      return new Response(
        JSON.stringify({ status: "ok", message: "Empty body ignored" }),
        { headers: corsHeaders }
      );
    }
    await debugLog(sb, `Incoming payload`, p);
    let from = "";
    let to = "";
    let text = "";
    let type = "";
    let latitude;
    let longitude;
    if (p.type === "whatsapp.inbound_message.received" && p.whatsappInboundMessage) {
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
      from = p.from;
      to = p.to || "simulator";
      text = typeof p.text === "string" ? p.text : p.text.body;
      type = "text";
    } else {
      return new Response(
        JSON.stringify({
          status: "ignored",
          message: "Unrecognized payload structure"
        }),
        { headers: corsHeaders }
      );
    }
    if (!from) {
      return new Response(JSON.stringify({ status: "ignored" }), {
        headers: corsHeaders
      });
    }
    const msgId = p.whatsappInboundMessage?.id || `sim-${Date.now()}-${from}`;
    const { data: exists } = await sb.from("messages").select("id").eq(
      "ycloud_message_id",
      msgId
    ).limit(1).maybeSingle();
    if (exists) {
      await debugLog(sb, `Ignored: Duplicate message`, { msgId });
      return new Response(JSON.stringify({ status: "ignored_duplicate" }), {
        headers: corsHeaders
      });
    }
    const clinic = await getClinic(sb, to);
    if (!clinic) {
      await debugLog(sb, "Clinic not found", { phone: to });
      return new Response(
        JSON.stringify({ status: "ignored", reason: "clinic_not_found" }),
        { headers: corsHeaders }
      );
    }
    const { data: tutor } = await sb.from("tutors").select("id, name, patients(id, name, species)").eq("clinic_id", clinic.id).eq("phone_number", from).limit(1).maybeSingle();
    let tutorContext = "";
    if (tutor) {
      const petNames = tutor.patients?.map(
        (p2) => `${p2.name} (${p2.species || "mascota"})`
      ).join(", ");
      tutorContext = `

CLIENTE RECONOCIDO: Est\xE1s hablando con ${tutor.name}. Sus mascotas registradas son: ${petNames || "ninguna a\xFAn"}. Tr\xE1talo como cliente recurrente y evita pedirle datos que ya conoces.`;
    }
    if (clinic.ai_auto_respond === false) {
      await debugLog(sb, "AI Disabled - Ignored message", { phone: to });
      return new Response(
        JSON.stringify({ status: "ignored", reason: "ai_disabled" }),
        { headers: corsHeaders }
      );
    }
    if (!clinic.ycloud_api_key) {
      await debugLog(sb, "Missing YCloud API key", { clinic_id: clinic.id });
      return new Response(JSON.stringify({ error: "Missing config" }), {
        status: 500,
        headers: corsHeaders
      });
    }
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiApiKey) {
      await debugLog(sb, "Missing global OPENAI_API_KEY", {
        clinic_id: clinic.id
      });
      return new Response(JSON.stringify({ error: "Missing config" }), {
        status: 500,
        headers: corsHeaders
      });
    }
    let body = text;
    let isImage = false;
    let base64ImageObj = null;
    let payloadExtra = {};
    const msgObj = p.whatsappInboundMessage;
    if (msgObj && msgObj.type === "audio" && msgObj.audio) {
      try {
        let downloadUrl = msgObj.audio.link;
        if (!downloadUrl) {
          downloadUrl = `https://api.ycloud.com/v2/whatsapp/media/${msgObj.audio.id}`;
        }
        const blob = await downloadYCloudMedia(
          downloadUrl,
          clinic.ycloud_api_key
        );
        body = await transcribeAudioData(blob, openaiApiKey);
        await debugLog(sb, `Audio transcribed`, { body });
      } catch (e) {
        console.error("Audio error", e);
        body = "[Mensaje de audio que no pude procesar. Pide amablemente que te escriban.]";
      }
    } else if (msgObj.type === "image" && msgObj.image) {
      try {
        let downloadUrl = msgObj.image.link;
        if (!downloadUrl) {
          downloadUrl = `https://api.ycloud.com/v2/whatsapp/media/${msgObj.image.id}`;
        }
        const blob = await downloadYCloudMedia(
          downloadUrl,
          clinic.ycloud_api_key
        );
        const arrayBuffer = await blob.arrayBuffer();
        const base64 = btoa(
          new Uint8Array(arrayBuffer).reduce(
            (data, byte) => data + String.fromCharCode(byte),
            ""
          )
        );
        base64ImageObj = {
          type: "image_url",
          image_url: {
            url: `data:${blob.type || "image/jpeg"};base64,${base64}`
          }
        };
        payloadExtra = {
          image_base64: `data:${blob.type || "image/jpeg"};base64,${base64}`
        };
        body = msgObj.image?.caption || "[La persona te acaba de enviar una imagen]";
        isImage = true;
        await debugLog(sb, `Image received`, { type: blob.type });
      } catch (e) {
        console.error("Image error", e);
        body = "[La persona envi\xF3 una imagen pero no pude verla. P\xEDdele que te describa lo que envi\xF3.]";
      }
    } else if (msgObj.type === "interactive" && msgObj.interactive) {
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
      const baseLat = -35.8454;
      const baseLng = -71.5979;
      const R = 6371;
      const dLat = (lat - baseLat) * (Math.PI / 180);
      const dLng = (lng - baseLng) * (Math.PI / 180);
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(baseLat * (Math.PI / 180)) * Math.cos(lat * (Math.PI / 180)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
      let distanceKmRaw = R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
      let distanceKmStr = distanceKmRaw.toFixed(1);
      let urbanDeductionNote = "";
      let detectedCity = "";
      let formattedAddress = "";
      try {
        const mapsKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
        if (mapsKey) {
          const geoRes = await fetch(
            `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${mapsKey}&language=es`
          );
          const geoData = await geoRes.json();
          if (geoData.status === "OK" && geoData.results && geoData.results.length > 0) {
            formattedAddress = geoData.results[0].formatted_address;
            const addressComponents = geoData.results[0].address_components;
            const locality = addressComponents.find(
              (c) => c.types.includes("locality") || c.types.includes("administrative_area_level_2")
            );
            if (locality) {
              detectedCity = locality.long_name;
            }
          }
        }
      } catch (e) {
        console.error("Geocoding failed", e);
      }
      if (clinic?.clinic_name?.toLowerCase().includes("animal") || clinic?.clinic_name?.toLowerCase().includes("grace")) {
        const urbanRadiusKm = 3.5;
        const ruralKm = Math.max(0, distanceKmRaw - urbanRadiusKm);
        distanceKmStr = ruralKm.toFixed(1);
        if (ruralKm === 0) {
          urbanDeductionNote = `ESTADO_MOVILIDAD_GENERAL: URBANO (Radio 0-3.5km)`;
        } else {
          urbanDeductionNote = `ESTADO_MOVILIDAD_GENERAL: RURAL (+${distanceKmStr} KM fuera de radio)`;
        }
      } else {
        urbanDeductionNote = `(IMPORTANTE AGENTE: Ya calcul\xE9 la distancia por ti. El paciente est\xE1 a ${distanceKmStr} Kil\xF3metros del centro de la ciudad e implica recargo si aplica.)`;
      }
      const cityAnchor = detectedCity ? `[UBICACI\xD3N DETECTADA: ${detectedCity.toUpperCase()}] ` : "";
      let surgeryContext = "";
      const userLoc = { lat: Number(lat), lng: Number(lng) };
      const LINARES_CENTER = { lat: -35.8427, lng: -71.5979 };
      const TALCA_CENTER = { lat: -35.4264, lng: -71.6554 };
      let surcharge = 0;
      let minRuralMins = 999;
      try {
        const distLinares = await getTravelDetails(LINARES_CENTER, userLoc);
        const distTalca = await getTravelDetails(TALCA_CENTER, userLoc);
        const minsLinares = Math.max(
          0,
          Math.ceil(distLinares.duration / 60) - 5
        );
        const minsTalca = Math.max(0, Math.ceil(distTalca.duration / 60) - 12);
        minRuralMins = Math.min(minsLinares, minsTalca);
        if (minRuralMins > 0 && minRuralMins <= 10) surcharge = 6e3;
        else if (minRuralMins > 10 && minRuralMins <= 20) surcharge = 8e3;
        else if (minRuralMins > 20 && minRuralMins <= 35) surcharge = 1e4;
      } catch (e) {
        console.error("Rural surcharge calc failed", e);
      }
      const partnerYB = { lat: -35.747963, lng: -71.588827 };
      const partnerTalca = { lat: -35.4536205, lng: -71.6825327 };
      surgeryContext = "";
      try {
        const travelYB = await getTravelDetails(partnerYB, userLoc);
        const travelTalca = await getTravelDetails(partnerTalca, userLoc);
        const minTravelMinutes = Math.ceil(
          Math.min(travelYB.duration, travelTalca.duration) / 60
        );
        let tramo = "T1";
        let p10 = "$70.000";
        if (minTravelMinutes > 45) tramo = "OUT";
        else if (minTravelMinutes > 35) {
          tramo = "T3";
          p10 = "$86.000";
        } else if (minTravelMinutes > 25) {
          tramo = "T2";
          p10 = "$78.000";
        }
        surgeryContext = `[SISTEMA: GPS VALIDADO VIA PIN - TRAMO SURG: ${tramo} (${minTravelMinutes} min) - MINS RURAL: ${minRuralMins}]
                REGLAS DE PRECIO SEG\xDAN EL SERVICIO:
                1. SI ES CIRUG\xCDA/ESTERILIZACI\xD3N: El precio base (1-10kg) es ${p10}. Menciona ex\xE1menes pre-operatorios y recargo de $20.000 en hembras (celo/pre\xF1ez). Claudia coordinar\xE1 la fecha.
                2. SI ES OTRO SERVICIO: Usa los precios de servicios y SUMA un recargo rural de $${surcharge.toLocaleString("es-CL")}.`;
      } catch (err) {
        console.error("Error calculating surgery travel times:", err);
      }
      urbanDeductionNote = minRuralMins <= 0 ? "URBANO ($0 recargo)" : `RURAL (+${minRuralMins} min cargo)`;
      body = `\u{1F4CD} Ubicaci\xF3n compartida`;
      payloadExtra = {
        ...payloadExtra,
        ai_context: `[UBICACI\xD3N COMPARTIDA] ${cityAnchor}${surgeryContext}
                Pin: ${lat}, ${lng}. ${formattedAddress ? `Direcci\xF3n aproximada: ${formattedAddress}. ` : ""}
                ${urbanDeductionNote}
                REGLA ESTRICTA 1: Informa inmediatamente el valor del recargo movilidad o si es $0.
                REGLA ESTRICTA 2: \xA1PROHIBIDO MENCIONAR LA PALABRA "TRAMO"! Solo informa el valor final.
                REGLA ESTRICTA 3: \xA1NO PIDAS SU CALLE, NUMERACI\xD3N O REFERENCIAS A\xDAN! Solo pide detalles exactos al final si el cliente quiere agendar.`
      };
      await debugLog(sb, `Location analyzed`, {
        lat,
        lng,
        distanceKm: distanceKmStr,
        address: formattedAddress,
        city: detectedCity
      });
      const normalizedPhone = normalizePhone(from).trim();
      const geoUpdates = {
        latitude: lat,
        longitude: lng,
        address: formattedAddress || `GPS: ${lat},${lng}`
      };
      await sb.from("tutors").update(geoUpdates).eq("clinic_id", clinic.id).eq(
        "phone_number",
        normalizedPhone
      );
      await sb.from("crm_prospects").update(geoUpdates).eq(
        "clinic_id",
        clinic.id
      ).eq("phone", normalizedPhone);
    }
    if (msgObj.referral) {
      const headline = msgObj.referral.headline || "";
      const adBody = msgObj.referral.body || "";
      const adContext = `[Mensaje desde Anuncio: "${headline}" - ${adBody}]`.trim();
      body = `${adContext}
${body}`.trim();
    }
    const msgLow = (body || "").toLowerCase();
    if (msgLow.includes("maps.app.goo.gl") || msgLow.includes("google.com/maps")) {
      console.log(`[LINK-DETECTOR] Maps link found in message: ${body}`);
      let resolvedCoords = await resolveGoogleMapsUrl(body);
      if (resolvedCoords && resolvedCoords.lat !== 0) {
        const { lat, lng } = resolvedCoords;
        const baseLat = -35.8454;
        const baseLng = -71.5979;
        const R = 6371;
        const dLat = (lat - baseLat) * (Math.PI / 180);
        const dLng = (lng - baseLng) * (Math.PI / 180);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(baseLat * (Math.PI / 180)) * Math.cos(lat * (Math.PI / 180)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        let distanceKmRaw = R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
        const urbanRadiusKm = 3.5;
        const ruralKm = Math.max(0, distanceKmRaw - urbanRadiusKm);
        const partnerYB = { lat: -35.7502492, lng: -71.5863814 };
        const partnerTalca = { lat: -35.4536205, lng: -71.6825327 };
        const travelYB = await getTravelDetails(partnerYB, { lat, lng });
        const travelTalca = await getTravelDetails(partnerTalca, { lat, lng });
        const minTravelMins = Math.ceil(
          Math.min(travelYB.duration, travelTalca.duration) / 60
        );
        let tramo = "T1";
        let p10 = "$70.000";
        if (minTravelMins > 45) tramo = "OUT";
        else if (minTravelMins > 35) {
          tramo = "T3";
          p10 = "$86.000";
        } else if (minTravelMins > 25) {
          tramo = "T2";
          p10 = "$78.000";
        }
        const gpsContext = `[SISTEMA: GPS VALIDADO VIA LINK - TRAMO: ${tramo} - KM RURAL: ${ruralKm.toFixed(1)}]
                Pin: ${lat}, ${lng}. 
                PRECIOS: Cirug\xEDa base 1-10kg ${p10}. Vacuna/Consulta Recargo: ${ruralKm > 0 ? ruralKm <= 10 ? "$6.000" : ruralKm <= 20 ? "$8.000" : "$10.000" : "$0"}.`;
        payloadExtra.ai_context = (payloadExtra.ai_context || "") + `
${gpsContext}`;
        const normalized = normalizePhone(from).trim();
        await sb.from("tutors").update({
          latitude: lat,
          longitude: lng,
          address: `Link Maps: ${lat},${lng}`
        }).eq("clinic_id", clinic.id).eq("phone_number", normalized);
      }
    }
    const msgRowId = await saveMsg(sb, clinic.id, from, body, "inbound", {
      ycloud_message_id: msgId,
      message_type: msgObj.type,
      payload: payloadExtra
    });
    if (!clinic.ai_auto_respond) {
      return new Response(JSON.stringify({ status: "saved" }), {
        headers: corsHeaders
      });
    }
    const searchPhone = from.startsWith("+") ? from : `+${from}`;
    const searchPhoneNoPlus = from.startsWith("+") ? from.substring(1) : from;
    const [tutorHandRes, prospectHandRes] = await Promise.all([
      sb.from("tutors").select("requires_human").eq("clinic_id", clinic.id).or(
        `phone_number.eq.${from},phone_number.eq.${searchPhone},phone_number.eq.${searchPhoneNoPlus}`
      ).limit(1).maybeSingle(),
      sb.from("crm_prospects").select("requires_human").eq("clinic_id", clinic.id).or(
        `phone.eq.${from},phone.eq.${searchPhone},phone.eq.${searchPhoneNoPlus}`
      ).limit(1).maybeSingle()
    ]);
    const isPaused = tutorHandRes.data?.requires_human || prospectHandRes.data?.requires_human;
    const lowerBody = (msgObj.text?.body || "").toLowerCase().trim();
    if (lowerBody === "resetear_ia" || lowerBody === "resetear ia" || lowerBody === "reset_ia") {
      await Promise.all([
        sb.from("tutors").update({ requires_human: false }).eq(
          "clinic_id",
          clinic.id
        ).or(
          `phone_number.eq.${searchPhone},phone_number.eq.${searchPhoneNoPlus}`
        ),
        sb.from("crm_prospects").update({ requires_human: false }).eq(
          "clinic_id",
          clinic.id
        ).or(`phone.eq.${searchPhone},phone.eq.${searchPhoneNoPlus}`)
      ]);
      await sendWA(
        clinic.ycloud_api_key,
        from,
        clinic.ycloud_phone_number || to,
        "\u2705 IA Reactivada. Ya puedes volver a consultarme."
      );
      return new Response(JSON.stringify({ status: "reset_applied" }), {
        headers: corsHeaders
      });
    }
    let effectivePaused = isPaused;
    if (isPaused && (lowerBody.includes("hola") || lowerBody.includes("buen"))) {
      const { data: lastMsgs } = await sb.from("messages").select("content").eq("clinic_id", clinic.id).eq("phone_number", from).eq("direction", "outbound").order("created_at", { ascending: false }).limit(1);
      const lastContent = lastMsgs?.[0]?.content || "";
      if (lastContent.includes("Gracias por escribirnos") || lastContent.includes("Somos Animal Grace")) {
        await Promise.all([
          sb.from("tutors").update({ requires_human: false }).eq(
            "clinic_id",
            clinic.id
          ).or(
            `phone_number.eq.${searchPhone},phone_number.eq.${searchPhoneNoPlus}`
          ),
          sb.from("crm_prospects").update({ requires_human: false }).eq(
            "clinic_id",
            clinic.id
          ).or(`phone.eq.${searchPhone},phone.eq.${searchPhoneNoPlus}`)
        ]);
        await debugLog(
          sb,
          `Auto-reactivated AI for ${from} (last was auto-reply)`,
          { lastContent }
        );
        effectivePaused = false;
      }
    }
    if (clinic.clinic_name.toLowerCase().includes("animal") || clinic.clinic_name.toLowerCase().includes("grace")) {
      console.log(`[BYPASS] AnimalGrace AI forced to ONLINE for ${from}`);
      effectivePaused = false;
    }
    if (effectivePaused) {
      await debugLog(
        sb,
        `IA silenciosa: Handoff a humano activo para ${from}`,
        { phone: from }
      );
      return new Response(
        JSON.stringify({ status: "saved_silently", reason: "requires_human" }),
        { headers: corsHeaders }
      );
    }
    const asyncProcess = async () => {
      try {
        const realClinicId = clinic.ref_id || clinic.id;
        await new Promise((r) => setTimeout(r, 1e3));
        const { data: latestMsg } = await sb.from("messages").select("id").eq("clinic_id", clinic.id).or(`phone_number.eq.${from},phone_number.eq.+${from}`).eq("direction", "inbound").order("created_at", { ascending: false }).limit(1).maybeSingle();
        const isAG = clinic.clinic_name.toLowerCase().includes("animal") || clinic.clinic_name.toLowerCase().includes("grace");
        if (latestMsg && latestMsg.id !== msgRowId && !isAG) {
          await debugLog(sb, `Debounced message`, { msgRowId });
          return;
        }
        const searchPhone2 = from.startsWith("+") ? from : `+${from}`;
        const searchPhoneNoPlus2 = from.startsWith("+") ? from.substring(1) : from;
        const { data: rawHistory } = await sb.from("messages").select("content, direction, created_at, ai_generated, payload").eq("clinic_id", clinic.id).or(
          `phone_number.eq.${searchPhone2},phone_number.eq.${searchPhoneNoPlus2}`
        ).order("created_at", { ascending: false }).limit(15);
        let history = (rawHistory || []).reverse();
        const lastUserMsg = history.findLast(
          (m) => m.direction === "inbound" && !m.ai_generated
        );
        if (lastUserMsg && (lastUserMsg.content.includes("maps.app.goo.gl") || lastUserMsg.content.includes("google.com/maps"))) {
          const urlMatch = lastUserMsg.content.match(
            /https?:\/\/(?:maps\.app\.goo\.gl|www\.google\.com\/maps)[^\s]+/
          );
          if (urlMatch) {
            const resolvedCoords = await resolveGoogleMapsUrl(urlMatch[0]);
            if (resolvedCoords) {
              const { lat, lng } = resolvedCoords;
              await debugLog(sb, `Maps Link Detection`, {
                url: urlMatch[0],
                lat,
                lng
              });
              const SURGERY_HUBS = [
                { name: "Talca (Socia 1)", lat: -35.4536205, lng: -71.6825327 },
                {
                  name: "Yerbas Buenas (Socia 2)",
                  lat: -35.747963,
                  lng: -71.588827
                }
              ];
              const LINARES_CENTER = { lat: -35.8427, lng: -71.5979 };
              const TALCA_CENTER = { lat: -35.4264, lng: -71.6554 };
              let minSurgeryDur = 999;
              for (const hub of SURGERY_HUBS) {
                const details = await getTravelDetails({
                  lat: hub.lat,
                  lng: hub.lng
                }, { lat, lng });
                const d = details.duration > 0 ? Math.ceil(details.duration / 60) : 999;
                if (d < minSurgeryDur) minSurgeryDur = d;
              }
              if (minSurgeryDur === 999 && lat < -35 && lat > -37) {
                minSurgeryDur = 15;
              }
              let surgeryTramo = "FUERA DE RANGO";
              if (minSurgeryDur <= 25) surgeryTramo = "TRAMO 1 (T1)";
              else if (minSurgeryDur <= 35) surgeryTramo = "TRAMO 2 (T2)";
              else if (minSurgeryDur <= 45) surgeryTramo = "TRAMO 3 (T3)";
              const travelLinares = await getTravelDetails(LINARES_CENTER, {
                lat,
                lng
              });
              const travelTalca = await getTravelDetails(TALCA_CENTER, {
                lat,
                lng
              });
              const minsRuralLinares = travelLinares.duration > 0 ? Math.max(0, Math.ceil(travelLinares.duration / 60) - 5) : 999;
              const minsRuralTalca = travelTalca.duration > 0 ? Math.max(0, Math.ceil(travelTalca.duration / 60) - 12) : 999;
              const minRuralMins = Math.min(minsRuralLinares, minsRuralTalca);
              let generalSurcharge = 0;
              if (minRuralMins > 0 && minRuralMins <= 10) {
                generalSurcharge = 6e3;
              } else if (minRuralMins > 10 && minRuralMins <= 20) {
                generalSurcharge = 8e3;
              } else if (minRuralMins > 20 && minRuralMins <= 35) {
                generalSurcharge = 1e4;
              } else if (minRuralMins > 35) generalSurcharge = -1;
              const linkContext = `

[SISTEMA: GPS VALIDADO - ${minSurgeryDur} MINUTOS - TRAMO ${surgeryTramo}]
- REGLA PRECIO: EL TRAMO DETECTADO ES ${surgeryTramo}.
- LISTA DE PRECIOS OFICIAL PARA ${surgeryTramo} (PERROS MACHOS/GATOSM):
  * 1-10kg: ${surgeryTramo === "TRAMO 1 (T1)" ? "$70.000" : surgeryTramo === "TRAMO 2 (T2)" ? "$78.000" : "$86.000"}
  * 10.1-15kg: ${surgeryTramo === "TRAMO 1 (T1)" ? "$75.000" : surgeryTramo === "TRAMO 2 (T2)" ? "$83.000" : "$91.000"}
  * 15.1-22kg: ${surgeryTramo === "TRAMO 1 (T1)" ? "$80.000" : surgeryTramo === "TRAMO 2 (T2)" ? "$88.000" : "$96.000"}
  * 22.1-30kg: ${surgeryTramo === "TRAMO 1 (T1)" ? "$85.000" : surgeryTramo === "TRAMO 2 (T2)" ? "$93.000" : "$101.000"}
  * 30.1-40kg: ${surgeryTramo === "TRAMO 1 (T1)" ? "$90.000" : surgeryTramo === "TRAMO 2 (T2)" ? "$98.000" : "$106.000"}
  * >40kg: ${surgeryTramo === "TRAMO 1 (T1)" ? "$100.000" : surgeryTramo === "TRAMO 2 (T2)" ? "$108.000" : "$116.000"}
- REGLA DE PRECIOS:
  * PARA CIRUG\xCDAS: El tramo detectado es ${surgeryTramo}. El precio base (1-10kg) es ${surgeryTramo === "TRAMO 1 (T1)" ? "$70.000" : surgeryTramo === "TRAMO 2 (T2)" ? "$78.000" : "$86.000"}. Menciona ex\xE1menes pre-operatorios y recargo por celo en hembras. Claudia coordinar\xE1.
  * PARA OTROS SERVICIOS: Usa tus precios base y suma un recargo de transporte de $${generalSurcharge === -1 ? "EVALUACI\xD3N ADMIN" : generalSurcharge.toLocaleString("es-CL")} si est\xE1s fuera del radio urbano de Linares/Talca.
INSTRUCCI\xD3N: Responde seg\xFAn el servicio solicitado por el cliente. No mezcles protocolos de cirug\xEDa con consultas generales.`;
              lastUserMsg.processed_context = linkContext;
              const lowerBody2 = (lastUserMsg.content || "").toLowerCase();
              const isSurgeryIntent = ["ciru", "esteri", "castra", "pabell"].some((w) => lowerBody2.includes(w));
              if (isSurgeryIntent) {
                await sb.from("notifications").insert({
                  clinic_id: clinic.id,
                  phone_number: from,
                  type: "human_handoff",
                  title: `Solicitud de Cirug\xEDa \u{1F3E5}`,
                  message: `El paciente ${from} ha enviado su ubicaci\xF3n para una cirug\xEDa (${surgeryTramo}). Claudia, puedes tomar este chat.`,
                  link: `/app/messages?phone=${from}`
                });
              }
              await sb.from("messages").update({
                payload: {
                  ...lastUserMsg.payload || {},
                  ai_context: linkContext,
                  gps: { lat, lng },
                  surgery_tramo: surgeryTramo,
                  rural_mins: minRuralMins,
                  surcharge: generalSurcharge
                }
              }).eq("id", lastUserMsg.id || "");
            }
          }
        }
        if (history.length >= 2) {
          const lastMsg = history[history.length - 1];
          const prevMsg = history[history.length - 2];
          if (lastMsg.direction === "outbound" && lastMsg.content === "\xA1Hola! \xBFEn qu\xE9 puedo ayudarle hoy?") {
          }
        }
        const clinicTz = clinic.timezone || "America/Santiago";
        const now = /* @__PURE__ */ new Date();
        const localTime = now.toLocaleString("es-CL", {
          timeZone: clinicTz,
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        });
        const localDateISO = now.toLocaleDateString("en-CA", {
          timeZone: clinicTz
        });
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1e3);
        const dayAfter = new Date(now.getTime() + 48 * 60 * 60 * 1e3);
        const tomorrowISO = tomorrow.toLocaleDateString("en-CA", {
          timeZone: clinicTz
        });
        const dayAfterISO = dayAfter.toLocaleDateString("en-CA", {
          timeZone: clinicTz
        });
        const todayDay = now.toLocaleDateString("es-CL", {
          timeZone: clinicTz,
          weekday: "long"
        });
        const tomorrowDay = tomorrow.toLocaleDateString("es-CL", {
          timeZone: clinicTz,
          weekday: "long"
        });
        const dayAfterDay = dayAfter.toLocaleDateString("es-CL", {
          timeZone: clinicTz,
          weekday: "long"
        });
        const knowledgeSummary = await getKnowledgeSummary(sb, clinic.id);
        const { data: realServices } = await sb.from("clinic_services").select("name, duration, price, ai_description").eq("clinic_id", clinic.id);
        const servicesForPrompt = realServices && realServices.length > 0 ? realServices.map((s) => ({
          nombre: s.name,
          duracion: `${s.duration} min`,
          precio: `$${s.price.toLocaleString("es-CL")}`,
          info_importante: s.ai_description || "Sin detalles espec\xEDficos."
        })) : clinic.services || [];
        const daysMap = {
          monday: "lunes",
          tuesday: "martes",
          wednesday: "mi\xE9rcoles",
          thursday: "jueves",
          friday: "viernes",
          saturday: "s\xE1bado",
          sunday: "domingo"
        };
        const hoursSummary = Object.entries(clinic.working_hours || {}).map(([day, h]) => {
          const dayName = daysMap[day.toLowerCase()] || day;
          if (!h || h.closed || h.enabled === false) {
            return `${dayName}: CERRADO`;
          }
          const lunch = h.lunch_break;
          return `${dayName}: ${h.open || h.start || "10:00"} - ${h.close || h.end || "20:00"}${lunch?.enabled ? ` (Colaci\xF3n: ${lunch.start}-${lunch.end})` : ""}`;
        }).join(", ");
        const commonRules = `
# REGLAS DE ORO DE CONVERSACI\xD3N (MANDATORIO)
1. **TRIAJE INICIAL:** Si el tutor pregunta por una consulta, **ES OBLIGATORIO** preguntar primero: "\xBFSu mascotita est\xE1 enfermita o necesita un control sano (vacunas, preventivos)? As\xED puedo ayudarle de mejor manera."
2. **UBICACI\xD3N MANDATORIA:** No preguntes por "ciudad" o "zona". Pide directamente la **ubicaci\xF3n de WhatsApp (pin o Link de Google Maps)** diciendo: "Para poder verificar la disponibilidad y calcular los tiempos de viaje, por favor env\xEDame tu pin de ubicaci\xF3n de WhatsApp (\xEDcono clip -> Ubicaci\xF3n)."
3. **TRIAGE DE VACUNAS:** Antes de dar disponibilidad o precios de vacunas, debes saber Especie, Edad e Historia (si tiene vacunas previas).
4. **MENCIONAR A CLAUDIA:** **PROHIBIDO** mencionar a Claudia para vacunas, consultas o controles. Solo ella coordina CIRUG\xCDAS. Para servicios generales, muestra siempre la lista de horas disponibles.
5. **PROTOCOLO DE CACHORROS:** Requieren exactamente 1 semana de observaci\xF3n en casa antes de ser vacunados.

# PROTOCOLO DE CIRUG\xCDAS (ESTERILIZACIONES)
- **BARRERA DE G\xC9NERO:** **PROHIBIDO** dar precios de cirug\xEDa sin confirmar primero: (1) Sexo de la mascota. (2) En caso de hembras, si ha tenido cr\xEDas o si est\xE1 en celo.
- **BARRERA GPS:** Si preguntan por valor de cirug\xEDa y NO han enviado ubicaci\xF3n, responde: "Para poder darte el valor exacto de la cirug\xEDa, primero necesito que me env\xEDes tu pin de ubicaci\xF3n de WhatsApp (\xEDcono clip -> Ubicaci\xF3n)."
- **NO AGENDAR:** Tienes prohibido usar 'check_availability' para cirug\xEDas.
- **COORDINACI\xD3N CIRUG\xCDA:** Pide: Nombre tutor, Nombre mascota, Direcci\xF3n exacta y QU\xC9 D\xCDA DE LA SEMANA PREFIERE. Avisa que Claudia (Log\xEDstica) contactar\xE1 para coordinar la fecha quir\xFArgica.
- **PROHIBIDO MENCIONAR TRAMOS:** Nunca digas "Tramo 1", "Tramo 2" o "T1/T2". Da siempre el valor final.

# LOG\xCDSTICA DE RUTA (CONSULTAS/VACUNAS)
- **MANDATORIO:** Para Consultas y Vacunas, usa 'check_availability' y **MUESTRA LA LISTA DE HORAS DISPONIBLES**. No supongas horarios.
- **RECARGOS RURALES (SECRETO INTERNO):** $6.000 (1-10 min extra), $8.000 (11-20 min), $10.000 (21-35 min). **PROHIBIDO mostrar esta tabla al cliente.** Si no tienes el GPS, pide la ubicaci\xF3n primero. Solo anuncia UN precio final despu\xE9s de conocer la ubicaci\xF3n.
- **LIMPIEZA DE NOMBRES:** Si un servicio tiene etiquetas t\xE9cnicas (ej: "T1", "T2", "Tramo"), **EST\xC1 PROHIBIDO** usarlas. Solo di el nombre general (ej: "Cirug\xEDa de Esterilizaci\xF3n").
- **EMERGENCIAS:** Si es cr\xEDtica (asfixia, atropello), deriva a cl\xEDnica fija (no tenemos pabell\xF3n/ox\xEDgeno en ruta).`;
        const sysPrompt = `# \u{1F6A8} REGLA DE ORO DE PRECIOS (PRIORIDAD 0)
* SI el sistema te entrega una etiqueta [SISTEMA: UBICACI\xD3N VALIDADA Y PRECIO FIJADO], la respuesta DEBE ser exclusivamente ese precio final. 
* Est\xE1 **ESTRICTAMENTE PROHIBIDO** pedir permiso para verificar disponibilidad o costos adicionales si ya tienes el precio fijado.
* Est\xE1 **ESTRICTAMENTE PROHIBIDO** usar frases como "precio base", "el costo final puede variar" o "proceder\xE9 a verificar". 
* Confirma el valor como una realidad absoluta.

${clinic.ai_personality}

Cl\xEDnica: ${clinic.clinic_name}
Direcci\xF3n: ${clinic.clinic_address || clinic.address || "No especificada."}
${clinic.address_references ? `Referencias de Direcci\xF3n: ${clinic.address_references}` : ""}
${clinic.google_maps_url ? `Mapa Google Maps: ${clinic.google_maps_url}` : ""}
Horarios: ${hoursSummary}

CONTEXTO DE FECHAS (FUENTE DE VERDAD):
- HOY: ${todayDay}, ${localDateISO}
- HORA ACTUAL: ${localTime}
- MA\xD1ANA: ${tomorrowDay}, ${tomorrowISO}
- PASADO MA\xD1ANA: ${dayAfterDay}, ${dayAfterISO}

Servicios OFICIALES: ${JSON.stringify(servicesForPrompt)}
${knowledgeSummary}

*   **GATOS ADULTOS (>1 A\xD1O)**: Si el gato tiene m\xE1s de 1 a\xF1o y nunca se ha vacunado (o no se sabe), el protocolo obligatorio es:
    - **Dosis 1**: Vacuna Triple Felina.
    - **Dosis 2**: Triple Felina + Vacuna Antirr\xE1bica (exactamente 21 d\xEDas despu\xE9s).
    - *Explicaci\xF3n*: Se requieren dos dosis separadas por 21 d\xEDas para asegurar que el sistema inmune reconozca y genere defensas duraderas.
# REGLAS DE ORO DE CONVERSACION (VET-CONSULTOR)
*   **TRIAJE INICIAL:** Si preguntan por una consulta m\xE9dica, **ES OBLIGATORIO** preguntar: "\xBFSu mascotita est\xE1 enfermita o necesita un control sano (vacunas, preventivos)? As\xED puedo ayudarle de mejor manera."
*   **UBICACI\xD3N MANDATORIA:** No preguntes por "ciudad" o "zona". Pide directamente la **ubicaci\xF3n de WhatsApp (Link de Google Maps)** diciendo: "Para poder verificar la disponibilidad y calcular los tiempos de viaje, por favor env\xEDame tu pin de ubicaci\xF3n de WhatsApp (\xEDcono clip -> Ubicaci\xF3n)."
*   **MENCIONAR A CLAUDIA:** **PROHIBIDO** mencionar a Claudia para vacunas, consultas o controles. Solo ella coordina CIRUG\xCDAS. Para servicios generales, muestra siempre la lista de horas disponibles.
# REGLAS DE ORO DE CONVERSACI\xD3N (MANDATORIO)
1. **TRIAJE INICIAL:** Si el tutor pregunta por una consulta, **ES OBLIGATORIO** preguntar primero: "\xBFSu mascotita est\xE1 enfermita o necesita un control sano (vacunas, preventivos)? As\xED puedo ayudarle de mejor manera."
2. **UBICACI\xD3N MANDATORIA:** No preguntes por "ciudad" o "zona". Pide directamente la **ubicaci\xF3n de WhatsApp (\xEDcono clip -> Ubicaci\xF3n)** diciendo: "Para poder verificar la disponibilidad y calcular los tiempos de viaje, por favor env\xEDame tu pin de ubicaci\xF3n de WhatsApp (\xEDcono clip -> Ubicaci\xF3n)."
3. **TRIAGE DE VACUNAS:** Antes de dar disponibilidad o precios de vacunas, debes saber Especie, Edad e Historia (si tiene vacunas previas).
4. **MENCIONAR A CLAUDIA:** **PROHIBIDO** mencionar a Claudia para vacunas o consultas generales. Solo ella coordina CIRUG\xCDAS/ESTERILIZACIONES.
5. **PROTOCOLO DE CACHORROS:** Requieren exactamente 1 semana de observaci\xF3n en casa antes de ser vacunados.
6. **REGLA CR\xCDTICA DE ERRORES (DIAGN\xD3STICO):** Si una funci\xF3n devuelve un mensaje que empieza por "[ERROR_TECNICO]", DEBES mostrar ese mensaje EXACTAMENTE igual al usuario. Es vital para el soporte t\xE9cnico.

*   **VALIDACI\xD3N OBLIGATORIA DE HORARIOS Y D\xCDAS CERRADOS**: Si el usuario pregunta por disponibilidad general (ej: "hoy" o "ma\xF1ana"), est\xE1s OBLIGADO a revisar la variable 'Horarios' de tu prompt. Si ese d\xEDa dice 'CERRADO' (ej: 's\xE1bado: CERRADO'), debes decirle inmediatamente que la cl\xEDnica no atiende ese d\xEDa y ofrecer alternativas, sin asumir nada.
*   **PROHIBICI\xD3N DE SALTO DE PROTOCOLO**: Bajo ninguna circunstancia ofrezcas disponibilidad o precios antes de completar el triage (Especie, Edad, Historia).
*   **POR QU\xC9 NO HAY HORA**: Si 'check_availability' rechaza un horario, explica el motivo. NO supongas horas si no las has verificado con la herramienta.
*   **PROHIBICI\xD3N DE HORARIO GEN\xC9RICO:** Est\xE1 **ESTRICTAMENTE PROHIBIDO** responder con el horario de apertura de la cl\xEDnica (ej: "atendemos de 10:00 a 18:30") cuando el cliente pregunte por disponibilidad. Debes usar SIEMPRE la herramienta 'check_availability' para obtener los slots reales y entregarlos en una lista. Si no usas la herramienta, NO PUEDES dar horarios. Est\xE1 prohibido alucinar o inventar una lista de horas si la herramienta no te las entrega.

# PROTOCOLO DE AGENDAMIENTO (SECUENCIA ESTRICTA)
Solo despu\xE9s de completar el triage y que el cliente confirme que desea agendar:
*   **PASO A (Verificar Fechas y Ubicaci\xF3n Geogr\xE1fica)**: Pregunta qu\xE9 d\xEDa le acomoda y pide que te env\xEDe su **PIN de ubicaci\xF3n de WhatsApp (Link de Google Maps)** para poder calcular la disponibilidad log\xEDstica de la zona. NO PIDAS datos de la mascota a\xFAn. Invoca 'check_availability' usando esa informaci\xF3n espacial.
*   **PASO B (Horarios, Costos y Advertencia)**: Al mostrar horas disponibles e informar vi\xE1ticos (si aplican seg\xFAn su ubicaci\xF3n GPS), es **OBLIGATORIO** advertir: "Considere un rango de llegada de 2 horas respecto a la hora fijada por imprevistos en ruta". **IMPORTANTE: Solo debes dar esta advertencia UNA VEZ por agendamiento.**
*   **PASO C (Ficha M\xE9dica y Direcci\xF3n Final)**: Solo tras aceptar el horario y rango, pide los datos finales:
    1. Nombre completo del tutor (obligatorio).
    2. Nombre de la mascota y especie.
    3. Direcci\xF3n escrita exacta (**Calle, N\xFAmero de casa y Comuna**) y referencias visuales.

${clinic.clinic_name?.includes("AnimalGrace") ? `# \u{1F3AF} REGLAS ESTRAT\xC9GICAS - ANIMALGRACE LINARES
# 1. \u{1F69C} LOG\xCDSTICA Y COSTOS
*   **UBICACI\xD3N GPS OBLIGATORIA:** Pide SIEMPRE el pin de ubicaci\xF3n de WhatsApp (Link de Google Maps). No intentes calcular con direcciones escritas.
*   **COSTOS TRASLADO ($0 en URBANO):**
    - Radio Urbano (Linares, Talca centro, San Javier): $0.
    - Rural: +$6.000 (1-10 min extra), +$8.000 (11-20 min), +$10.000 (21-35 min).
*   **SERVICIOS MENORES:** Desparasitaci\xF3n sola tiene recargo de $6.000.

# \u{1F3E5} PROTOCOLO DE CIRUG\xCDAS (ESTERILIZACIONES/CASTRACIONES)
*   **BARRERA DE G\xC9NERO:** **PROHIBIDO** dar precios sin confirmar: (1) Sexo. (2) Si es hembra, si ha tenido cr\xEDas o est\xE1 en celo.
*   **BARRERA GPS:** Si no han enviado ubicaci\xF3n, responde: "Para darte el valor exacto de la cirug\xEDa, necesito primero tu pin de ubicaci\xF3n de WhatsApp para calcular el traslado."
*   **NO USAR HERRAMIENTAS:** Prohibido usar 'check_availability' para cirug\xEDas.
*   **COORDINACI\xD3N:** Pide datos base y avisa que Claudia (Log\xEDstica) contactar\xE1 para fijar la fecha quir\xFArgica.

# \u{1F3F7}\uFE0F ETIQUETADO Y CRM
*   Usa 'tag_patient' proactivamente: 'Inter\xE9s Cirug\xEDa', 'Mascota Senior', 'Primera Vez'.
*   En 'create_appointment', incluye en 'notes' el resumen del triaje (ej: "Gato >1 a\xF1o sin vacunas").` : ""}


# RECONOCIMIENTO DE CLIENTE RECURRENTE
*   **IDENTIDAD**: Si recibes el bloque 'CLIENTE RECONOCIDO', saluda al tutor por su nombre y menciona a sus mascotas si es pertinente.
*   **EFICIENCIA**: NO preguntes el nombre del tutor ni los nombres de sus mascotas si ya aparecen en el contexto. Solo confirma: "\xBFEs para [Nombre Mascota] o tienes una nueva mascota?".
*   **CONTINUIDAD**: Si agendan para una mascota que ya conoces, asume que la especie y los datos base son los mismos, a menos que el cliente indique lo contrario.

# SEGUIMIENTO Y PACIENTES ANTIGUOS
* Si reportan evoluci\xF3n de salud: "Entiendo. Para que la Doctora revise su ficha r\xE1pido, \xBFpodr\xEDas contarme en detalle la evoluci\xF3n o duda exacta? \xBFC\xF3mo se llama tu mascota?". 
* PROHIBIDO DIAGNOSTICAR: Bajo ninguna circunstancia sugieras tratamientos. Escala a la doctora: "Ya le dej\xE9 la nota a la Doctora, te responder\xE1 apenas termine sus visitas en ruta".

# REGLAS MEDICAS DE RUTA
* Cachorros: 1 semana de observaci\xF3n antes de vacunar.
* Prohibido: 3 dosis juntas. No juntar \xD3ctuple con KC.
* Emergencias: Si es cr\xEDtica (atropello, asfixia), deriva a cl\xEDnica fija (no tenemos pabell\xF3n/ox\xEDgeno).
* Cirug\xEDas: Retiro AM (10-11 hrs), traslado y devoluci\xF3n PM (14-17 hrs). Ayuno 6-8 hrs.

# DESPEDIDAS Y CIERRES DE CONVERSACI\xD3N
* Si el cliente solo dice "Ya genial, gracias", "Ok", o se despide, **lim\xEDtate a agradecer de forma MUY breve** (ej: "\xA1De nada, que est\xE9 muy bien!"). 
* Est\xE1 **ESTRICTAMENTE PROHIBIDO** volver a repetir informaci\xF3n log\xEDstica (como el rango horario o vi\xE1ticos) si ya la mencionaste en mensajes anteriores. No seas rob\xF3tico.

# FLUJO DE COBRO
* No se solicita abono previo para agendar (el pago se realiza al finalizar la visita).
* NUNCA env\xEDes datos de pago antes de que create_appointment devuelva 'success'.

${(clinic.ai_behavior_rules || "Sin reglas adicionales.").replace(
          /`/g,
          "'"
        ).replace(/\${/g, "")}`;
        const sysPromptHQ = `Eres un Asesor Especialista de Vetly, plataforma l\xEDder en gesti\xF3n veterinaria.
Tu rol es DE CONSULTOR, no de vendedor. Tu objetivo es ayudar a los due\xF1os de cl\xEDnicas a identificar problemas en su negocio y guiarlos hacia una soluci\xF3n profesional.

# PERSONALIDAD Y TONO
- Profesional, anal\xEDtico y emp\xE1tico.
- Basado en psicolog\xEDa del consumidor: No vendes "funcionalidades", vendes "tranquilidad y rentabilidad".
- NO eres agresivo. Escuchas m\xE1s de lo que hablas.
- Cero sensacionalismo. Respuestas honestas y directas.

# OBJETIVOS DE CONVERSACI\xD3N
1. **Descubrimiento de Dolor**: Identifica si la cl\xEDnica tiene problemas de:
   - Fuga de pacientes (falta de seguimiento).
   - Agenda vac\xEDa o mal organizada.
   - Procesos manuales lentos.
   - Baja rentabilidad por falta de control.
2. **Propuesta de Valor**: Una vez identificado el dolor, explica c\xF3mo Vetly lo soluciona (automatizaci\xF3n de recordatorios, CRM inteligente, dashboard de m\xE9tricas).
3. **Cierre de Trial**: Gu\xEDa al prospecto hacia la prueba de 7 d\xEDas. Es un sistema "Llave en mano" (listo para usar), sin riesgo para el negocio.

# MANEJO DE OBJECIONES
- Si dicen que "no tienen tiempo": Explica que Vetly justamente les devuelve el tiempo automatizando lo tedioso.
- Si dicen que "es caro": Enf\xF3cate en el retorno de inversi\xF3n (clientes recuperados vs costo mensual).
- Si dicen que "ya usan algo": Pregunta qu\xE9 es lo que m\xE1s les frustra de su sistema actual.

# REGLA DE ORO
Tu meta es que el prospecto descubra por s\xED mismo que NECESITA mejorar su gesti\xF3n, y que Vetly es el camino m\xE1s sencillo.`;
        const orderedMsgs = history;
        const locationContext = history.findLast(
          (m) => m.processed_context
        )?.processed_context;
        const finalSysPrompt = (clinic.id === HQ_ID ? sysPromptHQ : locationContext ? `### INSTRUCCI\xD3N SUPREMA: EL PRECIO YA EST\xC1 CALCULADO Y LA UBICACI\xD3N YA ES CONOCIDA ###
${locationContext}
IGNORA cualquier otra regla sobre pedir ubicaci\xF3n, zona, ciudad o recargos.

${sysPrompt}` : sysPrompt) + (tutorContext || "");
        let lastOutboundIndex = -1;
        for (let i = orderedMsgs.length - 1; i >= 0; i--) {
          if (orderedMsgs[i].direction === "outbound") {
            lastOutboundIndex = i;
            break;
          }
        }
        const pastContext = lastOutboundIndex >= 0 ? orderedMsgs.slice(0, lastOutboundIndex + 1) : [];
        const burstInbound = lastOutboundIndex >= 0 ? orderedMsgs.slice(lastOutboundIndex + 1) : orderedMsgs;
        const msgs = [
          { role: "system", content: finalSysPrompt },
          ...pastContext.map((m) => {
            let content = m.content || "";
            const aiExtra = m.payload?.ai_context || "";
            if (aiExtra) {
              content = `${content}
${aiExtra}`;
            }
            return {
              role: m.direction === "inbound" ? "user" : "assistant",
              content
            };
          })
        ];
        let userContentBlocks = [];
        for (const msg of burstInbound) {
          let text2 = msg.content || "";
          if (msg.payload?.ai_context) {
            text2 = `${text2}
${msg.payload.ai_context}`;
          }
          if (msg.message_type === "image" && msg.payload?.image_base64) {
            userContentBlocks.push({ type: "text", text: text2 || "[Imagen]" });
            userContentBlocks.push({
              type: "image_url",
              image_url: { url: msg.payload.image_base64 }
            });
          } else {
            userContentBlocks.push({ type: "text", text: text2 || "" });
          }
        }
        if (userContentBlocks.length > 0) {
          msgs.push({ role: "user", content: userContentBlocks });
        }
        const targetModel2 = clinic.ai_active_model === "mini" ? "gpt-4o-mini" : "gpt-4o";
        const blockedTools = [];
        const isAnimalGraceGate = realClinicId === "ehmncwawzdciajvuallg" || clinic?.id === "4213322a-69a0-4e0b-9215-bc4033c15ef4" || (clinic?.clinic_name || "").includes("AnimalGrace");
        if (isAnimalGraceGate) {
          const burstText = msgs.map((m) => {
            const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
            return content.toLowerCase();
          }).join(" ");
          const isSurgeryIntent = ["ciru", "esteri", "castra", "pabell", "operaci"].some(
            (w) => burstText.includes(w)
          );
          if (isSurgeryIntent) {
            blockedTools.push("check_availability");
            blockedTools.push("create_appointment");
          }
        }
        let res = await callOpenAI(
          openaiApiKey,
          targetModel2,
          msgs,
          true,
          blockedTools
        );
        let assistant = res.choices[0].message;
        let funcResult = null;
        let allFuncResults = [];
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
            msgs
          );
          allFuncResults.push({
            name: assistant.function_call.name,
            result: funcResult
          });
          msgs.push(
            {
              role: "assistant",
              content: "",
              function_call: assistant.function_call
            },
            {
              role: "function",
              name: assistant.function_call.name,
              content: JSON.stringify(funcResult)
            }
          );
          res = await callOpenAI(
            openaiApiKey,
            targetModel2,
            msgs,
            true,
            blockedTools
          );
          assistant = res.choices[0].message;
          maxCalls--;
        }
        let reply = assistant.content || "Error. \xBFPuedes repetir?";
        if (realClinicId === "ehmncwawzdciajvuallg" || (clinic?.clinic_name || "").includes("AnimalGrace")) {
          const responseLower = reply.toLowerCase();
          const surgeryWords = [
            "ciru",
            "esteri",
            "castra",
            "pabell",
            "operaci"
          ];
          const hasTimeSlots = /\d{1,2}:\d{2}/.test(reply);
          if (surgeryWords.some((w) => responseLower.includes(w)) && hasTimeSlots) {
            reply = reply.replace(
              /\b\d{1,2}:\d{2}\s*(?:AM|PM|am|pm|hrs|horas)?\b/g,
              "[CONSULTAR CON CLAUDIA]"
            );
          }
        }
        await saveMsg(sb, clinic.id, from, reply, "outbound", {
          ai_generated: true,
          ai_function_called: allFuncResults.length > 0 ? allFuncResults.map((r) => r.name).join(", ") : null,
          ai_function_result: allFuncResults.length > 0 ? allFuncResults : null
        }, targetModel2);
        await sendWA(
          clinic.ycloud_api_key,
          from,
          clinic.ycloud_phone_number || to,
          reply
        );
        await debugLog(sb, `AI Response Sent`, { to: from, msgId: msgRowId });
      } catch (err) {
        console.error("Async Process Error:", err);
        await debugLog(sb, "Async Process Error (OpenAI/Otros)", {
          error: err.message,
          phone: from
        });
        const fallbackReply = "Lo siento, tuve un problema t\xE9cnico procesando tu mensaje. Por favor intenta consultarme en unos minutos.";
        await saveMsg(sb, clinic.id, from, fallbackReply, "outbound", {
          error_fallback: true
        }, targetModel);
        await sendWA(
          clinic.ycloud_api_key,
          from,
          clinic.ycloud_phone_number || to,
          fallbackReply
        ).catch((e) => console.error("Failed sending fallback WA:", e));
      }
    };
    if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
      EdgeRuntime.waitUntil(asyncProcess());
    } else {
      asyncProcess();
    }
    return new Response(JSON.stringify({ status: "processing_async" }), {
      headers: corsHeaders
    });
  } catch (e) {
    console.error(e);
    const sb2 = getSupabase();
    await debugLog(sb2, "Internal Error", { error: e.message });
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: corsHeaders
    });
  }
});
