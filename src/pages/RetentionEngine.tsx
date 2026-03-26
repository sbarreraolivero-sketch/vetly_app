import { useState, useEffect, useMemo } from 'react'
import { RetentionSettingsModal } from '@/components/retention/RetentionSettingsModal'
import {
    ShieldAlert,
    TrendingUp,
    TrendingDown,
    DollarSign,
    Users,
    AlertTriangle,
    CheckCircle2,
    Clock,
    RefreshCw,
    Download,
    ChevronDown,
    Loader2,
    Search,
    Phone,
    Sparkles,
    Activity,
    ArrowUpRight,
    Filter,
    Crown,
    Eye,
    X,
    Settings,
    MessageSquare
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { PremiumFeature } from '@/components/common/PremiumFeature'
import { retentionService, type RetentionDashboardStats, type PatientAtRisk, type AIAction } from '@/services/retentionService'
import { toast } from 'react-hot-toast'

// ── Helpers ──────────────────────────────────────────────────────────

const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', minimumFractionDigits: 0 }).format(amount)

const getRiskColor = (level: string) => {
    switch (level) {
        case 'low': return 'text-emerald-600 bg-emerald-50 border-emerald-200'
        case 'medium': return 'text-amber-600 bg-amber-50 border-amber-200'
        case 'high': return 'text-red-600 bg-red-50 border-red-200'
        default: return 'text-charcoal/60 bg-ivory border-silk-beige'
    }
}

const getTemplateInfo = (templateName: string) => {
    const map: Record<string, { name: string, desc: string }> = {
        'retention_warning_soft': { name: 'Recordatorio Amable', desc: 'Mensaje suave recordándole agendar su control.' },
        'retention_miss_you': { name: 'Te extrañamos', desc: 'Mensaje emotivo enfocado en la relación.' },
        'retention_checkup': { name: 'Revisión Necesaria', desc: 'Recordatorio clínico profesional.' },
        'retention_danger_offer': { name: 'Oferta de Retorno', desc: 'Ofrece un incentivo (descuento) para volver.' },
        'retention_urgent_care': { name: 'Atención Pendiente', desc: 'Sentido de urgencia por salud.' },
        'retention_vip_comeback': { name: 'Invitación VIP', desc: 'Trato exclusivo para clientes VIP.' }
    }

    if (map[templateName]) return map[templateName]

    // Smart fallback for dynamic YCloud templates
    return {
        name: templateName?.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') || 'Plantilla Personalizada',
        desc: 'Plantilla de YCloud'
    }
}

const getRiskDot = (level: string) => {
    switch (level) {
        case 'low': return 'bg-emerald-500'
        case 'medium': return 'bg-amber-500'
        case 'high': return 'bg-red-500'
        default: return 'bg-charcoal/30'
    }
}

const getRiskLabel = (level: string) => {
    switch (level) {
        case 'low': return 'Bajo'
        case 'medium': return 'Medio'
        case 'high': return 'Alto'
        default: return level
    }
}

const getRiskIcon = (level: string) => {
    switch (level) {
        case 'low': return <CheckCircle2 className="w-4 h-4" />
        case 'medium': return <Clock className="w-4 h-4" />
        case 'high': return <AlertTriangle className="w-4 h-4" />
        default: return null
    }
}

// ── Component ────────────────────────────────────────────────────────

const RetentionEngine = () => {
    const { profile, member } = useAuth()
    const clinicId = member?.clinic_id || profile?.clinic_id
    const clinicName = (member as any)?.clinic_name || (profile as any)?.clinic_name || 'Clínica'


    // State
    const [stats, setStats] = useState<RetentionDashboardStats | null>(null)
    const [patients, setPatients] = useState<PatientAtRisk[]>([])
    const [loadingToAction] = useState<string | null>(null)
    const [isSettingsOpen, setIsSettingsOpen] = useState(false)
    const [pendingActions, setPendingActions] = useState<AIAction[]>([])
    const [actionLog, setActionLog] = useState<AIAction[]>([])
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [riskFilter, setRiskFilter] = useState<string | null>(null)
    const [searchTerm, setSearchTerm] = useState('')
    const [activeTab, setActiveTab] = useState<'overview' | 'patients' | 'actions'>('overview')
    const [showFilterDropdown, setShowFilterDropdown] = useState(false)

    // Fetch data
    const fetchData = async () => {
        if (!clinicId) return
        try {
            const [statsData, patientsData, pendingData, logData] = await Promise.all([
                retentionService.getDashboardStats(clinicId),
                retentionService.getPatientsAtRisk(clinicId, riskFilter as any),
                retentionService.getPendingActions(clinicId),
                retentionService.getActionLog(clinicId)
            ])
            setStats(statsData)
            setPatients(patientsData)
            setPendingActions(pendingData)
            setActionLog(logData)
        } catch (err) {
            console.error('Error fetching retention data:', err)
            toast.error('Error al cargar datos de retención')
        } finally {
            setLoading(false)
        }
    }

    // Actions
    const handleApprove = async (id: string) => {
        try {
            await retentionService.approveAction(id)
            toast.success('Acción aprobada para ejecución')
            // Refresh local state without full reload
            setPendingActions(prev => prev.filter(p => p.id !== id))
            // Add to log optimistically (status approved)
            const approved = pendingActions.find(p => p.id === id)
            if (approved) setActionLog(prev => [{ ...approved, status: 'approved', created_at: new Date().toISOString() }, ...prev])
        } catch (err) {
            toast.error('Error al aprobar acción')
        }
    }

    const handleReject = async (id: string) => {
        try {
            await retentionService.rejectAction(id)
            toast.success('Acción rechazada')
            setPendingActions(prev => prev.filter(p => p.id !== id))
        } catch (err) {
            toast.error('Error al rechazar acción')
        }
    }

    useEffect(() => {
        fetchData()
    }, [clinicId, riskFilter])

    // Refresh scores
    const handleRefresh = async () => {
        if (!clinicId) return
        setRefreshing(true)
        try {
            const count = await retentionService.computeScores(clinicId)
            toast.success(`Scores actualizados para ${count} pacientes`)
            await fetchData()
        } catch (err) {
            console.error('Error refreshing scores:', err)
            toast.error('Error al recalcular scores')
        } finally {
            setRefreshing(false)
        }
    }

    // Export
    const handleExport = () => {
        retentionService.exportCSV(patients, clinicName)
        toast.success('CSV exportado')
    }

    // Filtered patients
    const filteredPatients = useMemo(() => {
        if (!searchTerm) return patients
        const term = searchTerm.toLowerCase()
        return patients.filter(p =>
            (p.patient_name || '').toLowerCase().includes(term) ||
            p.phone_number.includes(term) ||
            (p.last_service || '').toLowerCase().includes(term)
        )
    }, [patients, searchTerm])

    // Donut chart data
    const donutData = useMemo(() => {
        if (!stats) return { low: 0, medium: 0, high: 0, total: 0 }
        return {
            low: stats.patients_low,
            medium: stats.patients_medium,
            high: stats.patients_high,
            total: stats.total_patients
        }
    }, [stats])

    // Health index (inverse of avg score, 0-100)
    const healthIndex = stats ? Math.max(0, 100 - stats.avg_score) : 100

    if (loading) {
        return (
            <div className="flex items-center justify-center h-96">
                <div className="text-center">
                    <Loader2 className="w-8 h-8 animate-spin text-primary-500 mx-auto mb-3" />
                    <p className="text-charcoal/60 text-sm">Cargando Revenue Control Center...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-xl flex items-center justify-center shadow-lg shadow-violet-500/20">
                            <ShieldAlert className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-charcoal">Revenue Control Center</h1>
                            <p className="text-sm text-charcoal/50">Revenue Retention Engine™ — Vetly AI AI</p>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={handleRefresh}
                        disabled={refreshing}
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-silk-beige rounded-xl text-sm text-charcoal hover:bg-ivory transition-colors disabled:opacity-50"
                    >
                        <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
                        {refreshing ? 'Calculando...' : 'Recalcular'}
                    </button>
                    <button
                        onClick={handleExport}
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-silk-beige rounded-xl text-sm text-charcoal hover:bg-ivory transition-colors"
                    >
                        <Download className="w-4 h-4" />
                        Exportar
                    </button>
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Revenue at Risk */}
                <div className="card-soft p-5 border-l-4 border-red-400">
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-medium text-charcoal/50 uppercase tracking-wider">Ingresos en Riesgo</span>
                        <div className="w-8 h-8 bg-red-50 rounded-lg flex items-center justify-center">
                            <TrendingDown className="w-4 h-4 text-red-500" />
                        </div>
                    </div>
                    <p className="text-2xl font-bold text-red-600">
                        {formatCurrency(stats?.revenue_at_risk || 0)}
                    </p>
                    <p className="text-xs text-charcoal/40 mt-1">
                        {stats?.patients_high || 0} pacientes alto riesgo
                    </p>
                </div>

                {/* Clients at Risk */}
                <div className="card-soft p-5 border-l-4 border-amber-400">
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-medium text-charcoal/50 uppercase tracking-wider">Pacientes en Riesgo</span>
                        <div className="w-8 h-8 bg-amber-50 rounded-lg flex items-center justify-center">
                            <AlertTriangle className="w-4 h-4 text-amber-500" />
                        </div>
                    </div>
                    <p className="text-2xl font-bold text-amber-600">
                        {(stats?.patients_medium || 0) + (stats?.patients_high || 0)}
                    </p>
                    <p className="text-xs text-charcoal/40 mt-1">
                        {stats?.patients_medium || 0} medio + {stats?.patients_high || 0} alto
                    </p>
                </div>

                {/* Recovery Potential */}
                <div className="card-soft p-5 border-l-4 border-blue-400">
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-medium text-charcoal/50 uppercase tracking-wider">Potencial Recuperable</span>
                        <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
                            <TrendingUp className="w-4 h-4 text-blue-500" />
                        </div>
                    </div>
                    <p className="text-2xl font-bold text-blue-600">
                        {formatCurrency(stats?.revenue_recoverable || 0)}
                    </p>
                    <p className="text-xs text-charcoal/40 mt-1">
                        {(stats?.patients_medium || 0) + (stats?.patients_high || 0)} pacientes
                    </p>
                </div>

                {/* Revenue Recovered */}
                <div className="card-soft p-5 border-l-4 border-emerald-400">
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-medium text-charcoal/50 uppercase tracking-wider">Recuperado por IA</span>
                        <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center">
                            <Sparkles className="w-4 h-4 text-emerald-500" />
                        </div>
                    </div>
                    <PremiumFeature requiredPlan="prestige" showLock>
                        <p className="text-2xl font-bold text-emerald-600">
                            {formatCurrency(stats?.revenue_recovered_month || 0)}
                        </p>
                        <p className="text-xs text-charcoal/40 mt-1">Este mes</p>
                    </PremiumFeature>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 bg-white/60 p-1 rounded-xl border border-silk-beige w-fit">
                {[
                    { id: 'overview', label: 'Resumen', icon: Activity },
                    { id: 'patients', label: 'Pacientes', icon: Users },
                    { id: 'actions', label: 'Acciones IA', icon: Sparkles },
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as any)}
                        className={cn(
                            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
                            activeTab === tab.id
                                ? 'bg-white text-charcoal shadow-sm'
                                : 'text-charcoal/50 hover:text-charcoal'
                        )}
                    >
                        <tab.icon className="w-4 h-4" />
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Tab: Overview */}
            {activeTab === 'overview' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Retention Distribution */}
                    <div className="card-soft p-6 lg:col-span-2">
                        <h3 className="text-lg font-semibold text-charcoal mb-6">Distribución de Retención</h3>
                        <div className="flex flex-col sm:flex-row items-center gap-8">
                            {/* Visual Donut (CSS-based) */}
                            <div className="relative w-48 h-48 flex-shrink-0">
                                <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                                    {/* Background circle */}
                                    <circle cx="50" cy="50" r="40" fill="none" stroke="#f0ece6" strokeWidth="12" />
                                    {/* Low (green) */}
                                    {donutData.total > 0 && (
                                        <>
                                            <circle
                                                cx="50" cy="50" r="40" fill="none"
                                                stroke="#10b981" strokeWidth="12"
                                                strokeDasharray={`${(donutData.low / donutData.total) * 251.2} 251.2`}
                                                strokeDashoffset="0"
                                                className="transition-all duration-700"
                                            />
                                            <circle
                                                cx="50" cy="50" r="40" fill="none"
                                                stroke="#f59e0b" strokeWidth="12"
                                                strokeDasharray={`${(donutData.medium / donutData.total) * 251.2} 251.2`}
                                                strokeDashoffset={`${-(donutData.low / donutData.total) * 251.2} `}
                                                className="transition-all duration-700"
                                            />
                                            <circle
                                                cx="50" cy="50" r="40" fill="none"
                                                stroke="#ef4444" strokeWidth="12"
                                                strokeDasharray={`${(donutData.high / donutData.total) * 251.2} 251.2`}
                                                strokeDashoffset={`${-((donutData.low + donutData.medium) / donutData.total) * 251.2} `}
                                                className="transition-all duration-700"
                                            />
                                        </>
                                    )}
                                </svg>
                                <div className="absolute inset-0 flex flex-col items-center justify-center">
                                    <span className="text-3xl font-bold text-charcoal">{donutData.total}</span>
                                    <span className="text-xs text-charcoal/50">pacientes</span>
                                </div>
                            </div>
                            {/* Legend */}
                            <div className="flex-1 space-y-5">
                                {[
                                    { label: 'Riesgo Bajo', count: donutData.low, color: 'bg-emerald-500', desc: 'Pacientes al día con sus citas' },
                                    { label: 'Riesgo Medio', count: donutData.medium, color: 'bg-amber-500', desc: 'Se están retrasando en su retorno' },
                                    { label: 'Riesgo Alto', count: donutData.high, color: 'bg-red-500', desc: 'Riesgo de pérdida inminente' },
                                ].map(item => (
                                    <div key={item.label} className="flex items-center gap-4">
                                        <div className={cn("w-3 h-3 rounded-full flex-shrink-0", item.color)} />
                                        <div className="flex-1">
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm font-medium text-charcoal">{item.label}</span>
                                                <span className="text-sm font-bold text-charcoal">{item.count}</span>
                                            </div>
                                            <p className="text-xs text-charcoal/40">{item.desc}</p>
                                            {donutData.total > 0 && (
                                                <div className="mt-1.5 h-1.5 bg-ivory rounded-full overflow-hidden">
                                                    <div
                                                        className={cn("h-full rounded-full transition-all duration-700", item.color)}
                                                        style={{ width: `${(item.count / donutData.total) * 100}% ` }}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Health Index */}
                    <div className="card-soft p-6 flex flex-col">
                        <h3 className="text-lg font-semibold text-charcoal mb-4">Índice de Salud</h3>
                        <div className="flex-1 flex flex-col items-center justify-center">
                            <div className="relative w-36 h-36">
                                <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                                    <circle cx="50" cy="50" r="42" fill="none" stroke="#f0ece6" strokeWidth="8" />
                                    <circle
                                        cx="50" cy="50" r="42" fill="none"
                                        stroke={healthIndex >= 70 ? '#10b981' : healthIndex >= 40 ? '#f59e0b' : '#ef4444'}
                                        strokeWidth="8"
                                        strokeDasharray={`${(healthIndex / 100) * 263.9} 263.9`}
                                        strokeLinecap="round"
                                        className="transition-all duration-1000"
                                    />
                                </svg>
                                <div className="absolute inset-0 flex flex-col items-center justify-center">
                                    <span className={cn(
                                        "text-4xl font-bold",
                                        healthIndex >= 70 ? 'text-emerald-600' : healthIndex >= 40 ? 'text-amber-600' : 'text-red-600'
                                    )}>
                                        {Math.round(healthIndex)}
                                    </span>
                                    <span className="text-xs text-charcoal/40">/ 100</span>
                                </div>
                            </div>
                            <p className="text-sm text-charcoal/60 mt-4 text-center">
                                {healthIndex >= 70 ? '🟢 Excelente retención' : healthIndex >= 40 ? '🟡 Retención moderada' : '🔴 Retención crítica'}
                            </p>
                        </div>

                        {/* Key Metric */}
                        <div className="border-t border-silk-beige pt-4 mt-4">
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-charcoal/50">Score Promedio</span>
                                <span className="text-sm font-semibold text-charcoal">{Math.round(stats?.avg_score || 0)}</span>
                            </div>
                            <div className="flex items-center justify-between mt-2">
                                <span className="text-xs text-charcoal/50">Último cálculo</span>
                                <span className="text-xs text-charcoal/40">
                                    {stats?.last_computed_at
                                        ? new Date(stats.last_computed_at).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })
                                        : 'Nunca'
                                    }
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Quick List — Top at risk */}
                    <div className="card-soft p-6 lg:col-span-3">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-charcoal">Top Pacientes en Riesgo</h3>
                            <button
                                onClick={() => setActiveTab('patients')}
                                className="text-sm text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1"
                            >
                                Ver todos <ArrowUpRight className="w-3.5 h-3.5" />
                            </button>
                        </div>
                        {patients.filter(p => p.risk_level !== 'low').length === 0 ? (
                            <div className="text-center py-10">
                                <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
                                <p className="text-charcoal/60 font-medium">¡Todos los pacientes están al día!</p>
                                <p className="text-sm text-charcoal/40 mt-1">No hay pacientes en riesgo actualmente</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-silk-beige">
                                            <th className="text-left py-3 px-4 font-medium text-charcoal/50">Paciente</th>
                                            <th className="text-left py-3 px-4 font-medium text-charcoal/50">Score</th>
                                            <th className="text-left py-3 px-4 font-medium text-charcoal/50">Riesgo</th>
                                            <th className="text-left py-3 px-4 font-medium text-charcoal/50">Retraso</th>
                                            <th className="text-left py-3 px-4 font-medium text-charcoal/50">Último Servicio</th>
                                            <th className="text-left py-3 px-4 font-medium text-charcoal/50">Ticket Prom.</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {patients
                                            .filter(p => p.risk_level !== 'low')
                                            .slice(0, 5)
                                            .map(patient => (
                                                <tr key={patient.patient_id} className="border-b border-silk-beige/50 hover:bg-ivory/50 transition-colors">
                                                    <td className="py-3 px-4">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center text-xs font-medium text-primary-700">
                                                                {(patient.patient_name || '?')[0].toUpperCase()}
                                                            </div>
                                                            <div>
                                                                <p className="font-medium text-charcoal">{patient.patient_name || 'Sin nombre'}</p>
                                                                <p className="text-xs text-charcoal/40">{patient.phone_number}</p>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="py-3 px-4">
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-16 h-2 bg-ivory rounded-full overflow-hidden">
                                                                <div
                                                                    className={cn(
                                                                        "h-full rounded-full transition-all",
                                                                        patient.score <= 40 ? 'bg-emerald-500' :
                                                                            patient.score <= 70 ? 'bg-amber-500' : 'bg-red-500'
                                                                    )}
                                                                    style={{ width: `${patient.score}% ` }}
                                                                />
                                                            </div>
                                                            <span className="text-xs font-mono font-bold text-charcoal">{patient.score}</span>
                                                        </div>
                                                    </td>
                                                    <td className="py-3 px-4">
                                                        <span className={cn(
                                                            "inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border",
                                                            getRiskColor(patient.risk_level)
                                                        )}>
                                                            {getRiskIcon(patient.risk_level)}
                                                            {getRiskLabel(patient.risk_level)}
                                                        </span>
                                                    </td>
                                                    <td className="py-3 px-4">
                                                        <span className="text-sm font-medium text-charcoal">
                                                            +{patient.delay_days}d
                                                        </span>
                                                    </td>
                                                    <td className="py-3 px-4">
                                                        <span className="text-sm text-charcoal/70">{patient.last_service || '-'}</span>
                                                    </td>
                                                    <td className="py-3 px-4">
                                                        <span className="text-sm font-medium text-charcoal">{formatCurrency(patient.avg_ticket)}</span>
                                                    </td>
                                                </tr>
                                            ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Tab: Patients */}
            {activeTab === 'patients' && (
                <div className="card-soft p-6">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                        <h3 className="text-lg font-semibold text-charcoal">Todos los Pacientes</h3>
                        <div className="flex items-center gap-3">
                            {/* Search */}
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal/30" />
                                <input
                                    type="text"
                                    placeholder="Buscar paciente..."
                                    value={searchTerm}
                                    onChange={e => setSearchTerm(e.target.value)}
                                    className="pl-10 pr-4 py-2 bg-ivory border border-silk-beige rounded-xl text-sm text-charcoal w-64 focus:ring-2 focus:ring-primary-500/20 focus:border-primary-300 outline-none transition-all"
                                />
                            </div>
                            {/* Filter */}
                            <div className="relative">
                                <button
                                    onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                                    className={cn(
                                        "flex items-center gap-2 px-4 py-2 border rounded-xl text-sm font-medium transition-all",
                                        riskFilter ? getRiskColor(riskFilter) : 'bg-white border-silk-beige text-charcoal hover:bg-ivory'
                                    )}
                                >
                                    <Filter className="w-4 h-4" />
                                    {riskFilter ? getRiskLabel(riskFilter) : 'Filtrar'}
                                    <ChevronDown className="w-3.5 h-3.5" />
                                </button>
                                {showFilterDropdown && (
                                    <>
                                        <div className="fixed inset-0 z-10" onClick={() => setShowFilterDropdown(false)} />
                                        <div className="absolute right-0 mt-2 bg-white border border-silk-beige rounded-xl shadow-soft-lg py-1 z-20 w-44">
                                            <button
                                                onClick={() => { setRiskFilter(null); setShowFilterDropdown(false) }}
                                                className="w-full text-left px-4 py-2.5 text-sm hover:bg-ivory transition-colors flex items-center gap-2"
                                            >
                                                <Eye className="w-4 h-4 text-charcoal/40" /> Todos
                                            </button>
                                            {(['high', 'medium', 'low'] as const).map(level => (
                                                <button
                                                    key={level}
                                                    onClick={() => { setRiskFilter(level); setShowFilterDropdown(false) }}
                                                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-ivory transition-colors flex items-center gap-2"
                                                >
                                                    <div className={cn("w-2.5 h-2.5 rounded-full", getRiskDot(level))} />
                                                    {getRiskLabel(level)}
                                                </button>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Table */}
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-silk-beige bg-ivory/50">
                                    <th className="text-left py-3 px-4 font-medium text-charcoal/50">Paciente</th>
                                    <th className="text-left py-3 px-4 font-medium text-charcoal/50">Score</th>
                                    <th className="text-left py-3 px-4 font-medium text-charcoal/50">Riesgo</th>
                                    <th className="text-left py-3 px-4 font-medium text-charcoal/50">Días sin visita</th>
                                    <th className="text-left py-3 px-4 font-medium text-charcoal/50">Retraso</th>
                                    <th className="text-left py-3 px-4 font-medium text-charcoal/50">Último Servicio</th>
                                    <th className="text-left py-3 px-4 font-medium text-charcoal/50">Última Visita</th>
                                    <th className="text-left py-3 px-4 font-medium text-charcoal/50">Ticket Prom.</th>
                                    <th className="text-left py-3 px-4 font-medium text-charcoal/50">Visitas</th>
                                    <th className="text-left py-3 px-4 font-medium text-charcoal/50">VIP</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredPatients.length === 0 ? (
                                    <tr>
                                        <td colSpan={10} className="text-center py-10 text-charcoal/50">
                                            No se encontraron pacientes
                                        </td>
                                    </tr>
                                ) : (
                                    filteredPatients.map(patient => (
                                        <tr key={patient.patient_id} className="border-b border-silk-beige/50 hover:bg-ivory/50 transition-colors">
                                            <td className="py-3 px-4">
                                                <div className="flex items-center gap-2.5">
                                                    <div className={cn(
                                                        "w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium",
                                                        patient.risk_level === 'high' ? 'bg-red-100 text-red-700' :
                                                            patient.risk_level === 'medium' ? 'bg-amber-100 text-amber-700' :
                                                                'bg-emerald-100 text-emerald-700'
                                                    )}>
                                                        {(patient.patient_name || '?').charAt(0).toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <p className="font-medium text-charcoal text-sm">{patient.patient_name || 'Sin nombre'}</p>
                                                        <p className="text-xs text-charcoal/40 flex items-center gap-1">
                                                            <Phone className="w-3 h-3" />
                                                            {patient.phone_number ? (
                                                                <a
                                                                    href={`https://wa.me/${patient.phone_number.replace(/\D/g, '')}`}
                                                                    target="_blank"
                                                                    rel="noreferrer"
                                                                    className="hover:text-primary-600 hover:underline transition-colors"
                                                                >
                                                                    {patient.phone_number}
                                                                </a >
                                                            ) : (
                                                                <span className="text-charcoal/30">Sin teléfono</span>
                                                            )}
                                                        </p >
                                                    </div >
                                                </div >
                                            </td >
                                            <td className="py-3 px-4">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-14 h-1.5 bg-ivory rounded-full overflow-hidden">
                                                        <div
                                                            className={cn(
                                                                "h-full rounded-full",
                                                                patient.score <= 40 ? 'bg-emerald-500' :
                                                                    patient.score <= 70 ? 'bg-amber-500' : 'bg-red-500'
                                                            )}
                                                            style={{ width: `${patient.score}%` }}
                                                        />
                                                    </div>
                                                    <span className="text-xs font-mono font-bold">{patient.score}</span>
                                                </div>
                                            </td>
                                            <td className="py-3 px-4">
                                                <span className={cn(
                                                    "inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border",
                                                    getRiskColor(patient.risk_level)
                                                )}>
                                                    {getRiskLabel(patient.risk_level)}
                                                </span>
                                            </td>
                                            <td className="py-3 px-4 text-sm text-charcoal/70">{patient.days_since_last_visit}d</td>
                                            <td className="py-3 px-4">
                                                <span className={cn(
                                                    "text-sm font-medium",
                                                    patient.delay_days > 0 ? 'text-red-600' : 'text-emerald-600'
                                                )}>
                                                    {patient.delay_days > 0 ? `+${patient.delay_days}d` : `${patient.delay_days}d`}
                                                </span>
                                            </td>
                                            <td className="py-3 px-4 text-sm text-charcoal/70">{patient.last_service || '-'}</td>
                                            <td className="py-3 px-4 text-sm text-charcoal/70">{patient.last_visit_date || '-'}</td>
                                            <td className="py-3 px-4 text-sm font-medium text-charcoal">{formatCurrency(patient.avg_ticket)}</td>
                                            <td className="py-3 px-4 text-sm text-charcoal/70">{patient.total_visits}</td>
                                            <td className="py-3 px-4">
                                                {patient.is_vip && <Crown className="w-4 h-4 text-amber-500" />}
                                            </td>
                                        </tr >
                                    ))
                                )}
                            </tbody >
                        </table >
                    </div >
                </div >
            )}

            {/* Tab: AI Actions */}
            {
                activeTab === 'actions' && (
                    <PremiumFeature requiredPlan="prestige" showLock>
                        <div className="space-y-6">
                            {/* Header & Configuration */}
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-lg font-bold text-charcoal flex items-center gap-2">
                                        <Sparkles className="w-5 h-5 text-emerald-500" />
                                        Centro de Comando de IA
                                    </h3>
                                    <p className="text-sm text-charcoal/60">
                                        Gestiona las interacciones automatizadas con tus pacientes.
                                    </p>
                                </div>
                                <button
                                    onClick={() => setIsSettingsOpen(true)}
                                    className="px-4 py-2 bg-white border border-silk-beige rounded-xl text-sm font-medium text-charcoal hover:bg-ivory transition-colors flex items-center gap-2 shadow-sm"
                                >
                                    <Settings className="w-4 h-4 text-charcoal/70" />
                                    Configurar Motor
                                </button>
                            </div>
                            {/* Pending Actions (Approval Queue) */}
                            <div className="card-soft p-6 border-l-4 border-amber-400">
                                <div className="flex items-center justify-between mb-4">
                                    <div>
                                        <h3 className="text-lg font-semibold text-charcoal flex items-center gap-2">
                                            <Clock className="w-5 h-5 text-amber-500" />
                                            Cola de Aprobación (Envío de Mensajes)
                                        </h3>
                                        <p className="text-sm text-charcoal/60 mt-1 max-w-2xl">
                                            Estas acciones requieren tu autorización manual. Al hacer clic en <strong>"Enviar WhatsApp"</strong>,
                                            la IA enviará inmediatamente el mensaje configurado al teléfono del paciente.
                                        </p>
                                    </div>
                                    <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2.5 py-1 rounded-full">
                                        {pendingActions.length} pendientes
                                    </span>
                                </div>

                                {pendingActions.length === 0 ? (
                                    <div className="text-center py-8 bg-ivory/30 rounded-xl border border-dashed border-silk-beige">
                                        <CheckCircle2 className="w-8 h-8 text-charcoal/20 mx-auto mb-2" />
                                        <p className="text-sm text-charcoal/50">No hay acciones pendientes de aprobación</p>
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="border-b border-silk-beige">
                                                    <th className="text-left py-2 px-4 font-medium text-charcoal/50">Paciente</th>
                                                    <th className="text-left py-2 px-4 font-medium text-charcoal/50">Riesgo</th>
                                                    <th className="text-left py-2 px-4 font-medium text-charcoal/50">Acción Sugerida</th>
                                                    <th className="text-right py-2 px-4 font-medium text-charcoal/50">Acciones</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {pendingActions.map(action => (
                                                    <tr key={action.id} className="border-b border-silk-beige/50 hover:bg-ivory/50">
                                                        <td className="py-3 px-4 font-medium text-charcoal">
                                                            {patients.find(p => p.patient_id === action.patient_id)?.patient_name || 'Paciente'}
                                                        </td>
                                                        <td className="py-3 px-4">
                                                            <span className={cn(
                                                                "inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border",
                                                                getRiskColor(action.trigger_risk_level)
                                                            )}>
                                                                {getRiskLabel(action.trigger_risk_level)}
                                                            </span>
                                                        </td>
                                                        <td className="py-3 px-4 text-sm text-charcoal font-medium">
                                                            <div className="flex flex-col">
                                                                <div className="flex items-center gap-1.5 text-emerald-700">
                                                                    <MessageSquare className="w-3.5 h-3.5" />
                                                                    <span>{getTemplateInfo((action.action_details.template_name as string) || '').name}</span>
                                                                </div>
                                                                <span className="text-xs text-charcoal/40 ml-5">
                                                                    {getTemplateInfo((action.action_details.template_name as string) || '').desc}
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td className="py-3 px-4 text-right">
                                                            <div className="flex items-center justify-end gap-2">
                                                                <button
                                                                    onClick={() => handleReject(action.id)}
                                                                    className="p-1.5 hover:bg-red-50 text-charcoal/40 hover:text-red-500 rounded-lg transition-colors"
                                                                    title="Descartar acción"
                                                                >
                                                                    <X className="w-4 h-4" />
                                                                </button>
                                                                <button
                                                                    onClick={() => handleApprove(action.id)}
                                                                    disabled={loadingToAction === action.id}
                                                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors shadow-md shadow-emerald-500/20 text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                                                                    title="Enviar mensaje de WhatsApp ahora"
                                                                >
                                                                    {loadingToAction === action.id ? (
                                                                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                                                    ) : (
                                                                        <MessageSquare className="w-3.5 h-3.5" />
                                                                    )}
                                                                    Enviar WhatsApp
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>

                            {/* Action History */}
                            <div className="card-soft p-6">
                                <h3 className="text-lg font-semibold text-charcoal mb-4 flex items-center gap-2">
                                    <Activity className="w-5 h-5 text-primary-500" />
                                    Historial de Ejecución
                                </h3>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-silk-beige bg-ivory/50">
                                                <th className="text-left py-3 px-4 font-medium text-charcoal/50">Fecha</th>
                                                <th className="text-left py-3 px-4 font-medium text-charcoal/50">Paciente</th>
                                                <th className="text-left py-3 px-4 font-medium text-charcoal/50">Acción</th>
                                                <th className="text-left py-3 px-4 font-medium text-charcoal/50">Estado</th>
                                                <th className="text-left py-3 px-4 font-medium text-charcoal/50">Resultado</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {actionLog.length === 0 ? (
                                                <tr>
                                                    <td colSpan={5} className="text-center py-8 text-charcoal/50">
                                                        No hay historial de acciones
                                                    </td>
                                                </tr>
                                            ) : (
                                                actionLog.map(log => (
                                                    <tr key={log.id} className="border-b border-silk-beige/50 hover:bg-ivory/50">
                                                        <td className="py-3 px-4 text-charcoal/70">
                                                            {new Date(log.created_at).toLocaleDateString('es-CL')}
                                                        </td>
                                                        <td className="py-3 px-4 font-medium text-charcoal">
                                                            {patients.find(p => p.patient_id === log.patient_id)?.patient_name || 'Paciente'}
                                                        </td>
                                                        <td className="py-3 px-4 text-charcoal/70">
                                                            {(log.action_details as any)?.template_name || 'Reactivación'}
                                                        </td>
                                                        <td className="py-3 px-4">
                                                            <span className={cn(
                                                                "inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-0.5 rounded-full border",
                                                                log.status === 'executed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                                                    log.status === 'approved' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                                                        log.status === 'rejected' ? 'bg-red-50 text-red-700 border-red-200' :
                                                                            'bg-charcoal/5 text-charcoal/60 border-silk-beige'
                                                            )}>
                                                                {log.status === 'executed' ? 'Ejecutado' :
                                                                    log.status === 'approved' ? 'Aprobado' :
                                                                        log.status === 'rejected' ? 'Rechazado' : log.status}
                                                            </span>
                                                        </td>
                                                        <td className="py-3 px-4 text-xs text-charcoal/50 font-mono">
                                                            {log.result ? log.result.substring(0, 20) + '...' : '-'}
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </PremiumFeature>
                )
            }

            {/* Footer Metric */}
            <div className="card-soft bg-gradient-to-r from-violet-500/5 via-fuchsia-500/5 to-pink-500/5 border border-violet-200/30 p-6">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-xl flex items-center justify-center">
                            <DollarSign className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <p className="text-xs text-charcoal/50 uppercase tracking-wider font-medium">Ingresos Recuperados por Vetly AI AI</p>
                            <PremiumFeature requiredPlan="radiance" fallback={
                                <p className="text-xl font-bold text-charcoal/30">Disponible en Radiance+</p>
                            }>
                                <p className="text-2xl font-bold text-charcoal">{formatCurrency(stats?.revenue_recovered_month || 0)}</p>
                            </PremiumFeature>
                        </div>
                    </div>
                    <div className="text-right">
                        <p className="text-xs text-charcoal/40">
                            {stats?.total_patients || 0} pacientes analizados
                        </p>
                        <p className="text-xs text-charcoal/40">
                            Powered by Revenue Retention Engine™
                        </p>
                    </div>
                </div>
            </div>
            {/* Configuration Modal */}
            {
                clinicId && (
                    <RetentionSettingsModal
                        isOpen={isSettingsOpen}
                        onClose={() => setIsSettingsOpen(false)}
                        clinicId={clinicId}
                        onSaved={() => {
                            // Refresh logic if needed, e.g. reload pending actions
                            fetchData()
                        }}
                    />
                )
            }
        </div >
    )
}

export default RetentionEngine
