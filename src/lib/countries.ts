/**
 * ════════════════════════════════════════════════════════════════════════════
 * PAÍS → MONEDA / ZONA HORARIA — fuente única para el selector de registro
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Antes de este archivo, `clinic_settings.currency`/`.timezone` nacían siempre
 * en los DEFAULT de columna (CLP / America/Mexico_City) sin importar el país
 * real de la clínica — 10 de 11 registros del plan Core de agosto 2026
 * quedaron con moneda o zona equivocada. Este mapa resuelve ambas desde una
 * sola elección explícita en el registro.
 *
 * Clave: ISO-3166-1 alpha-2 — mismo formato que ya usa `cf-ipcountry` en
 * `attribution.country` (ver `supabase/functions/signup-handler/index.ts`),
 * así no hace falta reconciliar formatos distintos entre ambas fuentes.
 *
 * Espejo: `supabase/functions/_shared/countries.ts`. Si agregas un país,
 * agrégalo en los dos lugares.
 *
 * Nota: NO es lo mismo que `COUNTRY_TIMEZONES` en
 * `src/pages/BookOnboardingCall.tsx` (y sus 2 copias en edge functions) — ese
 * mapa usa nombres en español como clave para el formulario de agendar la
 * llamada de activación, y no está roto. Se deja intacto: cubre un propósito
 * distinto y tocarlo no es necesario para lo que este archivo resuelve.
 */

export type CountryCode =
    | 'AR' | 'BO' | 'CL' | 'CO' | 'CR' | 'CU' | 'DO' | 'EC' | 'SV' | 'ES'
    | 'GT' | 'HN' | 'MX' | 'NI' | 'PA' | 'PY' | 'PE' | 'PR' | 'UY' | 'VE'

export interface CountryInfo {
    name: string
    flag: string
    timezone: string
    currency: string
    /** Agrupación para los <optgroup> del selector. */
    region: 'Sudamérica' | 'Centroamérica y Caribe' | 'Norteamérica' | 'Europa'
}

export const COUNTRY_INFO: Record<CountryCode, CountryInfo> = {
    AR: { name: 'Argentina', flag: '🇦🇷', timezone: 'America/Argentina/Buenos_Aires', currency: 'ARS', region: 'Sudamérica' },
    BO: { name: 'Bolivia', flag: '🇧🇴', timezone: 'America/La_Paz', currency: 'BOB', region: 'Sudamérica' },
    CL: { name: 'Chile', flag: '🇨🇱', timezone: 'America/Santiago', currency: 'CLP', region: 'Sudamérica' },
    CO: { name: 'Colombia', flag: '🇨🇴', timezone: 'America/Bogota', currency: 'COP', region: 'Sudamérica' },
    EC: { name: 'Ecuador', flag: '🇪🇨', timezone: 'America/Guayaquil', currency: 'USD', region: 'Sudamérica' },
    PY: { name: 'Paraguay', flag: '🇵🇾', timezone: 'America/Asuncion', currency: 'PYG', region: 'Sudamérica' },
    PE: { name: 'Perú', flag: '🇵🇪', timezone: 'America/Lima', currency: 'PEN', region: 'Sudamérica' },
    UY: { name: 'Uruguay', flag: '🇺🇾', timezone: 'America/Montevideo', currency: 'UYU', region: 'Sudamérica' },
    VE: { name: 'Venezuela', flag: '🇻🇪', timezone: 'America/Caracas', currency: 'USD', region: 'Sudamérica' },

    CR: { name: 'Costa Rica', flag: '🇨🇷', timezone: 'America/Costa_Rica', currency: 'CRC', region: 'Centroamérica y Caribe' },
    CU: { name: 'Cuba', flag: '🇨🇺', timezone: 'America/Havana', currency: 'USD', region: 'Centroamérica y Caribe' },
    DO: { name: 'República Dominicana', flag: '🇩🇴', timezone: 'America/Santo_Domingo', currency: 'DOP', region: 'Centroamérica y Caribe' },
    SV: { name: 'El Salvador', flag: '🇸🇻', timezone: 'America/El_Salvador', currency: 'USD', region: 'Centroamérica y Caribe' },
    GT: { name: 'Guatemala', flag: '🇬🇹', timezone: 'America/Guatemala', currency: 'GTQ', region: 'Centroamérica y Caribe' },
    HN: { name: 'Honduras', flag: '🇭🇳', timezone: 'America/Tegucigalpa', currency: 'HNL', region: 'Centroamérica y Caribe' },
    NI: { name: 'Nicaragua', flag: '🇳🇮', timezone: 'America/Managua', currency: 'NIO', region: 'Centroamérica y Caribe' },
    PA: { name: 'Panamá', flag: '🇵🇦', timezone: 'America/Panama', currency: 'USD', region: 'Centroamérica y Caribe' },
    PR: { name: 'Puerto Rico', flag: '🇵🇷', timezone: 'America/Puerto_Rico', currency: 'USD', region: 'Centroamérica y Caribe' },

    MX: { name: 'México', flag: '🇲🇽', timezone: 'America/Mexico_City', currency: 'MXN', region: 'Norteamérica' },

    ES: { name: 'España', flag: '🇪🇸', timezone: 'Europe/Madrid', currency: 'EUR', region: 'Europa' },
}

export const COUNTRY_ORDER: CountryCode[] = [
    'AR', 'BO', 'CL', 'CO', 'EC', 'PY', 'PE', 'UY', 'VE',
    'CR', 'CU', 'DO', 'SV', 'GT', 'HN', 'NI', 'PA', 'PR',
    'MX',
    'ES',
]

/** Agrupa el listado por región, en el orden ya definido, para <optgroup>. */
export function getCountryGroups(): Array<{ region: CountryInfo['region']; options: Array<{ code: CountryCode; info: CountryInfo }> }> {
    const regions: CountryInfo['region'][] = ['Sudamérica', 'Centroamérica y Caribe', 'Norteamérica', 'Europa']
    return regions.map(region => ({
        region,
        options: COUNTRY_ORDER
            .filter(code => COUNTRY_INFO[code].region === region)
            .map(code => ({ code, info: COUNTRY_INFO[code] })),
    }))
}

/** `'CL'` (país seleccionado) → `'chile'` (paymentRegion); cualquier otro → `'international'`. */
export function paymentRegionForCountry(code: string | null | undefined): 'chile' | 'international' {
    return code === 'CL' ? 'chile' : 'international'
}
