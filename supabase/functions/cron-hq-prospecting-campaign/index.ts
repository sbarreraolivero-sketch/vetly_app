/**
 * cron-hq-prospecting-campaign — cola de envío con rampa de la campaña de
 * prospección de clínicas veterinarias. Corre 1 vez al día vía pg_cron.
 *
 * Rampa: dailyCap = min(5 * 2^semanasDesdeInicio, max_daily_cap) — 5/día
 * semana 1, 10/día semana 2, 20/día semana 3... con techo configurable
 * (prospecting_campaign_config.max_daily_cap, default 50).
 *
 * Cobertura por ciudad ("agotar antes de avanzar", pedido explícito del
 * usuario): NO hace falta una tabla de cola aparte — por cada país se manda
 * siempre el lead `listo_para_enviar` MÁS ANTIGUO (ORDER BY created_at ASC).
 * Como una ciudad nueva de un país solo entra a la tabla cuando se corre
 * hq-discover-prospects para ella, y eso es una acción manual/deliberada,
 * el "más antiguo primero" ya garantiza terminar la ciudad en curso antes
 * de tocar cualquier ciudad agregada después.
 *
 * Reparte por PAÍS en round-robin (no por lead) hasta completar la cuota del
 * día — con 5 países activos y cuota 5, sale 1 correo por país; con cuota
 * 10, salen 2 por país, siempre drenando primero los leads más viejos.
 *
 * Solo entran a la cola los leads en `listo_para_enviar` — un correo
 * generado por IA nunca se manda sin que un humano lo haya revisado y
 * aprobado desde el panel primero.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendEmail } from "../_shared/email.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const CORS = { "Access-Control-Allow-Origin": "*" };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

// Firma tipo "tarjeta de presentación" (v2) — rediseño pedido por el usuario
// sobre una referencia visual concreta: panel izquierdo de color con foto
// circular + nombre + cargo, panel derecho blanco con filas de contacto
// (ícono en círculo degradado + texto), y el logo de Vetly como insignia
// circular en la esquina superior derecha del panel blanco — igual que la
// referencia, adaptado a los colores reales de marca (#0d9488→#0ea5e9, no
// azul/morado genérico) y a los datos reales — WhatsApp, correo, Instagram
// (@vetly.pro, verificado real y activo el 2026-09-01) y web.
//
// El logo de Vetly TAMBIÉN va como avatar del remitente en Gmail vía
// Gravatar (cuenta a nombre de sebastian@mail.vetly.pro, verificado
// 2026-08-31: el hash SHA256 de ese correo devuelve el logo real de Vetly).
// Que Gmail lo pinte en el inbox no depende de este HTML — es best-effort de
// Gravatar, sin garantía total porque mail.vetly.pro no tiene DMARC/BIMI
// (el mecanismo que Gmail sí respeta siempre). Confirmar viendo un correo
// real en Gmail.
//
// Esta firma va al FINAL del correo, no al principio — un header de color
// grande antes del cuerpo se vería como campaña de marketing.
// El HTML generado por IA nunca escribe su propia firma (instrucción en
// hq-generate-prospect-email) — esta es la única, siempre igual, agregada acá.
const SIGNATURE_HTML = `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:32px;width:100%;max-width:540px;border-radius:18px;overflow:hidden;border:1px solid #e4e4e7;">
  <tr>
    <td width="180" valign="top" style="background-color:#0d9488;background-image:linear-gradient(160deg,#0d9488,#0ea5e9);padding:30px 18px;text-align:center;">
      <img src="https://vetly.pro/foto-sebastian-firma.png" width="88" height="88" alt="Sebastián Barrera"
           style="display:block;width:88px;height:88px;margin:0 auto 14px auto;border-radius:50%;object-fit:cover;border:3px solid rgba(255,255,255,0.55);" />
      <p style="margin:0 0 4px 0;font-size:16px;font-weight:800;color:#ffffff;font-family:Arial,sans-serif;letter-spacing:-0.2px;">Sebastián Barrera</p>
      <p style="margin:0;font-size:11px;font-weight:700;color:#d1fae5;font-family:Arial,sans-serif;text-transform:uppercase;letter-spacing:0.6px;">Fundador · Vetly</p>
    </td>
    <td valign="top" style="background-color:#ffffff;padding:18px 20px 20px 20px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
        <tr>
          <td align="right" style="padding-bottom:4px;">
            <img src="https://vetly.pro/logo.png" width="38" height="38" alt="Vetly" style="display:inline-block;width:38px;height:38px;border-radius:50%;" />
          </td>
        </tr>
      </table>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
        <tr>
          <td width="30" style="padding:5px 0;vertical-align:middle;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="26" height="26" style="border-radius:50%;background-color:#0d9488;background-image:linear-gradient(135deg,#0d9488,#0ea5e9);">
              <tr><td align="center" valign="middle" style="font-size:13px;line-height:26px;">📱</td></tr>
            </table>
          </td>
          <td style="padding:5px 0 5px 10px;vertical-align:middle;">
            <a href="https://wa.me/56993089185" style="font-size:13px;color:#27272a;font-family:Arial,sans-serif;text-decoration:none;">+56 9 9308 9185</a>
          </td>
        </tr>
        <tr>
          <td width="30" style="padding:5px 0;vertical-align:middle;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="26" height="26" style="border-radius:50%;background-color:#0d9488;background-image:linear-gradient(135deg,#0d9488,#0ea5e9);">
              <tr><td align="center" valign="middle" style="font-size:13px;line-height:26px;">✉️</td></tr>
            </table>
          </td>
          <td style="padding:5px 0 5px 10px;vertical-align:middle;">
            <a href="mailto:sebastian@mail.vetly.pro" style="font-size:13px;color:#27272a;font-family:Arial,sans-serif;text-decoration:none;">sebastian@mail.vetly.pro</a>
          </td>
        </tr>
        <tr>
          <td width="30" style="padding:5px 0;vertical-align:middle;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="26" height="26" style="border-radius:50%;background-color:#0d9488;background-image:linear-gradient(135deg,#0d9488,#0ea5e9);">
              <tr><td align="center" valign="middle" style="font-size:13px;line-height:26px;">📷</td></tr>
            </table>
          </td>
          <td style="padding:5px 0 5px 10px;vertical-align:middle;">
            <a href="https://instagram.com/vetly.pro" style="font-size:13px;color:#27272a;font-family:Arial,sans-serif;text-decoration:none;">@vetly.pro</a>
          </td>
        </tr>
        <tr>
          <td width="30" style="padding:5px 0;vertical-align:middle;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="26" height="26" style="border-radius:50%;background-color:#0d9488;background-image:linear-gradient(135deg,#0d9488,#0ea5e9);">
              <tr><td align="center" valign="middle" style="font-size:13px;line-height:26px;">🌐</td></tr>
            </table>
          </td>
          <td style="padding:5px 0 5px 10px;vertical-align:middle;">
            <a href="https://vetly.pro" style="font-size:13px;color:#27272a;font-family:Arial,sans-serif;text-decoration:none;">vetly.pro</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;

function renderProspectingHtml(bodyHtml: string, leadId: string): string {
  // Plantilla deliberadamente distinta de renderEmailLayout (esa tiene
  // gradiente morado y card de marca, apropiada para lifecycle — acá el
  // pedido explícito es que se vea como un correo personal, no una campaña
  // de marketing). Sin header de color, sin botones — la única marca es el
  // logo chico de la firma.
  //
  // Píxel de tracking PROPIO al final (track-prospect-open) — el
  // open_tracking nativo de Resend no aplica para mail.vetly.pro (ver
  // comentario en ese edge function). Es la única forma real de que
  // "Abiertos" en el panel de prospección refleje algo cierto.
  const trackingPixel = `<img src="${SUPABASE_URL}/functions/v1/track-prospect-open?id=${leadId}" width="1" height="1" style="display:none;border:0;" alt="" />`;
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#ffffff;">
<div style="max-width:560px;margin:0 auto;padding:32px 20px;font-family:Arial,sans-serif;">
${bodyHtml}
${SIGNATURE_HTML}
</div>
${trackingPixel}
</body></html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: config } = await supabase.from("prospecting_campaign_config").select("*").eq("id", true).single();
    if (!config) return json({ ok: true, skipped: "sin config" });
    if (config.is_paused) return json({ ok: true, skipped: "campaña pausada (prospecting_campaign_config.is_paused)" });

    const startedAt = new Date(config.started_at);
    const now = new Date();
    const weeksElapsed = Math.floor((now.getTime() - startedAt.getTime()) / (7 * 24 * 60 * 60 * 1000));
    const dailyCap = Math.min(5 * Math.pow(2, Math.max(0, weeksElapsed)), config.max_daily_cap);

    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const { count: sentToday } = await supabase
      .from("prospecting_leads")
      .select("id", { count: "exact", head: true })
      .eq("contact_status", "email_enviado")
      .gte("email_sent_at", todayStart);

    let remaining = dailyCap - (sentToday || 0);
    if (remaining <= 0) {
      return json({ ok: true, dailyCap, sentToday: sentToday || 0, skipped: "cuota del día ya cubierta" });
    }

    const { data: pending } = await supabase
      .from("prospecting_leads")
      .select("id, country, email, email_subject, email_body")
      .eq("contact_status", "listo_para_enviar")
      .order("created_at", { ascending: true });

    if (!pending || pending.length === 0) {
      return json({ ok: true, dailyCap, remaining, sent: 0, note: "sin leads listo_para_enviar" });
    }

    // Agrupa por país, ya ordenado por antigüedad dentro de cada grupo
    // (viene de la query ORDER BY created_at ASC).
    const byCountry = new Map<string, typeof pending>();
    for (const lead of pending) {
      if (!byCountry.has(lead.country)) byCountry.set(lead.country, []);
      byCountry.get(lead.country)!.push(lead);
    }
    const countries = Array.from(byCountry.keys()).sort(); // orden estable

    let sent = 0;
    const errors: string[] = [];
    const toSend: typeof pending = [];

    // Round-robin: una pasada por país, repetir hasta llenar `remaining` o
    // agotar todos los países.
    let anyLeftLastPass = true;
    while (remaining > 0 && anyLeftLastPass) {
      anyLeftLastPass = false;
      for (const country of countries) {
        if (remaining <= 0) break;
        const queue = byCountry.get(country)!;
        const next = queue.shift();
        if (!next) continue;
        anyLeftLastPass = true;
        toSend.push(next);
        remaining--;
      }
    }

    if (dryRun) {
      return json({
        ok: true, dryRun: true, dailyCap, sentToday: sentToday || 0,
        wouldSend: toSend.map(l => ({ id: l.id, country: l.country, email: l.email })),
      });
    }

    for (const lead of toSend) {
      try {
        if (!lead.email || !lead.email_subject || !lead.email_body) {
          errors.push(`${lead.id}: faltan campos (email/subject/body)`);
          continue;
        }
        const result = await sendEmail({
          to: lead.email,
          subject: lead.email_subject,
          html: renderProspectingHtml(lead.email_body, lead.id),
          // Subdominio dedicado (mail.vetly.pro, verificado en Resend
          // 2026-08-31 — SPF+DKIM propios vía Cloudflare Domain Connect)
          // para aislar la reputación del correo en frío del transaccional
          // que sigue mandando hola@vetly.pro (bienvenida, secuencia, etc.).
          from: "Sebastián · Vetly <sebastian@mail.vetly.pro>",
        });
        if (!result.ok) {
          errors.push(`${lead.id}: ${result.error}`);
          continue;
        }
        await supabase.from("prospecting_leads").update({
          contact_status: "email_enviado",
          email_sent_at: new Date().toISOString(),
          resend_id: result.id || null,
        }).eq("id", lead.id);
        sent++;
      } catch (e) {
        errors.push(`${lead.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (errors.length) console.error("[cron-hq-prospecting-campaign] errores:", errors);

    return json({ ok: true, dailyCap, sentToday: (sentToday || 0) + sent, sent, errors });
  } catch (e) {
    console.error("[cron-hq-prospecting-campaign] error:", e);
    return json({ error: "Internal server error" }, 500);
  }
});
