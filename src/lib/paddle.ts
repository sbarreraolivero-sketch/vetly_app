import { supabase } from './supabase'
import type { Paddle, PaddleEventData } from '@paddle/paddle-js'

// ──────────────────────────────────────────────
// Paddle — International Payments (USD)
// Reemplaza a lemonsqueezy.ts. Checkout es overlay (Paddle.js), no redirect:
// las funciones abren el modal y retornan de inmediato — el provisioning
// real ocurre vía paddle-webhook cuando el pago se completa.
// ──────────────────────────────────────────────

const PADDLE_ENVIRONMENT = (import.meta.env.VITE_PADDLE_ENVIRONMENT || 'sandbox') as 'sandbox' | 'production'
const PADDLE_CLIENT_TOKEN = import.meta.env.VITE_PADDLE_CLIENT_TOKEN || ''

/**
 * USD Plan Prices for Paddle
 *
 * ⚠️ Los límites (usuarios, agendas, recordatorios, créditos) NO viven aquí.
 * La fuente única es `src/lib/plans.ts` (espejo de la tabla `plan_limits`).
 * Este objeto solo define precios, priceIds y textos de marketing.
 */
export const PADDLE_PLANS = {
    enterprise: {
        id: 'enterprise',
        priceId: 'pri_01m08n7n2szbs4b60bpk7s7cyz',
        priceIdAnnual: null as string | null,
        name: 'Enterprise',
        tagline: 'Redes y multi-sucursal',
        price: 349,
        annualTotal: 3350,
        currency: 'USD',
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
        upsells: ['Mensajería masiva de marketing segmentada'],
    },
    pro: {
        id: 'pro',
        priceId: 'pri_01m08n7mmevsf38b3rvcnwb413',
        priceIdAnnual: null as string | null,
        name: 'Pro',
        tagline: 'Para clínicas en crecimiento',
        price: 169,
        annualTotal: 1622,
        currency: 'USD',
        popular: true,
        features: [
            '10 usuarios · 5 agendas',
            'Todo lo de Starter',
            'Conversaciones IA ilimitadas',
            'Citas con IA ilimitadas',
            '250 recordatorios/mes',
            'Encuestas de satisfacción',
            'Soporte prioritario',
        ],
        upsells: ['Mensajería masiva de marketing segmentada'],
    },
    starter: {
        id: 'starter',
        priceId: 'pri_01m08n7m4gka018x4v7egh05s6',
        priceIdAnnual: null as string | null,
        name: 'Starter',
        tagline: 'Para veterinarios independientes',
        price: 89,
        annualTotal: 854,
        currency: 'USD',
        features: [
            '5 usuarios · 3 agendas',
            'Todo lo de Core',
            'Agente IA WhatsApp (Lía)',
            '5.000 créditos IA incluidos/mes',
            '100 citas con IA/mes',
            '100 recordatorios automáticos/mes',
            'Logística móvil (Goldi)',
            '¿Más de 100 citas/mes? → Plan Pro',
        ],
        upsells: ['Mensajería masiva de marketing segmentada'],
    },
    core: {
        id: 'core',
        priceId: 'pri_01m08n7kjtxc9zcr658hhx5dem',
        // Precio anual: lista US$390, con LANZAMIENTO17_ANUAL queda en US$170.
        priceIdAnnual: 'pri_01m08n7kr97dvkw2bgnq487nrv' as string | null,
        name: 'Core',
        tagline: 'Gestión completa sin IA conversacional',
        price: 39,
        annualTotal: 390,
        currency: 'USD',
        features: [
            '3 usuarios · 1 agenda',
            'Dashboard + métricas',
            'Calendario de citas (manual)',
            'Fichas médicas e historial',
            'Módulo de finanzas',
            'Módulo de inventario',
            'Fidelización y referidos',
            'Recordatorios por WhatsApp sin límite (envío manual)',
            '25 recordatorios automáticos/mes',
        ],
        upsells: ['Mensajería masiva de marketing segmentada'],
    },
} as const

export type PaddlePlanId = keyof typeof PADDLE_PLANS

/** Descuento de lanzamiento — solo Core mensual, $22 off, tope 100 usos → US$17/mes */
const LAUNCH_DISCOUNT_ID = 'dsc_01m08n7n90393n8475731cyz2p'

/** Descuento de lanzamiento — solo Core anual, $220 off sobre $390, tope 100 usos → US$170/año */
const LAUNCH_DISCOUNT_ID_ANNUAL = 'dsc_01m08n7njmh39pfsyekz543j12'

/** Periodo de facturación de una suscripción. */
export type BillingPeriod = 'month' | 'year'

/**
 * USD Credit Packs — GPT-4o-mini
 * priceId de producción, creados vía scripts/create-paddle-packs.js.
 */
