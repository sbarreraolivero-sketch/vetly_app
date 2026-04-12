import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
    Search, Building2, Users,
    CheckCircle, Clock, XCircle, Loader2, RefreshCw, CreditCard,
    Sparkles, Plus, Info
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
    // Créditos Mini
    ai_credits_used: number
    ai_credits_monthly_limit: number
    ai_credits_extra_balance: number
    // Créditos GPT-4o
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
    const [expandedClinic, setExpandedClinic] = useState<string | null>(null)
    const [fetchError, setFetchError] = useState<string | null>(null)
    
    // Estados para carga de créditos
    const [charging, setCharging] = useState<string | null>(null)
    const [chargeAmount, setChargeAmount] = useState<number>(500)
    const [chargeModel, setChargeModel] = useState<'mini' | 'premium'>('mini')

    const fetchClinics = useCallback(async () => {
        setLoading(true)
        setFetchError(null)
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
            setFetchError(err.message || 'Error desconocido')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchClinics()
    }, [fetchClinics])

    const handleManualCharge = async (clinicId: string) => {
        if (!confirm(`¿Cargar ${chargeAmount} créditos ${chargeModel.toUpperCase()} a esta clínica?`)) return
        
        setCharging(clinicId)
        try {
            const { data: { session } } = await supabase.auth.getSession()
            if (!session?.access_token) return

            const column = chargeModel === 'mini' ? 'ai_credits_extra_balance' : 'ai_credits_extra_gpt4o'
            
            // Buscamos el valor actual para sumar
            const clinic = clinics.find(c => c.id === clinicId)
            const currentVal = chargeModel === 'mini' ? (clinic?.ai_credits_extra_balance || 0) : (clinic?.ai_credits_extra_gpt4o || 0)
            
            const { error } = await supabase
                .from('clinic_settings')
                .update({ [column]: currentVal + chargeAmount })
                .eq('id', clinicId)

            if (error) throw error
            
            alert('✅ Créditos cargados exitosamente.')
            fetchClinics()
        } catch (err: any) {
            alert('Error al cargar créditos: ' + err.message)
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

    const getOwner = (clinic: ClinicData) => {
        return clinic.clinic_members?.find(m => m.role === 'owner') || { email: 'S/N', first_name: 'No asignado' }
    }

    const getStatusBadge = (status: string) => {
        const s = statusColors[status] || statusColors.inactive
        return (
            <span className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black border uppercase tracking-widest",
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
                <p className="text-gray-500 font-bold tracking-tight">Cargando Red Global...</p>
            </div>
        )
    }

    return (
        <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto">
            {/* Header / Stats omitted for brevity, but they stay in real file */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-black text-gray-900 tracking-tight">HQ Clínicas</h1>
                    <p className="text-sm text-gray-500 font-medium">Gestión estratégica de unidades y créditos IA.</p>
                </div>
                <button onClick={fetchClinics} className="p-3 bg-white border border-gray-200 rounded-2xl hover:bg-primary-50 transition-all shadow-sm">
                    <RefreshCw className={cn("w-5 h-5", loading && "animate-spin")} />
                </button>
            </div>

            {/* Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {filteredClinics.map((clinic) => {
                    const owner = getOwner(clinic)
                    const isPremium = clinic.ai_active_model?.includes('4o') && !clinic.ai_active_model?.includes('mini')
                    
                    // Cálculos de barrita Mini
                    const miniTotal = (clinic.ai_credits_monthly_limit || 0) + (clinic.ai_credits_extra_balance || 0)
                    const miniUsed = (clinic.ai_credits_used || 0)
                    const miniPercent = Math.min(100, Math.round((miniUsed / (miniTotal || 1)) * 100))
                    
                    // Cálculos de barrita Premium
                    const gpt4Total = (clinic.ai_credits_monthly_limit_gpt4o || 0) + (clinic.ai_credits_extra_gpt4o || 0)
                    const gpt4Used = (clinic.ai_credits_used_gpt4o || 0)
                    const gpt4Percent = Math.min(100, Math.round((gpt4Used / (gpt4Total || 1)) * 100))

                    return (
                        <div key={clinic.id} className="group bg-white rounded-[2rem] border border-gray-200 p-8 flex flex-col gap-6 shadow-sm hover:shadow-2xl transition-all duration-500">
                            {/* Card Header */}
                            <div className="flex items-start justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="w-16 h-16 rounded-[1.25rem] bg-gray-900 border-4 border-gray-50 flex items-center justify-center text-white font-black text-2xl shadow-xl">
                                        {clinic.clinic_name?.[0].toUpperCase() || 'V'}
                                    </div>
                                    <div className="min-w-0">
                                        <h3 className="text-xl font-black text-gray-900 truncate leading-none mb-2">{clinic.clinic_name}</h3>
                                        <div className="flex items-center gap-2">
                                            {getStatusBadge(clinic.activation_status)}
                                            <span className="text-[10px] font-black text-gray-400 font-mono tracking-tighter uppercase whitespace-nowrap">ID: {clinic.id.slice(0, 8)}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Owner & Plan Info */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-4 bg-gray-50 rounded-2xl flex flex-col gap-1">
                                    <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Responsable</span>
                                    <span className="text-xs font-bold text-gray-900 truncate">{owner.email}</span>
                                </div>
                                <div className="p-4 bg-blue-50/50 border border-blue-100/50 rounded-2xl flex flex-col gap-1">
                                    <span className="text-[9px] font-black text-blue-400 uppercase tracking-widest">Nivel de Plan</span>
                                    <div className="flex items-center gap-2">
                                        <CreditCard className="w-3 h-3 text-blue-600" />
                                        <span className="text-xs font-black text-blue-800 uppercase">{clinic.subscription_plan}</span>
                                    </div>
                                </div>
                            </div>

                            {/* IA USAGE SECTION */}
                            <div className="space-y-6 p-6 bg-gray-50 rounded-[1.5rem] border border-gray-100">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] flex items-center gap-2">
                                        <Sparkles className="w-3 h-3 text-purple-500" />
                                        Uso IA (Mes Actual)
                                    </h4>
                                    <span className={cn(
                                        "px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-tighter",
                                        isPremium ? "bg-purple-600 text-white" : "bg-emerald-500 text-white"
                                    )}>
                                        Activo: {isPremium ? 'GPT-4o' : 'GPT-4o MINI'}
                                    </span>
                                </div>

                                {/* Mini Bar */}
                                <div className="space-y-2">
                                    <div className="flex justify-between items-end">
                                        <p className="text-[10px] font-black text-emerald-600 uppercase tracking-tighter">GPT-4o-MINI (Usados)</p>
                                        <p className="text-[10px] font-bold text-gray-500">
                                            <span className="text-gray-900 font-black">{miniUsed}</span> / {clinic.ai_credits_monthly_limit} + {clinic.ai_credits_extra_balance} = {miniTotal}
                                        </p>
                                    </div>
                                    <div className="h-2.5 w-full bg-emerald-100 rounded-full overflow-hidden">
                                        <div className="h-full bg-emerald-500 transition-all duration-1000" style={{ width: `${miniPercent}%` }} />
                                    </div>
                                </div>

                                {/* Premium Bar */}
                                <div className="space-y-2 pt-2 border-t border-gray-200/50">
                                    <div className="flex justify-between items-end">
                                        <p className="text-[10px] font-black text-purple-600 uppercase tracking-tighter">GPT-4o PREMIUM (Usados)</p>
                                        <p className="text-[10px] font-bold text-gray-500">
                                            <span className="text-gray-900 font-black">{gpt4Used}</span> / {clinic.ai_credits_monthly_limit_gpt4o || 0} + {clinic.ai_credits_extra_gpt4o || 0} = {gpt4Total}
                                        </p>
                                    </div>
                                    <div className="h-2.5 w-full bg-purple-100 rounded-full overflow-hidden">
                                        <div className="h-full bg-purple-600 transition-all duration-1000" style={{ width: `${gpt4Percent}%` }} />
                                    </div>
                                </div>
                            </div>

                            {/* RECHARGE FORM */}
                            <div className="pt-4 border-t border-gray-100 space-y-4">
                                <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                    <Plus className="w-3 h-3 text-emerald-500" />
                                    Carga Manual de Créditos
                                </h4>
                                <div className="flex gap-2">
                                    <select 
                                        value={chargeModel}
                                        onChange={(e) => setChargeModel(e.target.value as any)}
                                        className="bg-gray-50 border border-gray-200 rounded-xl px-3 text-[10px] font-black uppercase outline-none focus:ring-2 focus:ring-primary-500/20"
                                    >
                                        <option value="mini">Mini</option>
                                        <option value="premium">Premium</option>
                                    </select>
                                    <input 
                                        type="number"
                                        value={chargeAmount}
                                        onChange={(e) => setChargeAmount(Number(e.target.value))}
                                        className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm font-bold outline-none focus:bg-white transition-all"
                                        placeholder="Cantidad..."
                                    />
                                    <button
                                        onClick={() => handleManualCharge(clinic.id)}
                                        disabled={charging === clinic.id}
                                        className="bg-emerald-600 text-white px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-black transition-all shadow-lg active:scale-95 disabled:bg-gray-300 flex items-center gap-2"
                                    >
                                        {charging === clinic.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                                        Cargar
                                    </button>
                                </div>
                            </div>
                            
                            {/* Footer Info */}
                            <div className="grid grid-cols-2 gap-6 pt-4 border-t border-gray-100">
                                <div>
                                    <p className="text-[8px] font-black text-gray-400 uppercase mb-1">Zona Horaria</p>
                                    <p className="text-xs font-bold text-gray-700">{clinic.timezone}</p>
                                </div>
                                <div>
                                    <p className="text-[8px] font-black text-gray-400 uppercase mb-1">Estado de Trial</p>
                                    <p className="text-xs font-bold text-gray-700 capitalize">{clinic.trial_status?.replace('_', ' ') || 'Not Started'}</p>
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
