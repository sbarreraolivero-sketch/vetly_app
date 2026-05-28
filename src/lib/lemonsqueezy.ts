import { supabase } from './supabase'

// ──────────────────────────────────────────────
// LemonSqueezy — International Payments (USD)
// ──────────────────────────────────────────────

/**
 * USD Plan Prices for LemonSqueezy
 */
export const LS_PLANS = {
    core: {
        id: 'core',
        name: 'Core',
        tagline: 'Gestión completa sin IA conversacional',
        price: 39,
        currency: 'USD',
        monthlyAppointments: 0,
        maxUsers: 1,
        maxAgendas: 1,
        features: [
            '1 usuario · 1 agenda',
            'Dashboard + métricas',
            'Calendario de citas (manual)',
            'Fichas médicas e historial',
            'Módulo de finanzas',
            'Sistema de referidos',
        ],
        upsells: [
            'Recordatorios automáticos — packs opcionales',
            'Mensajería masiva de marketing segmentada',
        ],
    },
    starter: {
        id: 'starter',
        name: 'Starter',
        tagline: 'Para veterinarios independientes',
        price: 99,
        currency: 'USD',
        monthlyAppointments: 50,
        maxUsers: 2,
        maxAgendas: 1,
        features: [
            '2 usuarios · 1 agenda',
            'Todo lo de Core',
            'Agente IA WhatsApp (Lía)',
            '5.000 créditos IA incluidos/mes',
            'Hasta 50 citas con IA/mes',
            '100 recordatorios/mes',
            'Logística móvil (Goldi)',
        ],
        upsells: [
            'Mensajería masiva de marketing segmentada',
        ],
    },
    pro: {
        id: 'pro',
        name: 'Pro',
        tagline: 'Para clínicas en crecimiento',
        price: 169,
        currency: 'USD',
        monthlyAppointments: -1,
        maxUsers: 5,
        maxAgendas: 5,
        popular: true,
        features: [
            '5 usuarios · 5 agendas',
            'Todo lo de Starter',
            '10.000 créditos IA incluidos/mes',
            'Citas con IA ilimitadas',
            '250 recordatorios/mes',
            'Encuestas de satisfacción',
            'Soporte prioritario',
        ],
        upsells: [
            'Mensajería masiva de marketing segmentada',
        ],
    },
    enterprise: {
        id: 'enterprise',
        name: 'Enterprise',
        tagline: 'Redes y multi-sucursal',
        price: 349,
        currency: 'USD',
        monthlyAppointments: -1,
        maxUsers: 999999,
        maxAgendas: 999999,
        features: [
            'Usuarios y agendas ilimitados',
            'Todo lo de Pro',
            '30.000 créditos IA incluidos/mes',
            'Recordatorios ilimitados',
            'Hasta 3 sucursales',
            'IA personalizada por especialidad',
            'Super Administrador',
            'Soporte 24/7 dedicado',
        ],
        upsells: [
            'Mensajería masiva de marketing segmentada',
        ],
    },
} as const;

export type LSPlanId = keyof typeof LS_PLANS

/**
 * USD Credit Packs — GPT-4o-mini
 */
export const LS_CREDIT_PACKS = {
    'pack_500':  { id: 'pack_500',  name: 'Pack Inicial',    credits: 4000,  price: 9,  description: '4.000 Créditos de IA' },
    'pack_1500': { id: 'pack_1500', name: 'Pack Pro',        credits: 8000,  price: 15, description: '8.000 Créditos de IA' },
    'pack_4000': { id: 'pack_4000', name: 'Pack Enterprise', credits: 20000, price: 29, description: '20.000 Créditos de IA' },
} as const

/**
 * USD Credit Packs — GPT-4o (Premium)
 */
export const LS_CREDIT_PACKS_4O = {
    'pack_500_4o':  { id: 'pack_500_4o',  name: 'Pack Inicial',    credits: 500,  price: 10, description: '500 Créditos de IA (GPT-4o)' },
    'pack_1500_4o': { id: 'pack_1500_4o', name: 'Pack Pro',        credits: 1500, price: 30, description: '1500 Créditos de IA (GPT-4o)' },
    'pack_4000_4o': { id: 'pack_4000_4o', name: 'Pack Enterprise',  credits: 4000, price: 80, description: '4000 Créditos de IA (GPT-4o)' },
} as const

export type LSCreditPackId = keyof typeof LS_CREDIT_PACKS

/**
 * Creates a LemonSqueezy checkout for a subscription plan.
 * Calls our Edge Function which in turn calls the LS API.
 */