export const PADDLE_CREDIT_PACKS = {
    pack_500:  { id: 'pack_500',  priceId: 'pri_01m08n6jtwaghvs8n0e43cme03', name: 'Pack Inicial',    credits: 4000,  price: 9,  description: '4.000 Créditos de IA' },
    pack_1500: { id: 'pack_1500', priceId: 'pri_01m08n6k7a2fdy0za42cgj0cvt', name: 'Pack Pro',        credits: 8000,  price: 15, description: '8.000 Créditos de IA' },
    pack_4000: { id: 'pack_4000', priceId: 'pri_01m08n6kr39wex154w9z14m20d', name: 'Pack Enterprise', credits: 20000, price: 29, description: '20.000 Créditos de IA' },
} as const

/**
 * USD Credit Packs — GPT-4o (Premium)
 */
export const PADDLE_CREDIT_PACKS_4O = {
    pack_500_4o:  { id: 'pack_500_4o',  priceId: 'pri_01m08n6m4t7eh3d085164bq6yw', name: 'Pack Inicial',    credits: 500,  price: 10, description: '500 Créditos de IA (GPT-4o)' },
    pack_1500_4o: { id: 'pack_1500_4o', priceId: 'pri_01m08n6mhkyqmkp2ky6enggcnz', name: 'Pack Pro',        credits: 1500, price: 30, description: '1500 Créditos de IA (GPT-4o)' },
    pack_4000_4o: { id: 'pack_4000_4o', priceId: 'pri_01m08n6my0zs6cf6813jhwzwfm', name: 'Pack Enterprise', credits: 4000, price: 80, description: '4000 Créditos de IA (GPT-4o)' },
} as const

export type PaddleCreditPackId = keyof typeof PADDLE_CREDIT_PACKS

export type ReminderPackId = 'reminders_50' | 'reminders_350' | 'reminders_unlimited'

/**
 * Reminder Packs — fixed quantity bundles.
 * priceId de producción, creados vía scripts/create-paddle-packs.js.
 * Cantidad acreditada (reminders_50→80, mismo comportamiento que hoy en LS, ver
 * CLAUDE.md sesión 16/66) vive en el webhook, no aquí.
 */
export const PADDLE_REMINDER_PACKS: Record<ReminderPackId, { id: ReminderPackId; priceId: string; units: number; price: number }> = {
    reminders_50:        { id: 'reminders_50',        priceId: 'pri_01m08n6narh5jy87pebwncr791', units: 80,   price: 9 },
    reminders_350:       { id: 'reminders_350',       priceId: 'pri_01m08n6npnhy0cg2r7ffpmkf6c', units: 350,  price: 19 },
    reminders_unlimited: { id: 'reminders_unlimited', priceId: 'pri_01m08n6p4svwas57ckspazzrqg', units: 9999, price: 29 },
}

// ──────────────────────────────────────────────
// Carga lazy de Paddle.js — solo se baja cuando se necesita abrir un checkout
// ──────────────────────────────────────────────

let paddleInstancePromise: Promise<Paddle | undefined> | null = null

async function getPaddle(): Promise<Paddle | undefined> {
    if (!PADDLE_CLIENT_TOKEN) {
        console.error('VITE_PADDLE_CLIENT_TOKEN no está configurado')
        throw new Error('Paddle no está configurado en este entorno')
    }
    if (!paddleInstancePromise) {
        paddleInstancePromise = (async () => {
            const { initializePaddle } = await import('@paddle/paddle-js')
            return initializePaddle({
                token: PADDLE_CLIENT_TOKEN,
                environment: PADDLE_ENVIRONMENT,
            })
        })()
    }
    return paddleInstancePromise
}

interface OpenCheckoutOpts {
    items: { priceId: string; quantity?: number }[]
    discountId?: string
    customData: Record<string, string>
    email: string
    transactionId?: string
}

async function openCheckout(opts: OpenCheckoutOpts) {
    const paddle = await getPaddle()
    if (!paddle) throw new Error('No se pudo inicializar Paddle')

    if (opts.transactionId) {
        paddle.Checkout.open({ transactionId: opts.transactionId, customer: { email: opts.email } })
        return
    }

    paddle.Checkout.open({
        items: opts.items,
        discountId: opts.discountId,
        customer: { email: opts.email },
        customData: opts.customData,
    })
}

/**
 * Suscribe un callback a los eventos del checkout de Paddle (ej. checkout.completed).
 * Debe llamarse ANTES de abrir el checkout — Paddle solo permite un eventCallback
 * global por instancia, seteado en initializePaddle. Usamos un registro interno
 * para poder despachar a quien esté escuchando en cada momento.
 */
type PaddleEventListener = (event: PaddleEventData) => void
let currentListener: PaddleEventListener | null = null

async function ensureEventDispatcher() {
    if (!PADDLE_CLIENT_TOKEN) return
    if (!paddleInstancePromise) {
        paddleInstancePromise = (async () => {
            const { initializePaddle } = await import('@paddle/paddle-js')
            return initializePaddle({
                token: PADDLE_CLIENT_TOKEN,
                environment: PADDLE_ENVIRONMENT,
                eventCallback: (event) => {
                    currentListener?.(event)
                },
            })
        })()
    }
    await paddleInstancePromise
}

