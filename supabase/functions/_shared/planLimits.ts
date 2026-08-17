/**
 * ════════════════════════════════════════════════════════════════════════════
 * LÍMITES POR PLAN — acceso compartido para edge functions
 * ════════════════════════════════════════════════════════════════════════════
 *
 * La autoridad es la tabla `plan_limits` de Postgres. Este módulo la consulta y
 * cae a constantes locales solo si la query falla, para que un hipo de DB nunca
 * rompa un checkout o un alta.
 *
 * Espejos que hay que mantener en sync si cambias un número:
 *   · tabla `plan_limits`  (autoridad — cambiar aquí primero)
 *   · src/lib/plans.ts     (frontend)
 *
 * Antes de esto el mapeo estaba duplicado inline en paddle-webhook,
 * mercadopago-webhook, mercadopago-create-subscription y signup-handler, cada
 * uno con valores distintos y solo algunos entendiendo los IDs nuevos.
 */

export interface PlanLimits {
    plan_id: string;
    rank: number;
    max_users: number;
    max_agendas: number;
    /** null = ilimitado */
    monthly_reminders: number | null;
    ai_credits: number;
    allows_2h_reminder: boolean;
}

/** Fallback local — solo se usa si la consulta a `plan_limits` falla. */
const FALLBACK: Record<string, PlanLimits> = {
    core:       { plan_id: "core",       rank: 0, max_users: 3,      max_agendas: 1,      monthly_reminders: 25,   ai_credits: 0,     allows_2h_reminder: false },
    starter:    { plan_id: "starter",    rank: 1, max_users: 5,      max_agendas: 3,      monthly_reminders: 100,  ai_credits: 5000,  allows_2h_reminder: true  },
    pro:        { plan_id: "pro",        rank: 2, max_users: 10,     max_agendas: 5,      monthly_reminders: 250,  ai_credits: 10000, allows_2h_reminder: true  },
    enterprise: { plan_id: "enterprise", rank: 3, max_users: 999999, max_agendas: 999999, monthly_reminders: null, ai_credits: 30000, allows_2h_reminder: true  },
};

/** IDs legacy que siguen vivos en producción. */
const LEGACY: Record<string, string> = {
    essence: "starter",
    radiance: "pro",
    prestige: "enterprise",
};

/**
 * Normaliza un ID de plan (acepta legacy).
 * Fallback a 'starter' a propósito: un plan desconocido debe fallar hacia el
 * lado permisivo, nunca dejar a un cliente sin acceso.
 */
export function normalizePlan(plan: string | null | undefined): string {
    if (!plan) return "starter";
    const key = plan.trim();
    if (FALLBACK[key]) return key;
    return LEGACY[key] ?? "starter";
}

/** Cache por invocación — una edge function vive poco, no hace falta TTL. */
let cache: Record<string, PlanLimits> | null = null;

/**
 * Devuelve los límites del plan. `sb` es un cliente Supabase con service role.
 * Nunca lanza: ante cualquier fallo cae al mapa local.
 */
export async function limitsForPlan(sb: any, plan: string | null | undefined): Promise<PlanLimits> {
    const normalized = normalizePlan(plan);

    if (!cache) {
        try {
            const { data, error } = await sb.from("plan_limits").select("*");
            if (error) throw error;
            if (Array.isArray(data) && data.length > 0) {
                cache = {};
                for (const row of data) cache[row.plan_id] = row as PlanLimits;
            }
        } catch (e) {
            console.warn("[planLimits] No se pudo leer plan_limits, usando fallback local:", e);
        }
    }

    // La tabla incluye filas legacy, pero se consulta por el ID normalizado para
    // que un plan desconocido resuelva igual que en el fallback.
    return cache?.[normalized] ?? FALLBACK[normalized] ?? FALLBACK.starter;
}
