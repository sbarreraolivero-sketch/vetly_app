import { useState, useEffect, useCallback } from 'react'
import { CheckCircle, Clock, Search, Loader2, RefreshCw, ShieldCheck, Mail, Calendar as CalendarIcon, AlertCircle } from 'lucide-react'
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
    const [error, setError] = useState<string | null>(null)

    const fetchPendingClinics = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const { data: { session } } = await supabase.auth.getSession()
            if (!session?.access_token) return

            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
            const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

            // Usamos una consulta protegida. Si falla el Join de miembros, intentamos una carga simple.
            const response = await fetch(
                `${supabaseUrl}/rest/v1/clinic_settings?activation_status=eq.pending_activation&select=id,clinic_name,created_at,activation_status,subscription_plan,clinic_members(email,first_name,role)&clinic_members.role=eq.owner&order=created_at.desc`,
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
                // Si el error es una recursión RLS (42P17), mostramos un aviso claro
                if (errBody.includes('42P17')) {
                    throw new Error('RECURSION_ERROR: La base de datos tiene un bucle de seguridad. Por favor aplica el fix SQL proporcionado.')
                }
                throw new Error(`Error ${response.status}: ${errBody}`)
            }
            
            const data = await response.json()
            const typedData = data as any[];
            
            const formattedClinics = typedData.map(item => ({
                id: item.id,
                clinic_name: item.clinic_name,
                created_at: item.created_at,
                activation_status: item.activation_status,
                subscription_plan: item.subscription_plan,
                owner_email: item.clinic_members?.[0]?.email || 'Sin Dueño',
                owner_name: item.clinic_members?.[0]?.first_name || 'N/A'
            }))

            setClinics(formattedClinics)
        } catch (error: any) {
            console.error('Error fetching pending clinics:', error)
            setError(error.message)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchPendingClinics()
    }, [fetchPendingClinics])

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
        <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto">
            {/* Page Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl lg:text-3xl font-black text-gray-900 tracking-tight flex items-center gap-3">
                        <ShieldCheck className="w-8 h-8 text-primary-600 lg:w-9 lg:h-9" />
                        Validación y Activación
                    </h1>
                    <p className="text-sm text-gray-500 font-medium mt-1">Nuevas solicitudes de acceso a la plataforma.</p>
                </div>
                {error && (
                    <div className="bg-red-50 border border-red-100 p-4 rounded-2xl flex items-center gap-3 max-w-md animate-bounce">
                        <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
                        <div className="min-w-0">
                            <p className="text-xs font-black text-red-700 uppercase leading-none mb-1">Error de Sistema</p>
                            <p className="text-[10px] text-red-600 font-bold leading-tight">{error}</p>
                        </div>
                        <button onClick={fetchPendingClinics} className="p-2 bg-red-100 text-red-700 rounded-lg"><RefreshCw className="w-3.5 h-3.5" /></button>
                    </div>
                )}
            </div>

            {/* Content Container */}
            <div className="bg-white rounded-3xl border border-gray-200 shadow-sm overflow-hidden flex flex-col min-h-[500px]">
                {/* Search Bar */}
                <div className="p-4 lg:p-6 border-b border-gray-50 bg-gray-50/20">
                    <div className="relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Filtrar activaciones..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-12 pr-4 py-4 bg-white border border-gray-200 rounded-2xl text-sm font-bold focus:ring-4 focus:ring-primary-500/5 focus:border-primary-500 transition-all outline-none"
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {loading ? (
                        <div className="p-20 flex flex-col items-center justify-center gap-3">
                            <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Escaneando base de datos...</p>
                        </div>
                    ) : filteredClinics.length === 0 ? (
                        <div className="p-20 flex flex-col items-center justify-center text-center">
                            <CheckCircle className="w-16 h-16 text-emerald-400 mb-4" />
                            <h3 className="text-lg font-black text-gray-900">Cola Vacía</h3>
                            <p className="text-sm text-gray-500 font-medium mt-2">No hay clínicas esperando validación.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 gap-0 divide-y divide-gray-50">
                            {filteredClinics.map((clinic) => (
                                <div key={clinic.id} className="group p-6 lg:px-8 lg:py-6 lg:grid lg:grid-cols-12 lg:items-center hover:bg-primary-50/30 transition-all duration-300">
                                    <div className="col-span-4 flex items-center gap-5 mb-4 lg:mb-0">
                                        <div className="w-14 h-14 rounded-2xl bg-gray-900 flex items-center justify-center text-white font-black text-xl shadow-lg">
                                            {clinic.clinic_name.charAt(0).toUpperCase()}
                                        </div>
                                        <div className="min-w-0">
                                            <h4 className="text-sm font-black text-gray-900 truncate tracking-tight">{clinic.clinic_name}</h4>
                                            <div className="flex items-center gap-1.5 mt-1">
                                                <CalendarIcon className="w-3.5 h-3.5 text-gray-400" />
                                                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-tight">Registro: {new Date(clinic.created_at).toLocaleDateString()}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="col-span-4 mb-4 lg:mb-0">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-blue-50 rounded-xl">
                                                <Mail className="w-4 h-4 text-blue-600" />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-sm font-bold text-gray-800 truncate">{clinic.owner_email}</p>
                                                <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest mt-0.5">{clinic.owner_name}</p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="col-span-2 mb-6 lg:mb-0 lg:text-center text-center">
                                        <span className="inline-flex px-3 py-1 font-black text-[10px] uppercase tracking-widest bg-emerald-50 text-emerald-600 rounded-full border border-emerald-100">
                                            Plan {clinic.subscription_plan}
                                        </span>
                                    </div>

                                    <div className="col-span-2 text-right">
                                        <button
                                            onClick={() => handleActivate(clinic.id)}
                                            disabled={activating === clinic.id}
                                            className={cn(
                                                "w-full lg:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl text-xs font-black uppercase tracking-widest text-white transition-all transform active:scale-95 shadow-xl",
                                                activating === clinic.id 
                                                    ? "bg-gray-400" 
                                                    : "bg-primary-600 hover:bg-black shadow-primary-600/10"
                                            )}
                                        >
                                            {activating === clinic.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                                            {activating === clinic.id ? 'Refrendando...' : 'Validar'}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
