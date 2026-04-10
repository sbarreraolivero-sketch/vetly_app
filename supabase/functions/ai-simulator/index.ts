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
        description: "Verifica disponibilidad de horarios. Infiere el servicio de la conversación. Es MANDATORIO pasar la 'address' para validar tiempos de viaje.",
        parameters: { 
            type: "object", 
            properties: { 
                date: { type: "string", description: "Fecha YYYY-MM-DD" }, 
                service_name: { type: "string", description: "Nombre del servicio" }, 
                address: { type: "string", description: "Ciudad o zona de atención (Talca, Linares, etc.)" },
                professional_name: { type: "string", description: "Nombre del profesional (opcional)" } 
            }, 
            required: ["date", "address"] 
        }
    },
    {
        name: "create_appointment",
        description: "Crea nueva cita cuando paciente confirma fecha, hora y servicio",
        parameters: { 
            type: "object", 
            properties: { 
                patient_name: { type: "string", description: "Nombre de la mascota" }, 
                date: { type: "string" }, 
                time: { type: "string" }, 
                service_name: { type: "string" }, 
                address: { type: "string", description: "Dirección completa de atención (Calle, Número, Referencias)" },
                professional_name: { type: "string", description: "Profesional solicitado (opcional)" } 
            }, 
            required: ["patient_name", "date", "time", "service_name", "address"] 
        }
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

const checkAvail = async (sb: ReturnType<typeof createClient>, clinicId: string, date: string, serviceName?: string, timezone: string = "America/Santiago", professionalName?: string, clinicWorkingHours?: any, address?: string) => {
    try {
        const searchInterval = 30; 
        let duration = 60; 
        let serviceId: string | null = null;
        let professionalId: string | null = null;

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
        if (professionalNameTrimmed) {
            const { data: prof } = await sb.from("clinic_members")
                .select("id")
                .eq("clinic_id", clinicId.trim())
                .or(`first_name.ilike.%${professionalNameTrimmed}%,last_name.ilike.%${professionalNameTrimmed}%,job_title.ilike.%${professionalNameTrimmed}%`)
                .limit(1)
                .maybeSingle();
            if (prof) professionalId = prof.id;
        }

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
        }

        let availableSlots = slots.filter(s => s.is_available);
        const now = new Date();
        const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
        const timeParts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
        const currentH = parseInt(timeParts.find(p => p.type === 'hour')?.value || "0");
        const currentM = parseInt(timeParts.find(p => p.type === 'minute')?.value || "0");
        const nowLocalMinutes = currentH * 60 + currentM;

        if (date === localDate) {
            const addressLower = (address || "").toLowerCase();
            const isRemote = ["talca", "maule", "san javier", "villa alegre"].some(z => addressLower.includes(z));
            const bufferMinutes = isRemote ? 120 : 60;
            const cutoffMinutes = nowLocalMinutes + bufferMinutes;
            availableSlots = availableSlots.filter((s: { slot_time: string }) => {
                const [h, m] = s.slot_time.split(":").map(Number);
                const slotMinutes = h * 60 + m;
                return slotMinutes >= cutoffMinutes;
            });
        }

        // ==========================================
        // SMART ROUTING LOGIC
        // ==========================================
        const { data: dayApptsSummary } = await sb.from("appointments")
            .select("address, status")
            .eq("clinic_id", clinicId)
            .gte("appointment_date", `${date}T00:00:00`)
            .lte("appointment_date", `${date}T23:59:59`)
            .neq("status", "cancelled");

        const activeZones = [...new Set((dayApptsSummary || []).map((a: any) => {
            const addr = (a.address || "").toLowerCase();
            if (addr.includes("talca")) return "Talca";
            if (addr.includes("maule")) return "Maule";
            if (addr.includes("san javier")) return "San Javier";
            if (addr.includes("villa alegre")) return "Villa Alegre";
            return "Linares";
        }))];

        const addressLower = (address || "").toLowerCase();
        const isTalcaZone = ["talca", "maule", "san javier", "villa alegre"].some(z => addressLower.includes(z));
        const currentZone = isTalcaZone ? "Talca" : "Linares";

        const d = new Date(date + 'T12:00:00');
        const dayBefore = new Intl.DateTimeFormat("en-CA").format(new Date(d.getTime() - 86400000));
        const dayAfter = new Intl.DateTimeFormat("en-CA").format(new Date(d.getTime() + 86400000));

        const { data: neighborAppts } = await sb.from("appointments")
            .select("address, appointment_date")
            .in("appointment_date", [
                `${dayBefore}T00:00:00`, `${dayBefore}T23:59:59`,
                `${dayAfter}T00:00:00`, `${dayAfter}T23:59:59`
            ])
            .neq("status", "cancelled");

        const hasTalcaYesterday = (neighborAppts || []).some((a: any) => 
            a.appointment_date.startsWith(dayBefore) && 
            ["talca", "maule", "san javier", "villa alegre"].some(z => (a.address || "").toLowerCase().includes(z))
        );
        const hasTalcaTomorrow = (neighborAppts || []).some((a: any) => 
            a.appointment_date.startsWith(dayAfter) && 
            ["talca", "maule", "san javier", "villa alegre"].some(z => (a.address || "").toLowerCase().includes(z))
        );

        const hasTalcaToday = activeZones.includes("Talca") || activeZones.includes("Maule");
        const hasLinaresToday = activeZones.includes("Linares") && activeZones.length === 1;

        let suggestionsContext = "";
        if (isTalcaZone) {
            if ((hasTalcaYesterday || hasTalcaTomorrow) && !hasTalcaToday) {
                suggestionsContext = "⚠️ (Nota interna para el agente: Normalmente vamos a Talca día por medio. Ayer o mañana ya tenemos ruta en Talca. Intenta proponer el día siguiente o anterior si es posible para mantener el patrón). ";
            }
            if (hasLinaresToday && !hasTalcaToday) {
                suggestionsContext = "⚠️ (Nota interna: Ya hay citas en Linares este día. Sumar Talca implica mucho viaje). ";
            }
        }

        const dayContext = activeZones.length > 0 ? `Ruta confirmada en: ${activeZones.join(", ")}.` : "Día sin rutas aún.";

        const formattedSlots = availableSlots.map(s => {
            const [h, m] = s.slot_time.split(":").map(Number);
            const isBaseTime = h < 10 || h >= 18;
            let slotLabel = (isTalcaZone && isBaseTime) ? " (Linares base)" : "";
            const timeStr = `${h > 12 ? h - 12 : h === 0 ? 12 : h}:${m.toString().padStart(2, '0')} ${h >= 12 ? "PM" : "AM"}`;
            return `${timeStr}${slotLabel}`;
        });

        if (availableSlots.length === 0) return { available: false, message: `Lamentablemente no hay cupos para ${currentZone} el ${date}.` };

        const displaySlots = formattedSlots.slice(0, 15);
        return {
            available: true,
            date,
            slots: displaySlots,
            message: `Para el ${date} en ${currentZone}, tenemos: ${displaySlots.join(", ")}. ${dayContext} ${suggestionsContext}`
        };
    } catch (e) {
        return { error: "Error técnico al verificar horarios." };
    }
};

