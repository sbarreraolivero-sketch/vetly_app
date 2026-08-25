import { useState, useEffect } from 'react'
import {
    Users,
    TrendingUp,
    Plus,
    Minus,
    Search,
    Award,
    Gift,
    Target,
    Loader2,
    Share2,
    Save,
    Settings as SettingsIcon,
    ShoppingBag,
    DollarSign,
    Percent,
    Trophy,
    History as HistoryIcon
} from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { currencySymbol } from '@/lib/currency'
import { useAuth } from '@/contexts/AuthContext'
import { loyaltyService, LoyaltySettings, LoyaltyReward } from '@/services/loyaltyService'
import { supabase } from '@/lib/supabase'
import { toast } from 'react-hot-toast'
import { LoyaltyRewardModal } from '@/components/loyalty/LoyaltyRewardModal'
import { LoyaltyConfigWizard } from '@/components/loyalty/LoyaltyConfigWizard'

export default function Loyalty() {
    const { profile } = useAuth()
    const [searchParams] = useSearchParams()
    const VALID_TABS = ['points', 'referrals', 'rewards', 'alerts', 'settings'] as const
    type LoyaltyTab = typeof VALID_TABS[number]
    const initialTab = searchParams.get('tab') as LoyaltyTab | null
    const [activeTab, setActiveTab] = useState<LoyaltyTab>(
        initialTab && VALID_TABS.includes(initialTab) ? initialTab : 'points'
    )

    useEffect(() => {
        const tab = searchParams.get('tab') as LoyaltyTab | null
        if (tab && VALID_TABS.includes(tab)) setActiveTab(tab)
    }, [searchParams])
    const [loading, setLoading] = useState(true)
    const [settings, setSettings] = useState<LoyaltySettings | null>(null)
    const [rewards, setRewards] = useState<LoyaltyReward[]>([])
    const [tutors, setTutors] = useState<any[]>([])
    const [searchQuery, setSearchQuery] = useState('')
    const [isRewardModalOpen, setIsRewardModalOpen] = useState(false)
    const [transactions, setTransactions] = useState<any[]>([])

    // Stats for the header
    const [stats, setStats] = useState({
        totalPointsDist: 0,
        totalReferrals: 0,
        activeAlerts: 0
    })

    const [tutorAmounts, setTutorAmounts] = useState<Record<string, string>>({});
    const [pendingAdjustments, setPendingAdjustments] = useState<Record<string, number>>({});
    const [_clinicPhone, setClinicPhone] = useState<string>('')
    const [clinicCurrency, setClinicCurrency] = useState<string>('CLP')
    const [togglingProgram, setTogglingProgram] = useState(false)

    // Encender/apagar el programa completo. Guarda de inmediato y no espera al botón
    // "Aplicar Cambios Globales": es el control que se usa para frenar la acumulación
    // en caliente, y depender de un guardado posterior deja el programa corriendo si
    // alguien cierra la página. Un solo flag controla motor, canje, carnet y lo que
    // el agente de WhatsApp le anuncia al cliente.
    const toggleProgram = async (next: boolean) => {
        if (!profile?.clinic_id || !settings) return
        if (!next && !confirm('¿Pausar el programa?\n\nLos clientes dejarán de acumular, no se podrá canjear y el agente de WhatsApp dejará de mencionarlo. Los saldos ya acumulados se conservan.')) return
        setTogglingProgram(true)
        const previous = settings.loyalty_enabled
        setSettings(s => s ? { ...s, loyalty_enabled: next } : null)   // optimista
        try {
            await loyaltyService.updateSettings(profile.clinic_id, { loyalty_enabled: next })
            toast.success(next ? 'Programa activado' : 'Programa pausado')
        } catch (error) {
            setSettings(s => s ? { ...s, loyalty_enabled: previous } : null)
            toast.error('No se pudo cambiar el estado del programa')
        } finally {
            setTogglingProgram(false)
        }
    }

    const fetchData = async () => {
        if (!profile?.clinic_id) return
        setLoading(true)
        try {
            const [s, tDataRes, rData, transDataRes, clinicSettingsRes] = await Promise.all([
                loyaltyService.getSettings(profile.clinic_id),
                (supabase as any)
                    .from('tutors')
                    .select('*')
                    .eq('clinic_id', profile.clinic_id)
                    .order('loyalty_points', { ascending: false }),
                loyaltyService.getRewards(profile.clinic_id),
                (supabase as any)
                    .from('loyalty_transactions')
                    .select('*, tutors(name)')
                    .eq('clinic_id', profile.clinic_id)
                    .order('created_at', { ascending: false })
                    .limit(50),
                // Fallback a contact_phone: ycloud_phone_number quedó en NULL en las
                // clínicas migradas a Meta Cloud API, y sin él los enlaces de referido
                // no llevaban a ninguna parte.
                (supabase as any)
                    .from('clinic_settings')
                    .select('ycloud_phone_number, contact_phone, currency')
                    .eq('id', profile.clinic_id)
                    .maybeSingle()
            ])
            setSettings(s)
            setTutors(tDataRes.data || [])
            setClinicPhone(clinicSettingsRes.data?.ycloud_phone_number || clinicSettingsRes.data?.contact_phone || '')
            setClinicCurrency(clinicSettingsRes.data?.currency || 'CLP')
            setRewards(rData || [])
            setTransactions(transDataRes.data || [])

            // Calculate basic stats
            const totalPoints = (tDataRes.data || []).reduce((acc: number, t: any) => acc + (t.loyalty_points || 0), 0)
            const referralCount = (tDataRes.data || []).filter((t: any) => (t.referral_count || 0) > 0).length

            setStats({
                totalPointsDist: totalPoints,
                totalReferrals: referralCount,
                activeAlerts: (rData || []).filter((r: any) => r.is_active).length
            })
        } catch (error) {
            console.error('Error fetching loyalty data:', error)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchData()
    }, [profile?.clinic_id])

    const fetchRewards = async () => {
        if (!profile?.clinic_id) return
        try {
            const rData = await loyaltyService.getRewards(profile.clinic_id)
            setRewards(rData || [])
        } catch (error) {
            console.error('Error fetching rewards:', error)
        }
    }

    const handleAdjustPoints = (tutorId: string, amountStr: string, isAdding: boolean) => {
        const amount = parseInt(amountStr || '0');
        if (!profile?.clinic_id || amount <= 0) return;

        const finalAmount = isAdding ? amount : -amount;

        // 1. UPDATE LOCAL UI IMMEDIATELY (Live Sum)
        setTutors(prev => prev.map(t =>
            t.id === tutorId
                ? { ...t, loyalty_points: (t.loyalty_points || 0) + finalAmount }
                : t
        ));

        // 2. TRACK PENDING CHANGE (Do NOT call API yet)
        setPendingAdjustments(prev => ({
            ...prev,
            [tutorId]: (prev[tutorId] || 0) + finalAmount
        }));

        // 3. Clear the input for this tutor
        setTutorAmounts(prev => ({ ...prev, [tutorId]: '0' }));

        toast.success(`Ajuste local de ${finalAmount} listo para guardar`);
    };

    const savePendingAdjustments = async () => {
        if (!profile?.clinic_id || Object.keys(pendingAdjustments).length === 0) return;

        setLoading(true);
        const tutorIds = Object.keys(pendingAdjustments);

        try {
            // Process all pending adjustments
            for (const tId of tutorIds) {
                const points = pendingAdjustments[tId];
                if (points === 0) continue;

                const { error } = await (supabase as any)
                    .from('loyalty_transactions')
                    .insert({
                        clinic_id: profile.clinic_id,
                        tutor_id: tId,
                        points: points,
                        type: 'adjustment',
                        description: points > 0 ? 'Ajuste manual (crédito)' : 'Ajuste manual (débito)'
                    });

                if (error) throw error;
            }

            setPendingAdjustments({});
            toast.success('Todos los movimientos guardados en la nube');
            await fetchData(); // Final sync after everything is done
        } catch (error) {
            console.error('Error saving adjustments:', error);
            toast.error('Ocurrió un error al guardar. Algunos cambios podrían no haberse guardado.');
            await fetchData();
        } finally {
            setLoading(false);
        }
    };

    const copyReferralLink = (code: string, _tutorName?: string) => {
        const shortLink = `${window.location.origin}/r/${code}`
        navigator.clipboard.writeText(shortLink)
        toast.success('¡Enlace corto copiado!')
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
            </div>
        )
    }

    const filteredTutors = tutors.filter(t =>
    (t.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.phone_number?.includes(searchQuery))
    )

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Banner */}
            <div className="bg-gradient-to-br from-violet-500 to-violet-700 rounded-2xl overflow-hidden shadow-soft-md">
                <div className="p-6 sm:p-8">
                    <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                            <p className="text-xs font-black uppercase tracking-widest text-violet-200 mb-2">Marketing</p>
                            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">Fidelización & Referidos</h1>
                            <p className="text-sm text-violet-100/80 font-light mt-1">Programa de lealtad y crecimiento orgánico de tu clínica.</p>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 bg-white/15 rounded-2xl flex items-center justify-center shrink-0">
                                <Trophy className="w-6 h-6 text-white" />
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-6 mt-6 pt-5 border-t border-white/10">
                        <div>
                            <p className="text-2xl font-black text-white">{stats.totalPointsDist.toLocaleString()}</p>
                            <p className="text-xs font-black text-violet-200 uppercase tracking-widest mt-0.5">{settings?.loyalty_points_name || 'Puntos'}</p>
                        </div>
                        <div className="w-px h-8 bg-white/15" />
                        <div>
                            <p className="text-2xl font-black text-white">{stats.totalReferrals}</p>
                            <p className="text-xs font-black text-violet-200 uppercase tracking-widest mt-0.5">Referidores</p>
                        </div>
                        <div className="w-px h-8 bg-white/15" />
                        <div>
                            <p className="text-2xl font-black text-white">{stats.activeAlerts}</p>
                            <p className="text-xs font-black text-violet-200 uppercase tracking-widest mt-0.5">Recompensas</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Tabs */}
            <div className="flex items-center gap-1 p-1 bg-ivory rounded-full border border-silk-beige w-full md:w-fit overflow-x-auto no-scrollbar">
                <button
                    onClick={() => setActiveTab('points')}
                    className={cn(
                        "flex-1 md:flex-initial flex items-center justify-center gap-1.5 px-4 md:px-6 py-2 rounded-full text-xs md:text-sm font-black transition-all whitespace-nowrap",
                        activeTab === 'points' ? "bg-accent-500 text-white shadow-md" : "text-charcoal/40 hover:text-charcoal"
                    )}
                >
                    <Gift className="w-3.5 h-3.5" />
                    Billetera
                </button>
                <button
                    onClick={() => setActiveTab('referrals')}
                    className={cn(
                        "flex-1 md:flex-initial flex items-center justify-center gap-1.5 px-4 md:px-6 py-2 rounded-full text-xs md:text-sm font-black transition-all whitespace-nowrap",
                        activeTab === 'referrals' ? "bg-accent-500 text-white shadow-md" : "text-charcoal/40 hover:text-charcoal"
                    )}
                >
                    <Users className="w-3.5 h-3.5" />
                    Referidos
                </button>
                <button
                    onClick={() => setActiveTab('rewards')}
                    className={cn(
                        "flex-1 md:flex-initial flex items-center justify-center gap-1.5 px-4 md:px-6 py-2 rounded-full text-xs md:text-sm font-black transition-all whitespace-nowrap",
                        activeTab === 'rewards' ? "bg-accent-500 text-white shadow-md" : "text-charcoal/40 hover:text-charcoal"
                    )}
                >
                    <ShoppingBag className="w-3.5 h-3.5" />
                    Catálogo
                </button>
                <button
                    onClick={() => setActiveTab('alerts')}
                    className={cn(
                        "flex-1 md:flex-initial flex items-center justify-center gap-1.5 px-4 md:px-6 py-2 rounded-full text-xs md:text-sm font-black transition-all whitespace-nowrap",
                        activeTab === 'alerts' ? "bg-accent-500 text-white shadow-md" : "text-charcoal/40 hover:text-charcoal"
                    )}
                >
                    <HistoryIcon className="w-3.5 h-3.5" />
                    Historial
                </button>
                <button
                    onClick={() => setActiveTab('settings')}
                    className={cn(
                        "flex-1 md:flex-initial flex items-center justify-center gap-1.5 px-4 md:px-6 py-2 rounded-full text-xs md:text-sm font-black transition-all whitespace-nowrap",
                        activeTab === 'settings' ? "bg-accent-500 text-white shadow-md" : "text-charcoal/40 hover:text-charcoal"
                    )}
                >
                    <SettingsIcon className="w-3.5 h-3.5" />
                    Ajustes
                </button>
            </div>

            {/* Tab Contents */}
            {activeTab === 'points' && (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
                    <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
                        <div className="relative flex-1 group">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal/20 group-focus-within:text-primary-500 transition-colors" />
                            <input
                                type="text"
                                placeholder="Buscar por nombre o celular..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="w-full h-12 pl-12 pr-4 bg-ivory border border-silk-beige rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-accent-100 transition-all font-bold placeholder:text-charcoal/20"
                            />
                        </div>
                        {Object.keys(pendingAdjustments).length > 0 && (
                            <button
                                onClick={savePendingAdjustments}
                                disabled={loading}
                                className="flex items-center gap-2 bg-emerald-500 text-white px-6 py-3 rounded-full font-black text-sm shadow-lg hover:bg-emerald-600 transition-all animate-in zoom-in-95 duration-200 hover:scale-105 active:scale-95"
                            >
                                <Save className="w-5 h-5" />
                                Guardar Movimientos ({Object.keys(pendingAdjustments).length})
                            </button>
                        )}
                        <div className="flex items-center gap-2 text-xs font-bold text-charcoal/40 bg-silk-beige/30 px-4 py-2 rounded-full">
                            <TrendingUp className="w-3 h-3" />
                            REGLA ACTUAL: {settings?.loyalty_points_percentage}% DESDE LA 2ª VISITA
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filteredTutors.map((tutor) => (
                            <div key={tutor.id} className="bg-white rounded-softer p-5 border border-silk-beige shadow-soft-sm hover:shadow-soft-md transition-all group">
                                <div className="flex items-start justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 bg-ivory rounded-full flex items-center justify-center text-accent-600 font-bold border border-silk-beige">
                                            {tutor.name?.charAt(0) || '?'}
                                        </div>
                                        <div>
                                            <p className="font-bold text-charcoal">{tutor.name}</p>
                                            <div className="flex flex-col">
                                                <p className="text-xs text-charcoal/40 uppercase tracking-tight">{tutor.phone_number}</p>
                                                <p className="text-xs font-bold text-accent-500 uppercase tracking-tight">Cód: {tutor.referral_code || '---'}</p>
                                            </div>
                                        </div>
                                    </div>
                                    {tutor.loyalty_points >= 5000 && (
                                        <Award className="w-5 h-5 text-amber-500" />
                                    )}
                                </div>

                                <div className="bg-ivory rounded-soft p-3 flex flex-col gap-3 mb-4 border border-silk-beige/50">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-xs font-bold font-black text-charcoal/30 uppercase tracking-widest leading-none mb-1">Saldo Actual</p>
                                            <p className="text-xl font-black text-charcoal">{tutor.loyalty_points || 0} <span className="text-sm font-bold text-accent-500">{currencySymbol(clinicCurrency)}</span></p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-xs font-bold font-black text-charcoal/20 uppercase tracking-widest leading-none mb-1">Referidos</p>
                                            <p className="text-sm font-black text-charcoal">{tutor.referral_count || 0}</p>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 pt-2 border-t border-silk-beige/30">
                                        <div className="relative flex-1">
                                            <input
                                                type="number"
                                                value={tutorAmounts[tutor.id] === '0' ? '' : (tutorAmounts[tutor.id] || '')}
                                                onChange={(e) => setTutorAmounts(prev => ({ ...prev, [tutor.id]: e.target.value }))}
                                                onBlur={(e) => {
                                                    if (!e.target.value) setTutorAmounts(prev => ({ ...prev, [tutor.id]: '0' }));
                                                }}
                                                className="w-full h-9 pl-3 pr-2 bg-white border border-silk-beige rounded-soft text-xs font-black focus:ring-1 focus:ring-primary-500 outline-none placeholder:text-charcoal/20"
                                                placeholder="Monto"
                                            />
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <button
                                                onClick={() => handleAdjustPoints(tutor.id, tutorAmounts[tutor.id] || '0', false)}
                                                className="h-9 px-3 bg-white text-red-500 hover:bg-red-50 rounded-soft border border-silk-beige shadow-sm transition-all hover:scale-105 active:scale-95"
                                                title="Quitar saldo personalizado"
                                            >
                                                <Minus className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => handleAdjustPoints(tutor.id, tutorAmounts[tutor.id] || '0', true)}
                                                className="h-9 px-3 bg-white text-emerald-500 hover:bg-emerald-50 rounded-soft border border-silk-beige shadow-sm transition-all hover:scale-105 active:scale-95"
                                                title="Sumar saldo personalizado"
                                            >
                                                <Plus className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between text-xs font-medium text-charcoal/50">
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => {
                                                copyReferralLink(tutor.referral_code || '', tutor.name);
                                            }}
                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-50 text-accent-600 rounded-full text-xs font-bold hover:bg-accent-100 transition-colors"
                                            title="Copiar enlace corto de referido"
                                        >
                                            <Share2 className="w-3 h-3" />
                                            Referido
                                        </button>
                                        {tutor.portal_token && (
                                            <a
                                                href={`/p/${tutor.portal_token}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-50 text-primary-600 rounded-full text-xs font-bold hover:bg-primary-100 transition-colors"
                                                title="Ver portal del tutor"
                                            >
                                                Portal
                                            </a>
                                        )}
                                        <button className="text-charcoal/40 hover:text-charcoal transition-colors">Historial</button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {activeTab === 'referrals' && (
                <div className="animate-in fade-in slide-in-from-bottom-2">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="lg:col-span-2 card-soft p-6">
                            <div className="flex items-center justify-between mb-6">
                                <h3 className="text-lg font-bold text-charcoal">Ranking de Embajadores</h3>
                                <div className="flex items-center gap-2 text-accent-600 bg-accent-50 px-3 py-1.5 rounded-full text-xs font-bold">
                                    <Award className="w-4 h-4" />
                                    Bono: {settings?.loyalty_referral_bonus}{settings?.loyalty_referral_bonus_type === 'percentage' ? '%' : ` ${currencySymbol(clinicCurrency)}`} / amigo referido
                                </div>
                            </div>

                            <div className="space-y-4">
                                {tutors.filter(t => t.referral_count > 0)
                                    .sort((a, b) => b.referral_count - a.referral_count)
                                    .slice(0, 10)
                                    .map((ambassador, idx) => (
                                        <div key={ambassador.id} className="flex items-center gap-4 p-4 bg-ivory rounded-soft border border-silk-beige/50 hover:border-accent-200 transition-all">
                                            <div className={cn(
                                                "w-8 h-8 rounded-full flex items-center justify-center font-black text-sm",
                                                idx === 0 ? "bg-amber-500 text-white" : "bg-silk-beige text-charcoal/50"
                                            )}>
                                                {idx + 1}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="font-bold text-charcoal">{ambassador.name}</p>
                                                <p className="text-xs text-charcoal/40">Código: <span className="font-mono text-accent-500">{ambassador.referral_code}</span></p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-lg font-black text-charcoal">{ambassador.referral_count}</p>
                                                <p className="text-xs font-black text-charcoal/30 uppercase">Amigos Referidos</p>
                                            </div>
                                        </div>
                                    ))}
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="bg-gradient-to-br from-primary-500 to-sky-600 rounded-softer p-6 text-white shadow-soft-md">
                                <Target className="w-8 h-8 mb-4 text-primary-200" />
                                <h3 className="text-lg font-bold mb-2 text-white">Manual de Embajadores</h3>
                                <p className="text-sm text-white/80 mb-4">
                                    Cada tutor tiene un código único. Cuando un amigo llega con su enlace y
                                    <strong> se atiende por primera vez</strong>, el referidor gana su bono y el nuevo
                                    cliente su bienvenida. El premio se paga con la compra, no con el saludo.
                                </p>
                                <Link
                                    to="/app/templates"
                                    className="w-full h-10 flex items-center justify-center bg-white/20 hover:bg-white/30 backdrop-blur-md rounded-soft text-sm font-bold transition-all border border-white/20"
                                >
                                    Personalizar Mensajes
                                </Link>
                            </div>

                            <div className="bg-white rounded-softer p-6 border border-silk-beige shadow-soft-sm">
                                <h3 className="font-bold text-charcoal mb-4">¿Cómo funciona?</h3>
                                <ul className="space-y-3">
                                    <li className="flex gap-2 text-xs text-charcoal/60">
                                        <span className="text-accent-500 font-bold">1.</span>
                                        El tutor comparte su "Magic Link" con un amigo.
                                    </li>
                                    <li className="flex gap-2 text-xs text-charcoal/60">
                                        <span className="text-accent-500 font-bold">2.</span>
                                        El amigo agenda su primera cita usando ese enlace.
                                    </li>
                                    <li className="flex gap-2 text-xs text-charcoal/60">
                                        <span className="text-accent-500 font-bold">3.</span>
                                        Al concretar la cita, el amigo recibe su bono de bienvenida y el referente recibe su bono por invitar.
                                    </li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'rewards' && (
                <div className="animate-in fade-in slide-in-from-bottom-2">
                    <div className="flex items-center justify-between mb-8">
                        <div>
                            <h2 className="text-2xl font-black text-charcoal tracking-tight">Catálogo de Recompensas</h2>
                            <p className="text-sm text-charcoal/50">Define lo que tus tutores pueden canjear con su saldo acumulado.</p>
                        </div>
                        <button
                            onClick={() => setIsRewardModalOpen(true)}
                            className="flex items-center gap-2 bg-accent-500 text-white px-6 py-3 rounded-full font-black text-sm shadow-md hover:bg-accent-600 transition-all"
                        >
                            <Plus className="w-4 h-4" />
                            Nueva Recompensa
                        </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {rewards.length > 0 ? rewards.map(reward => (
                            <div key={reward.id} className="card-soft overflow-hidden group">
                                <div className="p-6">
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="p-3 bg-accent-50 rounded-soft text-accent-600">
                                            {reward.reward_type === 'money' && <DollarSign className="w-6 h-6" />}
                                            {reward.reward_type === 'percentage' && <Percent className="w-6 h-6" />}
                                            {(reward.reward_type === 'gift' || reward.reward_type === 'treatment') && <Gift className="w-6 h-6" />}
                                        </div>
                                        <div className="text-right">
                                            <p className="text-xl font-black text-charcoal">{reward.points_cost}</p>
                                            <p className="text-xs font-black text-charcoal/30 uppercase">{settings?.loyalty_points_name || 'puntos'}</p>
                                        </div>
                                    </div>
                                    <h3 className="font-bold text-charcoal mb-1">{reward.name}</h3>
                                    <p className="text-xs text-charcoal/50 mb-4 line-clamp-2">{reward.description || 'Sin descripción'}</p>

                                    <div className="flex items-center justify-between pt-4 border-t border-silk-beige">
                                        <div className="text-xs font-black uppercase text-emerald-500">
                                            {reward.is_active ? 'Activa' : 'Inactiva'}
                                        </div>
                                        <button className="text-xs font-black uppercase text-charcoal/30 hover:text-charcoal transition-colors">Editar</button>
                                    </div>
                                </div>
                            </div>
                        )) : (
                            <div className="col-span-full py-12 flex flex-col items-center justify-center text-charcoal/30 border-2 border-dashed border-silk-beige rounded-softer bg-ivory">
                                <ShoppingBag className="w-12 h-12 mb-4 opacity-20" />
                                <p className="font-bold uppercase tracking-widest text-sm">No hay recompensas configuradas</p>
                                <p className="text-xs">Crea tu primer beneficio para que los tutores puedan canjear.</p>
                            </div>
                        )}
                    </div>
                </div>
            )}
            {activeTab === 'alerts' && (
                <div className="animate-in fade-in slide-in-from-bottom-2 space-y-6">
                    <div className="card-soft p-6">
                        <h3 className="text-lg font-bold text-charcoal mb-4 flex items-center gap-2">
                            <HistoryIcon className="w-5 h-5 text-accent-500" />
                            Historial Global de Movimientos
                        </h3>
                        <div className="space-y-3">
                            {transactions.length > 0 ? transactions.map(tx => (
                                <div key={tx.id} className="flex items-center justify-between p-4 bg-ivory rounded-soft border border-silk-beige/50">
                                    <div className="flex items-center gap-4">
                                        <div className={cn(
                                            "w-10 h-10 rounded-full flex items-center justify-center",
                                            tx.points > 0 ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"
                                        )}>
                                            {tx.points > 0 ? <Plus className="w-5 h-5" /> : <Minus className="w-5 h-5" />}
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold text-charcoal">{tx.tutors?.name || 'Tutor desconocido'}</p>
                                            <p className="text-xs text-charcoal/40">{tx.description} • {new Date(tx.created_at).toLocaleDateString()}</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className={cn("font-black", tx.points > 0 ? "text-emerald-500" : "text-red-500")}>
                                            {tx.points > 0 ? '+' : ''}{tx.points} {currencySymbol(clinicCurrency)}
                                        </p>
                                        <p className="text-xs font-bold uppercase font-bold text-charcoal/20">{tx.type}</p>
                                    </div>
                                </div>
                            )) : (
                                <div className="text-center py-12 text-charcoal/30">
                                    <HistoryIcon className="w-12 h-12 mx-auto mb-4 opacity-10" />
                                    <p className="font-bold uppercase tracking-widest text-sm">Sin movimientos registrados</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'settings' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in slide-in-from-bottom-2">
                    <div className="lg:col-span-2 space-y-6">
                        {/* Interruptor maestro del programa */}
                        <section className={cn(
                            "rounded-softer border p-6 shadow-soft-sm transition-colors",
                            settings?.loyalty_enabled
                                ? "bg-emerald-50 border-emerald-200"
                                : "bg-ivory border-silk-beige"
                        )}>
                            <div className="flex items-center justify-between gap-4">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className={cn(
                                            "w-2.5 h-2.5 rounded-full shrink-0",
                                            settings?.loyalty_enabled ? "bg-emerald-500 animate-pulse" : "bg-charcoal/25"
                                        )} />
                                        <h3 className="text-lg font-black text-charcoal">
                                            {settings?.loyalty_enabled ? 'Programa activo' : 'Programa pausado'}
                                        </h3>
                                    </div>
                                    <p className="text-sm text-charcoal/50 leading-snug">
                                        {settings?.loyalty_enabled
                                            ? `Los clientes acumulan ${settings?.loyalty_points_name}, pueden canjearlos en caja y el agente de WhatsApp lo menciona al agendar.`
                                            : 'Nadie acumula ni puede canjear, y el agente de WhatsApp no lo menciona. Los saldos ya acumulados se conservan.'}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={!!settings?.loyalty_enabled}
                                    disabled={togglingProgram || !settings}
                                    onClick={() => toggleProgram(!settings?.loyalty_enabled)}
                                    className={cn(
                                        "relative w-14 h-8 rounded-full transition-colors shrink-0 disabled:opacity-40",
                                        settings?.loyalty_enabled ? "bg-emerald-500" : "bg-charcoal/20"
                                    )}
                                >
                                    <span className={cn(
                                        "absolute top-1 w-6 h-6 bg-white rounded-full shadow transition-all",
                                        settings?.loyalty_enabled ? "left-7" : "left-1"
                                    )} />
                                </button>
                            </div>
                        </section>

                        {settings && profile?.clinic_id && (
                            <LoyaltyConfigWizard
                                clinicId={profile.clinic_id}
                                currency={clinicCurrency}
                                settings={settings}
                                onSaved={(updated) => setSettings(s => s ? { ...s, ...updated } : null)}
                            />
                        )}
                    </div>

                    <div className="space-y-6">
                        <div className="bg-gradient-to-br from-primary-500 to-primary-700 rounded-softer p-6 text-white shadow-soft-md">
                            <Trophy className="w-8 h-8 mb-4 text-primary-200" />
                            <h3 className="text-lg font-bold mb-2 text-white">Cómo funciona</h3>
                            <ul className="text-sm text-primary-100 space-y-3 leading-snug">
                                <li>
                                    <strong className="text-white">Bono de bienvenida.</strong> Solo lo recibe
                                    quien llega recomendado por otro cliente, en su primera compra. Un cliente
                                    nuevo sin referidor no lo recibe: empieza a acumular desde su segunda visita.
                                </li>
                                <li>
                                    <strong className="text-white">Bono al que refiere.</strong> Se paga recién
                                    cuando su recomendado hace su primera compra, no al compartir el código.
                                </li>
                                <li>
                                    <strong className="text-white">Acumulación.</strong> Cualquier cliente suma
                                    saldo en cada compra desde la segunda, y lo canjea en caja.
                                </li>
                            </ul>
                        </div>

                        <div className="bg-ivory rounded-softer border border-silk-beige p-6">
                            <h4 className="font-black text-charcoal mb-3 text-sm">Configuración actual</h4>
                            <dl className="space-y-2 text-sm">
                                <div className="flex items-baseline justify-between gap-3">
                                    <dt className="text-charcoal/50">Bienvenida</dt>
                                    <dd className="font-black text-charcoal">
                                        {settings?.loyalty_welcome_bonus}
                                        {settings?.loyalty_welcome_bonus_type === 'percentage'
                                            ? '%'
                                            : ` ${currencySymbol(clinicCurrency)}`}
                                    </dd>
                                </div>
                                <div className="flex items-baseline justify-between gap-3">
                                    <dt className="text-charcoal/50">Al que refiere</dt>
                                    <dd className="font-black text-charcoal">
                                        {settings?.loyalty_referral_bonus}
                                        {settings?.loyalty_referral_bonus_type === 'percentage'
                                            ? '%'
                                            : ` ${currencySymbol(clinicCurrency)}`}
                                    </dd>
                                </div>
                                <div className="flex items-baseline justify-between gap-3">
                                    <dt className="text-charcoal/50">Compras siguientes</dt>
                                    <dd className="font-black text-charcoal">{settings?.loyalty_points_percentage}%</dd>
                                </div>
                            </dl>
                        </div>
                    </div>
                </div>
            )}

            {isRewardModalOpen && profile?.clinic_id && (
                <LoyaltyRewardModal
                    clinicId={profile.clinic_id}
                    pointsName={settings?.loyalty_points_name}
                    onClose={() => setIsRewardModalOpen(false)}
                    onSave={fetchRewards}
                />
            )}
        </div>
    )
}
