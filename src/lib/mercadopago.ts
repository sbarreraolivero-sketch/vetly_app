import { supabase } from './supabase'

// ──────────────────────────────────────────────
// Mercado Pago — Chile Local Payments (CLP)
// ──────────────────────────────────────────────

interface CreateSubscriptionParams {
    clinicId: string
    planId: 'core' | 'starter' | 'pro' | 'enterprise'
    email: string
    externalReference?: string
}

interface MercadoPagoPreference {
    id: string
    init_point: string
    sandbox_init_point: string
}

/**
 * Creates a Mercado Pago subscription preference (CLP)
 */
export async function createSubscriptionPreference(
    params: CreateSubscriptionParams
): Promise<MercadoPagoPreference | null> {
    const { clinicId, planId, email, externalReference } = params

    const { data, error } = await supabase.functions.invoke('mercadopago-create-subscription', {
        body: {
            clinic_id: clinicId,
            plan: planId,
            email: email,
            currency: 'CLP',
            external_reference: externalReference || clinicId,
            back_urls: {
                success: `${window.location.origin}/app/settings?payment=success`,
                failure: `${window.location.origin}/app/settings?payment=failure`,
                pending: `${window.location.origin}/app/settings?payment=pending`,
            },
        },
    })

    if (error) {
        console.error('Error creating subscription:', error)
        return null
    }

    return data as MercadoPagoPreference
}

/**
 * Redirects user to Mercado Pago checkout (CLP)
 */
export async function redirectToCheckout(params: CreateSubscriptionParams) {
    const preference = await createSubscriptionPreference(params)

    if (!preference) {
        throw new Error('Failed to create payment preference')
    }

    window.location.href = preference.init_point
}

/**
 * Get subscription details for a clinic
 */
export async function getClinicSubscription(clinicId: string) {
    const { data, error } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('clinic_id', clinicId)
        .single()

    if (error) {
        console.error('Error fetching subscription:', error)
        return null
    }

    return data
}

/**
 * Cancel a subscription
 */
export async function cancelSubscription(subscriptionId: string) {
    const { data, error } = await supabase.functions.invoke('mercadopago-cancel-subscription', {
        body: { subscription_id: subscriptionId },
    })

    if (error) {
        console.error('Error cancelling subscription:', error)
        return { success: false, error }
    }

    return { success: true, data }
}

/**
 * CLP Plan Prices for Mercado Pago (Chile)
 */
