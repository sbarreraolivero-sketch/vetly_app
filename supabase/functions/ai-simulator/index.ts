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

const checkAvail = async (sb: ReturnType<typeof createClient>, clinicId: string, date: string, serviceName?: string, timezone: string = "America/Santiago", professionalName?: string, clinicWorkingHours?: any) => {
    try {
        const searchInterval = 30; // 30 min search interval for flexible scheduling
        let duration = 60; // Default
        let serviceId: string | null = null;
        let professionalId: string | null = null;

        // 1. Fetch REAL service data
        if (serviceName) {
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

        const professionalNameTrimmed = professionalName ? professionalName.trim() : null;

        // 2. Try to find the professional BY NAME
        if (professionalNameTrimmed) {
            const { data: prof } = await sb.from("clinic_members")
                .select("id")
                .eq("clinic_id", clinicId.trim())
                .or(`first_name.ilike.%${professionalNameTrimmed}%,last_name.ilike.%${professionalNameTrimmed}%,job_title.ilike.%${professionalNameTrimmed}%`)
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
                .limit(1)
                .maybeSingle();
            if (sp) professionalId = sp.member_id;
        }

        console.log(`[Simulator checkAvail] Date: ${date}, Dur: ${duration}, Prof: ${professionalId || 'Global'}`);

        let slots: { slot_time: string, is_available: boolean }[] = [];

        // 4. Call RPCs (Relying on the new unified logic)
        if (professionalId) {
            const { data, error } = await sb.rpc("get_professional_available_slots", {
                p_clinic_id: clinicId.trim(),
                p_member_id: professionalId,
                p_date: date,
                p_duration: duration,
                p_interval: searchInterval,
                p_timezone: timezone
            });
            if (!error && data) slots = data;
            else if (error) console.error("[Simulator] Professional RPC error:", error);
        }

        if (slots.length === 0) {
            const { data, error } = await sb.rpc("get_available_slots", {
                p_clinic_id: clinicId.trim(),
                p_date: date,
                p_duration: duration,
                p_interval: searchInterval,
                p_timezone: timezone
            });
            if (!error && data) slots = data;
            else if (error) console.error("[Simulator] Global RPC error:", error);
        }

        // 5. Filter and Format
        const availableSlots = slots
            .filter(s => s.is_available)
            .map(s => {
                const t = s.slot_time.substring(0, 5);
                const h = parseInt(t.split(":")[0]);
                const m = t.split(":")[1];
                return `${h > 12 ? h - 12 : h === 0 ? 12 : h}:${m} ${h >= 12 ? "PM" : "AM"}`;
            });

        if (availableSlots.length === 0) {
            return { available: false, message: `Lamentablemente no hay disponibilidad para el ${date}. ¿Deseas revisar otro día?` };
        }

        const displaySlots = availableSlots.slice(0, 8); // Top 8 slots
        return {
            available: true,
            date,
            slots: displaySlots,
            message: `Para el ${date}, encontramos estos horarios: ${displaySlots.join(", ")}. ¿Cuál te acomoda más?`
        };
    } catch (e) {
        console.error("[Simulator checkAvail] Error:", e);
        return { error: "Hubo un problema técnico al verificar horarios." };
    }
};

const createAppt = async (sb: ReturnType<typeof createClient>, clinicId: string, simulatedPhone: string, args: any, timezone: string) => {
    try {
        // Fetch price/duration from real services table
        let price = 0;
        let duration = 60;
        const { data: realServices } = await sb.from("clinic_services")
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
    const { data: realServices } = await sb.from("clinic_services")
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
        const { data: realServices } = await sb.from("clinic_services")
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
Dirección: ${clinic.clinic_address || clinic.address || "No especificada."}
${clinic.address_references ? `Referencias de Dirección: ${clinic.address_references}` : ""}
${clinic.google_maps_url ? `Mapa Google Maps: ${clinic.google_maps_url}` : ""}
Modelo de Negocio: ${clinic.business_model === 'mobile' ? 'DOMICILIO (Móvil)' : clinic.business_model === 'hybrid' ? 'HÍBRIDO (Local y Domicilio)' : 'FÍSICO (Local fijo)'}

${clinic.business_model === 'mobile' || clinic.business_model === 'hybrid' ? ` REGLAS CLÍNICA MÓVIL:
- Obligatorio: Solicitar la DIRECCIÓN del paciente antes de confirmar disponibilidad.
- Usa la dirección en 'check_availability' cuando la tengas.
- No digas "estamos cerca", di "revisaré el cupo más próximo para su zona".` : ''}
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

⚠️ MODO SIMULADOR: Estás en modo de prueba dentro de la app. Responde EXACTAMENTE como lo harías en WhatsApp real. Las citas que agendes aquí serán reales y aparecerán en el calendario. El número del paciente es simulado.

REGLAS DE ORO DE CONVERSACIÓN (HUMANO PASO A PASO):
1. **MÁXIMO UNA PREGUNTA POR TURNO (ESTRICTO)**: Está TERMINANTEMENTE PROHIBIDO hacer más de una pregunta en un solo mensaje o usar el signo "?" más de una vez. Si necesitas 3 datos, pídelos en 3 turnos distintos. NUNCA pidas el sector, la edad y el nombre al mismo tiempo.
2. **TRIAGE SECUENCIAL**: Antes de dar precios o recomendar servicios, debes identificar plenamente el caso. Sigue este orden de descubrimiento:
   a) Saludo amable y empático.
   b) Nombre de la mascota y especie (¿es perro o gato?).
   c) Edad exacta (esto es vital para las vacunas).
   d) Motivo de la consulta o historial previo (¿qué vacunas tiene ya?).
3. **NO DES PRECIOS SIN CONTEXTO**: Si preguntan "¿cuánto vale una vacuna?", NO respondas con la lista de precios. Responde: "¡Hola! Con gusto te ayudo. Para darte el valor exacto y ver qué le corresponde, ¿cómo se llama tu mascota y qué edad tiene?". Solo da el precio de la opción específica que necesita una vez completado el triage.
4. **EMPATÍA VETERINARIA**: Usa un tono cálido, profesional y cuidadoso. Eres un asistente de salud animal, no un bot de ventas. Trata a la mascota por su nombre una vez lo sepas.

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
   a) Ofrecer Slots: Llama a 'check_availability', muestra opciones y menciona el abono de $10.000.
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
        const targetModel = clinic.ai_active_model === 'mini' ? 'gpt-4o-mini' : 'gpt-4o';
        let res = await callOpenAI(openaiKey, targetModel, msgs);
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
            res = await callOpenAI(openaiKey, targetModel, msgs);
            assistant = res.choices[0].message;
            loopCount++;
        }

        const reply = assistant.content || "No pude generar una respuesta.";

        return new Response(JSON.stringify({
            reply,
            tools_used: loopCount,
            model: targetModel
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
