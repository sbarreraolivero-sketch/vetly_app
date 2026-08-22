/**
 * useAICreditsStatus — refleja en el frontend el mismo cálculo de saldo que
 * hace el webhook (`getCreditStatus` en `supabase/functions/_shared/aiCredits.ts`)
 * para decidir si el agente responde por WhatsApp o se queda mudo.
 *
 * Sin esto, cualquier indicador de "IA Activa" solo mira `ai_auto_respond`
 * (el toggle manual) y miente cuando el agente está callado por falta de
 * créditos — el toggle sigue en `true`, pero no responde nada (sesión 83).
 *
 * ⚠️ `CREDIT_COST_4O` debe coincidir siempre con la constante del mismo
 * nombre en `_shared/aiCredits.ts`. Son dos runtimes distintos (Deno vs.
 * Vite/React) que no pueden compartir el archivo — si se cambia una, hay
 * que cambiar la otra.
 */
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

const CREDIT_COST_4O = 15
const DEFAULT_MONTHLY_LIMIT = 500

// Umbral de aviso pedido en sesión 83: "cuando llegue a los 27.000 créditos
// consumidos" — para AnimalGrace (30.000 de plan base) eso es exactamente
// 90%. Expresado como razón (no como número fijo) para que generalice bien
// a cualquier plan: Starter avisa a los 4.500/5.000, Pro a los 9.000/10.000.
const WARNING_THRESHOLD_RATIO = 0.9

export interface AICreditsStatus {
    loading: boolean
    unlimited: boolean
    /** true cuando ya no quedan créditos — el agente está mudo. */
    exhausted: boolean
    /** true al llegar al 90% del saldo, mientras aún no está agotado. */
    nearLimit: boolean
    totalUsed: number
    totalAvailable: number
}

const IDLE: AICreditsStatus = { loading: false, unlimited: false, exhausted: false, nearLimit: false, totalUsed: 0, totalAvailable: 0 }

export function useAICreditsStatus(clinicId: string | null | undefined): AICreditsStatus {
    const [status, setStatus] = useState<AICreditsStatus>({ ...IDLE, loading: true })

    useEffect(() => {
        let cancelled = false
        if (!clinicId) { setStatus(IDLE); return }

        const load = async () => {
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { data: own } = await (supabase as any)
                    .from('clinic_settings')
                    .select('parent_clinic_id')
                    .eq('id', clinicId)
                    .single()
                const poolId = own?.parent_clinic_id || clinicId

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { data: pool } = await (supabase as any)
                    .from('clinic_settings')
                    .select('ai_credits_unlimited,ai_credits_monthly_mini_used,ai_credits_monthly_4o_used,ai_credits_monthly_limit,ai_credits_extra_balance,ai_credits_extra_4o,ai_credits_extra_expires_at')
                    .eq('id', poolId)
                    .single()

                if (cancelled) return
                if (!pool || pool.ai_credits_unlimited) {
                    setStatus({ ...IDLE, loading: false, unlimited: !!pool?.ai_credits_unlimited })
                    return
                }

                const miniUsed = pool.ai_credits_monthly_mini_used || 0
                const oUsed = pool.ai_credits_monthly_4o_used || 0
                const totalUsed = miniUsed + oUsed * CREDIT_COST_4O
                const limit = pool.ai_credits_monthly_limit ?? DEFAULT_MONTHLY_LIMIT
                const extrasExpired = pool.ai_credits_extra_expires_at ? new Date(pool.ai_credits_extra_expires_at) < new Date() : false
                const extraBalance = extrasExpired ? 0 : (pool.ai_credits_extra_balance || 0) + (pool.ai_credits_extra_4o || 0)
                const totalAvailable = limit + extraBalance
                const exhausted = totalUsed >= totalAvailable

                setStatus({
                    loading: false,
                    unlimited: false,
                    exhausted,
                    nearLimit: !exhausted && totalAvailable > 0 && totalUsed >= totalAvailable * WARNING_THRESHOLD_RATIO,
                    totalUsed,
                    totalAvailable,
                })
            } catch {
                // Falla abierta, igual que el gate real del webhook: ante un error de
                // lectura, mejor mostrar "activa" de más que asustar sin necesidad.
                if (!cancelled) setStatus(IDLE)
            }
        }
        load()
        return () => { cancelled = true }
    }, [clinicId])

    return status
}
