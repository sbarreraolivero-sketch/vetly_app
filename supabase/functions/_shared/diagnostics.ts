// Shared diagnostics toolkit for the Vetly HQ support agent.
// Used by: chat-agent (in-app support), vetly-hq-agent (WhatsApp commands), cron-system-health.

import { createClient } from "npm:@supabase/supabase-js@2";

type Sb = ReturnType<typeof createClient>;

export type Severity = "ok" | "warning" | "critical";

export interface Finding {
    severity: Severity;
    code: string;
    summary: string;
    detail?: string;
    suggestedFix?: string;
}

export interface ClinicHealth {
    clinicId: string;
    clinicName: string;
    status: Severity;
    findings: Finding[];
    balance?: { amount: number; currency: string } | null;
}

// ---- Phone helpers ----
export const normalizePhone = (phone: string): string => {
    if (!phone) return "";
    return phone.replace(/\D/g, "");
};

// ---- YCloud ----
export const sendWhatsApp = async (
    apiKey: string,
    from: string,
    to: string,
    body: string,
): Promise<{ id?: string; status?: string }> => {
    const r = await fetch("https://api.ycloud.com/v2/whatsapp/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify({
            from: normalizePhone(from),
            to: normalizePhone(to),
            type: "text",
            text: { body },
        }),
    });
    const respText = await r.text();
    if (!r.ok) {
        throw new Error(`YCloud send failed (${r.status}): ${respText}`);
    }
    try {
        const d = JSON.parse(respText);
        return { id: d?.id, status: d?.status };
    } catch {
        return {};
    }
};

export const getYCloudBalance = async (
    apiKey: string,
): Promise<{ amount: number; currency: string } | null> => {
    try {
        const r = await fetch("https://api.ycloud.com/v2/balance", {
            headers: { "X-API-Key": apiKey },
        });
        if (!r.ok) return null;
        const data = await r.json();
        if (typeof data?.amount !== "number") return null;
        return { amount: data.amount, currency: data.currency || "USD" };
    } catch {
        return null;
    }
};

