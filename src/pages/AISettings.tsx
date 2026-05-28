import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import {
    SlidersHorizontal, Sparkles, Zap, RefreshCw, Cpu, Save, Loader2,
    CreditCard, Plus, Check, Info, AlertTriangle, Clock,
    ArrowDownCircle, ArrowUpCircle, Calendar, TrendingDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'react-hot-toast'
import { CREDIT_PACKS, redirectToCreditsCheckout } from '@/lib/mercadopago'
import { LS_CREDIT_PACKS, redirectToLemonCreditsCheckout } from '@/lib/lemonsqueezy'
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns'
import { es } from 'date-fns/locale'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Transaction {
    id: string
    created_at: string
    type: 'monthly_refill' | 'purchase' | 'consumption' | 'adjustment'
    amount: number
    description: string
    balance_after: number
    metadata?: { model?: string } | null
}

interface HistorySummary {
    consumed: number
    messages: number
    recharged: number
    total: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateMonthOptions(count = 6): Date[] {
    return Array.from({ length: count }, (_, i) => subMonths(startOfMonth(new Date()), i))
}

const txTypeConfig = {
    monthly_refill: { label: 'Recarga Mensual', icon: Zap, color: 'text-sky-500', bg: 'bg-sky-50' },
    purchase:       { label: 'Compra Extra',    icon: ArrowUpCircle, color: 'text-emerald-500', bg: 'bg-emerald-50' },
    consumption:    { label: 'Consumo IA',      icon: ArrowDownCircle, color: 'text-amber-500', bg: 'bg-amber-50' },
    adjustment:     { label: 'Ajuste',          icon: AlertTriangle, color: 'text-slate-500', bg: 'bg-slate-50' },
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function AISettings() {
    const { profile, user } = useAuth()

    // ── AI config
    const [aiAutoRespond, setAiAutoRespond] = useState(true)
    const [aiActiveModel, setAiActiveModel] = useState<'hybrid' | 'mini' | 'pro'>('hybrid')
    const [savingModel, setSavingModel] = useState(false)

    // ── Credits
    const [aiCreditsUnlimited, setAiCreditsUnlimited] = useState(false)
    const [aiCreditsMonthlyLimit, setAiCreditsMonthlyLimit] = useState(500)
    const [aiCreditsExtraBalance, setAiCreditsExtraBalance] = useState(0)
    const [aiCreditsExtra4o, setAiCreditsExtra4o] = useState(0)
    const [aiCreditsExtraExpiresAt, setAiCreditsExtraExpiresAt] = useState<string | null>(null)

    // ── Counters (direct from clinic_settings)
    const [miniUsed, setMiniUsed] = useState(0)
    const [fourOUsed, setFourOUsed] = useState(0)

    // ── Model breakdown (from messages)
    const [miniMessages, setMiniMessages] = useState(0)
    const [standardMessages, setStandardMessages] = useState(0)
    const [proMessages, setProMessages] = useState(0)

    // ── Payment
    const [paymentRegion, setPaymentRegion] = useState<'chile' | 'international'>('chile')

    // ── History
    const [monthOptions] = useState<Date[]>(generateMonthOptions)
    const [selectedMonth, setSelectedMonth] = useState<Date>(monthOptions[0])
    const [historyTxs, setHistoryTxs] = useState<Transaction[]>([])
    const [historySummary, setHistorySummary] = useState<HistorySummary>({ consumed: 0, messages: 0, recharged: 0, total: 0 })
    const [historyLoading, setHistoryLoading] = useState(false)

    const [isLoading, setIsLoading] = useState(true)

    // ─── Load credits & counters ──────────────────────────────────────────────

    useEffect(() => {
        if (!profile?.clinic_id) return
        const load = async () => {
            setIsLoading(true)
            try {
                const { data: cs } = await (supabase as any)
                    .from('clinic_settings')
                    .select('ai_active_model,ai_auto_respond,ai_credits_monthly_limit,ai_credits_extra_balance,ai_credits_extra_4o,ai_credits_extra_expires_at,ai_credits_unlimited,ai_credits_monthly_mini_used,ai_credits_monthly_4o_used,parent_clinic_id,payment_provider')
                    .eq('id', profile.clinic_id)
                    .single()

                if (cs) {
                    setAiActiveModel(cs.ai_active_model || 'hybrid')
                    setAiAutoRespond(cs.ai_auto_respond !== false)
                    setPaymentRegion(cs.payment_provider === 'lemonsqueezy' ? 'international' : 'chile')

                    let unlimited = cs.ai_credits_unlimited || false
                    let monthlyLimit = cs.ai_credits_monthly_limit || 500
                    let extraBalance = cs.ai_credits_extra_balance || 0
                    let extra4o = cs.ai_credits_extra_4o || 0
                    let expiresAt = cs.ai_credits_extra_expires_at || null
                    let miniUsedVal = cs.ai_credits_monthly_mini_used || 0
                    let fourOUsedVal = cs.ai_credits_monthly_4o_used || 0

                    if (cs.parent_clinic_id) {
                        const { data: parentData } = await (supabase as any)
                            .from('clinic_settings')
                            .select('ai_credits_monthly_limit,ai_credits_extra_balance,ai_credits_extra_4o,ai_credits_extra_expires_at,ai_credits_unlimited,ai_credits_monthly_mini_used,ai_credits_monthly_4o_used')
                            .eq('id', cs.parent_clinic_id)
                            .single()
                        if (parentData) {
                            unlimited = parentData.ai_credits_unlimited || false
                            monthlyLimit = parentData.ai_credits_monthly_limit || 500
                            extraBalance = parentData.ai_credits_extra_balance || 0
                            extra4o = parentData.ai_credits_extra_4o || 0
                            expiresAt = parentData.ai_credits_extra_expires_at || null
                            miniUsedVal = parentData.ai_credits_monthly_mini_used || 0
                            fourOUsedVal = parentData.ai_credits_monthly_4o_used || 0
                        }
                    }

                    setAiCreditsUnlimited(unlimited)
                    setAiCreditsMonthlyLimit(monthlyLimit)
                    setAiCreditsExtraBalance(extraBalance)
                    setAiCreditsExtra4o(extra4o)
                    setAiCreditsExtraExpiresAt(expiresAt)
                    setMiniUsed(miniUsedVal)
                    setFourOUsed(fourOUsedVal)
                }

                // Model breakdown from messages (current month)
                const startOfMonthStr = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
                let poolIds = [profile.clinic_id]
                try {
                    const { data: poolData } = await (supabase as any).rpc('get_credit_pool_clinic_ids', { p_clinic_id: profile.clinic_id })
                    if (poolData && poolData.length > 0) poolIds = poolData
                } catch {}

                const [{ count: cMini }, { count: cStd }, { count: cPro }] = await Promise.all([
                    (supabase as any).from('messages').select('*', { count: 'exact', head: true }).in('clinic_id', poolIds).eq('ai_generated', true).or('ai_model.eq.mini,ai_model.is.null').gte('created_at', startOfMonthStr),
                    (supabase as any).from('messages').select('*', { count: 'exact', head: true }).in('clinic_id', poolIds).eq('ai_generated', true).or('ai_model.eq.4o_standard,ai_model.eq.4o').gte('created_at', startOfMonthStr),
                    (supabase as any).from('messages').select('*', { count: 'exact', head: true }).in('clinic_id', poolIds).eq('ai_generated', true).eq('ai_model', '4o_pro').gte('created_at', startOfMonthStr),
                ])
                setMiniMessages(cMini || 0)
                setStandardMessages(cStd || 0)
                setProMessages(cPro || 0)
            } catch (err) {
                console.error('Error loading AI settings:', err)
            } finally {
                setIsLoading(false)
            }
        }
        load()
    }, [profile?.clinic_id])

    // ─── Load history ─────────────────────────────────────────────────────────

    const fetchHistory = useCallback(async (month: Date) => {
        if (!profile?.clinic_id) return
        setHistoryLoading(true)
        try {
            const monthStart = startOfMonth(month).toISOString()
            const monthEnd = endOfMonth(month).toISOString()

            let poolIds = [profile.clinic_id]
            try {
                const { data: poolData } = await (supabase as any).rpc('get_credit_pool_clinic_ids', { p_clinic_id: profile.clinic_id })
                if (poolData && poolData.length > 0) poolIds = poolData
            } catch {}

            // Query 1: all txs for summary (no limit)
            const { data: allTxs } = await (supabase as any)
                .from('ai_credit_transactions')
                .select('type, amount')
                .in('clinic_id', poolIds)
                .gte('created_at', monthStart)
                .lte('created_at', monthEnd)

            const summary: HistorySummary = { consumed: 0, messages: 0, recharged: 0, total: (allTxs || []).length }
            for (const tx of (allTxs || [])) {
                if (tx.type === 'consumption') { summary.consumed += Math.abs(tx.amount); summary.messages++ }
                else if (['monthly_refill', 'purchase'].includes(tx.type)) summary.recharged += tx.amount
            }
            setHistorySummary(summary)

            // Query 2: display rows (200 limit)
            const { data: tableTxs } = await (supabase as any)
                .from('ai_credit_transactions')
                .select('*')
                .in('clinic_id', poolIds)
                .gte('created_at', monthStart)
                .lte('created_at', monthEnd)
                .order('created_at', { ascending: false })
                .limit(200)

            setHistoryTxs(tableTxs || [])
        } catch (err) {
            console.error('Error loading history:', err)
        } finally {
            setHistoryLoading(false)
        }
    }, [profile?.clinic_id])

    useEffect(() => { fetchHistory(selectedMonth) }, [selectedMonth, fetchHistory])

    // ─── Handlers ────────────────────────────────────────────────────────────

    const handleSaveAI = async () => {
        if (!profile?.clinic_id) { toast.error('No se encontró el ID de la clínica'); return }
        setSavingModel(true)
        try {
            const { data, error } = await (supabase as any)
                .from('clinic_settings')
                .upsert({ id: profile.clinic_id, ai_active_model: aiActiveModel, ai_auto_respond: aiAutoRespond, updated_at: new Date().toISOString() }, { onConflict: 'id' })
                .select()
            if (error) { toast.error(`Error (${error.code}): ${error.message}`); return }
            if (!data || data.length === 0) { toast.error('No se pudo actualizar. Verifica tus permisos.'); return }
            toast.success('Configuración de IA guardada exitosamente')
        } catch (err: any) {
            toast.error('Error inesperado: ' + err.message)
        } finally {
            setSavingModel(false)
        }
    }

    const handleBuyCredits = async (packId: string) => {
        if (!profile?.clinic_id || !user?.email) return
        try {
            if (paymentRegion === 'international') {
                await redirectToLemonCreditsCheckout(profile.clinic_id, user.email, packId, 'mini')
            } else {
                await redirectToCreditsCheckout(profile.clinic_id, user.email, packId, 'mini')
            }
        } catch (error: any) {
            alert(error.message || 'Error al procesar el pago.')
        }
    }

    // ─── Computed values ──────────────────────────────────────────────────────

    const totalUsed = miniUsed + (fourOUsed * 8)
    const extraExpired = aiCreditsExtraExpiresAt ? new Date(aiCreditsExtraExpiresAt) < new Date() : false
    const extraAvailable = extraExpired ? 0 : (aiCreditsExtraBalance + aiCreditsExtra4o)
    const totalAvailable = aiCreditsMonthlyLimit + extraAvailable
    const usagePct = Math.min(100, (totalUsed / (totalAvailable || 1)) * 100)

    const currentPacks = paymentRegion === 'international' ? LS_CREDIT_PACKS : CREDIT_PACKS
    const currencySymbol = paymentRegion === 'international' ? 'US$' : '$'

    // ─── Render ───────────────────────────────────────────────────────────────

    return (
        <div className="space-y-6 max-w-5xl mx-auto pb-20 animate-fade-in">

            {/* ── Banner ─────────────────────────────────────────────────── */}
            <div className="bg-gradient-to-br from-sky-500 to-sky-700 rounded-2xl overflow-hidden shadow-soft-md">
                <div className="p-6 sm:p-8 flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                        <p className="text-xs font-black uppercase tracking-widest text-sky-200 mb-2">Agente IA</p>
                        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">Ajustes de IA</h1>
                        <p className="text-sm text-sky-100/80 font-light mt-1">Motor de ruteo inteligente, créditos y estrategia del agente.</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleSaveAI}
                            disabled={savingModel || isLoading}
                            className="flex items-center gap-2 bg-white text-sky-700 font-bold text-sm px-4 py-2.5 rounded-xl hover:bg-sky-50 transition-colors shadow-sm disabled:opacity-50"
                        >
                            {savingModel ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            Guardar
                        </button>
                        <div className="w-12 h-12 bg-white/15 rounded-2xl flex items-center justify-center shrink-0">
                            <SlidersHorizontal className="w-6 h-6 text-white" />
                        </div>
                    </div>
                </div>
            </div>

            {isLoading ? (
                <div className="py-20 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-sky-500" /></div>
            ) : (
                <>
                    {/* ── Agente IA activo ────────────────────────────────── */}
                    <div className="bg-white rounded-2xl border border-silk-beige shadow-sm p-5 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                            <div>
                                <p className="text-sm font-black text-charcoal">Agente IA activo</p>
                                <p className="text-xs text-charcoal/50 mt-0.5">Responde automáticamente a los mensajes de WhatsApp</p>
                            </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" className="sr-only peer" checked={aiAutoRespond} onChange={(e) => setAiAutoRespond(e.target.checked)} />
                            <div className="w-14 h-7 bg-charcoal/10 rounded-full peer peer-checked:after:translate-x-7 peer-checked:bg-sky-500 after:content-[''] after:absolute after:top-0.5 after:left-[4px] after:bg-white after:rounded-full after:h-6 after:w-6 after:transition-all after:shadow" />
                        </label>
                    </div>

                    {/* ── Motor de IA ──────────────────────────────────────── */}
                    <div className="bg-white rounded-2xl border border-silk-beige shadow-sm overflow-hidden">
                        <div className="px-5 pt-5 pb-4 border-b border-silk-beige">
                            <div className="flex items-center gap-3">
                                <Sparkles className="w-5 h-5 text-sky-500" />
                                <div>
                                    <h2 className="text-sm font-black text-charcoal">Motor de IA</h2>
                                    <p className="text-xs text-charcoal/40 mt-0.5">Selecciona cómo el agente usa los modelos de lenguaje</p>
                                </div>
                            </div>
                        </div>
                        <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
                            {/* Mini */}
                            <button
                                onClick={() => setAiActiveModel('mini')}
                                className={cn(
                                    "flex flex-col p-5 rounded-2xl border-2 transition-all duration-200 text-left",
                                    aiActiveModel === 'mini'
                                        ? "bg-emerald-50 border-emerald-400 shadow-sm"
                                        : "bg-ivory border-silk-beige hover:border-charcoal/20"
                                )}
                            >
                                <div className={cn("w-10 h-10 rounded-xl mb-4 flex items-center justify-center", aiActiveModel === 'mini' ? "bg-emerald-500" : "bg-silk-beige")}>
                                    <Zap className={cn("w-5 h-5", aiActiveModel === 'mini' ? "text-white" : "text-charcoal/40")} />
                                </div>
                                <h3 className="text-sm font-black text-charcoal mb-0.5">Ahorro Máximo</h3>
                                <p className={cn("text-[10px] font-black uppercase tracking-widest mb-3", aiActiveModel === 'mini' ? "text-emerald-500" : "text-charcoal/30")}>
                                    GPT-4O MINI
                                </p>
                                <p className="text-xs text-charcoal/50 leading-relaxed flex-1">Ideal para agendamientos simples. Más créditos por el mismo precio.</p>
                                {aiActiveModel === 'mini' && (
                                    <p className="text-[10px] font-black text-emerald-600 mt-3">✓ ACTIVO</p>
                                )}
                            </button>

                            {/* Hybrid */}
                            <button
                                onClick={() => setAiActiveModel('hybrid')}
                                className={cn(
                                    "flex flex-col p-5 rounded-2xl border-2 transition-all duration-200 text-left relative",
                                    aiActiveModel === 'hybrid'
                                        ? "bg-sky-50 border-sky-400 shadow-sm"
                                        : "bg-ivory border-silk-beige hover:border-charcoal/20"
                                )}
                            >
                                <div className={cn("w-10 h-10 rounded-xl mb-4 flex items-center justify-center", aiActiveModel === 'hybrid' ? "bg-sky-500" : "bg-silk-beige")}>
                                    <RefreshCw className={cn("w-5 h-5", aiActiveModel === 'hybrid' ? "text-white" : "text-charcoal/40")} />
                                </div>
                                <h3 className="text-sm font-black text-charcoal mb-0.5">Híbrido Automático</h3>
                                <p className={cn("text-[10px] font-black uppercase tracking-widest mb-3", aiActiveModel === 'hybrid' ? "text-sky-500" : "text-charcoal/30")}>
                                    IA ROUTER
                                </p>
                                <p className="text-xs text-charcoal/50 leading-relaxed flex-1">Elige el modelo ideal según la complejidad del mensaje.</p>
                                {aiActiveModel === 'hybrid' && (
                                    <p className="text-[10px] font-black text-sky-600 mt-3">✓ ACTIVO</p>
                                )}
                            </button>

                            {/* Pro */}
                            <button
                                onClick={() => setAiActiveModel('pro')}
                                className={cn(
                                    "flex flex-col p-5 rounded-2xl border-2 transition-all duration-200 text-left",
                                    aiActiveModel === 'pro'
                                        ? "bg-violet-50 border-violet-400 shadow-sm"
                                        : "bg-ivory border-silk-beige hover:border-charcoal/20"
                                )}
                            >
                                <div className={cn("w-10 h-10 rounded-xl mb-4 flex items-center justify-center", aiActiveModel === 'pro' ? "bg-violet-600" : "bg-silk-beige")}>
                                    <Cpu className={cn("w-5 h-5", aiActiveModel === 'pro' ? "text-white" : "text-charcoal/40")} />
                                </div>
                                <h3 className="text-sm font-black text-charcoal mb-0.5">Máximo Poder</h3>
                                <p className={cn("text-[10px] font-black uppercase tracking-widest mb-3", aiActiveModel === 'pro' ? "text-violet-500" : "text-charcoal/30")}>
                                    GPT-4O EXCLUSIVO
                                </p>
                                <p className="text-xs text-charcoal/50 leading-relaxed flex-1">GPT-4o completo para casos complejos y alta precisión.</p>
                                {aiActiveModel === 'pro' && (
                                    <p className="text-[10px] font-black text-violet-600 mt-3">✓ ACTIVO</p>
                                )}
                            </button>
                        </div>
                    </div>

                    {/* ── Créditos de IA ───────────────────────────────────── */}
                    <div className="bg-white rounded-2xl border border-silk-beige shadow-sm overflow-hidden">
                        <div className="px-5 pt-5 pb-4 border-b border-silk-beige flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <CreditCard className="w-5 h-5 text-sky-500" />
                                <div>
                                    <h2 className="text-sm font-black text-charcoal">Créditos de IA</h2>
                                    <p className="text-xs text-charcoal/40 mt-0.5">Uso del ciclo actual</p>
                                </div>
                            </div>
                            {aiCreditsUnlimited && (
                                <span className="inline-flex items-center gap-1.5 bg-sky-50 text-sky-600 text-[10px] font-black px-3 py-1.5 rounded-full border border-sky-200 uppercase tracking-widest">
                                    ∞ ILIMITADO
                                </span>
                            )}
                        </div>

                        <div className="p-5 space-y-4">
                            {aiCreditsUnlimited ? (
                                <div className="bg-sky-50 border border-sky-200 rounded-2xl p-4 flex items-center gap-3">
                                    <div className="w-8 h-8 bg-sky-500 rounded-xl flex items-center justify-center shrink-0">
                                        <Sparkles className="w-4 h-4 text-white" />
                                    </div>
                                    <p className="text-sm font-bold text-sky-700">
                                        Tu agente IA tiene créditos ilimitados. Nunca se silenciará por falta de créditos.
                                    </p>
                                </div>
                            ) : (
                                <>
                                    {/* Expiry warning */}
                                    {extraAvailable > 0 && aiCreditsExtraExpiresAt && !extraExpired && (
                                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-2">
                                            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                                            <p className="text-xs font-bold text-amber-700">
                                                {extraAvailable.toLocaleString()} créditos extra vencen el{' '}
                                                {new Date(aiCreditsExtraExpiresAt).toLocaleDateString('es-CL', { day: 'numeric', month: 'long' })}
                                            </p>
                                        </div>
                                    )}
                                </>
                            )}

                            <div className="grid grid-cols-2 gap-4">
                                <div className="bg-ivory rounded-2xl p-4 border border-silk-beige">
                                    <p className="text-[10px] font-black text-charcoal/40 uppercase tracking-widest mb-1">Usados este ciclo</p>
                                    <p className="text-3xl font-black text-charcoal tabular-nums">{totalUsed.toLocaleString()}</p>
                                </div>
                                <div className={cn("rounded-2xl p-4 border", aiCreditsUnlimited ? "bg-sky-50 border-sky-200" : "bg-ivory border-silk-beige")}>
                                    <p className={cn("text-[10px] font-black uppercase tracking-widest mb-1", aiCreditsUnlimited ? "text-sky-500" : "text-charcoal/40")}>Disponibles</p>
                                    {aiCreditsUnlimited ? (
                                        <p className="text-3xl font-black text-sky-500">∞</p>
                                    ) : (
                                        <p className="text-3xl font-black text-charcoal tabular-nums">{(totalAvailable - totalUsed).toLocaleString()}</p>
                                    )}
                                </div>
                            </div>

                            {!aiCreditsUnlimited && (
                                <div>
                                    <div className="flex items-center justify-between mb-1.5">
                                        <p className="text-[10px] font-black text-charcoal/40 uppercase tracking-widest">Uso del ciclo</p>
                                        <p className="text-[10px] font-black text-charcoal">{usagePct.toFixed(1)}%</p>
                                    </div>
                                    <div className="w-full h-2 bg-silk-beige rounded-full overflow-hidden">
                                        <div
                                            className={cn("h-full rounded-full transition-all duration-1000", usagePct >= 90 ? "bg-red-500" : usagePct >= 70 ? "bg-amber-500" : "bg-sky-500")}
                                            style={{ width: `${usagePct}%` }}
                                        />
                                    </div>
                                    <div className="flex items-center justify-between mt-1.5">
                                        <p className="text-[10px] text-charcoal/30">Plan base: {aiCreditsMonthlyLimit.toLocaleString()}</p>
                                        {extraAvailable > 0 && <p className="text-[10px] text-emerald-500">+{extraAvailable.toLocaleString()} extra</p>}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ── Consumo por Modelo ───────────────────────────────── */}
                    <div className="bg-white rounded-2xl border border-silk-beige shadow-sm overflow-hidden">
                        <div className="px-5 pt-5 pb-4 border-b border-silk-beige">
                            <div className="flex items-center gap-3">
                                <TrendingDown className="w-5 h-5 text-sky-500" />
                                <div>
                                    <h2 className="text-sm font-black text-charcoal">Consumo por Modelo</h2>
                                    <p className="text-xs text-charcoal/40 mt-0.5">Mensajes enviados y créditos gastados por tipo de IA este ciclo</p>
                                </div>
                            </div>
                        </div>
                        <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
                            {/* Mini */}
                            <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-5">
                                <div className="flex items-center gap-2 mb-3">
                                    <div className="w-7 h-7 bg-emerald-500 rounded-lg flex items-center justify-center">
                                        <Zap className="w-3.5 h-3.5 text-white" />
                                    </div>
                                    <div>
                                        <p className="text-xs font-black text-charcoal">GPT-4o Mini</p>
                                        <p className="text-[10px] font-bold text-emerald-600">×1 crédito / msg</p>
                                    </div>
                                </div>
                                <p className="text-3xl font-black text-charcoal tabular-nums">{miniMessages.toLocaleString()}</p>
                                <p className="text-[10px] text-charcoal/40 font-bold uppercase mt-0.5">mensajes</p>
                                <div className="mt-3 pt-3 border-t border-emerald-200 flex items-center justify-between">
                                    <p className="text-[10px] text-charcoal/40 font-bold uppercase">Créditos</p>
                                    <p className="text-sm font-black text-emerald-600 tabular-nums">{(miniUsed).toLocaleString()}</p>
                                </div>
                            </div>

                            {/* Standard */}
                            <div className="bg-sky-50 border border-sky-100 rounded-2xl p-5">
                                <div className="flex items-center gap-2 mb-3">
                                    <div className="w-7 h-7 bg-sky-500 rounded-lg flex items-center justify-center">
                                        <RefreshCw className="w-3.5 h-3.5 text-white" />
                                    </div>
                                    <div>
                                        <p className="text-xs font-black text-charcoal">GPT-4o Standard</p>
                                        <p className="text-[10px] font-bold text-sky-600">×8 créditos / msg</p>
                                    </div>
                                </div>
                                <p className="text-3xl font-black text-charcoal tabular-nums">{standardMessages.toLocaleString()}</p>
                                <p className="text-[10px] text-charcoal/40 font-bold uppercase mt-0.5">mensajes</p>
                                <div className="mt-3 pt-3 border-t border-sky-200 flex items-center justify-between">
                                    <p className="text-[10px] text-charcoal/40 font-bold uppercase">Créditos</p>
                                    <p className="text-sm font-black text-sky-600 tabular-nums">{(standardMessages * 8).toLocaleString()}</p>
                                </div>
                            </div>

                            {/* Pro */}
                            <div className="bg-violet-50 border border-violet-100 rounded-2xl p-5">
                                <div className="flex items-center gap-2 mb-3">
                                    <div className="w-7 h-7 bg-violet-600 rounded-lg flex items-center justify-center">
                                        <Cpu className="w-3.5 h-3.5 text-white" />
                                    </div>
                                    <div>
                                        <p className="text-xs font-black text-charcoal">GPT-4o Pro</p>
                                        <p className="text-[10px] font-bold text-violet-600">×60 créditos / msg</p>
                                    </div>
                                </div>
                                <p className="text-3xl font-black text-charcoal tabular-nums">{proMessages.toLocaleString()}</p>
                                <p className="text-[10px] text-charcoal/40 font-bold uppercase mt-0.5">mensajes</p>
                                <div className="mt-3 pt-3 border-t border-violet-200 flex items-center justify-between">
                                    <p className="text-[10px] text-charcoal/40 font-bold uppercase">Créditos</p>
                                    <p className="text-sm font-black text-violet-600 tabular-nums">{(proMessages * 60).toLocaleString()}</p>
                                </div>
                            </div>
                        </div>
                        <div className="px-5 pb-5">
                            <div className="flex items-center gap-2 bg-ivory rounded-xl p-3 border border-silk-beige">
                                <Info className="w-3.5 h-3.5 text-charcoal/30 shrink-0" />
                                <p className="text-[10px] text-charcoal/40 font-bold leading-relaxed">
                                    El agente elige el modelo según la complejidad del mensaje. Mini para respuestas simples. Standard para conversaciones con contexto. Pro para casos que requieren máxima precisión.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* ── Comprar Créditos Extra ───────────────────────────── */}
                    <div className="bg-white rounded-2xl border border-silk-beige shadow-sm overflow-hidden">
                        <div className="px-5 pt-5 pb-4 border-b border-silk-beige flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                                <Plus className="w-5 h-5 text-sky-500" />
                                <div>
                                    <h2 className="text-sm font-black text-charcoal">Comprar Créditos Extra</h2>
                                    <p className="text-[10px] font-bold text-amber-500 mt-0.5">Válidos 30 días desde la fecha de compra · Expiran automáticamente</p>
                                </div>
                            </div>
                            {/* Region toggle */}
                            <div className="flex items-center gap-1 bg-silk-beige p-1 rounded-xl border border-silk-beige shadow-sm shrink-0">
                                <button
                                    onClick={() => setPaymentRegion('chile')}
                                    className={cn("px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1", paymentRegion === 'chile' ? "bg-white text-charcoal shadow-sm" : "text-charcoal/40 hover:text-charcoal")}
                                >
                                    🇨🇱 CLP
                                </button>
                                <button
                                    onClick={() => setPaymentRegion('international')}
                                    className={cn("px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1", paymentRegion === 'international' ? "bg-white text-charcoal shadow-sm" : "text-charcoal/40 hover:text-charcoal")}
                                >
                                    🌎 USD
                                </button>
                            </div>
                        </div>
                        <div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
                            {Object.values(currentPacks).map((pack) => (
                                <div key={pack.id} className="border border-silk-beige rounded-2xl overflow-hidden flex flex-col">
                                    <div className="px-5 pt-5 pb-4 flex items-center justify-between">
                                        <h3 className="text-sm font-black text-charcoal">{pack.name}</h3>
                                        <span className="text-[10px] font-black text-sky-600 bg-sky-50 border border-sky-200 px-2 py-1 rounded-full">
                                            {pack.credits.toLocaleString()} msgs
                                        </span>
                                    </div>
                                    <div className="px-5 pb-4">
                                        <p className="text-2xl font-black text-charcoal">{currencySymbol}{pack.price.toLocaleString()}</p>
                                        <div className="mt-3 space-y-2">
                                            <div className="flex items-center gap-2">
                                                <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                                                <span className="text-xs text-charcoal/60">{pack.credits.toLocaleString()} mensajes de IA</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                                                <span className="text-xs text-charcoal/60">Activación instantánea</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Check className="w-4 h-4 text-amber-400 shrink-0" />
                                                <span className="text-xs text-amber-600 font-bold">Válidos 30 días</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="px-5 pb-5 mt-auto">
                                        <button
                                            onClick={() => handleBuyCredits(pack.id)}
                                            className="w-full py-3 bg-sky-500 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-sky-600 transition-colors"
                                        >
                                            Comprar Pack
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* ── Historial de Transacciones ───────────────────────── */}
                    <div className="bg-white rounded-2xl border border-silk-beige shadow-sm overflow-hidden">
                        <div className="px-5 pt-5 pb-4 border-b border-silk-beige flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 bg-sky-50 rounded-xl flex items-center justify-center border border-sky-100">
                                    <Clock className="w-4 h-4 text-sky-500" />
                                </div>
                                <div>
                                    <h2 className="text-xs font-black text-charcoal uppercase tracking-widest">Historial de Transacciones</h2>
                                    <p className="text-[10px] font-bold text-charcoal/30 uppercase tracking-widest mt-0.5">Transparencia total en el consumo de tu IA</p>
                                </div>
                            </div>
                            {/* Month selector */}
                            <select
                                value={selectedMonth.toISOString()}
                                onChange={(e) => setSelectedMonth(new Date(e.target.value))}
                                className="text-xs font-black text-charcoal bg-silk-beige border border-silk-beige rounded-xl px-3 py-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-sky-500/30 uppercase tracking-widest"
                            >
                                {monthOptions.map((m) => (
                                    <option key={m.toISOString()} value={m.toISOString()}>
                                        {format(m, 'MMMM yyyy', { locale: es }).toUpperCase()}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Summary cards */}
                        <div className="p-5 grid grid-cols-3 gap-4">
                            <div className="bg-red-50 border border-red-100 rounded-2xl p-4 text-center">
                                <p className="text-2xl font-black text-charcoal tabular-nums">{historySummary.consumed.toLocaleString()}</p>
                                <p className="text-[10px] font-black text-red-500 uppercase tracking-widest mt-1">Créditos Usados</p>
                            </div>
                            <div className="bg-silk-beige/30 border border-silk-beige rounded-2xl p-4 text-center">
                                <p className="text-2xl font-black text-charcoal tabular-nums">{historySummary.messages.toLocaleString()}</p>
                                <p className="text-[10px] font-black text-charcoal/40 uppercase tracking-widest mt-1">Mensajes IA</p>
                            </div>
                            <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 text-center">
                                <p className="text-2xl font-black text-emerald-600 tabular-nums">{historySummary.recharged.toLocaleString()}</p>
                                <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest mt-1">Recargado</p>
                            </div>
                        </div>

                        {/* Table */}
                        {historyLoading ? (
                            <div className="py-12 flex justify-center">
                                <Loader2 className="w-6 h-6 animate-spin text-sky-500" />
                            </div>
                        ) : historyTxs.length === 0 ? (
                            <div className="py-12 flex flex-col items-center gap-3 text-center">
                                <div className="w-12 h-12 bg-silk-beige/30 rounded-2xl flex items-center justify-center">
                                    <Clock className="w-6 h-6 text-charcoal/20" />
                                </div>
                                <p className="text-sm font-black text-charcoal/40">Sin transacciones en {format(selectedMonth, 'MMMM yyyy', { locale: es })}</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="border-t border-b border-silk-beige bg-silk-beige/20">
                                            <th className="px-5 py-3.5 text-[10px] font-black text-charcoal/40 uppercase tracking-widest">Fecha</th>
                                            <th className="px-5 py-3.5 text-[10px] font-black text-charcoal/40 uppercase tracking-widest">Concepto</th>
                                            <th className="px-5 py-3.5 text-[10px] font-black text-charcoal/40 uppercase tracking-widest text-right">Cantidad</th>
                                            <th className="px-5 py-3.5 text-[10px] font-black text-charcoal/40 uppercase tracking-widest text-right">Saldo</th>
                                            <th className="px-5 py-3.5 text-[10px] font-black text-charcoal/40 uppercase tracking-widest text-center">Estado</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-silk-beige/40">
                                        {historyTxs.map((tx) => {
                                            const cfg = txTypeConfig[tx.type] || txTypeConfig.adjustment
                                            const Icon = cfg.icon
                                            return (
                                                <tr key={tx.id} className="hover:bg-ivory/40 transition-colors">
                                                    <td className="px-5 py-3.5 whitespace-nowrap">
                                                        <p className="text-sm font-black text-charcoal">{format(new Date(tx.created_at), 'dd MMM, yyyy', { locale: es })}</p>
                                                        <p className="text-[10px] font-bold text-charcoal/30">{format(new Date(tx.created_at), 'HH:mm')}</p>
                                                    </td>
                                                    <td className="px-5 py-3.5">
                                                        <div className="flex items-center gap-2">
                                                            <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center shrink-0", cfg.bg)}>
                                                                <Icon className={cn("w-3.5 h-3.5", cfg.color)} />
                                                            </div>
                                                            <div>
                                                                <p className="text-sm font-medium text-charcoal leading-tight">{tx.description}</p>
                                                                <p className={cn("text-[10px] font-black uppercase tracking-widest", cfg.color)}>{cfg.label}</p>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-5 py-3.5 text-right whitespace-nowrap">
                                                        <span className={cn(
                                                            "inline-block px-2.5 py-1 rounded-full text-sm font-black tabular-nums",
                                                            tx.amount > 0 ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-500"
                                                        )}>
                                                            {tx.amount > 0 ? '+' : ''}{tx.amount.toLocaleString()}
                                                        </span>
                                                    </td>
                                                    <td className="px-5 py-3.5 text-right whitespace-nowrap">
                                                        <p className="text-sm font-black text-charcoal tabular-nums">{tx.balance_after?.toLocaleString() ?? '—'}</p>
                                                    </td>
                                                    <td className="px-5 py-3.5 text-center whitespace-nowrap">
                                                        <span className="inline-flex items-center gap-1 text-[10px] font-black text-emerald-600 uppercase tracking-widest">
                                                            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                                                            Confirmado
                                                        </span>
                                                    </td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                                {/* Footer */}
                                <div className="px-5 py-4 border-t border-silk-beige bg-ivory/10 flex items-center justify-between">
                                    <p className="text-[10px] font-bold text-charcoal/30 italic">
                                        Mostrando {historyTxs.length} de {historySummary.total} transacciones de {format(selectedMonth, 'MMMM yyyy', { locale: es })}
                                    </p>
                                    <div className="flex items-center gap-1.5 text-[10px] font-black text-charcoal/30 uppercase">
                                        <Calendar className="w-3 h-3" />
                                        {format(selectedMonth, 'MMMM yyyy', { locale: es }).toUpperCase()}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    )
}
