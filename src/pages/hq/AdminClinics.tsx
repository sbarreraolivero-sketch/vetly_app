import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
    Search, Building2, Users, Shield, ChevronUp,
    CheckCircle, Clock, XCircle, Loader2, RefreshCw, CreditCard, Eye,
    Sparkles, Plus, MoreVertical, ExternalLink
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface ClinicData {
    id: string
    clinic_name: string
    created_at: string
    activation_status: string
    subscription_plan: string
    trial_status: string
    billing_status: string
    trial_start_date: string | null
    trial_end_date: string | null
    currency: string
    timezone: string
    ai_credits_monthly_limit: number
    ai_credits_extra_balance: number
    ai_credits_extra_4o: number
    ai_active_model: string
    clinic_members: {
        id: string
        email: string
        first_name: string | null
        last_name: string | null
        role: string
        status: string
    }[]
    subscriptions: {
        plan: string
        status: string
        current_period_end: string | null
        trial_ends_at: string | null
    }[]
}

const statusColors: Record<string, { bg: string; text: string; border: string; label: string }> = {
    active: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-100', label: 'Activa' },
    pending_activation: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-100', label: 'Pendiente' },
    inactive: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-100', label: 'Inactiva' },
}

const planLabels: Record<string, string> = {
    basic: 'Basic',
    essence: 'Essence',
    radiance: 'Radiance',
    prestige: 'Prestige',
    trial: 'Trial',
}