/**
 * Registra un callback para los eventos del overlay de Paddle antes de abrir
 * un checkout. Las páginas consumidoras lo usan para refrescar balance/plan al
 * completarse el pago (event.name === 'checkout.completed') y para resetear su
 * estado de "cargando" si el usuario cierra el overlay sin pagar
 * (event.name === 'checkout.closed') — a diferencia de LS, el overlay no navega
 * fuera de la página en ningún caso, así que ambos casos hay que manejarlos a mano.
 */
export function onPaddleCheckoutEvent(callback: (event: PaddleEventData) => void) {
    currentListener = callback
}

// ──────────────────────────────────────────────
// Checkouts de catálogo fijo (planes y packs)
// ──────────────────────────────────────────────

/** ¿Este plan puede contratarse en modalidad anual? */
export function planSupportsAnnual(planId: PaddlePlanId): boolean {
    return !!PADDLE_PLANS[planId].priceIdAnnual
}

export async function openPaddleSubscriptionCheckout(
    clinicId: string,
    email: string,
    planId: PaddlePlanId,
    period: BillingPeriod = 'month',
) {
    const plan = PADDLE_PLANS[planId]
    // Si se pide anual pero el plan aún no tiene precio anual creado en Paddle,
    // se cae a mensual en vez de romper el checkout con un priceId vacío.
    const useAnnual = period === 'year' && !!plan.priceIdAnnual
    const priceId = useAnnual ? (plan.priceIdAnnual as string) : plan.priceId

    await ensureEventDispatcher()
    await openCheckout({
        items: [{ priceId, quantity: 1 }],
        discountId: planId === 'core'
            ? (useAnnual ? LAUNCH_DISCOUNT_ID_ANNUAL : LAUNCH_DISCOUNT_ID)
            : undefined,
        customData: {
            clinic_id: clinicId,
            type: 'subscription',
            plan: planId,
            billing_period: useAnnual ? 'year' : 'month',
        },
        email,
    })
}

export async function openPaddleCreditsCheckout(clinicId: string, email: string, packId: string, model: 'mini' | '4o' = 'mini') {
    const pack = model === '4o'
        ? PADDLE_CREDIT_PACKS_4O[packId as keyof typeof PADDLE_CREDIT_PACKS_4O]
        : PADDLE_CREDIT_PACKS[packId as keyof typeof PADDLE_CREDIT_PACKS]
    if (!pack) throw new Error(`Pack de créditos no encontrado: ${packId}`)

    await ensureEventDispatcher()
    await openCheckout({
        items: [{ priceId: pack.priceId, quantity: 1 }],
        customData: { clinic_id: clinicId, type: 'ai_credits', model, credits: String(pack.credits) },
        email,
    })
}

export async function openPaddleReminderPackCheckout(clinicId: string, email: string, packId: ReminderPackId) {
    const pack = PADDLE_REMINDER_PACKS[packId]
    if (!pack) throw new Error(`Pack de recordatorios no encontrado: ${packId}`)

    await ensureEventDispatcher()
    await openCheckout({
        items: [{ priceId: pack.priceId, quantity: 1 }],
        customData: { clinic_id: clinicId, type: 'reminders', quantity: String(pack.units) },
        email,
    })
}

// ──────────────────────────────────────────────
// Checkouts de monto variable — requieren transacción draft creada en backend
// (el precio SIEMPRE se calcula server-side en paddle-create-transaction)
// ──────────────────────────────────────────────

async function createDraftTransaction(clinicId: string, type: 'reminders' | 'campaign_credits', quantity: number): Promise<string> {
    const { data, error } = await supabase.functions.invoke('paddle-create-transaction', {
        body: { clinic_id: clinicId, type, quantity },
    })

    if (error) {
        console.error('Error creating Paddle draft transaction:', error)
        throw new Error(error.message || 'Error al conectar con Paddle')
    }
    if (!data?.transaction_id) {
        const msg = data?.details || data?.error || 'No se recibió una transacción válida'
        console.error('Draft transaction error:', data)
        throw new Error(msg)
    }
    return data.transaction_id
}

/**
 * Checkout de recordatorios por unidad. Precio: US$0.15/unidad, mínimo 10.
 */
export async function openPaddleRemindersUnitsCheckout(clinicId: string, email: string, quantity: number) {
    const transactionId = await createDraftTransaction(clinicId, 'reminders', Math.max(10, quantity))
    await ensureEventDispatcher()
    await openCheckout({ items: [], customData: {}, email, transactionId })
}

/**
 * Checkout de créditos de campaña. Precio: US$0.15/crédito, mínimo 50, sin vencimiento.
 */
export async function openPaddleCampaignCreditsCheckout(clinicId: string, email: string, quantity: number) {
    const transactionId = await createDraftTransaction(clinicId, 'campaign_credits', Math.max(50, quantity))
    await ensureEventDispatcher()
    await openCheckout({ items: [], customData: {}, email, transactionId })
}
