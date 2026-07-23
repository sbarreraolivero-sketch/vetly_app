
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
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

    try {
        ;({ campaign_id } = await req.json())

        if (!campaign_id) {
            throw new Error('campaign_id is required')
        }

        // Verificar JWT + membresía antes de procesar
        const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
        if (!jwt) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            })
        }
        const sbUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
            global: { headers: { Authorization: `Bearer ${jwt}` } }
        })
        const { data: { user } } = await sbUser.auth.getUser()
        if (!user) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            })
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

        // Verificar que el usuario sea miembro activo de la clínica de esta campaña
        const { data: member } = await supabaseClient
            .from('clinic_members')
            .select('id')
            .eq('user_id', user.id)
            .eq('clinic_id', campaign.clinic_id)
            .eq('status', 'active')
            .maybeSingle()
        if (!member) {
            return new Response(JSON.stringify({ error: 'Forbidden' }), {
                status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            })
        }

        const ycloudKey = campaign.clinic_settings?.ycloud_api_key
        if (!ycloudKey) throw new Error('No YCloud API Key found for this clinic')

        // 2. Resolve audience via inclusion/exclusion tag UUIDs
        // Tags live in tutor_tags (migrated from patient_tags in session 12).
        // One message per tutor — no need to go through patients.
        const inclusionTags: string[] = campaign.inclusion_tags ?? []
        const exclusionTags: string[] = campaign.exclusion_tags ?? []

        // Build set of tutor IDs to include
        let includedTutorIds: string[] | null = null

        if (inclusionTags.length > 0) {
            const { data: taggedTutors, error: tagError } = await supabaseClient
                .from('tutor_tags')
                .select('tutor_id')
                .in('tag_id', inclusionTags)

            if (tagError) throw tagError
            includedTutorIds = [...new Set((taggedTutors || []).map((r: any) => r.tutor_id))]

            if (includedTutorIds.length === 0) {
                await supabaseClient
                    .from('campaigns')
                    .update({ status: 'completed', sent_count: 0, total_target: 0 })
                    .eq('id', campaign_id)
                return new Response(
                    JSON.stringify({ success: true, processed: 0, message: 'No tutors in this segment' }),
                    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }
        }

        // Build set of tutor IDs to exclude
        let excludedTutorIds: Set<string> = new Set()
        if (exclusionTags.length > 0) {
            const { data: excTutors, error: excError } = await supabaseClient
                .from('tutor_tags')
                .select('tutor_id')
                .in('tag_id', exclusionTags)

            if (excError) throw excError
            excludedTutorIds = new Set((excTutors || []).map((r: any) => r.tutor_id))
        }

        // 3. Fetch tutors directly (tags are at tutor level, no need to join through patients)
        let tutorQuery = supabaseClient
            .from('tutors')
            .select('id, name, phone_number')
            .eq('clinic_id', campaign.clinic_id)
            .not('phone_number', 'is', null)

        if (includedTutorIds !== null) {
            tutorQuery = tutorQuery.in('id', includedTutorIds)
        }

        const { data: tutors, error: tutorsError } = await tutorQuery
        if (tutorsError) throw tutorsError

        // Deduplicate recipients and apply exclusion filter
        const recipients = (tutors || [])
            .filter(tutor => !excludedTutorIds.has(tutor.id))
            .map(tutor => ({
                tutorId: tutor.id,
                phone: tutor.phone_number as string,
                name: tutor.name || 'Tutor',
            }))
        console.log(`Found ${recipients.length} unique recipients for campaign.`)

        // 4. Verify campaign credits balance
        const { data: subData, error: subError } = await supabaseClient
            .from('subscriptions')
            .select('campaign_credits_balance')
            .eq('clinic_id', campaign.clinic_id)
            .single()

        if (subError) throw new Error(`Error fetching subscription: ${subError.message}`)

        const currentCredits: number = subData?.campaign_credits_balance ?? 0
        if (currentCredits < recipients.length) {
            await supabaseClient
                .from('campaigns')
                .update({ status: 'failed' })
                .eq('id', campaign_id)
            return new Response(
                JSON.stringify({ error: `Créditos insuficientes. Necesitas ${recipients.length}, tienes ${currentCredits}.` }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
            )
        }

        // 5. Fetch Template from YCloud
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
                    const { error: msgErr } = await supabaseClient.from('messages').insert({
                        clinic_id: campaign.clinic_id,
                        phone_number: recipient.phone,
                        direction: 'outbound',
                        content: `Campaña ${campaign.name}: ${campaign.template_name}`,
                        ycloud_message_id: ycloudResult.id,
                        status: 'sent',
                        campaign_id: campaign.id
                    })
                    if (msgErr) console.error('[campaign] messages insert failed', msgErr)
                    results.push({ id: recipient.tutorId, status: 'sent' })
                    sentCount++
                }

            } catch (err: any) {
                console.error(`Error sending to tutor ${recipient.tutorId}`, err)
                results.push({ id: recipient.tutorId, status: 'error', error: err.message })
            }
        }

        // 6. Update Campaign Status + deduct credits
        const finalStatus = sentCount === recipients.length ? 'completed' : 'partial'

        await supabaseClient
            .from('campaigns')
            .update({
                status: finalStatus,
                sent_count: sentCount,
                total_target: recipients.length
            })
            .eq('id', campaign_id)

        // Deduct credits used (only what was actually sent)
        await supabaseClient
            .from('subscriptions')
            .update({ campaign_credits_balance: Math.max(0, currentCredits - sentCount) })
            .eq('clinic_id', campaign.clinic_id)

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
