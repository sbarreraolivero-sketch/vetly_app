/**
 * Lectura de la atribución publicitaria capturada por `public/vetly-tracking.js`.
 *
 * La captura NO vive acá: vive en el script síncrono que cargan `index.html`,
 * `public/landing.html` y `public/core.html`, porque el usuario típico de una
 * campaña aterriza en `/core` (HTML estático, fuera de React) y sólo después
 * navega a `/register`. Si la captura viviera únicamente en la SPA, todo click
 * que aterrice en una landing estática perdería el `gclid`.
 *
 * Este módulo sólo LEE lo que aquel guardó (cookie first-party de 90 días, con
 * localStorage como respaldo) para poder mandarlo al backend en el registro.
 */

export interface AttributionPayload {
    gclid: string | null
    wbraid: string | null
    gbraid: string | null
    msclkid: string | null
    fbclid: string | null
    utm_source: string | null
    utm_medium: string | null
    utm_campaign: string | null
    utm_term: string | null
    utm_content: string | null
    landing_url: string | null
    referrer: string | null
    first_seen_at: string | null
    last_touch_at: string | null
}

declare global {
    interface Window {
        vetlyAttribution?: () => Partial<AttributionPayload> | null
    }
}

const ATTRIBUTION_KEY = 'vetly_attribution'

function readCookie(name: string): string | null {
    try {
        const m = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)')
        return m ? decodeURIComponent(m[2]) : null
    } catch {
        return null
    }
}

/**
 * Respaldo por si `vetly-tracking.js` no llegó a cargar (bloqueador de anuncios,
 * fallo de red del asset). Lee exactamente las mismas claves y el mismo formato
 * que escribe aquel script — cualquier cambio de formato allá hay que reflejarlo
 * acá.
 */
function readStoreDirect(): Partial<AttributionPayload> | null {
    let raw = readCookie(ATTRIBUTION_KEY)
    if (!raw) {
        try {
            raw = localStorage.getItem(ATTRIBUTION_KEY)
        } catch {
            raw = null
        }
    }
    if (!raw) return null
    try {
        return JSON.parse(raw) as Partial<AttributionPayload>
    } catch {
        return null
    }
}

/**
 * Devuelve la atribución guardada, o `null` si el visitante llegó sin ningún
 * parámetro de campaña (tráfico directo/orgánico). Nunca lanza: un fallo acá
 * jamás debe impedir un registro.
 */
export function getAttribution(): Partial<AttributionPayload> | null {
    try {
        const fromScript = window.vetlyAttribution?.()
        if (fromScript && Object.keys(fromScript).length > 0) return fromScript
        return readStoreDirect()
    } catch {
        return null
    }
}

/**
 * `true` si hay al menos un identificador de clic pagado. Se usa para no mandar
 * al backend un objeto lleno de nulls que sólo ensucia la tabla `attribution`.
 */
export function hasPaidAttribution(a: Partial<AttributionPayload> | null): boolean {
    if (!a) return false
    return Boolean(a.gclid || a.wbraid || a.gbraid || a.msclkid || a.fbclid || a.utm_source)
}
