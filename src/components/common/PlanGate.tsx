import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Lock, Sparkles } from 'lucide-react'
import { usePlan } from '@/hooks/usePlan'
import { PLAN_LIMITS, type PlanId } from '@/lib/plans'

/** Ruta canónica al tab de plan. Ojo: `/settings?tab=...` pierde el query param
 *  en el redirect legacy de App.tsx — siempre usar el prefijo `/app`. */
export const UPGRADE_URL = '/app/settings?tab=subscription'

const PLAN_LABEL: Record<PlanId, string> = {
    core: 'Core',
    starter: 'Starter',
    pro: 'Pro',
    enterprise: 'Enterprise',
}

interface PlanGateProps {
    children: ReactNode
    /** Plan mínimo necesario. Por defecto Starter, que es donde entra la IA. */
    requiredPlan?: PlanId
    /**
     * `lock`    — muestra el contenido difuminado con una pastilla de upgrade (default).
     * `hide`    — no renderiza nada.
     * `replace` — renderiza `fallback` en su lugar.
     */
    mode?: 'lock' | 'hide' | 'replace'
    fallback?: ReactNode
    /** Texto de la pastilla. Por defecto, el nombre del plan requerido. */
    label?: string
}

/**
 * Bloquea contenido según el plan contratado.
 *
 * Reemplaza a `PremiumFeature`, que tenía dos defectos: enlazaba a
 * `/settings?tab=subscription` (ruta que pierde el query param) y trataba
 * cualquier `status` distinto de active/trial como "sin plan", dejando fuera a
 * las cuentas activadas a mano. La resolución del plan vive ahora en
 * `resolveEffectivePlan`, que contempla `manually_active` y trial.
 */
export function PlanGate({
    children,
    requiredPlan = 'starter',
    mode = 'lock',
    fallback = null,
    label,
}: PlanGateProps) {
    const { meetsPlan } = usePlan()

    if (meetsPlan(requiredPlan)) return <>{children}</>
    if (mode === 'hide') return null
    if (mode === 'replace') return <>{fallback}</>

    return (
        <div className="relative group" aria-live="polite">
            <div className="opacity-40 blur-[1.5px] pointer-events-none select-none" aria-hidden="true">
                {children}
            </div>
            <div className="absolute inset-0 flex items-center justify-center p-2">
                <Link
                    to={UPGRADE_URL}
                    className="flex items-center gap-1.5 rounded-full bg-charcoal/85 px-3 py-1.5 text-xs font-bold text-white shadow-soft-md backdrop-blur-sm transition-colors hover:bg-charcoal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                >
                    <Lock className="h-3.5 w-3.5 shrink-0" />
                    {label ?? `Desde ${PLAN_LABEL[requiredPlan]}`}
                </Link>
            </div>
        </div>
    )
}

interface PlanUpgradeScreenProps {
    requiredPlan: PlanId
    /** Nombre de la sección, para el título. */
    sectionName: string
    description?: string
}

/**
 * Pantalla completa de upgrade. Se usa en las rutas bloqueadas en vez de
 * redirigir: el enlace directo sigue siendo una superficie de venta, y el
 * usuario entiende qué se está perdiendo en vez de rebotar al dashboard.
 */
export function PlanUpgradeScreen({ requiredPlan, sectionName, description }: PlanUpgradeScreenProps) {
    const credits = PLAN_LIMITS[requiredPlan].aiCredits

    return (
        <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-16 text-center animate-fade-in">
            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-50">
                <Sparkles className="h-8 w-8 text-primary-600" />
            </div>

            <p className="mb-2 text-xs font-black uppercase tracking-widest text-primary-600">
                Disponible desde {PLAN_LABEL[requiredPlan]}
            </p>
            <h1 className="mb-3 text-2xl font-extrabold tracking-tight text-charcoal sm:text-3xl">
                {sectionName} necesita el agente IA
            </h1>
            <p className="mb-8 max-w-md text-sm leading-relaxed text-charcoal/60">
                {description ??
                    `Esta sección se alimenta de las conversaciones del agente de WhatsApp. El plan ${PLAN_LABEL[requiredPlan]} lo activa con ${credits.toLocaleString('es-CL')} créditos de IA al mes.`}
            </p>

            <Link
                to={UPGRADE_URL}
                className="rounded-xl bg-primary-600 px-6 py-3 text-sm font-bold text-white shadow-soft-md transition-colors hover:bg-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
            >
                Ver planes
            </Link>
        </div>
    )
}
