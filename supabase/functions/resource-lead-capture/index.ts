// Captura genérica de leads de recursos gratuitos (public/recursos/*.html):
// guarda el lead en `resource_leads` y, si el llamador manda el resultado ya
// armado en HTML, le envía el correo con ese resultado vía Resend. Pensada
// para reusarse en CUALQUIER recurso futuro (checklist, calculadora,
// diagnóstico) — el recurso solo cambia `resource_slug` y el HTML del cuerpo
// del correo, nunca esta función.
//
// Invocada sin sesión desde una página pública (fetch directo, sin JWT) —
// mismo criterio que `public-booking-notify`. El correo con RESEND_API_KEY
// solo puede vivir server-side, por eso el insert nunca se hace directo
// desde el navegador con la anon key (a diferencia de `diagnostic_leads`,
// que sí lo permite porque no dispara ningún correo).
//
// El envío/layout de correo se duplica acá (en vez de importar
// ../_shared/email.ts) porque el bundler del tool de deploy vía MCP no
// resuelve ese import relativo entre archivos — mismo criterio ya adoptado
// por `public-booking-notify`, que define su propio sendEmail en vez de
// depender del shared.

import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...CORS, "Content-Type": "application/json" },
    });
}

const isValidEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

interface SendEmailResult {
    ok: boolean;
    id?: string;
    error?: string;
}

async function sendEmail(to: string, subject: string, html: string): Promise<SendEmailResult> {
    if (!RESEND_API_KEY) return { ok: false, error: "RESEND_API_KEY no configurado" };
    try {
        const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
            body: JSON.stringify({ from: "Vetly AI <hola@vetly.pro>", to, subject, html }),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            return { ok: false, error: `Resend ${res.status}: ${text.slice(0, 300)}` };
        }
        const data = await res.json().catch(() => ({}));
        return { ok: true, id: data?.id };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}

function renderEmailLayout(headerTitle: string, headerSubtitle: string | undefined, bodyHtml: string): string {
    return `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${headerTitle}</title>
          </head>
          <body style="margin: 0; padding: 0; background-color: #FAFAF8; font-family: 'Outfit', Arial, sans-serif; color: #18181b;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0; padding: 40px 20px; background-color: #FAFAF8;">
              <tr>
                <td align="center">
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; border: 1px solid #e4e4e7; box-shadow: 0 4px 12px rgba(0,0,0,0.05); overflow: hidden;">
                    <tr>
                      <td style="padding: 40px 32px; background: linear-gradient(135deg, #0d9488 0%, #0891b2 100%); text-align: center;">
                        <div style="font-size: 32px; margin-bottom: 16px;">🐾</div>
                        <h1 style="margin: 0; font-size: 24px; font-weight: 800; color: #ffffff; letter-spacing: -0.02em;">
                          ${headerTitle}
                        </h1>
                        ${headerSubtitle ? `<p style="margin: 8px 0 0 0; font-size: 15px; color: rgba(255,255,255,0.9);">${headerSubtitle}</p>` : ""}
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 32px 32px 40px;">
                        ${bodyHtml}
                        <p style="margin: 24px 0 0 0; font-size: 13px; line-height: 1.6; color: #a1a1aa;">
                          ¿Dudas? Responde a este correo — te leemos.
                        </p>
                      </td>
                    </tr>
                    <tr>
                      <td style="background-color: #FAFAF8; padding: 24px; text-align: center; border-top: 1px solid #e4e4e7;">
                        <p style="margin: 0; font-size: 12px; color: #a1a1aa;">
                          &copy; 2026 Vetly. Todos los derechos reservados.
                        </p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </body>
        </html>
    `;
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

    const sb = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const logIssue = async (message: string, payload: unknown) => {
        try {
            await sb.from("debug_logs").insert({ message, payload });
        } catch {
            // El logging nunca debe tumbar la función.
        }
    };

    let body: Record<string, unknown>;
    try {
        body = await req.json();
    } catch {
        return json({ success: false, error: "JSON inválido" }, 400);
    }

    const resource_slug = String(body?.resource_slug || "").trim().slice(0, 80);
    const full_name = String(body?.full_name || "").trim().slice(0, 150);
    const email = String(body?.email || "").trim().toLowerCase().slice(0, 200);
    const marketing_opt_in = Boolean(body?.marketing_opt_in);

    if (!resource_slug || !full_name || !email || !isValidEmail(email)) {
        return json({ success: false, error: "Faltan datos válidos (nombre y correo)." }, 400);
    }

    const toIntOrNull = (v: unknown) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.round(n) : null;
    };

    const score = toIntOrNull(body?.score);
    const score_pct = toIntOrNull(body?.score_pct);
    const level = body?.level ? String(body.level).slice(0, 60) : null;
    const answers = body?.answers ?? null;
    const source_url = body?.source_url ? String(body.source_url).slice(0, 500) : null;
    const referrer = body?.referrer ? String(body.referrer).slice(0, 500) : null;
    const result_email_subject = body?.result_email_subject
        ? String(body.result_email_subject).slice(0, 200)
        : `Tu resultado — Vetly`;
    const result_email_body_html = body?.result_email_body_html
        ? String(body.result_email_body_html)
        : "";

    const { data: inserted, error: insErr } = await sb
        .from("resource_leads")
        .insert({
            resource_slug,
            full_name,
            email,
            marketing_opt_in,
            score,
            score_pct,
            level,
            answers,
            source_url,
            referrer,
        })
        .select("id")
        .single();

    if (insErr || !inserted) {
        await logIssue("[resource-lead-capture] insert failed", { error: insErr, resource_slug, email });
        return json({ success: false, error: "No se pudo guardar tu resultado. Intenta de nuevo." }, 500);
    }

    let email_sent = false;
    if (result_email_body_html) {
        const firstName = full_name.split(" ")[0] || undefined;
        const html = renderEmailLayout(
            "Tu resultado ya está listo",
            firstName ? `Hola, ${firstName} 👋` : undefined,
            result_email_body_html,
        );
        const sent = await sendEmail(email, result_email_subject, html);
        email_sent = sent.ok;
        if (!sent.ok) {
            await logIssue("[resource-lead-capture] email failed", { error: sent.error, email, resource_slug });
        } else {
            await sb
                .from("resource_leads")
                .update({ email_sent: true, resend_id: sent.id || null })
                .eq("id", inserted.id);
        }
    }

    return json({ success: true, lead_id: inserted.id, email_sent });
});
