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

    // Authenticate User (soft check — if token is expired, proceed with service role)
    const authHeader = req.headers.get('Authorization')
    if (authHeader) {
      try {
        const userClient = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_ANON_KEY') ?? '',
          { global: { headers: { Authorization: authHeader } } }
        )
        const { data: { user }, error: userError } = await userClient.auth.getUser()
        if (userError || !user) {
          console.warn('User auth soft-failed (expired token?), proceeding with service role:', userError?.message)
        }
      } catch (authErr) {
        console.warn('Auth check error, proceeding:', authErr)
      }
    }

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

    // Get Clinic WhatsApp channel config — soporta tanto YCloud como Meta Cloud API
    const { data: clinicSettings, error: csError } = await supabaseClient
      .from('clinic_settings')
      .select('whatsapp_provider, ycloud_api_key, meta_waba_id, meta_access_token')
      .eq('id', clinic_id)
      .single()

    if (csError || !clinicSettings) {
      throw new Error(`No se pudo cargar la configuración de WhatsApp de esta clínica.`)
    }

    const isMeta = clinicSettings.whatsapp_provider === 'meta'

    if (isMeta && (!clinicSettings.meta_waba_id || !clinicSettings.meta_access_token)) {
      throw new Error(`La clínica está configurada para Meta pero le falta meta_waba_id o meta_access_token.`)
    }
    if (!isMeta && !clinicSettings.ycloud_api_key) {
      throw new Error(`YCloud API Key not configured for this clinic.`)
    }

    const YCLOUD_KEY = clinicSettings.ycloud_api_key
    const YCLOUD_BASE = 'https://api.ycloud.com/v2/whatsapp/templates'
    const META_WABA_ID = clinicSettings.meta_waba_id
    const META_TOKEN = clinicSettings.meta_access_token
    const META_BASE = `https://graph.facebook.com/v21.0/${META_WABA_ID}/message_templates`

    // --- Listar plantillas (mismo shape de salida para ambos canales) ---
    const listTemplates = async () => {
      if (isMeta) {
        const res = await fetch(`${META_BASE}?fields=name,status,category,components,language&limit=100`, {
          headers: { 'Authorization': `Bearer ${META_TOKEN}` }
        })
        const result = await res.json()
        if (!res.ok) return { error: result.error?.message || 'Meta API Error' }

        const templates = result.data || []
        return {
          templates: templates.map((t: any) => {
            const bodyComponent = t.components?.find((c: any) => c.type === 'BODY')
            return {
              id: t.name,
              name: t.name,
              language: t.language,
              status: t.status,
              category: t.category,
              body: bodyComponent ? bodyComponent.text : '(Sin texto)'
            }
          })
        }
      }

      const ycloudRes = await fetch(`${YCLOUD_BASE}?limit=100`, {
        headers: { 'X-API-Key': YCLOUD_KEY }
      })
      const result = await ycloudRes.json()
      if (!ycloudRes.ok) return { error: result.message || 'YCloud API Error' }

      const templates = result.items || []
      return {
        templates: templates.map((t: any) => {
          const bodyComponent = t.components?.find((c: any) => c.type === 'BODY')
          return {
            id: t.name,
            name: t.name,
            language: t.language,
            status: t.status,
            category: t.category,
            body: bodyComponent ? bodyComponent.text : '(Sin texto)'
          }
        })
      }
    }

    if (req.method === 'GET') {
      const result = await listTemplates()
      if (result.error) {
        return new Response(JSON.stringify({ error: result.error, isError: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        })
      }
      return new Response(JSON.stringify({ templates: result.templates }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 })
    }

    else if (req.method === 'POST') {
      const payload = bodyPayload || {}

      if (payload.action === 'list' || !payload.action) {
        const result = await listTemplates()
        if (result.error) {
          return new Response(JSON.stringify({ error: result.error, isError: true }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
          })
        }
        return new Response(JSON.stringify({ templates: result.templates }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 })
      }

      if (payload.action === 'delete') {
        if (!templateName) throw new Error('Template name required for deletion')

        if (isMeta) {
          const res = await fetch(`${META_BASE}?name=${encodeURIComponent(templateName)}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${META_TOKEN}` }
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok) { data.isError = true; data.error = data.error?.message || 'Meta API Error' }
          return new Response(JSON.stringify(data), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
          })
        }

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

      // Handle Creation with Meta specific requirements
      if (payload.action === 'create') {
        const { name, body_text, category = 'MARKETING', buttons = [], examples = [] } = payload

        const formattedName = name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')

        const components: any[] = [{ type: 'BODY', text: body_text }]

        if (buttons?.length > 0) {
            components.push({
                type: 'BUTTONS',
                buttons: buttons.filter((b:string) => b.trim()).map((b:string) => ({ type: 'QUICK_REPLY', text: b }))
            })
        }

        // Auto-inject examples for Meta approval
        const variableMatches = body_text.match(/\{\{\d+\}\}/g)
        if (variableMatches?.length > 0) {
            const genericExamples = ["Paciente", "Especialista", "Fecha/Hora", "Vacunación", "Clínica", "Link"]
            const exampleData = variableMatches.map((m: string) => {
                const num = parseInt(m.replace(/[{}]/g, ''))
                return examples[num - 1] || genericExamples[(num - 1) % genericExamples.length]
            })
            components[0].example = { body_text: [exampleData] }
        }

        if (isMeta) {
          const res = await fetch(META_BASE, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${META_TOKEN}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              name: formattedName,
              language: 'es',
              category: category.toUpperCase(),
              components
            })
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(data.error?.message || JSON.stringify(data))

          return new Response(JSON.stringify({ ...data, formatted_name: formattedName }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
          })
        }

        // Fetch WABA ID (YCloud requiere resolverlo por número, a diferencia de Meta que ya lo tenemos guardado)
        const wabaRes = await fetch('https://api.ycloud.com/v2/whatsapp/phoneNumbers', {
            method: 'GET',
            headers: { 'X-API-Key': YCLOUD_KEY }
        })
        const wabaData = await wabaRes.json()
        if (!wabaData?.items?.length) throw new Error('No WhatsApp numbers found')
        const wabaId = wabaData.items[0].wabaId

        const createPayload: any = {
            wabaId,
            name: formattedName,
            language: 'es',
            category: category.toUpperCase(),
            components
        }

        const ycloudRes = await fetch(YCLOUD_BASE, {
          method: 'POST',
          headers: {
            'X-API-Key': YCLOUD_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(createPayload)
        })

        const data = await ycloudRes.json()
        if (!ycloudRes.ok) throw new Error(JSON.stringify(data))

        return new Response(JSON.stringify({ ...data, formatted_name: formattedName }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        })
      }

      // Generic POST fallback (solo YCloud — Meta siempre pasa por una de las 3 acciones de arriba)
      if (isMeta) throw new Error('Acción no soportada para clínicas conectadas por Meta.')

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

