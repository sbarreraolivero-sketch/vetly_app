import { useState, useEffect } from 'react'
import { Gift, Copy, Loader2, CheckCircle2, Clock, Banknote } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { toast } from 'react-hot-toast'
import { cn } from '@/lib/utils'

interface ReferralRow {
    id: string
    referred_plan: string | null
    status: 'pending' | 'qualified' | 'paid'
    reward_type: 'free_months' | 'cash_commission' | null
    reward_amount: number | null
    reward_currency: string | null
    created_at: string
    referred: { clinic_name: string } | null
}

const STATUS_LABELS: Record<string, { label: string; className: string; icon: any }> = {
    pending: { label: 'Registrado, esperando su primer pago', className: 'bg-charcoal/5 text-charcoal/60', icon: Clock },
    qualified_free: { label: 'Meses gratis aplicados', className: 'bg-emerald-50 text-emerald-700', icon: CheckCircle2 },
    qualified_cash: { label: 'Comisión pendiente de pago', className: 'bg-amber-50 text-amber-700', icon: Banknote },
    paid: { label: 'Comisión pagada', className: 'bg-emerald-50 text-emerald-700', icon: CheckCircle2 },
}

export default function PartnerReferral() {
    const { profile } = useAuth()
    const [loading, setLoading] = useState(true)
    const [code, setCode] = useState<string | null>(null)
    const [referrals, setReferrals] = useState<ReferralRow[]>([])

    useEffect(() => {
        let cancelled = false
        const fetchData = async () => {
            if (!profile?.clinic_id) return
            setLoading(true)
            const [codeRes, referralsRes] = await Promise.all([
                Promise.resolve(
                    supabase.from('clinic_settings').select('partner_referral_code').eq('id', profile.clinic_id).maybeSingle()
                ).then((r: any) => r, () => ({ data: null })),
                Promise.resolve(
                    (supabase as any)
                        .from('clinic_referrals')
                        .select('id, referred_plan, status, reward_type, reward_amount, reward_currency, created_at, referred:clinic_settings!referred_clinic_id(clinic_name)')
                        .eq('referrer_clinic_id', profile.clinic_id)
                        .order('created_at', { ascending: false })
                ).then((r: any) => r, () => ({ data: [] })),
            ])
            if (cancelled) return
            setCode(codeRes?.data?.partner_referral_code || null)
            setReferrals(referralsRes?.data || [])
            setLoading(false)
        }
        fetchData()
        return () => { cancelled = true }
    }, [profile?.clinic_id])

    const referralLink = code ? `${window.location.origin}/registro?ref=${code}` : ''

    const copyLink = () => {
        if (!referralLink) return
        navigator.clipboard.writeText(referralLink)
        toast.success('¡Enlace copiado!')
    }

    const statusKeyFor = (r: ReferralRow) => {
        if (r.status === 'paid') return 'paid'
        if (r.status === 'qualified') return r.reward_type === 'free_months' ? 'qualified_free' : 'qualified_cash'
        return 'pending'
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
            </div>
        )
    }

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Banner */}
            <div className="bg-gradient-to-br from-violet-500 to-violet-700 rounded-2xl overflow-hidden shadow-soft-md">
                <div className="p-5 sm:p-8">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
                        <div className="flex-1 min-w-0">
                            <p className="text-xs font-black uppercase tracking-widest text-violet-200 mb-2">Marketing</p>
                            <h1 className="text-xl sm:text-3xl font-extrabold tracking-tight text-white">Recomienda Vetly</h1>
                            <p className="text-xs sm:text-sm text-violet-100/80 font-light mt-1">Invita a otro veterinario y gana recompensas cuando se suscriba.</p>
                        </div>
                        <div className="hidden sm:flex w-12 h-12 bg-white/15 rounded-2xl items-center justify-center shrink-0">
                            <Gift className="w-6 h-6 text-white" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Link para compartir */}
            <div className="bg-white rounded-2xl border border-silk-beige shadow-sm p-6">
                <h3 className="text-sm font-black uppercase tracking-widest text-charcoal/50 mb-3">Tu enlace de invitación</h3>
                <div className="flex items-center gap-2">
                    <input
                        readOnly
                        value={referralLink || 'Generando tu código...'}
                        className="flex-1 input-soft text-sm bg-ivory"
                    />
                    <button
                        onClick={copyLink}
                        disabled={!referralLink}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-soft bg-violet-600 text-white text-sm font-bold hover:bg-violet-700 transition-colors disabled:opacity-50"
                    >
                        <Copy className="w-4 h-4" />
                        Copiar
                    </button>
                </div>
                <p className="text-xs text-charcoal/50 mt-3">
                    Comparte este enlace con un colega veterinario. Cuando se registre y complete su primer pago, ganas la recompensa automáticamente.
                </p>
            </div>

            {/* Reglas */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-white rounded-2xl border border-silk-beige shadow-sm p-6">
                    <p className="text-xs font-black uppercase tracking-widest text-emerald-600 mb-2">Plan Core</p>
                    <p className="text-2xl font-black text-charcoal">2 meses gratis</p>
                    <p className="text-xs text-charcoal/50 mt-1">Se aplican automáticamente a tu suscripción en cuanto tu referido complete su primer pago.</p>
                </div>
                <div className="bg-white rounded-2xl border border-silk-beige shadow-sm p-6">
                    <p className="text-xs font-black uppercase tracking-widest text-amber-600 mb-2">Starter / Pro / Enterprise</p>
                    <p className="text-2xl font-black text-charcoal">50% del primer pago</p>
                    <p className="text-xs text-charcoal/50 mt-1">Comisión pagada por transferencia — te contactaremos una vez confirmado el pago de tu referido.</p>
                </div>
            </div>

            {/* Lista de referidos */}
            <div className="bg-white rounded-2xl border border-silk-beige shadow-sm p-6">
                <h3 className="text-sm font-black uppercase tracking-widest text-charcoal/50 mb-4">Tus referidos ({referrals.length})</h3>
                {referrals.length === 0 ? (
                    <p className="text-sm text-charcoal/50 py-6 text-center">Todavía no has referido a ninguna clínica. Comparte tu enlace para empezar.</p>
                ) : (
                    <div className="space-y-2">
                        {referrals.map((r) => {
                            const s = STATUS_LABELS[statusKeyFor(r)]
                            const Icon = s.icon
                            return (
                                <div key={r.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-silk-beige">
                                    <div className="min-w-0">
                                        <p className="text-sm font-bold text-charcoal truncate">{r.referred?.clinic_name || 'Clínica referida'}</p>
                                        <p className="text-xs text-charcoal/50">{new Date(r.created_at).toLocaleDateString('es-CL')} · Plan {r.referred_plan || '—'}</p>
                                    </div>
                                    <div className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold shrink-0', s.className)}>
                                        <Icon className="w-3.5 h-3.5" />
                                        {s.label}
                                        {r.status !== 'pending' && r.reward_type === 'cash_commission' && r.reward_amount ? (
                                            <span className="ml-1">
                                                ({r.reward_currency === 'USD' ? '$' : '$'}{r.reward_amount.toLocaleString()} {r.reward_currency})
                                            </span>
                                        ) : null}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        </div>
    )
}
