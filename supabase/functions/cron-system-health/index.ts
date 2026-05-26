import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
    runClinicDiagnostics,
    getRecentErrors,
    checkOpenAI,
    sendWhatsApp,
    type ClinicHealth,
} from "../_shared/diagnostics.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HQ_ID = "00000000-0000-0000-0000-000000000000";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // HQ config: where to send alerts + threshold.
    const { data: hqRow } = await sb
        .from("clinic_settings")
        .select("ycloud_api_key, ycloud_phone_number, hq_escalation_phone, hq_ycloud_balance_threshold, hq_support_agent_enabled")
        .eq("id", HQ_ID)
        .maybeSingle();

    const hq = hqRow as {
        ycloud_api_key: string | null;
        ycloud_phone_number: string | null;
        hq_escalation_phone: string | null;
        hq_ycloud_balance_threshold: number | null;
        hq_support_agent_enabled: boolean | null;
    } | null;

    if (!hq?.hq_support_agent_enabled) {
        return new Response(JSON.stringify({ status: "support_disabled" }), { headers: corsHeaders });
    }

    const threshold = Number(hq.hq_ycloud_balance_threshold ?? 5);
    const alerts: string[] = [];

    // 1. OpenAI connectivity.
    const openai = await checkOpenAI(OPENAI_API_KEY);
    if (!openai.ok) {
        alerts.push(`🔴 *OpenAI* no responde (status ${openai.status}). Los agentes pueden quedar mudos.`);
    }

    // 2. Per-clinic diagnostics (operational clinics with YCloud).
    const { data: clinics } = await sb
        .from("clinic_settings")
        .select("id, clinic_name, ycloud_api_key")
        .not("ycloud_api_key", "is", null)
        .neq("id", HQ_ID);
    const list = (clinics || []) as { id: string; clinic_name: string }[];

    const reports: ClinicHealth[] = await Promise.all(
        list.map((c) => runClinicDiagnostics(sb, c.id, threshold)),
    );

    for (const rep of reports) {
        const actionable = rep.findings.filter((f) => f.severity === "critical" || f.severity === "warning");
        if (actionable.length === 0) continue;
        const lines = actionable.map((f) => {
            const icon = f.severity === "critical" ? "🔴" : "⚠️";
            return `${icon} ${f.summary}${f.suggestedFix ? `\n   → ${f.suggestedFix}` : ""}`;
        });
        alerts.push(`*${rep.clinicName}*\n${lines.join("\n")}`);
    }

    // 3. Recent global code-level errors.
    const errs = await getRecentErrors(sb, 360);
    const codeErrs = errs.filter((e) => e.code === "code_error");
    for (const e of codeErrs) {
        alerts.push(`🔴 *Código* — ${e.summary}\n   → ${e.suggestedFix}`);
    }

    // 4. Notify only when there is something actionable.
    let notified = false;
    let notifyMsgId: string | undefined;
    if (alerts.length > 0 && hq.ycloud_api_key && hq.hq_escalation_phone) {
        const ts = new Date().toLocaleString("es-CL", { timeZone: "America/Santiago" });
        const message = `🛟 *Vetly — Reporte de salud*\n${ts}\n\n${alerts.join("\n\n")}\n\n_Responde "status" para ver el detalle._`;
        try {
            const resp = await sendWhatsApp(hq.ycloud_api_key, hq.ycloud_phone_number || "+56993089185", hq.hq_escalation_phone, message);
            notified = true;
            notifyMsgId = resp.id;
            // Log message ID so delivery can be verified in YCloud dashboard.
            console.log("[cron-system-health] alert queued, YCloud msgId:", resp.id, "status:", resp.status);
        } catch (e) {
            console.error("[cron-system-health] alert send failed:", e);
        }
    }

    return new Response(
        JSON.stringify({ status: "ok", clinics_checked: list.length, alerts: alerts.length, notified, notify_msg_id: notifyMsgId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
});
