
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

        const { campaign_id } = await req.json()

        if (!campaign_id) {
            throw new Error('campaign_id is required')
        }

        console.log(`Processing campaign: ${campaign_id}`)

        // 1. Fetch Campaign Details
        const { data: campaign, error: campaignError } = await supabaseClient
            .from('campaigns')
            .select(`
                *,
                clinic_settings!inner(
                    ycloud_api_key,
                    ycloud_phone_number
                )
            `)
            .eq('id', campaign_id)
            .single()

        if (campaignError) throw campaignError
        if (!campaign) throw new Error('Campaign not found')

        // 2. Fetch Patients based on segment_tag
        let query = supabaseClient
            .from('patients')
            .select('id, full_name, phone_number')
            .eq('clinic_id', campaign.clinic_id)
            .neq('phone_number', null)

        // Filter by tag if not null (null = all)
        if (campaign.segment_tag) {
            // Need to join with patient_tags
            // Supabase doesn't support direct extensive join filtering easily in JS client without inner join syntax 
            // OR we fetch patient_tags first.
            // Using logic: Fetch patient IDs from patient_tags then filter patients.
            // OR use !inner on patient_tags if we had the relation set up that way.
            // Assuming "patients" has "patient_tags" relation... usually it's m2m.

            // Simpler approach: Get IDs from patient_tags
            const { data: taggedPatients, error: tagError } = await supabaseClient
                .from('patient_tags')
                .select('patient_id')
                .eq('tag_id', campaign.segment_tag) // Assuming segment_tag is the UUID of the tag

            if (tagError) throw tagError

            const patientIds = taggedPatients.map(tp => tp.patient_id)

            if (patientIds.length === 0) {
                return new Response(
                    JSON.stringify({ success: true, processed: 0, message: 'No patients in this segment' }),
                    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }

            query = query.in('id', patientIds)
        }

        const { data: patients, error: patientsError } = await query

        if (patientsError) throw patientsError

        console.log(`Found ${patients.length} patients for campaign.`)

        const ycloudKey = campaign.clinic_settings?.ycloud_api_key
        if (!ycloudKey) throw new Error('No YCloud API Key found for this clinic')

        // Fetch Template Details from YCloud
        const templatesRes = await fetch('https://api.ycloud.com/v2/whatsapp/templates?limit=100', {
            headers: { 'X-API-Key': ycloudKey }
        })
        const templatesData = await templatesRes.json()
        const targetTemplate = (templatesData.items || []).find((t: any) => t.name === campaign.template_name)

        if (!targetTemplate) {
            throw new Error(`Template ${campaign.template_name} not found in YCloud.`)
        }

        const bodyComponent = targetTemplate.components.find((c: any) => c.type === 'BODY')
        const bodyText = bodyComponent ? bodyComponent.text : ''
        const variableMatches = bodyText.match(/\{\{\d+\}\}/g)
        const numVariables = variableMatches ? variableMatches.length : 0

        const results = []
        let sentCount = 0

        // 3. Loop and Send (Batching could be better, but loop is fine for <1000)
        for (const patient of patients) {
            try {
                // Prepare dynamic parameters
                const parameters = []
                if (numVariables > 0) {
                    for (let i = 1; i <= numVariables; i++) {
                        let textValue = 'Información'
                        if (i === 1) textValue = patient.full_name || 'Paciente'
                        else if (i === 2) textValue = 'Promoción'
                        else textValue = `Variable ${i}`

                        parameters.push({ type: 'text', text: textValue })
                    }
                }

                // Construct component list
                const messageComponents = []
                if (parameters.length > 0) {
                    messageComponents.push({
                        type: 'body',
                        parameters: parameters
                    })
                }

                const messagePayload: any = {
                    to: patient.phone_number,
                    type: 'template',
                    template: {
                        name: campaign.template_name,
                        language: { code: targetTemplate.language || 'es' },
                    }
                }

                if (messageComponents.length > 0) {
                    messagePayload.template.components = messageComponents
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
                    console.error(`Failed to send to ${patient.id}:`, ycloudResult)
                    results.push({ id: patient.id, status: 'error', error: ycloudResult.message })
                } else {
                    // Log
                    await supabaseClient.from('messages').insert({
                        clinic_id: campaign.clinic_id,
                        phone_number: patient.phone_number,
                        direction: 'outbound',
                        content: `Campaña ${campaign.name}: ${campaign.template_name}`,
                        ycloud_message_id: ycloudResult.id,
                        ycloud_status: 'sent',
                        campaign_id: campaign.id
                    })
                    results.push({ id: patient.id, status: 'sent' })
                    sentCount++
                }

            } catch (err) {
                console.error(`Error sending to patient ${patient.id}`, err)
                results.push({ id: patient.id, status: 'error', error: err.message })
            }
        }

        // 4. Update Campaign Status
        const finalStatus = sentCount === patients.length ? 'completed' : 'completed' // or 'partial'

        await supabaseClient
            .from('campaigns')
            .update({
                status: finalStatus,
                sent_count: sentCount,
                total_target: patients.length
            })
            .eq('id', campaign_id)

        return new Response(
            JSON.stringify({ success: true, processed: patients.length, sent: sentCount, details: results }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        // Mark campaign as failed if major error
        // We'd need to catch the top level error.
        console.error("Campaign failed:", error)
        return new Response(
            JSON.stringify({ error: error.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
    }
})
