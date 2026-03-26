
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

        console.log("Starting cron-process-upsell...")

        // Fetch appointments that:
        // 1. Are completed
        // 2. Have NOT had an upsell sent (upsell_sent_at IS NULL)
        // 3. Belong to a service with upselling_enabled = true
        // 4. Have passed the upselling_days_after threshold
        // 5. Are not too old (e.g., threshold passed within last 7 days to avoid spamming historical data)

        // Note: PostgREST filtering on related tables (services) with calculation is tricky.
        // Easier to fetch candidate appointments and filter in memory, or use a customized RPC/View.
        // Given the likely volume, fetching "active" recent completed appointments is safer.

        // Strategy:
        // Get appointments completed in the last 30 days (max upsell window usually)
        // Filter by date + days_after <= now

        const thirtyDaysAgo = new Date()
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

        const { data: appointments, error: apptError } = await supabaseClient
            .from('appointments')
            .select(`
                id,
                patient_name,
                phone_number,
                appointment_date,
                status,
                upsell_sent_at,
                clinic_id,
                services!inner(
                    name,
                    upselling_enabled,
                    upselling_days_after,
                    upselling_message
                ),
                clinic_settings!inner(
                    ycloud_api_key,
                    ycloud_phone_number
                )
            `)
            .eq('status', 'completed')
            .is('upsell_sent_at', null)
            .eq('services.upselling_enabled', true)
            .gte('appointment_date', thirtyDaysAgo.toISOString()) // Optimization

        if (apptError) throw apptError

        console.log(`Found ${appointments?.length || 0} candidate appointments.`)

        const results = []
        const now = new Date()

        for (const appt of appointments || []) {
            const apptDate = new Date(appt.appointment_date)
            // Calculate when the upsell should be sent
            const targetDate = new Date(apptDate)
            targetDate.setDate(targetDate.getDate() + (appt.services.upselling_days_after || 0))

            // If target date is in the future, skip
            if (targetDate > now) {
                continue
            }

            // If target date was more than 3 days ago, maybe skip to avoid awkward late messages?
            // User requirement didn't specify, but let's be safe. Let's allow a 24h processing window.
            // Actually, since we run hourly, checking if targetDate <= now is sufficient if we assume cron runs reliably.
            // But to avoid "blast from the past" if cron was off, let's limit.

            // IMPORTANT: If this is the FIRST run, we might blast old patients.
            // Let's ensure targetDate is within the last 48 hours.
            const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000)
            if (targetDate < fortyEightHoursAgo) {
                console.log(`Skipping appointment ${appt.id}: Upsell target date ${targetDate} is too old (>48h ago).`)
                continue
            }

            const ycloudKey = appt.clinic_settings?.ycloud_api_key
            if (!ycloudKey) {
                console.log(`Skipping appointment ${appt.id}: No YCloud API Key.`)
                results.push({ id: appt.id, status: 'skipped', reason: 'no_api_key' })
                continue
            }

            // Send Message
            // We need a template for upsell.
            // Since we want to use the `upselling_message` from the service, we might need a template that accepts dynamic text.
            // WhatsApp Templates generally don't allow full dynamic body text unless it's a specific variable.
            // SAFETY: If we use a template like `general_notification` with {{1}} as body, it might be rejected for marketing.
            // OPTION: We use a fixed template `service_followup` which takes:
            // {{1}} Patient Name
            // {{2}} Service Name
            // {{3}} Custom Message (or we just don't use custom message if template doesn't support it)

            // FOR NOW: Let's assume we use a template `service_upsell`.
            // If the user wants a *custom* message per service, they need a template that supports it.
            // Let's use `appointment_followup` template (need to confirm existence or create it).
            // Params: {{1}} Patient Name, {{2}} Service Name

            try {
                const messagePayload = {
                    to: appt.phone_number,
                    type: 'template',
                    template: {
                        name: 'appointment_followup', // Assumed template name
                        language: { code: 'es' },
                        components: [
                            {
                                type: 'body',
                                parameters: [
                                    { type: 'text', text: appt.patient_name }, // {{1}} Name
                                    { type: 'text', text: appt.services.name }, // {{2}} Service
                                    // { type: 'text', text: appt.services.upselling_message || 'Esperamos verte pronto.' } // {{3}} Custom? Risk of template mismatch.
                                ]
                            }
                        ]
                    }
                }

                // Call YCloud
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
                    // If template doesn't exist, we might fail here.
                    console.error(`YCloud Error for ${appt.id}:`, ycloudResult)
                    throw new Error(ycloudResult.message || 'YCloud API Error')
                }

                // Log and Update
                await supabaseClient.from('messages').insert({
                    clinic_id: appt.clinic_id,
                    phone_number: appt.phone_number,
                    direction: 'outbound',
                    content: `Upsell automático: ${appt.services.upselling_message || 'Follow-up sent'}`,
                    ycloud_message_id: ycloudResult.id,
                    ycloud_status: 'sent'
                })

                await supabaseClient.from('appointments')
                    .update({ upsell_sent_at: new Date().toISOString() })
                    .eq('id', appt.id)

                results.push({ id: appt.id, status: 'sent', message_id: ycloudResult.id })

            } catch (err) {
                console.error(`Error processing upsell for ${appt.id}:`, err)
                results.push({ id: appt.id, status: 'error', error: err.message })
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
