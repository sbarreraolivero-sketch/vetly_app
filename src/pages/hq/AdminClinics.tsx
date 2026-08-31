import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
    Search,
    Loader2, RefreshCw, CreditCard,
    Sparkles, Plus, GitBranch, Phone, Mail,
    Users, MessageCircle, Link2, DollarSign, CalendarClock, Mails, MailOpen, User,
    ClipboardList, Package, CalendarCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { normalizePlanId, PLAN_LIMITS, type PlanId } from '@/lib/plans'
import { COUNTRY_INFO, type CountryCode } from '@/lib/countries'

const HQ_ID = '00000000-0000-0000-0000-000000000000'

const PLAN_LABEL: Record<PlanId, string> = {
    core: 'Core',
    starter: 'Starter',
    pro: 'Pro',
    enterprise: 'Enterprise',
}

// Mismo orden en que cron-lifecycle-emails los dispara — para mostrar "paso
// N de 11" y la etiqueta legible del último correo alcanzado. Si se agrega
// un paso nuevo a la secuencia, agregarlo acá también.
const SEQUENCE_STEPS: { key: string; label: string }[] = [
    { key: 'welcome', label: 'Bienvenida' },
    { key: 'paso1_clinica_horarios', label: 'Clínica y horarios' },
    { key: 'paso2_equipo', label: 'Equipo' },
    { key: 'paso3_servicios', label: 'Servicios' },
    { key: 'paso4_inventario', label: 'Inventario' },
    { key: 'paso5_pacientes', label: 'Pacientes' },
    { key: 'paso6_finanzas', label: 'Finanzas' },
    { key: 'paso7_fidelizacion', label: 'Fidelización' },
    { key: 'paso8_recordatorios', label: 'Recordatorios' },
    { key: 'trial_por_terminar', label: 'Aviso: prueba por terminar' },
    { key: 'trial_ultimo_aviso', label: 'Último aviso de prueba' },
]
const SEQUENCE_TOTAL = SEQUENCE_STEPS.length
const stepLabel = (key: string | null) => SEQUENCE_STEPS.find(s => s.key === key)?.label ?? key ?? '—'

interface ClinicActivity {
    clinic_id: string
    patients_count: number
    has_whatsapp: boolean
    has_booking_page: boolean
    incomes_count: number
    incomes_total: number
    appointments_count: number
    services_count: number
    products_count: number
    emails_sent_count: number
    emails_opened_count: number
    last_email_key: string | null
    last_email_sent_at: string | null
    last_sign_in_at: string | null
}

interface ClinicData {
    id: string
    clinic_name: string
    created_at: string
    activation_status: string
    subscription_plan: string
    trial_status: string
    billing_status: string
    currency: string
    timezone: string
    country: string | null
    contact_phone: string | null
    ai_active_model: string
    ai_credits_monthly_mini_used: number
    ai_credits_monthly_limit: number
    ai_credits_extra_balance: number
    ai_credits_monthly_4o_used: number
    ai_credits_monthly_4o_limit: number
    ai_credits_extra_4o: number
}

interface ClinicOwner {
    clinic_id: string
    owner_email: string | null
    owner_name: string | null
    owner_phone: string | null
}

interface ClinicGroup {
    ownerEmail: string
    ownerName: string | null
    primaryClinic: ClinicData
    clinics: ClinicData[]
    ownerPhone: string | null
    totalRealUsed: number
    totalLimit: number
    totalExtra: number
    // Actividad agregada (suma/OR entre sucursales del mismo dueño)
    patientsCount: number
    hasWhatsapp: boolean
    hasBookingPage: boolean
    incomesCount: number
    incomesTotal: number
    appointmentsCount: number
    servicesCount: number
    productsCount: number
    emailsSentCount: number
    emailsOpenedCount: number
    lastEmailKey: string | null
    lastEmailSentAt: string | null
    lastSignInAt: string | null
}

