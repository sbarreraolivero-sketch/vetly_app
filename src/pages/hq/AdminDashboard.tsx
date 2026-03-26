import { useState, useEffect } from 'react'
import { CheckCircle, Clock, Search, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAdminAuth } from '@/contexts/AdminAuthContext'

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
            // Use direct fetch to avoid supabase-js AbortController issues
            const { data: { session } } = await supabase.auth.getSession()
            if (!session?.access_token) {
                throw new Error('No active session')
            }

            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
            const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

            const response = await fetch(
                `${supabaseUrl}/rest/v1/clinic_settings?activation_status=eq.pending_activation&select=id,clinic_name,created_at,activation_status,subscription_plan,clinic_members!inner(email,first_name,role)&clinic_members.role=eq.owner&order=created_at.desc`,
                {
                    headers: {
                        'apikey': supabaseKey,
                        'Authorization': `Bearer ${session.access_token}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                    },
                }
            )

            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const data = await response.json()

            type ExpectedData = {
                id: string;
                clinic_name: string;
                created_at: string;
                activation_status: string;
                subscription_plan: string;
                clinic_members: { email: string; first_name: string; role: string }[];
            }[];

            const typedData = data as ExpectedData;

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
            trialEnd.setDate(trialEnd.getDate() + 7) // 7 days from now

            // 1. Update clinic_settings: activate + start trial
            const clinicRes = await fetch(
                `${supabaseUrl}/rest/v1/clinic_settings?id=eq.${clinicId}`,
                {
                    method: 'PATCH',
                    headers,
                    body: JSON.stringify({
                        activation_status: 'active',
                        trial_status: 'running',
                        trial_start_date: now.toISOString(),
                        trial_end_date: trialEnd.toISOString(),
                    }),
                }
            )
            if (!clinicRes.ok) throw new Error(`Clinic update failed: ${clinicRes.status}`)

            // 2. Update subscription record for this clinic
            const subRes = await fetch(
                `${supabaseUrl}/rest/v1/subscriptions?clinic_id=eq.${clinicId}`,
                {
                    method: 'PATCH',
                    headers,
                    body: JSON.stringify({
                        status: 'trial',
                        trial_ends_at: trialEnd.toISOString(),
                        current_period_start: now.toISOString(),
                    }),
                }
            )
            if (!subRes.ok) {
                console.warn('Subscription update failed, trying insert...')
                // If no subscription exists, create one
                const clinic = clinics.find(c => c.id === clinicId)
                await fetch(
                    `${supabaseUrl}/rest/v1/subscriptions`,
                    {
                        method: 'POST',
                        headers: { ...headers, 'Prefer': 'return=minimal' },
                        body: JSON.stringify({
                            clinic_id: clinicId,
                            plan: clinic?.subscription_plan || 'trial',
                            status: 'trial',
                            trial_ends_at: trialEnd.toISOString(),
                            current_period_start: now.toISOString(),
                        }),
                    }
                )
            }

            // 3. Log the activation
            if (adminUser?.id) {
                await fetch(
                    `${supabaseUrl}/rest/v1/activation_logs`,
                    {
                        method: 'POST',
                        headers: { ...headers, 'Prefer': 'return=minimal' },
                        body: JSON.stringify({
                            clinic_id: clinicId,
                            activated_by: adminUser.id,
                            notes: 'Activated via HQ Admin Panel - 7 day trial started',
                        }),
                    }
                )
            }

            // Remove from local state
            setClinics(clinics.filter(c => c.id !== clinicId))
            alert('✅ Clínica activada exitosamente. Trial de 7 días iniciado.')
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

    // Show loading while admin auth is initializing
    if (adminLoading) {
        return (
            <div className="p-8 flex items-center justify-center h-full">
                <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
            </div>
        )
    }

    // Verify role locally just in case, though the layout/guard already handles this
    if (!adminUser) {
        return (
            <div className="p-8 flex items-center justify-center h-full">
                <div className="text-center">
                    <h2 className="text-2xl font-bold text-red-600 mb-2">Acceso Denegado</h2>
                    <p className="text-gray-600">No tienes permisos para ver esta página.</p>
                </div>
            </div>
        )
    }

    return (
        <div className="p-8 max-w-7xl mx-auto">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-gray-900">Panel de Administración</h1>
                    <p className="text-gray-500 mt-1">Gestiona las activaciones pendientes y cuentas de la plataforma.</p>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-6 border-b border-gray-200 flex items-center justify-between gap-4">
                    <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                        <Clock className="w-5 h-5 text-amber-500" />
                        Activaciones Pendientes ({clinics.length})
                    </h2>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Buscar clínica o email..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 min-w-[300px]"
                        />
                    </div>
                </div>

                {loading ? (
                    <div className="p-12 flex justify-center">
                        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
                    </div>
                ) : filteredClinics.length === 0 ? (
                    <div className="p-12 text-center text-gray-500">
                        No hay clínicas pendientes de activación en este momento.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm text-gray-600">
                            <thead className="bg-gray-50 border-b border-gray-200 text-gray-900 uppercase">
                                <tr>
                                    <th className="px-6 py-4 font-medium">Clínica</th>
                                    <th className="px-6 py-4 font-medium">Usuario (Owner)</th>
                                    <th className="px-6 py-4 font-medium">Plan</th>
                                    <th className="px-6 py-4 font-medium">Fecha de Registro</th>
                                    <th className="px-6 py-4 font-medium text-right">Acción</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {filteredClinics.map((clinic) => (
                                    <tr key={clinic.id} className="hover:bg-gray-50/50 transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-lg bg-primary-50 flex items-center justify-center text-primary-700 font-bold">
                                                    {clinic.clinic_name.charAt(0).toUpperCase()}
                                                </div>
                                                <div className="font-medium text-gray-900">{clinic.clinic_name}</div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="font-medium text-gray-900">{clinic.owner_name}</div>
                                            <div className="text-gray-500 text-xs mt-0.5">{clinic.owner_email}</div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 capitalize">
                                                {clinic.subscription_plan}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {new Date(clinic.created_at).toLocaleDateString('es-ES', {
                                                year: 'numeric',
                                                month: 'short',
                                                day: 'numeric',
                                                hour: '2-digit',
                                                minute: '2-digit'
                                            })}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <button
                                                onClick={() => handleActivate(clinic.id)}
                                                disabled={activating === clinic.id}
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-md transition-colors disabled:opacity-50"
                                            >
                                                {activating === clinic.id ? (
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                ) : (
                                                    <CheckCircle className="w-4 h-4" />
                                                )}
                                                Activar Trial
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    )
}
