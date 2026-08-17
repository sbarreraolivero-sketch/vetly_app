import type { PageKey } from './permissions'

/**
 * ════════════════════════════════════════════════════════════════════════════
 * FUENTE ÚNICA DE VERDAD DE PLANES — lado frontend
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Espejo de la tabla `plan_limits` de la base de datos, que es la autoridad
 * del backend (la leen `invite_member_v2` y las edge functions vía
 * `supabase/functions/_shared/planLimits.ts`).
 *
 * ⚠️ Si cambias un número aquí, cámbialo también en `plan_limits`:
 *      UPDATE plan_limits SET max_users = X WHERE plan_id = 'core';
 *
 * Antes de este archivo el mapeo estaba duplicado en 8 lugares con valores
 * divergentes. No vuelvas a hardcodear límites fuera de aquí.
 */

export const PLAN_ORDER = ['core', 'starter', 'pro', 'enterprise'] as const
export type PlanId = (typeof PLAN_ORDER)[number]

export interface PlanLimits {
    /** Posición en la escalera. Se compara con >= para el gating. */
    rank: number
    maxUsers: number
    maxAgendas: number
    /** null = ilimitado. Pool compartido entre recordatorios de citas y médicos. */
    monthlyReminders: number | null
    aiCredits: number
    /** Core solo tiene el recordatorio de 24h (el que evita el no-show). */
    allows2hReminder: boolean
}

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
    core: {
        rank: 0,
        maxUsers: 3,
        maxAgendas: 1,
        monthlyReminders: 25,
        aiCredits: 0,
        allows2hReminder: false,
    },
    starter: {
        rank: 1,
        maxUsers: 5,
        maxAgendas: 3,
        monthlyReminders: 100,
        aiCredits: 5000,
        allows2hReminder: true,
    },
    pro: {
        rank: 2,
        maxUsers: 10,
        maxAgendas: 5,
        monthlyReminders: 250,
        aiCredits: 10000,
        allows2hReminder: true,
    },
    enterprise: {
        rank: 3,
        maxUsers: 999999,
        maxAgendas: 999999,
        monthlyReminders: null,
        aiCredits: 30000,
        allows2hReminder: true,
    },
}

/** IDs legacy que siguen vivos en la DB de producción. */
export const PLAN_LEGACY_MAP: Record<string, PlanId> = {
    essence: 'starter',
    radiance: 'pro',
    prestige: 'enterprise',
}

/**
 * Normaliza un ID de plan que puede venir legacy.
 * Fallback a 'starter' (no a 'core') a propósito: un plan desconocido debe
 * fallar hacia el lado permisivo, nunca dejar a un cliente sin acceso.
 */
export function normalizePlanId(planId: string | null | undefined): PlanId {
    if (!planId) return 'starter'
    if ((PLAN_ORDER as readonly string[]).includes(planId)) return planId as PlanId
    return PLAN_LEGACY_MAP[planId] ?? 'starter'
}

/**
 * Plan mínimo requerido por página. Lo que no aparece aquí está disponible
 * en todos los planes, incluido Core.
 *
 * Core es la puerta de entrada del negocio: gestión completa (citas, fichas,
 * finanzas, inventario, fidelización) más recordatorios. Lo que se reserva
 * son las secciones que solo tienen sentido con el agente IA activo.
 */
export const PAGE_MIN_PLAN: Partial<Record<PageKey, PlanId>> = {
    messages: 'starter',    // bandeja de conversaciones: sin agente no se alimenta
    ai_settings: 'starter', // configuración del agente y créditos
    crm: 'starter',         // el kanban de prospectos lo llena el agente
}

/** ¿El plan actual alcanza el mínimo requerido? */
export function planMeets(current: PlanId, required: PlanId): boolean {
    return PLAN_LIMITS[current].rank >= PLAN_LIMITS[required].rank
}

/**
 * Límites de un ID de plan crudo (acepta legacy). Devuelve `null` si el plan es
 * desconocido, para que el llamador pueda conservar su propio fallback en vez de
 * asumir uno. Úsalo cuando "plan desconocido" y "plan conocido" deban tratarse distinto;
 * si no, `PLAN_LIMITS[normalizePlanId(x)]` es más directo.
 */
export function getPlanLimits(rawPlanId: string | null | undefined): PlanLimits | null {
    if (!rawPlanId) return null
    const key = rawPlanId.trim()
    if ((PLAN_ORDER as readonly string[]).includes(key)) return PLAN_LIMITS[key as PlanId]
    const legacy = PLAN_LEGACY_MAP[key]
    return legacy ? PLAN_LIMITS[legacy] : null
}

/** Forma mínima de la fila de `subscriptions` que necesita la resolución. */
export interface PlanSubscriptionLike {
    plan?: string | null
    plan_id?: string | null
    status?: string | null
    manually_active?: boolean | null
}

const FULL_ACCESS_STATUSES = new Set(['trial', 'trialing'])

export interface EffectivePlan {
    planId: PlanId
    limits: PlanLimits
    /** Cuenta activada a mano (paga por transferencia). Acceso total. */
    isManual: boolean
    /** En periodo de prueba. Acceso total mientras dure. */
    isTrial: boolean
    /** true cuando el acceso no está limitado por plan (manual o trial). */
    hasFullAccess: boolean
}

/**
 * Resuelve el plan efectivo de una suscripción.
 *
 * ⚠️ REGLA DE NO-REGRESIÓN — el orden importa:
 *   1. `manually_active` ⇒ acceso total. Animalgrace paga por transferencia y
 *      tiene `plan='essence'` / `plan_id='prestige'`; sin esta regla podría
 *      perder Mensajes y Ajustes IA.
 *   2. Trial ⇒ acceso total. Es el sentido de la prueba de 30 días, y
 *      `AuthContext` devuelve un `{status:'trial', plan:'trial'}` sintético
 *      cuando no hay fila de suscripción.
 *   3. En otro caso, `plan_id` manda sobre `plan` — en producción discrepan y
 *      `plan_id` es la columna que escribe mercadopago-webhook y lee Settings.
 */
export function resolveEffectivePlan(sub: PlanSubscriptionLike | null | undefined): EffectivePlan {
    const isManual = sub?.manually_active === true
    const isTrial = !!sub?.status && FULL_ACCESS_STATUSES.has(sub.status)

    if (isManual || isTrial) {
        return {
            planId: 'enterprise',
            limits: PLAN_LIMITS.enterprise,
            isManual,
            isTrial,
            hasFullAccess: true,
        }
    }

    const raw = sub?.plan_id?.trim() || sub?.plan?.trim() || null
    const planId = normalizePlanId(raw)

    return {
        planId,
        limits: PLAN_LIMITS[planId],
        isManual: false,
        isTrial: false,
        hasFullAccess: false,
    }
}
