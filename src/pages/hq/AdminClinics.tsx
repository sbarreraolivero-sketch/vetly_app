import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
    Search,
    Loader2, RefreshCw, CreditCard,
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
    ai_active_model: string
    ai_credits_used: number
    ai_credits_monthly_limit: number
    ai_credits_extra_balance: number
    ai_credits_used_gpt4o: number
    ai_credits_monthly_limit_gpt4o: number
    ai_credits_extra_gpt4o: number
    
    clinic_members?: {
        email: string
        first_name: string | null
        role: string
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
    
    const [charging, setCharging] = useState<string | null>(null)
    const [chargeAmount, setChargeAmount] = useState<number>(500)
    const [chargeModel, setChargeModel] = useState<'mini' | 'premium'>('mini')

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
            setClinics(data as ClinicData[])
        } catch (err: any) {
            console.error('Error fetching clinics:', err)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchClinics()
    }, [fetchClinics])

    const handleManualCharge = async (clinicId: string) => {
        if (!confirm(`¿Cargar ${chargeAmount} créditos ${chargeModel.toUpperCase()}?`)) return
        
        setCharging(clinicId)
        try {
            const column = chargeModel === 'mini' ? 'ai_credits_extra_balance' : 'ai_credits_extra_gpt4o'
            const clinic = clinics.find(c => c.id === clinicId)
            const currentVal = chargeModel === 'mini' ? (clinic?.ai_credits_extra_balance || 0) : (clinic?.ai_credits_extra_gpt4o || 0)
            
            const updatePayload = {
                [column]: currentVal + chargeAmount
            }

            const { error } = await (supabase.from('clinic_settings') as any)
                .update(updatePayload)
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

    const filteredClinics = clinics.filter(c => {
        const matchesSearch = !search ||
            c.clinic_name?.toLowerCase().includes(search.toLowerCase()) ||
            c.clinic_members?.some(m => m.email?.toLowerCase().includes(search.toLowerCase()))
        const matchesStatus = statusFilter === 'all' || c.activation_status === statusFilter
        return matchesSearch && matchesStatus
    })

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
                    <p className="text-sm text-gray-500 font-medium font-outfit uppercase tracking-widest mt-1 opacity-60">Consumo AI en Tiempo Real</p>
                </div>
                <button onClick={fetchClinics} className="p-4 bg-white border border-gray-100 rounded-[1.5rem] hover:bg-primary-50 transition-all text-gray-400 hover:text-primary-600 shadow-sm active:scale-90">
                    <RefreshCw className="w-5 h-5" />
                </button>
            </div>

            {/* Search Bar */}
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
                {filteredClinics.map((clinic) => {
                    const owner = clinic.clinic_members?.find(m => m.role === 'owner') || { email: 'S/N' }
                    const isPremium = clinic.ai_active_model === 'gpt-4o'
                    
                    const miniTotal = (clinic.ai_credits_monthly_limit || 0) + (clinic.ai_credits_extra_balance || 0)
                    const miniUsed = (clinic.ai_credits_used || 0)
                    const miniPercent = Math.min(100, Math.round((miniUsed / (miniTotal || 1)) * 100))
                    
                    const gpt4Total = (clinic.ai_credits_monthly_limit_gpt4o || 0) + (clinic.ai_credits_extra_gpt4o || 0)
                    const gpt4Used = (clinic.ai_credits_used_gpt4o || 0)
                    const gpt4Percent = Math.min(100, Math.round((gpt4Used / (gpt4Total || 1)) * 100))

                    return (
                        <div key={clinic.id} className="group bg-white rounded-[2.5rem] border border-gray-100 p-8 flex flex-col gap-6 shadow-sm hover:shadow-2xl hover:-translate-y-1 transition-all duration-500">
                            <div className="flex items-start justify-between">
                                <div className="flex items-center gap-5">
                                    <div className="w-16 h-16 rounded-[1.5rem] bg-gray-900 flex items-center justify-center text-white font-black text-2xl shadow-xl border-4 border-white">
                                        {clinic.clinic_name?.[0].toUpperCase()}
                                    </div>
                                    <div className="min-w-0">
                                        <h3 className="text-xl font-black text-gray-900 truncate tracking-tight mb-1">{clinic.clinic_name}</h3>
                                        <div className="flex items-center gap-2">
                                            {getStatusBadge(clinic.activation_status)}
                                            <span className="text-[10px] font-black text-gray-300">#{clinic.id.slice(0, 8)}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-4 bg-gray-50 rounded-2xl">
                                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Dueño</p>
                                    <p className="text-xs font-bold text-gray-800 truncate">{owner.email}</p>
                                </div>
                                <div className="p-4 bg-blue-50/30 border border-blue-50 rounded-2xl">
                                    <p className="text-[9px] font-black text-blue-400 uppercase tracking-widest mb-1">Plan</p>
                                    <div className="flex items-center gap-1.5 font-black text-blue-700 uppercase text-xs">
                                        <CreditCard className="w-3 h-3" />
                                        {clinic.subscription_plan}
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-6 p-6 bg-gray-50 rounded-[1.8rem] border border-gray-50 shadow-inner">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                        <Sparkles className="w-4 h-4 text-primary-500" />
                                        Métricas Mensuales
                                    </h4>
                                    <div className={cn(
                                        "px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest shadow-sm",
                                        isPremium ? "bg-primary-600 text-white" : "bg-emerald-500 text-white"
                                    )}>
                                        Activo: {isPremium ? 'GPT-4o Premium' : 'GPT-4o Mini'}
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <div className="flex justify-between items-end">
                                        <p className="text-[10px] font-black text-emerald-600 uppercase tracking-tighter">Mini (Usados)</p>
                                        <p className="text-[10px] font-bold text-gray-500">
                                            <span className="text-gray-900 font-black">{miniUsed}</span> / {miniTotal}
                                        </p>
                                    </div>
                                    <div className="h-3 w-full bg-emerald-100 rounded-full overflow-hidden">
                                        <div className="h-full bg-emerald-500 transition-all duration-1000" style={{ width: `${miniPercent}%` }} />
                                    </div>
                                </div>

                                <div className="space-y-3 pt-4 border-t border-gray-200/40">
                                    <div className="flex justify-between items-end">
                                        <p className="text-[10px] font-black text-primary-600 uppercase tracking-tighter">Premium (Usados)</p>
                                        <p className="text-[10px] font-bold text-gray-500">
                                            <span className="text-gray-900 font-black">{gpt4Used}</span> / {gpt4Total}
                                        </p>
                                    </div>
                                    <div className="h-3 w-full bg-primary-100 rounded-full overflow-hidden">
                                        <div className="h-full bg-primary-600 transition-all duration-1000" style={{ width: `${gpt4Percent}%` }} />
                                    </div>
                                </div>
                            </div>

                            <div className="pt-4 border-t border-gray-50 space-y-4">
                                <h5 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Inyección de Créditos</h5>
                                <div className="flex gap-3">
                                    <select 
                                        value={chargeModel}
                                        onChange={(e) => setChargeModel(e.target.value as 'mini' | 'premium')}
                                        className="bg-gray-50 rounded-xl px-4 text-[10px] font-black uppercase outline-none focus:ring-2 focus:ring-primary-500/20"
                                    >
                                        <option value="mini">Mini</option>
                                        <option value="premium">Premium</option>
                                    </select>
                                    <input 
                                        type="number"
                                        value={chargeAmount}
                                        onChange={(e) => setChargeAmount(Number(e.target.value))}
                                        className="flex-1 bg-gray-50 rounded-xl px-4 py-3 text-sm font-bold outline-none border-none focus:bg-white shadow-inner transition-all"
                                    />
                                    <button
                                        onClick={() => handleManualCharge(clinic.id)}
                                        disabled={charging === clinic.id}
                                        className="bg-gray-900 text-white px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-primary-600 transition-all disabled:bg-gray-200 flex items-center gap-2"
                                    >
                                        {charging === clinic.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
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