// ---- OpenAI connectivity (free, no tokens consumed) ----
export const checkOpenAI = async (
    apiKey: string,
): Promise<{ ok: boolean; status: number; detail?: string }> => {
    try {
        const r = await fetch("https://api.openai.com/v1/models", {
            headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (r.ok) return { ok: true, status: r.status };
        const txt = await r.text();
        return { ok: false, status: r.status, detail: txt.slice(0, 300) };
    } catch (e) {
        return { ok: false, status: 0, detail: String(e) };
    }
};

// ---- Error pattern classification ----
// Maps known log signatures to the human-readable cause that "mutes" an agent.
const ERROR_PATTERNS: { match: RegExp; code: string; summary: string; severity: Severity; fix: string }[] = [
    {
        match: /BALANCE_INSUFFICIENT|insufficient.*balance|saldo/i,
        code: "ycloud_balance",
        summary: "Saldo de YCloud insuficiente — los mensajes no se envían.",
        severity: "critical",
        fix: "Recarga la cuenta de YCloud de la clínica afectada.",
    },
    {
        match: /WHATSAPP_TEMPLATE_UNAVAILABLE|template.*unavailable|template.*not.*found/i,
        code: "wa_template",
        summary: "Template de WhatsApp no disponible/aprobado (403).",
        severity: "critical",
        fix: "Crea o aprueba el template en el dashboard de YCloud, o desactiva ese recordatorio.",
    },
    {
        match: /401|unauthorized|signature mismatch|invalid.*signature/i,
        code: "hmac_401",
        summary: "Firma HMAC inválida o secret mal configurado (401).",
        severity: "critical",
        fix: "Revisa el Webhook Secret de YCloud para esa clínica en Configuración.",
    },
    {
        match: /ReferenceError|is not defined|TypeError|Async Process Error|Cannot read prop/i,
        code: "code_error",
        summary: "Error de código en el webhook — catch-all 'problema técnico'.",
        severity: "critical",
        fix: "Bug en el código. Revisa el trace en debug_logs y despliega un fix.",
    },
    {
        match: /429|rate.?limit|quota|insufficient_quota/i,
        code: "openai_quota",
        summary: "OpenAI rate-limit o cuota agotada.",
        severity: "critical",
        fix: "Revisa el saldo/limite de la cuenta de OpenAI.",
    },
    {
        match: /timeout|timed out|ETIMEDOUT|deadline/i,
        code: "timeout",
        summary: "Timeout en una operación (probable Google Maps/geo en checkAvail).",
        severity: "warning",
        fix: "Revisa logistics_config y la latencia de las APIs externas.",
    },
];

export const classifyError = (message: string): Finding | null => {
    for (const p of ERROR_PATTERNS) {
        if (p.match.test(message)) {
            return {
                severity: p.severity,
                code: p.code,
                summary: p.summary,
                detail: message.slice(0, 400),
                suggestedFix: p.fix,
            };
        }
    }
    return null;
};

// ---- Recent global errors from debug_logs (debug_logs has no clinic_id) ----
export const getRecentErrors = async (
    sb: Sb,
    sinceMinutes = 360,
): Promise<Finding[]> => {
    const since = new Date(Date.now() - sinceMinutes * 60_000).toISOString();
    const { data } = await sb
        .from("debug_logs")
        .select("message, payload, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(200);

    const findings = new Map<string, Finding>();
    for (const row of (data || []) as { message: string; payload: unknown }[]) {
        const blob = `${row.message || ""} ${JSON.stringify(row.payload || {})}`;
        const f = classifyError(blob);
        if (f && !findings.has(f.code)) findings.set(f.code, f);
    }
    return [...findings.values()];
};

// ---- Reminder send failures (reminder_logs HAS clinic_id) ----
export const getReminderFailures = async (
    sb: Sb,
    clinicId: string,
    sinceMinutes = 1440,
): Promise<Finding | null> => {
    const since = new Date(Date.now() - sinceMinutes * 60_000).toISOString();
    const { data } = await sb
        .from("reminder_logs")
        .select("error_message, created_at")
        .eq("clinic_id", clinicId)
        .eq("status", "failed")
        .gte("created_at", since)
        .limit(50);

    const rows = (data || []) as { error_message: string | null }[];
    if (rows.length === 0) return null;

    // Try to classify the most informative error
    let classified: Finding | null = null;
    for (const r of rows) {
        if (r.error_message) {
            classified = classifyError(r.error_message);
            if (classified) break;
        }
    }
    return {
        severity: rows.length >= 5 ? "critical" : "warning",
        code: "reminder_failures",
        summary: `${rows.length} recordatorio(s) fallido(s) en las últimas ${Math.round(sinceMinutes / 60)}h.`,
        detail: classified?.detail || rows[0]?.error_message || undefined,
        suggestedFix: classified?.suggestedFix || "Revisa saldo de YCloud y templates de la clínica.",
    };
};

// ---- Mute detection: inbound message with no AI/outbound response after it ----
export const detectMute = async (
    sb: Sb,
    clinicId: string,
    graceMinutes = 10,
): Promise<Finding | null> => {
    const { data } = await sb
        .from("messages")
        .select("direction, created_at")
        .eq("clinic_id", clinicId)
        .order("created_at", { ascending: false })
        .limit(1);

    const last = (data || [])[0] as { direction: string; created_at: string } | undefined;
    if (!last) return null;

    const ageMin = (Date.now() - new Date(last.created_at).getTime()) / 60_000;
    // If the most recent message is INBOUND and older than the grace window,
    // the agent likely failed to reply (mute).
    if ((last.direction === "inbound" || last.direction === "in") && ageMin > graceMinutes) {
        return {
            severity: "critical",
            code: "agent_mute",
            summary: `El último mensaje (hace ${Math.round(ageMin)} min) es entrante y sigue sin respuesta.`,
            detail: "Posible agente mudo: revisa errores de código, saldo o firma HMAC.",
            suggestedFix: "Corre el diagnóstico completo de la clínica para identificar la causa.",
        };
    }
    return null;
};

// ---- Full per-clinic health report ----
export const runClinicDiagnostics = async (
    sb: Sb,
    clinicId: string,
    balanceThreshold = 5,
): Promise<ClinicHealth> => {
    const { data: clinic } = await sb
        .from("clinic_settings")
        .select("clinic_name, ycloud_api_key, ycloud_webhook_secret, ycloud_phone_number")
        .eq("id", clinicId)
        .maybeSingle();

    const findings: Finding[] = [];
    let balance: { amount: number; currency: string } | null = null;

    if (!clinic) {
        return {
            clinicId,
            clinicName: "(desconocida)",
            status: "critical",
            findings: [{ severity: "critical", code: "no_clinic", summary: "No existe clinic_settings para este ID." }],
        };
    }

    const c = clinic as {
        clinic_name: string;
        ycloud_api_key: string | null;
        ycloud_webhook_secret: string | null;
        ycloud_phone_number: string | null;
    };

    // 1. Config checks
    if (!c.ycloud_api_key) {
        findings.push({ severity: "critical", code: "no_api_key", summary: "Sin API Key de YCloud configurada.", suggestedFix: "Configura la API Key en Configuración." });
    }
    if (!c.ycloud_webhook_secret) {
        findings.push({ severity: "warning", code: "no_secret", summary: "Sin Webhook Secret — la firma no se verifica (modo permisivo).", suggestedFix: "Pega el Webhook Secret de YCloud en Configuración." });
    }

    // 2. YCloud balance
    if (c.ycloud_api_key) {
        balance = await getYCloudBalance(c.ycloud_api_key);
        if (balance && balance.amount < balanceThreshold) {
            findings.push({
                severity: balance.amount <= 0 ? "critical" : "warning",
                code: "low_balance",
                summary: `Saldo YCloud bajo: ${balance.amount.toFixed(4)} ${balance.currency}.`,
                suggestedFix: "Recarga la cuenta de YCloud.",
            });
        }
    }

    // 3. Reminder failures
    const remFail = await getReminderFailures(sb, clinicId);
    if (remFail) findings.push(remFail);

    // 4. Mute detection
    const mute = await detectMute(sb, clinicId);
    if (mute) findings.push(mute);

    const hasCritical = findings.some((f) => f.severity === "critical");
    const hasWarning = findings.some((f) => f.severity === "warning");
    const status: Severity = hasCritical ? "critical" : hasWarning ? "warning" : "ok";

    return { clinicId, clinicName: c.clinic_name, status, findings, balance };
};

// ---- Format a health report as WhatsApp / chat text ----
export const formatHealthReport = (h: ClinicHealth): string => {
    const icon = h.status === "ok" ? "✅" : h.status === "warning" ? "⚠️" : "🔴";
    const lines = [`${icon} *${h.clinicName}*`];
    if (h.balance) lines.push(`Saldo YCloud: ${h.balance.amount.toFixed(4)} ${h.balance.currency}`);
    if (h.findings.length === 0) {
        lines.push("Sin problemas detectados.");
    } else {
        for (const f of h.findings) {
            const fi = f.severity === "critical" ? "🔴" : f.severity === "warning" ? "⚠️" : "•";
            lines.push(`${fi} ${f.summary}`);
            if (f.suggestedFix) lines.push(`   → ${f.suggestedFix}`);
        }
    }
    return lines.join("\n");
};
