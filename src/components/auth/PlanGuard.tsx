import type { ReactNode } from 'react'
import { usePlan } from '@/hooks/usePlan'
import { PlanUpgradeScreen } from '@/components/common/PlanGate'
import type { PlanId } from '@/lib/plans'

interface PlanGuardProps {
    children: ReactNode
    minPlan: PlanId
    /** Nombre de la sección, para el título de la pantalla de upgrade. */
    sectionName: string
    description?: string
}

/**
 * Guard de ruta por PLAN.
 *
 * A diferencia de `RoleGuard`/`PermissionGuard`, que redirigen al dashboard,
 * este renderiza una pantalla de upgrade en la misma ruta: llegar por enlace
 * directo a una sección que no incluye tu plan debe explicar qué falta, no
 * rebotarte sin decir nada.
 */
export function PlanGuard({ children, minPlan, sectionName, description }: PlanGuardProps) {
    const { meetsPlan } = usePlan()

    if (!meetsPlan(minPlan)) {
        return (
            <PlanUpgradeScreen
                requiredPlan={minPlan}
                sectionName={sectionName}
                description={description}
            />
        )
    }

    return <>{children}</>
}
