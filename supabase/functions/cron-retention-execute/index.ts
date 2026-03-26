
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

        console.log("Starting cron-retention-execute...")

        // 1. Fetch approved actions pending execution
        // Join with clinic_settings to get API Keys
        const { data: actions, error: actionsError } = await supabaseClient
            .from('ai_action_log')
            .select(`
                *,
                patients (
                    id,
                    name,
                    phone_number
                ),
                clinic_settings (
                    id,
                    clinic_name,
                    ycloud_api_key,
                    ycloud_phone_number
                )
            `)
            .eq('status', 'approved')
            .is('executed_at', null)
            .limit(50) // Process in batches to avoid timeout

        if (actionsError) throw actionsError

        console.log(`Found ${actions?.length || 0} approved actions to execute.`)

        const results = []

        for (const action of (actions || [])) {
            try {
                const clinic = action.clinic_settings
                const patient = action.patients

                if (!clinic?.ycloud_api_key) {
                    throw new Error('No YCloud API Key for clinic')
                }
                if (!patient?.phone_number) {
                    throw new Error('No phone number for patient')
                }

                // 2. Perform Action based on Type
                if (action.action_type === 'whatsapp_message') {
                    // Prepare message
                    // Assume action_details has template info or content
                    // For now, use a generic "Reactivation" template or text
                    // If action_details.template_name exists, use it.

                    const details = action.action_details || {}
                    const templateName = details.template_name || 'reactivation_offer' // Fallback

                    // Construct payload
                    // CAUTION: Template params must match.
                    // Let's assume a standard reactivation template: {{1}} Name, {{2}} Clinic Name

                    const messagePayload = {
                        to: patient.phone_number,
                        type: 'template',
                        template: {
                            name: templateName,
                            language: { code: 'es' },
                            components: [
                                {
                                    type: 'body',
                                    parameters: [
                                        { type: 'text', text: patient.name },
                                        { type: 'text', text: clinic.clinic_name }
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
                            'X-API-Key': clinic.ycloud_api_key
                        },
                        body: JSON.stringify(messagePayload)
                    })

                    const result = await response.json()

                    if (!response.ok) {
                        throw new Error(result.message || 'YCloud API Error')
                    }

                    // Log success
                    // Update action log
                    await supabaseClient
                        .from('ai_action_log')
                        .update({
                            status: 'executed',
                            executed_at: new Date().toISOString(),
                            result: `Message ID: ${result.id}`,
                            result_revenue: 0 // Will be updated later if booked?
                        })
                        .eq('id', action.id)

                    // Also log to messages table
                    await supabaseClient.from('messages').insert({
                        clinic_id: clinic.id,
                        phone_number: patient.phone_number,
                        direction: 'outbound',
                        content: `Citenly AI Retention: ${templateName}`,
                        ycloud_message_id: result.id,
                        ycloud_status: 'sent',
                        ai_generated: true
                    })

                    results.push({ id: action.id, status: 'success', type: 'whatsapp' })

                } else {
                    // Unknown type
                    console.warn(`Unknown action type: ${action.action_type}`)
                    continue
                }

            } catch (err) {
                console.error(`Error executing action ${action.id}:`, err)

                // Mark as failed so we don't retry forever
                await supabaseClient
                    .from('ai_action_log')
                    .update({
                        status: 'failed',
                        result: err.message
                    })
                    .eq('id', action.id)

                results.push({ id: action.id, status: 'failed', error: err.message })
            }
        }

        return new Response(
            JSON.stringify({ success: true, processed: results }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        return new Response(
            JSON.stringify({ error: error.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        )
    }
})
