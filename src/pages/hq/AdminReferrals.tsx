import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Loader2, RefreshCw, Gift, CheckCircle2, Clock, Banknote } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AdminReferralRow {
    id: string
    referrer_clinic_id: string
    referrer_name: string
    referred_clinic_id: string
    referred_name: string
    referred_plan: string | null
    status: 'pending' | 'qualified' | 'paid'
    reward_type: 'free_months' | 'cash_commission' | null
    reward_amount: number | null
    reward_currency: string | null
    created_at: string
    rewarded_at: string | null
    paid_at: string | null
}

const statusStyles: Record<string, { bg: string; text: string; label: string; icon: any }> = {
    pending: { bg: 'bg-gray-50', text: 'text-gray-600', label: 'Pendiente de pago del referido', icon: Clock },
    qualified: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Comisión pendiente de pago', icon: Banknote },
    paid: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Pagado', icon: CheckCircle2 },
    qualified_free: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Meses gratis aplicados', icon: CheckCircle2 },
}

export default function AdminReferrals() {
    const [referrals, setReferrals] = useState<AdminReferralRow[]>([])
    const [loading, setLoading] = useState(true)
    const [paying, setPaying] = useState<string | null>(null)

    const fetchReferrals = useCallback(async () => {
        setLoading(true)
        try {
            const { data, error } = await (supabase as any).rpc('get_admin_referrals')
            if (error) throw error
            setReferrals(data || [])
        } catch (err: any) {
            console.error('Error fetching referrals:', err)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { fetchReferrals() }, [fetchReferrals])

    const handleMarkPaid = async (id: string) => {
        if (!confirm('¿Confirmas que ya transferiste esta comisión al referidor?')) return
        setPaying(id)
        try {
            const { error } = await (supabase as any).rpc('mark_referral_paid', { p_referral_id: id })
            if (error) throw error
            await fetchReferrals()
        } catch (err: any) {
            alert('Error: ' + err.message)
        } finally {
            setPaying(null)
        }
    }

    const statusKeyFor = (r: AdminReferralRow) => {
        if (r.status === 'qualified' && r.reward_type === 'free_months') return 'qualified_free'
        return r.status
    }

    const stats = {
        total: referrals.length,
        pendingPayout: referrals.filter(r => r.status === 'qualified' && r.reward_type === 'cash_commission').length,
        paid: referrals.filter(r => r.status === 'paid').length,
        freeMonths: referrals.filter(r => r.reward_type === 'free_months' && r.status !== 'pending').reduce((acc, r) => acc + (r.reward_amount || 0), 0),
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
            </div>
        )
    }

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                        <Gift className="w-6 h-6 text-primary-500" />
                        Referidos B2B
                    </h1>
                    <p className="text-sm text-gray-500 mt-1">Clínicas que refirieron a otras clínicas y sus recompensas.</p>
                </div>
                <button
                    onClick={fetchReferrals}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 transition-colors"
                >
                    <RefreshCw className="w-4 h-4" />
                    Actualizar
                </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-white rounded-2xl border border-gray-200 p-4">
                    <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
                    <p className="text-xs text-gray-500 mt-1">Total referidos</p>
                </div>
                <div className="bg-white rounded-2xl border border-gray-200 p-4">
                    <p className="text-2xl font-bold text-amber-600">{stats.pendingPayout}</p>
                    <p className="text-xs text-gray-500 mt-1">Comisiones por pagar</p>
                </div>
                <div className="bg-white rounded-2xl border border-gray-200 p-4">
                    <p className="text-2xl font-bold text-emerald-600">{stats.paid}</p>
                    <p className="text-xs text-gray-500 mt-1">Comisiones pagadas</p>
                </div>
                <div className="bg-white rounded-2xl border border-gray-200 p-4">
                    <p className="text-2xl font-bold text-gray-900">{stats.freeMonths}</p>
                    <p className="text-xs text-gray-500 mt-1">Meses gratis otorgados</p>
                </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                {referrals.length === 0 ? (
                    <p className="text-sm text-gray-500 py-10 text-center">Todavía no hay referidos registrados.</p>
                ) : (
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-gray-500 text-xs uppercase font-bold">
                            <tr>
                                <th className="text-left px-4 py-3">Referidor</th>
                                <th className="text-left px-4 py-3">Referido</th>
                                <th className="text-left px-4 py-3">Plan</th>
                                <th className="text-left px-4 py-3">Recompensa</th>
                                <th className="text-left px-4 py-3">Estado</th>
                                <th className="text-left px-4 py-3">Fecha</th>
                                <th className="text-right px-4 py-3">Acción</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {referrals.map((r) => {
                                const s = statusStyles[statusKeyFor(r)]
                                const Icon = s.icon
                                const canPay = r.status === 'qualified' && r.reward_type === 'cash_commission'
                                return (
                                    <tr key={r.id}>
                                        <td className="px-4 py-3 font-medium text-gray-900">{r.referrer_name}</td>
                                        <td className="px-4 py-3 text-gray-700">{r.referred_name}</td>
                                        <td className="px-4 py-3 text-gray-500 capitalize">{r.referred_plan || '—'}</td>
                                        <td className="px-4 py-3 text-gray-700">
                                            {r.reward_type === 'free_months' && r.reward_amount ? `${r.reward_amount} meses gratis` : null}
                                            {r.reward_type === 'cash_commission' && r.reward_amount ? `${r.reward_amount.toLocaleString()} ${r.reward_currency}` : null}
                                            {!r.reward_type ? '—' : null}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold', s.bg, s.text)}>
                                                <Icon className="w-3.5 h-3.5" />
                                                {s.label}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-gray-500">{new Date(r.created_at).toLocaleDateString('es-CL')}</td>
                                        <td className="px-4 py-3 text-right">
                                            {canPay && (
                                                <button
                                                    onClick={() => handleMarkPaid(r.id)}
                                                    disabled={paying === r.id}
                                                    className="px-3 py-1.5 rounded-lg bg-primary-500 text-white text-xs font-bold hover:bg-primary-600 transition-colors disabled:opacity-50"
                                                >
                                                    {paying === r.id ? 'Guardando...' : 'Marcar como pagado'}
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    )
}
