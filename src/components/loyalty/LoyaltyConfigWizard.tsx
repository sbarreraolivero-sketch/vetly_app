import { useState } from 'react'
import { Sparkles, SlidersHorizontal, Loader2, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { currencySymbol } from '@/lib/currency'
import { loyaltyService, LoyaltySettings } from '@/services/loyaltyService'
import { toast } from 'react-hot-toast'

// Preset "Recomendado". Todo en porcentaje a propósito: un monto fijo obliga a
// cada clínica a traducirlo a su moneda antes de que el programa pague algo,
// y es justo lo que dejaba a las cuentas nuevas pagando pesos chilenos.
const RECOMMENDED = {
    loyalty_welcome_bonus: 15,
    loyalty_welcome_bonus_type: 'percentage',
    loyalty_referral_bonus: 10,
    loyalty_referral_bonus_type: 'percentage',
    loyalty_points_percentage: 5,
} as const

type BonusType = 'fixed' | 'percentage'

function matchesRecommended(s: LoyaltySettings): boolean {
    return Number(s.loyalty_welcome_bonus) === RECOMMENDED.loyalty_welcome_bonus
        && s.loyalty_welcome_bonus_type === RECOMMENDED.loyalty_welcome_bonus_type
        && Number(s.loyalty_referral_bonus) === RECOMMENDED.loyalty_referral_bonus
        && s.loyalty_referral_bonus_type === RECOMMENDED.loyalty_referral_bonus_type
        && Number(s.loyalty_points_percentage) === RECOMMENDED.loyalty_points_percentage
}

/** Segmentado [% de la compra] / [Monto fijo] + el número que corresponda. */
function BonusField({
    label, help, type, value, symbol, onTypeChange, onValueChange,
}: {
    label: string
    help: string
    type: BonusType
    value: number
    symbol: string
    onTypeChange: (t: BonusType) => void
    onValueChange: (v: number) => void
}) {
    return (
        <div>
            <label className="text-sm font-black text-charcoal block mb-1">{label}</label>
            <p className="text-xs text-charcoal/50 mb-3 leading-snug">{help}</p>
            <div className="flex gap-2 mb-2">
                {([
                    { id: 'percentage' as const, label: '% de la compra' },
                    { id: 'fixed' as const, label: 'Monto fijo' },
                ]).map(opt => (
                    <button
                        key={opt.id}
                        type="button"
                        onClick={() => onTypeChange(opt.id)}
                        className={cn(
                            'flex-1 h-10 rounded-soft text-sm font-bold border-2 transition-all',
                            type === opt.id
                                ? 'border-primary-500 bg-primary-50 text-primary-700'
                                : 'border-silk-beige bg-white text-charcoal/50 hover:border-primary-200'
                        )}
                    >
                        {opt.label}
                    </button>
                ))}
            </div>
            <div className="relative">
                <input
                    type="number"
                    min={0}
                    value={value || ''}
                    onChange={(e) => onValueChange(Number(e.target.value) || 0)}
                    className="w-full h-11 pl-4 pr-12 bg-ivory border border-silk-beige rounded-soft text-sm font-bold text-charcoal focus:outline-none focus:ring-2 focus:ring-primary-100"
                    placeholder="0"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-black text-charcoal/40">
                    {type === 'percentage' ? '%' : symbol}
                </span>
            </div>
        </div>
    )
}

export function LoyaltyConfigWizard({
    clinicId, currency, settings, onSaved,
}: {
    clinicId: string
    currency?: string | null
    settings: LoyaltySettings
    onSaved: (updated: Partial<LoyaltySettings>) => void
}) {
    const symbol = currencySymbol(currency)
    const isRecommended = matchesRecommended(settings)
    const [path, setPath] = useState<'recommended' | 'custom'>(isRecommended ? 'recommended' : 'custom')
    const [saving, setSaving] = useState(false)

    // Borrador local del camino personalizado — no toca la base hasta "Guardar".
    const [draft, setDraft] = useState({
        welcome: Number(settings.loyalty_welcome_bonus) || 0,
        welcomeType: (settings.loyalty_welcome_bonus_type || 'percentage') as BonusType,
        referral: Number(settings.loyalty_referral_bonus) || 0,
        referralType: (settings.loyalty_referral_bonus_type || 'percentage') as BonusType,
        accrual: Number(settings.loyalty_points_percentage) || 0,
        pointsName: settings.loyalty_points_name || 'Puntos',
    })

    const persist = async (values: Partial<LoyaltySettings>, successMsg: string) => {
        setSaving(true)
        try {
            await loyaltyService.updateSettings(clinicId, values)
            onSaved(values)
            toast.success(successMsg)
        } catch {
            toast.error('No se pudo guardar la configuración')
        } finally {
            setSaving(false)
        }
    }

    const applyRecommended = () => {
        setPath('recommended')
        setDraft({
            welcome: RECOMMENDED.loyalty_welcome_bonus,
            welcomeType: RECOMMENDED.loyalty_welcome_bonus_type,
            referral: RECOMMENDED.loyalty_referral_bonus,
            referralType: RECOMMENDED.loyalty_referral_bonus_type,
            accrual: RECOMMENDED.loyalty_points_percentage,
            pointsName: draft.pointsName,
        })
        persist({ ...RECOMMENDED }, 'Configuración recomendada aplicada')
    }

    const saveCustom = () => persist({
        loyalty_welcome_bonus: draft.welcome,
        loyalty_welcome_bonus_type: draft.welcomeType,
        loyalty_referral_bonus: draft.referral,
        loyalty_referral_bonus_type: draft.referralType,
        loyalty_points_percentage: draft.accrual,
        loyalty_points_name: draft.pointsName.trim() || 'Puntos',
    }, 'Configuración guardada')

    return (
        <section className="bg-white rounded-softer border border-silk-beige p-6 sm:p-8 shadow-soft-sm">
            <h3 className="text-xl font-black text-charcoal mb-1">¿Cuánto quieres premiar?</h3>
            <p className="text-sm text-charcoal/50 mb-6 leading-snug">
                Elige la configuración recomendada o define tus propios montos.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <button
                    type="button"
                    onClick={applyRecommended}
                    disabled={saving}
                    className={cn(
                        'text-left p-5 rounded-softer border-2 transition-all disabled:opacity-60',
                        path === 'recommended'
                            ? 'border-primary-500 bg-primary-50'
                            : 'border-silk-beige bg-white hover:border-primary-200'
                    )}
                >
                    <div className="flex items-center gap-2 mb-2">
                        <Sparkles className={cn('w-5 h-5', path === 'recommended' ? 'text-primary-600' : 'text-charcoal/30')} />
                        <span className="font-black text-charcoal">Recomendado</span>
                        {isRecommended && (
                            <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-primary-600 bg-white border border-primary-200 rounded-full px-2 py-0.5">
                                <Check className="w-3 h-3" /> Aplicado
                            </span>
                        )}
                    </div>
                    <ul className="text-sm text-charcoal/60 space-y-1 leading-snug">
                        <li>· <strong>15%</strong> al cliente nuevo que llega recomendado</li>
                        <li>· <strong>10%</strong> a quien lo recomendó</li>
                        <li>· <strong>5%</strong> en cada compra siguiente</li>
                    </ul>
                </button>

                <button
                    type="button"
                    onClick={() => setPath('custom')}
                    className={cn(
                        'text-left p-5 rounded-softer border-2 transition-all',
                        path === 'custom'
                            ? 'border-primary-500 bg-primary-50'
                            : 'border-silk-beige bg-white hover:border-primary-200'
                    )}
                >
                    <div className="flex items-center gap-2 mb-2">
                        <SlidersHorizontal className={cn('w-5 h-5', path === 'custom' ? 'text-primary-600' : 'text-charcoal/30')} />
                        <span className="font-black text-charcoal">Personalizado</span>
                    </div>
                    <p className="text-sm text-charcoal/60 leading-snug">
                        Define tú mismo cuánto premiar en cada caso. Son 3 preguntas.
                    </p>
                </button>
            </div>

            {path === 'custom' && (
                <div className="space-y-6 pt-6 border-t border-silk-beige animate-in fade-in slide-in-from-top-1">
                    <BonusField
                        label="1. Bono de bienvenida"
                        help="Lo que gana el cliente nuevo que llega recomendado, en su primera compra."
                        type={draft.welcomeType}
                        value={draft.welcome}
                        symbol={symbol}
                        onTypeChange={(t) => setDraft(d => ({ ...d, welcomeType: t }))}
                        onValueChange={(v) => setDraft(d => ({ ...d, welcome: v }))}
                    />

                    <BonusField
                        label="2. Bono al que refiere"
                        help="Lo que gana quien recomendó, cuando su recomendado hace su primera compra."
                        type={draft.referralType}
                        value={draft.referral}
                        symbol={symbol}
                        onTypeChange={(t) => setDraft(d => ({ ...d, referralType: t }))}
                        onValueChange={(v) => setDraft(d => ({ ...d, referral: v }))}
                    />

                    <div>
                        <label className="text-sm font-black text-charcoal block mb-1">3. Acumulación en compras futuras</label>
                        <p className="text-xs text-charcoal/50 mb-3 leading-snug">
                            Lo que acumula cualquier cliente en cada compra, desde la segunda en adelante.
                            Siempre en porcentaje: debe escalar con lo que gasta.
                        </p>
                        <div className="relative">
                            <input
                                type="number"
                                min={0}
                                value={draft.accrual || ''}
                                onChange={(e) => setDraft(d => ({ ...d, accrual: Number(e.target.value) || 0 }))}
                                className="w-full h-11 pl-4 pr-12 bg-ivory border border-silk-beige rounded-soft text-sm font-bold text-charcoal focus:outline-none focus:ring-2 focus:ring-primary-100"
                                placeholder="0"
                            />
                            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-black text-charcoal/40">%</span>
                        </div>
                    </div>

                    <details className="group">
                        <summary className="cursor-pointer text-sm font-bold text-charcoal/50 hover:text-charcoal/70 select-none">
                            Etiqueta del saldo (opcional)
                        </summary>
                        <div className="mt-3">
                            <p className="text-xs text-charcoal/50 mb-2 leading-snug">
                                Cómo se llama el saldo que ven tus clientes. Por defecto, "Puntos".
                            </p>
                            <input
                                type="text"
                                value={draft.pointsName}
                                onChange={(e) => setDraft(d => ({ ...d, pointsName: e.target.value }))}
                                className="w-full h-11 px-4 bg-ivory border border-silk-beige rounded-soft text-sm focus:outline-none focus:ring-2 focus:ring-primary-100"
                                placeholder="Puntos"
                            />
                        </div>
                    </details>

                    <div className="flex justify-end">
                        <button
                            type="button"
                            onClick={saveCustom}
                            disabled={saving}
                            className="px-8 py-3 bg-charcoal text-white rounded-full font-black text-sm hover:bg-charcoal/90 transition-all shadow-lg disabled:opacity-50 flex items-center gap-2"
                        >
                            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                            Guardar configuración
                        </button>
                    </div>
                </div>
            )}
        </section>
    )
}
