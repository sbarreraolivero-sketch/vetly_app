import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
    Search, Building2, Users,
    CheckCircle, Clock, XCircle, Loader2, RefreshCw, CreditCard,
    Sparkles
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
    // Relaciones las hacemos opcionales para evitar 400 si la DB está en mantenimiento
    clinic_members?: {
        id: string
        email: string
        first_name: string | null
        last_name: string | null
        role: string
        status: string
    }[]
    subscriptions?: {
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

export default function AdminClinics() {
    const [clinics, setClinics] = useState<ClinicData[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [statusFilter, setStatusFilter] = useState<string>('all')
    const [expandedClinic, setExpandedClinic] = useState<string | null>(null)
    const [fetchError, setFetchError] = useState<string | null>(null)

    const fetchClinics = useCallback(async () => {
        setLoading(true)
        setFetchError(null)
        try {
            const { data: { session } } = await supabase.auth.getSession()
            if (!session?.access_token) return

            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
            const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

            // Simplificamos al máximo el SELECT para evitar HTTP 400 si falta una columna o relación
            // Pedimos solo lo esencial de la tabla base primero
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

            if (!response.ok) {
                const errBody = await response.text()
                console.error('Fetch Clinics failed:', response.status, errBody)
                // Si el error es 400, intentamos una consulta "ultra-safe" sin miembros
                if (response.status === 400) {
                   const fallbackResponse = await fetch(
                        `${supabaseUrl}/rest/v1/clinic_settings?select=id,clinic_name,created_at,activation_status,subscription_plan&order=created_at.desc`,
                        {
                            headers: {
                                'apikey': supabaseKey,
                                'Authorization': `Bearer ${session.access_token}`,
                                'Content-Type': 'application/json',
                            },
                        }
                    )
                    if (fallbackResponse.ok) {
                        const fallbackData = await fallbackResponse.json()
                        setClinics(fallbackData as ClinicData[])
                        return
                    }
                }
                throw new Error(`Error ${response.status}: ${errBody}`)
            }
            
            const data = await response.json()
            setClinics(data as ClinicData[])
        } catch (err: any) {
            console.error('Error fetching clinics:', err)
            setFetchError(err.message || 'Error desconocido')
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
        return clinic.clinic_members?.find(m => m.role === 'owner') || { email: 'S/N', first_name: 'No asignado' }
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
                <Loader2 className="w-10 h-10 animate-spin text-primary-500 mb-4" />
                <p className="text-gray-500 font-bold tracking-tight">Cargando Red Global de Clínicas...</p>
            </div>
        )
    }

    return (
        <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-black text-gray-900 tracking-tight">HQ Clínicas</h1>
                    <p className="text-sm text-gray-500 font-medium">Gestión estratégica de unidades activas.</p>
                </div>
                {fetchError && (
                    <div className="px-4 py-2 bg-red-50 border border-red-100 rounded-xl flex items-center gap-2">
                        <XCircle className="w-4 h-4 text-red-500" />
                        <span className="text-xs font-bold text-red-600">Error de Sincronización: {fetchError.slice(0, 30)}...</span>
                        <button onClick={fetchClinics} className="ml-2 text-[10px] uppercase font-black text-red-700 bg-red-100 px-2 py-1 rounded">Reintentar</button>
                    </div>
                )}
            </div>

            {/* Stats Overview */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                    { label: 'Total', count: stats.total, color: 'text-blue-600', bg: 'bg-blue-50' },
                    { label: 'Activas', count: stats.active, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                    { label: 'Pendientes', count: stats.pending, color: 'text-amber-600', bg: 'bg-amber-50' },
                    { label: 'Mantenimiento', count: stats.inactive, color: 'text-slate-600', bg: 'bg-slate-50' },
                ].map((stat) => (
                    <div key={stat.label} className={cn("p-6 rounded-3xl border border-gray-100 shadow-sm", stat.bg)}>
                        <p className={cn("text-3xl font-black mb-1", stat.color)}>{stat.count}</p>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{stat.label}</p>
                    </div>
                ))}
            </div>

            {/* Search & Action Bar */}
            <div className="bg-white p-4 rounded-3xl border border-gray-200 shadow-sm flex flex-col md:flex-row gap-4">
                <div className="relative flex-1">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Buscar por clínica, dueño o ID..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full pl-12 pr-4 py-3 bg-gray-50 border-transparent rounded-2xl text-sm font-bold focus:bg-white focus:ring-4 focus:ring-primary-500/5 focus:border-primary-500 transition-all outline-none"
                    />
                </div>
                <div className="flex gap-2">
                    <select 
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="px-4 py-3 bg-gray-50 border-transparent rounded-2xl text-xs font-black uppercase tracking-widest outline-none focus:ring-2 focus:ring-primary-100 cursor-pointer"
                    >
                        <option value="all">Todos los Estados</option>
                        <option value="active">Solo Activas</option>
                        <option value="pending_activation">Solo Pendientes</option>
                    </select>
                    <button onClick={fetchClinics} className="p-3 bg-primary-500 text-white rounded-2xl hover:bg-black transition-all shadow-lg active:scale-95">
                        <RefreshCw className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* Grid de Clínicas (Mobile Cards / Desktop Grid) */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredClinics.length === 0 ? (
                    <div className="col-span-full py-20 bg-gray-50 rounded-3xl border-2 border-dashed border-gray-200 text-center">
                        <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                        <h3 className="text-sm font-bold text-gray-500 uppercase tracking-widest">Sin resultados coincidentes</h3>
                    </div>
                ) : (
                    filteredClinics.map((clinic) => {
                        const owner = getOwner(clinic)
                        return (
                            <div key={clinic.id} className="group bg-white rounded-3xl border border-gray-200 hover:border-primary-500/30 p-6 flex flex-col gap-6 shadow-sm hover:shadow-xl transition-all duration-500 relative overflow-hidden">
                                <div className="flex items-start justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-gray-900 to-gray-700 flex items-center justify-center text-white font-black text-xl shadow-lg">
                                            {clinic.clinic_name?.[0].toUpperCase() || 'V'}
                                        </div>
                                        <div className="min-w-0">
                                            <h3 className="text-lg font-black text-gray-900 truncate leading-none mb-1.5">{clinic.clinic_name}</h3>
                                            <p className="text-[10px] font-black text-gray-400 font-mono tracking-tighter uppercase">ID: {clinic.id.slice(0, 18)}...</p>
                                        </div>
                                    </div>
                                    {getStatusBadge(clinic.activation_status)}
                                </div>

                                <div className="space-y-4">
                                    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-2xl">
                                        <div className="flex items-center gap-2">
                                            <Users className="w-3.5 h-3.5 text-primary-500" />
                                            <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Dueño</span>
                                        </div>
                                        <span className="text-xs font-bold text-gray-900 truncate max-w-[150px]">{owner.email}</span>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="p-3 bg-blue-50/50 border border-blue-100 rounded-2xl">
                                            <p className="text-[9px] font-black text-blue-400 uppercase tracking-widest mb-1">Plan Actual</p>
                                            <div className="flex items-baseline gap-1">
                                                <CreditCard className="w-3 h-3 text-blue-600" />
                                                <span className="text-xs font-black text-blue-800 uppercase leading-none">{clinic.subscription_plan}</span>
                                            </div>
                                        </div>
                                        <div className="p-3 bg-purple-50/50 border border-purple-100 rounded-2xl">
                                            <p className="text-[9px] font-black text-purple-400 uppercase tracking-widest mb-1">Modelo IA</p>
                                            <div className="flex items-baseline gap-1">
                                                <Sparkles className="w-3 h-3 text-purple-600" />
                                                <span className="text-xs font-black text-purple-800 uppercase leading-none">{clinic.ai_active_model?.split('-')[1] || 'mini'}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex gap-2">
                                        <button
                                            onClick={() => setExpandedClinic(expandedClinic === clinic.id ? null : clinic.id)}
                                            className="flex-1 py-3 bg-gray-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-lg shadow-gray-900/10 hover:bg-black transition-all active:scale-95 flex items-center justify-center gap-2"
                                        >
                                            Ver Expediente
                                        </button>
                                </div>

                                {expandedClinic === clinic.id && (
                                    <div className="pt-6 border-t border-gray-100 mt-2 space-y-4 animate-fade-in">
                                        <div className="bg-amber-50 p-4 rounded-2xl border border-amber-100">
                                            <h4 className="text-[9px] font-black text-amber-600 uppercase tracking-widest mb-2">Cuotas Mensuales (IA)</h4>
                                            <div className="flex justify-between items-end">
                                                <span className="text-xl font-black text-amber-900">{clinic.ai_credits_monthly_limit} <span className="text-[10px] text-amber-600">SMS</span></span>
                                                <div className="text-right">
                                                    <p className="text-[9px] font-black text-amber-400 uppercase">Balance Extra</p>
                                                    <p className="text-xs font-bold text-amber-900">+{clinic.ai_credits_extra_balance}</p>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="flex flex-col">
                                                <span className="text-[8px] font-black uppercase text-gray-400 mb-1">Zona</span>
                                                <span className="text-xs font-bold text-gray-700">{clinic.timezone}</span>
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="text-[8px] font-black uppercase text-gray-400 mb-1">Trial</span>
                                                <span className="text-xs font-bold text-gray-700 capitalize">{clinic.trial_status?.replace('_', ' ')}</span>
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
