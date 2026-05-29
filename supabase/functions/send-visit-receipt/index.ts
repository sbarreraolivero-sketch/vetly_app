import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const formatCLP = (n: number) =>
    new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n)

const PAYMENT_LABELS: Record<string, string> = {
    efectivo: 'Efectivo', transferencia: 'Transferencia',
    tarjeta: 'Tarjeta de crédito', debito: 'Tarjeta de débito',
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    try {
        const { appointment_id, clinic_id, phone_number, items, total, payment_method, payment_status } = await req.json()

        if (!appointment_id || !clinic_id || !phone_number) {
            return new Response(JSON.stringify({ error: 'Missing required fields' }), {
                status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            })
        }

        // Obtener credenciales YCloud de la clínica
        const { data: clinic, error: clinicErr } = await supabase
            .from('clinic_settings')
            .select('ycloud_api_key, ycloud_phone_number, name')
            .eq('id', clinic_id)
            .single()

        if (clinicErr || !clinic?.ycloud_api_key) {
            return new Response(JSON.stringify({ error: 'Clinic YCloud credentials not found' }), {
                status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            })
        }

        // Obtener datos de la cita
        const { data: appt } = await supabase
            .from('appointments')
            .select('patient_name, tutor_name, appointment_date')
            .eq('id', appointment_id)
            .single()

        const patientName = appt?.patient_name ?? 'tu mascota'
        const clinicName = clinic.name ?? 'la clínica'

        // Construir el mensaje
        const itemLines = (items ?? []).map((i: any) =>
            `  • ${i.name} ×${i.quantity} — ${formatCLP(i.subtotal)}`
        ).join('\n')

        const paymentLine = payment_method ? `\n💳 *Pago:* ${PAYMENT_LABELS[payment_method] ?? payment_method}` : ''
        const statusLine = payment_status === 'paid' ? '\n✅ Estado: *Pagado*' : '\n⏳ Estado: *Pendiente de pago*'

        const message = [
            `🐾 *Comprobante de Visita — ${clinicName}*`,
            ``,
            `*Paciente:* ${patientName}`,
            ``,
            `*Servicios y productos:*`,
            itemLines || `  • ${appt?.patient_name ?? 'Consulta'}`,
            ``,
            `*Total: ${formatCLP(total)}*`,
            paymentLine,
            statusLine,
            ``,
            `¡Gracias por confiar en nosotros! 🩺`,
        ].filter(l => l !== undefined).join('\n')

        // Normalizar el teléfono
        const normalizedPhone = phone_number.replace(/\D/g, '')
        const to = normalizedPhone.startsWith('56') ? normalizedPhone : `56${normalizedPhone}`

        // Enviar por YCloud
        const response = await fetch('https://api.ycloud.com/v2/whatsapp/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': clinic.ycloud_api_key,
            },
            body: JSON.stringify({
                from: clinic.ycloud_phone_number,
                to: `+${to}`,
                type: 'text',
                text: { body: message },
            }),
        })

        const result = await response.json()

        if (!response.ok) {
            console.error('YCloud error:', result)
            return new Response(JSON.stringify({ error: result.message ?? 'YCloud error', detail: result }), {
                status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            })
        }

        return new Response(JSON.stringify({ success: true, message_id: result.id }), {
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })

    } catch (err: any) {
        console.error('send-visit-receipt error:', err)
        return new Response(JSON.stringify({ error: err.message ?? 'Internal error' }), {
            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
    }
})
