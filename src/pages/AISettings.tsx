import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { useNavigate } from 'react-router-dom'
import {
    SlidersHorizontal, Sparkles, Zap, RefreshCw, Cpu, Save, Loader2,
    CreditCard, Plus, Check, ChevronRight, History, Info
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'react-hot-toast'
import { CREDIT_PACKS, redirectToCreditsCheckout } from '@/lib/mercadopago'
import { LS_CREDIT_PACKS, redirectToLemonCreditsCheckout } from '@/lib/lemonsqueezy'

export default function AISettings() {
    const { profile, user } = useAuth()
    const navigate = useNavigate()

    const [aiAutoRespond, setAiAutoRespond] = useState(true)
    const [aiActiveModel, setAiActiveModel] = useState<'hybrid' | 'mini' | 'pro'>('hybrid')
    const [savingModel, setSavingModel] = useState(false)

    const [aiCreditsMonthlyLimit, setAiCreditsMonthlyLimit] = useState(500)
    const [aiCreditsExtraBalance, setAiCreditsExtraBalance] = useState(0)
    const [aiCreditsExtra4o, setAiCreditsExtra4o] = useState(0)
    const [aiMessagesUsed, setAiMessagesUsed] = useState(0)
    const [aiMessagesUsedStandard, setAiMessagesUsedStandard] = useState(0)
    const [aiMessagesUsedPro, setAiMessagesUsedPro] = useState(0)
    const [aiMessagesUsedLegacy4o, setAiMessagesUsedLegacy4o] = useState(0)

    const [paymentRegion, setPaymentRegion] = useState<'chile' | 'international'>('chile')
    const [selectedAiModel, setSelectedAiModel] = useState<'mini' | '4o'>('mini')
    const [isLoading, setIsLoading] = useState(true)

    useEffect(() => {
        if (!profile?.clinic_id) return
        const load = async () => {
            setIsLoading(true)
            try {
                const { data: cs } = await (supabase as any)
                    .from('clinic_settings')
                    .select('ai_active_model,ai_auto_respond,ai_credits_monthly_limit,ai_credits_extra_balance,ai_credits_extra_4o,parent_clinic_id,payment_provider')
                    .eq('id', profile.clinic_id)
                    .single()

                if (cs) {
                    setAiActiveModel(cs.ai_active_model || 'hybrid')
                    setAiAutoRespond(cs.ai_auto_respond !== false)
                    setPaymentRegion(cs.payment_provider === 'lemonsqueezy' ? 'international' : 'chile')

                    let monthlyLimit = cs.ai_credits_monthly_limit || 500
                    let extraBalance = cs.ai_credits_extra_balance || 0
                    let extra4o = cs.ai_credits_extra_4o || 0

                    if (cs.parent_clinic_id) {
                        const { data: parentData } = await (supabase as any)
                            .from('clinic_settings')
                            .select('ai_credits_monthly_limit,ai_credits_extra_balance,ai_credits_extra_4o')
                            .eq('id', cs.parent_clinic_id)
                            .single()
                        if (parentData) {
                            monthlyLimit = parentData.ai_credits_monthly_limit || 500
                            extraBalance = parentData.ai_credits_extra_balance || 0
                            extra4o = parentData.ai_credits_extra_4o || 0
                        }
                    }
                    setAiCreditsMonthlyLimit(monthlyLimit)
                    setAiCreditsExtraBalance(extraBalance)
                    setAiCreditsExtra4o(extra4o)
                }

                const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
                let poolClinicIds = [profile.clinic_id]
                try {
                    const { data: poolData } = await (supabase as any).rpc('get_credit_pool_clinic_ids', { p_clinic_id: profile.clinic_id })
                    if (poolData && poolData.length > 0) poolClinicIds = poolData.map((r: any) => r)
                } catch {}

                const [
                    { count: cStd }, { count: cPro }, { count: cLeg }, { count: cMini }
                ] = await Promise.all([
                    (supabase as any).from('messages').select('*', { count: 'exact', head: true }).in('clinic_id', poolClinicIds).eq('ai_generated', true).eq('ai_model', '4o_standard').gte('created_at', startOfMonth),
                    (supabase as any).from('messages').select('*', { count: 'exact', head: true }).in('clinic_id', poolClinicIds).eq('ai_generated', true).eq('ai_model', '4o_pro').gte('created_at', startOfMonth),
                    (supabase as any).from('messages').select('*', { count: 'exact', head: true }).in('clinic_id', poolClinicIds).eq('ai_generated', true).eq('ai_model', '4o').gte('created_at', startOfMonth),
                    (supabase as any).from('messages').select('*', { count: 'exact', head: true }).in('clinic_id', poolClinicIds).eq('ai_generated', true).or('ai_model.eq.mini,ai_model.is.null').gte('created_at', startOfMonth),
                ])
                setAiMessagesUsedStandard(cStd || 0)
                setAiMessagesUsedPro(cPro || 0)
                setAiMessagesUsedLegacy4o(cLeg || 0)
                setAiMessagesUsed(cMini || 0)
            } catch (err) {
                console.error('Error loading AI settings:', err)
            } finally {
                setIsLoading(false)
            }
        }
        load()
    }, [profile?.clinic_id])

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
            setSelectedAiModel(aiActiveModel === 'pro' ? '4o' : 'mini')
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
                await redirectToLemonCreditsCheckout(profile.clinic_id, user.email, packId, selectedAiModel)
            } else {
                await redirectToCreditsCheckout(profile.clinic_id, user.email, packId, selectedAiModel)
            }
        } catch (error: any) {
            alert(error.message || 'Error al procesar el pago.')
        }
    }

    const totalCredits = aiCreditsMonthlyLimit + aiCreditsExtraBalance + aiCreditsExtra4o
    const totalUsed = aiMessagesUsed + (aiMessagesUsedStandard * 8) + (aiMessagesUsedPro * 60) + (aiMessagesUsedLegacy4o * 60)
    const usagePct = Math.min(100, (totalUsed / (totalCredits || 1)) * 100)

    const mpPacks = { ...CREDIT_PACKS }
    const lsPacks = { ...LS_CREDIT_PACKS }
    const currentPacks = paymentRegion === 'international' ? lsPacks : mpPacks
    const currencySymbol = paymentRegion === 'international' ? 'US$' : '$'
    const currencyCode = paymentRegion === 'international' ? 'USD' : 'CLP'

    return (
        <div className="space-y-6 max-w-5xl mx-auto pb-20 animate-fade-in">
            {/* Banner */}
            <div className="bg-gradient-to-br from-sky-500 to-sky-700 rounded-2xl overflow-hidden shadow-soft-md">
                <div className="p-6 sm:p-8">
                    <div className="flex items-start justify-between gap-4">
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
            </div>

            {isLoading ? (
                <div className="py-20 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-sky-500" /></div>
            ) : (
                <>
                    {/* Hybrid Intelligence — model selector */}
                    <div className="bg-white rounded-2xl border border-silk-beige shadow-sm overflow-hidden">
                        <div className="p-5 sm:p-6 border-b border-silk-beige bg-sky-50/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div className="flex items-center gap-4">
                                <div className="w-11 h-11 bg-charcoal rounded-xl flex items-center justify-center">
                                    <Sparkles className="w-5 h-5 text-sky-400" />
                                </div>
                                <div>
                                    <h2 className="text-base font-black text-charcoal">Vetly Hybrid Intelligence</h2>
                                    <p className="text-xs text-charcoal/50 mt-0.5 uppercase tracking-widest font-bold">Motor de ruteo de modelos IA</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-4 bg-white px-5 py-3 rounded-2xl border border-silk-beige shadow-sm self-start sm:self-auto">
                                <div className="text-right">
                                    <p className="text-[10px] font-black text-charcoal/40 uppercase tracking-widest">Estado</p>
                                    <p className={cn("text-sm font-black uppercase", aiAutoRespond ? "text-emerald-500" : "text-amber-500")}>
                                        {aiAutoRespond ? 'En Línea' : 'Desconectado'}
                                    </p>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input type="checkbox" className="sr-only peer" checked={aiAutoRespond} onChange={(e) => setAiAutoRespond(e.target.checked)} />
                                    <div className="w-12 h-6 bg-charcoal/10 rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-sky-500 after:content-[''] after:absolute after:top-0.5 after:left-[4px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
                                </label>
                            </div>
                        </div>

                        <div className="p-5 sm:p-6">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                {/* Mini */}
                                <button
                                    onClick={() => setAiActiveModel('mini')}
                                    className={cn(
                                        "flex flex-col p-5 rounded-2xl border-2 transition-all duration-300 text-left",
                                        aiActiveModel === 'mini' ? "bg-white border-sky-500 shadow-md ring-4 ring-sky-500/10" : "bg-ivory border-silk-beige hover:border-sky-300 hover:bg-white"
                                    )}
                                >
                                    <div className={cn("w-10 h-10 rounded-xl mb-4 flex items-center justify-center transition-all", aiActiveModel === 'mini' ? "bg-emerald-500 text-white" : "bg-silk-beige text-charcoal/40")}>
                                        <Zap className="w-5 h-5" />
                                    </div>
                                    <h3 className="text-base font-black text-charcoal mb-1">Ahorro Máximo</h3>
                                    <p className="text-[10px] font-bold text-charcoal/40 uppercase tracking-widest mb-3">GPT-4o Mini</p>
                                    <p className="text-xs font-medium text-charcoal/60 leading-relaxed">Ideal para saludos y agendamientos rápidos.</p>
                                    <div className={cn("mt-4 py-1.5 px-3 rounded-full text-[10px] font-black uppercase tracking-widest text-center", aiActiveModel === 'mini' ? "bg-emerald-100 text-emerald-700" : "bg-silk-beige/50 text-charcoal/30")}>
                                        {aiActiveModel === 'mini' ? '✓ Seleccionado' : 'Activar'}
                                    </div>
                                </button>

                                {/* Hybrid */}
                                <button
                                    onClick={() => setAiActiveModel('hybrid')}
                                    className={cn(
                                        "flex flex-col p-5 rounded-2xl border-2 transition-all duration-300 text-left relative",
                                        aiActiveModel === 'hybrid' ? "bg-white border-sky-500 shadow-md ring-4 ring-sky-500/10 scale-[1.02] z-10" : "bg-ivory border-silk-beige hover:border-sky-300 hover:bg-white"
                                    )}
                                >
                                    {aiActiveModel === 'hybrid' && (
                                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-sky-600 text-white text-[9px] font-black px-3 py-1 rounded-full shadow whitespace-nowrap uppercase tracking-widest">
                                            Recomendado
                                        </div>
                                    )}
                                    <div className={cn("w-10 h-10 rounded-xl mb-4 flex items-center justify-center transition-all", aiActiveModel === 'hybrid' ? "bg-sky-500 text-white" : "bg-silk-beige text-charcoal/40")}>
                                        <RefreshCw className="w-5 h-5" />
                                    </div>
                                    <h3 className="text-base font-black text-sky-700 mb-1">Híbrido Automático</h3>
                                    <p className="text-[10px] font-bold text-sky-400 uppercase tracking-widest mb-3">IA Router (N1/N2/N3)</p>
                                    <p className="text-xs font-medium text-charcoal/60 leading-relaxed">Elige el mejor modelo según la complejidad del mensaje.</p>
                                    <div className={cn("mt-4 py-1.5 px-3 rounded-full text-[10px] font-black uppercase tracking-widest text-center", aiActiveModel === 'hybrid' ? "bg-sky-500 text-white shadow" : "bg-silk-beige/50 text-charcoal/30")}>
                                        {aiActiveModel === 'hybrid' ? 'Motor Activo' : 'Activar IA Router'}
                                    </div>
                                </button>

                                {/* Pro */}
                                <button
                                    onClick={() => setAiActiveModel('pro')}
                                    className={cn(
                                        "flex flex-col p-5 rounded-2xl border-2 transition-all duration-300 text-left",
                                        aiActiveModel === 'pro' ? "bg-white border-charcoal shadow-md ring-4 ring-charcoal/10" : "bg-ivory border-silk-beige hover:border-sky-300 hover:bg-white"
                                    )}
                                >
                                    <div className={cn("w-10 h-10 rounded-xl mb-4 flex items-center justify-center transition-all", aiActiveModel === 'pro' ? "bg-charcoal text-white" : "bg-silk-beige text-charcoal/40")}>
                                        <Cpu className="w-5 h-5" />
                                    </div>
                                    <h3 className="text-base font-black text-charcoal mb-1">Máximo Poder</h3>
                                    <p className="text-[10px] font-bold text-charcoal/40 uppercase tracking-widest mb-3">GPT-4o Exclusivo</p>
                                    <p className="text-xs font-medium text-charcoal/60 leading-relaxed">GPT-4o para todos los casos clínicos complejos.</p>
                                    <div className={cn("mt-4 py-1.5 px-3 rounded-full text-[10px] font-black uppercase tracking-widest text-center", aiActiveModel === 'pro' ? "bg-charcoal text-white" : "bg-silk-beige/50 text-charcoal/30")}>
                                        {aiActiveModel === 'pro' ? '✓ Modo Pro' : 'Activar Pro'}
                                    </div>
                                </button>
                            </div>

                            <div className="mt-5 pt-5 border-t border-silk-beige flex items-center justify-between gap-4">
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                                    <p className="text-xs font-bold text-charcoal/50">Sincronización en tiempo real con YCloud</p>
                                </div>
                                <button
                                    onClick={handleSaveAI}
                                    disabled={savingModel}
                                    className="flex items-center gap-2 bg-sky-500 text-white font-black text-sm px-6 py-2.5 rounded-xl hover:bg-sky-600 shadow-sm disabled:opacity-50 transition-colors"
                                >
                                    {savingModel ? <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</> : <><Save className="w-4 h-4" /> Confirmar Configuración</>}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Credits Dashboard */}
                    <div className="bg-white rounded-2xl border border-silk-beige shadow-sm overflow-hidden">
                        <div className="p-5 sm:p-6 border-b border-silk-beige bg-sky-50/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div className="flex items-center gap-4">
                                <div className="w-11 h-11 bg-gradient-to-br from-sky-500 to-sky-700 rounded-xl flex items-center justify-center relative">
                                    <Zap className="w-5 h-5 text-white" />
                                    <div className="absolute -top-1.5 -right-1.5 bg-emerald-500 text-white text-[8px] font-black px-1.5 py-0.5 rounded-full border-2 border-white">LIVE</div>
                                </div>
                                <div>
                                    <h2 className="text-base font-black text-charcoal">Vetly Credits</h2>
                                    <p className="text-xs text-charcoal/40 uppercase tracking-widest font-bold mt-0.5">Créditos unificados de inteligencia</p>
                                </div>
                            </div>
                            <div className="bg-charcoal text-white px-6 py-3 rounded-2xl shadow-lg min-w-[180px] text-center">
                                <p className="text-[10px] font-black uppercase tracking-widest text-sky-400 mb-0.5">Total Disponibles</p>
                                <p className="text-3xl font-black">{totalCredits.toLocaleString()}</p>
                                <p className="text-[9px] font-bold text-white/40 uppercase mt-0.5">Créditos Globales</p>
                            </div>
                        </div>

                        <div className="p-5 sm:p-6 space-y-5">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <div className="bg-silk-beige/20 p-5 rounded-2xl border border-silk-beige/50">
                                    <div className="flex items-center justify-between mb-3">
                                        <p className="text-[10px] font-black text-charcoal/40 uppercase tracking-widest">Plan Base</p>
                                        <CreditCard className="w-4 h-4 text-charcoal/30" />
                                    </div>
                                    <p className="text-2xl font-black text-charcoal">{aiCreditsMonthlyLimit.toLocaleString()}</p>
                                    <p className="text-[10px] font-bold text-charcoal/40 uppercase mt-1">Recarga Mensual</p>
                                </div>
                                <div className="bg-emerald-50/50 p-5 rounded-2xl border border-emerald-100">
                                    <div className="flex items-center justify-between mb-3">
                                        <p className="text-[10px] font-black text-emerald-600/60 uppercase tracking-widest">Cargas Extra</p>
                                        <Plus className="w-4 h-4 text-emerald-500" />
                                    </div>
                                    <p className="text-2xl font-black text-emerald-600">{(aiCreditsExtraBalance + aiCreditsExtra4o).toLocaleString()}</p>
                                    <p className="text-[10px] font-bold text-emerald-400 uppercase mt-1">Saldo Acumulado</p>
                                </div>
                                <div className="bg-red-50/30 p-5 rounded-2xl border border-red-100">
                                    <div className="flex items-center justify-between mb-3">
                                        <p className="text-[10px] font-black text-red-600/60 uppercase tracking-widest">Consumo Mes</p>
                                        <Zap className="w-4 h-4 text-red-500" />
                                    </div>
                                    <p className="text-2xl font-black text-red-600">{totalUsed.toLocaleString()}</p>
                                    <p className="text-[10px] font-bold text-red-400 uppercase mt-1">Créditos Usados</p>
                                </div>
                            </div>

                            {/* Usage bar */}
                            <div className="bg-ivory rounded-2xl p-4 border border-silk-beige">
                                <div className="flex items-center justify-between mb-2">
                                    <p className="text-xs font-black text-charcoal/50 uppercase tracking-widest">Uso del mes</p>
                                    <p className="text-xs font-black text-charcoal">{usagePct.toFixed(1)}%</p>
                                </div>
                                <div className="w-full h-2.5 bg-silk-beige rounded-full overflow-hidden">
                                    <div
                                        className={cn("h-full rounded-full transition-all duration-1000", usagePct >= 90 ? "bg-red-500" : usagePct >= 70 ? "bg-amber-500" : "bg-sky-500")}
                                        style={{ width: `${usagePct}%` }}
                                    />
                                </div>
                            </div>

                            {/* Historial link */}
                            <button onClick={() => navigate('/app/ai-credits')} className="w-full flex items-center justify-between p-4 rounded-2xl border border-silk-beige bg-white hover:shadow-sm hover:border-sky-200 transition-all group">
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 bg-sky-50 rounded-xl flex items-center justify-center border border-sky-100 group-hover:bg-sky-500 transition-all">
                                        <History className="w-5 h-5 text-sky-500 group-hover:text-white transition-colors" />
                                    </div>
                                    <div className="text-left">
                                        <p className="text-sm font-black text-charcoal">Historial de Transacciones IA</p>
                                        <p className="text-[10px] font-bold text-charcoal/40 uppercase tracking-widest mt-0.5">Recargas, consumos y bonos</p>
                                    </div>
                                </div>
                                <ChevronRight className="w-5 h-5 text-charcoal/30 group-hover:text-sky-500 transition-colors" />
                            </button>

                            {/* Cost table */}
                            <div className="bg-ivory/50 rounded-2xl border border-silk-beige p-5">
                                <div className="flex items-center gap-2 mb-4">
                                    <Info className="w-4 h-4 text-charcoal/30" />
                                    <h3 className="text-xs font-black text-charcoal uppercase tracking-widest">Tabla de Costos Híbridos</h3>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                                    {[
                                        { mult: '1x', color: 'bg-emerald-100 text-emerald-700', label: 'N1: Flash Mini — GPT-4o Mini', desc: 'Velocidad y costo mínimo.' },
                                        { mult: '8x', color: 'bg-blue-100 text-blue-700', label: 'N2: Standard — GPT-4o', desc: 'Razonamiento para ventas y logística.' },
                                        { mult: '60x', color: 'bg-charcoal text-white', label: 'N3: Sovereign Pro — GPT-4o', desc: 'Inteligencia clínica y quirúrgica.' },
                                    ].map(item => (
                                        <div key={item.mult} className="flex items-start gap-3">
                                            <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm shadow-inner flex-shrink-0", item.color)}>{item.mult}</div>
                                            <div>
                                                <p className="text-xs font-black text-charcoal">{item.label}</p>
                                                <p className="text-[10px] text-charcoal/40 font-bold mt-0.5 leading-relaxed">{item.desc}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Credit Packs */}
                    <div className="bg-white rounded-2xl border border-silk-beige shadow-sm overflow-hidden">
                        <div className="p-5 sm:p-6 border-b border-silk-beige bg-sky-50/40 flex items-center justify-between gap-4">
                            <div className="flex items-center gap-4">
                                <div className="w-11 h-11 bg-emerald-500 rounded-xl flex items-center justify-center">
                                    <Plus className="w-5 h-5 text-white" />
                                </div>
                                <div>
                                    <h2 className="text-base font-black text-charcoal">Recarga de Créditos IA</h2>
                                    <p className="text-xs text-charcoal/40 uppercase tracking-widest font-bold mt-0.5">Saldo que nunca vence • Activación inmediata</p>
                                </div>
                            </div>
                            {/* Region toggle */}
                            <div className="flex items-center gap-1 bg-silk-beige p-1 rounded-xl border border-silk-beige shadow-sm">
                                <button
                                    onClick={() => setPaymentRegion('chile')}
                                    className={cn("px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all", paymentRegion === 'chile' ? "bg-white text-charcoal shadow-sm" : "text-charcoal/40 hover:text-charcoal")}
                                >
                                    🇨🇱 CLP
                                </button>
                                <button
                                    onClick={() => setPaymentRegion('international')}
                                    className={cn("px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all", paymentRegion === 'international' ? "bg-white text-charcoal shadow-sm" : "text-charcoal/40 hover:text-charcoal")}
                                >
                                    🌎 USD
                                </button>
                            </div>
                        </div>
                        <div className="p-5 sm:p-6">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                                {Object.keys(currentPacks).map((packId) => {
                                    const pack = (currentPacks as any)[packId]
                                    return (
                                        <div key={packId} className={cn("p-6 bg-white border border-silk-beige rounded-2xl hover:shadow-lg hover:border-sky-300 transition-all flex flex-col relative overflow-hidden group", packId === 'heavy' && "border-sky-200")}>
                                            {packId === 'heavy' && (
                                                <div className="absolute top-0 right-0 bg-sky-500 text-white text-[9px] font-black px-3 py-1 rounded-bl-xl uppercase tracking-widest">Sugerido</div>
                                            )}
                                            <h3 className="text-base font-black text-charcoal group-hover:text-sky-600 transition-colors uppercase tracking-tight">{pack.name}</h3>
                                            <div className="flex items-baseline gap-2 mt-2 mb-5">
                                                <span className="text-2xl font-black text-sky-600">{currencySymbol}{pack.price.toLocaleString()}</span>
                                                <span className="text-xs font-black text-charcoal/30 uppercase">{currencyCode}</span>
                                            </div>
                                            <div className="space-y-3 mb-5 flex-grow">
                                                <div className="bg-silk-beige/20 p-3 rounded-xl border border-silk-beige/30">
                                                    <p className="text-sm font-black text-charcoal flex items-center gap-2">
                                                        <Zap className="w-4 h-4 text-sky-500" />
                                                        {pack.credits.toLocaleString()} Créditos
                                                    </p>
                                                </div>
                                                <ul className="space-y-2">
                                                    <li className="flex items-center gap-2 text-xs font-bold text-charcoal/50"><Check className="w-4 h-4 text-emerald-500" />Uso Universal (N1/N2/N3)</li>
                                                    <li className="flex items-center gap-2 text-xs font-bold text-charcoal/50"><Check className="w-4 h-4 text-emerald-500" />Sin fecha de vencimiento</li>
                                                </ul>
                                            </div>
                                            <button
                                                onClick={() => handleBuyCredits(packId)}
                                                className="w-full py-3 bg-charcoal text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-sky-600 shadow-sm hover:shadow-sky-500/20 transition-all"
                                            >
                                                Comprar Pack
                                            </button>
                                        </div>
                                    )
                                })}
                            </div>
                            <p className="text-[10px] text-charcoal/40 font-bold italic text-center mt-5 leading-relaxed">
                                * Los créditos actúan como monedero virtual. Se consumen cuando agotes los gratuitos de tu plan y permanecen activos para siempre.
                            </p>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}
