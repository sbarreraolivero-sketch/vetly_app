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
        tagline: 'Gestión completa, sin IA conversacional',
        price: 39,
        currency: 'USD',
        monthlyAppointments: 0,
        maxUsers: 1,
        maxAgendas: 1,
        features: [
            '1 usuario',
            'Dashboard con métricas',
            'Calendario de citas (manual)',
            'Fichas médicas e historial',
            'CRM de prospectos',
            'Campañas de marketing',
            'Sistema de referidos',
            'Módulo de finanzas',
        ],
        upsells: [
            'Recordatorios: packs de 50, 200 o ilimitados/mes',
            'Mensajes de plantilla: cobro por consumo',
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
            '2.000 créditos IA incluidos/mes',
            'Hasta 50 citas con IA/mes',
            '100 recordatorios/mes',
            'Campañas masivas',
            'Logística móvil (Goldi)',
            'Sistema de referidos con IA',
        ],
    },
    pro: {
        id: 'pro',
        name: 'Pro',
        tagline: 'Para clínicas móviles y físicas en crecimiento',
        price: 169,
        currency: 'USD',
        monthlyAppointments: -1,
        maxUsers: 5,
        maxAgendas: 5,
        popular: true,
        features: [
            'Hasta 5 usuarios (Adm, Prof, Recep, Asist) · 5 agendas',
            'Todo lo de Starter',
            '4.000 créditos IA incluidos/mes',
            'Citas con IA ilimitadas',
            '250 recordatorios/mes',
            'Encuestas de satisfacción',
            'Sistema de referidos con IA',
            'Soporte prioritario',
        ],
    },
    enterprise: {
        id: 'enterprise',
        name: 'Enterprise',
        tagline: 'Para redes veterinarias y multi-sucursal',
        price: 379,
        currency: 'USD',
        monthlyAppointments: -1,
        maxUsers: 999999,
        maxAgendas: 999999,
        features: [
            'Todo lo de Pro, más:',
            'Usuarios y agendas ilimitados',
            'Multi-sucursal con dashboard unificado',
            'IA personalizada por especialidad',
            'Recordatorios ilimitados',
            'Benchmark entre sedes',
            'Super Administrador',
            'Soporte prioritario 24/7',
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
