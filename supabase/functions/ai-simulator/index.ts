import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info"
};

interface Msg { role: "system" | "user" | "assistant" | "function"; content: string; name?: string; function_call?: { name: string; arguments: string }; }

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const getSupabase = () => createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

// =============================================
// OpenAI Function Definitions (Same as webhook)
// =============================================
const functions = [
    {
        name: "check_availability",
        description: "Verifica disponibilidad de horarios. Infiere el servicio de la conversación.",
        parameters: { type: "object", properties: { date: { type: "string", description: "Fecha YYYY-MM-DD" }, service_name: { type: "string", description: "Nombre del servicio" }, professional_name: { type: "string", description: "Nombre del profesional (opcional)" } }, required: ["date"] }
    },
    {
        name: "create_appointment",
        description: "Crea nueva cita cuando paciente confirma fecha, hora y servicio",
        parameters: { type: "object", properties: { patient_name: { type: "string" }, date: { type: "string" }, time: { type: "string" }, service_name: { type: "string" }, professional_name: { type: "string", description: "Profesional solicitado (opcional)" } }, required: ["patient_name", "date", "time", "service_name"] }
    },
    {
        name: "get_services",
        description: "Lista servicios disponibles con precios y duración",
        parameters: { type: "object", properties: {}, required: [] }
    },
    {
        name: "get_knowledge",
        description: "Busca información detallada en la base de conocimiento (precios, tratamientos, cuidados, valores, promociones). ÚSALO SIEMPRE ante preguntas sobre costos o temas específicos que no estén en tu configuración básica.",
        parameters: { type: "object", properties: { query: { type: "string", description: "Palabras clave simplificadas para la búsqueda (ej: 'precios', 'labios', 'cuidados', 'promocion')" } }, required: ["query"] }
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
// Tool implementations (simplified for simulator)
// =============================================
const getOffset = (timeZone: string = "America/Santiago", date: Date) => {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone,
            timeZoneName: 'shortOffset'
        }).formatToParts(date);
        const name = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT-3';
        const match = name.match(/([+-])(\d+)(?::(\d+))?/);
        if (match) {
            const [_, sign, h, m] = match;
            return `${sign}${h.padStart(2, '0')}:${(m || '00').padStart(2, '0')}`;
        }
        return "-03:00";
    } catch (e) { return "-03:00"; }
};

