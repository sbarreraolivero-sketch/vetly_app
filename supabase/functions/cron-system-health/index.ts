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
// Canal de respaldo cuando WhatsApp no puede entregar la alerta.
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const ALERT_EMAIL = Deno.env.get("HQ_ALERT_EMAIL") || "sbarrera.olivero@gmail.com";
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

    // 1. OpenAI: conectividad Y saldo (ver checkOpenAI — /v1/models solo no detecta
    //    la cuota agotada, que es la causa #1 de agentes mudos).
    const openai = await checkOpenAI(OPENAI_API_KEY);
    if (openai.outOfCredits) {
        alerts.push(
            `🔴 *OpenAI SIN CRÉDITOS* — TODOS los agentes de WhatsApp están mudos ahora mismo. ` +
            `Recarga en platform.openai.com/settings/organization/billing`,
        );
    } else if (!openai.ok) {
        alerts.push(`🔴 *OpenAI* no responde (status ${openai.status}). Los agentes pueden quedar mudos.`);
    }

    // 2. Per-clinic diagnostics — clínicas operativas por CUALQUIER canal.
    //    El filtro anterior exigía ycloud_api_key, así que tras la migración de ambas
    //    sucursales a Meta el cron dejó de revisar clínicas en silencio (clinics_checked: 0)
    //    y las alertas de recordatorios fallidos / agente mudo quedaron muertas.
    const { data: clinics } = await sb
        .from("clinic_settings")
        .select("id, clinic_name, ycloud_api_key, meta_phone_number_id")
        .or("ycloud_api_key.not.is.null,meta_phone_number_id.not.is.null")
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
    //
    // El canal de salida se trata como falible a propósito: el 15-ago-2026 el cron
    // detectó correctamente una alerta y no la entregó porque el número del HQ había
    // dejado de estar registrado en YCloud (403 WHATSAPP_PHONE_NUMBER_UNAVAILABLE)
    // tras la migración a Meta. Un monitor que solo sabe avisar por un canal que
    // puede morir en silencio no es un monitor. Ahora: la alerta SIEMPRE queda
    // registrada, se intenta WhatsApp, y si falla se cae a email.
    let notified = false;
    let notifyMsgId: string | undefined;
    let notifyChannel: string | undefined;
    let notifyError: string | undefined;

    if (alerts.length > 0) {
        const ts = new Date().toLocaleString("es-CL", { timeZone: "America/Santiago" });
        const message = `🛟 *Vetly — Reporte de salud*\n${ts}\n\n${alerts.join("\n\n")}\n\n_Responde "status" para ver el detalle._`;

        // 4a. Rastro persistente ANTES de intentar cualquier envío: si todos los
        //     canales fallan, la alerta sigue siendo consultable en debug_logs.
        await sb.from("debug_logs").insert({
            message: "[cron-system-health] ALERTA",
            payload: { ts, alerts, clinics_checked: list.length },
        });

        // 4b. Canal principal: WhatsApp al fundador.
        if (hq.ycloud_api_key && hq.hq_escalation_phone) {
            try {
                const resp = await sendWhatsApp(
                    hq.ycloud_api_key,
                    hq.ycloud_phone_number || "+56993089185",
                    hq.hq_escalation_phone,
                    message,
                );
                notified = true;
                notifyChannel = "whatsapp";
                notifyMsgId = resp.id;
                console.log("[cron-system-health] alert queued, YCloud msgId:", resp.id, "status:", resp.status);
            } catch (e) {
                notifyError = String(e).slice(0, 300);
                console.error("[cron-system-health] alert send failed:", e);
            }
        } else {
            notifyError = "HQ sin ycloud_api_key o hq_escalation_phone configurados";
        }

        // 4c. Respaldo: email. Solo se usa si WhatsApp no salió, para no duplicar avisos.
        if (!notified && RESEND_API_KEY && ALERT_EMAIL) {
            try {
                const r = await fetch("https://api.resend.com/emails", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${RESEND_API_KEY}`,
                    },
                    body: JSON.stringify({
                        from: "Vetly Salud <hola@vetly.pro>",
                        to: ALERT_EMAIL,
                        subject: `🛟 Vetly — ${alerts.length} alerta(s) de salud del sistema`,
                        // <pre> preserva los saltos de línea del mismo texto que va por WhatsApp.
                        html: `<pre style="font-family:ui-monospace,Menlo,monospace;font-size:13px;white-space:pre-wrap">${
                            message.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!))
                        }</pre><p style="font-family:Arial,sans-serif;font-size:12px;color:#888">Enviado por email porque el canal de WhatsApp falló: ${notifyError ?? "sin detalle"}</p>`,
                    }),
                });
                if (r.ok) {
                    notified = true;
                    notifyChannel = "email";
                    console.log("[cron-system-health] alert sent by email fallback");
                } else {
                    const txt = await r.text();
                    console.error("[cron-system-health] email fallback failed:", txt.slice(0, 200));
                }
            } catch (e) {
                console.error("[cron-system-health] email fallback threw:", e);
            }
        }
    }

    return new Response(
        JSON.stringify({
            status: "ok",
            clinics_checked: list.length,
            alerts: alerts.length,
            notified,
            notify_channel: notifyChannel,
            notify_msg_id: notifyMsgId,
            notify_error: notifyError,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
});
