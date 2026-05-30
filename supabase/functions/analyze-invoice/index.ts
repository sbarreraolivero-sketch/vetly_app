import { createClient } from 'npm:@supabase/supabase-js@2'
import OpenAI from 'npm:openai@4'
import { corsHeaders } from '../_shared/cors.ts'

const INVOICE_CREDIT_COST = 20

const CATEGORY_LIST = [
    'medication', 'vaccine', 'antiparasitic', 'anesthetic', 'antibiotic',
    'anti_inflammatory', 'vitamin', 'disinfectant', 'surgical',
    'food', 'accessory', 'supply', 'other',
].join(', ')

const SYSTEM_PROMPT = `Eres un asistente especializado en extraer información de facturas y boletas de insumos veterinarios.
Tu tarea es analizar la imagen y devolver un JSON estructurado con todos los productos que aparezcan.

Categorías disponibles: ${CATEGORY_LIST}

Reglas:
- Extrae TODOS los productos/ítems de la factura
- unit_price es el precio por unidad (sin IVA si está desglosado)
- Si el precio es el total de línea, divídelo por la cantidad
- Los precios deben ser números sin símbolos de moneda
- Clasifica cada producto en la categoría más apropiada
- Si no puedes determinar un campo, usa null

Devuelve SOLO JSON válido, sin texto adicional.`

const USER_PROMPT = `Analiza esta factura y extrae todos los productos. Devuelve:
{
  "products": [
    {
      "name": "nombre del producto",
      "quantity": 1,
      "unit_price": 5000,
      "category": "medication",
      "sku": "codigo-si-aparece"
    }
  ],
  "supplier": "nombre del proveedor o null",
  "invoice_number": "numero o null",
  "invoice_date": "YYYY-MM-DD o null"
}`

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const { clinic_id, file_base64, mime_type } = await req.json()

        if (!clinic_id || !file_base64 || !mime_type) {
            return new Response(
                JSON.stringify({ error: 'Faltan parámetros requeridos' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const supabaseUrl  = Deno.env.get('SUPABASE_URL')!
        const serviceKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        const openaiKey    = Deno.env.get('OPENAI_API_KEY')!
        const sb = createClient(supabaseUrl, serviceKey)

        // ── 1. Verificar acceso del usuario ────────────────────────────────
        const authHeader = req.headers.get('Authorization') ?? ''
        const jwt = authHeader.replace('Bearer ', '')
        if (jwt) {
            const sbUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
                global: { headers: { Authorization: `Bearer ${jwt}` } }
            })
            const { data: { user } } = await sbUser.auth.getUser()
            if (user) {
                const { data: member } = await sb
                    .from('clinic_members')
                    .select('id')
                    .eq('user_id', user.id)
                    .eq('clinic_id', clinic_id)
                    .eq('status', 'active')
                    .maybeSingle()
                if (!member) {
                    return new Response(
                        JSON.stringify({ error: 'Sin acceso a esta clínica' }),
                        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    )
                }
            }
        }

        // ── 2. Resolver pool de créditos ───────────────────────────────────
        const { data: clinic } = await sb
            .from('clinic_settings')
            .select('id, parent_clinic_id, ai_credits_unlimited, ai_credits_monthly_limit, ai_credits_extra_balance, ai_credits_extra_expires_at')
            .eq('id', clinic_id)
            .single()

        if (!clinic) {
            return new Response(
                JSON.stringify({ error: 'Clínica no encontrada' }),
                { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const poolId = clinic.parent_clinic_id ?? clinic.id

        // ── 3. Verificar créditos (si no es ilimitado) ─────────────────────
        if (!clinic.ai_credits_unlimited) {
            const now = new Date()
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

            const { data: txRows } = await sb
                .from('ai_credit_transactions')
                .select('amount')
                .eq('clinic_id', poolId)
                .gte('created_at', monthStart)
                .lt('amount', 0)

            const consumed = Math.abs(
                (txRows ?? []).reduce((s: number, r: any) => s + Number(r.amount), 0)
            )

            const extraBalance  = Number(clinic.ai_credits_extra_balance ?? 0)
            const extraExpired  = clinic.ai_credits_extra_expires_at
                ? new Date(clinic.ai_credits_extra_expires_at) < now
                : false
            const extra         = extraExpired ? 0 : extraBalance
            const effectiveLimit = Number(clinic.ai_credits_monthly_limit ?? 0) + extra

            if (consumed + INVOICE_CREDIT_COST > effectiveLimit) {
                return new Response(
                    JSON.stringify({
                        error: `Créditos IA insuficientes. Necesitas ${INVOICE_CREDIT_COST} créditos para analizar una factura.`
                    }),
                    { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }
        }

        // ── 4. Llamar a GPT-4o-mini Vision ────────────────────────────────
        const openai = new OpenAI({ apiKey: openaiKey })

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            max_tokens: 2000,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                {
                    role: 'user',
                    content: [
                        {
                            type: 'image_url',
                            image_url: {
                                url: `data:${mime_type};base64,${file_base64}`,
                                detail: 'high',
                            },
                        },
                        { type: 'text', text: USER_PROMPT },
                    ],
                },
            ],
        })

        const rawText = completion.choices[0]?.message?.content ?? '{}'
        let parsed: any = {}
        try { parsed = JSON.parse(rawText) } catch { /* keep empty */ }

        const products = (parsed.products ?? []).map((p: any) => ({
            name:         (p.name ?? '').trim(),
            quantity:     Number(p.quantity) || 1,
            unit_price:   Number(p.unit_price) || 0,
            category:     p.category ?? 'other',
            sku:          p.sku ?? '',
        })).filter((p: any) => p.name.length > 0)

        // ── 5. Descontar créditos ──────────────────────────────────────────
        const balanceAfterConsumed = Math.max(
            0,
            Number(clinic.ai_credits_monthly_limit ?? 0) +
            Number(clinic.ai_credits_extra_balance ?? 0) -
            INVOICE_CREDIT_COST
        )

        await sb.from('ai_credit_transactions').insert({
            clinic_id:      poolId,
            type:           'consumption',
            amount:         -INVOICE_CREDIT_COST,
            description:    `Análisis de factura (${products.length} productos detectados)`,
            balance_after:  balanceAfterConsumed,
            metadata:       { model: 'gpt-4o-mini', source: 'invoice_analysis' },
        })

        return new Response(
            JSON.stringify({
                products,
                supplier:        parsed.supplier ?? null,
                invoice_number:  parsed.invoice_number ?? null,
                invoice_date:    parsed.invoice_date ?? null,
                credits_used:    INVOICE_CREDIT_COST,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    } catch (err: any) {
        console.error('analyze-invoice error:', err)
        return new Response(
            JSON.stringify({ error: err.message ?? 'Error interno al analizar la factura' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
