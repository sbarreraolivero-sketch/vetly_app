import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS'
}

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const bodyPayload = await req.json().catch(() => ({}))
        const { clinic_id, name, body_text, category = 'MARKETING', buttons = [] } = bodyPayload

        if (!clinic_id || !name || !body_text) {
            throw new Error('Clinic ID, Name, and Body Text are required')
        }

        const authHeader = req.headers.get('Authorization')
        if (!authHeader) throw new Error('No authorization header')

        const authClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            { global: { headers: { Authorization: authHeader } } }
        )
        const { data: { user }, error: userError } = await authClient.auth.getUser()
        if (userError || !user) throw new Error('Unauthorized')

        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        // 1. Get API Key
        const { data: settings, error } = await supabaseClient
            .from('clinic_settings')
            .select('ycloud_api_key')
            .eq('id', clinic_id)
            .single()

        if (error || !settings?.ycloud_api_key) {
            throw new Error('YCloud API Key not configured')
        }

        const apiKey = settings.ycloud_api_key

        // 2. Fetch WABA ID from APIs
        const wabaRes = await fetch('https://api.ycloud.com/v2/whatsapp/phoneNumbers', {
            method: 'GET',
            headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' }
        })
        const wabaData = await wabaRes.json()
        if (!wabaData?.items || wabaData.items.length === 0) {
            throw new Error('No WhatsApp numbers found for this account in YCloud. Please connect one first.')
        }
        const wabaId = wabaData.items[0].wabaId

        // 3. Prepare Template Structure
        // Name must be lowercase with underscores
        const formattedName = name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')

        const payload: any = {
            wabaId: wabaId,
            name: formattedName,
            language: 'es', // Default to Spanish
            category: category.toUpperCase(),
            components: [
                {
                    type: 'BODY',
                    text: body_text
                }
            ]
        }

        if (buttons && Array.isArray(buttons) && buttons.length > 0) {
            const validButtons = buttons.filter((b: string) => b.trim() !== '')
            if (validButtons.length > 0) {
                payload.components.push({
                    type: 'BUTTONS',
                    buttons: validButtons.map((b: string) => ({ type: 'QUICK_REPLY', text: b }))
                })
            }
        }

        // --- META APPROVAL FIX: Auto-inject examples for variables ---
        // Meta expects the 'example' array to have EXACTLY the same number of elements 
        // as there are placeholders {{n}} in the text, in order of appearance.
        const variableMatches = body_text.match(/\{\{\d+\}\}/g)

        if (variableMatches && variableMatches.length > 0) {
            const { examples: providedExamples = [] } = bodyPayload

            const genericExamples = [
                "Juan Pérez",                 // {{1}} Paciente
                "Dr. López",                  // {{2}} Especialista
                "Lunes 15 de Mayo a las 10:00", // {{3}} Fecha/Hora
                "Limpieza Dental",           // {{4}} Servicio
                "FixSalud Clínica",           // {{5}} Clínica
                "https://citenly.ai/reserva"  // {{6}} Link
            ]

            // Map each match to an example based on its number
            const exampleData = variableMatches.map((m: string) => {
                const num = parseInt(m.replace(/[{}]/g, ''))
                // variableExamples mapping (using providedExamples or fallback)
                return providedExamples[num - 1] || genericExamples[(num - 1) % genericExamples.length]
            })

            payload.components[0].example = {
                body_text: [exampleData]
            }
        }
        // -------------------------------------------------------------

        // 3. Make Request to YCloud
        const response = await fetch('https://api.ycloud.com/v2/whatsapp/templates', {
            method: 'POST',
            headers: {
                'X-API-Key': apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        })

        const result = await response.json()

        if (!response.ok) {
            console.error('YCloud Error:', result)
            throw new Error(`YCloud Error: ${JSON.stringify(result)}`)
        }

        // 4. Return success
        return new Response(JSON.stringify({
            success: true,
            template: result, // YCloud returns the created template object
            formatted_name: formattedName
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message, isError: true }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
    }
})