const statusColors: Record<string, { bg: string; text: string; border: string; label: string }> = {
    active: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-100', label: 'Activa' },
    pending_activation: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-100', label: 'Pendiente' },
    inactive: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-100', label: 'Inactiva' },
}

function formatMoney(amount: number, currency: string): string {
    try {
        return new Intl.NumberFormat('es-CL', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
    } catch {
        return `${amount.toLocaleString()} ${currency}`
    }
}

function daysAgo(dateStr: string): number {
    return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000)
}

// "Última actividad" — deliberadamente NO es solo auth.users.last_sign_in_at.
// Ese campo únicamente se actualiza en un login NUEVO; si alguien nunca
// cierra sesión (caso normal, deja la pestaña abierta) queda congelado en la
// fecha de registro para siempre aunque trabaje activamente todos los días
// — caso real detectado por el usuario: una clínica registrada el 27-ago
// seguía cargando pacientes el 31-ago con last_sign_in_at sin cambiar. El
// backend (get_hq_clinic_activity) ya resuelve esto: el valor que llega acá
// es el más reciente entre login real Y cualquier paciente/ingreso/cita/
// servicio/producto creado — actividad real, no solo estado de sesión.
function formatLastSeen(lastActivityAt: string | null, createdAt: string): string {
    if (!lastActivityAt) return 'Nunca se conectó'
    const activityMs = new Date(lastActivityAt).getTime()
    const createdMs = new Date(createdAt).getTime()
    if (activityMs - createdMs < 5 * 60_000) return 'Solo se registró — nunca volvió'
    const date = new Date(lastActivityAt)
    const diffH = Math.floor((Date.now() - date.getTime()) / 3_600_000)
    const relative = diffH < 1 ? 'hace <1h' : diffH < 24 ? `hace ${diffH}h` : `hace ${Math.floor(diffH / 24)}d`
    const exact = date.toLocaleString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    return `${relative} · ${exact}`
}

