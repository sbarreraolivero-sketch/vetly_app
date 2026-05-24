import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
    Search,
    Loader2, RefreshCw, CreditCard,
    Sparkles, Plus, GitBranch
} from 'lucide-react'
import { cn } from '@/lib/utils'

const HQ_ID = '00000000-0000-0000-0000-000000000000'

interface ClinicData {
    id: string
    clinic_name: string
    created_at: string
    activation_status: string
    subscription_plan: string
    trial_status: string
    billing_status: string
    currency: string
    timezone: string
    ai_active_model: string
    ai_credits_monthly_mini_used: number
    ai_credits_monthly_limit: number
    ai_credits_extra_balance: number
    ai_credits_monthly_4o_used: number
    ai_credits_monthly_4o_limit: number
    ai_credits_extra_4o: number
    clinic_members?: {
        email: string
        first_name: string | null
        role: string
    }[]
}

interface ClinicGroup {
    ownerEmail: string
    ownerName: string | null
    primaryClinic: ClinicData
    clinics: ClinicData[]
    totalMiniUsed: number
    totalMiniLimit: number
    totalMiniExtra: number
    total4oUsed: number
    total4oLimit: number
    total4oExtra: number
}

const statusColors: Record<string, { bg: string; text: string; border: string; label: string }> = {
    active: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-100', label: 'Activa' },
    pending_activation: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-100', label: 'Pendiente' },
    inactive: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-100', label: 'Inactiva' },
}