const checkAvail = async (sb: ReturnType<typeof createClient>, clinicId: string, date: string, serviceName?: string, timezone?: string, professionalName?: string, clinicWorkingHours?: any) => {
    try {
        const tz = timezone || "America/Santiago";
        let duration = 60;
        let serviceId: string | null = null;
        let professionalId: string | null = null;

        // 1. Fetch REAL service data
        if (serviceName) {
            const { data: svc } = await sb.from("services")
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

        // 2. Try to find the professional
        if (professionalName) {
            const { data: prof } = await sb.from("clinic_members")
                .select("id")
                .eq("clinic_id", clinicId)
                .or(`first_name.ilike.%${professionalName}%,last_name.ilike.%${professionalName}%,job_title.ilike.%${professionalName}%`)
                .limit(1)
                .maybeSingle();
            if (prof) professionalId = prof.id;
        }

        // 3. Fallback to service professional
        if (!professionalId && serviceId) {
            const { data: sp } = await sb.from("service_professionals")
                .select("member_id")
                .eq("service_id", serviceId)
                .eq("is_primary", true)
                .maybeSingle();
            if (sp) professionalId = sp.member_id;
        }

        console.log(`[Simulator checkAvail] Date: ${date}, Service: ${serviceName}, Prof: ${professionalId || 'Global'}`);

        let slots: { slot_time: string, is_available: boolean }[] = [];

        // 4. Call RPCs for specific slots
        // Note: Even if RPC is old, we will filter lunch break in JS below.
        if (professionalId) {
            const { data, error } = await sb.rpc("get_professional_available_slots", {
                p_clinic_id: clinicId,
                p_member_id: professionalId,
                p_date: date,
                p_duration: duration,
                p_timezone: tz,
                p_interval: duration
            });
            if (!error && data) slots = data;
        }

        if (slots.length === 0) {
            const { data, error } = await sb.rpc("get_available_slots", {
                p_clinic_id: clinicId,
                p_date: date,
                p_duration: duration,
                p_timezone: tz,
                p_interval: duration
            });
            if (!error && data) slots = data;
        }

        if (slots.length === 0) {
            return { available: false, message: `No hay disponibilidad para el ${date}. Sugiere otro día de lunes a viernes.` };
        }

        // 5. MANUALLY FILTER SLOTS FOR CLINIC LUNCH BREAK (Double-protection)
        const dow = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][new Date(date + 'T12:00:00').getDay()];
        const dayConfig = clinicWorkingHours?.[dow];
        const lunch = dayConfig?.lunch_break;

        const availableSlots = slots
            .filter(s => s.is_available)
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
            .map(s => {
                const t = s.slot_time.substring(0, 5);
                const h = parseInt(t.split(":")[0]);
                return `${h > 12 ? h - 12 : h}:${t.split(":")[1]} ${h >= 12 ? "PM" : "AM"}`;
            });

        if (availableSlots.length === 0) {
            return { available: false, message: `Lo siento, no hay espacios libres disponibles para el ${date}.` };
        }

        const displaySlots = availableSlots.slice(0, 10);

        return {
            available: true,
            date,
            slots: displaySlots,
            message: `Para el ${date}, tenemos estos espacios disponibles para ${serviceName || 'tu cita'}: ${displaySlots.join(", ")}. ¿A qué hora te gustaría agendar?`
        };
    } catch (e) {
        console.error("checkAvail error:", e);
        return { error: "Error verificando disponibilidad." };
    }
};

const createAppt = async (sb: ReturnType<typeof createClient>, clinicId: string, simulatedPhone: string, args: any, timezone: string) => {
    try {
        // Fetch price/duration from real services table
        let price = 0;
        let duration = 60;
        const { data: realServices } = await sb.from("services")
            .select("name, duration, price")
            .eq("clinic_id", clinicId);

        if (realServices && realServices.length > 0) {
            const svc = realServices.find((s: any) => s.name.toLowerCase().includes(args.service_name?.toLowerCase() || ""));
            if (svc) { price = svc.price || 0; duration = svc.duration || 60; }
        }

        // Normalize time (handle 24h, 12h, and cleaning)
        let normalizedTime = args.time.replace(/[^\d:apmAPM\s]/g, '').trim();
        if (normalizedTime.toLowerCase().includes('pm') || normalizedTime.toLowerCase().includes('am')) {
            const isPM = normalizedTime.toLowerCase().includes('pm');
            let [h, m] = normalizedTime.replace(/[apmAPM\s]/g, '').split(':').map(Number);
            if (isPM && h < 12) h += 12;
            if (!isPM && h === 12) h = 0;
            normalizedTime = `${h.toString().padStart(2, '0')}:${(m || 0).toString().padStart(2, '0')}`;
        } else {
            // Ensure HH:MM
            const parts = normalizedTime.split(':');
            const h = parts[0].padStart(2, '0');
            const m = (parts[1] || '00').padStart(2, '0');
            normalizedTime = `${h}:${m}`;
        }

        // Fix Timezone: Construct ISO string with offset
        const offset = getOffset(timezone, new Date(`${args.date}T12:00:00`));
        const appointmentDateWithOffset = `${args.date}T${normalizedTime}:00${offset}`;
        console.log(`[Simulator createAppt] Final ISO: ${appointmentDateWithOffset}`);

        const { data, error } = await sb.from("appointments").insert({
            clinic_id: clinicId,
            patient_name: args.patient_name,
            phone_number: simulatedPhone,
            service: args.service_name,
            appointment_date: appointmentDateWithOffset,
            duration: duration,
            price,
            status: "pending",
            payment_status: "pending"
        }).select("id").single();

        if (error) {
            console.error("[createAppt Simulator] DB Error:", error);
            // Log to console so user can see in browser if they look at devtools
            console.log("DB ERROR ARGS:", args);

            let errorMsg = "Error DB-AG-01: No pudimos registrar tu cita en el sistema. Por favor intenta con otro nombre completo o contacta soporte.";
            if (error.code === '23505') {
                errorMsg = "Error DB-CONFLICT: Ya existe una cita con este teléfono y un nombre similar. Por favor intenta usando tu nombre completo real o contacta soporte.";
            }
            return { success: false, message: errorMsg };
        }

        return {
            success: true,
            appointment_id: data?.id,
            message: `✅ Cita agendada: ${args.patient_name} el ${args.date} a las ${args.time} para ${args.service_name}. Precio: $${price.toLocaleString()}. (NOTA INTERNA: Cita creada desde el simulador)`
        };
    } catch (e: any) {
        console.error("createAppt error:", e);
        await sb.from("debug_logs").insert({
            clinic_id: clinicId,
            message: "Simulator Exception",
            payload: { error: e.message || e, args }
        });
        return { success: false, message: "Error técnico: Cita no guardada correctamente." };
    }
};

