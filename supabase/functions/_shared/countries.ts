/**
 * Espejo backend de `src/lib/countries.ts` — solo lo que `signup-handler`
 * necesita para resolver moneda y zona horaria a partir del país elegido en
 * el registro. Si agregas un país, agrégalo en los dos lugares.
 */

export interface CountryTimezoneCurrency {
    timezone: string
    currency: string
}

export const COUNTRY_TZ_CURRENCY: Record<string, CountryTimezoneCurrency> = {
    AR: { timezone: 'America/Argentina/Buenos_Aires', currency: 'ARS' },
    BO: { timezone: 'America/La_Paz', currency: 'BOB' },
    CL: { timezone: 'America/Santiago', currency: 'CLP' },
    CO: { timezone: 'America/Bogota', currency: 'COP' },
    EC: { timezone: 'America/Guayaquil', currency: 'USD' },
    PY: { timezone: 'America/Asuncion', currency: 'PYG' },
    PE: { timezone: 'America/Lima', currency: 'PEN' },
    UY: { timezone: 'America/Montevideo', currency: 'UYU' },
    VE: { timezone: 'America/Caracas', currency: 'USD' },
    CR: { timezone: 'America/Costa_Rica', currency: 'CRC' },
    CU: { timezone: 'America/Havana', currency: 'USD' },
    DO: { timezone: 'America/Santo_Domingo', currency: 'DOP' },
    SV: { timezone: 'America/El_Salvador', currency: 'USD' },
    GT: { timezone: 'America/Guatemala', currency: 'GTQ' },
    HN: { timezone: 'America/Tegucigalpa', currency: 'HNL' },
    NI: { timezone: 'America/Managua', currency: 'NIO' },
    PA: { timezone: 'America/Panama', currency: 'USD' },
    PR: { timezone: 'America/Puerto_Rico', currency: 'USD' },
    MX: { timezone: 'America/Mexico_City', currency: 'MXN' },
    ES: { timezone: 'Europe/Madrid', currency: 'EUR' },
}

/** `null` si el código no se reconoce — el caller debe caer a los DEFAULT de columna. */
export function resolveCountry(code: string | null | undefined): CountryTimezoneCurrency | null {
    if (!code) return null
    return COUNTRY_TZ_CURRENCY[code.trim().toUpperCase()] ?? null
}
