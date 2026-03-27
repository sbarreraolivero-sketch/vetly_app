import { supabase } from './supabase'

// ──────────────────────────────────────────────
// Mercado Pago — Chile Local Payments (CLP)
// ──────────────────────────────────────────────

interface CreateSubscriptionParams {
    clinicId: string
    planId: 'essence' | 'radiance' | 'prestige'
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
    essence: {
        id: 'essence',
        name: 'Plan Essence',
        tagline: 'Ideal para Veterinarios Independientes y Clínicas Pequeñas',
        price: 93000,
        currency: 'CLP',
        monthlyAppointmentsMonthly: 50,
        maxUsers: 2,
        maxAgendas: 1,
        features: [
            'Hasta 2 Usuarios',
            'Agente de IA especializado veterinario',
            'Integración Google Maps (Geolocalización)',
            'Hasta 50 citas automatizadas mensuales',
            'Hasta 1 agenda disponible',
            'Fichas clínicas + historial médico',
            'Dashboard con Métricas (Ranking, Conversión)',
            'Integración oficial WhatsApp (Meta)',
        ],
    },
    radiance: {
        id: 'radiance',
        name: 'Plan Radiance',
        tagline: 'Para clínicas en pleno crecimiento (Móviles o físicas)',
        price: 150000,
        currency: 'CLP',
        monthlyAppointmentsMonthly: -1,
        maxUsers: 5,
        maxAgendas: 5,
        popular: true,
        features: [
            'Todo lo de Essence, más:',
            'Hasta 5 usuarios (Adm, Prof, Rec)',
            '5 agendas independientes disponibles',
            'Recordatorios de vacunas/desparasitación IA',
            'Recordatorios confirmación (Hasta 50/mes)',
            'CRM de ventas para prospectos',
            'Marketing vía WhatsApp masivo',
            'Sistema Inteligente de Referidos con IA',
            'Módulo de Gestión Financiera',
            'Encuestas de satisfacción personalizadas',
        ],
    },
    prestige: {
        id: 'prestige',
        name: 'Prestige',
        tagline: 'Top de línea para redes veterinarias',
        price: 280000,
        currency: 'CLP',
        monthlyAppointmentsMonthly: -1,
        maxUsers: 1000,
        maxAgendas: 1000,
        features: [
            'Todo lo de Radiance, más:',
            'Usuarios ilimitados',
            'Multi-sucursal / Multi-hospital',
            'IA personalizada (especialidades)',
            'Recordatorios confirmación ilimitados',
            'Benchmark entre sedes. Super Administrador',
        ],
    },
} as const;

export type PlanId = keyof typeof PLANS

/**
 * CLP Credit Packs — GPT-4o-mini (económico)
 */
export const CREDIT_PACKS = {
    'pack_500':  { id: 'pack_500',  name: 'Pack Inicial',    credits: 500,  price: 5000,  description: '500 Créditos de IA' },
    'pack_1500': { id: 'pack_1500', name: 'Pack Pro',        credits: 1500, price: 12000, description: '1500 Créditos de IA' },
    'pack_4000': { id: 'pack_4000', name: 'Pack Enterprise',  credits: 4000, price: 25000, description: '4000 Créditos de IA' },
} as const

/**
 * CLP Credit Packs — GPT-4o (premium)
 */
export const CREDIT_PACKS_4O = {
    'pack_500_4o':  { id: 'pack_500_4o',  name: 'Pack Inicial',    credits: 500,  price: 10000, description: '500 Créditos de IA (GPT-4o)' },
    'pack_1500_4o': { id: 'pack_1500_4o', name: 'Pack Pro',        credits: 1500, price: 30000, description: '1500 Créditos de IA (GPT-4o)' },
    'pack_4000_4o': { id: 'pack_4000_4o', name: 'Pack Enterprise',  credits: 4000, price: 80000, description: '4000 Créditos de IA (GPT-4o)' },
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
