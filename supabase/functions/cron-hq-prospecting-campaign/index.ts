/**
 * cron-hq-prospecting-campaign — cola de envío con rampa de la campaña de
 * prospección de clínicas veterinarias. Corre 1 vez al día vía pg_cron.
 *
 * Secuencia de 3 pasos por lead (A/B/C, ver hq-generate-prospect-email):
 *   A: catálogo con emojis — SIEMPRE requiere aprobación humana desde el
 *      panel (/hq/prospecting). Se manda apenas está `listo_para_enviar`.
 *   B: personal/cálido — pasados >= 2 días desde que se mandó A
 *      (`email_sent_at`), esta misma función lo genera con IA Y lo aprueba
 *      sola (ver autoGenerateStep más abajo — decisión explícita del
 *      usuario 2026-10-17, sin revisión humana) y lo manda en la misma
 *      corrida.
 *   C: Meta Ads / Animalgrace — mismo trato automático que B, pasados >= 2
 *      días desde que se mandó B (`email_b_sent_at`).
 * A nunca se auto-genera/aprueba — solo B y C, y solo vía este cron (el
 * panel sigue pudiendo generar/editar cualquier paso a mano en cualquier
 * momento, sin que eso bloquee la automatización).
 *
 * Rampa: dailyCap = min(5 * 2^semanasDesdeInicio, max_daily_cap) — 5/día
 * semana 1, 10/día semana 2, 20/día semana 3... con techo configurable
 * (prospecting_campaign_config.max_daily_cap, default 50). La cuota es
 * COMPARTIDA entre los 3 pasos (A+B+C cuentan igual contra el mismo tope
 * diario) — sigue siendo volumen real saliendo del mismo dominio.
 * Prioridad dentro del cupo del día: C > B > A — terminar una secuencia ya
 * empezada pesa más que arrancar un contacto nuevo, porque B y C además
 * tienen una ventana de tiempo real que ya empezó a correr.
 *
 * Cobertura por ciudad ("agotar antes de avanzar", pedido explícito del
 * usuario): NO hace falta una tabla de cola aparte — por cada país se manda
 * siempre el lead MÁS ANTIGUO de cada paso (ORDER BY created_at ASC). Como
 * una ciudad nueva de un país solo entra a la tabla cuando se corre
 * hq-discover-prospects para ella, y eso es una acción manual/deliberada,
 * el "más antiguo primero" ya garantiza terminar la ciudad en curso antes
 * de tocar cualquier ciudad agregada después.
 *
 * Reparte por PAÍS en round-robin (no por lead) hasta completar la cuota del
 * día — con 5 países activos y cuota 5, sale 1 correo por país; con cuota
 * 10, salen 2 por país, siempre drenando primero los leads más viejos.
 *
 * Solo entran a la cola los leads en `listo_para_enviar*`. Para A eso
 * siempre pasó por revisión humana en el panel. Para B y C puede llegar ahí
 * por dos caminos: aprobación manual en el panel, o la auto-generación de
 * esta misma función (autoGenerateStep) — ambos caminos terminan en el
 * mismo estado y se envían igual.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendEmail } from "../_shared/email.ts";
import { isServiceRoleRequest, forbiddenResponse } from "../_shared/serviceRoleGuard.ts";

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
              <tr><td align="center" valign="middle"><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE1IiBoZWlnaHQ9IjE1IiBmaWxsPSIjZmZmZmZmIj48cGF0aCBkPSJNMTcuNDcyIDE0LjM4MmMtLjI5Ny0uMTQ5LTEuNzU4LS44NjctMi4wMy0uOTY3LS4yNzMtLjA5OS0uNDcxLS4xNDgtLjY3LjE1LS4xOTcuMjk3LS43NjcuOTY2LS45NCAxLjE2NC0uMTczLjE5OS0uMzQ3LjIyMy0uNjQ0LjA3NS0uMjk3LS4xNS0xLjI1NS0uNDYzLTIuMzktMS40NzUtLjg4My0uNzg4LTEuNDgtMS43NjEtMS42NTMtMi4wNTktLjE3My0uMjk3LS4wMTgtLjQ1OC4xMy0uNjA2LjEzNC0uMTMzLjI5OC0uMzQ3LjQ0Ni0uNTIuMTQ5LS4xNzQuMTk4LS4yOTguMjk4LS40OTcuMDk5LS4xOTguMDUtLjM3MS0uMDI1LS41Mi0uMDc1LS4xNDktLjY2OS0xLjYxMi0uOTE2LTIuMjA3LS4yNDItLjU3OS0uNDg3LS41LS42NjktLjUxLS4xNzMtLjAwOC0uMzcxLS4wMS0uNTctLjAxLS4xOTggMC0uNTIuMDc0LS43OTIuMzcyLS4yNzIuMjk3LTEuMDQgMS4wMTYtMS4wNCAyLjQ3OSAwIDEuNDYyIDEuMDY1IDIuODc1IDEuMjEzIDMuMDc0LjE0OS4xOTggMi4wOTYgMy4yIDUuMDc3IDQuNDg3LjcwOS4zMDYgMS4yNjIuNDg5IDEuNjk0LjYyNS43MTIuMjI3IDEuMzYuMTk1IDEuODcxLjExOC41NzEtLjA4NSAxLjc1OC0uNzE5IDIuMDA2LTEuNDEzLjI0OC0uNjk0LjI0OC0xLjI4OS4xNzMtMS40MTMtLjA3NC0uMTI0LS4yNzItLjE5OC0uNTctLjM0N20tNS40MjEgNy40MDNoLS4wMDRhOS44NyA5Ljg3IDAgMDEtNS4wMzEtMS4zNzhsLS4zNjEtLjIxNC0zLjc0MS45ODIuOTk4LTMuNjQ4LS4yMzUtLjM3NGE5Ljg2IDkuODYgMCAwMS0xLjUxLTUuMjZjLjAwMS01LjQ1IDQuNDM2LTkuODg0IDkuODg4LTkuODg0IDIuNjQgMCA1LjEyMiAxLjAzIDYuOTg4IDIuODk4YTkuODI1IDkuODI1IDAgMDEyLjg5MyA2Ljk5NGMtLjAwMyA1LjQ1LTQuNDM3IDkuODg0LTkuODg1IDkuODg0bTguNDEzLTE4LjI5N0ExMS44MTUgMTEuODE1IDAgMDAxMi4wNSAwQzUuNDk1IDAgLjE2IDUuMzM1LjE1NyAxMS44OTJjMCAyLjA5Ni41NDcgNC4xNDIgMS41ODggNS45NDVMLjA1NyAyNGw2LjMwNS0xLjY1NGExMS44ODIgMTEuODgyIDAgMDA1LjY4MyAxLjQ0OGguMDA1YzYuNTU0IDAgMTEuODktNS4zMzUgMTEuODkzLTExLjg5M2ExMS44MjEgMTEuODIxIDAgMDAtMy40OC04LjQxM1oiLz48L3N2Zz4=" width="15" height="15" alt="WhatsApp" style="display:block;" /></td></tr>
            </table>
          </td>
          <td style="padding:5px 0 5px 10px;vertical-align:middle;">
            <a href="https://wa.me/56993089185" style="font-size:13px;color:#27272a;font-family:Arial,sans-serif;text-decoration:none;">+56 9 9308 9185</a>
          </td>
        </tr>
        <tr>
          <td width="30" style="padding:5px 0;vertical-align:middle;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="26" height="26" style="border-radius:50%;background-color:#0d9488;background-image:linear-gradient(135deg,#0d9488,#0ea5e9);">
              <tr><td align="center" valign="middle"><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE1IiBoZWlnaHQ9IjE1IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cmVjdCB4PSIyIiB5PSI0IiB3aWR0aD0iMjAiIGhlaWdodD0iMTYiIHJ4PSIyIi8+PHBhdGggZD0ibTIyIDYtMTAgN0wyIDYiLz48L3N2Zz4=" width="15" height="15" alt="Correo" style="display:block;" /></td></tr>
            </table>
          </td>
          <td style="padding:5px 0 5px 10px;vertical-align:middle;">
            <a href="mailto:sebastian@mail.vetly.pro" style="font-size:13px;color:#27272a;font-family:Arial,sans-serif;text-decoration:none;">sebastian@mail.vetly.pro</a>
          </td>
        </tr>
        <tr>
          <td width="30" style="padding:5px 0;vertical-align:middle;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="26" height="26" style="border-radius:50%;background-color:#0d9488;background-image:linear-gradient(135deg,#0d9488,#0ea5e9);">
              <tr><td align="center" valign="middle"><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE1IiBoZWlnaHQ9IjE1IiBmaWxsPSIjZmZmZmZmIj48cGF0aCBkPSJNNy4wMzAxLjA4NGMtMS4yNzY4LjA2MDItMi4xNDg3LjI2NC0yLjkxMS41NjM0LS43ODg4LjMwNzUtMS40NTc1LjcyLTIuMTIyOCAxLjM4NzctLjY2NTIuNjY3Ny0xLjA3NSAxLjMzNjgtMS4zODAyIDIuMTI3LS4yOTU0Ljc2MzgtLjQ5NTYgMS42MzY1LS41NTIgMi45MTQtLjA1NjQgMS4yNzc1LS4wNjg5IDEuNjg4Mi0uMDYyNiA0Ljk0Ny4wMDYyIDMuMjU4Ni4wMjA2IDMuNjY3MS4wODI1IDQuOTQ3My4wNjEgMS4yNzY1LjI2NCAyLjE0ODIuNTYzNSAyLjkxMDcuMzA4Ljc4ODkuNzIgMS40NTczIDEuMzg4IDIuMTIyOC42Njc5LjY2NTUgMS4zMzY1IDEuMDc0MyAyLjEyODUgMS4zOC43NjMyLjI5NSAxLjYzNjEuNDk2MSAyLjkxMzQuNTUyIDEuMjc3My4wNTYgMS42ODg0LjA2OSA0Ljk0NjIuMDYyNyAzLjI1NzgtLjAwNjIgMy42NjgtLjAyMDcgNC45NDc4LS4wODE0IDEuMjgtLjA2MDcgMi4xNDctLjI2NTIgMi45MDk4LS41NjMzLjc4ODktLjMwODYgMS40NTc4LS43MiAyLjEyMjgtMS4zODgxLjY2NS0uNjY4MiAxLjA3NDUtMS4zMzc4IDEuMzc5NS0yLjEyODQuMjk1Ny0uNzYzMi40OTY2LTEuNjM2LjU1Mi0yLjkxMjQuMDU2LTEuMjgwOS4wNjkyLTEuNjg5OC4wNjMtNC45NDgtLjAwNjMtMy4yNTgzLS4wMjEtMy42NjY4LS4wODE3LTQuOTQ2NS0uMDYwNy0xLjI3OTctLjI2NC0yLjE0ODctLjU2MzMtMi45MTE3LS4zMDg0LS43ODg5LS43Mi0xLjQ1NjgtMS4zODc2LTIuMTIyOEMyMS4yOTgyIDEuMzMgMjAuNjI4LjkyMDggMTkuODM3OC42MTY1IDE5LjA3NC4zMjEgMTguMjAxNy4xMTk3IDE2LjkyNDQuMDY0NSAxNS42NDcxLjAwOTMgMTUuMjM2LS4wMDUgMTEuOTc3LjAwMTQgOC43MTguMDA3NiA4LjMxLjAyMTUgNy4wMzAxLjA4MzltLjE0MDIgMjEuNjkzMmMtMS4xNy0uMDUwOS0xLjgwNTMtLjI0NTMtMi4yMjg3LS40MDgtLjU2MDYtLjIxNi0uOTYtLjQ3NzEtMS4zODE5LS44OTUtLjQyMi0uNDE3OC0uNjgxMS0uODE4Ni0uOS0xLjM3OC0uMTY0NC0uNDIzNC0uMzYyNC0xLjA1OC0uNDE3MS0yLjIyOC0uMDU5NS0xLjI2NDUtLjA3Mi0xLjY0NDItLjA3OS00Ljg0OC0uMDA3LTMuMjAzNy4wMDUzLTMuNTgzLjA2MDctNC44NDguMDUtMS4xNjkuMjQ1Ni0xLjgwNS40MDgtMi4yMjgyLjIxNi0uNTYxMy40NzYyLS45Ni44OTUtMS4zODE2LjQxODgtLjQyMTcuODE4NC0uNjgxNCAxLjM3ODMtLjkwMDMuNDIzLS4xNjUxIDEuMDU3NS0uMzYxNCAyLjIyNy0uNDE3MSAxLjI2NTUtLjA2IDEuNjQ0Ny0uMDcyIDQuODQ4LS4wNzkgMy4yMDMzLS4wMDcgMy41ODM1LjAwNSA0Ljg0OTUuMDYwOCAxLjE2OS4wNTA4IDEuODA1My4yNDQ1IDIuMjI4LjQwOC41NjA4LjIxNi45Ni40NzU0IDEuMzgxNi44OTUuNDIxNy40MTk0LjY4MTYuODE3Ni45MDA1IDEuMzc4Ny4xNjUzLjQyMTcuMzYxNyAxLjA1Ni40MTY5IDIuMjI2My4wNjAyIDEuMjY1NS4wNzM5IDEuNjQ1LjA3OTYgNC44NDguMDA1OCAzLjIwMy0uMDA1NSAzLjU4MzQtLjA2MSA0Ljg0OC0uMDUxIDEuMTctLjI0NSAxLjgwNTUtLjQwOCAyLjIyOTQtLjIxNi41NjA0LS40NzYzLjk2LS44OTU0IDEuMzgxNC0uNDE5LjQyMTUtLjgxODEuNjgxMS0xLjM3ODMuOS0uNDIyNC4xNjQ5LTEuMDU3Ny4zNjE3LTIuMjI2Mi40MTc0LTEuMjY1Ni4wNTk1LTEuNjQ0OC4wNzItNC44NDkzLjA3OS0zLjIwNDUuMDA3LTMuNTgyNS0uMDA2LTQuODQ4LS4wNjA4TTE2Ljk1MyA1LjU4NjRBMS40NCAxLjQ0IDAgMSAwIDE4LjM5IDQuMTQ0YTEuNDQgMS40NCAwIDAgMC0xLjQzNyAxLjQ0MjRNNS44Mzg1IDEyLjAxMmMuMDA2NyAzLjQwMzIgMi43NzA2IDYuMTU1NyA2LjE3MyA2LjE0OTMgMy40MDI2LS4wMDY1IDYuMTU3LTIuNzcwMSA2LjE1MDYtNi4xNzMzLS4wMDY1LTMuNDAzMi0yLjc3MS02LjE1NjUtNi4xNzQtNi4xNDk4LTMuNDAzLjAwNjctNi4xNTYgMi43NzEtNi4xNDk2IDYuMTczOE04IDEyLjAwNzdhNCA0IDAgMSAxIDQuMDA4IDMuOTkyMUEzLjk5OTYgMy45OTk2IDAgMCAxIDggMTIuMDA3NyIvPjwvc3ZnPg==" width="15" height="15" alt="Instagram" style="display:block;" /></td></tr>
            </table>
          </td>
          <td style="padding:5px 0 5px 10px;vertical-align:middle;">
            <a href="https://instagram.com/vetly.pro" style="font-size:13px;color:#27272a;font-family:Arial,sans-serif;text-decoration:none;">@vetly.pro</a>
          </td>
        </tr>
        <tr>
          <td width="30" style="padding:5px 0;vertical-align:middle;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="26" height="26" style="border-radius:50%;background-color:#0d9488;background-image:linear-gradient(135deg,#0d9488,#0ea5e9);">
              <tr><td align="center" valign="middle"><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE1IiBoZWlnaHQ9IjE1IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIxMCIvPjxsaW5lIHgxPSIyIiB5MT0iMTIiIHgyPSIyMiIgeTI9IjEyIi8+PHBhdGggZD0iTTEyIDJhMTUuMyAxNS4zIDAgMCAxIDQgMTAgMTUuMyAxNS4zIDAgMCAxLTQgMTAgMTUuMyAxNS4zIDAgMCAxLTQtMTAgMTUuMyAxNS4zIDAgMCAxIDQtMTB6Ii8+PC9zdmc+" width="15" height="15" alt="Web" style="display:block;" /></td></tr>
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

function renderProspectingHtml(bodyHtml: string, leadId: string, variant: "a" | "b" | "c"): string {
  // Plantilla deliberadamente distinta de renderEmailLayout (esa tiene
  // gradiente morado y card de marca, apropiada para lifecycle — acá el
  // pedido explícito es que se vea como un correo personal, no una campaña
  // de marketing). Sin header de color, sin botones — la única marca es el
  // logo chico de la firma.
  //
  // Píxel de tracking PROPIO al final (track-prospect-open) — el
  // open_tracking nativo de Resend no aplica para mail.vetly.pro (ver
  // comentario en ese edge function). Es la única forma real de que
  // "Abiertos" en el panel de prospección refleje algo cierto. El parámetro
  // `v` deja registrar la apertura en la columna correcta (A/B/C).
  const trackingPixel = `<img src="${SUPABASE_URL}/functions/v1/track-prospect-open?id=${leadId}&v=${variant}" width="1" height="1" style="display:none;border:0;" alt="" />`;
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#ffffff;">
<div style="max-width:560px;margin:0 auto;padding:32px 20px;font-family:Arial,sans-serif;">
${bodyHtml}
${SIGNATURE_HTML}
</div>
${trackingPixel}
</body></html>`;
}

interface VariantCfg {
  readyStatus: string;
  sentStatus: string;
  subjectCol: string;
  bodyCol: string;
  sentAtCol: string;
  resendIdCol: string;
  /** Columna que debe tener >= 2 días de antigüedad para poder mandar este
   * paso (null para A, que no tiene gate de tiempo, solo de aprobación). */
  gateCol: string | null;
}