const getServices = async (sb: ReturnType<typeof createClient>, clinicId: string) => {
    // Fetch from the real 'services' table first
    const { data: realServices } = await sb.from("services")
        .select("name, duration, price")
        .eq("clinic_id", clinicId);

    if (realServices && realServices.length > 0) {
        const services = realServices.map(s => ({ name: s.name, duration: `${s.duration} min`, price: `$${s.price.toLocaleString('es-CL')}` }));
        return { services, message: "Estos son los servicios y precios disponibles." };
    }

    // Fallback to legacy JSON field
    const { data } = await sb.from("clinic_settings").select("services").eq("id", clinicId).single();
    return { services: data?.services || [], message: "Estos son los servicios y precios disponibles." };
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
        return { found: false, message: "Error al buscar en base de conocimiento." };
    }
};

// Tag patient (same logic as webhook)
const tagPatient = async (sb: ReturnType<typeof createClient>, clinicId: string, phone: string, args: { tag_name: string; tag_color?: string }) => {
    try {
        const tagName = args.tag_name.trim();
        if (!tagName) return { success: false, message: "Nombre de etiqueta vacío." };

        const defaultColor = "#3B82F6";
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
            const { data: newTag, error: tagError } = await sb.from("tags")
                .insert({ clinic_id: clinicId, name: tagName, color: tagColor })
                .select("id")
                .single();

            if (tagError) {
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

        if (!tagId) return { success: false, message: "No se pudo crear la etiqueta." };

        // 2. Find the patient by phone number
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
            // Simulator REDIRECTION: If not a patient, tag in CRM
            console.log(`[Simulator tagPatient] Patient not found for ${phone}, redirecting to CRM...`);
            
            // 1. Ensure prospect exists
            const prospectId = await autoUpsertMinimalProspect(sb, clinicId, phone);
            if (!prospectId) return { success: false, message: "No se pudo identificar al prospecto." };

            // 2. Manage CRM Tag
            const { data: crmTag } = await sb.from("crm_tags")
                .select("id")
                .eq("clinic_id", clinicId)
                .ilike("name", tagName)
                .limit(1)
                .maybeSingle();
            
            let crmTagId = crmTag?.id;

            if (!crmTagId) {
                const { data: newCrmTag, error: createError } = await sb.from("crm_tags")
                    .insert({ clinic_id: clinicId, name: tagName, color: "#3B82F6" })
                    .select("id")
                    .single();
                
                crmTagId = createError ? (await sb.from("crm_tags").select("id").eq("clinic_id", clinicId).ilike("name", tagName).limit(1).maybeSingle())?.data?.id : newCrmTag?.id;
            }

            if (!crmTagId) return { success: false, message: "No se pudo gestionar etiqueta CRM." };

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

        // 3. Assign tag to patient
        const { data: existingLink } = await sb.from("patient_tags")
            .select("patient_id")
            .eq("patient_id", patientId)
            .eq("tag_id", tagId)
            .limit(1)
            .maybeSingle();

        if (!existingLink) {
            await sb.from("patient_tags").insert({ patient_id: patientId, tag_id: tagId });
        }

        console.log(`[Simulator tagPatient] Tagged ${phone} with "${tagName}"`);
        return { success: true, tag_name: tagName, message: `Etiqueta "${tagName}" asignada. (Interno, NO lo menciones al paciente.)` };
    } catch (e) {
        console.error("[Simulator tagPatient] Error:", e);
        return { success: false, message: "Error al etiquetar paciente." };
    }
};

// =============================================
// Process tool calls
// =============================================
const processFunc = async (sb: ReturnType<typeof createClient>, clinicId: string, simulatedPhone: string, funcName: string, args: any, timezone: string, clinic?: any) => {
    switch (funcName) {
        case "check_availability": return checkAvail(sb, clinicId, args.date, args.service_name, timezone, args.professional_name, clinic?.working_hours);
        case "create_appointment": return createAppt(sb, clinicId, simulatedPhone, args, timezone);
        case "get_services": return getServices(sb, clinicId);
        case "get_knowledge": return getKnowledge(sb, clinicId, args.query);
        case "tag_patient": return tagPatient(sb, clinicId, simulatedPhone, args as { tag_name: string; tag_color?: string });
        default: return { message: `(Función ${funcName} no disponible en el simulador. En WhatsApp real sí funcionaría.)` };
    }
};

// =============================================
// Call OpenAI
// =============================================
const callOpenAI = async (key: string, model: string, msgs: Msg[], useFns = true) => {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
            model,
            messages: msgs,
            ...(useFns ? { functions, function_call: "auto" } : {}),
            temperature: 0.5,
            max_tokens: 800
        })
    });
    if (!r.ok) throw new Error(`OpenAI Error: ${await r.text()}`);
    return r.json();
};