export default function AdminClinics() {
    const [clinics, setClinics] = useState<ClinicData[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [statusFilter, setStatusFilter] = useState<string>('all')
    const [planFilter, setPlanFilter] = useState<string>('all')

    const [charging, setCharging] = useState<string | null>(null)
    const [chargeAmounts, setChargeAmounts] = useState<Record<string, number>>({})
    const [chargeTargets, setChargeTargets] = useState<Record<string, string>>({})

    const [usageMap, setUsageMap] = useState<Record<string, number>>({})
    const [activityMap, setActivityMap] = useState<Record<string, ClinicActivity>>({})
    const [ownersMap, setOwnersMap] = useState<Record<string, ClinicOwner>>({})

    const fetchClinics = useCallback(async () => {
        setLoading(true)
        try {
            const { data: { session } } = await supabase.auth.getSession()
            if (!session?.access_token) return

            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
            const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

            const [settingsRes, usageRes, activityRes, ownersRes] = await Promise.all([
                fetch(
                    `${supabaseUrl}/rest/v1/clinic_settings?select=*&order=created_at.desc`,
                    {
                        headers: {
                            'apikey': supabaseKey,
                            'Authorization': `Bearer ${session.access_token}`,
                            'Content-Type': 'application/json',
                        },
                    }
                ),
                (supabase as any).rpc('get_monthly_credit_usage_all_clinics'),
                // Actividad en vivo: pacientes, canal WhatsApp, reservas online,
                // ingresos, y progreso de la secuencia de correos de onboarding —
                // un solo round-trip para todas las clínicas (get_hq_clinic_activity).
                (supabase as any).rpc('get_hq_clinic_activity'),
                // Dueño real por clínica (email/nombre/teléfono) vía RPC — el
                // embed directo `clinic_members(...)` vía REST devuelve 0 filas
                // para clínicas ajenas al admin de HQ (ninguna policy SELECT de
                // clinic_members contempla is_platform_admin()), lo que hacía
                // caer al fallback `clinic.id` mostrado como si fuera un email.
                (supabase as any).rpc('get_hq_clinic_owners'),
            ])

            if (!settingsRes.ok) throw new Error(`Error ${settingsRes.status}`)
            const data = await settingsRes.json()
            setClinics((data as ClinicData[]).filter(c => c.id !== HQ_ID))

            const map: Record<string, number> = {}
            for (const row of (usageRes.data || [])) {
                map[row.clinic_id] = Number(row.total_credits)
            }
            setUsageMap(map)

            const actMap: Record<string, ClinicActivity> = {}
            for (const row of (activityRes.data || [])) {
                actMap[row.clinic_id] = row
            }
            setActivityMap(actMap)

            const ownMap: Record<string, ClinicOwner> = {}
            for (const row of (ownersRes.data || [])) {
                ownMap[row.clinic_id] = row
            }
            setOwnersMap(ownMap)
        } catch (err: any) {
            console.error('Error fetching clinics:', err)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { fetchClinics() }, [fetchClinics])

    const handleManualCharge = async (groupKey: string, clinicId: string) => {
        const amount = chargeAmounts[groupKey] ?? 500
        if (!confirm(`¿Cargar ${amount} créditos IA?`)) return

        setCharging(groupKey)
        try {
            const clinic = clinics.find(c => c.id === clinicId)
            const currentVal = clinic?.ai_credits_extra_balance || 0
            const newBalance = currentVal + amount
            const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

            const { error } = await (supabase.from('clinic_settings') as any)
                .update({
                    ai_credits_extra_balance: newBalance,
                    ai_credits_extra_expires_at: expiresAt,
                })
                .eq('id', clinicId)

            if (error) throw error

            await (supabase as any).from('ai_credit_transactions').insert({
                clinic_id: clinicId,
                type: 'purchase',
                amount,
                balance_after: newBalance,
                description: 'Carga manual de créditos IA (HQ)',
                metadata: { expires_at: expiresAt, source: 'hq_manual' }
            })

            const expiryDate = new Date(expiresAt).toLocaleDateString('es-CL', { day: 'numeric', month: 'long' })
            alert(`✅ ${amount} créditos cargados. Vencen el ${expiryDate}.`)
            fetchClinics()
        } catch (err: any) {
            alert('Error: ' + err.message)
        } finally {
            setCharging(null)
        }
    }

    // Group clinics by owner email
    const clinicGroups: ClinicGroup[] = Object.values(
        clinics
            .filter(c => {
                const owner = ownersMap[c.id]
                const matchesSearch = !search ||
                    c.clinic_name?.toLowerCase().includes(search.toLowerCase()) ||
                    owner?.owner_email?.toLowerCase().includes(search.toLowerCase())
                const matchesStatus = statusFilter === 'all' || c.activation_status === statusFilter
                const matchesPlan = planFilter === 'all' || normalizePlanId(c.subscription_plan) === planFilter
                return matchesSearch && matchesStatus && matchesPlan
            })
            .reduce((acc, clinic) => {
                const owner = ownersMap[clinic.id]
                const key = owner?.owner_email || clinic.id
                if (!acc[key]) {
                    acc[key] = {
                        ownerEmail: key,
                        ownerName: owner?.owner_name || null,
                        ownerPhone: owner?.owner_phone || clinic.contact_phone || null,
                        primaryClinic: clinic,
                        clinics: [],
                        totalRealUsed: 0,
                        totalLimit: 0,
                        totalExtra: 0,
                        patientsCount: 0,
                        hasWhatsapp: false,
                        hasBookingPage: false,
                        incomesCount: 0,
                        incomesTotal: 0,
                        appointmentsCount: 0,
                        servicesCount: 0,
                        productsCount: 0,
                        emailsSentCount: 0,
                        emailsOpenedCount: 0,
                        lastEmailKey: null,
                        lastEmailSentAt: null,
                        lastSignInAt: null,
                    }
                }
                const g = acc[key]
                g.clinics.push(clinic)
                g.totalRealUsed += usageMap[clinic.id] || 0
                g.totalLimit += clinic.ai_credits_monthly_limit || 0
                g.totalExtra += clinic.ai_credits_extra_balance || 0
                if ((clinic.ai_credits_monthly_limit || 0) > (g.primaryClinic.ai_credits_monthly_limit || 0)) {
                    g.primaryClinic = clinic
                }

                const act = activityMap[clinic.id]
                if (act) {
                    g.patientsCount += act.patients_count || 0
                    g.hasWhatsapp = g.hasWhatsapp || act.has_whatsapp
                    g.hasBookingPage = g.hasBookingPage || act.has_booking_page
                    g.incomesCount += act.incomes_count || 0
                    g.incomesTotal += act.incomes_total || 0
                    g.appointmentsCount += act.appointments_count || 0
                    g.servicesCount += act.services_count || 0
                    g.productsCount += act.products_count || 0
                    g.emailsSentCount += act.emails_sent_count || 0
                    g.emailsOpenedCount += act.emails_opened_count || 0
                    if (act.last_email_sent_at && (!g.lastEmailSentAt || act.last_email_sent_at > g.lastEmailSentAt)) {
                        g.lastEmailSentAt = act.last_email_sent_at
                        g.lastEmailKey = act.last_email_key
                    }
                    if (act.last_sign_in_at && (!g.lastSignInAt || act.last_sign_in_at > g.lastSignInAt)) {
                        g.lastSignInAt = act.last_sign_in_at
                    }
                }
                return acc
            }, {} as Record<string, ClinicGroup>)
    )

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

    const modelLabel: Record<string, string> = {
        hybrid: 'Híbrido', mini: 'Mini', pro: 'Pro (4o)',
        'gpt-4o': 'Pro (4o)', 'gpt-4o-mini': 'Mini', '4o': 'Pro (4o)',
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
            {/* Banner */}
            <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-[2rem] px-6 py-5 text-white shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-1/3 h-full bg-primary-500/10 blur-[80px] -z-0" />
                <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <span className="px-2.5 py-0.5 bg-primary-500/20 text-primary-400 text-[9px] font-black uppercase tracking-widest rounded-full border border-primary-500/30 mb-2 inline-block">HQ Exclusive</span>
                        <h1 className="text-2xl font-black tracking-tight text-white leading-none">HQ Clínicas</h1>
                        <p className="text-gray-400 font-medium text-xs mt-1">
                            {clinicGroups.length} cliente{clinicGroups.length !== 1 ? 's' : ''} · {clinics.length} sucursal{clinics.length !== 1 ? 'es' : ''} · Actividad en vivo
                        </p>
                    </div>
                    <div className="flex gap-2 flex-wrap items-center">
                        <div className="relative group">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 group-focus-within:text-white transition-all" />
                            <input
                                type="text"
                                placeholder="Buscar clínica o dueño..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl focus:bg-white/10 focus:ring-2 focus:ring-primary-500/20 transition-all text-white placeholder:text-white/20 font-bold text-sm outline-none"
                            />
                        </div>
                        <select
                            value={planFilter}
                            onChange={(e) => setPlanFilter(e.target.value)}
                            className="px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest outline-none text-white cursor-pointer"
                        >
                            <option value="all" className="bg-gray-900">Todos los planes</option>
                            <option value="core" className="bg-gray-900">Core (sin IA)</option>
                            <option value="starter" className="bg-gray-900">Starter</option>
                            <option value="pro" className="bg-gray-900">Pro</option>
                            <option value="enterprise" className="bg-gray-900">Enterprise</option>
                        </select>
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest outline-none text-white cursor-pointer"
                        >
                            <option value="all" className="bg-gray-900">Todos</option>
                            <option value="active" className="bg-gray-900">Activas</option>
                            <option value="pending_activation" className="bg-gray-900">Pendientes</option>
                        </select>
                        <button onClick={fetchClinics} className="p-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all text-white/60 hover:text-white">
                            <RefreshCw className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {clinicGroups.map((group) => {
                    const { primaryClinic, clinics: branches } = group
                    const isMultiBranch = branches.length > 1
                    const groupKey = group.ownerEmail

                    const planId = normalizePlanId(primaryClinic.subscription_plan)
                    const hasAI = PLAN_LIMITS[planId].aiCredits > 0

                    // Strip common prefix from branch names for compact labels
                    const commonPrefix = isMultiBranch
                        ? branches[0].clinic_name.split(' ').filter((word, i) =>
                            branches.every(b => b.clinic_name.split(' ')[i] === word)
                        ).join(' ')
                        : ''
                    const branchLabel = (b: ClinicData) => {
                        const label = commonPrefix ? b.clinic_name.slice(commonPrefix.length).trim() : b.clinic_name
                        return label || b.clinic_name
                    }

                    const chargeAmount = chargeAmounts[groupKey] ?? 500
                    const chargeTarget = chargeTargets[groupKey] ?? primaryClinic.id

                    const totalPool = group.totalLimit + group.totalExtra
                    const usedPct = Math.round((group.totalRealUsed / (totalPool || 1)) * 100)
                    const barColor = usedPct >= 100 ? 'bg-red-500' : usedPct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'

                    const allActive = branches.every(c => c.activation_status === 'active')
                    const anyStatus = allActive ? 'active' : branches[0]?.activation_status

                    const activeModels = [...new Set(branches.map(c => modelLabel[c.ai_active_model] ?? c.ai_active_model ?? 'Híbrido'))]
                    const activeModelLabel = activeModels.join(' · ')
                    const isProModel = branches.some(c => c.ai_active_model === 'pro' || c.ai_active_model === 'gpt-4o' || c.ai_active_model === '4o')

                    const country = primaryClinic.country as CountryCode | null
                    const countryInfo = country ? COUNTRY_INFO[country] : null
                    const stepsCompleted = SEQUENCE_STEPS.filter(s => s.key === group.lastEmailKey).length > 0
                        ? SEQUENCE_STEPS.findIndex(s => s.key === group.lastEmailKey) + 1
                        : group.emailsSentCount // fallback si la clave no matchea ninguna conocida

                    return (
                        <div key={groupKey} className="group bg-white rounded-[2.5rem] border border-gray-100 p-8 flex flex-col gap-6 shadow-sm hover:shadow-2xl hover:-translate-y-1 transition-all duration-500">
                            {/* Header */}
                            <div className="flex items-start justify-between">
                                <div className="flex items-center gap-5">
                                    <div className="w-16 h-16 rounded-[1.5rem] bg-gray-900 flex items-center justify-center text-white font-black text-2xl shadow-xl border-4 border-white">
                                        {primaryClinic.clinic_name?.[0].toUpperCase()}
                                    </div>
                                    <div className="min-w-0">
                                        <h3 className="text-xl font-black text-gray-900 truncate tracking-tight mb-1">
                                            {isMultiBranch
                                                ? primaryClinic.clinic_name.replace(/\s*(Santiago|Linares.*|Talca.*)/i, '').trim() || primaryClinic.clinic_name
                                                : primaryClinic.clinic_name
                                            }
                                        </h3>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            {getStatusBadge(anyStatus)}
                                            <span className={cn(
                                                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black border uppercase tracking-widest",
                                                hasAI ? "bg-violet-50 text-violet-600 border-violet-100" : "bg-gray-100 text-gray-500 border-gray-200"
                                            )}>
                                                <CreditCard className="w-2.5 h-2.5" />
                                                {PLAN_LABEL[planId]}{!hasAI && ' · sin IA'}
                                            </span>
                                            {countryInfo && (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-50 text-gray-600 rounded-full text-[9px] font-black border border-gray-100 uppercase tracking-widest">
                                                    {countryInfo.flag} {countryInfo.name}
                                                </span>
                                            )}
                                            {isMultiBranch && (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full text-[9px] font-black border border-blue-100 uppercase tracking-widest">
                                                    <GitBranch className="w-2.5 h-2.5" />
                                                    {branches.length} sucursales
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="text-right shrink-0">
                                    <p className="text-[9px] font-black text-gray-300 uppercase tracking-widest">Registrada</p>
                                    <p className="text-xs font-bold text-gray-500">hace {daysAgo(primaryClinic.created_at)}d</p>
                                    <p className="text-[9px] font-black text-gray-300 uppercase tracking-widest mt-1.5">Última actividad</p>
                                    <p className={cn("text-[11px] font-bold", group.lastSignInAt ? "text-gray-500" : "text-gray-300")}>{formatLastSeen(group.lastSignInAt, primaryClinic.created_at)}</p>
                                </div>
                            </div>

                            {/* Branch chips (multi-branch only) */}
                            {isMultiBranch && (
                                <div className="flex flex-wrap gap-2">
                                    {branches.map(b => (
                                        <span key={b.id} className="px-3 py-1.5 bg-gray-50 border border-gray-100 rounded-xl text-[10px] font-bold text-gray-600">
                                            {b.clinic_name}
                                        </span>
                                    ))}
                                </div>
                            )}

                            {/* Info grid: dueño + contacto */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-4 bg-gray-50 rounded-2xl">
                                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1 flex items-center gap-1">
                                        <User className="w-2.5 h-2.5" /> Admin
                                    </p>
                                    <p className="text-xs font-bold text-gray-800 truncate">
                                        {group.ownerName || '—'}
                                    </p>
                                    <p className="text-xs font-medium text-gray-500 truncate flex items-center gap-1 mt-1">
                                        <Mail className="w-3 h-3 text-gray-400 shrink-0" />
                                        {/* Sin fila real en clinic_members (raro): el key cae a clinic.id — nunca mostrarlo como si fuera un email */}
                                        {group.ownerEmail.includes('@') ? group.ownerEmail : 'Sin dueño asignado'}
                                    </p>
                                </div>
                                <div className="p-4 bg-gray-50 rounded-2xl">
                                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Contacto</p>
                                    {group.ownerPhone ? (
                                        <a
                                            href={`https://wa.me/${group.ownerPhone.replace(/\D/g, '')}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-xs font-bold text-emerald-600 hover:text-emerald-700 truncate flex items-center gap-1"
                                        >
                                            <Phone className="w-3 h-3 shrink-0" />
                                            {group.ownerPhone}
                                        </a>
                                    ) : (
                                        <p className="text-xs text-gray-400 flex items-center gap-1">
                                            <Phone className="w-3 h-3 shrink-0" />
                                            Sin teléfono
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Actividad en Vetly — el bloque que reemplaza a "créditos IA"
                                para las clínicas sin agente (Core). Se muestra siempre. */}
                            <div className="space-y-3 p-6 bg-gray-50 rounded-[1.8rem] border border-gray-50 shadow-inner">
                                <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                    <CalendarClock className="w-4 h-4 text-primary-500" />
                                    Actividad en Vetly
                                </h4>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                    <div className="flex items-center gap-2 bg-white rounded-xl px-3 py-2.5 border border-gray-100">
                                        <Users className="w-4 h-4 text-gray-400 shrink-0" />
                                        <div>
                                            <p className="text-sm font-black text-gray-900 leading-none">{group.patientsCount}</p>
                                            <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wide">Pacientes</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 bg-white rounded-xl px-3 py-2.5 border border-gray-100">
                                        <CalendarCheck className={cn("w-4 h-4 shrink-0", group.appointmentsCount > 0 ? "text-primary-500" : "text-gray-300")} />
                                        <div>
                                            <p className="text-sm font-black text-gray-900 leading-none">{group.appointmentsCount}</p>
                                            <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wide">Citas agendadas</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 bg-white rounded-xl px-3 py-2.5 border border-gray-100">
                                        <MessageCircle className={cn("w-4 h-4 shrink-0", group.hasWhatsapp ? "text-emerald-500" : "text-gray-300")} />
                                        <div>
                                            <p className={cn("text-sm font-black leading-none", group.hasWhatsapp ? "text-emerald-600" : "text-gray-400")}>
                                                {group.hasWhatsapp ? 'Conectado' : 'Sin conectar'}
                                            </p>
                                            <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wide">WhatsApp</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 bg-white rounded-xl px-3 py-2.5 border border-gray-100">
                                        <ClipboardList className={cn("w-4 h-4 shrink-0", group.servicesCount > 0 ? "text-violet-500" : "text-gray-300")} />
                                        <div>
                                            <p className="text-sm font-black text-gray-900 leading-none">{group.servicesCount}</p>
                                            <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wide">Servicios cargados</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 bg-white rounded-xl px-3 py-2.5 border border-gray-100">
                                        <Package className={cn("w-4 h-4 shrink-0", group.productsCount > 0 ? "text-violet-500" : "text-gray-300")} />
                                        <div>
                                            <p className="text-sm font-black text-gray-900 leading-none">{group.productsCount}</p>
                                            <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wide">Productos inventario</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 bg-white rounded-xl px-3 py-2.5 border border-gray-100">
                                        <Link2 className={cn("w-4 h-4 shrink-0", group.hasBookingPage ? "text-emerald-500" : "text-gray-300")} />
                                        <div>
                                            <p className={cn("text-sm font-black leading-none", group.hasBookingPage ? "text-emerald-600" : "text-gray-400")}>
                                                {group.hasBookingPage ? 'Activa' : 'Inactiva'}
                                            </p>
                                            <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wide">Reservas online</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 bg-white rounded-xl px-3 py-2.5 border border-gray-100">
                                        <DollarSign className="w-4 h-4 text-gray-400 shrink-0" />
                                        <div>
                                            <p className="text-sm font-black text-gray-900 leading-none">{group.incomesCount}</p>
                                            <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wide">
                                                Ingresos{group.incomesTotal > 0 ? ` · ${formatMoney(group.incomesTotal, primaryClinic.currency || 'CLP')}` : ''}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 bg-white rounded-xl px-3 py-2.5 border border-gray-100">
                                        <MailOpen className={cn("w-4 h-4 shrink-0", group.emailsOpenedCount > 0 ? "text-violet-500" : "text-gray-300")} />
                                        <div>
                                            <p className="text-sm font-black text-gray-900 leading-none">{group.emailsOpenedCount}</p>
                                            <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wide">
                                                Correos abiertos{group.emailsSentCount > 0 ? ` / ${group.emailsSentCount}` : ''}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Secuencia de bienvenida — enviados/abiertos, tal como pidió el usuario. */}
                            <div className="space-y-2 p-5 bg-sky-50/40 rounded-[1.5rem] border border-sky-50">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-[10px] font-black text-sky-500 uppercase tracking-widest flex items-center gap-2">
                                        <Mails className="w-4 h-4" />
                                        Secuencia de bienvenida
                                    </h4>
                                    <span className="text-[10px] font-black text-sky-600">{stepsCompleted}/{SEQUENCE_TOTAL}</span>
                                </div>
                                <div className="h-2 w-full bg-sky-100 rounded-full overflow-hidden">
                                    <div className="h-full bg-sky-500 transition-all duration-1000" style={{ width: `${Math.min(100, (stepsCompleted / SEQUENCE_TOTAL) * 100)}%` }} />
                                </div>
                                <div className="flex items-center justify-between text-[10px] font-bold text-sky-700/70">
                                    <span>Último: {stepLabel(group.lastEmailKey)}</span>
                                    <span className="flex items-center gap-1">
                                        <MailOpen className="w-3 h-3" />
                                        {group.emailsOpenedCount} abierto{group.emailsOpenedCount !== 1 ? 's' : ''}
                                    </span>
                                </div>
                            </div>

                            {/* Créditos IA — solo para planes que efectivamente los tienen.
                                Antes se mostraba igual a Core con 0/0, sugiriendo un consumo
                                que Core no puede tener. */}
                            {hasAI && (
                                <>
                                    <div className="space-y-4 p-6 bg-gray-50 rounded-[1.8rem] border border-gray-50 shadow-inner">
                                        <div className="flex items-center justify-between">
                                            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                                <Sparkles className="w-4 h-4 text-primary-500" />
                                                Créditos IA — Mes Actual
                                            </h4>
                                            <div className={cn(
                                                "px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest shadow-sm",
                                                isProModel ? "bg-primary-600 text-white" : "bg-emerald-500 text-white"
                                            )}>
                                                {activeModelLabel}
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <div className="flex justify-between items-end">
                                                <p className="text-[10px] font-black text-gray-500 uppercase tracking-tighter">Consumo real del mes</p>
                                                <p className="text-[10px] font-bold text-gray-500">
                                                    <span className={cn("font-black text-sm", usedPct >= 100 ? "text-red-600" : "text-gray-900")}>
                                                        {group.totalRealUsed.toLocaleString()}
                                                    </span>
                                                    <span className="text-gray-400"> / {totalPool.toLocaleString()}</span>
                                                </p>
                                            </div>
                                            <div className="h-3 w-full bg-gray-200 rounded-full overflow-hidden">
                                                <div
                                                    className={cn("h-full transition-all duration-1000", barColor)}
                                                    style={{ width: `${Math.min(100, usedPct)}%` }}
                                                />
                                            </div>
                                            <div className="flex justify-between">
                                                <p className="text-[9px] text-gray-400 font-bold">
                                                    {group.totalLimit.toLocaleString()} plan
                                                    {group.totalExtra > 0 && ` · ${group.totalExtra.toLocaleString()} extra`}
                                                </p>
                                                <p className={cn("text-[9px] font-black", usedPct >= 100 ? "text-red-500" : usedPct >= 80 ? "text-amber-500" : "text-emerald-600")}>
                                                    {usedPct}% usado
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Credit injection */}
                                    <div className="pt-4 border-t border-gray-50 space-y-3">
                                        <h5 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Inyección de Créditos IA</h5>
                                        <div className="flex gap-3">
                                            {isMultiBranch && (
                                                <select
                                                    value={chargeTarget}
                                                    onChange={(e) => setChargeTargets(prev => ({ ...prev, [groupKey]: e.target.value }))}
                                                    className="bg-gray-50 rounded-xl px-3 text-[10px] font-black uppercase outline-none focus:ring-2 focus:ring-primary-500/20 border-none"
                                                >
                                                    {branches.map(b => (
                                                        <option key={b.id} value={b.id}>
                                                            {branchLabel(b)}
                                                        </option>
                                                    ))}
                                                </select>
                                            )}
                                            <input
                                                type="number"
                                                value={chargeAmount}
                                                onChange={(e) => setChargeAmounts(prev => ({ ...prev, [groupKey]: Number(e.target.value) }))}
                                                className="flex-1 bg-gray-50 rounded-xl px-4 py-3 text-sm font-bold outline-none border-none focus:bg-white shadow-inner transition-all"
                                            />
                                            <button
                                                onClick={() => handleManualCharge(groupKey, chargeTarget)}
                                                disabled={charging === groupKey}
                                                className="bg-gray-900 text-white px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-primary-600 transition-all disabled:bg-gray-200 flex items-center gap-2"
                                            >
                                                {charging === groupKey ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                                                Cargar
                                            </button>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
