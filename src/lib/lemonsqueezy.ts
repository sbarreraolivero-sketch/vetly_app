import { supabase } from './supabase'

// ──────────────────────────────────────────────
// LemonSqueezy — International Payments (USD)
// ──────────────────────────────────────────────

/**
 * USD Plan Prices for LemonSqueezy
 */
export const LS_PLANS = {
    essence: {
        id: 'essence',
        name: 'Essence',
        tagline: 'Control Esencial y Automatización',
        price: 97,
        currency: 'USD',
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
        price: 159,
        currency: 'USD',
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
        price: 297,
        currency: 'USD',
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

export type LSPlanId = keyof typeof LS_PLANS

/**
 * USD Credit Packs — GPT-4o-mini
 */
export const LS_CREDIT_PACKS = {
    'pack_500':  { id: 'pack_500',  name: 'Pack Inicial',    credits: 500,  price: 5,  description: '500 Créditos de IA' },
    'pack_1500': { id: 'pack_1500', name: 'Pack Pro',        credits: 1500, price: 12, description: '1500 Créditos de IA' },
    'pack_4000': { id: 'pack_4000', name: 'Pack Enterprise',  credits: 4000, price: 25, description: '4000 Créditos de IA' },
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

/**
 * Creates a LemonSqueezy checkout for AI credit packs.
 */
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