export default function AdminClinics() {
    const [clinics, setClinics] = useState<ClinicData[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [statusFilter, setStatusFilter] = useState<string>('all')

    const [charging, setCharging] = useState<string | null>(null)
    const [chargeAmounts, setChargeAmounts] = useState<Record<string, number>>({})
    const [chargeTargets, setChargeTargets] = useState<Record<string, string>>({})

    const fetchClinics = useCallback(async () => {
        setLoading(true)
        try {
            const { data: { session } } = await supabase.auth.getSession()
            if (!session?.access_token) return

            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
            const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

            const response = await fetch(
                `${supabaseUrl}/rest/v1/clinic_settings?select=*,clinic_members(email,role,first_name)&order=created_at.desc`,
                {
                    headers: {
                        'apikey': supabaseKey,
                        'Authorization': `Bearer ${session.access_token}`,
                        'Content-Type': 'application/json',
                    },
                }
            )

            if (!response.ok) throw new Error(`Error ${response.status}`)
            const data = await response.json()
            setClinics((data as ClinicData[]).filter(c => c.id !== HQ_ID))
        } catch (err: any) {
            console.error('Error fetching clinics:', err)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { fetchClinics() }, [fetchClinics])

    const handleManualCharge = async (groupKey: string, clinicId: string) => {
        const amount = chargeAmounts[groupKey] ?? 500
        if (!confirm(`¿Cargar ${amount} créditos IA?`)) return

        setCharging(groupKey)
        try {
            const clinic = clinics.find(c => c.id === clinicId)
            const currentVal = clinic?.ai_credits_extra_balance || 0

            const { error } = await (supabase.from('clinic_settings') as any)
                .update({ ai_credits_extra_balance: currentVal + amount })
                .eq('id', clinicId)

            if (error) throw error
            alert('✅ Créditos cargados.')
            fetchClinics()
        } catch (err: any) {
            alert('Error: ' + err.message)
        } finally {
            setCharging(null)
        }
    }

    // Group clinics by owner email
    const clinicGroups: ClinicGroup[] = Object.values(
        clinics
            .filter(c => {
                const matchesSearch = !search ||
                    c.clinic_name?.toLowerCase().includes(search.toLowerCase()) ||
                    c.clinic_members?.some(m => m.email?.toLowerCase().includes(search.toLowerCase()))
                const matchesStatus = statusFilter === 'all' || c.activation_status === statusFilter
                return matchesSearch && matchesStatus
            })
            .reduce((acc, clinic) => {
                const owner = clinic.clinic_members?.find(m => m.role === 'owner')
                const key = owner?.email || clinic.id
                if (!acc[key]) {
                    acc[key] = {
                        ownerEmail: key,
                        ownerName: owner?.first_name || null,
                        primaryClinic: clinic,
                        clinics: [],
                        totalMiniUsed: 0,
                        totalMiniLimit: 0,
                        totalMiniExtra: 0,
                        total4oUsed: 0,
                        total4oLimit: 0,
                        total4oExtra: 0,
                    }
                }
                const g = acc[key]
                g.clinics.push(clinic)
                g.totalMiniUsed += clinic.ai_credits_monthly_mini_used || 0
                g.totalMiniLimit += clinic.ai_credits_monthly_limit || 0
                g.totalMiniExtra += clinic.ai_credits_extra_balance || 0
                g.total4oUsed += clinic.ai_credits_monthly_4o_used || 0
                g.total4oLimit += clinic.ai_credits_monthly_4o_limit || 0
                g.total4oExtra += clinic.ai_credits_extra_4o || 0
                if ((clinic.ai_credits_monthly_limit || 0) > (g.primaryClinic.ai_credits_monthly_limit || 0)) {
                    g.primaryClinic = clinic
                }
                return acc
            }, {} as Record<string, ClinicGroup>)
    )

    const getStatusBadge = (status: string) => {
        const s = statusColors[status] || statusColors.inactive
        return (
            <span className={cn(
                "inline-flex items-center px-3 py-1 rounded-full text-[10px] font-black border uppercase tracking-widest",
                s.bg, s.text, s.border
            )}>
                {s.label}
            </span>
        )
    }

    const modelLabel: Record<string, string> = {
        hybrid: 'Híbrido', mini: 'Mini', pro: 'Pro (4o)',
        'gpt-4o': 'Pro (4o)', 'gpt-4o-mini': 'Mini', '4o': 'Pro (4o)',
    }

    if (loading) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-20">
                <Loader2 className="w-10 h-10 animate-spin text-primary-500 mb-4" />
                <p className="text-gray-500 font-bold tracking-tight">Sincronizando Sistema...</p>
            </div>
        )
    }

    return (
        <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-black text-gray-900 tracking-tight">HQ Clínicas</h1>
                    <p className="text-sm text-gray-500 font-medium font-outfit uppercase tracking-widest mt-1 opacity-60">
                        {clinicGroups.length} cliente{clinicGroups.length !== 1 ? 's' : ''} · {clinics.length} sucursal{clinics.length !== 1 ? 'es' : ''}
                    </p>
                </div>
                <button onClick={fetchClinics} className="p-4 bg-white border border-gray-100 rounded-[1.5rem] hover:bg-primary-50 transition-all text-gray-400 hover:text-primary-600 shadow-sm active:scale-90">
                    <RefreshCw className="w-5 h-5" />
                </button>
            </div>

            <div className="bg-white p-4 rounded-[2rem] border border-gray-100 shadow-sm flex flex-col md:flex-row gap-4">
                <div className="relative flex-1">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Buscar clínica o dueño..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full pl-12 pr-4 py-4 bg-gray-50 border-none rounded-2xl text-sm font-bold focus:bg-white focus:ring-4 focus:ring-primary-500/5 transition-all outline-none"
                    />
                </div>
                <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="px-6 py-4 bg-gray-50 border-none rounded-2xl text-[10px] font-black uppercase tracking-widest outline-none focus:ring-2 focus:ring-primary-100 cursor-pointer"
                >
                    <option value="all">TODOS</option>
                    <option value="active">ACTIVAS</option>
                    <option value="pending_activation">PENDIENTES</option>
                </select>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {clinicGroups.map((group) => {
                    const { primaryClinic, clinics: branches } = group
                    const isMultiBranch = branches.length > 1
                    const groupKey = group.ownerEmail

                    const chargeAmount = chargeAmounts[groupKey] ?? 500
                    const chargeTarget = chargeTargets[groupKey] ?? primaryClinic.id

                    const miniTotal = group.totalMiniLimit + group.totalMiniExtra
                    const miniPercent = Math.min(100, Math.round((group.totalMiniUsed / (miniTotal || 1)) * 100))

                    const fTotal = group.total4oLimit + group.total4oExtra
                    const fPercent = Math.min(100, Math.round((group.total4oUsed / (fTotal || 1)) * 100))

                    const allActive = branches.every(c => c.activation_status === 'active')
                    const anyStatus = allActive ? 'active' : branches[0]?.activation_status

                    const activeModels = [...new Set(branches.map(c => modelLabel[c.ai_active_model] ?? c.ai_active_model ?? 'Híbrido'))]
                    const activeModelLabel = activeModels.join(' · ')
                    const isProModel = branches.some(c => c.ai_active_model === 'pro' || c.ai_active_model === 'gpt-4o' || c.ai_active_model === '4o')

                    return (
                        <div key={groupKey} className="group bg-white rounded-[2.5rem] border border-gray-100 p-8 flex flex-col gap-6 shadow-sm hover:shadow-2xl hover:-translate-y-1 transition-all duration-500">
                            {/* Header */}
                            <div className="flex items-start justify-between">
                                <div className="flex items-center gap-5">
                                    <div className="w-16 h-16 rounded-[1.5rem] bg-gray-900 flex items-center justify-center text-white font-black text-2xl shadow-xl border-4 border-white">
                                        {primaryClinic.clinic_name?.[0].toUpperCase()}
                                    </div>
                                    <div className="min-w-0">
                                        <h3 className="text-xl font-black text-gray-900 truncate tracking-tight mb-1">
                                            {isMultiBranch
                                                ? primaryClinic.clinic_name.replace(/\s*(Santiago|Linares.*|Talca.*)/i, '').trim() || primaryClinic.clinic_name
                                                : primaryClinic.clinic_name
                                            }
                                        </h3>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            {getStatusBadge(anyStatus)}
                                            {isMultiBranch && (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full text-[9px] font-black border border-blue-100 uppercase tracking-widest">
                                                    <GitBranch className="w-2.5 h-2.5" />
                                                    {branches.length} sucursales
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Branch chips (multi-branch only) */}
                            {isMultiBranch && (
                                <div className="flex flex-wrap gap-2">
                                    {branches.map(b => (
                                        <span key={b.id} className="px-3 py-1.5 bg-gray-50 border border-gray-100 rounded-xl text-[10px] font-bold text-gray-600">
                                            {b.clinic_name}
                                        </span>
                                    ))}
                                </div>
                            )}

                            {/* Info grid */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-4 bg-gray-50 rounded-2xl">
                                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Dueño</p>
                                    <p className="text-xs font-bold text-gray-800 truncate">{group.ownerEmail}</p>
                                </div>
                                <div className="p-4 bg-blue-50/30 border border-blue-50 rounded-2xl">
                                    <p className="text-[9px] font-black text-blue-400 uppercase tracking-widest mb-1">Plan</p>
                                    <div className="flex items-center gap-1.5 font-black text-blue-700 uppercase text-xs">
                                        <CreditCard className="w-3 h-3" />
                                        {primaryClinic.subscription_plan}
                                    </div>
                                </div>
                            </div>

                            {/* Credits metrics */}
                            <div className="space-y-5 p-6 bg-gray-50 rounded-[1.8rem] border border-gray-50 shadow-inner">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                        <Sparkles className="w-4 h-4 text-primary-500" />
                                        Créditos IA — Mes Actual
                                    </h4>
                                    <div className={cn(
                                        "px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest shadow-sm",
                                        isProModel ? "bg-primary-600 text-white" : "bg-emerald-500 text-white"
                                    )}>
                                        {activeModelLabel}
                                    </div>
                                </div>

                                {/* Mini / universal credits */}
                                <div className="space-y-2">
                                    <div className="flex justify-between items-end">
                                        <p className="text-[10px] font-black text-emerald-600 uppercase tracking-tighter">Mini (estándar)</p>
                                        <p className="text-[10px] font-bold text-gray-500">
                                            <span className={cn("font-black", group.totalMiniUsed > group.totalMiniLimit ? "text-red-600" : "text-gray-900")}>
                                                {group.totalMiniUsed.toLocaleString()}
                                            </span>
                                            {' '}/ {miniTotal.toLocaleString()}
                                        </p>
                                    </div>
                                    <div className="h-3 w-full bg-emerald-100 rounded-full overflow-hidden">
                                        <div
                                            className={cn("h-full transition-all duration-1000", miniPercent >= 100 ? "bg-red-500" : miniPercent >= 80 ? "bg-amber-500" : "bg-emerald-500")}
                                            style={{ width: `${miniPercent}%` }}
                                        />
                                    </div>
                                    <p className="text-[9px] text-gray-400 font-bold">
                                        {group.totalMiniLimit.toLocaleString()} incluidos
                                        {group.totalMiniExtra > 0 && ` · ${group.totalMiniExtra.toLocaleString()} extra`}
                                    </p>
                                </div>

                                {/* 4o credits */}
                                <div className="space-y-2 pt-3 border-t border-gray-200/40">
                                    <div className="flex justify-between items-end">
                                        <p className="text-[10px] font-black text-primary-600 uppercase tracking-tighter">4o (avanzado)</p>
                                        <p className="text-[10px] font-bold text-gray-500">
                                            <span className={cn("font-black", group.total4oUsed > group.total4oLimit ? "text-red-600" : "text-gray-900")}>
                                                {group.total4oUsed.toLocaleString()}
                                            </span>
                                            {' '}/ {fTotal.toLocaleString()}
                                        </p>
                                    </div>
                                    <div className="h-3 w-full bg-primary-100 rounded-full overflow-hidden">
                                        <div
                                            className={cn("h-full transition-all duration-1000", fPercent >= 100 ? "bg-red-500" : fPercent >= 80 ? "bg-amber-500" : "bg-primary-600")}
                                            style={{ width: `${fPercent}%` }}
                                        />
                                    </div>
                                    <p className="text-[9px] text-gray-400 font-bold">
                                        {group.total4oLimit.toLocaleString()} incluidos
                                        {group.total4oExtra > 0 && ` · ${group.total4oExtra.toLocaleString()} extra`}
                                    </p>
                                </div>
                            </div>

                            {/* Credit injection */}
                            <div className="pt-4 border-t border-gray-50 space-y-3">
                                <h5 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Inyección de Créditos IA</h5>
                                <div className="flex gap-3">
                                    {isMultiBranch && (
                                        <select
                                            value={chargeTarget}
                                            onChange={(e) => setChargeTargets(prev => ({ ...prev, [groupKey]: e.target.value }))}
                                            className="bg-gray-50 rounded-xl px-3 text-[10px] font-black uppercase outline-none focus:ring-2 focus:ring-primary-500/20 border-none"
                                        >
                                            {branches.map(b => (
                                                <option key={b.id} value={b.id}>
                                                    {b.clinic_name.split(' ').slice(-1)[0]}
                                                </option>
                                            ))}
                                        </select>
                                    )}
                                    <input
                                        type="number"
                                        value={chargeAmount}
                                        onChange={(e) => setChargeAmounts(prev => ({ ...prev, [groupKey]: Number(e.target.value) }))}
                                        className="flex-1 bg-gray-50 rounded-xl px-4 py-3 text-sm font-bold outline-none border-none focus:bg-white shadow-inner transition-all"
                                    />
                                    <button
                                        onClick={() => handleManualCharge(groupKey, chargeTarget)}
                                        disabled={charging === groupKey}
                                        className="bg-gray-900 text-white px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-primary-600 transition-all disabled:bg-gray-200 flex items-center gap-2"
                                    >
                                        {charging === groupKey ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                                        Cargar
                                    </button>
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
