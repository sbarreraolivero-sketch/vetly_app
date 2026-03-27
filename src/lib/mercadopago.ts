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
        name: 'Essence',
        tagline: 'Control Esencial y Automatización',
        price: 93000,
        currency: 'CLP',
        monthlyAppointments: 50,
        features: [
            'Hasta 2 usuarios (Acceso compartido)',
            '1 Agente de IA (Soft Luxury)',
            'Hasta 50 citas mensuales',
            'Dashboard básico de Gestión',
            'Integración 1 WhatsApp Business',
        ],
    },
    radiance: {
        id: 'radiance',
        name: 'Radiance',
        tagline: 'Escalamiento Profesional y Retención Activa',
        price: 150000,
        currency: 'CLP',
        monthlyAppointments: -1,
        popular: true,
        features: [
            'Todo lo de Essence, más:',
            'Hasta 5 usuarios (Invitaciones seguras)',
            'CRM Gestión proactiva de prospectos',
            'Campañas de Marketing (WhatsApp masivo)',
            'Módulo de Finanzas y Reportes',
            'Gestión de Servicios + Upselling IA',
            'Citas mensuales ilimitadas',
            'IA Avanzada + Historial Clínico',
            'Analítica de conversaciones pro',
        ],
    },
    prestige: {
        id: 'prestige',
        name: 'Prestige',
        tagline: 'Potencia Empresarial y Multi-Sede',
        price: 280000,
        currency: 'CLP',
        monthlyAppointments: -1,
        features: [
            'Todo lo de Radiance, más:',
            'Usuarios ilimitados (Sin restricciones)',
            'Gestión Multi-sucursal / Sedes',
            'IA 100% Personalizada (Fine-tuning)',
            'Reportes avanzados a medida',
            'Onboarding Concierge VIP',
            'Soporte Prioritario 24/7',
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