const createAppt = async (sb: ReturnType<typeof createClient>, clinicId: string, simulatedPhone: string, args: any, timezone: string) => {
    try {
        let price = 0; let duration = 60;
        const { data: realServices } = await sb.from("clinic_services").select("name, duration, price").eq("clinic_id", clinicId);
        if (realServices && realServices.length > 0) {
            const svc = realServices.find((s: any) => s.name.toLowerCase().includes(args.service_name?.toLowerCase() || ""));
            if (svc) { price = svc.price || 0; duration = svc.duration || 60; }
        }

        let normalizedTime = args.time.replace(/[^\d:apmAPM\s]/g, '').trim();
        if (normalizedTime.toLowerCase().includes('pm') || normalizedTime.toLowerCase().includes('am')) {
            const isPM = normalizedTime.toLowerCase().includes('pm');
            let [h, m] = normalizedTime.replace(/[apmAPM\s]/g, '').split(':').map(Number);
            if (isPM && h < 12) h += 12;
            if (!isPM && h === 12) h = 0;
            normalizedTime = `${h.toString().padStart(2, '0')}:${(m || 0).toString().padStart(2, '0')}`;
        } else {
            const parts = normalizedTime.split(':');
            normalizedTime = `${parts[0].padStart(2, '0')}:${(parts[1] || '00').padStart(2, '0')}`;
        }

        const offset = getOffset(timezone, new Date(`${args.date}T12:00:00`));
        const appointmentDateWithOffset = `${args.date}T${normalizedTime}:00${offset}`;

        const { data: tutorInfo } = await sb.from("crm_prospects").select("full_name, address").eq("clinic_id", clinicId).eq("phone", simulatedPhone).limit(1).maybeSingle();

        const { data, error } = await sb.from("appointments").insert({
            clinic_id: clinicId,
            patient_name: args.patient_name,
            tutor_name: tutorInfo?.full_name || null,
            phone_number: simulatedPhone,
            address: args.address || tutorInfo?.address || "No especificada",
            service: args.service_name,
            appointment_date: appointmentDateWithOffset,
            duration: duration,
            price: price,
            status: "pending",
            payment_status: "pending"
        }).select("id").single();

        if (error) return { success: false, message: "Error al registrar la cita." };

        return {
            success: true,
            appointment_id: data?.id,
            message: `✅ Cita agendada: ${args.patient_name} el ${args.date} a las ${args.time} para ${args.service_name}.`
        };
    } catch (e: any) {
        return { success: false, message: "Error técnico al crear cita." };
    }
};

