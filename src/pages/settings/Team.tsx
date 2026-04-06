
import { useState, useEffect } from 'react'
import { Plus, Trash2, Mail, Shield, User, Clock, Copy } from 'lucide-react'
import { teamService, type ClinicMember } from '@/services/teamService'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { toast } from 'react-hot-toast'

export default function Team() {
    const { member, profile } = useAuth()
    const [members, setMembers] = useState<ClinicMember[]>([])
    const [loading, setLoading] = useState(true)
    const [isInviteModalOpen, setIsInviteModalOpen] = useState(false)
    const [inviteEmail, setInviteEmail] = useState('')
    const [inviteRole, setInviteRole] = useState<'admin' | 'professional' | 'receptionist' | 'vet_assistant'>('professional')
    const [inviteName, setInviteName] = useState('')
    const [maxUsers, setMaxUsers] = useState(2) // Default to Essence minimum
    const [maxAgendas, setMaxAgendas] = useState(1) // Default to Essence minimum
    const [planName, setPlanName] = useState('freemium')

    // Centralized plan limits — SINGLE SOURCE OF TRUTH
    const PLAN_LIMITS: Record<string, { maxUsers: number; maxAgendas: number }> = {
        essence:  { maxUsers: 2,      maxAgendas: 1 },
        radiance: { maxUsers: 5,      maxAgendas: 5 },
        prestige: { maxUsers: 999999, maxAgendas: 999999 },
    }

    // Fallback to profile check if member context is missing
    const isOwner = member?.role === 'owner' || profile?.role === 'owner'
    const isAdmin = isOwner || member?.role === 'admin' || profile?.role === 'admin'
    const clinicId = member?.clinic_id || profile?.clinic_id

    const activeMembers = members.filter(m => m.status !== 'disabled')
    const currentUsers = activeMembers.length
    const currentAgendas = activeMembers.filter(m => m.role === 'professional').length

    const canInvite = isAdmin && currentUsers < maxUsers
    const canAddAgenda = isAdmin && currentAgendas < maxAgendas

    useEffect(() => {
        console.log('Team Page - Clinic ID Changed:', clinicId)
        if (clinicId) loadData()
    }, [clinicId])

    const loadData = async () => {
        if (!clinicId) {
            setLoading(false)
            return
        }

        try {
            console.log('Loading team data for clinic:', clinicId)

            // 1. Get Members (Try RPC, fallback to direct)
            let membersData: ClinicMember[] = []
            try {
                membersData = await teamService.getMembers(clinicId)
            } catch (rpcError) {
                console.warn('RPC check failed, fetching directly:', rpcError)
            }

            // If RPC returned empty or failed, try direct fetch (Safety Net)
            if (!membersData || membersData.length === 0) {
                const { data: directMembers, error: directError } = await supabase
                    .from('clinic_members')
                    .select('*')
                    .eq('clinic_id', clinicId)

                if (!directError && directMembers) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    membersData = directMembers as any[]
                }
            }

            console.log('Final Members List:', membersData)

            // Sort: Owner first, then by date
            const sortedMembers = (membersData || []).sort((a, b) => {
                if (a.role === 'owner' && b.role !== 'owner') return -1
                if (a.role !== 'owner' && b.role === 'owner') return 1
                return 0
            })
            setMembers(sortedMembers)

            // 2. Get Settings & Subscription (Source of Truth)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let settingsData: any = null
            try {
                settingsData = await teamService.getClinicSettings(clinicId)
            } catch (e) {
                console.warn('getClinicSettings RPC failed:', e)
            }

            if (!settingsData) {
                const { data: directSettings } = await supabase.from('clinic_settings').select('*').eq('id', clinicId).single()
                if (directSettings) settingsData = directSettings
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: subData, error: subError } = await supabase
                .from('subscriptions')
                .select('*')
                .eq('clinic_id', clinicId)
                .single() as any

            console.log('Settings:', settingsData, 'Sub:', subData, 'SubError:', subError)

            if (subData) {
                // Subscription table is the ultimate authority
                const plan = subData.plan || 'essence'
                setPlanName(plan)

                // Use centralized PLAN_LIMITS as source of truth
                const limits = PLAN_LIMITS[plan]
                if (limits) {
                    setMaxUsers(limits.maxUsers)
                    setMaxAgendas(limits.maxAgendas)
                } else {
                    // Unknown plan — fallback to DB values or safe defaults
                    setMaxUsers(settingsData?.max_users || 2)
                    setMaxAgendas(subData.max_agendas || 1)
                }
            } else if (settingsData) {
                // No subscription row — use clinic_settings as fallback
                const plan = settingsData.subscription_plan || 'freemium'
                setPlanName(plan)
                const limits = PLAN_LIMITS[plan]
                if (limits) {
                    setMaxUsers(limits.maxUsers)
                    setMaxAgendas(limits.maxAgendas)
                } else {
                    setMaxUsers(settingsData.max_users || 2)
                    setMaxAgendas(1)
                }
            }

        } catch (error) {
            console.error('Error loading team data:', error)
            toast.error('Error al cargar el equipo')
        } finally {
            setLoading(false)
        }
    }

    const handleInvite = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!clinicId) return

        if (!canInvite) {
            toast.error(`Has alcanzado el límite de ${maxUsers} usuarios de tu plan ${planName}.`)
            return
        }

        if (inviteRole === 'professional' && !canAddAgenda) {
            toast.error(`Has alcanzado el límite de ${maxAgendas} agendas (profesionales) de tu plan ${planName}.`)
            return
        }

        try {
            await teamService.inviteMember(clinicId, inviteEmail, inviteRole, inviteName)
            toast.success('Invitación creada correctamente')
            setIsInviteModalOpen(false)
            setInviteEmail('')
            setInviteName('')
            loadData()
        } catch (error) {
            console.error('Error inviting member:', error)
            // Error handling improved in service/RPC but good to keep fallback
            toast.error('Error al enviar invitación. Verifica el límite de tu plan.')
        }
    }

    const handleDelete = async (e: React.MouseEvent, id: string) => {
        e.preventDefault()
        e.stopPropagation()

        if (!confirm('¿Estás seguro de eliminar este miembro?')) return
        try {
            await teamService.deleteMember(id)
            toast.success('Miembro eliminado')
            loadData()
        } catch (error) {
            console.error('Error deleting member:', error)
            toast.error('Error al eliminar miembro')
        }
    }

    return (
        <div className="p-6 max-w-6xl mx-auto">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Gestión de Equipo</h1>
                    <p className="text-gray-500">Administra los miembros de tu clínica y sus permisos.</p>
                    {!loading && (
                        <p className="text-sm mt-2 font-medium text-purple-600 bg-purple-50 inline-block px-3 py-1 rounded-full">
                            {members.filter(m => m.status !== 'disabled').length} / {maxUsers >= 999 ? 'Ilimitados' : maxUsers} usuarios activos
                        </p>
                    )}
                </div>
                {isAdmin && (
                    <div className="flex gap-3">
                        <button
                            onClick={() => {
                                navigator.clipboard.writeText(`${window.location.origin}/register?mode=join&clinic=${clinicId}`)
                                toast.success('Enlace de registro copiado al portapapeles')
                            }}
                            className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 flex items-center gap-2 transition-colors"
                            title="Copiar enlace para que los miembros se registren ellos mismos"
                        >
                            <Copy size={20} />
                            Copiar Enlace
                        </button>
                        <button
                            onClick={() => setIsInviteModalOpen(true)}
                            disabled={!canInvite}
                            className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${canInvite
                                ? 'bg-purple-600 text-white hover:bg-purple-700'
                                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                }`}
                            title={!canInvite ? 'Límite de usuarios alcanzado' : ''}
                        >
                            <Plus size={20} />
                            Invitar Miembro
                        </button>
                    </div>
                )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
                <table className="w-full min-w-[600px]">
                    <thead className="bg-gray-50 border-b border-gray-100">
                        <tr>
                            <th className="text-left py-4 px-6 text-sm font-medium text-gray-500">Miembro</th>
                            <th className="text-left py-4 px-6 text-sm font-medium text-gray-500">Rol</th>
                            <th className="text-left py-4 px-6 text-sm font-medium text-gray-500">Estado</th>
                            <th className="text-left py-4 px-6 text-sm font-medium text-gray-500">Fecha Ingreso</th>
                            {isOwner && <th className="text-right py-4 px-6 text-sm font-medium text-gray-500">Acciones</th>}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {loading ? (
                            <tr><td colSpan={5} className="text-center py-8">Cargando...</td></tr>
                        ) : members.length === 0 ? (
                            <tr><td colSpan={5} className="text-center py-8 text-gray-500">No hay miembros en el equipo.</td></tr>
                        ) : (
                            members.map((m) => (
                                <tr key={m.id} className="hover:bg-gray-50/50 transition-colors">
                                    <td className="py-4 px-6">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center text-purple-600 font-medium">
                                                {(m.first_name?.[0] || m.email[0]).toUpperCase()}
                                            </div>
                                            <div>
                                                <p className="font-medium text-gray-900">{m.first_name || 'Sin nombre'}</p>
                                                <p className="text-sm text-gray-500">{m.email}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="py-4 px-6">
                                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
                                            ${m.role === 'owner' ? 'bg-indigo-100 text-indigo-700' :
                                                m.role === 'admin' ? 'bg-purple-100 text-purple-700' :
                                                    m.role === 'professional' ? 'bg-blue-100 text-blue-700' :
                                                        'bg-green-100 text-green-700'}`}>
                                            {(m.role === 'owner' || m.role === 'admin') && <Shield size={12} />}
                                            {m.role === 'professional' && <User size={12} />}
                                            {m.role === 'receptionist' && <Clock size={12} />}
                                            {m.role === 'owner' ? 'Dueño' : m.role === 'admin' ? 'Administrador' : m.role === 'professional' ? 'Profesional' : m.role === 'vet_assistant' ? 'Asistente' : 'Recepción'}
                                        </span>
                                    </td>
                                    <td className="py-4 px-6">
                                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
                                            ${m.status === 'active' ? 'bg-emerald-100 text-emerald-700' :
                                                m.status === 'invited' ? 'bg-amber-100 text-amber-700' :
                                                    'bg-gray-100 text-gray-700'}`}>
                                            {m.status === 'active' ? 'Activo' : m.status === 'invited' ? 'Invitado' : 'Desactivado'}
                                        </span>
                                    </td>
                                    <td className="py-4 px-6 text-sm text-gray-500">
                                        {new Date(m.created_at).toLocaleDateString()}
                                    </td>
                                    {isOwner && (
                                        <td className="py-4 px-6 text-right">
                                            {m.role !== 'owner' && (
                                                <button
                                                    onClick={(e) => handleDelete(e, m.id)}
                                                    className="text-gray-400 hover:text-red-600 transition-colors p-2 rounded-full hover:bg-red-50"
                                                    title="Eliminar miembro"
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            )}
                                        </td>
                                    )}
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Invite Modal */}
            {isInviteModalOpen && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
                        <h2 className="text-xl font-bold text-gray-900 mb-4">Invitar Nuevo Miembro</h2>
                        <form onSubmit={handleInvite} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Correo Electrónico</label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                    <input
                                        type="email"
                                        required
                                        value={inviteEmail}
                                        onChange={(e) => setInviteEmail(e.target.value)}
                                        className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all"
                                        placeholder="correo@ejemplo.com"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre (Opcional)</label>
                                <input
                                    type="text"
                                    value={inviteName}
                                    onChange={(e) => setInviteName(e.target.value)}
                                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all"
                                    placeholder="Nombre del doctor/a"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Rol</label>
                                <div className="grid grid-cols-2 gap-3">
                                    {isOwner && (
                                        <button
                                            type="button"
                                            onClick={() => setInviteRole('admin')}
                                            className={`p-3 rounded-lg border text-left transition-all ${inviteRole === 'admin' ? 'border-purple-500 bg-purple-50 ring-1 ring-purple-500' : 'border-gray-200 hover:border-gray-300'}`}
                                        >
                                            <div className="font-medium text-gray-900 mb-1">Admin</div>
                                            <div className="text-xs text-gray-500">Gestiona equipo y calendarios. Máx 2.</div>
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => setInviteRole('professional')}
                                        className={`p-3 rounded-lg border text-left transition-all ${inviteRole === 'professional' ? 'border-purple-500 bg-purple-50 ring-1 ring-purple-500' : 'border-gray-200 hover:border-gray-300'}`}
                                    >
                                        <div className="font-medium text-gray-900 mb-1">Profesional</div>
                                        <div className="text-xs text-gray-500">Maneja su agenda y pacientes.</div>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setInviteRole('receptionist')}
                                        className={`p-3 rounded-lg border text-left transition-all ${inviteRole === 'receptionist' ? 'border-purple-500 bg-purple-50 ring-1 ring-purple-500' : 'border-gray-200 hover:border-gray-300'}`}
                                    >
                                        <div className="font-medium text-gray-900 mb-1">Recepción</div>
                                        <div className="text-xs text-gray-500">Gestiona citas de todo el equipo.</div>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setInviteRole('vet_assistant')}
                                        className={`p-3 rounded-lg border text-left transition-all ${inviteRole === 'vet_assistant' ? 'border-purple-500 bg-purple-50 ring-1 ring-purple-500' : 'border-gray-200 hover:border-gray-300'}`}
                                    >
                                        <div className="font-medium text-gray-900 mb-1">Asistente</div>
                                        <div className="text-xs text-gray-500">Agendas, pacientes y finanzas.</div>
                                    </button>
                                </div>
                            </div>

                            <div className="pt-4 flex gap-3">
                                <button
                                    type="button"
                                    onClick={() => setIsInviteModalOpen(false)}
                                    className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="flex-1 px-4 py-2 text-white bg-purple-600 rounded-lg hover:bg-purple-700 transition-colors font-medium"
                                >
                                    Enviar Invitación
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

        </div>
    )
}
