
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

        const { appointment_id } = await req.json()

        if (!appointment_id) {
            throw new Error('Appointment ID is required')
        }

        // 1. Fetch appointment details
        // We need patient info and clinic settings
        const { data: appointment, error: apptError } = await supabaseClient
            .from('appointments')
            .select('*, clinic_settings(*)')
            .eq('id', appointment_id)
            .single()

        if (apptError || !appointment) {
            throw new Error('Appointment not found')
        }

        const { clinic_settings } = appointment
        const ycloudKey = clinic_settings?.ycloud_api_key

        if (!ycloudKey) {
            throw new Error('Clinic has not configured WhatsApp (YCloud API Key missing)')
        }

        // 2. Prepare Survey Message using Template
        // Template Name: satisfaction_survey
        // Variable {{1}} = Patient Name

        const messagePayload = {
            to: appointment.phone_number,
            type: 'template',
            template: {
                name: 'satisfaction_survey',
                language: { code: 'es' },
                components: [
                    {
                        type: 'body',
                        parameters: [
                            { type: 'text', text: appointment.patient_name } // {{1}}
                        ]
                    }
                    // Buttons are defined in the template itself in YCloud, usually no need to pass them in payload unless dynamic
                ]
            }
        }

        // 3. Send to YCloud
        const response = await fetch('https://api.ycloud.com/v2/whatsapp/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': ycloudKey
            },
            body: JSON.stringify(messagePayload)
        })

        const result = await response.json()

        if (!response.ok) {
            console.error('YCloud Error:', result)
            throw new Error(result.message || 'Failed to send WhatsApp survey')
        }

        // 4. Log to messages table
        await supabaseClient.from('messages').insert({
            clinic_id: appointment.clinic_id,
            phone_number: appointment.phone_number,
            direction: 'outbound',
            content: `Encuesta enviada a ${appointment.patient_name}`,
            ycloud_message_id: result.id,
            ycloud_status: 'sent'
        })

        // 5. Create or Update Survey Record
        // Check if survey already exists for this appointment
        const { data: existingSurvey } = await supabaseClient
            .from('satisfaction_surveys')
            .select('id')
            .eq('appointment_id', appointment_id)
            .single()

        if (existingSurvey) {
            await supabaseClient.from('satisfaction_surveys').update({
                status: 'sent',
                whatsapp_message_id: result.id,
                sent_at: new Date().toISOString()
            }).eq('id', existingSurvey.id)
        } else {
            // Find patient_id if not linked in appointment (it usually is by now)
            // But if appointment.patient_id is null, we might need to find it directly
            // For now assume appointment has patient_id or we skip it

            await supabaseClient.from('satisfaction_surveys').insert({
                clinic_id: appointment.clinic_id,
                appointment_id: appointment.appointment_id, // Note: using 'id' from appointment object
                patient_id: appointment.patient_id, // Make sure this exists
                status: 'sent',
                whatsapp_message_id: result.id,
                sent_at: new Date().toISOString()
            })
        }

        return new Response(
            JSON.stringify({ success: true, detailed_log: result }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        return new Response(
            JSON.stringify({ error: error.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
    }
})
