// Constantes de moneda compartidas. Antes vivían privadas dentro de Finance.tsx,
// lo que obligaba a duplicarlas en cada pantalla que mostrara dinero (y llevó a
// que el símbolo de fidelización se guardara en su propia columna en vez de
// derivarse de clinic_settings.currency, que es la fuente de verdad).

// Monedas sin subunidad en circulación: mostrarles centavos es incorrecto.
export const CURRENCIES_WITHOUT_DECIMALS = new Set(['CLP', 'COP', 'PYG', 'JPY', 'KRW', 'ISK', 'VND'])

export const CURRENCY_LOCALES: Record<string, string> = {
    CLP: 'es-CL', ARS: 'es-AR', COP: 'es-CO', PEN: 'es-PE',
    MXN: 'es-MX', UYU: 'es-UY', PYG: 'es-PY', BOB: 'es-BO',
    USD: 'en-US', EUR: 'es-ES', BRL: 'pt-BR',
}

export const CURRENCY_SYMBOLS: Record<string, string> = {
    CLP: '$', ARS: '$', COP: '$', MXN: '$', UYU: '$', USD: '$',
    PEN: 'S/', PYG: '₲', BOB: 'Bs', EUR: '€', BRL: 'R$',
}

export function currencySymbol(currency?: string | null): string {
    return CURRENCY_SYMBOLS[currency || 'CLP'] ?? '$'
}

export function formatCurrency(amount: number, currency?: string | null): string {
    const code = currency || 'CLP'
    return new Intl.NumberFormat(CURRENCY_LOCALES[code] || 'es-CL', {
        style: 'currency',
        currency: code,
        maximumFractionDigits: CURRENCIES_WITHOUT_DECIMALS.has(code) ? 0 : 2,
    }).format(amount)
}
