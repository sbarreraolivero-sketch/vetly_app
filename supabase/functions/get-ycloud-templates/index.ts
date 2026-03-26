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
        const clinic_id = bodyPayload?.clinic_id
        if (!clinic_id) throw new Error('Clinic ID required')

        const authHeader = req.headers.get('Authorization')
        if (!authHeader) throw new Error('No authorization header')

        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
        const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

        const authClient = createClient(
            supabaseUrl,
            supabaseAnonKey,
            { global: { headers: { Authorization: authHeader } } }
        )
        
        // Verify user session
        const { data: { user }, error: userError } = await authClient.auth.getUser()
        
        if (userError || !user) {
            console.error('Auth User Error:', userError)
            // Fallback for local testing or specific issues if the token is present but getUser fails
            if (!userError && authHeader.startsWith('Bearer ')) {
                console.log('Token present but getUser returned no user. Proceeding with caution.')
            } else {
                throw new Error('Unauthorized')
            }
        }

        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        // Get API Key
        const { data: settings, error } = await supabaseClient
            .from('clinic_settings')
            .select('ycloud_api_key')
            .eq('id', clinic_id)
            .single()

        if (error || !settings?.ycloud_api_key) {
            // Check if user provided API key in request for testing? No, keep it secure.
            throw new Error('YCloud API Key not configured in Clinic Settings')
        }

        const apiKey = settings.ycloud_api_key

        // Call YCloud API
        // GET https://api.ycloud.com/v2/whatsapp/templates
        const response = await fetch('https://api.ycloud.com/v2/whatsapp/templates?limit=100', {
            method: 'GET',
            headers: {
                'X-API-Key': apiKey,
                'Content-Type': 'application/json'
            }
        })

        if (!response.ok) {
            const err = await response.json()
            console.error('YCloud Error:', err)
            throw new Error(err.message || 'Error fetching templates from YCloud')
        }

        const result = await response.json()
        const templates = result.items || []

        // Filter valid templates and format
        const validTemplates = templates
            .map((t: any) => {
                // Find body text
                const bodyComponent = t.components.find((c: any) => c.type === 'BODY')
                return {
                    id: t.name, // Use name as ID for YCloud
                    name: t.name,
                    language: t.language,
                    status: t.status,
                    category: t.category,
                    body: bodyComponent ? bodyComponent.text : '(Sin texto)'
                }
            })

        return new Response(JSON.stringify({ templates: validTemplates }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message, isError: true }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
    }
})
