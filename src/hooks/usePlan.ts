import { useMemo } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import {
    resolveEffectivePlan,
    planMeets,
    PAGE_MIN_PLAN,
    PLAN_LIMITS,
    type PlanId,
    type PlanLimits,
} from '@/lib/plans'
import type { PageKey } from '@/lib/permissions'

export interface UsePlanResult {
    /** Plan efectivo ya resuelto (manually_active y trial cuentan como enterprise). */
    planId: PlanId
    limits: PlanLimits
    /** Cuenta activada a mano — paga por transferencia, sin restricción de plan. */
    isManual: boolean
    isTrial: boolean
    /** true cuando nada está limitado por plan (manual o trial). */
    hasFullAccess: boolean
    /** ¿El plan actual alcanza este mínimo? */
    meetsPlan: (required: PlanId) => boolean
    /** ¿El plan actual da acceso a esta página? */
    pageAllowed: (page: PageKey) => boolean
    /** Plan mínimo que exige una página, o null si está en todos los planes. */
    planRequiredFor: (page: PageKey) => PlanId | null
}

/**
 * Gating por PLAN. Complementa a `usePermissions`, que es gating por ROL:
 *   · usePermissions → "¿este usuario puede ver la sección?" (rol y permisos)
 *   · usePlan        → "¿la clínica pagó por esta sección?"  (plan contratado)
 *
 * Ambos deben cumplirse. El rol oculta; el plan bloquea con CTA de upgrade,
 * porque cada bloqueo es un punto de contacto de venta.
 */
export function usePlan(): UsePlanResult {
    const { subscription } = useAuth()

    const effective = useMemo(
        () => resolveEffectivePlan(subscription as any),
        [subscription],
    )

    const meetsPlan = (required: PlanId) =>
        effective.hasFullAccess || planMeets(effective.planId, required)

    const planRequiredFor = (page: PageKey): PlanId | null =>
        PAGE_MIN_PLAN[page] ?? null

    const pageAllowed = (page: PageKey): boolean => {
        const required = PAGE_MIN_PLAN[page]
        if (!required) return true
        return meetsPlan(required)
    }

    return {
        planId: effective.planId,
        limits: effective.limits ?? PLAN_LIMITS.core,
        isManual: effective.isManual,
        isTrial: effective.isTrial,
        hasFullAccess: effective.hasFullAccess,
        meetsPlan,
        pageAllowed,
        planRequiredFor,
    }
}