export async function redirectToLemonCheckout(
    clinicId: string,
    email: string,
    planId: LSPlanId
) {
    const { data, error } = await supabase.functions.invoke('lemonsqueezy-create-checkout', {
        body: {
            clinic_id: clinicId,
            email: email,
            type: 'subscription',
            plan_or_pack_id: planId,
            success_url: `${window.location.origin}/app/settings?payment=success`,
        },
    })

    if (error) {
        console.error('Error creating LemonSqueezy checkout:', error)
        throw new Error(error.message || 'Error al conectar con LemonSqueezy')
    }

    if (!data?.url) {
        console.error('No checkout URL returned:', data)
        throw new Error('No se recibió una URL de pago válida')
    }

    // Redirect to LemonSqueezy checkout page
    window.location.href = data.url
}

export async function redirectToLemonCreditsCheckout(
    clinicId: string,
    email: string,
    packId: string,
    model: 'mini' | '4o' = 'mini'
) {
    const { data, error } = await supabase.functions.invoke('lemonsqueezy-create-checkout', {
        body: {
            clinic_id: clinicId,
            email: email,
            type: 'ai_credits',
            plan_or_pack_id: packId,
            model: model,
            success_url: `${window.location.origin}/app/settings?tab=ai&payment=success`,
        },
    })

    if (error) {
        console.error('Error creating LemonSqueezy credits checkout:', error)
        throw new Error(error.message || 'Error al conectar con LemonSqueezy')
    }

    if (!data?.url) {
        console.error('No checkout URL returned:', data)
        throw new Error('No se recibió una URL de pago válida')
    }

    window.location.href = data.url
}

/**
 * Creates a LemonSqueezy checkout for per-unit reminder credits.
 * Price: US$0.15/unit, minimum 20 units.
 */
export async function redirectToLemonRemindersCheckout(
    clinicId: string,
    email: string,
    quantity: number
) {
    const { data, error } = await supabase.functions.invoke('lemonsqueezy-create-checkout', {
        body: {
            clinic_id: clinicId,
            email: email,
            type: 'reminders',
            plan_or_pack_id: 'reminders',
            quantity: Math.max(10, quantity),
            success_url: `${window.location.origin}/app/reminders?payment=success`,
        },
    })

    if (error) {
        console.error('Error creating reminders checkout:', error)
        throw new Error(error.message || 'Error al conectar con LemonSqueezy')
    }

    if (!data?.url) {
        console.error('No checkout URL returned:', data)
        throw new Error('No se recibió una URL de pago válida')
    }

    window.location.href = data.url
}

export type ReminderPackId = 'reminders_50' | 'reminders_350' | 'reminders_unlimited'

/**
 * Creates a LemonSqueezy checkout for campaign credits.
 * Price: US$0.15/crédito · mínimo 50 · sin vencimiento.
 * LS variant = $1.50 por 10 créditos (límite mínimo de LS $0.50).
 */
export async function redirectToLemonCampaignCreditsCheckout(
    clinicId: string,
    email: string,
    quantity: number
) {
    const { data, error } = await supabase.functions.invoke('lemonsqueezy-create-checkout', {
        body: {
            clinic_id: clinicId,
            email: email,
            type: 'campaign_credits',
            plan_or_pack_id: 'campaign_credits',
            quantity: Math.max(50, quantity),
            success_url: `${window.location.origin}/app/campaigns?payment=success`,
        },
    })

    if (error) {
        console.error('Error creating campaign credits checkout:', error)
        throw new Error(error.message || 'Error al conectar con LemonSqueezy')
    }

    if (!data?.url) {
        // Edge function returns {success:false, details:"..."} for LS API errors (status 200)
        const msg = data?.details || data?.error || 'No se recibió una URL de pago válida'
        console.error('Checkout error:', data)
        throw new Error(msg)
    }

    window.location.href = data.url
}

/**
 * Creates a LemonSqueezy checkout for a fixed reminder pack.
 * Pack 50: $5.000 CLP/$9 USD · Pack 350: $15.000 CLP/$19 USD · Ilimitado: $25.000 CLP/$29 USD
 */
export async function redirectToLemonReminderPackCheckout(
    clinicId: string,
    email: string,
    packId: ReminderPackId
) {
    const { data, error } = await supabase.functions.invoke('lemonsqueezy-create-checkout', {
        body: {
            clinic_id: clinicId,
            email: email,
            type: 'reminders',
            plan_or_pack_id: packId,
            success_url: `${window.location.origin}/app/reminders?payment=success`,
        },
    })

    if (error) {
        console.error('Error creating reminder pack checkout:', error)
        throw new Error(error.message || 'Error al conectar con LemonSqueezy')
    }

    if (!data?.url) {
        console.error('No checkout URL returned:', data)
        throw new Error('No se recibió una URL de pago válida')
    }

    window.location.href = data.url
}
