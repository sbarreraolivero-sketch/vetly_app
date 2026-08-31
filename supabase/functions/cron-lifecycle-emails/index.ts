/**
 * ════════════════════════════════════════════════════════════════════════════
 * SECUENCIA DE CORREOS DE ONBOARDING — plan Core
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Corre 1 vez al día (pg_cron, ver migración schedule_lifecycle_emails_cron).
 * Por cada clínica Core activa dentro de la ventana de 35 días desde el alta,
 * manda como máximo UN correo por corrida: el primer paso de la lista que ya
 * cumplió su "día mínimo" y no se envió antes.
 *
 * SECUENCIA FIJA — misma para toda clínica nueva, no ramifica por comportamiento.
 * El "día mínimo" (ageDays >= N) solo pauta el ritmo: nunca expira, así que una
 * clínica que se registró hace 4 días y recién ahora entra a la secuencia
 * recibe paso 1→4 en días seguidos (uno por corrida, gap mínimo de 24h) y
 * después se estira a la cadencia normal. Nadie recibe dos el mismo día.
 *
 * Idempotencia: `email_sequence_log` con UNIQUE(clinic_id, email_key) — cada
 * paso se manda como máximo una vez por clínica, para siempre.
 *
 * ⚠️ MESSAGING: nunca los ángulos "WhatsApp sin parar" / "el domingo en la
 * noche" — son la promesa del agente IA conversacional, que Core no tiene. El
 * ángulo de Core es orden, 3 usuarios, y recordatorios que salen desde el
 * día 1 sin instalar nada.
 *
 * Salida de la secuencia (todo en el WHERE de la query inicial): plan != core,
 * `manually_active = true`, `lifecycle_emails_opt_out = true`, o más de 35 días
 * desde el alta.
 *
 * Capturas: cada correo tiene un hueco de imagen (SHOTS). Mientras estén
 * vacías, el correo sale solo con texto + botón — `screenshot()` no renderiza
 * nada si la URL está vacía. Al tener las imágenes, subirlas a
 * public/email-shots/ y llenar la URL correspondiente en SHOTS.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendEmail, renderEmailLayout } from "../_shared/email.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APP_URL = "https://www.vetly.pro";
const SUPPORT_WA = "56993089185";
const MIN_GAP_HOURS = 24;
const SEQUENCE_CUTOFF_DAYS = 35;
const UNSUBSCRIBE_BASE = "https://ehmncwawzdciajvuallg.supabase.co/functions/v1/unsubscribe-lifecycle-emails";

// ── Capturas de cada paso ──────────────────────────────────────────────────
// Vacío = el correo sale sin imagen. Llenar con la URL pública
// (https://www.vetly.pro/email-shots/<archivo>) cuando estén listas.
const SHOTS: Record<string, string> = {
    paso1_datos: "",
    paso1_horarios: "",
    paso2_equipo: "",
    paso3_servicio: "",
    paso4_inventario: "",
    paso5_importar: "",
    paso6_ingreso: "",
    paso7_fidelizacion: "",
    paso8_recordatorios: "",
    paso9_firma: "",
    paso9_marca: "",
};

interface ClinicSignals {
    ageDays: number;
    trialDaysLeft: number | null;
}

interface EmailRule {
    key: string;
    minDay: number | null; // null = solo aplica la condición de trial
    condition: (s: ClinicSignals) => boolean;
    build: (clinic: any, firstName: string) => { subject: string; html: string };
}

// ── Bloques de HTML reutilizables ──────────────────────────────────────────
function p(text: string): string {
    return `<p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #5a5a5a;">${text}</p>`;
}

function bullets(items: string[]): string {
    return `<ul style="margin: 0 0 20px 0; padding-left: 20px; font-size: 15px; line-height: 1.7; color: #5a5a5a;">
        ${items.map((i) => `<li style="margin-bottom: 8px;">${i}</li>`).join("")}
    </ul>`;
}

function screenshot(url: string, alt: string): string {
    if (!url) return "";
    return `<img src="${url}" alt="${alt}" width="536" style="display:block; width:100%; max-width:536px; height:auto; border:1px solid #EDE6DE; border-radius:10px; margin:4px 0 24px 0;">`;
}

function ctaBox(title: string, text: string, buttonLabel: string, url: string): string {
    return `
        <div style="margin: 8px 0 24px 0; padding: 26px 22px; background-color: #F5F3FF; border: 1px solid #DDD6FE; border-radius: 16px; text-align: center;">
            <p style="margin: 0 0 6px 0; font-size: 15px; font-weight: 700; color: #6D28D9;">${title}</p>
            <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.5; color: #5B21B6;">${text}</p>
            <a href="${url}" style="display: inline-block; background-color: #7C3AED; color: #ffffff; font-size: 16px; font-weight: 700; text-decoration: none; padding: 14px 34px; border-radius: 10px;">
                ${buttonLabel}
            </a>
        </div>`;
}

// Botón verde de soporte por WhatsApp — va en TODOS los correos de la
// secuencia. Distinto del CTA morado para que se lea como "canal de ayuda",
// no como el paso principal.
function supportButton(contextMsg: string): string {
    const url = `https://wa.me/${SUPPORT_WA}?text=${encodeURIComponent(contextMsg)}`;
    return `
        <div style="margin: 4px 0 0 0; padding: 16px; background-color: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 12px; text-align: center;">
            <p style="margin: 0 0 12px 0; font-size: 13px; color: #15803D;">¿Te trabaste en este paso? Te ayudamos gratis, ahora mismo.</p>
            <a href="${url}" style="display: inline-block; background-color: #22C55E; color: #ffffff; font-size: 14px; font-weight: 700; text-decoration: none; padding: 11px 24px; border-radius: 9px;">
                Escribir a Soporte por WhatsApp
            </a>
        </div>`;
}

// ── La secuencia ───────────────────────────────────────────────────────────
const RULES: EmailRule[] = [
    {
        key: "paso1_clinica_horarios",
        minDay: 1,
        condition: (s) => s.ageDays >= 1,
        build: (clinic, firstName) => ({
            subject: `${firstName}, deja tu clínica y tus horarios bien configurados`,
            html: renderEmailLayout({
                headerTitle: "Configura tu clínica y tus horarios",
                headerSubtitle: "Es la base — si esto queda mal, la agenda ofrece horas equivocadas",
                bodyHtml:
                    p(`Hola ${firstName}, tu cuenta ya está lista. Antes de cargar pacientes o servicios, conviene dejar dos cosas firmes: los datos de tu clínica y tus horarios. Todo lo demás se apoya en esto.`) +
                    p(`<strong>1. Datos de la clínica</strong> — <em>Configuración → Clínica</em><br>Nombre, dirección y teléfono de contacto. El nombre aparece en los comprobantes que le envías al tutor por WhatsApp. (El logo se sube aparte, en Reservas Online — eso va en los videos que te mandaremos.)`) +
                    screenshot(SHOTS.paso1_datos, "Pestaña Clínica en Configuración") +
                    p(`<strong>2. Horarios — y una diferencia que confunde a todos</strong><br>En Vetly hay dos horarios distintos:`) +
                    bullets([
                        `<strong>Horario de la clínica</strong> (<em>Configuración → Horarios</em>): cuándo atiende tu clínica en general. Es el marco.`,
                        `<strong>Horario del profesional</strong> (<em>Configuración → Mi Perfil</em>): tu disponibilidad personal dentro de ese marco.`,
                    ]) +
                    p(`La agenda y el link de reservas usan <strong>el del profesional</strong> cuando hay uno asignado. Si eres el único que atiende, configura los dos iguales. Si tienes equipo, cada profesional define el suyo.`) +
                    screenshot(SHOTS.paso1_horarios, "Configuración de horarios") +
                    ctaBox("Configura tu clínica", "Datos, logo y horarios — son 3 minutos.", "Ir a Configuración", `${APP_URL}/app/settings?tab=clinic`) +
                    supportButton(`Hola! Soy de ${clinic.clinic_name}, necesito ayuda para configurar los datos y horarios de mi clínica en Vetly.`),
            }),
        }),
    },
    {
        key: "paso2_equipo",
        minDay: 3,
        condition: (s) => s.ageDays >= 3,
        build: (clinic, firstName) => ({
            subject: `${firstName}, tu plan incluye 3 usuarios — así se suman`,
            html: renderEmailLayout({
                headerTitle: "Suma a tu equipo",
                headerSubtitle: "Hasta 3 usuarios sin costo extra",
                bodyHtml:
                    p(`Hola ${firstName}, tu plan Core incluye <strong>hasta 3 usuarios sin costo adicional</strong>. Si trabajas con alguien — otro veterinario, un asistente, quien lleva la recepción — dale su propia cuenta.`) +
                    p(`<strong>Cómo se suma alguien</strong> — <em>Configuración → Equipo</em><br>Escribes su correo, eliges su rol y le llega una invitación. Cuando la acepta, entra con su propia clave.`) +
                    screenshot(SHOTS.paso2_equipo, "Pestaña Equipo en Configuración") +
                    p(`<strong>Por qué cada uno con su cuenta (y no compartir la tuya):</strong>`) +
                    bullets([
                        `Ves <strong>quién hizo qué</strong>: quién cargó una ficha, quién cerró una caja, quién cambió un precio.`,
                        `La <strong>caja del día queda por usuario</strong> — al cierre sabes cuánto manejó cada uno.`,
                        `Puedes <strong>limitar qué secciones ve cada rol</strong>: por ejemplo, que el asistente no vea las finanzas.`,
                    ]) +
                    p(`Si por ahora trabajas solo, sáltate este paso — cuando sumes a alguien, vuelves acá.`) +
                    ctaBox("Invita a tu equipo", "Cada persona entra con su cuenta y su rol.", "Ir a mi equipo", `${APP_URL}/app/settings?tab=team`) +
                    supportButton(`Hola! Soy de ${clinic.clinic_name}, necesito ayuda para agregar usuarios a mi equipo en Vetly.`),
            }),
        }),
    },
    {
        key: "paso3_servicios",
        minDay: 5,
        condition: (s) => s.ageDays >= 5,
        build: (clinic, firstName) => ({
            subject: `${firstName}, carga tus servicios (sin esto no puedes cobrar ni agendar)`,
            html: renderEmailLayout({
                headerTitle: "Carga tu catálogo de servicios",
                headerSubtitle: "Cada servicio con su precio y su duración real",
                bodyHtml:
                    p(`Hola ${firstName}, el catálogo de servicios es la pieza que conecta casi todo: sin él no puedes agendar una cita con un servicio asignado, cerrar una visita ni registrar lo que cobraste.`) +
                    p(`<strong>Qué cargar</strong> — <em>Configuración → Clínica → sección Servicios</em><br>Cada servicio con <strong>precio</strong> (el que cobras hoy) y <strong>duración real</strong> (cuánto te toma; esto define los bloques de tu agenda — si pones 15 min a algo de 40, tu día se llena de citas encimadas).`) +
                    screenshot(SHOTS.paso3_servicio, "Modal de nuevo servicio") +
                    p(`<strong>Dos opciones al crear o editar un servicio:</strong>`) +
                    bullets([
                        `<strong>Enlazar con un producto del inventario.</strong> Eliges el producto que consume ese servicio (ej. "Vacuna óctuple" → la vacuna del inventario) y la cantidad. Cada vez que vendas el servicio, esa cantidad se descuenta del stock sola. Necesitas tener el producto en el inventario primero — eso lo vemos en el próximo correo, después vuelves a completar el enlace.`,
                        `<strong>"Reservable en tu página online".</strong> Marca esta casilla en los servicios que quieres que tus clientes puedan agendar solos desde tu link de reservas. Los que no marques, no aparecen ahí.`,
                    ]) +
                    p(`<strong>Para que quede bien:</strong> nombres claros y cortos ("Consulta general", no "CONSULTA MEDICA DE PRIMERA VEZ"). Si un servicio cambia de precio por peso o tamaño, créalo varias veces ("Vacuna óctuple — perro chico / mediano / grande").`) +
                    ctaBox("Carga tus servicios", "Precio, duración y las dos casillas.", "Ir a Servicios", `${APP_URL}/app/settings?tab=clinic`) +
                    supportButton(`Hola! Soy de ${clinic.clinic_name}, necesito ayuda para cargar mis servicios en Vetly.`),
            }),
        }),
    },
    {
        key: "paso4_inventario",
        minDay: 7,
        condition: (s) => s.ageDays >= 7,
        build: (clinic, firstName) => ({
            subject: `${firstName}, sube tus productos para no quedarte sin stock a mitad de semana`,
            html: renderEmailLayout({
                headerTitle: "Sube tus productos al inventario",
                headerSubtitle: "Vetly te avisa antes de que se acabe algo",
                bodyHtml:
                    p(`Hola ${firstName}, el inventario te sirve para dos cosas: saber qué tienes sin ir a contarlo, y que Vetly te avise <strong>antes</strong> de quedarte sin una vacuna o un medicamento.`) +
                    p(`<strong>Qué cargar por producto</strong> — <em>Inventario → Catálogo</em>`) +
                    bullets([
                        `Nombre y categoría (medicamento, vacuna, insumo, alimento…).`,
                        `<strong>Precio de compra</strong> (lo que te cuesta) y <strong>precio de venta</strong> (lo que cobras). Con los dos, Vetly te muestra tu margen real.`,
                        `<strong>Stock actual</strong>: cuántas unidades tienes hoy.`,
                        `<strong>Alerta de mínimo</strong>: cuando el stock baje de ese número, te avisa en el panel.`,
                    ]) +
                    screenshot(SHOTS.paso4_inventario, "Catálogo de inventario con alerta de stock") +
                    p(`Cuando tengas el catálogo cargado, vuelve a tus servicios (correo anterior) y enlaza cada uno con su producto — así el stock se descuenta solo con cada venta.`) +
                    ctaBox("Carga tu inventario", "Productos, precios y alertas de mínimo.", "Ir a Inventario", `${APP_URL}/app/inventory`) +
                    supportButton(`Hola! Soy de ${clinic.clinic_name}, necesito ayuda para cargar mi inventario en Vetly.`),
            }),
        }),
    },
    {
        key: "paso5_pacientes",
        minDay: 9,
        condition: (s) => s.ageDays >= 9,
        build: (clinic, firstName) => ({
            subject: `${firstName}, trae tus pacientes (¿tienes tu Excel? mejor)`,
            html: renderEmailLayout({
                headerTitle: "Trae tus pacientes",
                headerSubtitle: "La importación reconoce nombre, especie y dueño",
                bodyHtml:
                    p(`Hola ${firstName}, este es el paso en que Vetly empieza a servirte de verdad: tener a todos tus pacientes adentro, buscables en segundos.`) +
                    p(`<strong>Si tienes una lista en Excel</strong> — <em>Pacientes → Importar</em><br>Súbela tal cual. La importación reconoce nombre, especie, raza y dueño automáticamente. Si tienes cientos de pacientes, se cargan todos de una vez — no los pases a mano.`) +
                    screenshot(SHOTS.paso5_importar, "Pantalla de importación de pacientes desde Excel") +
                    p(`<strong>Si empiezas de cero:</strong> agrega tu primer paciente a mano (<em>Pacientes → Agregar</em>) con su tutor. Un minuto.`) +
                    p(`<strong>Después: tu primera cita.</strong> Con un paciente y un servicio cargados, agenda una cita real (<em>Citas → Nueva</em>). Ahí ves cómo se juntan las piezas: paciente + servicio + fecha, con el bloque de agenda calculado según la duración que definiste.`) +
                    p(`¿Ya cargaste tus pacientes? Usa este correo para revisar que las fichas quedaron completas y agendar esa primera cita.`) +
                    ctaBox("Carga tus pacientes", "Importa tu Excel o agrega el primero a mano.", "Ir a Pacientes", `${APP_URL}/app/patients`) +
                    supportButton(`Hola! Soy de ${clinic.clinic_name}, necesito ayuda para importar mis pacientes a Vetly.`),
            }),
        }),
    },
    {
        key: "paso6_finanzas",
        minDay: 12,
        condition: (s) => s.ageDays >= 12,
        build: (clinic, firstName) => ({
            subject: `${firstName}, así queda tu caja del día sin sumar boletas a mano`,
            html: renderEmailLayout({
                headerTitle: "Registra tu primer ingreso",
                headerSubtitle: "Tu caja del día se arma sola",
                bodyHtml:
                    p(`Hola ${firstName}, cada vez que cobras algo — una consulta, un producto, un servicio — regístralo en Finanzas. Así sabes exactamente cuánto entró cada día, sin juntar boletas.`) +
                    p(`<strong>Dos formas de registrar un ingreso:</strong>`) +
                    bullets([
                        `<strong>Al cerrar una visita</strong>: marcas la cita como atendida, eliges los servicios y productos que usaste, el medio de pago, y el ingreso queda con el tutor vinculado.`,
                        `<strong>Botón "+ Ingreso"</strong> (<em>Finanzas</em>): para cobros sueltos que no vienen de una cita.`,
                    ]) +
                    screenshot(SHOTS.paso6_ingreso, "Modal de cierre de visita o nuevo ingreso") +
                    p(`<strong>Tu caja del día</strong> se <strong>abre sola a las 07:00</strong> de tu hora local. Durante el día suma cada ingreso. Al terminar, la cierras: Vetly te muestra el total por medio de pago y te deja un informe imprimible. Si algo no cuadra, lo ves al instante.`) +
                    ctaBox("Registra un ingreso", "Elige el servicio o producto, el monto y el medio de pago.", "Ir a Finanzas", `${APP_URL}/app/finance`) +
                    supportButton(`Hola! Soy de ${clinic.clinic_name}, necesito ayuda con Finanzas y la caja del día en Vetly.`),
            }),
        }),
    },
    {
        key: "paso7_fidelizacion",
        minDay: 15,
        condition: (s) => s.ageDays >= 15,
        build: (clinic, firstName) => ({
            subject: `${firstName}, haz que tus clientes vuelvan (y traigan a otros)`,
            html: renderEmailLayout({
                headerTitle: "Activa fidelización y referidos",
                headerSubtitle: "Viene apagado — hay que activarlo",
                bodyHtml:
                    p(`Hola ${firstName}, conseguir un cliente nuevo cuesta más que hacer volver a uno que ya confía en ti. Tu plan incluye un programa de fidelización y referidos — y viene <strong>apagado</strong>, así que hay que activarlo.`) +
                    p(`<strong>Cómo se activa</strong> — <em>Fidelización → Ajustes</em><br>Un asistente de 3 preguntas. O usas el preset recomendado directo:`) +
                    bullets([
                        `<strong>15%</strong> de bienvenida (saldo para el cliente que llega referido)`,
                        `<strong>10%</strong> para el cliente que refiere`,
                        `<strong>5%</strong> que se acumula en cada compra siguiente`,
                    ]) +
                    screenshot(SHOTS.paso7_fidelizacion, "Asistente de configuración de fidelización") +
                    p(`<strong>Cómo funciona una vez activo:</strong>`) +
                    bullets([
                        `Cada tutor tiene un <strong>código de referido</strong> propio.`,
                        `Cada tutor abre su <strong>carnet digital</strong> desde el celular: ve su saldo de puntos, el historial de vacunas de su mascota y su enlace para referir. Le mandas ese link por WhatsApp.`,
                        `Los puntos se acumulan y se descuentan solos desde cada venta que registras en Finanzas.`,
                    ]) +
                    ctaBox("Activa tu programa", "Elige tus reglas en un par de clics.", "Ir a Fidelización", `${APP_URL}/app/loyalty`) +
                    supportButton(`Hola! Soy de ${clinic.clinic_name}, necesito ayuda para activar el programa de fidelización en Vetly.`),
            }),
        }),
    },
    {
        key: "paso8_recordatorios",
        minDay: 18,
        condition: (s) => s.ageDays >= 18,
        build: (clinic, firstName) => ({
            subject: `${firstName}, tus recordatorios ya funcionan — y esto es lo que viene`,
            html: renderEmailLayout({
                headerTitle: "Recordatorios manuales, y lo que viene",
                headerSubtitle: "Funcionan desde hoy, sin conectar nada",
                bodyHtml:
                    p(`Hola ${firstName}, ya tienes lo esencial de ${clinic.clinic_name} en orden. Dos cosas para cerrar.`) +
                    p(`<strong>1. Recordatorios manuales — funcionan desde hoy, sin conectar nada</strong><br>En <em>Recordatorios → Enviar hoy</em>, Vetly te arma la lista de a quién avisar (citas de mañana, vacunas por vencer) y te abre el mensaje <strong>ya escrito</strong> en WhatsApp, con el nombre del tutor y la fecha. Tú revisas y envías.`) +
                    screenshot(SHOTS.paso8_recordatorios, "Pestaña Enviar hoy en Recordatorios") +
                    p(`<strong>2. Lo que viene en video</strong><br>Estos días te mandamos tutoriales cortos para la parte más técnica:`) +
                    bullets([
                        `Enlazar un servicio con su producto de inventario (que el stock baje solo)`,
                        `Crear tu link de reservas online con tu logo y color`,
                        `Conectar tu WhatsApp para los recordatorios automáticos`,
                        `Crear las plantillas que activan esos recordatorios automáticos`,
                    ]) +
                    ctaBox("Ver mis recordatorios", "La pestaña Enviar hoy ya está lista para usar.", "Ir a Recordatorios", `${APP_URL}/app/reminders`) +
                    supportButton(`Hola! Soy de ${clinic.clinic_name}, necesito ayuda con los recordatorios en Vetly.`),
            }),
        }),
    },
    {
        key: "paso9_recetas",
        minDay: 21,
        condition: (s) => s.ageDays >= 21,
        build: (clinic, firstName) => ({
            subject: `${firstName}, deja lista tu firma antes de emitir tu primera receta`,
            html: renderEmailLayout({
                headerTitle: "Recetas y órdenes médicas",
                headerSubtitle: "Tu firma, tus datos profesionales y tu marca — configúralos una vez",
                bodyHtml:
                    p(`Hola ${firstName}, Vetly emite <strong>recetas, órdenes médicas y derivaciones</strong> desde la ficha del paciente, descargables en PDF y enviables al tutor por WhatsApp o correo. Antes de la primera, tres cosas se configuran una sola vez y quedan para siempre.`) +
                    p(`<strong>1. Tu firma</strong> — <em>Configuración → Mi Perfil → Firma para documentos</em><br>La dibujas ahí mismo con el mouse o el dedo, o subes una foto de tu firma en papel. Se estampa sobre la línea de firma de cada documento que emitas. Cada profesional del equipo configura la suya.`) +
                    screenshot(SHOTS.paso9_firma, "Sección Firma para documentos en Mi Perfil") +
                    p(`<strong>2. Tus datos profesionales</strong> — <em>misma pantalla</em><br>Tu <strong>título</strong> (ej. Médico Veterinario) y tu <strong>número de colegiatura / matrícula / cédula profesional</strong>. Aparecen bajo tu nombre en el documento — en varios países son obligatorios para que la receta tenga validez. Son opcionales en Vetly: si los dejas en blanco, simplemente no se imprimen.`) +
                    p(`<strong>Cómo se usan estos datos:</strong> solo se muestran en los documentos que tú emites, y se guardan <em>congelados</em> en cada receta al momento de crearla. Si más adelante cambias tu matrícula o tu firma, las recetas antiguas conservan la información que tenían — no se reescriben.`) +
                    p(`<strong>3. Tu marca</strong> — <em>Configuración → Diseño de marca</em><br>El <strong>logo</strong> y <strong>dos colores</strong> de tu clínica. Con eso Vetly arma el encabezado de cada documento (logo + nombre + dirección + un degradado con tus colores) y también tu página de reservas online. Se configura una vez para todo.`) +
                    screenshot(SHOTS.paso9_marca, "Sección Diseño de marca en Configuración") +
                    p(`<strong>Sobre las recetas:</strong> los medicamentos son <strong>opcionales</strong>. Si es una orden para una radiografía o ecografía, o una derivación a otro profesional, eliges el tipo de documento y escribes la indicación — sin lista de medicamentos.`) +
                    ctaBox("Configura tu firma", "Firma + datos profesionales, en la misma pantalla.", "Ir a Mi Perfil", `${APP_URL}/app/settings?tab=profile`) +
                    supportButton(`Hola! Soy de ${clinic.clinic_name}, necesito ayuda para configurar mi firma y mi marca para las recetas en Vetly.`),
            }),
        }),
    },
    {
        key: "trial_por_terminar",
        minDay: null,
        condition: (s) => s.trialDaysLeft !== null && s.trialDaysLeft <= 5 && s.trialDaysLeft > 1,
        build: (clinic, firstName) => ({
            subject: `${firstName}, tu prueba de Vetly termina en pocos días`,
            html: renderEmailLayout({
                headerTitle: "Tu prueba está por terminar",
                headerSubtitle: `A ${clinic.clinic_name} le quedan pocos días de prueba gratuita`,
                bodyHtml:
                    p(`Hola ${firstName}, tu período de prueba de 30 días está por terminar. Para que ${clinic.clinic_name} no pierda el acceso a sus pacientes, recordatorios y reservas, puedes activar tu plan cuando quieras desde Configuración.`) +
                    ctaBox("Revisar mi plan", "Ver los detalles y activar tu suscripción.", "Ir a mi plan", `${APP_URL}/app/settings?tab=subscription`) +
                    supportButton(`Hola! Soy de ${clinic.clinic_name}, tengo dudas sobre activar mi plan en Vetly.`),
            }),
        }),
    },
    {
        key: "trial_ultimo_aviso",
        minDay: null,
        condition: (s) => s.trialDaysLeft !== null && s.trialDaysLeft <= 1,
        build: (clinic, firstName) => ({
            subject: `${firstName}, último aviso: tu prueba termina mañana`,
            html: renderEmailLayout({
                headerTitle: "Último aviso de tu prueba",
                headerSubtitle: `${clinic.clinic_name} — queda menos de un día`,
                bodyHtml:
                    p(`Hola ${firstName}, tu prueba gratuita de Vetly termina en menos de 24 horas. Si no activas tu plan, tu cuenta queda pausada — tus datos se conservan, pero dejarás de ver la agenda y los recordatorios hasta que actives de nuevo.`) +
                    ctaBox("Activar mi plan ahora", "Un par de minutos y sigues exactamente donde ibas.", "Activar mi plan", `${APP_URL}/app/settings?tab=subscription`) +
                    supportButton(`Hola! Soy de ${clinic.clinic_name}, necesito ayuda para activar mi plan antes de que termine la prueba.`),
            }),
        }),
    },
];

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    // ?dryRun=1 — resuelve qué correo le tocaría a cada clínica y lo reporta,
    // pero NO envía nada ni escribe en email_sequence_log. Para verificar la
    // secuencia antes de dejar el cron activo.
    const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";

    const log: string[] = [];
    let sent = 0;
    let skipped = 0;
    let failed = 0;

    try {
        const supabase = createClient(
            Deno.env.get("SUPABASE_URL") ?? "",
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
        );

        const cutoff = new Date(Date.now() - SEQUENCE_CUTOFF_DAYS * 24 * 60 * 60 * 1000).toISOString();

        // Solo Core, sin opt-out, dentro de la ventana de 35 días. `manually_active`
        // vive en subscriptions, no en clinic_settings — se excluye con una
        // segunda query.
        const { data: clinics, error: clinicsError } = await supabase
            .from("clinic_settings")
            .select("id, clinic_name, created_at, trial_end_date, lifecycle_email_token, lifecycle_emails_opt_out, subscription_plan")
            .eq("subscription_plan", "core")
            .eq("lifecycle_emails_opt_out", false)
            .gte("created_at", cutoff);

        if (clinicsError) throw clinicsError;

        const clinicIds = (clinics ?? []).map((c: any) => c.id);
        const { data: manualSubs } = clinicIds.length
            ? await supabase.from("subscriptions").select("clinic_id").in("clinic_id", clinicIds).eq("manually_active", true)
            : { data: [] as any[] };
        const manuallyActiveIds = new Set((manualSubs ?? []).map((s: any) => s.clinic_id));
        const eligibleClinics = (clinics ?? []).filter((c: any) => !manuallyActiveIds.has(c.id));

        log.push(`Clínicas Core candidatas: ${eligibleClinics.length}`);

        for (const clinic of eligibleClinics) {
            try {
                const { data: owner } = await supabase
                    .from("clinic_members")
                    .select("email, first_name")
                    .eq("clinic_id", clinic.id)
                    .eq("role", "owner")
                    .limit(1)
                    .maybeSingle();

                if (!owner?.email) {
                    log.push(`${clinic.id}: sin owner con email, se salta`);
                    continue;
                }

                // Gap mínimo entre correos.
                const { data: lastSent } = await supabase
                    .from("email_sequence_log")
                    .select("sent_at")
                    .eq("clinic_id", clinic.id)
                    .order("sent_at", { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (lastSent?.sent_at) {
                    const hoursSince = (Date.now() - new Date(lastSent.sent_at).getTime()) / 3_600_000;
                    if (hoursSince < MIN_GAP_HOURS) {
                        skipped++;
                        continue;
                    }
                }

                // Qué ya se mandó.
                const { data: sentRows } = await supabase
                    .from("email_sequence_log")
                    .select("email_key")
                    .eq("clinic_id", clinic.id);
                const alreadySent = new Set((sentRows ?? []).map((r: any) => r.email_key));

                const ageDays = Math.floor((Date.now() - new Date(clinic.created_at).getTime()) / 86_400_000);
                const trialDaysLeft = clinic.trial_end_date
                    ? Math.ceil((new Date(clinic.trial_end_date).getTime() - Date.now()) / 86_400_000)
                    : null;

                const signals: ClinicSignals = { ageDays, trialDaysLeft };

                const rule = RULES.find((r) => !alreadySent.has(r.key) && r.condition(signals));
                if (!rule) {
                    skipped++;
                    continue;
                }

                const firstName = owner.first_name || "colega";

                if (dryRun) {
                    sent++;
                    log.push(`[dryRun] ${clinic.clinic_name} (edad ${ageDays}d, prueba ${trialDaysLeft ?? "?"}d) → ${rule.key} → ${owner.email}`);
                    continue;
                }

                const { subject, html: fullHtml } = rule.build(clinic, firstName);

                // Link de baja al pie.
                const finalHtml = clinic.lifecycle_email_token
                    ? fullHtml.replace(
                          "</body>",
                          `<p style="text-align:center; margin:8px 0 0 0; font-size:11px;"><a href="${UNSUBSCRIBE_BASE}?token=${clinic.lifecycle_email_token}" style="color:#aaaaaa;">Dejar de recibir estos correos</a></p></body>`
                      )
                    : fullHtml;

                const result = await sendEmail({ to: owner.email, subject, html: finalHtml });

                if (!result.ok) {
                    failed++;
                    log.push(`${clinic.id} (${rule.key}): fallo de envío — ${result.error}`);
                    continue;
                }

                const { error: logInsertError } = await supabase
                    .from("email_sequence_log")
                    .insert({ clinic_id: clinic.id, email_key: rule.key, resend_id: result.id || null });

                if (logInsertError) {
                    log.push(`${clinic.id} (${rule.key}): enviado pero no se pudo registrar — ${logInsertError.message}`);
                }

                sent++;
                log.push(`${clinic.id}: enviado ${rule.key} a ${owner.email}`);
            } catch (e) {
                failed++;
                log.push(`${clinic.id}: error inesperado — ${e instanceof Error ? e.message : String(e)}`);
            }
        }

        return new Response(JSON.stringify({ sent, skipped, failed, log }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (error) {
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : String(error), log }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
