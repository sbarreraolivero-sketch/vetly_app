
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

    try {
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        // 1. Calculate time range: appointments completed between 24h and 48h ago
        // This ensures we pick them up once they cross the 24h mark, but stop retry after 48h
        const now = new Date()
        const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
        const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString()

        console.log(`Checking appointments between ${fortyEightHoursAgo} and ${twentyFourHoursAgo}`)

        // 2. Find eligible appointments:
        // - Status 'completed'
        // - Updated_at (or appointment_date + duration) is within range. 
        // - For simplicity, let's use appointment_date as the reference (end of appointment) assuming 1h duration if not present
        // - MUST NOT have a survey in 'satisfaction_surveys' already.

        const { data: appointments, error: apptError } = await supabaseClient
            .from('appointments')
            .select(`
                id, 
                patient_id,
                patient_name, 
                phone_number, 
                appointment_date, 
                clinic_id,
                clinic_settings!inner(*)
            `)
            .eq('status', 'completed')
            .lt('appointment_date', twentyFourHoursAgo) // Older than 24h
            .gt('appointment_date', fortyEightHoursAgo) // Newer than 48h (to avoid processing ancient history)
        // Ideally we'd filter by NOT in satisfaction_surveys here, but Supabase/PostgREST doesn't support NOT IN easily in one query without a join filter
        // So we'll filtering code or use a left join logic if possible.
        // Simplest way: Fetch IDs, then check surveys table.

        if (apptError) throw apptError

        console.log(`Found ${appointments.length} potential appointments to survey.`)

        const results = []

        for (const appointment of appointments) {
            // Check if survey already exists
            const { data: existingSurvey } = await supabaseClient
                .from('satisfaction_surveys')
                .select('id')
                .eq('appointment_id', appointment.id)
                .single()

            if (existingSurvey) {
                console.log(`Skipping appointment ${appointment.id}: Survey already exists.`)
                continue
            }

            // Verify if Clinic has API Key
            const ycloudKey = appointment.clinic_settings?.ycloud_api_key
            if (!ycloudKey) {
                console.log(`Skipping appointment ${appointment.id}: No YCloud API Key.`)
                results.push({ id: appointment.id, status: 'skipped', reason: 'no_api_key' })
                continue
            }

            // Send Survey (Reusable logic from send-whatsapp-survey)
            try {
                // Template: Use dynamic template from clinic_settings, fallback to 'satisfaction_survey'
                const surveyTemplateName = appointment.clinic_settings?.template_survey || 'satisfaction_survey'

                // {{1}} = Patient Name
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
                                    { type: 'text', text: appointment.patient_name } // {{1}}
                                ]
                            }
                        ]
                    }
                }

                // Send to YCloud
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
                    throw new Error(ycloudResult.message || 'YCloud API Error')
                }

                // Log to messages
                await supabaseClient.from('messages').insert({
                    clinic_id: appointment.clinic_id,
                    phone_number: appointment.phone_number,
                    direction: 'outbound',
                    content: `Encuesta automática enviada a ${appointment.patient_name}`,
                    ycloud_message_id: ycloudResult.id,
                    ycloud_status: 'sent'
                })

                // Create Survey Record
                await supabaseClient.from('satisfaction_surveys').insert({
                    clinic_id: appointment.clinic_id,
                    appointment_id: appointment.id,
                    patient_id: appointment.patient_id,
                    status: 'sent',
                    whatsapp_message_id: ycloudResult.id,
                    sent_at: new Date().toISOString()
                })

                // We need to fetch patient_id to be robust
                // Actually let's assume appointments has patient_id, I'll update the select above.

                results.push({ id: appointment.id, status: 'sent', message_id: ycloudResult.id })

            } catch (err) {
                console.error(`Error sending survey for ${appointment.id}:`, err)
                results.push({ id: appointment.id, status: 'error', error: err.message })
            }
        }

        return new Response(
            JSON.stringify({ success: true, processed: results.length, details: results }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        return new Response(
            JSON.stringify({ error: error.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
    }
})
