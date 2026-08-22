/**
 * ════════════════════════════════════════════════════════════════════════════
 * CRÉDITOS DE IA — cálculo compartido entre los webhooks del agente
 * ════════════════════════════════════════════════════════════════════════════
 *
 * `meta-whatsapp-webhook` y `ycloud-whatsapp-webhook` son archivos espejo que
 * duplican la lógica del agente. Antes cada uno calculaba el consumo por su
 * cuenta, y eso permitió que MEDIR y COBRAR divergieran:
 *
 *   · se cobraba  `model === "mini" ? 1 : 15`   (corregido en sesión 36)
 *   · se medía    `miniUsed + oUsed * 8`        (quedó sin corregir)
 *
 * Resultado: el chequeo de cuota creía que se había gastado la mitad de lo que
 * realmente se había cobrado. Con este módulo hay una sola constante
 * (`CREDIT_COST_4O`) para ambas cosas, así que no pueden volver a separarse.
 */

/** Coste en créditos de un mensaje GPT-4o. Un mensaje `mini` cuesta 1. */
export const CREDIT_COST_4O = 15;

/** Límite mensual por defecto cuando la clínica no tiene uno configurado. */
const DEFAULT_MONTHLY_LIMIT = 500;

export interface CreditStatus {
    /** Clínica raíz del pool — las sucursales comparten los créditos del padre. */
    poolId: string;
    /** La clínica tiene créditos ilimitados: nunca se agota. */
    unlimited: boolean;
    totalUsed: number;
    /** Límite mensual del plan (sin contar packs extra). */
    limit: number;
    /** Saldo de packs comprados, ya descontando los vencidos. */
    extraBalance: number;
    /** true cuando ya no quedan créditos: el agente no debe responder. */
    exhausted: boolean;
}

/** Coste en créditos de un mensaje según el modelo que lo generó. */
export function creditCostForModel(model: string | null | undefined): number {
    return model === "mini" ? 1 : CREDIT_COST_4O;
}

/**
 * Estado de créditos del pool al que pertenece la clínica.
 *
 * Nunca lanza: ante cualquier fallo devuelve `exhausted: false`, para que un
 * problema de lectura no deje mudo al agente de una clínica que sí tiene saldo.
 * Prefiere pasarse de generoso antes que cortar por error.
 */
export async function getCreditStatus(sb: any, clinicId: string): Promise<CreditStatus> {
    const fallback: CreditStatus = {
        poolId: clinicId,
        unlimited: false,
        totalUsed: 0,
        limit: DEFAULT_MONTHLY_LIMIT,
        extraBalance: 0,
        exhausted: false,
    };

    try {
        // Las sucursales consumen del pool de su clínica madre.
        const { data: poolRow } = await sb
            .from("clinic_settings")
            .select("parent_clinic_id")
            .eq("id", clinicId)
            .single();
        const poolId: string = poolRow?.parent_clinic_id || clinicId;

        const { data: pool } = await sb
            .from("clinic_settings")
            .select(
                "ai_credits_unlimited,ai_credits_monthly_mini_used,ai_credits_monthly_4o_used," +
                "ai_credits_monthly_limit,ai_credits_extra_balance,ai_credits_extra_4o,ai_credits_extra_expires_at",
            )
            .eq("id", poolId)
            .single();

        if (!pool) return { ...fallback, poolId };

        if (pool.ai_credits_unlimited) {
            return { ...fallback, poolId, unlimited: true };
        }

        const miniUsed = pool.ai_credits_monthly_mini_used || 0;
        const oUsed = pool.ai_credits_monthly_4o_used || 0;
        const totalUsed = miniUsed + oUsed * CREDIT_COST_4O;

        const limit = pool.ai_credits_monthly_limit ?? DEFAULT_MONTHLY_LIMIT;

        const rawExtra = (pool.ai_credits_extra_balance || 0) + (pool.ai_credits_extra_4o || 0);
        const extrasExpired = pool.ai_credits_extra_expires_at
            ? new Date(pool.ai_credits_extra_expires_at) < new Date()
            : false;
        const extraBalance = extrasExpired ? 0 : rawExtra;

        // Los packs vencidos se ponen a cero en segundo plano: es limpieza, no
        // debe retrasar la respuesta al cliente.
        if (extrasExpired && rawExtra > 0) {
            sb.from("clinic_settings")
                .update({ ai_credits_extra_balance: 0, ai_credits_extra_4o: 0, ai_credits_extra_expires_at: null })
                .eq("id", poolId);
        }

        return {
            poolId,
            unlimited: false,
            totalUsed,
            limit,
            extraBalance,
            exhausted: totalUsed >= limit + extraBalance,
        };
    } catch (e) {
        console.error("[aiCredits] No se pudo calcular el saldo, se deja pasar:", e);
        return fallback;
    }
}

/**
 * Avisa a la clínica de que se quedó sin créditos, **una sola vez al mes**.
 *
 * Sin el chequeo de idempotencia se insertaría una notificación por cada
 * mensaje entrante, que es justo cuando más mensajes llegan sin responder.
 * Devuelve true si creó la notificación.
 */
export async function notifyCreditsExhausted(sb: any, clinicId: string, poolId: string): Promise<boolean> {
    try {
        const monthStart = new Date();
        monthStart.setUTCDate(1);
        monthStart.setUTCHours(0, 0, 0, 0);

        const { data: existing } = await sb
            .from("notifications")
            .select("id")
            .eq("clinic_id", clinicId)
            .eq("type", "ai_credits_exhausted")
            .gte("created_at", monthStart.toISOString())
            .limit(1);

        if (existing && existing.length > 0) return false;

        const { error } = await sb.from("notifications").insert({
            clinic_id: clinicId,
            type: "ai_credits_exhausted",
            title: "Se acabaron tus créditos de IA 🤖",
            message:
                "El agente dejó de responder por WhatsApp hasta que renueves o compres más créditos. " +
                "Los mensajes que lleguen quedan guardados en Mensajes para que los respondas tú.",
            link: "/app/settings?tab=subscription",
            is_read: false,
        });

        if (error) {
            console.error("[aiCredits] Error insertando notificación de créditos agotados:", error);
            return false;
        }

        console.warn(`[aiCredits] Créditos agotados en el pool ${poolId} — clínica ${clinicId} notificada`);
        return true;
    } catch (e) {
        console.error("[aiCredits] Falló la notificación de créditos agotados:", e);
        return false;
    }
}
