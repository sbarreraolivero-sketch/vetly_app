
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

        // 2. Get template from reminder_settings (instead of hardcoding)
        const { data: reminderSettings } = await supabaseClient
            .from('reminder_settings')
            .select('template_24h, template_confirmation, request_confirmation')
            .eq('clinic_id', appointment.clinic_id)
            .single()

        let templateName = reminderSettings?.template_24h || '24hrs_recordatorio_cita'
        if (reminderSettings?.request_confirmation && reminderSettings?.template_confirmation && appointment.status === 'pending') {
            templateName = reminderSettings.template_confirmation
        }

        // Variable mapping: dynamically match template variable count
        const date = new Date(appointment.appointment_date)
        const tz = clinic_settings?.timezone || 'America/Santiago'
        const formattedDate = date.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz })
        const formattedTime = date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: tz })

        // Fetch template to count variables
        let varCount = 5
        try {
            const tplRes = await fetch('https://api.ycloud.com/v2/whatsapp/templates?limit=100', {
                headers: { 'X-API-Key': ycloudKey }
            })
            const tplData = await tplRes.json()
            const tpl = (tplData.items || []).find((t: any) => t.name === templateName)
            if (tpl) {
                const body = tpl.components?.find((c: any) => c.type === 'BODY')
                const matches = body?.text?.match(/\{\{\d+\}\}/g)
                varCount = matches ? matches.length : 0
            }
        } catch (e) { console.warn('Could not fetch template info:', e) }

        const allParams = [
            { type: 'text', text: appointment.patient_name },
            { type: 'text', text: appointment.service || 'consulta' },
            { type: 'text', text: formattedDate },
            { type: 'text', text: formattedTime },
            { type: 'text', text: clinic_settings.clinic_name }
        ]
        const params = varCount > 0 ? allParams.slice(0, varCount) : allParams

        const messagePayload = {
            to: appointment.phone_number,
            type: 'template',
            template: {
                name: templateName,
                language: { code: 'es' },
                components: params.length > 0 ? [
                    {
                        type: 'body',
                        parameters: params
                    }
                ] : []
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
            throw new Error(result.message || 'Failed to send WhatsApp message')
        }

        // 4. Log to messages table
        await supabaseClient.from('messages').insert({
            clinic_id: appointment.clinic_id,
            phone_number: appointment.phone_number,
            direction: 'outbound',
            content: `Recordatorio enviado a ${appointment.patient_name}`,
            ycloud_message_id: result.id,
            ycloud_status: 'sent'
        })

        // 5. Update appointment reminder status
        await supabaseClient.from('appointments').update({
            reminder_sent: true,
            reminder_sent_at: new Date().toISOString()
        }).eq('id', appointment_id)

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