const getServices = async (sb: ReturnType<typeof createClient>, clinicId: string) => {
    const { data: realServices } = await sb.from("clinic_services").select("name, duration, price").eq("clinic_id", clinicId);
    if (realServices && realServices.length > 0) {
        const services = realServices.map(s => ({ name: s.name, duration: `${s.duration} min`, price: `$${s.price.toLocaleString('es-CL')}` }));
        return { services, message: "Estos son los servicios y precios disponibles." };
    }
    const { data } = await sb.from("clinic_settings").select("services").eq("id", clinicId).single();
    return { services: data?.services || [], message: "Servicios disponibles." };
};

const getKnowledge = async (sb: ReturnType<typeof createClient>, clinicId: string, query: string) => {
    try {
        const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        let queryBuilder = sb.from("knowledge_base").select("title, content, category").eq("clinic_id", clinicId).eq("status", "active");
        if (keywords.length > 0) {
            const orFilters = keywords.flatMap(kw => [`title.ilike.%${kw}%`,`content.ilike.%${kw}%`,`category.ilike.%${kw}%`]).join(',');
            queryBuilder = queryBuilder.or(orFilters);
        }
        const { data: docs } = await queryBuilder.limit(5);
        if (!docs || docs.length === 0) return { found: false, message: "No encontré información específica." };
        const results = docs.map((d: any) => `📄 ${d.title} (${d.category}):\n${d.content}`).join("\n\n---\n\n");
        return { found: true, message: results };
    } catch (e) { return { found: false, message: "Error en base de conocimiento." }; }
};

const tagPatient = async (sb: ReturnType<typeof createClient>, clinicId: string, phone: string, args: { tag_name: string; tag_color?: string }) => {
    try {
        const tagName = args.tag_name.trim();
        const { data: existingTag } = await sb.from("tags").select("id").eq("clinic_id", clinicId).ilike("name", tagName).maybeSingle();
        let tagId = existingTag?.id;
        if (!tagId) {
            const { data: newTag } = await sb.from("tags").insert({ clinic_id: clinicId, name: tagName, color: args.tag_color || "#3B82F6" }).select("id").single();
            tagId = newTag?.id;
        }
        const { data: patient } = await sb.from("patients").select("id").eq("clinic_id", clinicId).eq("phone_number", phone).maybeSingle();
        if (patient) {
            await sb.from("patient_tags").upsert({ patient_id: patient.id, tag_id: tagId });
            return { success: true, message: "Etiqueta asignada." };
        }
        return { success: false, message: "Paciente no encontrado." };
    } catch (e) { return { success: false, message: "Error al etiquetar." }; }
};

const processFunc = async (sb: ReturnType<typeof createClient>, clinicId: string, simulatedPhone: string, funcName: string, args: any, timezone: string, clinic?: any) => {
    switch (funcName) {
        case "check_availability": return checkAvail(sb, clinicId, args.date, args.service_name, timezone, args.professional_name, clinic?.working_hours, args.address);
        case "create_appointment": return createAppt(sb, clinicId, simulatedPhone, args, timezone);
        case "get_services": return getServices(sb, clinicId);
        case "get_knowledge": return getKnowledge(sb, clinicId, args.query);
        case "tag_patient": return tagPatient(sb, clinicId, simulatedPhone, args);
        default: return { message: `Función ${funcName} no disponible.` };
    }
};

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
    return r.json();
};

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    try {
        const { clinic_id, message, conversation_history } = await req.json();
        const sb = getSupabase();
        const { data: clinic } = await sb.from("clinic_settings").select("*").eq("id", clinic_id).single();
        if (!clinic) return new Response("Clínica no encontrada", { status: 404, headers: corsHeaders });

        const openaiKey = Deno.env.get("OPENAI_API_KEY") || "";
        const clinicTz = clinic.timezone || "America/Santiago";
        const now = new Date();
        const localDateISO = now.toLocaleDateString("en-CA", { timeZone: clinicTz });
        
        const msgs: Msg[] = [{ role: "system", content: `${clinic.ai_personality}\n\nHoy es ${localDateISO}` }];
        if (conversation_history) conversation_history.forEach((m: any) => msgs.push({ role: m.sender === 'user' ? 'user' : 'assistant', content: m.text }));
        msgs.push({ role: "user", content: message });

        const targetModel = clinic.ai_active_model === 'mini' ? 'gpt-4o-mini' : 'gpt-4o';
        let res = await callOpenAI(openaiKey, targetModel, msgs);
        let assistant = res.choices[0].message;
        
        let loopCount = 0;
        while (assistant.function_call && loopCount < 5) {
            const result = await processFunc(sb, clinic_id, "+56900000000", assistant.function_call.name, JSON.parse(assistant.function_call.arguments), clinicTz, clinic);
            msgs.push({ role: "assistant", content: "", function_call: assistant.function_call });
            msgs.push({ role: "function", name: assistant.function_call.name, content: JSON.stringify(result) });
            res = await callOpenAI(openaiKey, targetModel, msgs);
            assistant = res.choices[0].message;
            loopCount++;
        }

        return new Response(JSON.stringify({ reply: assistant.content || "Sin respuesta", tools_used: loopCount }), { headers: corsHeaders });
    } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
    }
});
