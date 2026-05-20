
import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    let campaign_id: string | null = null
    const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    try {
        ;({ campaign_id } = await req.json())

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

        const ycloudKey = campaign.clinic_settings?.ycloud_api_key
        if (!ycloudKey) throw new Error('No YCloud API Key found for this clinic')

        // 2. Resolve audience via inclusion/exclusion tag UUIDs (stored in JSONB)
        // Tags are on patients; phone numbers are on tutors. We send one message per tutor.
        const inclusionTags: string[] = campaign.inclusion_tags ?? []
        const exclusionTags: string[] = campaign.exclusion_tags ?? []

        // Build set of patient IDs to include
        let includedPatientIds: string[] | null = null

        if (inclusionTags.length > 0) {
            const { data: taggedPatients, error: tagError } = await supabaseClient
                .from('patient_tags')
                .select('patient_id')
                .in('tag_id', inclusionTags)

            if (tagError) throw tagError
            includedPatientIds = [...new Set(taggedPatients.map((r: any) => r.patient_id))]

            if (includedPatientIds.length === 0) {
                await supabaseClient
                    .from('campaigns')
                    .update({ status: 'completed', sent_count: 0, total_target: 0 })
                    .eq('id', campaign_id)
                return new Response(
                    JSON.stringify({ success: true, processed: 0, message: 'No patients in this segment' }),
                    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }
        }

        // Build set of patient IDs to exclude
        let excludedPatientIds: Set<string> = new Set()
        if (exclusionTags.length > 0) {
            const { data: excPatients, error: excError } = await supabaseClient
                .from('patient_tags')
                .select('patient_id')
                .in('tag_id', exclusionTags)

            if (excError) throw excError
            excludedPatientIds = new Set(excPatients.map((r: any) => r.patient_id))
        }

        // 3. Fetch active patients matching the criteria, joined to their tutor for phone/name
        let patientQuery = supabaseClient
            .from('patients')
            .select('id, name, tutor_id, tutors!inner(id, name, phone_number)')
            .eq('clinic_id', campaign.clinic_id)
            .is('death_date', null)

        if (includedPatientIds !== null) {
            patientQuery = patientQuery.in('id', includedPatientIds)
        }

        const { data: patients, error: patientsError } = await patientQuery
        if (patientsError) throw patientsError

        // Filter out excluded patients and group by tutor (deduplicate — one message per phone)
        const tutorMap = new Map<string, { tutorId: string; phone: string; name: string }>()

        for (const patient of (patients || [])) {
            if (excludedPatientIds.has(patient.id)) continue
            const tutor = (patient as any).tutors
            if (!tutor?.phone_number) continue
            if (!tutorMap.has(tutor.id)) {
                tutorMap.set(tutor.id, {
                    tutorId: tutor.id,
                    phone: tutor.phone_number,
                    name: tutor.name || 'Tutor',
                })
            }
        }

        const recipients = [...tutorMap.values()]
        console.log(`Found ${recipients.length} unique recipients for campaign.`)

        // 4. Fetch Template from YCloud
        const templatesRes = await fetch('https://api.ycloud.com/v2/whatsapp/templates?limit=100', {
            headers: { 'X-API-Key': ycloudKey }
        })
        const templatesData = await templatesRes.json()
        const targetTemplate = (templatesData.items || []).find((t: any) => t.name === campaign.template_name)

        if (!targetTemplate) {
            throw new Error(`Template "${campaign.template_name}" not found in YCloud.`)
        }

        const bodyComponent = targetTemplate.components.find((c: any) => c.type === 'BODY')
        const bodyText = bodyComponent ? bodyComponent.text : ''
        const numVariables = (bodyText.match(/\{\{\d+\}\}/g) ?? []).length

        const results = []
        let sentCount = 0

        // 5. Send to each unique tutor
        for (const recipient of recipients) {
            try {
                const parameters = []
                if (numVariables > 0) {
                    for (let i = 1; i <= numVariables; i++) {
                        let textValue = 'Información'
                        if (i === 1) textValue = recipient.name
                        else if (i === 2) textValue = 'Promoción'
                        else textValue = `Variable ${i}`
                        parameters.push({ type: 'text', text: textValue })
                    }
                }

                const messagePayload: any = {
                    to: recipient.phone,
                    type: 'template',
                    template: {
                        name: campaign.template_name,
                        language: { code: targetTemplate.language || 'es' },
                    }
                }

                if (parameters.length > 0) {
                    messagePayload.template.components = [{ type: 'body', parameters }]
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
                    console.error(`Failed to send to tutor ${recipient.tutorId}:`, ycloudResult)
                    results.push({ id: recipient.tutorId, status: 'error', error: ycloudResult.message })
                } else {
                    await supabaseClient.from('messages').insert({
                        clinic_id: campaign.clinic_id,
                        phone_number: recipient.phone,
                        direction: 'outbound',
                        content: `Campaña ${campaign.name}: ${campaign.template_name}`,
                        ycloud_message_id: ycloudResult.id,
                        ycloud_status: 'sent',
                        campaign_id: campaign.id
                    })
                    results.push({ id: recipient.tutorId, status: 'sent' })
                    sentCount++
                }

            } catch (err: any) {
                console.error(`Error sending to tutor ${recipient.tutorId}`, err)
                results.push({ id: recipient.tutorId, status: 'error', error: err.message })
            }
        }

        // 6. Update Campaign Status
        const finalStatus = sentCount === recipients.length ? 'completed' : 'partial'

        await supabaseClient
            .from('campaigns')
            .update({
                status: finalStatus,
                sent_count: sentCount,
                total_target: recipients.length
            })
            .eq('id', campaign_id)

        return new Response(
            JSON.stringify({ success: true, processed: recipients.length, sent: sentCount, details: results }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error: any) {
        console.error("Campaign failed:", error)
        if (campaign_id) {
            await supabaseClient
                .from('campaigns')
                .update({ status: 'failed' })
                .eq('id', campaign_id)
                .catch(() => {})
        }
        return new Response(
            JSON.stringify({ error: error.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
    }
})
