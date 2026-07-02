/**
 * meta-whatsapp-webhook
 *
 * Webhook de Meta Cloud API para recibir mensajes de WhatsApp.
 * Reemplaza a ycloud-whatsapp-webhook para clínicas migradas a Meta directa.
 *
 * Verificación de firma: HMAC-SHA256(APP_SECRET, rawBody) == x-hub-signature-256
 * Verificación de webhook: GET con hub.verify_token
 */

import { createClient } from 'npm:@supabase/supabase-js@2'

const VERIFY_TOKEN   = Deno.env.get('META_WEBHOOK_VERIFY_TOKEN') ?? ''
const APP_SECRET     = Deno.env.get('META_APP_SECRET') ?? ''
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// ── Helpers ─────────────────────────────────────────────────────────────────

async function verifyMetaSignature(rawBody: string, signatureHeader: string | null): Promise<boolean> {
    if (!signatureHeader || !APP_SECRET) return false
    // Header format: "sha256=<hex>"
    const received = signatureHeader.replace('sha256=', '')
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
        'raw', encoder.encode(APP_SECRET),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    )
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody))
    const expected = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
    return expected === received
}

// Enviar mensaje de texto vía Meta Cloud API
async function sendMetaMessage(phoneNumberId: string, accessToken: string, to: string, text: string) {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'text',
            text: { body: text },
        }),
    })
    return res.json()
}

// Enviar template vía Meta Cloud API
async function sendMetaTemplate(
    phoneNumberId: string,
    accessToken: string,
    to: string,
    templateName: string,
    languageCode: string,
    components?: object[]
) {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            messaging_product: 'whatsapp',
            to,
            type: 'template',
            template: {
                name: templateName,
                language: { code: languageCode },
                ...(components ? { components } : {}),
            },
        }),
    })
    return res.json()
}

// ── Handler principal ────────────────────────────────────────────────────────

Deno.serve(async (req) => {
    const url = new URL(req.url)

    // ── GET: verificación del webhook por Meta ──────────────────────────────
    if (req.method === 'GET') {
        const mode      = url.searchParams.get('hub.mode')
        const token     = url.searchParams.get('hub.verify_token')
        const challenge = url.searchParams.get('hub.challenge')

        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('Webhook verificado por Meta ✅')
            return new Response(challenge, { status: 200 })
        }
        return new Response('Forbidden', { status: 403 })
    }

    // ── Solo POST a partir de aquí ──────────────────────────────────────────
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 })
    }

    const rawBody = await req.text()

    // Verificar firma HMAC-SHA256
    const signature = req.headers.get('x-hub-signature-256')
    const isValid = await verifyMetaSignature(rawBody, signature)
    if (!isValid) {
        console.error('Firma inválida — request rechazado')
        return new Response('Unauthorized', { status: 401 })
    }

    let payload: any
    try {
        payload = JSON.parse(rawBody)
    } catch {
        return new Response('Bad Request', { status: 400 })
    }

    // Meta envía el objeto "whatsapp_business_account"
    if (payload.object !== 'whatsapp_business_account') {
        return new Response('OK', { status: 200 })
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_KEY)

    // Procesar cada entry y cada change
    for (const entry of payload.entry ?? []) {
        for (const change of entry.changes ?? []) {
            if (change.field !== 'messages') continue

            const value    = change.value
            const metadata = value?.metadata
            const phoneNumberId = metadata?.phone_number_id
            const messages = value?.messages ?? []
            const statuses = value?.statuses ?? []

            // Actualizaciones de estado (delivered, read, etc.) — log y continuar
            for (const status of statuses) {
                console.log(`Status update: ${status.id} → ${status.status}`)
            }

            // Mensajes entrantes
            for (const message of messages) {
                const from      = message.from        // número del remitente (dígitos puros)
                const msgId     = message.id
                const timestamp = message.timestamp
                const msgType   = message.type        // text, image, audio, etc.

                // Extraer texto según tipo
                let text = ''
                if (msgType === 'text') {
                    text = message.text?.body ?? ''
                } else if (msgType === 'button') {
                    text = message.button?.text ?? ''
                } else if (msgType === 'interactive') {
                    text = message.interactive?.button_reply?.title
                        ?? message.interactive?.list_reply?.title
                        ?? ''
                }

                console.log(`Mensaje de ${from}: "${text}" (tipo: ${msgType}, phoneNumberId: ${phoneNumberId})`)

                // Buscar la clínica por phone_number_id de Meta
                const { data: clinic } = await sb
                    .from('clinic_settings')
                    .select('id, meta_phone_number_id, meta_access_token')
                    .eq('meta_phone_number_id', phoneNumberId)
                    .maybeSingle()

                if (!clinic) {
                    console.warn(`No se encontró clínica para phone_number_id: ${phoneNumberId}`)
                    continue
                }

                // TODO: aquí irá el routing al AI agent
                // Por ahora, el webhook recibe y loguea correctamente.
                // La integración completa con el AI agent se implementa en la siguiente fase.
                console.log(`Clínica encontrada: ${clinic.id} — mensaje listo para procesar`)
            }
        }
    }

    // Meta requiere 200 inmediato siempre
    return new Response('OK', { status: 200 })
})
