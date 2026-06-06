
import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Mail, Shield, User, Clock, Copy, Loader2, RotateCcw, X, Lock } from 'lucide-react'
import { teamService, type ClinicMember } from '@/services/teamService'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { toast } from 'react-hot-toast'
import {
    ROLE_DEFAULTS,
    getEffectivePermissions,
    type MemberPermissions,
    type PageKey,
    type ActionKey,
    type UserRole,
} from '@/lib/permissions'

// Plans where max_users can be trusted from clinic_settings.max_users directly.
const MANUALLY_TRUSTED_PLANS = new Set(['prestige', 'enterprise'])

const PLAN_LIMITS: Record<string, { maxUsers: number; maxAgendas: number }> = {
    core:       { maxUsers: 1,      maxAgendas: 1 },
    starter:    { maxUsers: 2,      maxAgendas: 1 },
    pro:        { maxUsers: 5,      maxAgendas: 5 },
    enterprise: { maxUsers: 999999, maxAgendas: 999999 },
    essence:    { maxUsers: 2,      maxAgendas: 1 },
    radiance:   { maxUsers: 5,      maxAgendas: 5 },
    prestige:   { maxUsers: 999999, maxAgendas: 999999 },
}

// ─── Secciones para el modal de permisos ────────────────────────────────────

const PAGE_SECTIONS: { label: string; items: { key: PageKey; label: string }[] }[] = [
    {
        label: 'Principal',
        items: [
            { key: 'dashboard', label: 'Dashboard' },
            { key: 'messages', label: 'Mensajes' },
            { key: 'templates', label: 'Plantillas' },
        ],
    },
    {
        label: 'Clínica',
        items: [
            { key: 'tutors', label: 'Tutores' },
            { key: 'patients', label: 'Pacientes' },
            { key: 'crm', label: 'CRM' },
            { key: 'appointments', label: 'Citas Médicas' },
            { key: 'reminders', label: 'Recordatorios' },
            { key: 'finance', label: 'Finanzas' },
            { key: 'inventory', label: 'Inventario' },
        ],
    },
    {
        label: 'Marketing',
        items: [
            { key: 'campaigns', label: 'Campañas' },
            { key: 'loyalty', label: 'Fidelización' },
        ],
    },
    {
        label: 'Agente IA',
        items: [
            { key: 'knowledge_base', label: 'Base de Conocimiento' },
            { key: 'integrations', label: 'Integraciones' },
            { key: 'ai_settings', label: 'Ajustes IA' },
        ],
    },
    {
        label: 'Configuración',
        items: [{ key: 'settings', label: 'Configuración' }],
    },
]

const ACTION_SECTIONS: { label: string; items: { key: ActionKey; label: string }[] }[] = [
    {
        label: 'Dashboard',
        items: [{ key: 'dashboard_metrics', label: 'Ver métricas resumen del Dashboard' }],
    },
    {
        label: 'Finanzas',
        items: [{ key: 'finance_metrics', label: 'Ver métricas financieras (Ingresos, Gastos, Ganancia, Por cobrar)' }],
    },
    {
        label: 'Pacientes',
        items: [
            { key: 'patients_create', label: 'Crear pacientes' },
            { key: 'patients_edit', label: 'Editar pacientes' },
            { key: 'patients_delete', label: 'Eliminar pacientes' },
        ],
    },
    {
        label: 'Tutores',
        items: [
            { key: 'tutors_create', label: 'Crear tutores' },
            { key: 'tutors_edit', label: 'Editar tutores' },
            { key: 'tutors_delete', label: 'Eliminar tutores' },
        ],
    },
    {
        label: 'Citas Médicas',
        items: [
            { key: 'appointments_create', label: 'Crear citas' },
            { key: 'appointments_edit', label: 'Editar citas' },
            { key: 'appointments_delete', label: 'Eliminar citas' },
        ],
    },
    {
        label: 'Datos',
        items: [{ key: 'export_data', label: 'Exportar datos' }],
    },
]

// ─── Toggle component ────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
    return (
        <button
            type="button"
            onClick={onChange}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none ${
                checked ? 'bg-primary-600' : 'bg-charcoal/20'
            }`}
        >
            <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform ${
                    checked ? 'translate-x-4' : 'translate-x-1'
                }`}
            />
        </button>
    )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = {
    owner: 'Dueño',
    admin: 'Administrador',
    professional: 'Profesional',
    receptionist: 'Recepción',
    vet_assistant: 'Asistente',
}

function hasCustomPermissions(m: ClinicMember): boolean {
    return m.permissions != null
}