const VARIANTS: Record<"a" | "b" | "c", VariantCfg> = {
  a: { readyStatus: "listo_para_enviar", sentStatus: "email_enviado", subjectCol: "email_subject", bodyCol: "email_body", sentAtCol: "email_sent_at", resendIdCol: "resend_id", gateCol: null },
  b: { readyStatus: "listo_para_enviar_b", sentStatus: "email_b_enviado", subjectCol: "email_b_subject", bodyCol: "email_b_body", sentAtCol: "email_b_sent_at", resendIdCol: "resend_id_b", gateCol: "email_sent_at" },
  c: { readyStatus: "listo_para_enviar_c", sentStatus: "secuencia_completa", subjectCol: "email_c_subject", bodyCol: "email_c_body", sentAtCol: "email_c_sent_at", resendIdCol: "resend_id_c", gateCol: "email_b_sent_at" },
};

type Candidate = { id: string; country: string; email: string | null } & Record<string, unknown>;

async function fetchReady(
  supabase: ReturnType<typeof createClient>,
  cfg: VariantCfg,
  gateIso: string | null,
): Promise<Candidate[]> {
  let q = supabase
    .from("prospecting_leads")
    .select(`id, country, email, ${cfg.subjectCol}, ${cfg.bodyCol}`)
    .eq("contact_status", cfg.readyStatus)
    .order("created_at", { ascending: true });
  if (cfg.gateCol && gateIso) q = q.lte(cfg.gateCol, gateIso);
  const { data } = await q;
  return (data || []) as Candidate[];
}

