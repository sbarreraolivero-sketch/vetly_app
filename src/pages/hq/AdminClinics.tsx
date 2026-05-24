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
    totalRealUsed: number
    totalLimit: number
    totalExtra: number
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

    const [usageMap, setUsageMap] = useState<Record<string, number>>({})

    const fetchClinics = useCallback(async () => {
        setLoading(true)
        try {
            const { data: { session } } = await supabase.auth.getSession()
            if (!session?.access_token) return

            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
            const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

            const [settingsRes, usageRes] = await Promise.all([
                fetch(
                    `${supabaseUrl}/rest/v1/clinic_settings?select=*,clinic_members(email,role,first_name)&order=created_at.desc`,
                    {
                        headers: {
                            'apikey': supabaseKey,
                            'Authorization': `Bearer ${session.access_token}`,
                            'Content-Type': 'application/json',
                        },
                    }
                ),
                (supabase as any).rpc('get_monthly_credit_usage_all_clinics'),
            ])

            if (!settingsRes.ok) throw new Error(`Error ${settingsRes.status}`)
            const data = await settingsRes.json()
            setClinics((data as ClinicData[]).filter(c => c.id !== HQ_ID))

            const map: Record<string, number> = {}
            for (const row of (usageRes.data || [])) {
                map[row.clinic_id] = Number(row.total_credits)
            }
            setUsageMap(map)
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
                        totalRealUsed: 0,
                        totalLimit: 0,
                        totalExtra: 0,
                    }
                }
                const g = acc[key]
                g.clinics.push(clinic)
                g.totalRealUsed += usageMap[clinic.id] || 0
                g.totalLimit += clinic.ai_credits_monthly_limit || 0
                g.totalExtra += clinic.ai_credits_extra_balance || 0
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
            {/* Banner */}
            <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-[2rem] px-6 py-5 text-white shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-1/3 h-full bg-primary-500/10 blur-[80px] -z-0" />
                <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <span className="px-2.5 py-0.5 bg-primary-500/20 text-primary-400 text-[9px] font-black uppercase tracking-widest rounded-full border border-primary-500/30 mb-2 inline-block">HQ Exclusive</span>
                        <h1 className="text-2xl font-black tracking-tight text-white leading-none">HQ Clínicas</h1>
                        <p className="text-gray-400 font-medium text-xs mt-1">
                            {clinicGroups.length} cliente{clinicGroups.length !== 1 ? 's' : ''} · {clinics.length} sucursal{clinics.length !== 1 ? 'es' : ''} · Consumo IA en tiempo real
                        </p>
                    </div>
                    <div className="flex gap-2 flex-wrap items-center">
                        <div className="relative group">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 group-focus-within:text-white transition-all" />
                            <input
                                type="text"
                                placeholder="Buscar clínica o dueño..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl focus:bg-white/10 focus:ring-2 focus:ring-primary-500/20 transition-all text-white placeholder:text-white/20 font-bold text-sm outline-none"
                            />
                        </div>
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest outline-none text-white cursor-pointer"
                        >
                            <option value="all" className="bg-gray-900">Todos</option>
                            <option value="active" className="bg-gray-900">Activas</option>
                            <option value="pending_activation" className="bg-gray-900">Pendientes</option>
                        </select>
                        <button onClick={fetchClinics} className="p-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all text-white/60 hover:text-white">
                            <RefreshCw className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {clinicGroups.map((group) => {
                    const { primaryClinic, clinics: branches } = group
                    const isMultiBranch = branches.length > 1
                    const groupKey = group.ownerEmail

                    // Strip common prefix from branch names for compact labels
                    const commonPrefix = isMultiBranch
                        ? branches[0].clinic_name.split(' ').filter((word, i) =>
                            branches.every(b => b.clinic_name.split(' ')[i] === word)
                        ).join(' ')
                        : ''
                    const branchLabel = (b: ClinicData) => {
                        const label = commonPrefix ? b.clinic_name.slice(commonPrefix.length).trim() : b.clinic_name
                        return label || b.clinic_name
                    }

                    const chargeAmount = chargeAmounts[groupKey] ?? 500
                    const chargeTarget = chargeTargets[groupKey] ?? primaryClinic.id

                    const totalPool = group.totalLimit + group.totalExtra
                    const usedPct = Math.round((group.totalRealUsed / (totalPool || 1)) * 100)
                    const barColor = usedPct >= 100 ? 'bg-red-500' : usedPct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'

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
                            <div className="space-y-4 p-6 bg-gray-50 rounded-[1.8rem] border border-gray-50 shadow-inner">
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

                                <div className="space-y-2">
                                    <div className="flex justify-between items-end">
                                        <p className="text-[10px] font-black text-gray-500 uppercase tracking-tighter">Consumo real del mes</p>
                                        <p className="text-[10px] font-bold text-gray-500">
                                            <span className={cn("font-black text-sm", usedPct >= 100 ? "text-red-600" : "text-gray-900")}>
                                                {group.totalRealUsed.toLocaleString()}
                                            </span>
                                            <span className="text-gray-400"> / {totalPool.toLocaleString()}</span>
                                        </p>
                                    </div>
                                    <div className="h-3 w-full bg-gray-200 rounded-full overflow-hidden">
                                        <div
                                            className={cn("h-full transition-all duration-1000", barColor)}
                                            style={{ width: `${Math.min(100, usedPct)}%` }}
                                        />
                                    </div>
                                    <div className="flex justify-between">
                                        <p className="text-[9px] text-gray-400 font-bold">
                                            {group.totalLimit.toLocaleString()} plan
                                            {group.totalExtra > 0 && ` · ${group.totalExtra.toLocaleString()} extra`}
                                        </p>
                                        <p className={cn("text-[9px] font-black", usedPct >= 100 ? "text-red-500" : usedPct >= 80 ? "text-amber-500" : "text-emerald-600")}>
                                            {usedPct}% usado
                                        </p>
                                    </div>
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
                                                    {branchLabel(b)}
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
