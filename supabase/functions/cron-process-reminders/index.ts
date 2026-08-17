import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2"
import { limitsForPlan } from "../_shared/planLimits.ts"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    const log = []

    try {
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        log.push('Starting cron-process-reminders')

        // Helper: ¿la clínica tiene un canal de envío configurado? (YCloud o Meta Cloud API)
        const hasYCloudChannel = (clinic: any) => !!clinic?.ycloud_api_key && !!clinic?.ycloud_phone_number
        const hasMetaChannel = (clinic: any) =>
            clinic?.whatsapp_provider === 'meta' && !!clinic?.meta_access_token && !!clinic?.meta_phone_number_id && !!clinic?.meta_waba_id
        const hasAnyChannel = (clinic: any) => hasYCloudChannel(clinic) || hasMetaChannel(clinic)

        // Helper: Fetch template variable counts (YCloud o Meta, cacheado por clínica)
        const tplVarCache: Record<string, Record<string, number>> = {}
        const getVarCount = async (clinic: any, tplName: string): Promise<number> => {
            const cId = clinic.id
            if (!tplVarCache[cId]) {
                try {
                    let items: any[] = []
                    if (hasMetaChannel(clinic)) {
                        const res = await fetch(`https://graph.facebook.com/v21.0/${clinic.meta_waba_id}/message_templates?fields=name,components&limit=200`, {
                            headers: { 'Authorization': `Bearer ${clinic.meta_access_token}` }
                        })
                        const d = await res.json()
                        items = d.data || []
                    } else {
                        const res = await fetch('https://api.ycloud.com/v2/whatsapp/templates?limit=100', {
                            headers: { 'X-API-Key': clinic.ycloud_api_key }
                        })
                        const d = await res.json()
                        items = d.items || []
                    }
                    const m: Record<string, number> = {}
                    for (const t of items) {
                        const body = t.components?.find((c: any) => c.type === 'BODY')
                        const matches = body?.text?.match(/\{\{\d+\}\}/g)
                        m[t.name] = matches ? matches.length : 0
                    }
                    tplVarCache[cId] = m
                } catch { tplVarCache[cId] = {} }
            }
            return tplVarCache[cId][tplName] ?? 5
        }

        // Helper: envía un mensaje de plantilla por el canal correcto (YCloud o Meta Cloud API).
        // Normaliza la respuesta a { ok, id, raw } para que el resto del código no necesite
        // saber por qué canal se envió — el id de Meta viene en raw.messages[0].id en vez
        // de raw.id (formato YCloud).
        const sendReminderTemplate = async (
            clinic: any, to: string, tplName: string, params: any[]
        ): Promise<{ ok: boolean; id: string | null; raw: any }> => {
            if (hasMetaChannel(clinic)) {
                const res = await fetch(`https://graph.facebook.com/v21.0/${clinic.meta_phone_number_id}/messages`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${clinic.meta_access_token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messaging_product: 'whatsapp',
                        to,
                        type: 'template',
                        template: {
                            name: tplName,
                            language: { code: 'es' },
                            components: params.length > 0 ? [{ type: 'body', parameters: params }] : []
                        }
                    })
                })
                const raw = await res.json().catch(() => ({}))
                return { ok: res.ok, id: raw?.messages?.[0]?.id ?? null, raw }
            }

            const res = await fetch('https://api.ycloud.com/v2/whatsapp/messages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-API-Key': clinic.ycloud_api_key },
                body: JSON.stringify({
                    from: clinic.ycloud_phone_number,
                    to,
                    type: 'template',
                    template: {
                        name: tplName,
                        language: { code: 'es' },
                        components: params.length > 0 ? [{ type: 'body', parameters: params }] : []
                    }
                })
            })
            const raw = await res.json().catch(() => ({}))
            return { ok: res.ok, id: raw?.id ?? null, raw }
        }

        // Meta rechaza cualquier plantilla con un parámetro de texto vacío
        // (errorCode 131008: "Parameter of type text is missing text value").
        // Por eso NUNCA se envía una cadena vacía o solo-espacios: cada parámetro
        // cae a un fallback seguro no vacío.
        const safeParam = (val: string | null | undefined, fallback: string): { type: 'text'; text: string } => {
            const clean = (val ?? '').toString().trim()
            return { type: 'text', text: clean !== '' ? clean : fallback }
        }
        const mkParams = (n: number, pName: string, svc: string, dt: string, tm: string, cName: string) => {
            const all = [
                safeParam(pName, 'tu mascota'),
                safeParam(svc, 'tu visita'),
                safeParam(dt, 'la fecha agendada'),
                safeParam(tm, 'la hora agendada'),
                safeParam(cName, 'la clínica'),
            ]
            return n > 0 ? all.slice(0, n) : all
        }

        // Límite efectivo del pool de recordatorios (citas + médicos comparten el mismo pool).
        // null = ilimitado (Enterprise). Si hay límite, se le suma el balance de packs comprados este mes.
        const effectiveLimit = (sub: any): number | null => {
            const limit = sub?.monthly_reminders_limit
            if (limit === null || limit === undefined) return null
            return limit + (sub?.reminders_pack_balance || 0)
        }
        const pickSub = (subArray: any): any => Array.isArray(subArray) ? subArray[0] : subArray

        // 1. Fetch all clinics with 24h reminders enabled
        // We join with clinic_settings to get keys and timezone
        const { data: settingsList, error: settingsError } = await supabaseClient
            .from('reminder_settings')
            .select(`
                *,
                clinic_settings!inner (
                    id,
                    clinic_name,
                    timezone,
                    ycloud_api_key,
                    ycloud_phone_number,
                    whatsapp_provider,
                    meta_access_token,
                    meta_phone_number_id,
                    meta_waba_id,
                    subscriptions (
                        monthly_reminders_limit,
                        monthly_reminders_used,
                        reminders_pack_balance
                    )
                )
            `)
            .eq('reminder_24h_before', true)

        if (settingsError) {
            throw new Error(`Error fetching settings: ${settingsError.message}`)
        }

        log.push(`Found ${settingsList?.length || 0} clinics with reminders enabled`)

        const results = []

        // 2. Process each clinic
        for (const settings of (settingsList || [])) {
            const clinic = settings.clinic_settings

            // Skip if no channel configured (ni YCloud ni Meta)
            if (!hasAnyChannel(clinic)) {
                results.push({ clinicId: settings.clinic_id, status: 'skipped', reason: 'No hay canal de envío configurado (YCloud o Meta)' })
                continue
            }

            // Check Limits (pool compartido citas + médicos)
            const sub = pickSub(clinic?.subscriptions || [])
            const effLimit = effectiveLimit(sub)
            let poolUsed = sub?.monthly_reminders_used || 0

            if (effLimit !== null && poolUsed >= effLimit) {
                results.push({ clinicId: settings.clinic_id, status: 'skipped', reason: 'Monthly reminder limit reached' })
                continue
            }

            // 3. Timezone Check
            const timeZone = clinic.timezone || 'America/Santiago'
            const now = new Date()

            // Get current clinic time
            const clinicNow = new Date(now.toLocaleString('en-US', { timeZone }))
            const currentHour = clinicNow.getHours()

            // Get preferred hour (format "HH:MM")
            const [prefHourStr] = (settings.preferred_hour || '09:00').split(':')
            const prefHour = parseInt(prefHourStr)

            // Check: run if current hour is >= preferred hour.
            // This ensures we start sending at the preferred hour, but also catch any appointments created after it.
            if (currentHour < prefHour) {
                continue
            }

            log.push(`Processing clinic ${clinic.clinic_name} (${clinic.id}) at clinic hour ${currentHour}`)

            // 4. Calculate "Tomorrow" in clinic's timezone
            // IMPORTANT: Do NOT use toISOString() here — it always returns UTC.
            // We must compute tomorrow's date in the clinic's local timezone.
            const nowForTomorrow = new Date()
            const tomorrowUTC = new Date(nowForTomorrow.getTime() + 24 * 60 * 60 * 1000)
            const tomorrowStr = tomorrowUTC.toLocaleDateString('en-CA', { timeZone }) // YYYY-MM-DD in clinic TZ

            // 5. Fetch Appointments
            // We fetch a bit loosely and filter in JS to be safe with timezone comparisons if needed,
            // but simplified ISO string comparison usually works if we assume the appointment_date is stored absolutely.
            // Wait, appointment_date is TIMESTAMPTZ.
            // Query: appointment_date >= tomorrowStr 00:00 (Clinic Time) AND < next day.
            // Since we don't have easy timezone conversion in query helper without RPC,
            // we'll fetch wider range (UTC match)

            const startRange = `${tomorrowStr}T00:00:00`
            const endRange = `${tomorrowStr}T23:59:59`

            // Note: This comparison compares UTC string to TIMESTAMPTZ.
            // If tomorrowStr is '2026-02-14', startRange is '2026-02-14T00:00:00'.
            // If clinic is UTC-6, 00:00 there is 06:00 UTC.
            // The query `.gte('appointment_date', startRange)` uses the server timezone (UTC) if no offset provided.
            // Ideally we pass the offset, but we don't know it easily here without a library.
            // FALLBACK: Fetch all active appointments for this clinic created recently? No that's inefficient.
            // WORKAROUND: Fetch all appointments for the next 48h and filter in JS using timezone.

            const nowUTC = new Date()
            const next48h = new Date(nowUTC.getTime() + 48 * 60 * 60 * 1000)

            const { data: appointments, error: apptError } = await supabaseClient
                .from('appointments')
                .select('*')
                .eq('clinic_id', clinic.id)
                .in('status', ['pending', 'confirmed'])
                .eq('reminder_sent', false)
                .not('patient_name', 'ilike', '%bloqueo%')
                .not('phone_number', 'eq', '000000000')
                .gte('appointment_date', nowUTC.toISOString())
                .lt('appointment_date', next48h.toISOString())

            if (apptError) {
                console.error('Error fetching appointments', apptError)
                continue
            }

            let sentCount = 0

            for (const appt of (appointments || [])) {
                // 5.1 Skip "Bloqueo de Agenda" or invalid numbers
                const isBlock = (appt.patient_name || '').toLowerCase().includes('bloqueo') ||
                                (appt.phone_number || '').includes('000000000') ||
                                !appt.phone_number ||
                                appt.phone_number.replace(/\D/g, '').length < 7;

                if (isBlock) {
                    continue;
                }

                // Verify date in clinic timezone
                const apptDate = new Date(appt.appointment_date)
                const apptDateStr = apptDate.toLocaleDateString('en-CA', { timeZone }) // YYYY-MM-DD matches tomorrowStr?

                if (apptDateStr !== tomorrowStr) {
                    continue
                }

                const { data: existingLog24h } = await supabaseClient
                    .from('reminder_logs').select('id')
                    .eq('appointment_id', appt.id).eq('type', '24h').limit(1)
                if (existingLog24h && existingLog24h.length > 0) continue

                // Corte por límite a mitad del loop
                if (effLimit !== null && poolUsed >= effLimit) break

                try {
                    const formattedDate = apptDate.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone })
                    const formattedTime = apptDate.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone })

                    let tplName = settings.template_24h || '24hrs_recordatorio_cita'
                    if (settings.request_confirmation && settings.template_confirmation && appt.status === 'pending') {
                        tplName = settings.template_confirmation
                    }

                    const vc24 = await getVarCount(clinic, tplName)
                    const params24 = mkParams(vc24, appt.patient_name, appt.service || 'consulta', formattedDate, formattedTime, clinic.clinic_name)

                    const { ok, id: sentId, raw: responseData } = await sendReminderTemplate(clinic, appt.phone_number, tplName, params24)

                    if (!ok) {
                        await supabaseClient.from('reminder_logs').insert({
                            clinic_id: clinic.id,
                            appointment_id: appt.id,
                            type: '24h',
                            phone_number: appt.phone_number,
                            status: 'failed',
                            error_message: JSON.stringify(responseData)
                        });
                        continue
                    }

                    const reminderText = `Hola 👋 esperamos que te encuentres muy bien!\nTe enviamos este mensaje para recordar la visita a domicilio de *${appt.patient_name || 'tu mascota'}* programada para mañana a las *${formattedTime}* hrs.\n\nPor favor confírmanos tu asistencia o infórmanos si necesitas reprogramar.`;

                    // Log to DB messages (audit trail — columnas reales: status, payload)
                    const { error: msgErr24 } = await supabaseClient.from('messages').insert({
                        clinic_id: clinic.id,
                        phone_number: appt.phone_number,
                        direction: 'outbound',
                        content: reminderText,
                        ycloud_message_id: sentId,
                        status: 'sent',
                        ai_generated: false,
                        payload: { type: 'system_reminder_24h' }
                    })
                    if (msgErr24) console.error('[reminders][24h] messages insert failed', msgErr24)

                    // Log to reminder_logs (new) — guardamos el ID del mensaje (YCloud o Meta) para que
                    // el webhook pueda actualizar el estado real de entrega después.
                    await supabaseClient.from('reminder_logs').insert({
                        clinic_id: clinic.id,
                        appointment_id: appt.id,
                        type: '24h',
                        phone_number: appt.phone_number,
                        status: 'sent',
                        ycloud_message_id: sentId,
                        sent_at: new Date().toISOString()
                    });

                    // Mark appointment
                    await supabaseClient.from('appointments').update({
                        reminder_sent: true,
                        reminder_sent_at: new Date().toISOString()
                    }).eq('id', appt.id)

                    // Increment usage
                    await supabaseClient.rpc('increment_subscription_usage', {
                        column_name: 'monthly_reminders_used',
                        clinic_uuid: clinic.id
                    })
                    poolUsed++

                    sentCount++

                } catch (err) {
                    console.error('Error processing appointment', appt.id, err)
                }
            }

            results.push({ clinicId: clinic.id, sent24h: sentCount })
        }

        // ==========================================
        // PART 2: 2-Hour Reminders
        // ==========================================

        // 1. Fetch clinics with 2h reminders enabled
        const { data: earlySettingsList, error: earlyError } = await supabaseClient
            .from('reminder_settings')
            .select(`
                *,
                clinic_settings!inner (
                    id,
                    clinic_name,
                    timezone,
                    ycloud_api_key,
                    ycloud_phone_number,
                    whatsapp_provider,
                    meta_access_token,
                    meta_phone_number_id,
                    meta_waba_id,
                    subscriptions (
                        plan,
                        plan_id,
                        manually_active,
                        monthly_reminders_limit,
                        monthly_reminders_used,
                        reminders_pack_balance
                    )
                )
            `)
            .eq('reminder_2h_before', true)

        if (!earlyError && earlySettingsList?.length > 0) {
            log.push(`Found ${earlySettingsList.length} clinics with 2h reminders enabled`)

            for (const settings of earlySettingsList) {
                const clinic = settings.clinic_settings
                if (!hasAnyChannel(clinic)) continue

                // Check Limits (pool compartido citas + médicos)
                const sub = pickSub(clinic?.subscriptions || [])

                // El recordatorio de 2h existe desde Starter: Core solo tiene el de
                // 24h, que es el que evita el no-show. El toggle está bloqueado en la
                // UI, pero la API es alcanzable — el corte real va aquí.
                if (!sub?.manually_active) {
                    const planLimits = await limitsForPlan(supabaseClient, sub?.plan_id || sub?.plan)
                    if (!planLimits.allows_2h_reminder) {
                        log.push(`Skipping 2h for ${clinic.clinic_name}: plan sin recordatorio de 2h`)
                        continue
                    }
                }

                const effLimit = effectiveLimit(sub)
                let poolUsed = sub?.monthly_reminders_used || 0

                if (effLimit !== null && poolUsed >= effLimit) {
                    continue
                }

                const timeZone = clinic.timezone || 'America/Santiago'
                const now = new Date()

                // Calculate target time: Now + 2 hours
                // We check a window around it.
                // Since cron runs every hour at :00, we look for appointments scheduled between [Now+2h, Now+3h)?
                // Or simply: appointments starting in the hour of (CurrentHour + 2)

                // Get current hour in clinic's timezone
                const formatter = new Intl.DateTimeFormat('en-US', {
                    timeZone,
                    hour: 'numeric',
                    hour12: false,
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                })

                // We need to construct the timestamp range for "2 hours from now"
                // Example: It's 10:00. We want appointments at 12:00.
                // We fetch appointments strictly for that hour slot.

                // Helper to add hours in a specific timezone is tricky without libraries.
                // Workaround: Use the ISO string of the appointment and check its hour in the clinic timezone.

                const nowUTC = new Date()
                const startSearch = new Date(nowUTC.getTime() + 90 * 60 * 1000) // +1.5h
                const endSearch = new Date(nowUTC.getTime() + 150 * 60 * 1000)   // +2.5h (Allowing some buffer)

                // Actually, best semantic match: "2 hours before".
                // If appt is at 14:00, send at 12:00.
                // So at 12:00 cron run, we look for appts at 14:00.

                // Current clinic time
                const clinicDate = new Date(new Date().toLocaleString('en-US', { timeZone }))
                clinicDate.setHours(clinicDate.getHours() + 2) // Target Hour

                const targetHour = clinicDate.getHours()
                const targetDateStr = clinicDate.toLocaleDateString('en-CA') // YYYY-MM-DD

                // Fetch appointments for that day, then filter by hour
                // Fetch window: Now + 1h to Now + 3h to be safe

                const { data: appointments, error: apptError } = await supabaseClient
                    .from('appointments')
                    .select('*')
                    .eq('clinic_id', clinic.id)
                    .in('status', ['pending', 'confirmed'])
                    .not('patient_name', 'ilike', '%bloqueo%')
                    .not('phone_number', 'eq', '000000000')
                    .gte('appointment_date', startSearch.toISOString())
                    .lt('appointment_date', endSearch.toISOString())

                if (apptError) continue

                let sentCount = 0

                for (const appt of (appointments || [])) {
                    const isBlock = (appt.patient_name || '').toLowerCase().includes('bloqueo') ||
                                    (appt.phone_number || '').includes('000000000') ||
                                    !appt.phone_number ||
                                    appt.phone_number.replace(/\D/g, '').length < 7;

                    if (isBlock) {
                        continue;
                    }

                    const { data: existingLog2h } = await supabaseClient
                        .from('reminder_logs').select('id')
                        .eq('appointment_id', appt.id).eq('type', '2h').limit(1)
                    if (existingLog2h && existingLog2h.length > 0) continue

                    // Strict Hour Check in Clinic Timezone
                    const apptDate = new Date(appt.appointment_date)
                    const apptHour = parseInt(apptDate.toLocaleTimeString('en-US', { hour: 'numeric', hour12: false, timeZone }))

                    if (apptHour !== targetHour) continue

                    // Corte por límite a mitad del loop
                    if (effLimit !== null && poolUsed >= effLimit) break

                    // SEND WHATSAPP (Reused logic - copy paste for safety in this constrained env)
                    try {
                        const formattedDate = apptDate.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone })
                        const formattedTime = apptDate.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone })

                        let tplName2h = settings.template_2h || '2hrs_recordatorio_cita'
                        if (settings.request_confirmation && settings.template_confirmation && appt.status === 'pending') {
                            tplName2h = settings.template_confirmation
                        }

                        const vc2h = await getVarCount(clinic, tplName2h)
                        const params2h = mkParams(vc2h, appt.patient_name, appt.service || 'consulta', formattedDate, formattedTime, clinic.clinic_name)

                        const { ok, id: sentId, raw: responseData } = await sendReminderTemplate(clinic, appt.phone_number, tplName2h, params2h)

                        if (ok) {
                            const reminderText = `Hola 👋 esperamos que te encuentres muy bien!\nTe enviamos este mensaje para recordar la visita a domicilio de *${appt.patient_name || 'tu mascota'}* programada para hoy a las *${formattedTime}* hrs.\n\nPor favor confírmanos tu asistencia o infórmanos si necesitas reprogramar.`;

                            const { error: msgErr2h } = await supabaseClient.from('messages').insert({
                                clinic_id: clinic.id,
                                phone_number: appt.phone_number,
                                direction: 'outbound',
                                content: reminderText,
                                ycloud_message_id: sentId,
                                status: 'sent',
                                ai_generated: false,
                                payload: { type: 'system_reminder_2h' }
                            })
                            if (msgErr2h) console.error('[reminders][2h] messages insert failed', msgErr2h)
                            await supabaseClient.from('reminder_logs').insert({
                                clinic_id: clinic.id,
                                appointment_id: appt.id,
                                type: '2h',
                                phone_number: appt.phone_number,
                                status: 'sent',
                                ycloud_message_id: sentId,
                                sent_at: new Date().toISOString()
                            });
                            await supabaseClient.from('appointments').update({
                                reminder_sent: true,
                                reminder_sent_at: new Date().toISOString()
                            }).eq('id', appt.id)

                            // Increment usage
                            await supabaseClient.rpc('increment_subscription_usage', {
                                column_name: 'monthly_reminders_used',
                                clinic_uuid: clinic.id
                            })
                            poolUsed++

                            sentCount++
                        } else {
                            await supabaseClient.from('reminder_logs').insert({
                                clinic_id: clinic.id,
                                appointment_id: appt.id,
                                type: '2h',
                                phone_number: appt.phone_number,
                                status: 'failed',
                                error_message: JSON.stringify(responseData)
                            });
                        }
                    } catch (e) {
                        console.error(e)
                    }
                }
                results.push({ clinicId: clinic.id, sent2h: sentCount })
            }
        }


        // ==========================================
        // PART 4: General Reminders (Vaccination, Deworming)
        // ==========================================

        log.push('Starting PART 4: General Reminders')

        // Fetch all clinics to process their manual reminders
        const { data: allClinics, error: allClinicsError } = await supabaseClient
            .from('clinic_settings')
            .select('id, clinic_name, timezone, ycloud_api_key, ycloud_phone_number, whatsapp_provider, meta_access_token, meta_phone_number_id, meta_waba_id, vaccine_reminder_template, deworming_reminder_template, checkup_reminder_template')

        // Mapa de subscripciones para el check de límite (pool compartido con citas)
        const { data: allSubs } = await supabaseClient
            .from('subscriptions')
            .select('clinic_id, monthly_reminders_limit, monthly_reminders_used, reminders_pack_balance')
        const subMap: Record<string, any> = {}
        for (const s of (allSubs || [])) subMap[s.clinic_id] = s

        // Mapa de hora preferida (mismo campo que usan los recordatorios de citas — reminder_settings.preferred_hour)
        const { data: allRemSettings } = await supabaseClient
            .from('reminder_settings')
            .select('clinic_id, preferred_hour')
        const remSettingsMap: Record<string, any> = {}
        for (const rs of (allRemSettings || [])) remSettingsMap[rs.clinic_id] = rs

        if (allClinicsError) {
            console.error('Error fetching clinics for general reminders', allClinicsError)
        } else {
            for (const clinic of (allClinics || [])) {
                if (!hasAnyChannel(clinic)) continue

                // Check de límite (pool compartido citas + médicos)
                const sub = subMap[clinic.id]
                const effLimit = effectiveLimit(sub)
                let poolUsed = sub?.monthly_reminders_used || 0
                if (effLimit !== null && poolUsed >= effLimit) continue

                const timeZone = clinic.timezone || 'America/Santiago'

                // Hora prudente: no enviar recordatorios médicos antes de la hora preferida de la clínica
                // (evita envíos de madrugada por el catch-up del cron horario).
                const clinicNowForHour = new Date(new Date().toLocaleString('en-US', { timeZone }))
                const currentHour = clinicNowForHour.getHours()
                const [prefHourStrGen] = (remSettingsMap[clinic.id]?.preferred_hour || '09:00').split(':')
                const prefHourGen = parseInt(prefHourStrGen)
                if (currentHour < prefHourGen) continue

                // Calculate "Tomorrow" in clinic timezone
                const clinicNow = new Date(new Date().toLocaleString('en-US', { timeZone }))
                const tomorrowDate = new Date(clinicNow)
                tomorrowDate.setDate(tomorrowDate.getDate() + 1)
                const tomorrowStr = tomorrowDate.toISOString().split('T')[0]

                log.push(`Checking general reminders for clinic ${clinic.clinic_name} on ${tomorrowStr}`)

                // Fetch pending reminders for tomorrow
                // We join with patients and tutors to get necessary info
                const { data: reminders, error: remError } = await supabaseClient
                    .from('reminders')
                    .select(`
                        *,
                        patient:patient_id (
                            name,
                            species
                        ),
                        tutor:tutor_id (
                            phone_number,
                            name
                        )
                    `)
                    .eq('clinic_id', clinic.id)
                    .eq('status', 'pending')
                    .lte('scheduled_date', tomorrowStr)

                if (remError) {
                    console.error('Error fetching general reminders', remError)
                    continue
                }

                log.push(`Found ${reminders?.length || 0} general reminders for ${clinic.clinic_name}`)

                for (const rem of (reminders || [])) {
                    const phoneNumber = rem.tutor?.phone_number
                    const patientName = rem.patient?.name

                    let templateName = rem.whatsapp_template || rem.template_name
                    if (!templateName) {
                        if (rem.type === 'vaccine') {
                            templateName = clinic.vaccine_reminder_template
                        } else if (rem.type === 'deworming') {
                            templateName = clinic.deworming_reminder_template
                        } else {
                            templateName = clinic.checkup_reminder_template
                        }
                    }

                    if (!phoneNumber || !templateName) {
                        await supabaseClient.from('reminders').update({
                            status: 'failed',
                            updated_at: new Date().toISOString()
                        }).eq('id', rem.id)
                        continue
                    }

                    // Corte por límite a mitad del loop (los pendientes restantes quedan para el próximo mes / pack)
                    if (effLimit !== null && poolUsed >= effLimit) break

                    try {
                        const formattedDate = new Date(rem.scheduled_date + 'T12:00:00Z').toLocaleDateString('es-MX', {
                            weekday: 'long', day: 'numeric', month: 'long'
                        })

                        const vcGen = await getVarCount(clinic, templateName)
                        const paramsGen = mkParams(vcGen, patientName || 'Paciente', rem.title || 'servicio', formattedDate, 'Durante el día', clinic.clinic_name)

                        const { ok, id: sentId, raw: responseData } = await sendReminderTemplate(clinic, phoneNumber, templateName, paramsGen)

                        if (ok) {
                            // Mark as sent — guardamos el ID del mensaje (YCloud o Meta) para que el
                            // webhook pueda corregir el estado real de entrega después.
                            await supabaseClient.from('reminders').update({
                                status: 'sent',
                                ycloud_message_id: sentId,
                                updated_at: new Date().toISOString()
                            }).eq('id', rem.id)

                            const reminderText = `Hola 👋\nTe recordamos que es momento de agendar el próximo control/vacuna de *${patientName || 'tu mascota'}*.\n\n¿Deseas que coordinemos una visita?`;

                            const { error: msgErrGen } = await supabaseClient.from('messages').insert({
                                clinic_id: clinic.id,
                                phone_number: phoneNumber,
                                direction: 'outbound',
                                content: reminderText,
                                ycloud_message_id: sentId,
                                status: 'sent',
                                ai_generated: false,
                                payload: { type: 'system_reminder_general' }
                            })
                            if (msgErrGen) console.error('[reminders][general] messages insert failed', msgErrGen)

                            // Increment usage
                            await supabaseClient.rpc('increment_subscription_usage', {
                                column_name: 'monthly_reminders_used',
                                clinic_uuid: clinic.id
                            })
                            poolUsed++
                        } else {
                            await supabaseClient.from('reminders').update({
                                status: 'failed',
                                updated_at: new Date().toISOString()
                            }).eq('id', rem.id)
                        }
                    } catch (err) {
                        console.error('Error sending general reminder', rem.id, err)
                    }
                }
            }
        }

        return new Response(
            JSON.stringify({ success: true, log, results }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        return new Response(
            JSON.stringify({ error: error.message, log }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        )
    }
})