/** Reparte por país en round-robin hasta llenar `remaining` o agotar todos
 * los países — el mismo mecanismo de siempre, generalizado para los 3 pasos. */
function roundRobinByCountry(leads: Candidate[], remaining: number): { toSend: Candidate[]; remainingAfter: number } {
  const byCountry = new Map<string, Candidate[]>();
  for (const lead of leads) {
    if (!byCountry.has(lead.country)) byCountry.set(lead.country, []);
    byCountry.get(lead.country)!.push(lead);
  }
  const countries = Array.from(byCountry.keys()).sort();
  const toSend: Candidate[] = [];
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
  return { toSend, remainingAfter: remaining };
}

Deno.serve(async (req: Request) => {
    // Solo invocable por el sistema (pg_cron / otras funciones con service role).
    if (req.method !== 'OPTIONS' && !(await isServiceRoleRequest(req))) return forbiddenResponse()
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
    const twoDaysAgoIso = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();

    // Auto-generación de B/C — decisión explícita del usuario (2026-10-17):
    // pasados 2 días desde que salió el paso anterior, se genera con IA, se
    // aprueba y queda listo para enviarse en ESTA MISMA corrida — sin
    // revisión humana. Riesgo conocido y aceptado (ver nota en
    // hq-generate-prospect-email: caso real "Posta Veterinaria" sin
    // catálogo). Nunca corre en dryRun — gastaría OpenAI real y escribiría
    // en la DB. B depende de A (email_enviado), C depende de B
    // (email_b_enviado) — mismas columnas que fetchReady() usa más abajo
    // para decidir qué ENVIAR.
    async function autoGenerateStep(variant: "b" | "c", sourceStatus: string, sourceSentAtCol: string) {
      const { data: candidates } = await supabase
        .from("prospecting_leads")
        .select("id")
        .eq("contact_status", sourceStatus)
        .lte(sourceSentAtCol, twoDaysAgoIso);
      for (const c of candidates || []) {
        try {
          const res = await fetch(`${SUPABASE_URL}/functions/v1/hq-generate-prospect-email`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
            body: JSON.stringify({ prospect_id: c.id, variant, auto_approve: true }),
          });
          if (!res.ok) console.error(`[auto-generate ${variant}] ${c.id}:`, await res.text());
        } catch (e) {
          console.error(`[auto-generate ${variant}] ${c.id}:`, e);
        }
      }
    }
    if (!dryRun) {
      await autoGenerateStep("b", "email_enviado", "email_sent_at");
      await autoGenerateStep("c", "email_b_enviado", "email_b_sent_at");
    }

    // Cuota compartida entre A/B/C — cuenta cualquier envío real de hoy,
    // sin importar en qué paso de la secuencia esté cada lead.
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const [sentA, sentB, sentC] = await Promise.all([
      supabase.from("prospecting_leads").select("id", { count: "exact", head: true }).gte("email_sent_at", todayStart),
      supabase.from("prospecting_leads").select("id", { count: "exact", head: true }).gte("email_b_sent_at", todayStart),
      supabase.from("prospecting_leads").select("id", { count: "exact", head: true }).gte("email_c_sent_at", todayStart),
    ]);
    const sentToday = (sentA.count || 0) + (sentB.count || 0) + (sentC.count || 0);

    let remaining = dailyCap - sentToday;
    if (remaining <= 0) {
      return json({ ok: true, dailyCap, sentToday, skipped: "cuota del día ya cubierta" });
    }

    // Prioridad C > B > A: terminar una secuencia ya empezada (con una
    // ventana de tiempo real corriendo) pesa más que arrancar un lead nuevo.
    const candidatesC = await fetchReady(supabase, VARIANTS.c, twoDaysAgoIso);
    const rrC = roundRobinByCountry(candidatesC, remaining);
    remaining = rrC.remainingAfter;

    const candidatesB = await fetchReady(supabase, VARIANTS.b, twoDaysAgoIso);
    const rrB = roundRobinByCountry(candidatesB, remaining);
    remaining = rrB.remainingAfter;

    const candidatesA = await fetchReady(supabase, VARIANTS.a, null);
    const rrA = roundRobinByCountry(candidatesA, remaining);
    remaining = rrA.remainingAfter;

    const toSend: Array<Candidate & { _variant: "a" | "b" | "c" }> = [
      ...rrC.toSend.map(l => ({ ...l, _variant: "c" as const })),
      ...rrB.toSend.map(l => ({ ...l, _variant: "b" as const })),
      ...rrA.toSend.map(l => ({ ...l, _variant: "a" as const })),
    ];

    if (toSend.length === 0) {
      return json({ ok: true, dailyCap, sentToday, sent: 0, note: "sin leads listos para ningún paso (A/B/C)" });
    }

    if (dryRun) {
      return json({
        ok: true, dryRun: true, dailyCap, sentToday,
        wouldSend: toSend.map(l => ({ id: l.id, country: l.country, email: l.email, variant: l._variant })),
      });
    }

    let sent = 0;
    const errors: string[] = [];

    for (const lead of toSend) {
      const cfg = VARIANTS[lead._variant];
      try {
        const subject = lead[cfg.subjectCol] as string | null;
        const bodyHtml = lead[cfg.bodyCol] as string | null;
        if (!lead.email || !subject || !bodyHtml) {
          errors.push(`${lead.id} (${lead._variant}): faltan campos (email/subject/body)`);
          continue;
        }
        const result = await sendEmail({
          to: lead.email,
          subject,
          html: renderProspectingHtml(bodyHtml, lead.id, lead._variant),
          // Subdominio dedicado (mail.vetly.pro, verificado en Resend
          // 2026-08-31 — SPF+DKIM propios vía Cloudflare Domain Connect)
          // para aislar la reputación del correo en frío del transaccional
          // que sigue mandando hola@vetly.pro (bienvenida, secuencia, etc.).
          from: "Sebastián · Vetly <sebastian@mail.vetly.pro>",
        });
        if (!result.ok) {
          errors.push(`${lead.id} (${lead._variant}): ${result.error}`);
          continue;
        }
        const updatePayload: Record<string, unknown> = { contact_status: cfg.sentStatus };
        updatePayload[cfg.sentAtCol] = new Date().toISOString();
        updatePayload[cfg.resendIdCol] = result.id || null;
        await supabase.from("prospecting_leads").update(updatePayload).eq("id", lead.id);
        sent++;
      } catch (e) {
        errors.push(`${lead.id} (${lead._variant}): ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (errors.length) console.error("[cron-hq-prospecting-campaign] errores:", errors);

    return json({ ok: true, dailyCap, sentToday: sentToday + sent, sent, errors });
  } catch (e) {
    console.error("[cron-hq-prospecting-campaign] error:", e);
    return json({ error: "Internal server error" }, 500);
  }
});
