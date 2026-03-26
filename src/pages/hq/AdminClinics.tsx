import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
    Search, Building2, Users, Shield, ChevronUp,
    CheckCircle, Clock, XCircle, Loader2, RefreshCw, CreditCard, Eye,
    Sparkles, Plus
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

const statusColors: Record<string, { bg: string; text: string; label: string }> = {
    active: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Activa' },
    pending_activation: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Pendiente' },
    inactive: { bg: 'bg-red-50', text: 'text-red-700', label: 'Inactiva' },
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

            // Fetch clinics with members and subscriptions
            const response = await fetch(
                `${supabaseUrl}/rest/v1/clinic_settings?select=id,clinic_name,created_at,activation_status,subscription_plan,trial_status,billing_status,trial_start_date,trial_end_date,currency,timezone,ai_credits_monthly_limit,ai_credits_extra_balance,ai_credits_extra_4o,ai_active_model,clinic_members(id,email,first_name,last_name,role,status),subscriptions(plan,status,current_period_end,trial_ends_at)&order=created_at.desc`,
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
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
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
            <div className="p-8 flex items-center justify-center h-full">
                <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
            </div>
        )
    }

    return (
        <div className="p-6 lg:p-8 max-w-7xl mx-auto">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-gray-900">Clínicas</h1>
                <p className="text-gray-500 mt-1">Gestiona todas las clínicas registradas en la plataforma.</p>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-50 rounded-lg">
                            <Building2 className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
                            <p className="text-xs text-gray-500">Total</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-emerald-50 rounded-lg">
                            <CheckCircle className="w-5 h-5 text-emerald-600" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-gray-900">{stats.active}</p>
                            <p className="text-xs text-gray-500">Activas</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-amber-50 rounded-lg">
                            <Clock className="w-5 h-5 text-amber-600" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-gray-900">{stats.pending}</p>
                            <p className="text-xs text-gray-500">Pendientes</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-red-50 rounded-lg">
                            <XCircle className="w-5 h-5 text-red-600" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-gray-900">{stats.inactive}</p>
                            <p className="text-xs text-gray-500">Inactivas</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Filters */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
                <div className="flex flex-col sm:flex-row gap-4">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Buscar por nombre o email..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        />
                    </div>
                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                    >
                        <option value="all">Todos los estados</option>
                        <option value="active">Activas</option>
                        <option value="pending_activation">Pendientes</option>
                        <option value="inactive">Inactivas</option>
                    </select>
                    <button
                        onClick={fetchClinics}
                        className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-600 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors border border-gray-200"
                    >
                        <RefreshCw className="w-4 h-4" />
                        Actualizar
                    </button>
                </div>
            </div>

            {/* Clinics Table */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-gray-100">
                                <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Clínica</th>
                                <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Owner</th>
                                <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Plan</th>
                                <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Estado</th>
                                <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Miembros</th>
                                <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Fecha</th>
                                <th className="px-6 py-3.5 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">Detalles</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {filteredClinics.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-6 py-12 text-center text-gray-500 text-sm">
                                        {search || statusFilter !== 'all'
                                            ? 'No se encontraron clínicas con estos filtros.'
                                            : 'No hay clínicas registradas.'}
                                    </td>
                                </tr>
                            ) : (
                                filteredClinics.map((clinic) => {
                                    const owner = getOwner(clinic)
                                    const isExpanded = expandedClinic === clinic.id
                                    return (
                                        <tr key={clinic.id}>
                                            <td colSpan={7} className="p-0">
                                                <div>
                                                    <div className="flex items-center px-6 py-4 hover:bg-gray-50/50 transition-colors">
                                                        <div className="flex-1 min-w-0 flex items-center">
                                                            <div className="w-10 h-10 rounded-lg bg-primary-50 flex items-center justify-center mr-3 flex-shrink-0">
                                                                <Building2 className="w-5 h-5 text-primary-600" />
                                                            </div>
                                                            <div className="min-w-0">
                                                                <p className="text-sm font-semibold text-gray-900 truncate">{clinic.clinic_name || 'Sin nombre'}</p>
                                                                <p className="text-xs text-gray-400">{clinic.id.slice(0, 8)}...</p>
                                                            </div>
                                                        </div>
                                                        <div className="w-44 px-3">
                                                            <p className="text-sm text-gray-700 truncate">{owner?.email || 'N/A'}</p>
                                                            <p className="text-xs text-gray-400">{owner?.first_name || ''} {owner?.last_name || ''}</p>
                                                        </div>
                                                        <div className="w-24 px-3">
                                                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-purple-50 text-purple-700 text-xs font-medium">
                                                                <CreditCard className="w-3 h-3" />
                                                                {planLabels[clinic.subscription_plan] || clinic.subscription_plan}
                                                            </span>
                                                        </div>
                                                        <div className="w-28 px-3">
                                                            {getStatusBadge(clinic.activation_status)}
                                                        </div>
                                                        <div className="w-20 px-3 text-center">
                                                            <span className="inline-flex items-center gap-1 text-sm text-gray-600">
                                                                <Users className="w-3.5 h-3.5" />
                                                                {clinic.clinic_members?.length || 0}
                                                            </span>
                                                        </div>
                                                        <div className="w-28 px-3">
                                                            <p className="text-xs text-gray-500">
                                                                {new Date(clinic.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
                                                            </p>
                                                        </div>
                                                        <div className="w-16 px-3 text-center">
                                                            <button
                                                                onClick={() => setExpandedClinic(isExpanded ? null : clinic.id)}
                                                                className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
                                                            >
                                                                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {/* Expanded Details */}
                                                    {isExpanded && (
                                                        <div className="px-6 pb-4 bg-gray-50/80 border-t border-gray-100">
                                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4">
                                                                {/* Subscription Info */}
                                                                <div className="bg-white rounded-lg p-4 border border-gray-100">
                                                                    <h4 className="text-xs font-semibold text-gray-500 uppercase mb-3 flex items-center gap-1.5">
                                                                        <CreditCard className="w-3.5 h-3.5" /> Suscripción
                                                                    </h4>
                                                                    <div className="space-y-2 text-sm">
                                                                        <div className="flex justify-between">
                                                                            <span className="text-gray-500">Plan</span>
                                                                            <span className="font-medium">{planLabels[clinic.subscription_plan] || clinic.subscription_plan}</span>
                                                                        </div>
                                                                        <div className="flex justify-between">
                                                                            <span className="text-gray-500">Trial</span>
                                                                            <span className="font-medium capitalize">{clinic.trial_status?.replace('_', ' ')}</span>
                                                                        </div>
                                                                        <div className="flex justify-between">
                                                                            <span className="text-gray-500">Facturación</span>
                                                                            <span className="font-medium capitalize">{clinic.billing_status?.replace('_', ' ')}</span>
                                                                        </div>
                                                                        <div className="flex justify-between">
                                                                            <span className="text-gray-500">Moneda</span>
                                                                            <span className="font-medium">{clinic.currency || 'MXN'}</span>
                                                                        </div>
                                                                    </div>
                                                                </div>

                                                                {/* Members */}
                                                                <div className="bg-white rounded-lg p-4 border border-gray-100">
                                                                    <h4 className="text-xs font-semibold text-gray-500 uppercase mb-3 flex items-center gap-1.5">
                                                                        <Users className="w-3.5 h-3.5" /> Miembros ({clinic.clinic_members?.length || 0})
                                                                    </h4>
                                                                    <div className="space-y-2 max-h-32 overflow-y-auto">
                                                                        {clinic.clinic_members?.map((member) => (
                                                                            <div key={member.id} className="flex items-center justify-between text-sm">
                                                                                <span className="text-gray-700 truncate mr-2">{member.email}</span>
                                                                                <span className={`text-xs px-1.5 py-0.5 rounded ${member.role === 'owner' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                                                                                    {member.role}
                                                                                </span>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>

                                                                {/* Technical */}
                                                                <div className="bg-white rounded-lg p-4 border border-gray-100">
                                                                    <h4 className="text-xs font-semibold text-gray-500 uppercase mb-3 flex items-center gap-1.5">
                                                                        <Shield className="w-3.5 h-3.5" /> Información Técnica
                                                                    </h4>
                                                                    <div className="space-y-2 text-sm">
                                                                        <div className="flex justify-between">
                                                                            <span className="text-gray-500">ID</span>
                                                                            <span className="font-mono text-xs text-gray-600">{clinic.id.slice(0, 12)}...</span>
                                                                        </div>
                                                                        <div className="flex justify-between">
                                                                            <span className="text-gray-500">Timezone</span>
                                                                            <span className="font-medium text-xs">{clinic.timezone || 'N/A'}</span>
                                                                        </div>
                                                                        <div className="flex justify-between">
                                                                            <span className="text-gray-500">Creada</span>
                                                                            <span className="font-medium text-xs">
                                                                                {new Date(clinic.created_at).toLocaleDateString('es-ES')}
                                                                            </span>
                                                                        </div>
                                                                        {clinic.trial_end_date && (
                                                                            <div className="flex justify-between">
                                                                                <span className="text-gray-500">Trial hasta</span>
                                                                                <span className="font-medium text-xs">
                                                                                    {new Date(clinic.trial_end_date).toLocaleDateString('es-ES')}
                                                                                </span>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </div>

                                                                {/* AI Usage */}
                                                                <div className="bg-white rounded-lg p-4 border border-gray-200/60 md:col-span-3 shadow-sm bg-gradient-to-br from-white to-gray-50/30">
                                                                    <h4 className="text-[10px] font-black text-gray-400 uppercase mb-4 tracking-widest flex items-center gap-2">
                                                                        <div className="p-1 bg-primary-50 rounded-md">
                                                                            <Sparkles className="w-3.5 h-3.5 text-primary-600" />
                                                                        </div>
                                                                        Uso de Inteligencia Artificial (Mes Actual)
                                                                    </h4>
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
                                            </td>
                                        </tr>
                                    )
                                })
                            )}
                        </tbody>
                    </table>
                </div>
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

                // Fetch Mini count
                const { count: countMini, error: errorMini } = await (supabase as any)
                    .from('messages')
                    .select('*', { count: 'exact', head: true })
                    .eq('clinic_id', clinicId)
                    .eq('ai_generated', true)
                    .or('ai_model.is.null,ai_model.eq.mini')
                    .gte('created_at', startOfMonth.toISOString())
                
                if (errorMini) throw errorMini

                // Fetch 4o count
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
            
            alert(`Créditos (${chargeTarget === 'mini' ? 'Mini' : 'GPT-4o'}) cargados correctamente`)
        } catch (err) {
            console.error('Error adding credits:', err)
            alert('Error al cargar créditos')
        } finally {
            setIsUpdating(false)
        }
    }

    if (loading) return <div className="animate-pulse space-y-4 text-center py-4">
        <div className="h-4 bg-gray-100 rounded-full w-3/4 mx-auto"></div>
        <div className="h-4 bg-gray-100 rounded-full w-1/2 mx-auto"></div>
    </div>

    const totalMini = (monthlyLimit || 500) + currentExtraMini
    const percentMini = Math.min(100, Math.round(((usedMini || 0) / totalMini) * 100))
    
    // GPT-4o typically doesn't have a plan limit, only extra balance in this logic
    const total4o = currentExtra4o
    const percent4o = total4o > 0 ? Math.min(100, Math.round(((used4o || 0) / total4o) * 100)) : 0

    return (
        <div className="space-y-6">
            {/* GPT-4o mini Dashboard */}
            <div className="space-y-3 bg-emerald-50/30 p-3 rounded-lg border border-emerald-100/50 shadow-sm">
                <div className="flex justify-between items-end">
                    <div className="flex gap-4">
                        <div className="text-center">
                            <p className="text-[10px] text-emerald-600 uppercase font-extrabold text-left tracking-wider">GPT-4o-mini (Usados)</p>
                            <p className="text-sm font-black text-gray-900 text-left">{usedMini}</p>
                        </div>
                        <div className="text-center border-l border-emerald-100 pl-4">
                            <p className="text-[10px] text-emerald-600 uppercase font-extrabold text-left tracking-wider">Límite Total</p>
                            <p className="text-sm font-semibold text-gray-600 text-left">{monthlyLimit || 500} <span className="text-[10px] font-normal text-gray-400">(plan)</span> + {currentExtraMini} <span className="text-[10px] font-normal text-gray-400">(extra)</span> = {totalMini}</p>
                        </div>
                    </div>
                    <div className="text-right">
                        <span className={cn(
                            "text-[10px] font-black px-2 py-0.5 rounded-full shadow-sm",
                            percentMini > 90 ? "bg-red-50 text-red-600 border border-red-100" : "bg-emerald-100 text-emerald-700 border border-emerald-200"
                        )}>
                            {percentMini}%
                        </span>
                    </div>
                </div>
                <div className="w-full bg-emerald-100/30 rounded-full h-2.5 overflow-hidden shadow-inner border border-emerald-100/50">
                    <div 
                        className={cn(
                            "h-full transition-all duration-700 ease-out rounded-full shadow-sm",
                            percentMini > 90 ? "bg-red-500" : "bg-emerald-500"
                        )}
                        style={{ width: `${percentMini}%` }}
                    />
                </div>
            </div>

            {/* GPT-4o Dashboard */}
            <div className="space-y-3 bg-violet-50/30 p-3 rounded-lg border border-violet-100/50 shadow-sm">
                <div className="flex justify-between items-end">
                    <div className="flex gap-4">
                        <div className="text-center">
                            <p className="text-[10px] text-violet-600 uppercase font-extrabold text-left tracking-wider">GPT-4o Premium (Usados)</p>
                            <p className="text-sm font-black text-gray-900 text-left">{used4o}</p>
                        </div>
                        <div className="text-center border-l border-violet-100 pl-4">
                            <p className="text-[10px] text-violet-600 uppercase font-extrabold text-left tracking-wider">Límite Extra</p>
                            <p className="text-sm font-semibold text-gray-600 text-left">{currentExtra4o}</p>
                        </div>
                    </div>
                    <div className="text-right">
                        <span className={cn(
                            "text-[10px] font-black px-2 py-0.5 rounded-full shadow-sm",
                            percent4o > 90 ? "bg-red-50 text-red-600 border border-red-100" : "bg-violet-100 text-violet-700 border border-violet-200"
                        )}>
                            {percent4o}%
                        </span>
                    </div>
                </div>
                <div className="w-full bg-violet-100/30 rounded-full h-2.5 overflow-hidden shadow-inner border border-violet-100/50">
                    <div 
                        className={cn(
                            "h-full transition-all duration-700 ease-out rounded-full shadow-sm",
                            percent4o > 90 ? "bg-red-500" : "bg-violet-500"
                        )}
                        style={{ width: `${percent4o}%` }}
                    />
                </div>
            </div>

            {/* Manual Credit Loader */}
            <div className="pt-4 border-t border-dashed border-gray-200">
                <p className="text-[10px] text-gray-400 font-extrabold uppercase mb-3 tracking-widest flex items-center gap-1.5">
                    <Shield className="w-3 h-3" /> Carga Manual de Créditos HQ
                </p>
                <div className="flex flex-wrap items-center gap-3">
                    <select 
                        value={chargeTarget}
                        onChange={(e) => setChargeTarget(e.target.value as any)}
                        className="text-xs font-bold px-3 py-2 border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent shadow-sm transition-all"
                    >
                        <option value="mini">Model: Mini</option>
                        <option value="4o">Model: GPT-4o</option>
                    </select>
                    <div className="relative flex-1 min-w-[120px]">
                        <input 
                            type="number"
                            value={addAmount}
                            onChange={(e) => setAddAmount(e.target.value)}
                            placeholder="Cantidad..."
                            className="w-full pl-4 pr-10 py-2 border border-gray-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary-500 shadow-sm transition-all"
                        />
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black text-gray-400">CR</div>
                    </div>
                    <button
                        onClick={handleAddCredits}
                        disabled={isUpdating}
                        className={cn(
                            "flex items-center gap-1.5 px-5 py-2 text-[10px] font-black uppercase text-white rounded-xl transition-all shadow-md active:scale-95 disabled:opacity-50 tracking-wider",
                            chargeTarget === '4o' ? "bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700" : "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700"
                        )}
                    >
                        {isUpdating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5 stroke-[3]" />}
                        Cargar HQ
                    </button>
                </div>
                <p className="text-[10px] text-gray-400 mt-2 italic font-medium">Nota: Esta carga es manual y no genera factura en Mercado Pago. Use solo para cortesías o correcciones.</p>
            </div>
        </div>
    )
}
