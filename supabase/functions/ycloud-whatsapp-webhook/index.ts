import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, YCloud-Signature" };

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

interface Msg { role: "system" | "user" | "assistant" | "function"; content: string | any[]; name?: string; function_call?: { name: string; arguments: string }; }

// ====== Helper: Download Media from YCloud ======
const downloadYCloudMedia = async (link: string, ycloudKey: string): Promise<Blob> => {
    const res = await fetch(link, {
        headers: { "X-API-Key": ycloudKey }
    });
    if (!res.ok) throw new Error(`Media fetch failed: ${await res.text()}`);
    return await res.blob();
};

// ====== Helper: Transcribe Audio using OpenAI Whisper ======
const transcribeAudioData = async (audioBlob: Blob, openAiKey: string): Promise<string> => {
    const formData = new FormData();
    formData.append("file", audioBlob, "audio.ogg");
    formData.append("model", "whisper-1");
    // Ensure text output
    formData.append("response_format", "text");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${openAiKey}` },
        body: formData
    });
    if (!res.ok) throw new Error(`Transcription failed: ${await res.text()}`);
    return await res.text();
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY") || "";

// ====== Helper: Geocode Address using Google Maps ======
const geocodeAddress = async (address: string): Promise<{ lat: number, lng: number } | null> => {
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

// ====== Helper: Get Travel Duration and Distance between points ======
const getTravelDetails = async (origin: { lat: number, lng: number }, destination: { lat: number, lng: number }): Promise<{ duration: number; distance: number }> => {
    if (!GOOGLE_MAPS_API_KEY) return { duration: 0, distance: 0 };
    try {
        const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin.lat},${origin.lng}&destinations=${destination.lat},${destination.lng}&key=${GOOGLE_MAPS_API_KEY}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.status === "OK" && data.rows[0].elements[0].status === "OK") {
            return {
                duration: data.rows[0].elements[0].duration.value, // seconds
                distance: data.rows[0].elements[0].distance.value   // meters
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
        description: "Verifica disponibilidad. CRÍTICO: Debes inferir el nombre del servicio del historial de conversación (ej. 'Vacunación', 'Consulta'). Si la clínica es móvil/híbrida, solicita la DIRECCIÓN antes o durante la consulta de disponibilidad para validarla en 'address'.",
        parameters: { 
            type: "object", 
            properties: { 
                date: { type: "string", description: "Fecha YYYY-MM-DD" }, 
                service_name: { type: "string", description: "Nombre del servicio inferido del contexto" }, 
                professional_name: { type: "string", description: "Nombre del profesional solicitado (opcional)" },
                address: { type: "string", description: "Dirección completa del tutor/paciente (requerida para clínicas móviles)" }
            }, 
            required: ["date"] 
        }
    },
    {
        name: "create_appointment",
        description: "Crea nueva cita. REQUERIDO: Formato YYYY-MM-DD y hora 24h (HH:MM). Para clínicas móviles, incluye la 'address' confirmada.",
        parameters: {
            type: "object",
            properties: {
                patient_name: { type: "string" },
                date: { type: "string", description: "Fecha YYYY-MM-DD" },
                time: { type: "string", description: "Hora HH:MM (24h)" },
                service_name: { type: "string" },
                professional_name: { type: "string", description: "Nombre del profesional (opcional)" },
                address: { type: "string", description: "Dirección completa de atención (requerida para móviles)" }
            },
            required: ["patient_name", "date", "time", "service_name"]
        }
    },
    {
        name: "get_services",
        description: "Lista servicios disponibles con precios y duración",
        parameters: { type: "object", properties: {}, required: [] }
    },
    {
        name: "confirm_appointment",
        description: "Confirma o cancela cita pendiente",
        parameters: { type: "object", properties: { response: { type: "string", enum: ["yes", "no"] } }, required: ["response"] }
    },
    {
        name: "upsert_prospect",
        description: "Crea o actualiza un prospecto en el CRM cuando obtienes información del paciente como nombre, email, servicio de interés, o notas. Llámala cada vez que el paciente comparta datos personales o muestre interés en un servicio.",
        parameters: {
            type: "object",
            properties: {
                name: { type: "string", description: "Nombre completo del paciente" },
                email: { type: "string", description: "Email del paciente (opcional)" },
                service_interest: { type: "string", description: "Servicio en el que está interesado" },
                notes: { type: "string", description: "Notas relevantes de la conversación" }
            },
            required: ["name"]
        }
    },
    {
        name: "get_knowledge",
        description: "Busca información detallada en la base de conocimiento (precios, tratamientos, cuidados, valores, promociones). ÚSALO SIEMPRE ante preguntas sobre costos o temas específicos que no estén en tu configuración básica.",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "Palabras clave simplificadas para la búsqueda (ej: 'precios', 'labios', 'cuidados', 'promocion')" }
            },
            required: ["query"]
        }
    },
    {
        name: "escalate_to_human",
        description: "ÚSALA si el paciente pide hablar con una persona, si te hace una pregunta que no puedes responder con seguridad, si tiene una urgencia médica o si detectas frustración. Esta función notificará al equipo y desactivará tus respuestas automáticas para este chat.",
        parameters: { type: "object", properties: {}, required: [] }
    },
    {
        name: "reschedule_appointment",
        description: "Reagenda una cita existente del paciente a una nueva fecha y hora. Úsala cuando el paciente quiera cambiar la fecha/hora de su cita. Primero verifica disponibilidad con check_availability, luego usa esta función para mover la cita.",
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
        description: "Asigna una etiqueta al paciente para segmentación y marketing. ÚSALA PROACTIVAMENTE cuando: (1) El paciente muestra interés en un servicio específico → etiqueta 'Interés [Servicio]' (ej: 'Interés Microblading'). (2) El paciente agenda una cita → etiqueta 'Cliente [Servicio]'. (3) Detectas una condición relevante → etiqueta descriptiva (ej: 'Piel Sensible', 'Primera Vez'). (4) El paciente es recurrente → 'Cliente Frecuente'. (5) El paciente refiere a alguien → 'Referidor'. Puedes llamar esta función múltiples veces para asignar varias etiquetas. La etiqueta se crea automáticamente si no existe.",
        parameters: {
            type: "object",
            properties: {
                tag_name: { type: "string", description: "Nombre de la etiqueta. Usa formato capitalizado y descriptivo. Ej: 'Interés Microblading', 'Cliente Frecuente', 'VIP', 'Piel Sensible', 'Primera Vez'" },
                tag_color: { type: "string", description: "Color hex de la etiqueta. Usa: #10B981 (verde) para clientes activos, #3B82F6 (azul) para intereses, #F59E0B (amarillo) para alertas, #EF4444 (rojo) para condiciones médicas, #8B5CF6 (morado) para VIP/especiales, #EC4899 (rosado) para servicios estéticos. Opcional, default azul." }
            },
            required: ["tag_name"]
        }
    }
];

// =============================================
// Supabase & Helper Functions
// =============================================
const getSupabase = () => createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

// Debug Logger
const debugLog = async (sb: ReturnType<typeof createClient>, msg: string, payload: any) => {
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
    return phone.replace(/\D/g, '');
};

const getClinic = async (sb: ReturnType<typeof createClient>, phone: string) => {
    console.log(`[getClinic] Looking up clinic for phone: ${phone}`);
    const normalized = normalizePhone(phone);
    // Try matching exact, or with +, or without +
    const { data, error } = await sb.from("clinic_settings")
        .select("*")
        .or(`ycloud_phone_number.eq.${phone},ycloud_phone_number.eq.+${normalized},ycloud_phone_number.eq.${normalized}`)
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error(`[getClinic] Error looking up clinic:`, error);
        throw new Error(error.message);
    }
    if (!data) {
        console.warn(`[getClinic] No clinic found for phone: ${phone} (normalized: ${normalized})`);
    } else {
        console.log(`[getClinic] Found clinic: ${data.id} (${data.clinic_name})`);
    }
    return data;
};

const getHistory = async (sb: ReturnType<typeof createClient>, clinicId: string, phone: string) => {
    const { data } = await sb.from("messages").select("direction, content").eq("clinic_id", clinicId).eq("phone_number", phone).order("created_at", { ascending: false }).limit(15);
    return data?.reverse() || [];
};

const isValidUUID = (uuid: string) => {
    const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return regex.test(uuid);
};

const saveMsg = async (sb: ReturnType<typeof createClient>, clinicId: string, phone: string, content: string, direction: string, extra = {}) => {
    // Prevent crash if campaign_id is not a valid UUID (e.g. numeric Meta Ad ID)
    const extraCopy = { ...extra } as any;
    if (extraCopy.campaign_id && !isValidUUID(extraCopy.campaign_id)) {
        console.warn(`[saveMsg] Invalid UUID for campaign_id: ${extraCopy.campaign_id}. Setting to null.`);
        delete extraCopy.campaign_id;
    }

    const { data, error } = await sb.from("messages").insert({ clinic_id: clinicId, phone_number: phone, content, direction, ...extraCopy }).select("id").single();
    if (error) {
        console.error(`[saveMsg] Error inserting message (dir: ${direction}):`, error);
        throw new Error(`saveMsg failed: ${error.message}`);
    }
    console.log(`[saveMsg] Saved message (dir: ${direction}) id: ${data.id}`);
    return data.id;
};

// =============================================
// Tool Implementations
// =============================================
const checkAvail = async (sb: ReturnType<typeof createClient>, clinicId: string, phone: string, date: string, serviceName?: string, timezone: string = "America/Santiago", profName?: string, clinicWorkingHours?: any, address?: string) => {
    // 1. Update CRM stage to "Calificado" (Interest shown)
    await updateProspectStage(sb, clinicId, phone, "Calificado");

    // 2. If address provided, geocode and save it
    let tutorCoords: { lat: number, lng: number } | null = null;
    if (address) {
        const normalizedPhone = normalizePhone(phone);
        tutorCoords = await geocodeAddress(address);
        
        const updates: any = { address: address };
        if (tutorCoords) {
            updates.latitude = tutorCoords.lat;
            updates.longitude = tutorCoords.lng;
        }
        
        await sb.from("tutors").update(updates).eq("clinic_id", clinicId).eq("phone", normalizedPhone);
        await sb.from("crm_prospects").update(updates).eq("clinic_id", clinicId).eq("phone", normalizedPhone);
    }

    const { data: clinic } = await sb.from("clinic_settings").select("business_model, latitude, longitude").eq("id", clinicId).single();
    const isMobile = clinic?.business_model !== 'physical';
    const clinicBase = clinic?.latitude && clinic?.longitude ? { lat: Number(clinic.latitude), lng: Number(clinic.longitude) } : null;

    let duration = 60; // Default
    let serviceId: string | null = null;
    let professionalId: string | null = null;

    if (serviceName) {
        // Try to find service duration and ID
        const { data: svc } = await sb.from("clinic_services")
            .select("id, duration")
            .eq("clinic_id", clinicId)
            .ilike("name", `%${serviceName}%`)
            .limit(1)
            .maybeSingle();

        if (svc) {
            duration = svc.duration;
            serviceId = svc.id;
        }
    }

    // Try to find requested professional BY NAME/TITLE
    if (profName) {
        const { data: prof } = await sb.from("clinic_members")
            .select("id:user_id, member_id:id")
            .eq("clinic_id", clinicId)
            .or(`first_name.ilike.%${profName}%,last_name.ilike.%${profName}%,job_title.ilike.%${profName}%`)
            .limit(1)
            .maybeSingle();

        if (prof) {
            professionalId = prof.member_id;
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

    console.log(`[checkAvail] Service: '${serviceName}' (ID: ${serviceId}), Duration: ${duration}min, Professional: ${professionalId || 'Global'}`);

    let slots: { slot_time: string, is_available: boolean }[] = [];

    // Strategy: Try professional-specific slots first if we have a professional
    if (professionalId) {
        try {
            const { data, error } = await sb.rpc("get_professional_available_slots", {
                p_clinic_id: clinicId,
                p_member_id: professionalId,
                p_duration: duration,
                p_interval: duration, // Step by duration (no flexible intervals)
                p_timezone: timezone
            });

            if (!error && data) {
                slots = data;
            } else {
                console.warn("[checkAvail] Professional slot check failed/empty, falling back to global:", error);
            }
        } catch (e) {
            console.error("[checkAvail] RPC error:", e);
        }
    }

    if (slots.length === 0) {
        // We use 30 as interval. If the RPC doesn't support it, we'll get a DB error.
        // But we are updating it in the migration.
        const { data, error } = await sb.rpc("get_available_slots", {
            p_clinic_id: clinicId,
            p_date: date,
            p_duration: duration,
            p_interval: duration // Step by duration (no flexible intervals)
        });
        if (error) {
            console.error("[checkAvail] get_available_slots failed, trying without interval param:", error);
            const { data: data2, error: error2 } = await sb.rpc("get_available_slots", {
                p_clinic_id: clinicId,
                p_date: date,
                p_duration: duration
            });
            if (error2) return { available: false, error: error2.message };
            slots = data2 || [];
        } else {
            slots = data || [];
        }
    }

    // 6. IF MOBILE CLINIC: Filter slots based on Travel Time (Travel Block)
    let filteredSlots = slots.filter((s: { is_available: boolean }) => s.is_available);
    let recommendedSlot = "";

    if (isMobile && tutorCoords) {
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
            const prevAppt = dayAppts?.filter(a => new Date(a.appointment_date) < slotStart).slice(-1)[0];
            const nextAppt = dayAppts?.filter(a => new Date(a.appointment_date) >= slotEnd)[0];

            // 2. Determine Origins and Destinations
            const originLocation = prevAppt ? { lat: Number(prevAppt.latitude), lng: Number(prevAppt.longitude) } : clinicBase;
            const destinationLocation = nextAppt ? { lat: Number(nextAppt.latitude), lng: Number(nextAppt.longitude) } : clinicBase;

            let isPossible = true;

            // 3. Check Travel from Origin (Prev Appt or Clinic Base)
            if (originLocation) {
                let travelTimeMinutes = 30; // Default fallback
                try {
                    const travelDetails = await getTravelDetails(originLocation, tutorCoords);
                    travelTimeMinutes = Math.ceil(travelDetails.duration / 60);
                } catch (err) {
                    console.error("[checkAvail] Google Maps API failed, using fallback:", err);
                }
                const travelTime = travelTimeMinutes * 60;
                
                const availableGapSecs = prevAppt 
                    ? (slotStart.getTime() - (new Date(prevAppt.appointment_date).getTime() + (prevAppt.duration * 60000))) / 1000
                    : (slotStart.getTime() - new Date(`${date}T08:00:00`).getTime()) / 1000; // Assume 8 AM start if no prev

                if (availableGapSecs < (travelTime + (TRAVEL_BUFFER_MINUTES * 60))) {
                    isPossible = false;
                }
            }

            // 4. Check Travel to Next (Next Appt or Clinic Base)
            if (isPossible && destinationLocation) {
                const { duration: travelTime } = await getTravelDetails(tutorCoords, destinationLocation);
                const availableGapSecs = nextAppt
                    ? (new Date(nextAppt.appointment_date).getTime() - slotEnd.getTime()) / 1000
                    : (new Date(`${date}T20:00:00`).getTime() - slotEnd.getTime()) / 1000; // Assume 8 PM end if no next

                if (availableGapSecs < (travelTime + (TRAVEL_BUFFER_MINUTES * 60))) {
                    isPossible = false;
                }
            }

            if (isPossible) {
                finalValidSlots.push(slot);
                // Heuristic for recommendation (closer = better)
                if (prevAppt || nextAppt) {
                    recommendedSlot = `(Optimizado para su zona)`;
                }
            }
        }
        filteredSlots = finalValidSlots;
    }

    const dow = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][new Date(date + 'T12:00:00').getDay()];
    const dayConfig = clinicWorkingHours?.[dow];
    const lunch = dayConfig?.lunch_break;

    const availableSlots = filteredSlots
        .filter(s => {
            if (!lunch || !lunch.enabled) return true;

            // Compare times as HH:MM
            const tStart = s.slot_time.substring(0, 5);

            // Calculate end time
            const [h, m] = tStart.split(':').map(Number);
            const endDate = new Date(2000, 0, 1, h, m + duration);
            const tEnd = endDate.toTimeString().substring(0, 5);

            const lStart = lunch.start;
            const lEnd = lunch.end;

            // Overlap logic: T_Start < L_End AND T_End > L_Start
            const isOverlapping = (tStart < lEnd && tEnd > lStart);
            return !isOverlapping;
        })
        .map((s: { slot_time: string }) => {
            const t = s.slot_time.substring(0, 5);
            const h = parseInt(t.split(":")[0]);
            return `${h > 12 ? h - 12 : h}:${t.split(":")[1]} ${h >= 12 ? "PM" : "AM"}`;
        });

    const displaySlots = availableSlots.slice(0, 8);
    const routingMsg = recommendedSlot ? `📍 Contamos con disponibilidad ese día en su zona. ` : "";

    return availableSlots.length
        ? { available: true, slots: displaySlots, duration_used: duration, message: `${routingMsg}Disponibilidad el ${date}: ${displaySlots.join(", ")}` }
        : { available: false, message: `No hay disponibilidad para ${date}` };
};

// Helper to get timezone offset (e.g. "-03:00")
const getOffset = (timeZone: string = "America/Santiago", date: Date) => {
    try {
        const str = date.toLocaleString('en-US', { timeZone, timeZoneName: 'longOffset' });
        const match = str.match(/GMT([+-]\d{2}:\d{2})/);
        return match ? match[1] : "-03:00";
    } catch (e) { console.error("getOffset error", e); return "-03:00"; }
};

const createAppt = async (sb: ReturnType<typeof createClient>, clinicId: string, phone: string, args: { patient_name: string; date: string; time: string; service_name: string; address?: string }, timezone: string = "America/Santiago") => {
    const normalizedPhone = normalizePhone(phone);
    
    // Save address if provided in creation
    if (args.address) {
        await sb.from("tutors").update({ address: args.address }).eq("clinic_id", clinicId).eq("phone", normalizedPhone);
        await sb.from("crm_prospects").update({ address: args.address }).eq("clinic_id", clinicId).eq("phone", normalizedPhone);
    }
    let duration = 60;
    let price = 0;
    let professionalId: string | null = null;
    let serviceId: string | null = null;

    if (args.service_name) {
        const { data: svc } = await sb.from("clinic_services")
            .select("id, name, duration, price")
            .eq("clinic_id", clinicId)
            .ilike("name", `%${args.service_name}%`)
            .limit(1)
            .maybeSingle();

        if (svc) {
            duration = svc.duration;
            serviceId = svc.id;
            price = svc.price || 0;
            args.service_name = svc.name; // Keep exact DB string so select UI binds correctly
        }
    }

    // Try to find requested professional BY NAME/TITLE
    // @ts-ignore
    const profName = args.professional_name;
    if (profName) {
        const { data: prof } = await sb.from("clinic_members")
            .select("id:user_id, member_id:id")
            .eq("clinic_id", clinicId)
            .or(`first_name.ilike.%${profName}%,last_name.ilike.%${profName}%,job_title.ilike.%${profName}%`)
            .limit(1)
            .maybeSingle();

        if (prof) {
            professionalId = prof.member_id;
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
    const timeMatch = typeof cleanTime === "string" ? cleanTime.match(/\d{1,2}:\d{2}/) : null;
    if (timeMatch) {
        cleanTime = timeMatch[0];
        if (cleanTime.length === 4) cleanTime = "0" + cleanTime; // pad "9:00" to "09:00"
    }

    // Quick handle for "12 PM" -> "12:00"
    // Though we told the AI strictly 24h format!
    // We will trust it to send correct format but fallback just in case
    const timeRegex = /^\d{2}:\d{2}$/;

    if (!args.date || !args.time || !dateRegex.test(args.date) || !timeRegex.test(cleanTime)) {
        console.error(`[createAppt] Invalid date/time format: ${args.date} ${args.time} (clean: ${cleanTime})`);
        await debugLog(sb, "Invalid date/time format", { args, clinicId });
        return { success: false, message: "Error: No tengo el horario completo. Por favor pídeme 'Agendar cita el [FECHA] a las [HORA]'." };
    }

    args.time = cleanTime; // Ensure args has the clean time

    // Fix Timezone: Construct ISO string with offset

    const offset = getOffset(timezone, new Date(`${args.date}T12:00:00`));
    const appointmentDateWithOffset = `${args.date}T${args.time}:00${offset}`;

    console.log(`[createAppt] Attempting insert: ${appointmentDateWithOffset} for ${args.patient_name}`);

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
        console.log(`[createAppt] Duplicate detected for ${normalizedPhone} at ${appointmentDateWithOffset}`);
        if (existingAppt.status === 'confirmed') {
            return { success: true, message: "Ya tienes esta cita confirmada en nuestra agenda. ¡Te esperamos!" };
        }
        return { success: true, message: "Ya registré esta solicitud y está pendiente de pago. Por favor envía el comprobante para confirmarla." };
    }

    // Proactive availability check: Ensure the slot is actually free before inserting
    const { available } = await checkAvail(sb, clinicId, normalizedPhone, args.date, args.service_name, timezone, profName);
    if (!available) {
        console.warn(`[createAppt] Slot no longer available: ${appointmentDateWithOffset}`);
        return { success: false, message: "Lo siento, ese horario se acaba de ocupar. Por favor consulta la disponibilidad nuevamente para elegir otro momento." };
    }

    // Get coordinates from tutor/CRM if they exist
    const { data: tutorGeo } = await sb.from("crm_prospects")
        .select("latitude, longitude")
        .eq("clinic_id", clinicId)
        .eq("phone", normalizedPhone)
        .limit(1)
        .maybeSingle();

    const { data, error } = await sb.from("appointments").insert({
        clinic_id: clinicId,
        patient_name: args.patient_name,
        phone_number: normalizedPhone,
        service: args.service_name,
        appointment_date: appointmentDateWithOffset,
        status: "pending",
        duration: duration,
        price: price,
        professional_id: professionalId,
        latitude: tutorGeo?.latitude || null,
        longitude: tutorGeo?.longitude || null
    }).select().single();

    if (error) {
        console.error("[createAppt] DB Error:", error);
        let errorMsg = "Error DB-AG-01: No pudimos registrar tu cita en el sistema. Por favor intenta con otro nombre completo o contacta soporte.";
        if (error.code === '23505') {
            errorMsg = "Error DB-CONFLICT: Ya existe una cita con este teléfono y un nombre similar. Por favor intenta usando tu nombre completo real o contacta soporte.";
        }
        await debugLog(sb, "DB Create Appt Error", { error, args, clinicId });
        return { success: false, message: errorMsg };
    }

    // Update CRM stage to "Cita Agendada" AND update name if needed
    await updateProspectStage(sb, clinicId, normalizedPhone, "Cita Agendada", args.patient_name);

    const d = new Date(`${args.date}T${args.time}:00`);
    const h = parseInt(args.time.split(":")[0]);

    // Ensure we have a valid data.id
    if (!data) {
        console.error("[createAppt] Success reported but no data returned from insert");
        return { success: false, message: "Error técnico: Cita no guardada correctamente." };
    }

    return {
        success: true,
        appointment_id: data.id,
        message: `¡Cita agendada!\n\n📅 ${d.toLocaleDateString("es-MX", { weekday: "long", month: "long", day: "numeric" })}\n🕐 ${h > 12 ? h - 12 : h}:${args.time.split(":")[1]} ${h >= 12 ? "PM" : "AM"}\n💆 ${args.service_name}${professionalId ? ' (Profesional Asignado)' : ''}`
    };
};

const getServices = async (sb: ReturnType<typeof createClient>, clinicId: string) => {
    const { data: svcRows } = await sb.from("clinic_services").select("name, duration, price").eq("clinic_id", clinicId);
    if (svcRows && svcRows.length > 0) {
        const msg = `Servicios:\n\n${svcRows.map((s: { name: string; duration: number; price: number }) => `• ${s.name} (${s.duration}min) - $${s.price}`).join("\n")}`;
        return { services: svcRows, message: msg };
    }
    const { data } = await sb.from("clinic_settings").select("services").eq("id", clinicId).single();
    const svcs = data?.services || [];
    if (!svcs.length) return { message: "No hay servicios disponibles." };
    return { services: svcs, message: `Servicios:\n\n${svcs.map((s: { name: string; duration: number; price: number }) => `• ${s.name} (${s.duration}min) - $${s.price}`).join("\n")}` };
};

const confirmAppt = async (sb: ReturnType<typeof createClient>, clinicId: string, phone: string, response: string) => {
    const normalizedPhone = normalizePhone(phone);
    const { data: appt } = await sb.from("appointments").select("*").eq("clinic_id", clinicId).eq("phone_number", normalizedPhone).eq("status", "pending").gte("appointment_date", new Date().toISOString()).order("appointment_date", { ascending: true }).limit(1).single();
    if (!appt) return { message: "No hay citas pendientes." };
    const status = response === "yes" ? "confirmed" : "cancelled";
    await sb.from("appointments").update({ status, confirmation_received: true, confirmation_response: response }).eq("id", appt.id);
    return status === "confirmed" ? { message: "¡Cita confirmada! 😊" } : { message: "Cita cancelada. ¿Reagendar?" };
};

const upsertProspect = async (sb: ReturnType<typeof createClient>, clinicId: string, phone: string, args: { name?: string; email?: string; service_interest?: string; notes?: string }) => {
    const normalizedPhone = normalizePhone(phone);
    try {
        // Stage movement is now primarily handled by check_availability or explicit intent

        const { data: defaultStage } = await sb.from("crm_pipeline_stages")
            .select("id").eq("clinic_id", clinicId).eq("is_default", true).limit(1).single();

        let stageId = defaultStage?.id;
        if (!stageId) {
            const { data: firstStage } = await sb.from("crm_pipeline_stages")
                .select("id").eq("clinic_id", clinicId).order("position", { ascending: true }).limit(1).single();
            stageId = firstStage?.id;
        }

        const { data: existing } = await sb.from("crm_prospects")
            .select("id, name, email, service_interest, notes")
            .eq("clinic_id", clinicId).eq("phone", normalizedPhone).limit(1).single();

        if (existing) {
            const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
            if (args.name && args.name !== existing.name) updates.name = args.name;
            if (args.email && args.email !== existing.email) updates.email = args.email;
            
            if (args.service_interest) {
                const currentInterests = existing.service_interest ? existing.service_interest.split(',').map((s: string) => s.trim()) : [];
                if (!currentInterests.includes(args.service_interest.trim())) {
                    updates.service_interest = existing.service_interest ? `${existing.service_interest}, ${args.service_interest.trim()}` : args.service_interest.trim();
                }
            }
            
            if (args.notes) updates.notes = existing.notes ? `${existing.notes}\n${args.notes}` : args.notes;

            await sb.from("crm_prospects").update(updates).eq("id", existing.id);
            return { success: true, action: "updated", prospect_id: existing.id, message: "Prospecto actualizado en CRM." };
        } else {
            const { data: newProspect, error } = await sb.from("crm_prospects").insert({
                clinic_id: clinicId,
                stage_id: stageId,
                name: args.name || "Sin nombre",
                phone: normalizedPhone,
                email: args.email || null,
                service_interest: args.service_interest || null,
                notes: args.notes || null,
                source: "whatsapp",
                score: 0
            }).select("id").single();

            if (error) return { success: false, message: "Error al crear prospecto." };
            return { success: true, action: "created", prospect_id: newProspect?.id, message: "Nuevo prospecto creado en CRM." };
        }
    } catch (e) {
        console.error("upsertProspect error:", e);
        return { success: false, message: "Error en CRM." };
    }
};

const getKnowledge = async (sb: ReturnType<typeof createClient>, clinicId: string, query: string) => {
    try {
        const genericWords = ["valor", "precio", "costo", "cuanto", "vale", "informacion", "clinica", "servicio", "tratamiento", "precios", "valores", "costos", "procedimiento", "sesion"];

        // Clean and split query into keywords
        const allKeywords = query.toLowerCase()
            .replace(/[¿?¡!.,]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 2); // Keywords of 3+ chars

        // Filter out generic words to find specific subjects (e.g., "labios")
        const specificKeywords = allKeywords.filter(w => !genericWords.map(g => g.normalize("NFD").replace(/[\u0300-\u036f]/g, "")).includes(w.normalize("NFD").replace(/[\u0300-\u036f]/g, "")));

        // If we have specific keywords, use them. Otherwise, use all keywords.
        const searchKeywords = specificKeywords.length > 0 ? specificKeywords : allKeywords;

        let queryBuilder = sb.from("knowledge_base")
            .select("title, content, category")
            .eq("clinic_id", clinicId)
            .eq("status", "active");

        if (searchKeywords.length > 0) {
            // Search ANY of the words in title, content or category
            const orFilters = searchKeywords.flatMap(kw => [
                `title.ilike.%${kw}%`,
                `content.ilike.%${kw}%`,
                `category.ilike.%${kw}%`
            ]).join(',');

            queryBuilder = queryBuilder.or(orFilters);
        } else {
            // Literal fallback
            queryBuilder = queryBuilder.or(`title.ilike.%${query}%,content.ilike.%${query}%,category.ilike.%${query}%`);
        }

        const { data: docs } = await queryBuilder.limit(10); // Get more to rank them

        if (!docs || docs.length === 0) {
            return { found: false, message: "No encontré información específica sobre eso en nuestra base de conocimiento. Intenta buscando un término más general (ej: 'precios' en lugar de 'valor de labios')." };
        }

        // Rank results by relevance
        const rankedDocs = docs.map(d => {
            let score = 0;
            const docText = `${d.title} ${d.content} ${d.category}`.toLowerCase();
            allKeywords.forEach(kw => {
                if (d.title.toLowerCase().includes(kw)) score += 10;
                if (d.category?.toLowerCase().includes(kw)) score += 5;
                if (d.content.toLowerCase().includes(kw)) score += 1;
            });
            return { ...d, score };
        }).sort((a, b) => b.score - a.score).slice(0, 5); // Take top 5

        const results = rankedDocs.map((d: { title: string; content: string; category: string }) =>
            `📄 ${d.title} (${d.category}):\n${d.content}`
        ).join("\n\n---\n\n");

        return { found: true, documents: rankedDocs.length, message: results };
    } catch (e) {
        console.error("getKnowledge error:", e);
        return { success: false, message: "Error al buscar en base de conocimiento." };
    }
};

const escalateToHuman = async (sb: ReturnType<typeof createClient>, clinicId: string, phone: string) => {
    const normalizedPhone = normalizePhone(phone);
    console.log(`[ESCALATE] Identifying need for human support for ${normalizedPhone}`);
    await debugLog(sb, `Iniciando derivación a humano`, { clinicId, phone: normalizedPhone });

    try {
        // Find existing prospect
        const { data: existing, error: findError } = await sb.from("crm_prospects")
            .select("id")
            .eq("clinic_id", clinicId)
            .or(`phone.eq.${normalizedPhone},phone.eq.+${normalizedPhone}`)
            .limit(1)
            .maybeSingle();

        if (findError) {
            console.error("[ESCALATE] Error finding prospect:", findError);
            await debugLog(sb, "Error buscando prospecto en derivación", { error: findError });
        }

        if (existing) {
            const { error: updError } = await sb.from("crm_prospects").update({ requires_human: true }).eq("id", existing.id);
            if (updError) {
                console.error("[ESCALATE] Error updating prospect:", updError);
                await debugLog(sb, "Error actualizando prospecto a handoff", { error: updError });
            }
        } else {
            console.log(`[ESCALATE] Prospect not found for ${normalizedPhone}, creating one...`);
            await autoUpsertMinimalProspect(sb, clinicId, normalizedPhone);
            await sb.from("crm_prospects").update({ requires_human: true }).eq("clinic_id", clinicId).eq("phone", normalizedPhone);
        }

        // Send a notification!
        const { error: notifError } = await sb.from("notifications").insert({
            clinic_id: clinicId,
            type: "human_handoff",
            title: "Atención Requerida 🚨",
            message: `El paciente ${normalizedPhone} solicitó atención humana o la IA requiere apoyo.`,
            link: `/app/messages?phone=${normalizedPhone}`
        });

        if (notifError) {
            console.error("[ESCALATE] Error inserting notification:", notifError);
            await debugLog(sb, "Error insertando notificación de handoff", { error: notifError });
            return { success: false, message: "No pude notificar al equipo, pero he guardado tu solicitud." };
        }

        await debugLog(sb, "Derivación a humano exitosa", { phone: normalizedPhone });
        console.log(`[ESCALATE] Escalated to human for ${phone} in clinic ${clinicId}`);
        return { success: true, message: "El chat ha sido derivado a un agente humano. Despídete cordialmente avisando que un humano se contactará pronto." };
    } catch (e) {
        console.error("escalateToHuman error:", e);
        await debugLog(sb, "Excepción en escalateToHuman", { error: (e as Error).message });
        return { success: false, message: "Error al derivar." };
    }
};

// =============================================
// Tag Patient - Automatic Segmentation
// =============================================
const tagPatient = async (sb: ReturnType<typeof createClient>, clinicId: string, phone: string, args: { tag_name: string; tag_color?: string }) => {
    try {
        let tagName = args.tag_name.trim();
        if (!tagName) return { success: false, message: "Nombre de etiqueta vacío." };

        // Normalization Layer: Consolidate common interest variants
        const lowerName = tagName.toLowerCase();
        if (lowerName.includes("microblading") && (lowerName.includes("ceja") || lowerName.includes("interés"))) {
            tagName = "Interés Microblading";
        } else if (lowerName.includes("perfilado") && (lowerName.includes("ceja") || lowerName.includes("interés"))) {
            tagName = "Interés Perfilado";
        } else if (lowerName.includes("labio") && (lowerName.includes("interés") || lowerName.includes("micropigmentación"))) {
            tagName = "Interés Labios";
        } else if (lowerName.includes("pestaña") || lowerName.includes("lifting") || lowerName.includes("lash")) {
            tagName = "Interés Pestañas";
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
            // REDIRECTION: If not a patient, tag in CRM to avoid "Ghost Patients"
            console.log(`[tagPatient] Patient not found for ${phone}, redirecting to CRM tagging...`);
            
            // 1. Ensure prospect exists and get ID
            const prospectId = await autoUpsertMinimalProspect(sb, clinicId, phone);
            if (!prospectId) return { success: false, message: "No se pudo identificar al paciente ni al prospecto." };

            // 2. Manage CRM Tag
            const { data: crmTag } = await sb.from("crm_tags")
                .select("id")
                .eq("clinic_id", clinicId)
                .ilike("name", tagName)
                .limit(1)
                .maybeSingle();
            
            let crmTagId = crmTag?.id;

            if (!crmTagId) {
                // Determine color based on common tag names
                let color = "#3B82F6"; // Default blue
                const lowerName = tagName.toLowerCase();
                if (lowerName.includes("piel") || lowerName.includes("médica") || lowerName.includes("embarazada")) color = "#EF4444";
                if (lowerName.includes("vez") || lowerName.includes("frecuente")) color = "#10B981";
                if (lowerName.includes("precio")) color = "#F59E0B";

                const { data: newCrmTag, error: createError } = await sb.from("crm_tags")
                    .insert({ clinic_id: clinicId, name: tagName, color })
                    .select("id")
                    .single();
                
                if (createError) {
                    // Possible race condition
                    const { data: retryTag } = await sb.from("crm_tags")
                        .select("id")
                        .eq("clinic_id", clinicId)
                        .ilike("name", tagName)
                        .limit(1)
                        .maybeSingle();
                    crmTagId = retryTag?.id;
                } else {
                    crmTagId = newCrmTag?.id;
                }
            }

            if (!crmTagId) return { success: false, message: "No se pudo gestionar la etiqueta de CRM." };

            // 3. Link tag in CRM
            const { data: existingCrmLink } = await sb.from("crm_prospect_tags")
                .select("*")
                .eq("prospect_id", prospectId)
                .eq("tag_id", crmTagId)
                .limit(1)
                .maybeSingle();
            
            if (!existingCrmLink) {
                await sb.from("crm_prospect_tags").insert({ prospect_id: prospectId, tag_id: crmTagId });
            }

            return { success: true, message: "Etiqueta asignada al prospecto en CRM." };
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

        console.log(`[tagPatient] Tagged ${phone} with "${tagName}" (tag: ${tagId}, patient: ${patientId})`);
        return { success: true, tag_name: tagName, message: `Etiqueta "${tagName}" asignada al paciente. (Esto es interno, NO lo menciones al paciente.)` };
    } catch (e) {
        console.error("[tagPatient] Error:", e);
        return { success: false, message: "Error al etiquetar paciente." };
    }
};

const rescheduleAppt = async (sb: ReturnType<typeof createClient>, clinicId: string, phone: string, args: { new_date: string; new_time: string }, timezone: string) => {
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
            return { success: false, message: "No encontré una cita próxima para reagendar. ¿Podrías darme más detalles?" };
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
            .gte("appointment_date", new Date(newStart.getTime() - duration * 60000).toISOString());

        if (conflicts && conflicts.length > 0) {
            return { success: false, message: "Ese horario ya está ocupado. ¿Podrías elegir otra hora?" };
        }

        // 3. Update the appointment
        const { error: updateError } = await sb.from("appointments").update({
            appointment_date: newDateWithOffset,
            status: "pending", // Reset to pending after reschedule
            reminder_sent: false, // Reset reminder flags
            reminder_sent_at: null,
            confirmation_received: false,
            confirmation_response: null,
            updated_at: new Date().toISOString()
        }).eq("id", appt.id);

        if (updateError) {
            console.error("[rescheduleAppt] Error:", updateError);
            return { success: false, message: "Error al reagendar. Intenta de nuevo." };
        }

        const d = new Date(`${args.new_date}T${args.new_time}:00`);
        const h = parseInt(args.new_time.split(":")[0]);
        return {
            success: true,
            appointment_id: appt.id,
            message: `¡Cita reagendada exitosamente!\n\n📅 ${d.toLocaleDateString("es-MX", { weekday: "long", month: "long", day: "numeric" })}\n🕐 ${h > 12 ? h - 12 : h}:${args.new_time.split(":")[1]} ${h >= 12 ? "PM" : "AM"}\n💆 ${appt.service || 'consulta'}`
        };
    } catch (e) {
        console.error("rescheduleAppt error:", e);
        return { success: false, message: "Error al reagendar la cita." };
    }
};

const getStageId = async (sb: ReturnType<typeof createClient>, clinicId: string, stageName: string) => {
    const { data } = await sb.from("crm_pipeline_stages")
        .select("id")
        .eq("clinic_id", clinicId)
        .ilike("name", stageName) // Case insensitive
        .limit(1)
        .maybeSingle();
    return data?.id;
};

const updateProspectStage = async (sb: ReturnType<typeof createClient>, clinicId: string, phone: string, targetStageName: string, name?: string) => {
    const normalizedPhone = normalizePhone(phone);
    // 1. Get target stage ID
    const targetId = await getStageId(sb, clinicId, targetStageName);
    if (!targetId) return;

    // 2. Get current prospect and their stage
    // Use OR to be resilient to non-normalized old data
    const { data: prospect } = await sb.from("crm_prospects")
        .select("id, name, stage_id, crm_pipeline_stages(name, position)") // Join to get stage info
        .eq("clinic_id", clinicId)
        .or(`phone.eq.${normalizedPhone},phone.eq.+${normalizedPhone}`)
        .limit(1)
        .maybeSingle();

    if (!prospect) return; // Prospect should exist by now

    const currentStageName = prospect.crm_pipeline_stages?.name;

    // 3. Logic: Only move "forward" or setup initial
    // Hierarchy: Nuevo Prospecto (low) -> Calificado (med) -> Cita Agendada (high)
    // We don't want to move BACK from Cita Agendada to Calificado just because they asked a question.

    let shouldUpdateStage = false;

    if (!prospect.stage_id) shouldUpdateStage = true;
    else if (targetStageName.toLowerCase() === "nuevo prospecto") shouldUpdateStage = false; // Never overwrite with "New" if exists
    else if (targetStageName.toLowerCase() === "cita agendada") shouldUpdateStage = true; // Always update to Scheduled (highest priority here)
    else if (targetStageName.toLowerCase() === "calificado") {
        // Only update to Calificado if current is NOT "Cita Agendada" or "Cerrado"
        const forbidden = ["cita agendada", "cerrado"];
        if (!forbidden.includes(currentStageName?.toLowerCase() || "")) shouldUpdateStage = true;
    }

    const updates: Record<string, any> = {};
    if (shouldUpdateStage) updates.stage_id = targetId;
    
    // Update name if provided and existing is generic or looks like a nickname/emoji
    if (name && name.trim().length > 0) {
        const currentName = (prospect.name || "").toLowerCase();
        const isGeneric = !prospect.name || currentName.includes("sin nombre");
        // Also allow overwrite if current name is very short (likely nickname) or contains many emojis/special chars
        // Or simply if the new name is substantially different and non-empty.
        // User captured name from AI is almost always better.
        if (isGeneric || currentName !== name.toLowerCase()) {
            updates.name = name;
        }
    }

    if (Object.keys(updates).length > 0) {
        await sb.from("crm_prospects").update(updates).eq("id", prospect.id);
        if (updates.stage_id) console.log(`[CRM] Moved ${phone} to '${targetStageName}'`);
        if (updates.name) console.log(`[CRM] Updated name for ${phone} to '${name}'`);
    }
};

const autoUpsertMinimalProspect = async (sb: ReturnType<typeof createClient>, clinicId: string, phone: string, name?: string) => {
    const normalizedPhone = normalizePhone(phone);
    try {
        const { data: existing } = await sb.from("crm_prospects")
            .select("id, name")
            .eq("clinic_id", clinicId)
            .or(`phone.eq.${normalizedPhone},phone.eq.+${normalizedPhone}`)
            .limit(1)
            .maybeSingle();

        if (existing) {
            // Update name if Provided name is better than existing (generic or nickname)
            if (name && name.trim().length > 0) {
                const currentName = (existing.name || "").toLowerCase();
                const isGeneric = !existing.name || currentName.includes("sin nombre");
                // Allow update if generic or if names differ (implies new capture)
                if (isGeneric || currentName !== name.toLowerCase()) {
                    await sb.from("crm_prospects").update({ name }).eq("id", existing.id);
                }
            }
            return existing.id;
        }
        console.log(`[CRM] No prospect found for ${normalizedPhone}, creating...`);

        // Try to find "Nuevo Prospecto" specifically, or fallback to default
        let stageId = await getStageId(sb, clinicId, "Nuevo Prospecto");

        if (!stageId) {
            const { data: defaultStage } = await sb.from("crm_pipeline_stages")
                .select("id").eq("clinic_id", clinicId).eq("is_default", true).limit(1).maybeSingle();
            stageId = defaultStage?.id;
        }

        // Fallback to first
        if (!stageId) {
            const { data: firstStage } = await sb.from("crm_pipeline_stages")
                .select("id").eq("clinic_id", clinicId).order("position", { ascending: true }).limit(1).maybeSingle();
            stageId = firstStage?.id;
        }

        if (!stageId) return null;

        const { data: newProspect, error: insertError } = await sb.from("crm_prospects").insert({
            clinic_id: clinicId,
            stage_id: stageId,
            name: name || "Sin nombre (Auto)",
            phone: normalizedPhone,
            source: "whatsapp",
            score: 0
        }).select("id").single();

        if (insertError) {
             console.error("autoUpsertMinimalProspect insert error:", insertError);
             return null;
        }

        console.log(`Auto-created prospect for phone: ${normalizedPhone} (Name: ${name || 'Auto'})`);
        return newProspect?.id;
    } catch (e) {
        console.error("autoUpsertMinimalProspect error:", e);
        return null;
    }
};

const getKnowledgeSummary = async (sb: ReturnType<typeof createClient>, clinicId: string) => {
    try {
        const { data: docs } = await sb.from("knowledge_base")
            .select("title, content, category")
            .eq("clinic_id", clinicId)
            .eq("status", "active")
            .limit(10);

        if (!docs || docs.length === 0) return "";

        return "\n\nBase de Conocimiento de la Clínica:\n" +
            docs.map((d: { title: string; content: string; category: string }) =>
                `- ${d.title} (${d.category}): ${d.content.substring(0, 4000)}`
            ).join("\n");
    } catch {
        return "";
    }
};

const processFunc = async (sb: ReturnType<typeof createClient>, clinicId: string, phone: string, name: string, args: Record<string, unknown>, timezone: string, clinic?: any) => {
    console.log(`[processFunc] Calling: ${name}`, args);
    await debugLog(sb, `Tool execution: ${name}`, { args, phone });
    switch (name) {
        case "check_availability": return checkAvail(sb, clinicId, phone, args.date as string, args.service_name as string, timezone, args.professional_name as string, clinic?.working_hours, args.address as string);
        case "create_appointment": return createAppt(sb, clinicId, phone, args as any, timezone);
        case "get_services": return getServices(sb, clinicId);
        case "confirm_appointment":
        case "cancel_appointment": return confirmAppt(sb, clinicId, phone, name === "cancel_appointment" ? "no" : args.response as string);
        case "upsert_prospect": return upsertProspect(sb, clinicId, phone, args as { name?: string; email?: string; service_interest?: string; notes?: string });
        case "get_knowledge": return getKnowledge(sb, clinicId, args.query as string);
        case "escalate_to_human": return escalateToHuman(sb, clinicId, phone);
        case "reschedule_appointment": return rescheduleAppt(sb, clinicId, phone, args as { new_date: string; new_time: string }, timezone);
        case "tag_patient": return tagPatient(sb, clinicId, phone, args as { tag_name: string; tag_color?: string });
        default: return { error: `Unknown: ${name}` };
    }
};

const callOpenAI = async (key: string, model: string, msgs: Msg[], useFns = true) => {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
            model: model || "gpt-4o-mini",
            messages: msgs,
            functions: useFns ? functions : undefined,
            function_call: useFns ? "auto" : undefined,
            temperature: 0.7,
            max_tokens: 500
        })
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
        body: JSON.stringify({ from: cleanFrom, to: cleanTo, type: "text", text: { body: msg } })
    });
    if (!r.ok) {
        const errText = await r.text();
        console.error(`[sendWA] Error sending to ${cleanTo} from ${cleanFrom}:`, errText);
        throw new Error(errText);
    }
    return r.json();
};

// =============================================
// Main Webhook Handler
// =============================================
Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

    const sb = getSupabase();

    if (req.method === "GET") {
        const { data } = await sb.from("debug_logs").select("*").order("created_at", { ascending: false }).limit(100);
        return new Response(JSON.stringify(data), { headers: corsHeaders });
    }

    try {
        let p: YCloudPayload;
        try {
            p = await req.json();
        } catch (e) {
            console.warn("Received empty or non-JSON body, ignoring.");
            return new Response(JSON.stringify({ status: "ok", message: "Empty body ignored" }), { headers: corsHeaders });
        }

        // Log incoming payload
        await debugLog(sb, `Incoming webhook: ${p.type}`, p);

        // Check event type
        if (p.type !== "whatsapp.inbound_message.received") {
            // Optional: log reason?
            // await debugLog(sb, `Ignored: Wrong type`, { type: p.type });
            return new Response(JSON.stringify({ status: "ignored" }), { headers: corsHeaders });
        }

        const msgObj = p.whatsappInboundMessage;

        if (!msgObj) {
            return new Response(JSON.stringify({ status: "ignored" }), { headers: corsHeaders });
        }

        const validTypes = ["text", "audio", "image", "interactive"];
        if (!validTypes.includes(msgObj.type)) {
            await debugLog(sb, `Ignored: Unsupported message type`, { msgType: msgObj?.type });
            return new Response(JSON.stringify({ status: "ignored" }), { headers: corsHeaders });
        }

        const to = msgObj.to;
        const from = normalizePhone(msgObj.from); // Normalize user phone immediately
        const msgId = msgObj.id;

        // Deduplication
        const { data: exists } = await sb.from("messages").select("id").eq("ycloud_message_id", msgId).limit(1).maybeSingle();
        if (exists) {
            await debugLog(sb, `Ignored: Duplicate message`, { msgId });
            return new Response(JSON.stringify({ status: "ignored_duplicate" }), { headers: corsHeaders });
        }

        const clinic = await getClinic(sb, to);

        if (!clinic) {
            await debugLog(sb, "Clinic not found", { phone: to });
            return new Response(JSON.stringify({ status: "ignored", reason: "clinic_not_found" }), { headers: corsHeaders });
        }

        if (clinic.ai_auto_respond === false) {
            await debugLog(sb, "AI Disabled - Ignored message", { phone: to });
            return new Response(JSON.stringify({ status: "ignored", reason: "ai_disabled" }), { headers: corsHeaders });
        }

        if (!clinic.ycloud_api_key) {
            await debugLog(sb, "Missing YCloud API key", { clinic_id: clinic.id });
            return new Response(JSON.stringify({ error: "Missing config" }), { status: 500, headers: corsHeaders });
        }

        const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
        if (!openaiApiKey) {
            await debugLog(sb, "Missing global OPENAI_API_KEY", { clinic_id: clinic.id });
            return new Response(JSON.stringify({ error: "Missing config" }), { status: 500, headers: corsHeaders });
        }

        let body = "";
        let isImage = false;
        let base64ImageObj: any = null;
        let payloadExtra: any = {};

        if (msgObj.type === "text") {
            body = msgObj.text?.body || "";
        } else if (msgObj.type === "audio" && msgObj.audio) {
            try {
                // If link exists, use it, otherwise fall back to fetching via ID
                let downloadUrl = msgObj.audio.link;
                if (!downloadUrl) {
                    downloadUrl = `https://api.ycloud.com/v2/whatsapp/media/${msgObj.audio.id}`;
                }
                const blob = await downloadYCloudMedia(downloadUrl, clinic.ycloud_api_key);
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
                const blob = await downloadYCloudMedia(downloadUrl, clinic.ycloud_api_key);
                const arrayBuffer = await blob.arrayBuffer();
                const base64 = btoa(new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));
                base64ImageObj = {
                    type: "image_url",
                    image_url: { url: `data:${blob.type || 'image/jpeg'};base64,${base64}` }
                };
                payloadExtra = { image_base64: `data:${blob.type || 'image/jpeg'};base64,${base64}` };
                body = msgObj.image?.caption || "[La persona te acaba de enviar una imagen]";
                isImage = true;
                await debugLog(sb, `Image received`, { type: blob.type });
            } catch (e) {
                console.error("Image error", e);
                body = "[La persona envió una imagen pero no pude verla. Pídele que te describa lo que envió.]";
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
            const locName = loc.name || "";
            const locAddr = loc.address || "";
            body = `[UBICACIÓN COMPARTIDA] Latitud: ${lat}, Longitud: ${lng}${locName ? ` - Nombre: ${locName}` : ""}${locAddr ? ` - Dirección: ${locAddr}` : ""}. (Dato para el agente: Usa estas coordenadas para confirmar la zona de servicio rural si es necesario).`;
            await debugLog(sb, `Location received`, { lat, lng });
        }

        // Add context from Facebook Ad referral if present
        if (msgObj.referral) {
            const headline = msgObj.referral.headline || "";
            const adBody = msgObj.referral.body || "";
            const adContext = `[Mensaje desde Anuncio: "${headline}" - ${adBody}]`.trim();
            body = `${adContext}\n${body}`.trim();
        }

        const msgRowId = await saveMsg(sb, clinic.id, from, body, "inbound", {
            ycloud_message_id: msgId,
            message_type: msgObj.type
        });

        // Auto-create prospect in CRM (best-effort, non-blocking)
        const profileName = msgObj.customerProfile?.name;
        autoUpsertMinimalProspect(sb, clinic.id, from, profileName).catch(e => console.error("Auto-prospect failed:", e));

        if (!clinic.ai_auto_respond) return new Response(JSON.stringify({ status: "saved" }), { headers: corsHeaders });

        // VERIFY IF HUMAN IS REQUIRED
        // Use OR to be resilient to non-normalized old data
        const { data: prospect } = await sb.from("crm_prospects")
            .select("requires_human")
            .eq("clinic_id", clinic.id)
            .or(`phone.eq.${from},phone.eq.+${from}`)
            .limit(1)
            .maybeSingle();

        if (prospect?.requires_human) {
            await debugLog(sb, `IA silenciosa: Handoff a humano activo para ${from}`, { phone: from });
            // Only save the message but DO NOT respond
            return new Response(JSON.stringify({ status: "saved_silently", reason: "requires_human" }), { headers: corsHeaders });
        }

        const asyncProcess = async () => {
            try {
                // DEBOUNCE - WAIT FOR 2 SECONDS (More human-like responsiveness)
                await new Promise(r => setTimeout(r, 2000));

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

                // --- AT THIS POINT, WE ARE THE LATEST MESSAGE. BEGIN PROCESSING. ---

                // FETCH CONVERSATION HISTORY (Last 15 messages for context)
                // We use a robust phone lookup to handle variations with/without +
                const searchPhone = from.startsWith("+") ? from : `+${from}`;
                const searchPhoneNoPlus = from.startsWith("+") ? from.substring(1) : from;

                const { data: rawHistory } = await sb.from("messages")
                    .select("content, direction, created_at, ai_generated")
                    .eq("clinic_id", clinic.id)
                    .or(`phone_number.eq.${searchPhone},phone_number.eq.${searchPhoneNoPlus}`)
                    .order("created_at", { ascending: false })
                    .limit(15);

                const history = (rawHistory || []).reverse();

                // Check if we already answered this exact same prompt recently to avoid loops
                if (history.length >= 2) {
                    const lastMsg = history[history.length - 1];
                    const prevMsg = history[history.length - 2];
                    if (lastMsg.direction === "outbound" && lastMsg.content === "¡Hola! ¿En qué puedo ayudarle hoy?") {
                         // Potencial loop detectado - forzar un comportamiento más directo
                    }
                }

                const clinicTz = clinic.timezone || "America/Santiago";
                const now = new Date();
                const localTime = now.toLocaleString("es-CL", { timeZone: clinicTz, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });

                // Pre-calculate dates for AI (CRITICAL: use timezone-aware day names, NOT getDay() which is UTC!)
                const localDateISO = now.toLocaleDateString("en-CA", { timeZone: clinicTz });
                const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
                const dayAfter = new Date(now.getTime() + 48 * 60 * 60 * 1000);
                const tomorrowISO = tomorrow.toLocaleDateString("en-CA", { timeZone: clinicTz });
                const dayAfterISO = dayAfter.toLocaleDateString("en-CA", { timeZone: clinicTz });
                const todayDay = now.toLocaleDateString("es-CL", { timeZone: clinicTz, weekday: "long" });
                const tomorrowDay = tomorrow.toLocaleDateString("es-CL", { timeZone: clinicTz, weekday: "long" });
                const dayAfterDay = dayAfter.toLocaleDateString("es-CL", { timeZone: clinicTz, weekday: "long" });

                // Fetch knowledge base summary for system prompt
                const knowledgeSummary = await getKnowledgeSummary(sb, clinic.id);

                // Fetch REAL services from the 'clinic_services' table (not the legacy JSON field)
                const { data: realServices } = await sb.from("clinic_services")
                    .select("name, duration, price, ai_description")
                    .eq("clinic_id", clinic.id);

                const servicesForPrompt = realServices && realServices.length > 0
                    ? realServices.map(s => ({ 
                        nombre: s.name, 
                        duracion: `${s.duration} min`, 
                        precio: `$${s.price.toLocaleString('es-CL')}`,
                        info_importante: s.ai_description || "Sin detalles específicos." 
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
                    sunday: "domingo"
                };

                const hoursSummary = Object.entries(clinic.working_hours || {})
                    .map(([day, h]: [string, any]) => {
                        const dayName = daysMap[day.toLowerCase()] || day;
                        if (!h || h.closed || h.enabled === false) return `${dayName}: CERRADO`;
                        const lunch = h.lunch_break;
                        return `${dayName}: ${h.open || h.start || "10:00"} - ${h.close || h.end || "20:00"}${lunch?.enabled ? ` (Colación: ${lunch.start}-${lunch.end})` : ""}`;
                    }).join(", ");

                const sysPrompt = `${clinic.ai_personality}

Clínica: ${clinic.clinic_name}
Dirección: ${clinic.clinic_address || clinic.address || "No especificada."}
${clinic.address_references ? `Referencias de Dirección: ${clinic.address_references}` : ""}
${clinic.google_maps_url ? `Mapa Google Maps: ${clinic.google_maps_url}` : ""}
Modelo de Negocio: ${clinic.business_model === 'mobile' ? 'DOMICILIO (Móvil)' : clinic.business_model === 'hybrid' ? 'HÍBRIDO (Local y Domicilio)' : 'FÍSICO (Local fijo)'}

${clinic.business_model === 'mobile' || clinic.business_model === 'hybrid' ? ` REGLAS CLÍNICA MÓVIL:
- Eres una clínica móvil, por lo que la ubicación es CRÍTICA. 
- PROTOCOLO DE UBICACIÓN: Primero pide amablemente que el tutor te comparta su **"Ubicación actual"** (un pin de WhatsApp) para saber exactamente dónde se encuentra. Si no sabe o no puede enviarla, solicita la **dirección exacta con referencias**. 
- SECTORES RURALES: En estos casos, insiste en que compartan la **ubicación actual** (no en tiempo real, solo el pin del punto) porque eso te permite calcular el recargo por distancia correctamente.
- NUNCA llames a 'check_availability' si no tienes una ubicación clara confirmada por el usuario.` : ''}
${clinic.instagram_url ? `- Instagram: ${clinic.instagram_url}` : ""}
${clinic.facebook_url ? `- Facebook: ${clinic.facebook_url}` : ""}
${clinic.tiktok_url ? `- TikTok: ${clinic.tiktok_url}` : ""}
${clinic.website_url ? `- Sitio Web: ${clinic.website_url}` : ""}
Horario General de la Clínica: ${hoursSummary}

CONTEXTO DE FECHAS (FUENTE DE VERDAD):
- HOY: ${todayDay}, ${localDateISO}
- MAÑANA: ${tomorrowDay}, ${tomorrowISO}
- PASADO MAÑANA: ${dayAfterDay}, ${dayAfterISO}
Servicios OFICIALES (SOLO ESTOS EXISTEN): ${JSON.stringify(servicesForPrompt)}

${knowledgeSummary}

REGLAS DE ORO DE CONVERSACIÓN (MODO CONSULTOR VETERINARIO):
1. **MÁXIMO UNA PREGUNTA POR TURNO (ESTRICTO)**: Nunca abrumes al tutor con múltiples preguntas. Una a la vez, con tono humano.
2. **ENFOQUE EN EDUCACIÓN ANTES QUE EN VENTA**: Eres un asesor de salud, no un bot de ventas. Si preguntan por un servicio, primero explica brevemente su importancia clínica antes de hablar de logística o precios.
3. **NO PIDAS DIRECCIÓN PREMATURAMENTE**: Solo solicita la comuna o dirección cuando el usuario demuestre una intención CLARA de ver disponibilidad o agendar. No la pidas en el primer mensaje de saludo o información general.
4. **EMPATÍA Y CONEXIÓN**: Usa el nombre de la mascota y demuestra que te importa su bienestar. Por ejemplo: "Lo más importante es proteger a [Nombre] ahora que tiene [Edad]...".
5. **TRIAGE SECUENCIAL Y ANÁLISIS**: Identifica el caso antes de proponer. Sigue este orden orgánico:
   a) Saludo empático y conexión.
   b) Nombre de la mascota y especie.
   c) Edad y peso aproximado (esto determina dosis y vacunas).
   d) Explicación del servicio/vacuna que le toca.
   e) (Opcional si hay interés) Disponibilidad y logística.
6. **PRECIOS CONVALOR**: Cuando des un precio, acompáñalo de lo que incluye (ej: "La vacuna Octuple tiene un valor de $X e incluye la revisión clínica preventiva de [Nombre]").

PROTOCOLO CLÍNICO DE VACUNACIÓN (DETERMINACIÓN POR EDAD):
1. **Distemper / Vacunas Iniciales**:
   - **Puppy DP (Distemper + Parvo)**: Se puede aplicar **SOLO** entre las 4 y 6 semanas de vida de la mascota.
   - **Octuple / Séxtuple**: Se aplica **SOLO** a mascotas mayores a 2 meses (8 semanas) de vida. 
   - SI el usuario pregunta por "vacuna de perro de 3 meses" para Distemper, DEBES sugerir la **Octuple / Séxtuple**, nunca la Puppy DP.
   - SI el usuario pregunta por un cachorro de 5 semanas, DEBES sugerir la **Puppy DP**.
   - Siempre explica brevemente por qué sugieres una u otra basándote en su edad.

REGLAS CRÍTICAS DE FECHAS Y HORARIOS:
1. SI el paciente pregunta por disponibilidad en un día que aparece EXPLÍCITAMENTE como 'CERRADO' en el 'Horario General', DEBES responder inmediatamente que la clínica está cerrada ese día y ofrece alternativas.
2. SIEMPRE verifica disponibilidad con 'check_availability' antes de confirmar un horario.
3. NUNCA digas que una cita está confirmada si no has recibido 'success: true' de la función 'create_appointment'.

FLUJO DE RESERVA Y COBRO (ORDEN OBLIGATORIO):
   a) Ofrecer Slots: Llama a 'check_availability', muestra opciones y menciona el abono de $10.000 (obligatorio para reservar).
   b) Registro: CUANDO TENGAS EL NOMBRE Y EL HORARIO, OBLIGATORIAMENTE DEBES LLAMAR a la herramienta 'create_appointment'. NO ENVÍES TEXTO CONFIRMANDO LA CITA AÚN.
   c) Datos de Pago: NUNCA envíes los datos de transferencia ANTES de que la herramienta 'create_appointment' te haya devuelto 'success: true'.
      DATOS DE ABONO ($10.000): Elizabeth Hernández, RUT 18.342.131-k, Banco Estado, Cuenta Vista / Chequera electrónica, Cuenta: 80070001890.

ETIQUETADO Y CRM (PROACTIVIDAD):
- Usa 'tag_patient' PROACTIVAMENTE para segmentar al paciente (ej: 'Interés Vacunas', 'Canino', 'VIP').
- Usa 'upsert_prospect' para guardar el nombre del tutor, de la mascota y notas relevantes de salud inmediatamente.
- NUNCA menciones al paciente que lo estás etiquetando o registrando.

7. **PROHIBIDO INVENTAR (ANTI-ALUCINACIÓN)**: Está TERMINANTEMENTE PROHIBIDO inventar precios, recargos por comuna, o protocolos que no estén explícitamente en la Base de Conocimiento. Si el usuario pregunta por el costo de una comuna que NO aparece en tu lista de recargos, di: "No tengo el valor exacto del recargo para esa zona en este momento, pero lo consultaré de inmediato con el equipo para confirmarte". Es preferible decir "No lo sé" a dar información falsa.

8. **REGLA DE LOGÍSTICA (COSTO $0)**: Si el usuario menciona una comuna que aparece en la lista de "VISITA INCLUIDA" o sectores generales y NO está en la lista de "RECARGO ESPECIAL", el costo de la visita es **$0** (GRATIS) siempre que agende un servicio médico (Vacuna, Consulta, etc). No menciones el "costo base" de $6.000 a menos que sea una comuna con recargo.

${clinic.clinic_name?.includes('AnimalGrace Linares') ? ` REGLAS ESPECIALES DE LOGÍSTICA (LINARES/TALCA):
1. BASE LINARES: El recorrido inicia y termina en Linares. Si el paciente es de Linares o radio urbano cercano, prioriza ofrecer primera hora (ej. 09:30) o última hora (ej. 17:30) de la jornada si están disponibles.
2. RUTAS A TALCA: Se viaja a Talca de forma intercalada (día por medio aprox). 
   - La prioridad es AGRUPAR. Si el paciente quiere agenda en Talca, intenta ofrecerle opciones y fíjate si el cliente acepta un día en particular. 
   - Trata de no ofrecer Talca todos los días continuos. Si acabas de agendar para un Lunes, sugiere el Miércoles para el próximo paciente de Talca.
3. COMUNAS PUENTE (San Javier, Villa Alegre, Ruta 5 Sur): Pueden agendarse aprovechando la ruta hacia o desde Talca (a media mañana o media tarde), o desde Linares abonando el recargo por distancia correspondiente.
4. TARIFAS Y DISTANCIAS ANCLA: Linares urbano y Talca urbano tienen costo de visita $0. Fuera del urbano: a 10 min ($6.000), a 20 min ($8.000), a 30 min ($10.000). A más de 30 minutos de tiempo de viaje de estas anclas, indica que la visita técnica requerirá factibilidad. Niégate a inventar recargos.` : ''}

${clinic.ai_behavior_rules || "Sin reglas específicas adicionales."}`;


                // The 'history' variable is already fetched and reversed at the top of the asyncProcess.
                const orderedMsgs = history;

                // Find where the last outbound message is so we can group all recent inbound ones
                let lastOutboundIndex = -1;
                for (let i = orderedMsgs.length - 1; i >= 0; i--) {
                    if (orderedMsgs[i].direction === "outbound") {
                        lastOutboundIndex = i;
                        break;
                    }
                }

                const pastContext = lastOutboundIndex >= 0 ? orderedMsgs.slice(0, lastOutboundIndex + 1) : [];
                const burstInbound = lastOutboundIndex >= 0 ? orderedMsgs.slice(lastOutboundIndex + 1) : orderedMsgs;

                const msgs: Msg[] = [
                    { role: "system", content: sysPrompt },
                    ...pastContext.map((m) => ({ role: (m.direction === "inbound" ? "user" : "assistant") as "user" | "assistant", content: m.content || "" }))
                ];

                // Combine the current inbound burst into a single user message
                let userContentBlocks: any[] = [];
                for (const msg of burstInbound) {
                    if (msg.message_type === "image" && msg.payload?.image_base64) {
                        userContentBlocks.push({ type: "text", text: msg.content || "[Imagen]" });
                        userContentBlocks.push({
                            type: "image_url",
                            image_url: { url: msg.payload.image_base64 }
                        });
                    } else {
                        userContentBlocks.push({ type: "text", text: msg.content || "" });
                    }
                }

                if (userContentBlocks.length > 0) {
                    msgs.push({ role: "user", content: userContentBlocks });
                }

                const targetModel = clinic.ai_active_model === 'mini' ? 'gpt-4o-mini' : 'gpt-4o';
                let res = await callOpenAI(openaiApiKey, targetModel, msgs);
                let assistant = res.choices[0].message;
                let funcResult: Record<string, unknown> | null = null;
                let allFuncResults: Record<string, unknown>[] = [];

                // Handle function calls (support multiple sequential calls)
                let maxCalls = 3;
                while (assistant.function_call && maxCalls > 0) {
                    const fnArgs = JSON.parse(assistant.function_call.arguments);
                    funcResult = await processFunc(sb, clinic.id, from, assistant.function_call.name, fnArgs, clinic.timezone || "America/Santiago", clinic);
                    allFuncResults.push({ name: assistant.function_call.name, result: funcResult });

                    msgs.push(
                        { role: "assistant", content: "", function_call: assistant.function_call },
                        { role: "function", name: assistant.function_call.name, content: JSON.stringify(funcResult) }
                    );

                    res = await callOpenAI(openaiApiKey, targetModel, msgs);
                    assistant = res.choices[0].message;
                    maxCalls--;
                }

                const reply = assistant.content || "Error. ¿Puedes repetir?";
                await saveMsg(sb, clinic.id, from, reply, "outbound", {
                    ai_generated: true,
                    ai_function_called: allFuncResults.length > 0 ? allFuncResults.map(r => (r as Record<string, unknown>).name).join(", ") : null,
                    ai_function_result: allFuncResults.length > 0 ? allFuncResults : null
                });

                await sendWA(clinic.ycloud_api_key, from, clinic.ycloud_phone_number || to, reply);
                await debugLog(sb, `AI Response Sent`, { to: from, msgId: msgRowId });
            } catch (err) {
                console.error("Async Process Error:", err);
                await debugLog(sb, "Async Process Error (OpenAI/Otros)", { error: (err as Error).message, phone: from });

                // Respond to user so it doesn't stay silent
                const fallbackReply = "Lo siento, tuve un problema técnico procesando tu mensaje. Por favor intenta consultarme en unos minutos.";
                await saveMsg(sb, clinic.id, from, fallbackReply, "outbound", { error_fallback: true });
                await sendWA(clinic.ycloud_api_key, from, clinic.ycloud_phone_number || to, fallbackReply).catch(e => console.error("Failed sending fallback WA:", e));
            }
        };

        // @ts-ignore: EdgeRuntime is available in Supabase edge functions
        if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
            // @ts-ignore
            EdgeRuntime.waitUntil(asyncProcess());
        } else {
            asyncProcess();
        }

        return new Response(JSON.stringify({ status: "processing_async" }), { headers: corsHeaders });
    } catch (e) {
        console.error(e);
        const sb = getSupabase(); // Needs logging if internal error
        await debugLog(sb, "Internal Error", { error: (e as Error).message });
        return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: corsHeaders });
    }
});
