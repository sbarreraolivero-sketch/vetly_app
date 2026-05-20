
import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        const now = new Date()
        const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
        const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString()

        console.log(`[surveys] Checking appointments between ${fortyEightHoursAgo} and ${twentyFourHoursAgo}`)

        // Step 1: Find clinics with surveys enabled.
        // reminder_settings has no direct FK from appointments, so we query it separately.
        const { data: remSettings, error: remError } = await supabaseClient
            .from('reminder_settings')
            .select('clinic_id, template_survey')
            .eq('surveys_enabled', true)

        if (remError) throw remError

        if (!remSettings || remSettings.length === 0) {
            console.log('[surveys] No clinics have surveys enabled.')
            return new Response(
                JSON.stringify({ success: true, processed: 0, message: 'No clinics with surveys enabled' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const clinicIds = remSettings.map((r: any) => r.clinic_id)
        const remSettingsMap: Record<string, string> = Object.fromEntries(
            remSettings.map((r: any) => [r.clinic_id, r.template_survey || 'satisfaction_survey'])
        )

        console.log(`[surveys] ${clinicIds.length} clinic(s) have surveys enabled.`)

        // Step 2: Find eligible appointments for those clinics.
        const { data: appointments, error: apptError } = await supabaseClient
            .from('appointments')
            .select(`
                id,
                patient_id,
                patient_name,
                phone_number,
                appointment_date,
                clinic_id,
                clinic_settings!inner(ycloud_api_key)
            `)
            .eq('status', 'completed')
            .in('clinic_id', clinicIds)
            .lt('appointment_date', twentyFourHoursAgo)
            .gt('appointment_date', fortyEightHoursAgo)

        if (apptError) throw apptError

        console.log(`[surveys] Found ${appointments?.length ?? 0} potential appointments to survey.`)

        const results = []

        for (const appointment of (appointments || [])) {
            // Check if survey already exists
            const { data: existingSurvey } = await supabaseClient
                .from('satisfaction_surveys')
                .select('id')
                .eq('appointment_id', appointment.id)
                .limit(1)

            if (existingSurvey && existingSurvey.length > 0) {
                console.log(`[surveys] Skipping ${appointment.id}: survey already sent.`)
                continue
            }

            const ycloudKey = (appointment.clinic_settings as any)?.ycloud_api_key
            if (!ycloudKey) {
                console.log(`[surveys] Skipping ${appointment.id}: no YCloud API key.`)
                results.push({ id: appointment.id, status: 'skipped', reason: 'no_api_key' })
                continue
            }

            const surveyTemplateName = remSettingsMap[appointment.clinic_id] || 'satisfaction_survey'

            try {
                const messagePayload = {
                    to: appointment.phone_number,
                    type: 'template',
                    template: {
                        name: surveyTemplateName,
                        language: { code: 'es' },
                        components: [
                            {
                                type: 'body',
                                parameters: [
                                    { type: 'text', text: appointment.patient_name }
                                ]
                            }
                        ]
                    }
                }

                const response = await fetch('https://api.ycloud.com/v2/whatsapp/messages', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': ycloudKey
                    },
                    body: JSON.stringify(messagePayload)
                })

                const ycloudResult = await response.json()

                if (!response.ok) {
                    throw new Error(ycloudResult.message || `YCloud API Error ${response.status}`)
                }

                await supabaseClient.from('messages').insert({
                    clinic_id: appointment.clinic_id,
                    phone_number: appointment.phone_number,
                    direction: 'outbound',
                    content: `Encuesta automática enviada a ${appointment.patient_name}`,
                    ycloud_message_id: ycloudResult.id,
                    ycloud_status: 'sent'
                })

                await supabaseClient.from('satisfaction_surveys').insert({
                    clinic_id: appointment.clinic_id,
                    appointment_id: appointment.id,
                    patient_id: appointment.patient_id,
                    phone_number: appointment.phone_number,
                    status: 'sent',
                    whatsapp_message_id: ycloudResult.id,
                    sent_at: new Date().toISOString()
                })

                results.push({ id: appointment.id, status: 'sent', message_id: ycloudResult.id })

            } catch (err: any) {
                console.error(`[surveys] Error sending survey for ${appointment.id}:`, err)
                results.push({ id: appointment.id, status: 'error', error: err.message })
            }
        }

        return new Response(
            JSON.stringify({ success: true, processed: results.length, details: results }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error: any) {
        console.error('[surveys] Fatal error:', error)
        return new Response(
            JSON.stringify({ error: error.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        )
    }
})
