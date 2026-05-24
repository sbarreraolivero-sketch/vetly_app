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
        price: 33,
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
            'Mensajes de plantilla — cobro por consumo',
        ],
    },
    starter: {
        id: 'starter',
        name: 'Starter',
        tagline: 'Para veterinarios independientes',
        price: 89,
        currency: 'USD',
        monthlyAppointments: 50,
        maxUsers: 2,
        maxAgendas: 1,
        features: [
            '2 usuarios · 1 agenda',
            'Todo lo de Core',
            'Agente IA WhatsApp (Lía)',
            '1.000 créditos IA incluidos/mes',
            'Hasta 50 citas con IA/mes',
            '100 recordatorios/mes',
            'Campañas masivas',
            'Logística móvil (Goldi)',
        ],
    },
    pro: {
        id: 'pro',
        name: 'Pro',
        tagline: 'Para clínicas en crecimiento',
        price: 149,
        currency: 'USD',
        monthlyAppointments: -1,
        maxUsers: 5,
        maxAgendas: 5,
        popular: true,
        features: [
            '5 usuarios · 5 agendas',
            'Todo lo de Starter',
            '4.000 créditos IA incluidos/mes',
            'Citas con IA ilimitadas',
            '250 recordatorios/mes',
            'Encuestas de satisfacción',
            'Soporte prioritario',
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
            '12.000 créditos IA incluidos/mes',
            'Recordatorios ilimitados',
            'Multi-sucursal unificado',
            'IA personalizada por especialidad',
            'Super Administrador',
            'Soporte 24/7 dedicado',
        ],
    },
} as const;

export type LSPlanId = keyof typeof LS_PLANS

/**
 * USD Credit Packs — GPT-4o-mini
 */
export const LS_CREDIT_PACKS = {
    'pack_500':  { id: 'pack_500',  name: 'Pack Inicial',   credits: 500,  price: 9,  description: '500 Créditos de IA' },
    'pack_1500': { id: 'pack_1500', name: 'Pack Pro',       credits: 1500, price: 15, description: '1500 Créditos de IA' },
    'pack_4000': { id: 'pack_4000', name: 'Pack Enterprise', credits: 4000, price: 29, description: '4000 Créditos de IA' },
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
            quantity: Math.max(20, quantity),
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
