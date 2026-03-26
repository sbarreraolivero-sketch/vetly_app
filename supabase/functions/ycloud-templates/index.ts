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
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '' // Use service role for internal auth check if needed, but here we check user auth
    )

    // Authenticate User
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('No authorization header')

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) throw new Error('Unauthorized')

    // Route Request
    const url = new URL(req.url)
    const pathParts = url.pathname.split('/').filter(Boolean)
    const isBase = pathParts[pathParts.length - 1] === 'ycloud-templates'
    let templateName = !isBase ? pathParts[pathParts.length - 1] : null

    let clinic_id = url.searchParams.get('clinic_id')
    let bodyPayload: any = null

    if (req.method === 'POST' || req.method === 'DELETE') {
      try {
        bodyPayload = await req.json()
        if (bodyPayload?.clinic_id) clinic_id = bodyPayload.clinic_id
        if (bodyPayload?.name && !templateName) templateName = bodyPayload.name
      } catch (e) { /* ignore parse error */ }
    }

    if (!clinic_id) throw new Error('clinic_id is required')

    // Get Clinic YCloud Key
    const { data: clinicSettings, error: csError } = await supabaseClient
      .from('clinic_settings')
      .select('ycloud_api_key')
      .eq('id', clinic_id)
      .single()

    if (csError || !clinicSettings?.ycloud_api_key) {
      throw new Error(`YCloud API Key not configured for this clinic.`)
    }

    const YCLOUD_KEY = clinicSettings.ycloud_api_key
    const YCLOUD_BASE = 'https://api.ycloud.com/v2/whatsapp/templates'

    if (req.method === 'GET') {
      const ycloudRes = await fetch(`${YCLOUD_BASE}?limit=100`, {
        headers: { 'X-API-Key': YCLOUD_KEY }
      })
      const data = await ycloudRes.json()
      if (!ycloudRes.ok) {
        return new Response(JSON.stringify({ error: data.message || 'YCloud API Error', isError: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        })
      }
      return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 })
    }

    else if (req.method === 'POST') {
      const payload = bodyPayload || {}

      if (payload.action === 'delete') {
        if (!templateName) throw new Error('Template name required for deletion')
        const ycloudRes = await fetch(`${YCLOUD_BASE}/${templateName}`, {
          method: 'DELETE',
          headers: { 'X-API-Key': YCLOUD_KEY }
        })

        let data: any = {}
        const responseText = await ycloudRes.text()
        if (responseText) {
          try { data = JSON.parse(responseText) }
          catch { data = { message: responseText } }
        }

        if (!ycloudRes.ok) data.isError = true
        if (!ycloudRes.ok && data.message) data.error = data.message

        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        })
      }

      const ycloudRes = await fetch(YCLOUD_BASE, {
        method: 'POST',
        headers: {
          'X-API-Key': YCLOUD_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })
      let data: any = {}
      const responseText = await ycloudRes.text()
      if (responseText) {
        try { data = JSON.parse(responseText) }
        catch { data = { message: responseText } }
      }

      if (!ycloudRes.ok) data.isError = true
      if (!ycloudRes.ok && data.message) data.error = data.message

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      })
    }

    else {
      throw new Error('Method not supported')
    }

  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message || 'Unknown error', isError: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  }
})

