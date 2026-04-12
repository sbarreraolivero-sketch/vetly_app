import { useState, useEffect } from 'react'
import { CheckCircle, Clock, Search, Loader2, RefreshCw, ShieldCheck, Mail, Calendar as CalendarIcon } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAdminAuth } from '@/contexts/AdminAuthContext'
import { cn } from '@/lib/utils'

interface PendingClinic {
    id: string
    clinic_name: string
    created_at: string
    activation_status: string
    subscription_plan: string
    owner_email: string
    owner_name: string
}

export default function AdminDashboard() {
    const { adminUser, loading: adminLoading } = useAdminAuth()
    const [clinics, setClinics] = useState<PendingClinic[]>([])
    const [loading, setLoading] = useState(true)
    const [searchTerm, setSearchTerm] = useState('')
    const [activating, setActivating] = useState<string | null>(null)

    useEffect(() => {
        fetchPendingClinics()
    }, [])

    const fetchPendingClinics = async () => {
        setLoading(true)
        try {
            const { data: { session } } = await supabase.auth.getSession()
            if (!session?.access_token) return

            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
            const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

            const response = await fetch(
                `${supabaseUrl}/rest/v1/clinic_settings?activation_status=eq.pending_activation&select=id,clinic_name,created_at,activation_status,subscription_plan,clinic_members!inner(email,first_name,role)&clinic_members.role=eq.owner&order=created_at.desc`,
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

            const typedData = data as any[];
            const formattedClinics = typedData.map(item => ({
                id: item.id,
                clinic_name: item.clinic_name,
                created_at: item.created_at,
                activation_status: item.activation_status,
                subscription_plan: item.subscription_plan,
                owner_email: item.clinic_members[0]?.email || 'N/A',
                owner_name: item.clinic_members[0]?.first_name || 'N/A'
            }))

            setClinics(formattedClinics)
        } catch (error) {
            console.error('Error fetching pending clinics:', error)
        } finally {
            setLoading(false)
        }
    }

    const handleActivate = async (clinicId: string) => {
        if (!confirm('¿Estás seguro de que quieres activar esta clínica? Esto iniciará su trial de 7 días.')) {
            return
        }

        setActivating(clinicId)
        try {
            const { data: { session } } = await supabase.auth.getSession()
            if (!session?.access_token) throw new Error('No session')

            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
            const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY
            const headers = {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal',
            }

            const now = new Date()
            const trialEnd = new Date()
            trialEnd.setDate(trialEnd.getDate() + 7)

            await fetch(`${supabaseUrl}/rest/v1/clinic_settings?id=eq.${clinicId}`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify({
                    activation_status: 'active',
                    trial_status: 'running',
                    trial_start_date: now.toISOString(),
                    trial_end_date: trialEnd.toISOString(),
                }),
            })

            await fetch(`${supabaseUrl}/rest/v1/subscriptions?clinic_id=eq.${clinicId}`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify({
                    status: 'trial',
                    trial_ends_at: trialEnd.toISOString(),
                    current_period_start: now.toISOString(),
                }),
            })

            setClinics(clinics.filter(c => c.id !== clinicId))
            alert('✅ Clínica activada exitosamente.')
        } catch (error) {
            console.error('Error activating clinic:', error)
            alert('Error al activar la clínica.')
        } finally {
            setActivating(null)
        }
    }

    const filteredClinics = clinics.filter(c =>
        c.clinic_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.owner_email.toLowerCase().includes(searchTerm.toLowerCase())
    )

    if (adminLoading) {
        return (
            <div className="flex-1 flex items-center justify-center min-h-[400px]">
                <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
            </div>
        )
    }

    if (!adminUser) return null

    return (
        <div className="p-4 lg:p-8 space-y-6">
            {/* Page Header */}
            <div>
                <h1 className="text-2xl lg:text-3xl font-black text-gray-900 tracking-tight flex items-center gap-3">
                    <ShieldCheck className="w-8 h-8 text-primary-600 lg:w-9 lg:h-9" />
                    Activaciones
                </h1>
                <p className="text-sm text-gray-500 font-medium mt-1">Nuevas clínicas esperando validación.</p>
            </div>

            {/* Content Container */}
            <div className="bg-white rounded-3xl border border-gray-200 shadow-sm overflow-hidden min-h-[500px] flex flex-col">
                {/* Dashboard Controls */}
                <div className="p-4 lg:p-6 border-b border-gray-100 bg-gray-50/30 flex flex-col lg:row gap-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-sm font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                            <Clock className="w-4 h-4 text-amber-500" />
                            Cola de Espera ({clinics.length})
                        </h2>
                        <button 
                            onClick={fetchPendingClinics}
                            className="p-2 text-gray-400 hover:text-primary-600 transition-colors bg-white border border-gray-200 rounded-xl"
                        >
                            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
                        </button>
                    </div>
                    
                    <div className="relative">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Buscar por nombre o email..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-11 pr-4 py-3 border border-gray-200 rounded-2xl text-sm font-medium focus:ring-4 focus:ring-primary-500/5 focus:border-primary-500 transition-all outline-none"
                        />
                    </div>
                </div>

                {/* List Content */}
                <div className="flex-1 overflow-y-auto">
                    {loading ? (
                        <div className="p-20 flex flex-col items-center justify-center gap-3">
                            <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Sincronizando...</p>
                        </div>
                    ) : filteredClinics.length === 0 ? (
                        <div className="p-20 flex flex-col items-center justify-center text-center">
                            <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mb-4">
                                <CheckCircle className="w-10 h-10 text-emerald-400" />
                            </div>
                            <h3 className="text-lg font-black text-gray-900">¡Todo al día!</h3>
                            <p className="text-sm text-gray-500 font-medium max-w-xs mx-auto mt-2">
                                No hay nuevas clínicas esperando activación. Disfruta el descanso.
                            </p>
                        </div>
                    ) : (
                        <div className="p-4 lg:p-0">
                            {/* Table Header (Desktop Only) */}
                            <div className="hidden lg:grid grid-cols-12 gap-4 px-8 py-4 bg-gray-50/50 border-b border-gray-100 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">
                                <div className="col-span-4">Clínica</div>
                                <div className="col-span-3">Dueño / Email</div>
                                <div className="col-span-2">Plan Solicitado</div>
                                <div className="col-span-3 text-right">Acciones</div>
                            </div>

                            {/* List Elements */}
                            <div className="grid grid-cols-1 gap-4 lg:gap-0 lg:divide-y lg:divide-gray-50">
                                {filteredClinics.map((clinic) => (
                                    <div key={clinic.id} className="group bg-white lg:bg-transparent rounded-2xl lg:rounded-none border lg:border-0 border-gray-100 p-5 lg:p-0 lg:grid lg:grid-cols-12 lg:items-center lg:px-8 lg:py-5 hover:bg-primary-50/30 transition-all duration-300">
                                        {/* Clinic Info */}
                                        <div className="col-span-4 flex items-center gap-4 mb-4 lg:mb-0">
                                            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center text-gray-900 font-black shadow-inner border border-white">
                                                {clinic.clinic_name.charAt(0).toUpperCase()}
                                            </div>
                                            <div className="min-w-0">
                                                <h4 className="text-sm font-black text-gray-900 truncate tracking-tight">{clinic.clinic_name}</h4>
                                                <div className="flex items-center gap-1.5 mt-0.5">
                                                    <CalendarIcon className="w-3 h-3 text-gray-400" />
                                                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tight">
                                                        {new Date(clinic.created_at).toLocaleDateString()}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Owner Info */}
                                        <div className="col-span-3 mb-4 lg:mb-0">
                                            <div className="flex flex-col">
                                                <div className="flex items-center gap-1.5">
                                                    <Mail className="w-3.5 h-3.5 text-gray-400" />
                                                    <p className="text-sm font-bold text-gray-800 truncate">{clinic.owner_email}</p>
                                                </div>
                                                <p className="text-[10px] text-gray-400 font-bold uppercase mt-1 pl-5">{clinic.owner_name}</p>
                                            </div>
                                        </div>

                                        {/* Plan Info */}
                                        <div className="col-span-2 mb-6 lg:mb-0">
                                            <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-black bg-blue-50 text-blue-600 border border-blue-100 uppercase tracking-widest shadow-sm">
                                                {clinic.subscription_plan}
                                            </span>
                                        </div>

                                        {/* Action Button */}
                                        <div className="col-span-3 text-right">
                                            <button
                                                onClick={() => handleActivate(clinic.id)}
                                                disabled={activating === clinic.id}
                                                className={cn(
                                                    "w-full lg:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-2xl text-xs font-black uppercase tracking-widest text-white transition-all transform active:scale-95 shadow-lg",
                                                    activating === clinic.id 
                                                        ? "bg-gray-400 cursor-not-allowed" 
                                                        : "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20"
                                                )}
                                            >
                                                {activating === clinic.id ? (
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                ) : (
                                                    <CheckCircle className="w-4 h-4 fill-white text-emerald-600" />
                                                )}
                                                {activating === clinic.id ? 'Activando...' : 'Autorizar Acceso'}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