export const PLANS = {
    enterprise: {
        id: 'enterprise',
        name: 'Enterprise',
        tagline: 'Redes y multi-sucursal',
        price: 282000,
        currency: 'CLP',
        monthlyAppointmentsMonthly: -1,
        maxUsers: 999999,
        maxAgendas: 999999,
        features: [
            'Usuarios y agendas ilimitados',
            'Todo lo de Pro',
            'Conversaciones IA ilimitadas',
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
    pro: {
        id: 'pro',
        name: 'Pro',
        tagline: 'Para clínicas en crecimiento',
        price: 159000,
        currency: 'CLP',
        monthlyAppointmentsMonthly: -1,
        maxUsers: 5,
        maxAgendas: 5,
        popular: true,
        features: [
            '5 usuarios · 5 agendas',
            'Todo lo de Starter',
            'Conversaciones IA ilimitadas',
            'Citas con IA ilimitadas',
            '250 recordatorios/mes',
            'Encuestas de satisfacción',
            'Soporte prioritario',
        ],
        upsells: [
            'Mensajería masiva de marketing segmentada',
        ],
    },
    starter: {
        id: 'starter',
        name: 'Starter',
        tagline: 'Para veterinarios independientes',
        price: 92000,
        currency: 'CLP',
        monthlyAppointmentsMonthly: 100,
        maxUsers: 2,
        maxAgendas: 1,
        features: [
            '2 usuarios · 1 agenda',
            'Todo lo de Core',
            'Agente IA WhatsApp (Lía)',
            '5.000 créditos IA incluidos/mes',
            '100 citas con IA/mes',
            '100 recordatorios/mes',
            'Logística móvil (Goldi)',
            '¿Más de 100 citas/mes? → Plan Pro',
        ],
        upsells: [
            'Mensajería masiva de marketing segmentada',
        ],
    },
    core: {
        id: 'core',
        name: 'Core',
        tagline: 'Gestión completa sin IA conversacional',
        price: 33000,
        currency: 'CLP',
        monthlyAppointmentsMonthly: 0,
        maxUsers: 1,
        maxAgendas: 1,
        features: [
            '1 usuario · 1 agenda',
            'Dashboard + métricas',
            'Calendario de citas (manual)',
            'Fichas médicas e historial',
            'Módulo de finanzas',
            'Sistema de referidos',
            'Sin recordatorios automáticos',
            'Recordatorios automáticos: disponibles desde Plan Starter',
        ],
        upsells: [
            'Mensajería masiva de marketing segmentada',
        ],
    },
} as const;

export type PlanId = keyof typeof PLANS

/** Maps legacy DB plan IDs to current plan IDs */
export const PLAN_LEGACY_MAP: Record<string, PlanId> = {
    essence: 'starter',
    radiance: 'pro',
    prestige: 'enterprise',
}

/** Resolves a plan ID that may be legacy to the current equivalent */
export function normalizePlanId(planId: string): PlanId {
    if (planId in PLANS) return planId as PlanId
    return PLAN_LEGACY_MAP[planId] ?? 'starter'
}

/**
 * CLP Credit Packs — GPT-4o-mini (económico)
 */
export const CREDIT_PACKS = {
    'pack_500':  { id: 'pack_500',  name: 'Pack Inicial',    credits: 4000,  price: 8000,  description: '4.000 Créditos de IA' },
    'pack_1500': { id: 'pack_1500', name: 'Pack Pro',        credits: 8000,  price: 13000, description: '8.000 Créditos de IA' },
    'pack_4000': { id: 'pack_4000', name: 'Pack Enterprise', credits: 20000, price: 25000, description: '20.000 Créditos de IA' },
} as const

/**
 * CLP Credit Packs — GPT-4o (premium)
 */
export const CREDIT_PACKS_4O = {
    'pack_500_4o': { id: 'pack_500_4o', name: 'Pack Inicial', credits: 500, price: 10000, description: '500 Créditos de IA (GPT-4o)' },
    'pack_1500_4o': { id: 'pack_1500_4o', name: 'Pack Pro', credits: 1500, price: 30000, description: '1500 Créditos de IA (GPT-4o)' },
    'pack_4000_4o': { id: 'pack_4000_4o', name: 'Pack Enterprise', credits: 4000, price: 80000, description: '4000 Créditos de IA (GPT-4o)' },
} as const

export type CreditPackId = keyof typeof CREDIT_PACKS
export type CreditPack4oId = keyof typeof CREDIT_PACKS_4O

/**
 * Redirects user to Mercado Pago for credit pack purchase (CLP)
 */
export async function redirectToCreditsCheckout(clinicId: string, email: string, packId: string, model: 'mini' | '4o' = 'mini') {
    const { data, error } = await supabase.functions.invoke('mercadopago-create-credits-preference', {
        body: {
            clinic_id: clinicId,
            pack_id: packId,
            email: email,
            model: model,
            currency: 'CLP',
            back_urls: {
                success: `${window.location.origin}/app/settings?tab=ai&payment=success`,
                failure: `${window.location.origin}/app/settings?tab=ai&payment=failure`,
                pending: `${window.location.origin}/app/settings?tab=ai&payment=pending`,
            },
        },
    })

    if (error) {
        console.error('Error creating credit preference:', error)
        const msg = error.message || 'Error al conectar con la función de pago'
        throw new Error(`Error en el servidor: ${msg}`)
    }

    if (!data?.init_point) {
        console.error('No init_point returned from function:', data)
        throw new Error('La respuesta del servidor no fue válida')
    }

    window.location.href = data.init_point
}
