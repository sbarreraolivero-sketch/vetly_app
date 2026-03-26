import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAdminAuth } from '@/contexts/AdminAuthContext'
import {
    Settings, Shield, Users, Globe, Bell, Loader2, Save, CheckCircle,
    Building2, Calendar, Database, RefreshCw, AlertTriangle
} from 'lucide-react'

interface PlatformAdmin {
    id: string
    email: string
    role: string
    created_at: string
}

interface PlatformStats {
    totalClinics: number
    activeClinics: number
    totalPatients: number
    totalAppointments: number
    totalMembers: number
}

export default function AdminSettings() {
    const { adminUser } = useAdminAuth()
    const [admins, setAdmins] = useState<PlatformAdmin[]>([])
    const [stats, setStats] = useState<PlatformStats | null>(null)
    const [loading, setLoading] = useState(true)
    const [activeTab, setActiveTab] = useState<'general' | 'admins' | 'platform'>('general')
    const [newAdminEmail, setNewAdminEmail] = useState('')
    const [addingAdmin, setAddingAdmin] = useState(false)
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

    const fetchData = useCallback(async () => {
        setLoading(true)
        try {
            const { data: { session } } = await supabase.auth.getSession()
            if (!session?.access_token) return

            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
            const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY
            const headers = {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
            }

            // Fetch platform admins
            const adminsRes = await fetch(
                `${supabaseUrl}/rest/v1/platform_admins?select=id,email,role,created_at&order=created_at.asc`,
                { headers }
            )
            if (adminsRes.ok) {
                const adminsData = await adminsRes.json()
                setAdmins(adminsData)
            }

            // Fetch platform stats
            const [clinicsRes, patientsRes, appointmentsRes, membersRes] = await Promise.all([
                fetch(`${supabaseUrl}/rest/v1/clinic_settings?select=id,activation_status`, { headers }),
                fetch(`${supabaseUrl}/rest/v1/patients?select=id`, { headers: { ...headers, 'Prefer': 'count=exact' } }),
                fetch(`${supabaseUrl}/rest/v1/appointments?select=id`, { headers: { ...headers, 'Prefer': 'count=exact' } }),
                fetch(`${supabaseUrl}/rest/v1/clinic_members?select=id`, { headers: { ...headers, 'Prefer': 'count=exact' } }),
            ])

            const clinicsData = clinicsRes.ok ? await clinicsRes.json() : []
            const patientsCount = parseInt(patientsRes.headers.get('content-range')?.split('/')[1] || '0')
            const appointmentsCount = parseInt(appointmentsRes.headers.get('content-range')?.split('/')[1] || '0')
            const membersCount = parseInt(membersRes.headers.get('content-range')?.split('/')[1] || '0')

            setStats({
                totalClinics: clinicsData.length,
                activeClinics: clinicsData.filter((c: any) => c.activation_status === 'active').length,
                totalPatients: patientsCount || 0,
                totalAppointments: appointmentsCount || 0,
                totalMembers: membersCount || 0,
            })
        } catch (err) {
            console.error('Error fetching settings data:', err)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchData()
    }, [fetchData])

    const handleAddAdmin = async () => {
        if (!newAdminEmail.trim()) return
        setAddingAdmin(true)
        setMessage(null)

        try {
            const { data: { session } } = await supabase.auth.getSession()
            if (!session?.access_token) throw new Error('No session')

            // First look up the user by email in auth
            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
            const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

            // Check if admin already exists
            const existing = admins.find(a => a.email.toLowerCase() === newAdminEmail.trim().toLowerCase())
            if (existing) {
                setMessage({ type: 'error', text: 'Este usuario ya es administrador.' })
                return
            }

            // Insert into platform_admins using RPC or direct insert
            // Note: This requires knowing the user's UUID. For now, we'll try to find it via user_profiles
            const userRes = await fetch(
                `${supabaseUrl}/rest/v1/user_profiles?email=eq.${encodeURIComponent(newAdminEmail.trim())}&select=id,email`,
                {
                    headers: {
                        'apikey': supabaseKey,
                        'Authorization': `Bearer ${session.access_token}`,
                    },
                }
            )

            if (!userRes.ok) throw new Error('Error buscando usuario')
            const users = await userRes.json()

            if (!users || users.length === 0) {
                setMessage({ type: 'error', text: 'No se encontró un usuario registrado con ese email.' })
                return
            }

            // Insert into platform_admins
            const insertRes = await fetch(
                `${supabaseUrl}/rest/v1/platform_admins`,
                {
                    method: 'POST',
                    headers: {
                        'apikey': supabaseKey,
                        'Authorization': `Bearer ${session.access_token}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'return=representation',
                    },
                    body: JSON.stringify({
                        id: users[0].id,
                        email: users[0].email,
                        role: 'super_admin',
                    }),
                }
            )

            if (!insertRes.ok) {
                const errText = await insertRes.text()
                throw new Error(`Error al agregar: ${errText}`)
            }

            setMessage({ type: 'success', text: `${newAdminEmail.trim()} agregado como administrador.` })
            setNewAdminEmail('')
            fetchData()
        } catch (err: any) {
            setMessage({ type: 'error', text: err.message || 'Error al agregar administrador.' })
        } finally {
            setAddingAdmin(false)
        }
    }

    const tabs = [
        { id: 'general' as const, label: 'General', icon: Settings },
        { id: 'admins' as const, label: 'Administradores', icon: Shield },
        { id: 'platform' as const, label: 'Plataforma', icon: Database },
    ]

    if (loading) {
        return (
            <div className="p-8 flex items-center justify-center h-full">
                <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
            </div>
        )
    }

    return (
        <div className="p-6 lg:p-8 max-w-6xl mx-auto">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-gray-900">Configuración</h1>
                <p className="text-gray-500 mt-1">Administra la configuración global de la plataforma Vetly AI.</p>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-6 w-fit">
                {tabs.map((tab) => {
                    const Icon = tab.icon
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${activeTab === tab.id
                                ? 'bg-white text-gray-900 shadow-sm'
                                : 'text-gray-500 hover:text-gray-700'
                                }`}
                        >
                            <Icon className="w-4 h-4" />
                            {tab.label}
                        </button>
                    )
                })}
            </div>

            {/* Message */}
            {message && (
                <div className={`mb-6 p-4 rounded-xl text-sm flex items-center gap-2 ${message.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                    {message.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                    {message.text}
                </div>
            )}

            {/* General Tab */}
            {activeTab === 'general' && (
                <div className="space-y-6">
                    {/* Platform Stats */}
                    <div className="bg-white rounded-xl border border-gray-200 p-6">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                            <Globe className="w-5 h-5 text-primary-500" />
                            Resumen de la Plataforma
                        </h3>
                        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                            <div className="bg-gray-50 rounded-lg p-4 text-center">
                                <Building2 className="w-6 h-6 text-blue-500 mx-auto mb-2" />
                                <p className="text-2xl font-bold text-gray-900">{stats?.totalClinics || 0}</p>
                                <p className="text-xs text-gray-500">Clínicas Total</p>
                            </div>
                            <div className="bg-gray-50 rounded-lg p-4 text-center">
                                <CheckCircle className="w-6 h-6 text-emerald-500 mx-auto mb-2" />
                                <p className="text-2xl font-bold text-gray-900">{stats?.activeClinics || 0}</p>
                                <p className="text-xs text-gray-500">Clínicas Activas</p>
                            </div>
                            <div className="bg-gray-50 rounded-lg p-4 text-center">
                                <Users className="w-6 h-6 text-purple-500 mx-auto mb-2" />
                                <p className="text-2xl font-bold text-gray-900">{stats?.totalMembers || 0}</p>
                                <p className="text-xs text-gray-500">Miembros</p>
                            </div>
                            <div className="bg-gray-50 rounded-lg p-4 text-center">
                                <Users className="w-6 h-6 text-orange-500 mx-auto mb-2" />
                                <p className="text-2xl font-bold text-gray-900">{stats?.totalPatients || 0}</p>
                                <p className="text-xs text-gray-500">Pacientes</p>
                            </div>
                            <div className="bg-gray-50 rounded-lg p-4 text-center">
                                <Calendar className="w-6 h-6 text-teal-500 mx-auto mb-2" />
                                <p className="text-2xl font-bold text-gray-900">{stats?.totalAppointments || 0}</p>
                                <p className="text-xs text-gray-500">Citas</p>
                            </div>
                        </div>
                    </div>

                    {/* Current Admin Info */}
                    <div className="bg-white rounded-xl border border-gray-200 p-6">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                            <Shield className="w-5 h-5 text-primary-500" />
                            Tu Cuenta
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-500 mb-1">Email</label>
                                <p className="text-sm text-gray-900 bg-gray-50 px-4 py-2.5 rounded-lg">{adminUser?.email}</p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-500 mb-1">Rol</label>
                                <p className="text-sm text-gray-900 bg-gray-50 px-4 py-2.5 rounded-lg">Super Admin</p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-500 mb-1">ID</label>
                                <p className="text-sm text-gray-900 bg-gray-50 px-4 py-2.5 rounded-lg font-mono text-xs">{adminUser?.id}</p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-500 mb-1">Última sesión</label>
                                <p className="text-sm text-gray-900 bg-gray-50 px-4 py-2.5 rounded-lg">
                                    {adminUser?.last_sign_in_at
                                        ? new Date(adminUser.last_sign_in_at).toLocaleString('es-ES')
                                        : 'N/A'}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Admins Tab */}
            {activeTab === 'admins' && (
                <div className="space-y-6">
                    {/* Add Admin */}
                    <div className="bg-white rounded-xl border border-gray-200 p-6">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                            <Users className="w-5 h-5 text-primary-500" />
                            Agregar Administrador
                        </h3>
                        <p className="text-sm text-gray-500 mb-4">
                            El usuario debe tener una cuenta registrada en Vetly AI para poder agregarlo como administrador.
                        </p>
                        <div className="flex gap-3">
                            <input
                                type="email"
                                placeholder="email@ejemplo.com"
                                value={newAdminEmail}
                                onChange={(e) => setNewAdminEmail(e.target.value)}
                                className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                            />
                            <button
                                onClick={handleAddAdmin}
                                disabled={addingAdmin || !newAdminEmail.trim()}
                                className="flex items-center gap-2 px-5 py-2.5 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {addingAdmin ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                Agregar
                            </button>
                        </div>
                    </div>

                    {/* Admin List */}
                    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-100">
                            <h3 className="text-lg font-semibold text-gray-900">
                                Administradores de la Plataforma ({admins.length})
                            </h3>
                        </div>
                        <div className="divide-y divide-gray-50">
                            {admins.map((admin) => (
                                <div key={admin.id} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50/50 transition-colors">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-primary-50 flex items-center justify-center">
                                            <Shield className="w-5 h-5 text-primary-600" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium text-gray-900">{admin.email}</p>
                                            <p className="text-xs text-gray-400">
                                                Desde {new Date(admin.created_at).toLocaleDateString('es-ES')}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="text-xs px-2.5 py-1 rounded-full bg-purple-50 text-purple-700 font-medium capitalize">
                                            {admin.role?.replace('_', ' ')}
                                        </span>
                                        {admin.id === adminUser?.id && (
                                            <span className="text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-700 font-medium">
                                                Tú
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Platform Tab */}
            {activeTab === 'platform' && (
                <div className="space-y-6">
                    <div className="bg-white rounded-xl border border-gray-200 p-6">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                            <Database className="w-5 h-5 text-primary-500" />
                            Información de la Plataforma
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-500 mb-1">URL de Supabase</label>
                                <p className="text-sm text-gray-900 bg-gray-50 px-4 py-2.5 rounded-lg font-mono text-xs truncate">
                                    {import.meta.env.VITE_SUPABASE_URL}
                                </p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-500 mb-1">Versión de la App</label>
                                <p className="text-sm text-gray-900 bg-gray-50 px-4 py-2.5 rounded-lg">v2.0.0</p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-500 mb-1">Ambiente</label>
                                <p className="text-sm text-gray-900 bg-gray-50 px-4 py-2.5 rounded-lg">
                                    {import.meta.env.MODE === 'production' ? 'Producción' : 'Desarrollo'}
                                </p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-500 mb-1">Framework</label>
                                <p className="text-sm text-gray-900 bg-gray-50 px-4 py-2.5 rounded-lg">React + Vite + Supabase</p>
                            </div>
                        </div>
                    </div>

                    {/* Quick Actions */}
                    <div className="bg-white rounded-xl border border-gray-200 p-6">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                            <Bell className="w-5 h-5 text-primary-500" />
                            Acciones Rápidas
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <button
                                onClick={fetchData}
                                className="flex items-center gap-3 p-4 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors text-left"
                            >
                                <RefreshCw className="w-5 h-5 text-blue-500" />
                                <div>
                                    <p className="text-sm font-medium text-gray-900">Refrescar Datos</p>
                                    <p className="text-xs text-gray-500">Actualizar las estadísticas de la plataforma</p>
                                </div>
                            </button>
                            <a
                                href={`${import.meta.env.VITE_SUPABASE_URL?.replace('.supabase.co', '')}.supabase.co/project/default`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-3 p-4 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors text-left"
                            >
                                <Database className="w-5 h-5 text-emerald-500" />
                                <div>
                                    <p className="text-sm font-medium text-gray-900">Panel de Supabase</p>
                                    <p className="text-xs text-gray-500">Abrir el panel de administración de la base de datos</p>
                                </div>
                            </a>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