// ─── Main component ───────────────────────────────────────────────────────────

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

    // ── Permissions modal state ──────────────────────────────────────────────
    const [permissionsMember, setPermissionsMember] = useState<ClinicMember | null>(null)
    const [editingPerms, setEditingPerms] = useState<MemberPermissions | null>(null)
    const [savingPerms, setSavingPerms] = useState(false)

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

        setLoading(true)
        setMembers([])

        try {
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

            let membersData = membersResult
            if (!membersData || membersData.length === 0) {
                const { data: direct } = await supabase
                    .from('clinic_members')
                    .select('*')
                    .eq('clinic_id', clinicId)
                membersData = (direct ?? []) as ClinicMember[]
            }

            setMembers(
                (membersData ?? []).sort((a, b) =>
                    a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : 0
                )
            )

            const settingsData = settingsResult.data
            let subData = subResult.data

            const parentId = settingsData?.parent_clinic_id
            if (parentId && !subData) {
                const { data: parentSub } = await supabase
                    .from('subscriptions')
                    .select('plan,status,max_agendas,manually_active')
                    .eq('clinic_id', parentId)
                    .single()
                subData = parentSub
            }

            const resolvedMaxUsers = settingsData?.max_users ?? 2
            const subscriptionPlan = settingsData?.subscription_plan ?? 'freemium'
            const manuallyActive = subData?.manually_active ?? false
            const subPlan = subData?.plan

            if (manuallyActive || MANUALLY_TRUSTED_PLANS.has(subscriptionPlan)) {
                setPlanName(subscriptionPlan)
                setMaxUsers(resolvedMaxUsers)
                setMaxAgendas(resolvedMaxUsers >= 999999 ? 999999 : (subData?.max_agendas ?? 1))
            } else if (subData && subPlan) {
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

    // ── Invite ───────────────────────────────────────────────────────────────

    const handleInvite = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!clinicId || isInviting) return

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

    // ── Delete ───────────────────────────────────────────────────────────────

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

    // ── Permissions modal ────────────────────────────────────────────────────

    const openPermissionsModal = (m: ClinicMember) => {
        const effective = getEffectivePermissions(m.role as UserRole, m.permissions ?? null)
        setEditingPerms(effective)
        setPermissionsMember(m)
    }

    const closePermissionsModal = () => {
        setPermissionsMember(null)
        setEditingPerms(null)
    }

    const togglePage = (key: PageKey) => {
        if (!editingPerms) return
        setEditingPerms(prev => prev ? {
            ...prev,
            pages: { ...prev.pages, [key]: !prev.pages[key] },
        } : null)
    }

    const toggleAction = (key: ActionKey) => {
        if (!editingPerms) return
        setEditingPerms(prev => prev ? {
            ...prev,
            actions: { ...prev.actions, [key]: !prev.actions[key] },
        } : null)
    }

    const handleRestoreDefaults = () => {
        if (!permissionsMember) return
        const defaults = ROLE_DEFAULTS[permissionsMember.role as UserRole]
        if (defaults) setEditingPerms(defaults)
    }

    const handleSavePermissions = async () => {
        if (!permissionsMember || !editingPerms) return
        setSavingPerms(true)
        try {
            await teamService.updateMemberPermissions(permissionsMember.id, editingPerms)
            // Update local state immediately
            setMembers(prev => prev.map(m =>
                m.id === permissionsMember.id ? { ...m, permissions: editingPerms } : m
            ))
            toast.success(`Permisos de ${permissionsMember.first_name || permissionsMember.email} guardados`)
            closePermissionsModal()
        } catch (error: unknown) {
            const errMsg = (error as any)?.message || (error instanceof Error ? error.message : JSON.stringify(error))
            toast.error(`Error al guardar permisos: ${errMsg}`)
        } finally {
            setSavingPerms(false)
        }
    }

    // ── Render ───────────────────────────────────────────────────────────────

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
                <table className="w-full min-w-[640px]">
                    <thead className="bg-ivory border-b border-silk-beige">
                        <tr>
                            <th className="text-left py-4 px-6 text-sm font-medium text-charcoal/50">Miembro</th>
                            <th className="text-left py-4 px-6 text-sm font-medium text-charcoal/50">Rol</th>
                            <th className="text-left py-4 px-6 text-sm font-medium text-charcoal/50">Estado</th>
                            <th className="text-left py-4 px-6 text-sm font-medium text-charcoal/50">Fecha Ingreso</th>
                            {isAdmin && <th className="text-right py-4 px-6 text-sm font-medium text-charcoal/50">Acciones</th>}
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
                                                <div className="flex items-center gap-2">
                                                    <p className="font-medium text-charcoal">{m.first_name || 'Sin nombre'}</p>
                                                    {hasCustomPermissions(m) && m.role !== 'owner' && m.role !== 'admin' && (
                                                        <span className="text-[10px] font-bold uppercase tracking-wide text-primary-600 bg-primary-50 px-1.5 py-0.5 rounded">
                                                            Personalizado
                                                        </span>
                                                    )}
                                                </div>
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
                                            {ROLE_LABELS[m.role] ?? m.role}
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
                                    {isAdmin && (
                                        <td className="py-4 px-6 text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                {/* Permissions button: only for non-owner/admin roles */}
                                                {m.role !== 'owner' && m.role !== 'admin' && (
                                                    <button
                                                        onClick={() => openPermissionsModal(m)}
                                                        title="Editar permisos"
                                                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 rounded-lg transition-colors"
                                                    >
                                                        <Lock size={13} />
                                                        Permisos
                                                    </button>
                                                )}
                                                {/* Delete button: only owner can delete */}
                                                {isOwner && m.role !== 'owner' && (
                                                    <button
                                                        onClick={(e) => handleDelete(e, m.id)}
                                                        title="Eliminar miembro"
                                                        className="text-charcoal/40 hover:text-red-600 transition-colors p-2 rounded-full hover:bg-red-50"
                                                    >
                                                        <Trash2 size={18} />
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    )}
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* ── Invite Modal ──────────────────────────────────────────────── */}
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

            {/* ── Permissions Modal ─────────────────────────────────────────── */}
            {permissionsMember && editingPerms && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl flex flex-col max-h-[90vh]">

                        {/* Header */}
                        <div className="flex items-start justify-between px-6 py-5 border-b border-silk-beige shrink-0">
                            <div>
                                <h2 className="text-lg font-bold text-charcoal">
                                    Permisos — {permissionsMember.first_name || permissionsMember.email}
                                </h2>
                                <div className="flex items-center gap-2 mt-1">
                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                                        permissionsMember.role === 'professional' ? 'bg-blue-100 text-blue-700' :
                                        permissionsMember.role === 'receptionist' ? 'bg-green-100 text-green-700' :
                                        'bg-amber-100 text-amber-700'
                                    }`}>
                                        {ROLE_LABELS[permissionsMember.role] ?? permissionsMember.role}
                                    </span>
                                    <span className="text-xs text-charcoal/40">{permissionsMember.email}</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handleRestoreDefaults}
                                    title="Restaurar permisos predeterminados del rol"
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-charcoal/60 hover:text-charcoal bg-ivory hover:bg-silk-beige rounded-lg transition-colors"
                                >
                                    <RotateCcw size={13} />
                                    Restaurar defaults
                                </button>
                                <button onClick={closePermissionsModal} className="p-1.5 text-charcoal/40 hover:text-charcoal transition-colors">
                                    <X size={20} />
                                </button>
                            </div>
                        </div>

                        {/* Scrollable body */}
                        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-8">

                            {/* Secciones de la app */}
                            <div>
                                <h3 className="text-xs font-black uppercase tracking-widest text-charcoal/40 mb-4">
                                    Acceso a secciones
                                </h3>
                                <div className="space-y-5">
                                    {PAGE_SECTIONS.map(section => (
                                        <div key={section.label}>
                                            <p className="text-xs font-bold text-charcoal/50 uppercase tracking-wide mb-2">
                                                {section.label}
                                            </p>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-6">
                                                {section.items.map(item => (
                                                    <div key={item.key} className="flex items-center justify-between py-1">
                                                        <span className="text-sm text-charcoal">{item.label}</span>
                                                        <Toggle
                                                            checked={editingPerms.pages[item.key]}
                                                            onChange={() => togglePage(item.key)}
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Divisor */}
                            <div className="border-t border-silk-beige" />

                            {/* Acciones específicas */}
                            <div>
                                <h3 className="text-xs font-black uppercase tracking-widest text-charcoal/40 mb-4">
                                    Acciones permitidas
                                </h3>
                                <div className="space-y-5">
                                    {ACTION_SECTIONS.map(section => (
                                        <div key={section.label}>
                                            <p className="text-xs font-bold text-charcoal/50 uppercase tracking-wide mb-2">
                                                {section.label}
                                            </p>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-6">
                                                {section.items.map(item => (
                                                    <div key={item.key} className="flex items-center justify-between py-1">
                                                        <span className="text-sm text-charcoal">{item.label}</span>
                                                        <Toggle
                                                            checked={editingPerms.actions[item.key]}
                                                            onChange={() => toggleAction(item.key)}
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="flex gap-3 px-6 py-4 border-t border-silk-beige shrink-0">
                            <button
                                type="button"
                                onClick={closePermissionsModal}
                                disabled={savingPerms}
                                className="flex-1 px-4 py-2 text-charcoal bg-ivory rounded-lg hover:bg-silk-beige/50 transition-colors font-medium disabled:opacity-50"
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                onClick={handleSavePermissions}
                                disabled={savingPerms}
                                className="flex-1 px-4 py-2 text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors font-medium disabled:opacity-70 flex items-center justify-center gap-2"
                            >
                                {savingPerms ? (
                                    <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</>
                                ) : (
                                    'Guardar cambios'
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