// =============================================
// Get knowledge summary for system prompt
// =============================================
const getKnowledgeSummary = async (sb: ReturnType<typeof createClient>, clinicId: string) => {
    try {
        const { data: docs } = await sb.from("knowledge_base")
            .select("title, content, category")
            .eq("clinic_id", clinicId)
            .eq("status", "active")
            .eq("status", "active")
            .limit(10);

        if (!docs || docs.length === 0) return "";
        return "\n\nBase de Conocimiento de la Clínica:\n" +
            docs.map((d: any) => `- ${d.title} (${d.category}): ${d.content.substring(0, 300)}`).join("\n");
    } catch {
        return "";
    }
};

// =============================================
// Main Handler
// =============================================
Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
        const { clinic_id, message, conversation_history } = await req.json();

        if (!clinic_id || !message) {
            return new Response(JSON.stringify({ error: "clinic_id y message son requeridos." }), { status: 400, headers: corsHeaders });
        }

        const sb = getSupabase();

        // 1. Get clinic config
        const { data: clinic, error: clinicError } = await sb.from("clinic_settings")
            .select("*")
            .eq("id", clinic_id)
            .single();

        if (clinicError || !clinic) {
            return new Response(JSON.stringify({ error: "Clínica no encontrada." }), { status: 404, headers: corsHeaders });
        }

        // 2. Get OpenAI key
        const openaiKey = Deno.env.get("OPENAI_API_KEY") || "";
        if (!openaiKey) {
            return new Response(JSON.stringify({ error: "OpenAI API key no configurada." }), { status: 500, headers: corsHeaders });
        }

        // 3. Build system prompt with robust date context
        const clinicTz = clinic.timezone || "America/Santiago";
        const now = new Date();
        const localTime = now.toLocaleString("es-CL", {
            timeZone: clinicTz,
            weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit"
        });

        // Pre-calculate dates to prevent AI miscalculation
        // CRITICAL: Use mid-day for safe timezone landing
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const dayAfter = new Date(now.getTime() + 48 * 60 * 60 * 1000);

        const localDateISO = now.toLocaleDateString("en-CA", { timeZone: clinicTz });
        const tomorrowISO = tomorrow.toLocaleDateString("en-CA", { timeZone: clinicTz });
        const dayAfterISO = dayAfter.toLocaleDateString("en-CA", { timeZone: clinicTz });

        // Get timezone-correct day names
        const todayDay = now.toLocaleDateString("es-CL", { timeZone: clinicTz, weekday: "long" });
        const tomorrowDay = tomorrow.toLocaleDateString("es-CL", { timeZone: clinicTz, weekday: "long" });
        const dayAfterDay = dayAfter.toLocaleDateString("es-CL", { timeZone: clinicTz, weekday: "long" });

        console.log(`[PromptGen] Today: ${localDateISO} (${todayDay}), Tomorrow: ${tomorrowISO} (${tomorrowDay}), DayAfter: ${dayAfterISO} (${dayAfterDay})`);

        const knowledgeSummary = await getKnowledgeSummary(sb, clinic_id);
        const simulatedPhone = "+56900000000"; // Simulated test phone

        // Fetch REAL services from the 'services' table (not the legacy JSON field)
        const { data: realServices } = await sb.from("services")
            .select("name, duration, price")
            .eq("clinic_id", clinic_id);

        const servicesForPrompt = realServices && realServices.length > 0
            ? realServices.map(s => ({ name: s.name, duration: `${s.duration} min`, price: `$${s.price.toLocaleString('es-CL')}` }))
            : clinic.services || [];

        // Build a readable string of hours for the AI to know if it is closed TODAY or a SPECIFIC day
        const hoursSummary = Object.entries(clinic.working_hours || {})
            .map(([day, h]: [string, any]) => {
                if (!h || h.closed || h.enabled === false) return `${day}: CERRADO`;
                const lunch = h.lunch_break;
                return `${day}: ${h.open || h.start || "10:00"} - ${h.close || h.end || "20:00"}${lunch?.enabled ? ` (Colación: ${lunch.start}-${lunch.end})` : ""}`;
            }).join(", ");

        const sysPrompt = `${clinic.ai_personality}

Clínica: ${clinic.clinic_name}
Dirección: ${clinic.clinic_address || clinic.address || "No especificada"}
${clinic.address_references ? `Referencias de Dirección: ${clinic.address_references}` : ""}
${clinic.google_maps_url ? `Mapa Google Maps: ${clinic.google_maps_url}` : ""}
${clinic.instagram_url ? `- Instagram: ${clinic.instagram_url}` : ""}
${clinic.facebook_url ? `- Facebook: ${clinic.facebook_url}` : ""}
${clinic.tiktok_url ? `- TikTok: ${clinic.tiktok_url}` : ""}
${clinic.website_url ? `- Sitio Web: ${clinic.website_url}` : ""}
Horario General de la Clínica: ${hoursSummary}
FECHA DE HOY (ISO): ${localDateISO} (${todayDay})
MAÑANA: ${tomorrowDay} ${tomorrowISO}
PASADO MAÑANA: ${dayAfterDay} ${dayAfterISO}
Servicios OFICIALES (FUENTE DE VERDAD - SOLO ESTOS EXISTEN): ${JSON.stringify(servicesForPrompt)}
${knowledgeSummary}

⚠️ MODO SIMULADOR: Estás en modo de prueba dentro de la app. Responde EXACTAMENTE como lo harías en WhatsApp real. Las citas que agendes aquí serán reales y aparecerán en el calendario. El número del paciente es simulado.

REGLAS CRÍTICAS DE FECHAS Y HORARIOS:
0. NO HAY LÍMITES DE ANTICIPACIÓN: Puedes agendar citas para cualquier semana o mes futuro. NUNCA digas que no es posible agendar con anticipación o que está muy lejos.
1. SI el paciente pregunta por disponibilidad en un día que aparece EXPLÍCITAMENTE como 'CERRADO' en el 'Horario General' (ej: sábado o domingo), DEBES responder inmediatamente que la clínica está cerrada ese día y ofrece alternativas de los días que sí están abiertos. NO asumas que un día está cerrado si no aparece en la lista; si no aparece, pregunta disponibilidad con 'check_availability'.
2. SIEMPRE verifica disponibilidad con 'check_availability' antes de confirmar un horario, INCLUSO si el usuario pide un horario específico. No asumas que está disponible.
3. SI el paciente pregunta por "mañana" o "pasado mañana", usa las fechas ISO proporcionadas arriba.
4. CONFÍA plenamente en el nombre del día y disponibilidad devueltos por 'check_availability'.
5. El Horario General es tu guía; la herramienta es tu confirmación final.
6. NUNCA digas que una cita está confirmada si no has recibido 'success: true' de la función 'create_appointment'.

FLUJO DE RESERVA Y COBRO (ORDEN OBLIGATORIO):
   a) Ofrecer Slots: Llama a 'check_availability', muestra opciones y menciona el abono de $10.000.
   b) Selección y Nombre: Pide el horario que más le acomode y su NOMBRE COMPLETO.
   c) Registro: CUANDO TENGAS EL NOMBRE Y EL HORARIO, OBLIGATORIAMENTE DEBES LLAMAR a la herramienta 'create_appointment'. NO ENVÍES TEXTO CONFIRMANDO LA CITA AÚN.
   d) Datos de Pago: NUNCA envíes los datos de transferencia bancaria ANTES de que la herramienta 'create_appointment' te haya devuelto 'success: true'. Es una regla estricta.
      LOS DATOS OFICIALES PARA EL ABONO ($10.000) SON:
      - Nombre: Elizabeth Hernández
      - RUT: 18.342.131-k
      - Banco: Banco Estado
      - Tipo de cuenta: Cuenta Vista / Chequera electrónica
      - Número de cuenta: 80070001890
   e) Validación: Si envía comprobante, agradece y confirma que está pendiente de validación.

REGLAS SOBRE SERVICIOS Y FLUJO DE MICROBLADING:
1. Solo ofrece los servicios listados en "Servicios OFICIALES". No inventes servicios.
2. FLUJO DE MICROBLADING: Si el paciente muestra interés en Microblading, sigue este flujo natural:
   a) Consulta si es su primera vez o si ya tiene un trabajo previo (esto es vital para el precio y técnica).
   b) Explica brevemente el tratamiento y menciona contraindicaciones solo si es pertinente o si el usuario pregunta detalles (embarazo, lactancia, diabetes, problemas cutáneos).
   c) Indica el valor oficial ($10.000 de abono).
   d) Ofrece agendar preguntando qué día le acomoda.
3. Ante preguntas generales sobre servicios, enumera TODOS los servicios oficiales con sus precios.
4. SIEMPRE usa 'get_knowledge' si te preguntan detalles técnicos o precios que no ves en la lista estática.

7. Errores en herramientas: 
   - Si create_appointment falla (success: false), NUNCA inventes que se agendó. 
   - Informa al usuario el mensaje de error exacto recibido. 
   - Si el error contiene "DB-AG-01", dile que no pudimos registrarla y sugiera intentar con el nombre real.
   - Si el error contiene "DB-CONFLICT", significa que el nombre genera un conflicto de duplicidad con el teléfono. Sugiere al usuario usar un "segundo apellido" o nombre completo real (Regla 10).
8. Formulario: Si falta algún campo obligatorio, pídelo de forma clara. Sugiere el Microblading si el usuario no sabe qué elegir.
9. Confirmación: Antes de agendar, muestra un resumen de la cita (Fecha, Hora, Servicio, Nombre completo y el abono de $10.000). Pregunta "¿Confirmamos?" de forma explícita.
10. Conflicto de Paciente (DB-CONFLICT): 
    - Si recibes un error 'DB-CONFLICT', explica al usuario que ya existe un registro con ese número pero con un nombre ligeramente distinto. 
    - Pide amablemente el segundo apellido o el nombre completo real del paciente para diferenciarlo en el sistema.

ETIQUETADO AUTOMÁTICO INTELIGENTE:
Usa la función 'tag_patient' PROACTIVAMENTE para segmentar al paciente internamente.
- "Interés [NombreServicio]" (azul #3B82F6)
- "Primera Vez", "Cliente [NombreServicio]", "Cliente Frecuente" (verde #10B981)
- "Piel Sensible", "Embarazada", "Condición Médica" (rojo #EF4444)
- "Consulta Precio", "Referidor" (amarillo #F59E0B)
- "VIP", "Promoción" (morado #8B5CF6)

REGLAS DE ETIQUETADO:
1. Etiqueta INMEDIATAMENTE cuando detectes la señal.
2. NUNCA menciones al paciente que lo estás etiquetando.

11. REDES SOCIALES Y WEB: Si el paciente solicita nuestras redes sociales (Instagram, Facebook o TikTok) o nuestro sitio web, proporciónale los enlaces oficiales listados arriba. Si no están configurados en la parte superior, búscaros obligatoriamente en la base de conocimiento (\`get_knowledge\`) antes de informar que no están disponibles.
12. UBICACIÓN Y MAPA: Usa los campos de Dirección y Mapa proporcionados arriba.

${clinic.ai_behavior_rules || "Sin reglas específicas adicionales."}`;

        // 4. Build messages array
        const msgs: Msg[] = [{ role: "system", content: sysPrompt }];

        // Add conversation history
        if (conversation_history && Array.isArray(conversation_history)) {
            for (const msg of conversation_history) {
                msgs.push({ role: msg.sender === 'user' ? 'user' : 'assistant', content: msg.text });
            }
        }

        // Add current message
        msgs.push({ role: "user", content: message });

        // 5. Call OpenAI with tool loop (same pattern as webhook)
        let res = await callOpenAI(openaiKey, clinic.openai_model || "gpt-4o-mini", msgs);
        let assistant = res.choices[0].message;
        let loopCount = 0;
        const maxLoops = 5;

        while (assistant.function_call && loopCount < maxLoops) {
            const funcName = assistant.function_call.name;
            let funcArgs: any = {};
            try { funcArgs = JSON.parse(assistant.function_call.arguments); } catch { }

            console.log(`[Simulator] Tool call: ${funcName} `, funcArgs);

            const result = await processFunc(sb, clinic_id, simulatedPhone, funcName, funcArgs, clinic.timezone || "America/Santiago", clinic);

            // Add assistant's function call + result to messages
            msgs.push({ role: "assistant", content: "", function_call: assistant.function_call });
            msgs.push({ role: "function", name: funcName, content: JSON.stringify(result) });

            // Call OpenAI again with the result
            res = await callOpenAI(openaiKey, clinic.openai_model || "gpt-4o-mini", msgs);
            assistant = res.choices[0].message;
            loopCount++;
        }

        const reply = assistant.content || "No pude generar una respuesta.";

        return new Response(JSON.stringify({
            reply,
            tools_used: loopCount,
            model: clinic.openai_model || "gpt-4o-mini"
        }), { headers: corsHeaders });

    } catch (err: any) {
        console.error("[Simulator] Error:", err);
        return new Response(JSON.stringify({ error: err.message || "Error interno." }), { status: 500, headers: corsHeaders });
    }
});

const autoUpsertMinimalProspect = async (sb: any, clinicId: string, phone: string) => {
    try {
        const { data: existing } = await sb.from("crm_prospects")
            .select("id")
            .eq("clinic_id", clinicId)
            .eq("phone", phone)
            .limit(1)
            .maybeSingle();

        if (existing) return existing.id;

        const { data: stages } = await sb.from("crm_pipeline_stages")
            .select("id")
            .eq("clinic_id", clinicId)
            .order("position", { ascending: true })
            .limit(1);
        
        const stageId = stages?.[0]?.id;
        if (!stageId) return null;

        const { data: newProspect, error } = await sb.from("crm_prospects").insert({
            clinic_id: clinicId,
            stage_id: stageId,
            name: "Sin nombre (Simulador)",
            phone: phone,
            source: "whatsapp",
            score: 0
        }).select("id").single();

        if (error) return null;
        return newProspect?.id;
    } catch (e) {
        console.error("autoUpsertMinimalProspect error:", e);
        return null;
    }
};