export default function AdminClinics() {
    const [clinics, setClinics] = useState<ClinicData[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [statusFilter, setStatusFilter] = useState<string>('all')
    const [expandedClinic, setExpandedClinic] = useState<string | null>(null)

    const fetchClinics = useCallback(async () => {
        setLoading(true)
        try {
            const { data: { session } } = await supabase.auth.getSession()
            if (!session?.access_token) return

            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
            const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

            const response = await fetch(
                `${supabaseUrl}/rest/v1/clinic_settings?select=*,clinic_members(id,email,first_name,last_name,role,status),subscriptions(plan,status,current_period_end,trial_ends_at)&order=created_at.desc`,
                {
                    headers: {
                        'apikey': supabaseKey,
                        'Authorization': `Bearer ${session.access_token}`,
                        'Content-Type': 'application/json',
                    },
                }
            )

            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const data = await response.json()
            setClinics(data as ClinicData[])
        } catch (err) {
            console.error('Error fetching clinics:', err)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchClinics()
    }, [fetchClinics])

    const filteredClinics = clinics.filter(c => {
        const matchesSearch = !search ||
            c.clinic_name?.toLowerCase().includes(search.toLowerCase()) ||
            c.clinic_members?.some(m => m.email?.toLowerCase().includes(search.toLowerCase()))
        const matchesStatus = statusFilter === 'all' || c.activation_status === statusFilter
        return matchesSearch && matchesStatus
    })

    const getOwner = (clinic: ClinicData) => {
        return clinic.clinic_members?.find(m => m.role === 'owner')
    }

    const getStatusBadge = (status: string) => {
        const s = statusColors[status] || statusColors.inactive
        return (
            <span className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border shadow-sm",
                s.bg, s.text, s.border
            )}>
                {status === 'active' && <CheckCircle className="w-3.5 h-3.5" />}
                {status === 'pending_activation' && <Clock className="w-3.5 h-3.5" />}
                {status === 'inactive' && <XCircle className="w-3.5 h-3.5" />}
                {s.label}
            </span>
        )
    }

    const stats = {
        total: clinics.length,
        active: clinics.filter(c => c.activation_status === 'active').length,
        pending: clinics.filter(c => c.activation_status === 'pending_activation').length,
        inactive: clinics.filter(c => c.activation_status === 'inactive').length,
    }

    if (loading) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center h-full p-20">
                <div className="relative">
                    <div className="w-16 h-16 border-4 border-primary-100 rounded-full animate-pulse" />
                    <Loader2 className="w-8 h-8 animate-spin text-primary-500 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                </div>
                <p className="mt-4 text-gray-500 font-medium animate-pulse">Cargando clínicas...</p>
            </div>
        )
    }

    return (
        <div className="p-4 lg:p-8 space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl lg:text-3xl font-black text-gray-900 tracking-tight">Clínicas</h1>
                <p className="text-sm text-gray-500 mt-1 font-medium">Control global de la red Vetly AI.</p>
            </div>

            {/* Stats Cards - Horizontal Scroll en Móvil */}
            <div className="flex lg:grid lg:grid-cols-4 gap-4 overflow-x-auto pb-2 -mx-4 px-4 lg:mx-0 lg:px-0 scrollbar-none">
                {[
                    { label: 'Total', count: stats.total, icon: Building2, color: 'blue' },
                    { label: 'Activas', count: stats.active, icon: CheckCircle, color: 'emerald' },
                    { label: 'Pendientes', count: stats.pending, icon: Clock, color: 'amber' },
                    { label: 'Inactivos', count: stats.inactive, icon: XCircle, color: 'red' },
                ].map((stat) => (
                    <div key={stat.label} className="min-w-[150px] flex-1 bg-white rounded-2xl border border-gray-200 p-4 shadow-sm hover:shadow-md transition-all duration-300">
                        <div className="flex items-center gap-3">
                            <div className={cn("p-2 rounded-xl", `bg-${stat.color}-50`)}>
                                <stat.icon className={cn("w-5 h-5", `text-${stat.color}-600`)} />
                            </div>
                            <div>
                                <p className="text-xl font-black text-gray-900 leading-none">{stat.count}</p>
                                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mt-1">{stat.label}</p>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Filters */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
                <div className="flex flex-col md:flex-row gap-4">
                    <div className="relative flex-1">
                        <Search className="absolute left-3.5 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Buscar clínica o email..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full pl-11 pr-4 py-3 border border-gray-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all"
                        />
                    </div>
                    <div className="flex gap-2">
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="flex-1 md:w-48 px-4 py-3 border border-gray-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary-500/20 bg-gray-50/50"
                        >
                            <option value="all">Filtro: Todos</option>
                            <option value="active">Activas</option>
                            <option value="pending_activation">Pendientes</option>
                            <option value="inactive">Inactivas</option>
                        </select>
                        <button
                            onClick={fetchClinics}
                            className="p-3 text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-all border border-gray-200 shadow-sm active:scale-95"
                        >
                            <RefreshCw className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Mobile Cards / Desktop Table */}
            <div className="space-y-4">
                {/* Desktop Header (Hidden on Mobile) */}
                <div className="hidden lg:grid grid-cols-12 gap-4 px-6 py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest bg-gray-50/50 rounded-t-2xl border-x border-t border-gray-200">
                    <div className="col-span-4">Clínica / ID</div>
                    <div className="col-span-3">Owner / Contacto</div>
                    <div className="col-span-2 text-center">Plan</div>
                    <div className="col-span-2 text-center">Estado</div>
                    <div className="col-span-1 text-right">Opciones</div>
                </div>

                {filteredClinics.length === 0 ? (
                    <div className="bg-white rounded-2xl border border-gray-200 p-20 text-center shadow-sm">
                        <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Building2 className="w-8 h-8 text-gray-300" />
                        </div>
                        <p className="text-gray-500 font-bold">No se encontraron resultados.</p>
                    </div>
                ) : (
                    filteredClinics.map((clinic) => {
                        const owner = getOwner(clinic)
                        const isExpanded = expandedClinic === clinic.id
                        return (
                            <div 
                                key={clinic.id} 
                                className={cn(
                                    "bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm transition-all duration-300 hover:border-primary-500/30",
                                    isExpanded ? "ring-2 ring-primary-500/5 shadow-lg" : "hover:shadow-md"
                                )}
                            >
                                {/* Base Item */}
                                <div className="p-4 lg:p-0 lg:grid lg:grid-cols-12 lg:items-center">
                                    {/* Info Clínica */}
                                    <div className="lg:col-span-4 lg:px-6 lg:py-5 flex items-center mb-4 lg:mb-0">
                                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary-50 to-primary-100 flex items-center justify-center mr-4 shrink-0 shadow-inner group">
                                            <Building2 className="w-6 h-6 text-primary-600 group-hover:scale-110 transition-transform" />
                                        </div>
                                        <div className="min-w-0">
                                            <h3 className="text-sm font-black text-gray-900 truncate leading-tight">{clinic.clinic_name || 'Sin nombre'}</h3>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <span className="text-[10px] font-bold text-gray-400 font-mono tracking-tighter bg-gray-50 px-1.5 rounded">{clinic.id.slice(0, 13)}...</span>
                                                <span className="text-[10px] text-gray-400 font-medium">• {new Date(clinic.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Owner - Hidden Label on Desktop */}
                                    <div className="lg:col-span-3 lg:px-6 lg:py-5 mb-4 lg:mb-0 border-t lg:border-t-0 pt-4 lg:pt-5">
                                        <div className="flex items-center lg:block">
                                            <div className="lg:hidden text-[10px] font-black text-gray-400 uppercase w-20 shrink-0">Dueño:</div>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-bold text-gray-700 truncate">{owner?.email || 'Pendiente'}</p>
                                                <p className="text-xs text-gray-400 font-medium capitalize">{owner?.first_name || 'N/A'}</p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Plan */}
                                    <div className="lg:col-span-2 lg:px-6 lg:py-5 mb-4 lg:mb-0 lg:text-center shrink-0">
                                        <div className="flex items-center lg:justify-center">
                                            <div className="lg:hidden text-[10px] font-black text-gray-400 uppercase w-20 shrink-0">Plan:</div>
                                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-indigo-50 text-indigo-700 text-[10px] font-black uppercase tracking-wider border border-indigo-100 shadow-sm">
                                                <CreditCard className="w-3 h-3" />
                                                {planLabels[clinic.subscription_plan] || clinic.subscription_plan}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Estado */}
                                    <div className="lg:col-span-2 lg:px-6 lg:py-5 mb-4 lg:mb-0 lg:text-center shrink-0">
                                        <div className="flex items-center lg:justify-center">
                                            <div className="lg:hidden text-[10px] font-black text-gray-400 uppercase w-20 shrink-0">Estado:</div>
                                            {getStatusBadge(clinic.activation_status)}
                                        </div>
                                    </div>

                                    {/* Detalle Trigger */}
                                    <div className="lg:col-span-1 lg:px-6 lg:py-5 text-right flex justify-end gap-2 pt-4 lg:pt-5 border-t lg:border-t-0 border-gray-100">
                                        <button
                                            onClick={() => setExpandedClinic(isExpanded ? null : clinic.id)}
                                            className={cn(
                                                "p-2.5 rounded-xl transition-all active:scale-95 shadow-sm border",
                                                isExpanded ? "bg-primary-500 text-white border-primary-600" : "bg-white text-gray-400 hover:text-gray-600 border-gray-200"
                                            )}
                                        >
                                            <Eye className="w-5 h-5 lg:w-4 lg:h-4" />
                                        </button>
                                        <button className="p-2.5 lg:hidden bg-gray-50 border border-gray-200 rounded-xl text-gray-400">
                                            <MoreVertical className="w-5 h-5" />
                                        </button>
                                    </div>
                                </div>

                                {/* Expanded Content */}
                                {isExpanded && (
                                    <div className="bg-gray-50/50 border-t border-gray-100 p-4 lg:p-6 space-y-6">
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                            {/* Subscription Card */}
                                            <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm">
                                                <div className="flex items-center justify-between mb-4">
                                                    <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                                        <CreditCard className="w-3.5 h-3.5" /> Suscripción
                                                    </h4>
                                                    <ExternalLink className="w-3.5 h-3.5 text-gray-300" />
                                                </div>
                                                <div className="space-y-3">
                                                    <div className="flex justify-between items-center bg-gray-50 p-2 rounded-lg">
                                                        <span className="text-xs text-gray-500 font-bold">Plan</span>
                                                        <span className="text-sm font-black text-primary-600 uppercase">{planLabels[clinic.subscription_plan] || clinic.subscription_plan}</span>
                                                    </div>
                                                    {[
                                                        { label: 'Trial', val: clinic.trial_status?.replace('_', ' ') },
                                                        { label: 'Facturación', val: clinic.billing_status?.replace('_', ' ') },
                                                        { label: 'Moneda', val: clinic.currency || 'USD' },
                                                    ].map(row => (
                                                        <div key={row.label} className="flex justify-between items-center px-2">
                                                            <span className="text-xs text-gray-400 font-bold uppercase tracking-tight">{row.label}</span>
                                                            <span className="text-xs font-bold text-gray-700 capitalize">{row.val}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Team Card */}
                                            <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm flex flex-col">
                                                <div className="flex items-center justify-between mb-4">
                                                    <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                                        <Users className="w-3.5 h-3.5" /> Equipo ({clinic.clinic_members?.length || 0})
                                                    </h4>
                                                </div>
                                                <div className="space-y-2 flex-1 overflow-y-auto max-h-[160px] scrollbar-thin">
                                                    {clinic.clinic_members?.map((member) => (
                                                        <div key={member.id} className="flex items-center justify-between p-2 rounded-xl border border-gray-50 bg-gray-50/30 group hover:border-primary-100 transition-colors">
                                                            <div className="min-w-0">
                                                                <p className="text-[10px] font-black text-gray-800 truncate">{member.email}</p>
                                                                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter mt-0.5">{member.role}</p>
                                                            </div>
                                                            <div className={cn(
                                                                "w-2 h-2 rounded-full shrink-0",
                                                                member.status === 'active' ? "bg-emerald-400" : "bg-gray-300"
                                                            )} />
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Tech Card */}
                                            <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm">
                                                <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                                    <Shield className="w-3.5 h-3.5" /> Setup Técnico
                                                </h4>
                                                <div className="space-y-4">
                                                    <div className="bg-gray-900 rounded-xl p-3">
                                                        <p className="text-[9px] text-gray-500 font-black uppercase mb-1">Clinic ID</p>
                                                        <p className="text-[10px] text-primary-400 font-mono break-all">{clinic.id}</p>
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-4 h-full">
                                                        <div className="bg-blue-50/50 p-2 rounded-xl border border-blue-100">
                                                            <p className="text-[9px] text-blue-400 font-black uppercase">Zona Horaria</p>
                                                            <p className="text-[10px] font-bold text-blue-900 truncate tracking-tight">{clinic.timezone || 'UTC'}</p>
                                                        </div>
                                                        <div className="bg-purple-50/50 p-2 rounded-xl border border-purple-100">
                                                            <p className="text-[9px] text-purple-400 font-black uppercase">Registro</p>
                                                            <p className="text-[10px] font-bold text-purple-900">{new Date(clinic.created_at).toLocaleDateString()}</p>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* AI Panel - Full width on lg */}
                                            <div className="lg:col-span-3 bg-white rounded-2xl p-5 border border-gray-200 shadow-md ring-4 ring-primary-50/30">
                                                <div className="flex items-center gap-2 mb-6">
                                                    <div className="p-2 bg-gradient-to-br from-primary-500 to-primary-700 rounded-xl shadow-lg shadow-primary-500/20">
                                                        <Sparkles className="w-4 h-4 text-white" />
                                                    </div>
                                                    <div>
                                                        <h4 className="text-xs font-black text-gray-900 uppercase tracking-widest">IA Usage Intelligence</h4>
                                                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tight">Análisis y recarga de créditos globales</p>
                                                    </div>
                                                </div>
                                                <AdminAIUsage 
                                                    clinicId={clinic.id} 
                                                    monthlyLimit={clinic.ai_credits_monthly_limit} 
                                                    extraBalance={clinic.ai_credits_extra_balance} 
                                                    extraBalance4o={clinic.ai_credits_extra_4o} 
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )
                    })
                )}
            </div>
        </div>
    )
}

function AdminAIUsage({ clinicId, monthlyLimit, extraBalance, extraBalance4o }: { clinicId: string, monthlyLimit: number, extraBalance: number, extraBalance4o: number }) {
    const [usedMini, setUsedMini] = useState<number | null>(null)
    const [used4o, setUsed4o] = useState<number | null>(null)
    const [loading, setLoading] = useState(true)
    const [isUpdating, setIsUpdating] = useState(false)
    const [currentExtraMini, setCurrentExtraMini] = useState(extraBalance || 0)
    const [currentExtra4o, setCurrentExtra4o] = useState(extraBalance4o || 0)
    const [addAmount, setAddAmount] = useState('500')
    const [chargeTarget, setChargeTarget] = useState<'mini' | '4o'>('mini')

    useEffect(() => {
        const fetchUsage = async () => {
            try {
                const startOfMonth = new Date()
                startOfMonth.setDate(1)
                startOfMonth.setHours(0, 0, 0, 0)

                const { count: countMini, error: errorMini } = await (supabase as any)
                    .from('messages')
                    .select('*', { count: 'exact', head: true })
                    .eq('clinic_id', clinicId)
                    .eq('ai_generated', true)
                    .or('ai_model.is.null,ai_model.eq.mini')
                    .gte('created_at', startOfMonth.toISOString())
                
                if (errorMini) throw errorMini

                const { count: count4o, error: error4o } = await (supabase as any)
                    .from('messages')
                    .select('*', { count: 'exact', head: true })
                    .eq('clinic_id', clinicId)
                    .eq('ai_generated', true)
                    .eq('ai_model', '4o')
                    .gte('created_at', startOfMonth.toISOString())

                if (error4o) throw error4o

                setUsedMini(countMini || 0)
                setUsed4o(count4o || 0)
            } catch (err) {
                console.error('Error fetching AI usage:', err)
            } finally {
                setLoading(false)
            }
        }
        fetchUsage()
    }, [clinicId])

    const handleAddCredits = async () => {
        if (isUpdating || !addAmount) return
        setIsUpdating(true)
        try {
            const amount = parseInt(addAmount)
            const is4o = chargeTarget === '4o'
            
            const updates: any = is4o 
                ? { ai_credits_extra_4o: currentExtra4o + amount }
                : { ai_credits_extra_balance: currentExtraMini + amount }
            
            const { error } = await (supabase as any)
                .from('clinic_settings')
                .update(updates)
                .eq('id', clinicId)

            if (error) throw error
            
            if (is4o) setCurrentExtra4o(prev => prev + amount)
            else setCurrentExtraMini(prev => prev + amount)
            
            alert(`Créditos cargados correctamente`)
        } catch (err) {
            console.error('Error adding credits:', err)
            alert('Error al cargar créditos')
        } finally {
            setIsUpdating(false)
        }
    }

    if (loading) return (
        <div className="flex flex-col items-center justify-center py-6 space-y-2 opacity-50">
            <Loader2 className="w-5 h-5 animate-spin text-primary-500" />
            <p className="text-[10px] font-black uppercase text-gray-400 tracking-widest">Calculando tráfico...</p>
        </div>
    )

    const totalMini = (monthlyLimit || 500) + currentExtraMini
    const percentMini = Math.min(100, Math.round(((usedMini || 0) / totalMini) * 100))
    const total4o = currentExtra4o
    const percent4o = total4o > 0 ? Math.min(100, Math.round(((used4o || 0) / total4o) * 100)) : 0

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-6">
                {/* 4o Mini Tracking */}
                <div className="space-y-3">
                    <div className="flex justify-between items-end">
                        <div>
                            <p className="text-[10px] text-emerald-600 font-black uppercase tracking-widest">GPT-4o Mini (Producción)</p>
                            <div className="flex items-baseline gap-2 mt-1">
                                <span className="text-2xl font-black text-gray-900 leading-none">{usedMini}</span>
                                <span className="text-xs text-gray-400 font-bold uppercase tracking-tight">/ {totalMini} usados</span>
                            </div>
                        </div>
                        <div className={cn(
                            "px-3 py-1 rounded-full text-[10px] font-black border tracking-widest uppercase",
                            percentMini > 85 ? "bg-red-50 text-red-600 border-red-100" : "bg-emerald-50 text-emerald-600 border-emerald-100"
                        )}>
                            {percentMini}% Cap
                        </div>
                    </div>
                    <div className="h-3 bg-gray-100 rounded-full overflow-hidden shadow-inner border border-gray-200/50 p-0.5">
                        <div 
                            className={cn(
                                "h-full rounded-full transition-all duration-1000 shadow-sm",
                                percentMini > 85 ? "bg-red-500" : "bg-emerald-500"
                            )}
                            style={{ width: `${percentMini}%` }}
                        />
                    </div>
                </div>

                {/* 4o Premium Tracking */}
                <div className="space-y-3">
                    <div className="flex justify-between items-end">
                        <div>
                            <p className="text-[10px] text-purple-600 font-black uppercase tracking-widest">GPT-4o Premium (High-End)</p>
                            <div className="flex items-baseline gap-2 mt-1">
                                <span className="text-2xl font-black text-gray-900 leading-none">{used4o}</span>
                                <span className="text-xs text-gray-400 font-bold uppercase tracking-tight">/ {total4o || 0} disponibles</span>
                            </div>
                        </div>
                        <div className={cn(
                            "px-3 py-1 rounded-full text-[10px] font-black border tracking-widest uppercase",
                            percent4o > 85 ? "bg-red-50 text-red-600 border-red-100" : "bg-purple-50 text-purple-600 border-purple-100"
                        )}>
                            {total4o > 0 ? `${percent4o}% Load` : 'Depleted'}
                        </div>
                    </div>
                    <div className="h-3 bg-gray-100 rounded-full overflow-hidden shadow-inner border border-gray-200/50 p-0.5">
                        <div 
                            className={cn(
                                "h-full rounded-full transition-all duration-1000 shadow-sm",
                                percent4o > 85 ? "bg-red-500" : "bg-purple-500"
                            )}
                            style={{ width: `${percent4o}%` }}
                        />
                    </div>
                </div>
            </div>

            <div className="lg:border-l lg:pl-6 pt-6 lg:pt-0 border-t lg:border-t-0 border-gray-100 border-dashed">
                <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest mb-4 flex items-center gap-2">
                    <Plus className="w-3.5 h-3.5 fill-gray-400" /> Inyección Manual de Créditos
                </p>
                <div className="space-y-4">
                    <div className="flex gap-2">
                        <button 
                            onClick={() => setChargeTarget('mini')}
                            className={cn(
                                "flex-1 py-3 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all shadow-sm active:scale-95",
                                chargeTarget === 'mini' ? "bg-emerald-600 text-white border-emerald-700 shadow-emerald-500/20" : "bg-white text-gray-400 border-gray-200"
                            )}
                        >
                            Mini Model
                        </button>
                        <button 
                            onClick={() => setChargeTarget('4o')}
                            className={cn(
                                "flex-1 py-3 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all shadow-sm active:scale-95",
                                chargeTarget === '4o' ? "bg-purple-600 text-white border-purple-700 shadow-purple-500/20" : "bg-white text-gray-400 border-gray-200"
                            )}
                        >
                            4o Premium
                        </button>
                    </div>
                    <div className="flex gap-2">
                        <div className="relative flex-1">
                            <input 
                                type="number"
                                value={addAmount}
                                onChange={(e) => setAddAmount(e.target.value)}
                                className="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm font-black focus:ring-4 focus:ring-primary-500/5 focus:border-primary-500 transition-all outline-none shadow-inner bg-gray-50/50"
                            />
                            <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-gray-300">CREDITS</div>
                        </div>
                        <button
                            onClick={handleAddCredits}
                            disabled={isUpdating}
                            className="px-6 rounded-2xl bg-gray-900 text-white hover:bg-black transition-all shadow-lg active:scale-95 disabled:opacity-50"
                        >
                            {isUpdating ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                        </button>
                    </div>
                </div>
                <div className="mt-4 p-3 bg-blue-50/50 rounded-xl border border-blue-100 flex items-start gap-3">
                    <Shield className="w-4 h-4 text-blue-400 mt-0.5" />
                    <p className="text-[10px] text-blue-600 leading-normal font-bold">Estos créditos se registran como balance extra y no expiran al final del mes. No se genera cobro automático.</p>
                </div>
            </div>
        </div>
    )
}
