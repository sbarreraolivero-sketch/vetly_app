
import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Mail, Shield, User, Clock, Copy, Loader2 } from 'lucide-react'
import { teamService, type ClinicMember } from '@/services/teamService'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { toast } from 'react-hot-toast'

// Plans where max_users can be trusted from clinic_settings.max_users directly.
// These bypass the subscriptions table derivation.
const MANUALLY_TRUSTED_PLANS = new Set(['prestige', 'enterprise'])

// Centralized PLAN_LIMITS — single source of truth for frontend display.
const PLAN_LIMITS: Record<string, { maxUsers: number; maxAgendas: number }> = {
    core:       { maxUsers: 1,      maxAgendas: 1 },
    starter:    { maxUsers: 2,      maxAgendas: 1 },
    pro:        { maxUsers: 5,      maxAgendas: 5 },
    enterprise: { maxUsers: 999999, maxAgendas: 999999 },
    essence:    { maxUsers: 2,      maxAgendas: 1 },
    radiance:   { maxUsers: 5,      maxAgendas: 5 },
    prestige:   { maxUsers: 999999, maxAgendas: 999999 },
}

export default function Team() {
    const { member, profile } = useAuth()
    const [members, setMembers] = useState<ClinicMember[]>([])
    const [loading, setLoading] = useState(true)
    const [isInviteModalOpen, setIsInviteModalOpen] = useState(false)
    const [isInviting, setIsInviting] = useState(false)
    const [inviteEmail, setInviteEmail] = useState('')
    const [inviteRole, setInviteRole] = useState<'admin' | 'professional' | 'receptionist' | 'vet_assistant'>('professional')
    const [inviteName, setInviteName] = useState('')
    const [maxUsers, setMaxUsers] = useState(2)
    const [maxAgendas, setMaxAgendas] = useState(1)
    const [_planName, setPlanName] = useState('freemium')

    const isOwner = member?.role === 'owner' || profile?.role === 'owner'
    const isAdmin = isOwner || member?.role === 'admin' || profile?.role === 'admin'
    const clinicId = member?.clinic_id || profile?.clinic_id

    const activeMembers = members.filter(m => m.status !== 'disabled')
    const currentUsers = activeMembers.length
    const currentAgendas = activeMembers.filter(m => m.role === 'professional').length

    const canInvite = isAdmin && (maxUsers >= 999999 || currentUsers < maxUsers)
    const canAddAgenda = isAdmin && (maxAgendas >= 999999 || currentAgendas < maxAgendas)

    const loadData = useCallback(async () => {
        if (!clinicId) { setLoading(false); return }

        // Clear state immediately — fast visual feedback when switching branches
        setLoading(true)
        setMembers([])

        try {
            // ── Parallel: members + settings + subscription ───────────────
            const [membersResult, settingsResult, subResult] = await Promise.all([
                teamService.getMembers(clinicId).catch(() => [] as ClinicMember[]),
                (supabase as any).from('clinic_settings')
                    .select('id,max_users,subscription_plan,parent_clinic_id')
                    .eq('id', clinicId)
                    .single(),
                (supabase as any).from('subscriptions')
                    .select('plan,status,max_agendas,manually_active')
                    .eq('clinic_id', clinicId)
                    .single(),
            ])

            // Fallback: direct fetch if RPC returned empty
            let membersData = membersResult
            if (!membersData || membersData.length === 0) {
                const { data: direct } = await supabase
                    .from('clinic_members')
                    .select('*')
                    .eq('clinic_id', clinicId)
                membersData = (direct ?? []) as ClinicMember[]
            }

            // Sort: owner first
            setMembers(
                (membersData ?? []).sort((a, b) =>
                    a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : 0
                )
            )

            const settingsData = settingsResult.data
            let subData = subResult.data

            // If this is a branch, fetch the pool-root subscription for accurate limits
            const parentId = settingsData?.parent_clinic_id
            if (parentId && !subData) {
                const { data: parentSub } = await supabase
                    .from('subscriptions')
                    .select('plan,status,max_agendas,manually_active')
                    .eq('clinic_id', parentId)
                    .single()
                subData = parentSub
            }

            // ── Derive limits ─────────────────────────────────────────────
            const resolvedMaxUsers = settingsData?.max_users ?? 2
            const subscriptionPlan = settingsData?.subscription_plan ?? 'freemium'
            const manuallyActive = subData?.manually_active ?? false
            const subPlan = subData?.plan

            if (manuallyActive || MANUALLY_TRUSTED_PLANS.has(subscriptionPlan)) {
                // Trust clinic_settings.max_users directly — manually managed account
                setPlanName(subscriptionPlan)
                setMaxUsers(resolvedMaxUsers)
                setMaxAgendas(resolvedMaxUsers >= 999999 ? 999999 : (subData?.max_agendas ?? 1))
            } else if (subData && subPlan) {
                // Active MercadoPago / LemonSqueezy subscription
                setPlanName(subPlan)
                const limits = PLAN_LIMITS[subPlan]
                if (limits) {
                    setMaxUsers(limits.maxUsers)
                    setMaxAgendas(limits.maxAgendas)
                } else {
                    setMaxUsers(resolvedMaxUsers)
                    setMaxAgendas(subData?.max_agendas ?? 1)
                }
            } else if (settingsData) {
                // No active subscription — use clinic_settings as fallback
                setPlanName(subscriptionPlan)
                const limits = PLAN_LIMITS[subscriptionPlan]
                if (limits) {
                    setMaxUsers(limits.maxUsers)
                    setMaxAgendas(limits.maxAgendas)
                } else {
                    setMaxUsers(resolvedMaxUsers)
                    setMaxAgendas(1)
                }
            }
        } catch (error) {
            console.error('Error loading team data:', error)
            toast.error('Error al cargar el equipo')
        } finally {
            setLoading(false)
        }
    }, [clinicId])

    useEffect(() => { loadData() }, [loadData])

    const handleInvite = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!clinicId || isInviting) return  // prevent double-submit

        if (!canInvite) {
            toast.error(`Has alcanzado el límite de ${maxUsers} usuarios de tu plan.`)
            return
        }
        if (inviteRole === 'professional' && !canAddAgenda) {
            toast.error(`Has alcanzado el límite de ${maxAgendas} agendas de tu plan.`)
            return
        }

        setIsInviting(true)
        try {
            await teamService.inviteMember(clinicId, inviteEmail, inviteRole, inviteName)
            toast.success('Invitación creada correctamente')
            setIsInviteModalOpen(false)
            setInviteEmail('')
            setInviteName('')
            loadData()
        } catch (error: unknown) {
            const errMsg = (error as any)?.message || (error instanceof Error ? error.message : JSON.stringify(error))
            if (errMsg.includes('Plan limit')) {
                toast.error('Has alcanzado el límite de usuarios de tu plan.')
            } else if (errMsg.includes('ya tiene una invitación') || errMsg.includes('miembro activo')) {
                toast.error('Este correo ya fue invitado o es miembro activo.')
            } else if (errMsg.includes('Access denied')) {
                toast.error('No tienes permisos para invitar miembros.')
            } else {
                toast.error(`Error al enviar invitación: ${errMsg}`)
            }
        } finally {
            setIsInviting(false)
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
        } catch (error: unknown) {
            const errMsg = (error as any)?.message || (error instanceof Error ? error.message : JSON.stringify(error))
            toast.error(`Error al eliminar miembro: ${errMsg}`)
        }
    }

    const usersLabel = maxUsers >= 999999 ? 'Ilimitados' : String(maxUsers)

    return (
        <div className="p-6 max-w-6xl mx-auto">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
                <div>
                    <h1 className="text-2xl font-bold text-charcoal">Gestión de Equipo</h1>
                    <p className="text-charcoal/50">Administra los miembros de tu clínica y sus permisos.</p>
                    {!loading && (
                        <p className="text-sm mt-2 font-medium text-purple-600 bg-purple-50 inline-block px-3 py-1 rounded-full">
                            {currentUsers} / {usersLabel} usuarios activos
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
                            className="px-4 py-2 bg-white border border-silk-beige text-charcoal rounded-lg hover:bg-ivory flex items-center gap-2 transition-colors"
                        >
                            <Copy size={20} />
                            Copiar Enlace
                        </button>
                        <button
                            onClick={() => setIsInviteModalOpen(true)}
                            disabled={!canInvite}
                            className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
                                canInvite
                                    ? 'bg-purple-600 text-white hover:bg-purple-700'
                                    : 'bg-silk-beige text-charcoal/40 cursor-not-allowed'
                            }`}
                            title={!canInvite ? 'Límite de usuarios alcanzado' : ''}
                        >
                            <Plus size={20} />
                            Invitar Miembro
                        </button>
                    </div>
                )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-silk-beige overflow-x-auto">
                <table className="w-full min-w-[600px]">
                    <thead className="bg-ivory border-b border-silk-beige">
                        <tr>
                            <th className="text-left py-4 px-6 text-sm font-medium text-charcoal/50">Miembro</th>
                            <th className="text-left py-4 px-6 text-sm font-medium text-charcoal/50">Rol</th>
                            <th className="text-left py-4 px-6 text-sm font-medium text-charcoal/50">Estado</th>
                            <th className="text-left py-4 px-6 text-sm font-medium text-charcoal/50">Fecha Ingreso</th>
                            {isOwner && <th className="text-right py-4 px-6 text-sm font-medium text-charcoal/50">Acciones</th>}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-silk-beige/50">
                        {loading ? (
                            <tr>
                                <td colSpan={5} className="text-center py-12">
                                    <Loader2 className="w-6 h-6 animate-spin text-purple-400 mx-auto" />
                                </td>
                            </tr>
                        ) : members.length === 0 ? (
                            <tr><td colSpan={5} className="text-center py-8 text-charcoal/50">No hay miembros en el equipo.</td></tr>
                        ) : (
                            members.map((m) => (
                                <tr key={m.id} className="hover:bg-ivory/70 transition-colors">
                                    <td className="py-4 px-6">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center text-purple-600 font-medium">
                                                {(m.first_name?.[0] || m.email[0]).toUpperCase()}
                                            </div>
                                            <div>
                                                <p className="font-medium text-charcoal">{m.first_name || 'Sin nombre'}</p>
                                                <p className="text-sm text-charcoal/50">{m.email}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="py-4 px-6">
                                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                                            m.role === 'owner'        ? 'bg-indigo-100 text-indigo-700' :
                                            m.role === 'admin'        ? 'bg-purple-100 text-purple-700' :
                                            m.role === 'professional' ? 'bg-blue-100 text-blue-700' :
                                            'bg-green-100 text-green-700'
                                        }`}>
                                            {(m.role === 'owner' || m.role === 'admin') && <Shield size={12} />}
                                            {m.role === 'professional' && <User size={12} />}
                                            {m.role === 'receptionist' && <Clock size={12} />}
                                            {m.role === 'owner' ? 'Dueño' :
                                             m.role === 'admin' ? 'Administrador' :
                                             m.role === 'professional' ? 'Profesional' :
                                             m.role === 'vet_assistant' ? 'Asistente' : 'Recepción'}
                                        </span>
                                    </td>
                                    <td className="py-4 px-6">
                                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                                            m.status === 'active'  ? 'bg-emerald-100 text-emerald-700' :
                                            m.status === 'invited' ? 'bg-amber-100 text-amber-700' :
                                            'bg-ivory text-charcoal/60'
                                        }`}>
                                            {m.status === 'active' ? 'Activo' : m.status === 'invited' ? 'Invitado' : 'Desactivado'}
                                        </span>
                                    </td>
                                    <td className="py-4 px-6 text-sm text-charcoal/50">
                                        {new Date(m.created_at).toLocaleDateString()}
                                    </td>
                                    {isOwner && (
                                        <td className="py-4 px-6 text-right">
                                            {m.role !== 'owner' && (
                                                <button
                                                    onClick={(e) => handleDelete(e, m.id)}
                                                    className="text-charcoal/40 hover:text-red-600 transition-colors p-2 rounded-full hover:bg-red-50"
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
                        <h2 className="text-xl font-bold text-charcoal mb-4">Invitar Nuevo Miembro</h2>
                        <form onSubmit={handleInvite} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-charcoal mb-1">Correo Electrónico</label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-charcoal/40" size={18} />
                                    <input
                                        type="email"
                                        required
                                        value={inviteEmail}
                                        onChange={(e) => setInviteEmail(e.target.value)}
                                        className="w-full pl-10 pr-4 py-2 border border-silk-beige rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all"
                                        placeholder="correo@ejemplo.com"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-charcoal mb-1">Nombre (Opcional)</label>
                                <input
                                    type="text"
                                    value={inviteName}
                                    onChange={(e) => setInviteName(e.target.value)}
                                    className="w-full px-4 py-2 border border-silk-beige rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all"
                                    placeholder="Nombre del doctor/a"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-charcoal mb-1">Rol</label>
                                <div className="grid grid-cols-2 gap-3">
                                    {isOwner && (
                                        <button type="button" onClick={() => setInviteRole('admin')}
                                            className={`p-3 rounded-lg border text-left transition-all ${inviteRole === 'admin' ? 'border-purple-500 bg-purple-50 ring-1 ring-purple-500' : 'border-silk-beige hover:border-silk-beige/60'}`}>
                                            <div className="font-medium text-charcoal mb-1">Admin</div>
                                            <div className="text-xs text-charcoal/50">Gestiona equipo y calendarios.</div>
                                        </button>
                                    )}
                                    <button type="button" onClick={() => setInviteRole('professional')}
                                        className={`p-3 rounded-lg border text-left transition-all ${inviteRole === 'professional' ? 'border-purple-500 bg-purple-50 ring-1 ring-purple-500' : 'border-silk-beige hover:border-silk-beige/60'}`}>
                                        <div className="font-medium text-charcoal mb-1">Profesional</div>
                                        <div className="text-xs text-charcoal/50">Maneja su agenda y pacientes.</div>
                                    </button>
                                    <button type="button" onClick={() => setInviteRole('receptionist')}
                                        className={`p-3 rounded-lg border text-left transition-all ${inviteRole === 'receptionist' ? 'border-purple-500 bg-purple-50 ring-1 ring-purple-500' : 'border-silk-beige hover:border-silk-beige/60'}`}>
                                        <div className="font-medium text-charcoal mb-1">Recepción</div>
                                        <div className="text-xs text-charcoal/50">Gestiona citas de todo el equipo.</div>
                                    </button>
                                    <button type="button" onClick={() => setInviteRole('vet_assistant')}
                                        className={`p-3 rounded-lg border text-left transition-all ${inviteRole === 'vet_assistant' ? 'border-purple-500 bg-purple-50 ring-1 ring-purple-500' : 'border-silk-beige hover:border-silk-beige/60'}`}>
                                        <div className="font-medium text-charcoal mb-1">Asistente</div>
                                        <div className="text-xs text-charcoal/50">Agendas, pacientes y finanzas.</div>
                                    </button>
                                </div>
                            </div>

                            <div className="pt-4 flex gap-3">
                                <button
                                    type="button"
                                    onClick={() => setIsInviteModalOpen(false)}
                                    disabled={isInviting}
                                    className="flex-1 px-4 py-2 text-charcoal bg-ivory rounded-lg hover:bg-silk-beige/50 transition-colors font-medium disabled:opacity-50"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={isInviting}
                                    className="flex-1 px-4 py-2 text-white bg-purple-600 rounded-lg hover:bg-purple-700 transition-colors font-medium disabled:opacity-70 flex items-center justify-center gap-2"
                                >
                                    {isInviting ? (
                                        <><Loader2 className="w-4 h-4 animate-spin" /> Enviando...</>
                                    ) : (
                                        'Enviar Invitación'
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}
