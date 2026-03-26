
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
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

        // 1. Fetch all clinics with 24h reminders enabled
        // We join with clinic_settings to get keys and timezone
        const { data: settingsList, error: settingsError } = await supabaseClient
            .from('reminder_settings')
            .select(`
                *,
                clinic_settings (
                    id,
                    clinic_name,
                    timezone,
                    ycloud_api_key,
                    ycloud_phone_number
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

            // Skip if no API key
            if (!clinic?.ycloud_api_key) {
                results.push({ clinicId: settings.clinic_id, status: 'skipped', reason: 'No YCloud API Key' })
                continue
            }

            // 3. Timezone Check
            const timeZone = clinic.timezone || 'America/Mexico_City'
            const now = new Date()

            // Get current clinic time
            const clinicNow = new Date(now.toLocaleString('en-US', { timeZone }))
            const currentHour = clinicNow.getHours()

            // Get preferred hour (format "HH:MM")
            const [prefHourStr] = (settings.preferred_hour || '09:00').split(':')
            const prefHour = parseInt(prefHourStr)

            // Strict check: only run if hours match
            if (currentHour !== prefHour) {
                continue
            }

            log.push(`Processing clinic ${clinic.clinic_name} (${clinic.id}) at clinic hour ${currentHour}`)

            // 4. Calculate "Tomorrow" in clinic's timezone
            const tomorrowDate = new Date(clinicNow)
            tomorrowDate.setDate(tomorrowDate.getDate() + 1)
            const tomorrowStr = tomorrowDate.toISOString().split('T')[0] // YYYY-MM-DD

            // 5. Fetch Appointments
            // We fetch a bit loosely and filter in JS to be safe with timestamptz comparisons if needed, 
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
                .gte('appointment_date', nowUTC.toISOString())
                .lt('appointment_date', next48h.toISOString())

            if (apptError) {
                console.error('Error fetching appointments', apptError)
                continue
            }

            let sentCount = 0

            for (const appt of (appointments || [])) {
                // Verify date in clinic timezone
                const apptDate = new Date(appt.appointment_date)
                const apptDateStr = apptDate.toLocaleDateString('en-CA', { timeZone }) // YYYY-MM-DD matches tomorrowStr?

                if (apptDateStr !== tomorrowStr) {
                    continue
                }

                // SEND WHATSAPP
                try {
                    const formattedDate = apptDate.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone })
                    const formattedTime = apptDate.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone })

                    let tplName = settings.template_24h || 'appointment_reminder'
                    if (settings.request_confirmation && settings.template_confirmation && appt.status === 'pending') {
                        tplName = settings.template_confirmation
                    }

                    const messagePayload = {
                        to: appt.phone_number,
                        type: 'template',
                        template: {
                            name: tplName,
                            language: { code: 'es' },
                            components: [
                                {
                                    type: 'body',
                                    parameters: [
                                        { type: 'text', text: appt.patient_name },
                                        { type: 'text', text: appt.service || 'consulta' },
                                        { type: 'text', text: formattedDate },
                                        { type: 'text', text: formattedTime },
                                        { type: 'text', text: clinic.clinic_name }
                                    ]
                                }
                            ]
                        }
                    }

                    const response = await fetch('https://api.ycloud.com/v2/whatsapp/messages', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-API-Key': clinic.ycloud_api_key
                        },
                        body: JSON.stringify(messagePayload)
                    })

                    const responseData = await response.json().catch(() => ({}));

                    if (!response.ok) {
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

                    // Log to DB messages (legacy)
                    await supabaseClient.from('messages').insert({
                        clinic_id: clinic.id,
                        phone_number: appt.phone_number,
                        direction: 'outbound',
                        content: `Recordatorio automático 24h enviado a ${appt.patient_name}`,
                        ycloud_message_id: responseData.id,
                        ycloud_status: 'sent',
                        ai_generated: false
                    })

                    // Log to reminder_logs (new)
                    await supabaseClient.from('reminder_logs').insert({
                        clinic_id: clinic.id,
                        appointment_id: appt.id,
                        type: '24h',
                        phone_number: appt.phone_number,
                        status: 'sent',
                        sent_at: new Date().toISOString()
                    });

                    // Mark appointment
                    await supabaseClient.from('appointments').update({
                        reminder_sent: true,
                        reminder_sent_at: new Date().toISOString()
                    }).eq('id', appt.id)

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
                clinic_settings (
                    id,
                    clinic_name,
                    timezone,
                    ycloud_api_key,
                    ycloud_phone_number
                )
            `)
            .eq('reminder_2h_before', true)

        if (!earlyError && earlySettingsList?.length > 0) {
            log.push(`Found ${earlySettingsList.length} clinics with 2h reminders enabled`)

            for (const settings of earlySettingsList) {
                const clinic = settings.clinic_settings
                if (!clinic?.ycloud_api_key) continue

                const timeZone = clinic.timezone || 'America/Mexico_City'
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
                    // Removed .eq('reminder_sent', false) here because the 24h reminder sets it to true.
                    // Instead, we rely on the timestamp check inside the loop to avoid duplicates.
                    .gte('appointment_date', startSearch.toISOString())
                    .lt('appointment_date', endSearch.toISOString())

                if (apptError) continue

                let sentCount = 0

                for (const appt of (appointments || [])) {
                    // Check if reminder was already sent RECENTLY (e.g., in last 6 hours)
                    // If so, skip (avoid duplicates)
                    if (appt.reminder_sent && appt.reminder_sent_at) {
                        const lastSent = new Date(appt.reminder_sent_at).getTime()
                        const diffHours = (nowUTC.getTime() - lastSent) / (1000 * 60 * 60)
                        if (diffHours < 6) continue
                    }

                    // Strict Hour Check in Clinic Timezone
                    const apptDate = new Date(appt.appointment_date)
                    const apptHour = parseInt(apptDate.toLocaleTimeString('en-US', { hour: 'numeric', hour12: false, timeZone }))

                    if (apptHour !== targetHour) continue

                    // SEND WHATSAPP (Reused logic - copy paste for safety in this constrained env)
                    try {
                        const formattedDate = apptDate.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone })
                        const formattedTime = apptDate.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone })

                        let tplName2h = settings.template_2h || 'appointment_reminder'
                        if (settings.request_confirmation && settings.template_confirmation && appt.status === 'pending') {
                            tplName2h = settings.template_confirmation
                        }

                        const messagePayload = {
                            to: appt.phone_number,
                            type: 'template',
                            template: {
                                name: tplName2h,
                                language: { code: 'es' },
                                components: [
                                    {
                                        type: 'body',
                                        parameters: [
                                            { type: 'text', text: appt.patient_name },
                                            { type: 'text', text: appt.service || 'consulta' },
                                            { type: 'text', text: formattedDate },
                                            { type: 'text', text: formattedTime },
                                            { type: 'text', text: clinic.clinic_name }
                                        ]
                                    }
                                ]
                            }
                        }

                        const response = await fetch('https://api.ycloud.com/v2/whatsapp/messages', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-API-Key': clinic.ycloud_api_key
                            },
                            body: JSON.stringify(messagePayload)
                        })

                        const responseData = await response.json().catch(() => ({}));

                        if (response.ok) {
                            await supabaseClient.from('messages').insert({
                                clinic_id: clinic.id,
                                phone_number: appt.phone_number,
                                direction: 'outbound',
                                content: `Recordatorio 2h antes enviado a ${appt.patient_name}`,
                                ycloud_message_id: responseData.id,
                                ycloud_status: 'sent'
                            })
                            await supabaseClient.from('reminder_logs').insert({
                                clinic_id: clinic.id,
                                appointment_id: appt.id,
                                type: '2h',
                                phone_number: appt.phone_number,
                                status: 'sent',
                                sent_at: new Date().toISOString()
                            });
                            await supabaseClient.from('appointments').update({
                                reminder_sent: true,
                                reminder_sent_at: new Date().toISOString()
                            }).eq('id', appt.id)
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
                // Append to results if needed, or just log
                // Append to results if needed, or just log
            }
        }

        // ==========================================
        // PART 3: 1-Hour Reminders
        // ==========================================

        const { data: oneHourSettingsList, error: oneHourError } = await supabaseClient
            .from('reminder_settings')
            .select(`
                *,
                clinic_settings (
                    id,
                    clinic_name,
                    timezone,
                    ycloud_api_key,
                    ycloud_phone_number
                )
            `)
            .eq('reminder_1h_before', true)

        if (!oneHourError && oneHourSettingsList?.length > 0) {
            log.push(`Found ${oneHourSettingsList.length} clinics with 1h reminders enabled`)

            for (const settings of oneHourSettingsList) {
                const clinic = settings.clinic_settings
                if (!clinic?.ycloud_api_key) continue

                const timeZone = clinic.timezone || 'America/Mexico_City'
                const now = new Date()

                // Target: Now + 1 hour
                const clinicDate = new Date(new Date().toLocaleString('en-US', { timeZone }))
                clinicDate.setHours(clinicDate.getHours() + 1) // Target Hour

                const targetHour = clinicDate.getHours()
                const nowUTC = new Date()

                // Buffer window: +30m to +90m from now
                const startSearch = new Date(nowUTC.getTime() + 30 * 60 * 1000)
                const endSearch = new Date(nowUTC.getTime() + 90 * 60 * 1000)

                const { data: appointments, error: apptError } = await supabaseClient
                    .from('appointments')
                    .select('*')
                    .eq('clinic_id', clinic.id)
                    .in('status', ['pending', 'confirmed'])
                    // Note: We don't filter by reminder_sent=false here because 
                    // a 24h reminder might have been sent yesterday.
                    // We check timestamps below.
                    .gte('appointment_date', startSearch.toISOString())
                    .lt('appointment_date', endSearch.toISOString())

                if (apptError) continue

                let sentCount = 0

                for (const appt of (appointments || [])) {
                    // Check if reminder was sent VERY RECENTLY (e.g., in last 40 mins)
                    if (appt.reminder_sent && appt.reminder_sent_at) {
                        const lastSent = new Date(appt.reminder_sent_at).getTime()
                        const diffMinutes = (nowUTC.getTime() - lastSent) / (1000 * 60)
                        if (diffMinutes < 45) continue // Skip if sent < 45 mins ago
                    }

                    // Strict Hour Check
                    const apptDate = new Date(appt.appointment_date)
                    const apptHour = parseInt(apptDate.toLocaleTimeString('en-US', { hour: 'numeric', hour12: false, timeZone }))

                    if (apptHour !== targetHour) continue

                    // SEND WHATSAPP
                    try {
                        const formattedDate = apptDate.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone })
                        const formattedTime = apptDate.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone })

                        let tplName1h = settings.template_1h || 'appointment_reminder'
                        if (settings.request_confirmation && settings.template_confirmation && appt.status === 'pending') {
                            tplName1h = settings.template_confirmation
                        }

                        const messagePayload = {
                            to: appt.phone_number,
                            type: 'template',
                            template: {
                                name: tplName1h,
                                language: { code: 'es' },
                                components: [
                                    {
                                        type: 'body',
                                        parameters: [
                                            { type: 'text', text: appt.patient_name },
                                            { type: 'text', text: appt.service || 'consulta' },
                                            { type: 'text', text: formattedDate },
                                            { type: 'text', text: formattedTime },
                                            { type: 'text', text: clinic.clinic_name }
                                        ]
                                    }
                                ]
                            }
                        }
                        const response = await fetch('https://api.ycloud.com/v2/whatsapp/messages', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-API-Key': clinic.ycloud_api_key
                            },
                            body: JSON.stringify(messagePayload)
                        })

                        const responseData = await response.json().catch(() => ({}));

                        if (response.ok) {
                            await supabaseClient.from('messages').insert({
                                clinic_id: clinic.id,
                                phone_number: appt.phone_number,
                                direction: 'outbound',
                                content: `Recordatorio 1h antes enviado a ${appt.patient_name}`,
                                ycloud_message_id: responseData.id,
                                ycloud_status: 'sent'
                            })
                            await supabaseClient.from('reminder_logs').insert({
                                clinic_id: clinic.id,
                                appointment_id: appt.id,
                                type: '1h',
                                phone_number: appt.phone_number,
                                status: 'sent',
                                sent_at: new Date().toISOString()
                            });
                            await supabaseClient.from('appointments').update({
                                reminder_sent: true,
                                reminder_sent_at: new Date().toISOString()
                            }).eq('id', appt.id)
                        } else {
                            await supabaseClient.from('reminder_logs').insert({
                                clinic_id: clinic.id,
                                appointment_id: appt.id,
                                type: '1h',
                                phone_number: appt.phone_number,
                                status: 'failed',
                                error_message: JSON.stringify(responseData)
                            });
                        }
                    } catch (e) {
                        console.error(e)
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
