import { useState, useEffect } from 'react'
import {
    Calendar,
    MessageSquare,
    TrendingUp,
    Clock,
    CheckCircle2,
    Loader2,
    Crown,
    Star,
    Target,
    ArrowUpRight,
    ArrowDownRight,
    Minus
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useClinicTimezone } from '@/hooks/useClinicTimezone'
import { Link } from 'react-router-dom'

interface DashboardStats {
    appointmentsToday: number
    messagesToday: number
    activePatients: number
    confirmationRate: number
}

interface Appointment {
    id: string
    patient_name: string
    service: string
    appointment_date: string
    status: 'pending' | 'confirmed' | 'cancelled' | 'completed'
    tutor_name?: string | null
    address?: string | null
    address_references?: string | null
}

interface Message {
    id: string
    contact_phone: string
    content: string
    created_at: string
    direction: 'inbound' | 'outbound'
    status: 'read' | 'unread'
}

interface ServiceRanking {
    name: string
    count: number
    percentage: number
    trend: 'up' | 'down' | 'stable'
}

export default function Dashboard() {
    const { user, profile } = useAuth()
    const [loading, setLoading] = useState(true)
    const [stats, setStats] = useState<DashboardStats>({
        appointmentsToday: 0,
        messagesToday: 0,
        activePatients: 0,
        confirmationRate: 0
    })

    const [prevStats, setPrevStats] = useState({
        appointments: 0,
        prospects: 0,
        aiMessages: 0,
        reminders: 0,
        cancelled: 0
    })
    
    // New metrics
    const [extraStats, setExtraStats] = useState({
        remindersSent: 0,
        newProspects: 0,
        cancelledAppointments: 0,
        aiMessages: 0,
    })

    const [timeRange, setTimeRange] = useState<'day' | 'week' | 'month' | 'year'>('day')
    const [upcomingAppointments, setUpcomingAppointments] = useState<Appointment[]>([])
    const [recentMessages, setRecentMessages] = useState<Message[]>([])

    // Services ranking data
    const [servicesRanking, setServicesRanking] = useState<ServiceRanking[]>([])
    const [conversionStats, setConversionStats] = useState({
        consultations: 0,
        converted: 0,
        lost: 0,
        rate: 0
    })
    const [satisfactionStats, setSatisfactionStats] = useState({
        sent: 0,
        responded: 0,
        nps: 0,
        average: 0
    })

    const { getDateRange, getPreviousDateRange } = useClinicTimezone()

    useEffect(() => {
        const fetchDashboardData = async () => {
            if (!user || !profile?.clinic_id) return

            try {
                // Use clinic timezone for all date boundaries
                const { start: monthStart } = getDateRange('month')
                const startOfMonth = monthStart.toISOString()

                // Use the selected time range for stats
                const { start: statsStart, end: statsEnd } = getDateRange(timeRange)
                const startOfStats = statsStart.toISOString()
                const endOfStats = statsEnd.toISOString()

                // Previous period for comparison
                const { start: prevStart, end: prevEnd } = getPreviousDateRange(timeRange)
                const startOfPrev = prevStart.toISOString()
                const endOfPrev = prevEnd.toISOString()

                // ⚡ PERFORMANCE: Run ALL queries in parallel instead of sequential
                const [
                    appointmentsCountRes,
                    messagesCountRes,
                    appointmentsRes,
                    messagesRes,
                    monthAppointmentsRes,
                    inboundMessagesRes,
                    surveysRes,
                    remindersCountRes,
                    prospectsCountRes,
                    cancelledCountRes,
                    aiMessagesCountRes,
                    // Previous period counts
                    prevAppointmentsRes,
                    prevProspectsRes,
                    prevAiMessagesRes,
                    prevRemindersRes,
                    prevCancelledRes
                ] = await Promise.all([
                    // 1. Appointments count in period
                    supabase
                        .from('appointments')
                        .select('*', { count: 'exact', head: true })
                        .gte('appointment_date', startOfStats)
                        .lte('appointment_date', endOfStats)
                        .eq('clinic_id', profile.clinic_id),
                    // 2. Messages count in period
                    supabase
                        .from('messages')
                        .select('*', { count: 'exact', head: true })
                        .gte('created_at', startOfStats)
                        .lte('created_at', endOfStats)
                        .eq('clinic_id', profile.clinic_id),
                    // 3. Upcoming appointments
                    supabase
                        .from('appointments')
                        .select('id, patient_name, service, appointment_date, status')
                        .gte('appointment_date', new Date().toISOString())
                        .eq('clinic_id', profile.clinic_id)
                        .order('appointment_date', { ascending: true })
                        .limit(5),
                    // 4. Recent messages
                    supabase
                        .from('messages')
                        .select('id, phone_number, content, created_at, direction, status')
                        .eq('clinic_id', profile.clinic_id)
                        .order('created_at', { ascending: false })
                        .limit(3),
                    // 5. Month appointments (for service ranking)
                    (supabase as any)
                        .from('appointments')
                        .select('service')
                        .gte('appointment_date', startOfMonth)
                        .eq('clinic_id', profile.clinic_id),
                    // 6. Inbound messages this month (for conversion rate)
                    (supabase as any)
                        .from('messages')
                        .select('phone_number')
                        .eq('direction', 'inbound')
                        .gte('created_at', startOfMonth)
                        .eq('clinic_id', profile.clinic_id),
                    // 7. Satisfaction surveys
                    (supabase as any)
                        .from('satisfaction_surveys')
                        .select('id, status, rating, created_at')
                        .gte('created_at', startOfMonth)
                        .eq('clinic_id', profile.clinic_id),
                    // 8. Reminders sent (using reminder_logs for accuracy)
                    supabase
                        .from('reminder_logs')
                        .select('*', { count: 'exact', head: true })
                        .eq('status', 'sent')
                        .gte('created_at', startOfStats)
                        .lte('created_at', endOfStats)
                        .eq('clinic_id', profile.clinic_id),
                    // 9. New Prospects
                    (supabase as any)
                        .from('crm_prospects')
                        .select('*', { count: 'exact', head: true })
                        .gte('created_at', startOfStats)
                        .lte('created_at', endOfStats)
                        .eq('clinic_id', profile.clinic_id),
                    // 10. Cancelled Appointments
                    supabase
                        .from('appointments')
                        .select('*', { count: 'exact', head: true })
                        .eq('status', 'cancelled')
                        .gte('appointment_date', startOfStats)
                        .lte('appointment_date', endOfStats)
                        .eq('clinic_id', profile.clinic_id),
                    // 11. AI Messages (Outbound from clinic)
                    supabase
                        .from('messages')
                        .select('*', { count: 'exact', head: true })
                        .eq('direction', 'outbound')
                        .gte('created_at', startOfStats)
                        .lte('created_at', endOfStats)
                        .eq('clinic_id', profile.clinic_id),
                    
                    // PREVIOUS PERIOD QUERIES
                    supabase.from('appointments').select('*', { count: 'exact', head: true })
                        .gte('appointment_date', startOfPrev).lte('appointment_date', endOfPrev).eq('clinic_id', profile.clinic_id),
                    supabase.from('crm_prospects').select('*', { count: 'exact', head: true })
                        .gte('created_at', startOfPrev).lte('created_at', endOfPrev).eq('clinic_id', profile.clinic_id),
                    supabase.from('messages').select('*', { count: 'exact', head: true })
                        .eq('direction', 'outbound').gte('created_at', startOfPrev).lte('created_at', endOfPrev).eq('clinic_id', profile.clinic_id),
                    supabase.from('reminder_logs').select('*', { count: 'exact', head: true })
                        .eq('status', 'sent').gte('created_at', startOfPrev).lte('created_at', endOfPrev).eq('clinic_id', profile.clinic_id),
                    supabase.from('appointments').select('*', { count: 'exact', head: true })
                        .eq('status', 'cancelled').gte('appointment_date', startOfPrev).lte('appointment_date', endOfPrev).eq('clinic_id', profile.clinic_id),
                ])

                // Process results
                const appointments = appointmentsRes.data
                const messages = messagesRes.data
                const monthAppointments = monthAppointmentsRes.data
                const inboundMessages = inboundMessagesRes.data
                const surveys = surveysRes.data

                setStats({
                    appointmentsToday: appointmentsCountRes.count || 0,
                    messagesToday: messagesCountRes.count || 0,
                    activePatients: 0,
                    confirmationRate: 0
                })

                setExtraStats({
                    remindersSent: remindersCountRes.count || 0,
                    newProspects: prospectsCountRes.count || 0,
                    cancelledAppointments: cancelledCountRes.count || 0,
                    aiMessages: aiMessagesCountRes.count || 0,
                })

                setPrevStats({
                    appointments: prevAppointmentsRes.count || 0,
                    prospects: prevProspectsRes.count || 0,
                    aiMessages: prevAiMessagesRes.count || 0,
                    reminders: prevRemindersRes.count || 0,
                    cancelled: prevCancelledRes.count || 0
                })

                if (appointments) setUpcomingAppointments(appointments)
                if (messages) setRecentMessages(messages)

                // Service Ranking
                if (monthAppointments && monthAppointments.length > 0) {
                    const serviceCounts: Record<string, number> = {}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    monthAppointments.forEach((appt: any) => {
                        const service = appt.service || 'General'
                        serviceCounts[service] = (serviceCounts[service] || 0) + 1
                    })
                    const totalAppts = monthAppointments.length
                    setServicesRanking(
                        Object.entries(serviceCounts)
                            .map(([name, count]) => ({
                                name, count,
                                percentage: Math.round((count / totalAppts) * 100),
                                trend: 'stable' as const
                            }))
                            .sort((a, b) => b.count - a.count)
                            .slice(0, 5)
                    )
                }

                // Conversion Rate
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const uniqueContacts = new Set(inboundMessages?.map((m: any) => m.phone_number)).size
                const monthApptsCount = monthAppointments?.length || 0
                setConversionStats({
                    consultations: uniqueContacts,
                    converted: monthApptsCount,
                    lost: Math.max(0, uniqueContacts - monthApptsCount),
                    rate: uniqueContacts > 0 ? Math.round((monthApptsCount / uniqueContacts) * 100) : 0
                })

                // Satisfaction (NPS)
                if (surveys) {
                    const sent = surveys.length
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const responded = surveys.filter((s: any) => s.status === 'responded').length
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const ratings = surveys.filter((s: any) => s.status === 'responded' && s.rating).map((s: any) => s.rating!)
                    const average = ratings.length > 0
                        ? ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length
                        : 0
                    let nps = 0
                    if (ratings.length > 0) {
                        const promoters = ratings.filter((r: number) => r === 5).length
                        const detractors = ratings.filter((r: number) => r <= 3).length
                        nps = Math.round(((promoters - detractors) / ratings.length) * 100)
                    }
                    setSatisfactionStats({ sent, responded, nps, average })
                }

            } catch (error) {
                console.error('Error fetching dashboard data:', error)
            } finally {
                setLoading(false)
            }
        }

        fetchDashboardData()
    }, [user, profile?.clinic_id, timeRange])

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
            </div>
        )
    }

    // Calculamos el tiempo ahorrado: 15 min por cita
    const horasAhorradas = Math.floor((stats.appointmentsToday * 15) / 60);
    const minutosAhorrados = (stats.appointmentsToday * 15) % 60;
    const tiempoAhorradoStr = horasAhorradas > 0 ? `${horasAhorradas}h ${minutosAhorrados}m` : `${minutosAhorrados}m`;

    // Percentage calculation helper
    const calculatePercentage = (current: number, previous: number) => {
        if (previous === 0) return current > 0 ? 100 : 0
        return Math.round(((current - previous) / previous) * 100)
    }

    const statCards = [
        {
            name: 'CITAS AGENDADAS',
            value: stats.appointmentsToday.toString(),
            icon: Calendar,
            color: 'text-primary-500',
            bg: 'bg-primary-500/10',
            change: calculatePercentage(stats.appointmentsToday, prevStats.appointments)
        },
        {
            name: 'NUEVOS PROSPECTOS',
            value: extraStats.newProspects.toString(),
            icon: Target,
            color: 'text-fuchsia-500',
            bg: 'bg-fuchsia-500/10',
            change: calculatePercentage(extraStats.newProspects, prevStats.prospects)
        },
        {
            name: 'MENSAJES DE IA',
            value: extraStats.aiMessages.toString(),
            icon: MessageSquare,
            color: 'text-rose-500',
            bg: 'bg-rose-500/10',
            change: calculatePercentage(extraStats.aiMessages, prevStats.aiMessages)
        },
        {
            name: 'RECORDATORIOS',
            value: extraStats.remindersSent.toString(),
            icon: Clock,
            color: 'text-primary-500',
            bg: 'bg-primary-500/10',
            change: calculatePercentage(extraStats.remindersSent, prevStats.reminders)
        },
        {
            name: 'CITAS CANCELADAS',
            value: extraStats.cancelledAppointments.toString(),
            icon: Minus,
            color: 'text-amber-500',
            bg: 'bg-amber-500/10',
            change: calculatePercentage(extraStats.cancelledAppointments, prevStats.cancelled)
        },
        {
            name: 'TIEMPO AHORRADO',
            value: tiempoAhorradoStr,
            icon: TrendingUp,
            color: 'text-primary-500',
            bg: 'bg-primary-500/10',
            change: 0 // No comparison for time saved yet
        }
    ]

    const ChangeBadge = ({ change }: { change: number }) => {
        const isPositive = change > 0
        const isNeutral = change === 0
        
        return (
            <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold ${
                isNeutral ? 'bg-gray-100 text-gray-500' :
                isPositive ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
            }`}>
                {isNeutral ? <Minus className="w-3 h-3" /> : 
                 isPositive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                {Math.abs(change)}%
            </div>
        )
    }

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="bg-hero-gradient rounded-softer p-6 text-white">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-semibold mb-1 text-white">¡Hola, {profile?.full_name?.split(' ')[0]}! 👋</h1>
                        <p className="text-white/80">
                            Tu asistente IA está activo y listo para gestionar tus citas.
                        </p>
                    </div>
                    <div className="w-20 h-20 bg-white/10 rounded-full flex items-center justify-center backdrop-blur-sm">
                        <CheckCircle2 className="w-10 h-10 text-white" />
                    </div>
                </div>
            </div>

            {/* Sub-Header with Performance Label and Filters */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 py-2">
                <h2 className="text-[10px] font-black text-charcoal/40 uppercase tracking-[0.2em]">RESUMEN DE RENDIMIENTO</h2>
                
                {/* Segmented Control Style Filter */}
                <div className="bg-white p-1 rounded-full shadow-sm border border-silk-beige flex gap-1">
                    {[
                        { id: 'day', label: 'HOY' },
                        { id: 'week', label: 'ESTA SEMANA' },
                        { id: 'month', label: 'ESTE MES' },
                        { id: 'year', label: 'ESTE AÑO' }
                    ].map((range) => (
                        <button
                            key={range.id}
                            onClick={() => setTimeRange(range.id as any)}
                            className={`px-4 py-1.5 rounded-full text-[10px] font-bold transition-all duration-200 ${
                                timeRange === range.id 
                                ? 'bg-primary-500 text-white shadow-md shadow-primary-500/30' 
                                : 'text-charcoal/40 hover:text-charcoal/60 hover:bg-ivory'
                            }`}
                        >
                            {range.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                {statCards.map((stat) => (
                    <div key={stat.name} className="bg-white p-5 rounded-softer border border-silk-beige shadow-sm relative overflow-hidden group">
                        <div className="flex items-center justify-between relative z-10">
                            <div className={`w-10 h-10 ${stat.bg} rounded-soft flex items-center justify-center`}>
                                <stat.icon className={`w-5 h-5 ${stat.color}`} />
                            </div>
                            <ChangeBadge change={stat.change} />
                        </div>
                        <div className="mt-5 relative z-10">
                            <p className="text-3xl font-black text-charcoal tracking-tight">{stat.value}</p>
                            <p className="text-[9px] font-black text-charcoal/40 mt-1 uppercase tracking-wider">{stat.name}</p>
                        </div>
                        
                        {/* Pink Accent Line at Bottom */}
                        <div className="absolute bottom-0 left-0 h-1 bg-primary-500 w-1/4 group-hover:w-full transition-all duration-500" />
                    </div>
                ))}
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Upcoming Appointments */}
                <div className="lg:col-span-2 card-soft p-6">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="text-lg font-semibold text-charcoal">Próximas Citas</h3>
                        <Link to="/app/appointments" className="text-sm text-primary-500 hover:text-primary-600 font-medium">
                            Ver todas
                        </Link>
                    </div>

                    <div className="space-y-3">
                        {upcomingAppointments.length === 0 ? (
                            <p className="text-charcoal/50 text-center py-4">No hay próximas citas agendadas.</p>
                        ) : (
                            upcomingAppointments.map((appointment) => (
                                <div
                                    key={appointment.id}
                                    className="flex items-center gap-4 p-4 bg-ivory rounded-soft hover:bg-silk-beige/50 transition-colors"
                                >
                                    <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-soft">
                                        <Clock className="w-5 h-5 text-primary-500" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium text-charcoal truncate">{appointment.patient_name}</p>
                                        <p className="text-sm text-charcoal/50">{appointment.service}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="font-medium text-charcoal">
                                            {new Date(appointment.appointment_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </p>
                                        <span
                                            className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full ${appointment.status === 'confirmed'
                                                ? 'bg-emerald-100 text-emerald-700'
                                                : 'bg-amber-100 text-amber-700'
                                                }`}
                                        >
                                            {appointment.status === 'confirmed' ? 'Confirmada' : 'Pendiente'}
                                        </span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Recent Messages */}
                <div className="card-soft p-6">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="text-lg font-semibold text-charcoal">Mensajes Recientes</h3>
                        <Link to="/app/messages" className="text-sm text-primary-500 hover:text-primary-600 font-medium">
                            Ver todos
                        </Link>
                    </div>

                    <div className="space-y-4">
                        {recentMessages.length === 0 ? (
                            <p className="text-charcoal/50 text-center py-4">No hay mensajes recientes.</p>
                        ) : (
                            recentMessages.map((message) => (
                                <div
                                    key={message.id}
                                    className="p-4 rounded-soft transition-colors hover:bg-ivory cursor-pointer"
                                    onClick={() => window.location.href = `/app/messages`}
                                >
                                    <div className="flex items-start gap-3">
                                        <div className="w-10 h-10 bg-silk-beige rounded-full flex items-center justify-center flex-shrink-0">
                                            <span className="text-sm font-medium text-charcoal">
                                                <MessageSquare className="w-4 h-4" />
                                            </span>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between gap-2">
                                                <p className="font-medium text-charcoal truncate">{message.contact_phone}</p>
                                                <span className="text-xs text-charcoal/40 flex-shrink-0">
                                                    {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            </div>
                                            <p className="text-sm text-charcoal/60 mt-1 line-clamp-2">{message.content}</p>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* Services Ranking */}
            <div className="card-soft p-6">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-amber-400 to-amber-600 rounded-soft flex items-center justify-center">
                            <Crown className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h3 className="text-lg font-semibold text-charcoal">Ranking de Servicios (Este Mes)</h3>
                            <p className="text-sm text-charcoal/50">Servicios más solicitados</p>
                        </div>
                    </div>
                </div>

                <div className="space-y-4">
                    {servicesRanking.length === 0 ? (
                        <p className="text-charcoal/50 text-center py-6">
                            Aún no hay datos suficientes este mes.
                        </p>
                    ) : (
                        servicesRanking.map((service, index) => (
                            <div key={service.name} className="flex items-center gap-4">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-semibold text-sm ${index === 0 ? 'bg-amber-500 text-white' :
                                    index === 1 ? 'bg-gray-300 text-gray-700' :
                                        index === 2 ? 'bg-amber-700 text-white' :
                                            'bg-silk-beige text-charcoal/60'
                                    }`}>
                                    {index + 1}
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center justify-between mb-1">
                                        <p className="font-medium text-charcoal text-sm">{service.name}</p>
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm text-charcoal/60">{service.count} citas</span>
                                            <TrendingUp className={`w-4 h-4 ${service.trend === 'up' ? 'text-emerald-500' :
                                                service.trend === 'down' ? 'text-red-500 rotate-180' :
                                                    'text-charcoal/30'
                                                }`} />
                                        </div>
                                    </div>
                                    <div className="h-2 bg-silk-beige rounded-full overflow-hidden">
                                        <div
                                            className={`h-full rounded-full transition-all duration-500 ${index === 0 ? 'bg-gradient-to-r from-primary-400 to-primary-600' :
                                                'bg-primary-400/60'
                                                }`}
                                            style={{ width: `${service.percentage}%` }}
                                        />
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Analytics Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Conversion Rate Card */}
                <div className="card-soft p-6">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-soft flex items-center justify-center">
                                <Target className="w-5 h-5 text-white" />
                            </div>
                            <div>
                                <h3 className="text-lg font-semibold text-charcoal">Tasa de Conversión (Mes)</h3>
                                <p className="text-sm text-charcoal/50">Consultas vs Citas Agendadas</p>
                            </div>
                        </div>
                    </div>

                    <div className="text-center py-6">
                        <p className="text-4xl font-bold text-charcoal">{conversionStats.rate}%</p>
                        <p className="text-sm text-charcoal/50 mt-2">De efectividad este mes</p>
                    </div>

                    <div className="grid grid-cols-3 gap-4 pt-4 border-t border-silk-beige">
                        <div className="text-center">
                            <p className="text-lg font-semibold text-charcoal">{conversionStats.consultations}</p>
                            <p className="text-xs text-charcoal/50">Contactos</p>
                        </div>
                        <div className="text-center">
                            <p className="text-lg font-semibold text-charcoal">{conversionStats.converted}</p>
                            <p className="text-xs text-charcoal/50">Citas</p>
                        </div>
                        <div className="text-center">
                            <p className="text-lg font-semibold text-charcoal">{conversionStats.lost}</p>
                            <p className="text-xs text-charcoal/50">Sin Cita</p>
                        </div>
                    </div>
                </div>

                {/* Satisfaction Surveys Card */}
                <div className="card-soft p-6">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-gradient-to-br from-amber-400 to-orange-500 rounded-soft flex items-center justify-center">
                                <Star className="w-5 h-5 text-white" />
                            </div>
                            <div>
                                <h3 className="text-lg font-semibold text-charcoal">Satisfacción (NPS)</h3>
                                <p className="text-sm text-charcoal/50">Calidad de servicio</p>
                            </div>
                        </div>
                    </div>

                    <div className="text-center py-6">
                        <div className="flex justify-center gap-1 mb-2">
                            {[1, 2, 3, 4, 5].map((star) => (
                                <Star
                                    key={star}
                                    className={`w-6 h-6 ${star <= Math.round(satisfactionStats.average) ? 'text-amber-400 fill-amber-400' : 'text-charcoal/20'}`}
                                />
                            ))}
                        </div>
                        <p className="text-2xl font-bold text-charcoal">{satisfactionStats.average.toFixed(1)} / 5.0</p>
                        <p className="text-xs text-charcoal/40 mt-1">Promedio de {satisfactionStats.responded} respuestas</p>
                    </div>

                    <div className="grid grid-cols-3 gap-4 pt-4 border-t border-silk-beige">
                        <div className="text-center">
                            <p className="text-lg font-semibold text-charcoal">{satisfactionStats.sent}</p>
                            <p className="text-xs text-charcoal/50">Enviadas</p>
                        </div>
                        <div className="text-center">
                            <p className="text-lg font-semibold text-charcoal">{satisfactionStats.responded}</p>
                            <p className="text-xs text-charcoal/50">Respondidas</p>
                        </div>
                        <div className="text-center">
                            <p className={`text-lg font-semibold ${satisfactionStats.nps > 0 ? 'text-emerald-500' : 'text-charcoal'}`}>
                                {satisfactionStats.nps > 0 ? '+' : ''}{satisfactionStats.nps}
                            </p>
                            <p className="text-xs text-charcoal/50">NPS</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
