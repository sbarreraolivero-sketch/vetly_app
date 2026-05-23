import { useState, useEffect } from 'react'
import {
    Calendar,
    MessageSquare,
    TrendingUp,
    Clock,
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
                    prospectsRes, // Changed from count to data for unique counting
                    cancelledCountRes,
                    aiMessagesCountRes,
                    // Previous period counts
                    prevAppointmentsRes,
                    prevProspectsRes, // Changed from count to data for unique counting
                    prevAiMessagesRes,
                    prevRemindersRes,
                    prevCancelledRes
                ] = await Promise.all([
                    // 1. Appointments created in period (Performance of IA)
                    supabase
                        .from('appointments')
                        .select('*', { count: 'exact', head: true })
                        .gte('created_at', startOfStats)
                        .lte('created_at', endOfStats)
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
                        .eq('clinic_id', profile.clinic_id)
                        .limit(500),
                    // 6. Inbound messages this month (for conversion rate)
                    (supabase as any)
                        .from('messages')
                        .select('phone_number')
                        .eq('direction', 'inbound')
                        .gte('created_at', startOfMonth)
                        .eq('clinic_id', profile.clinic_id)
                        .limit(1000),
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
                    // 9. New Prospects (Unique inbound contacts in period)
                    supabase
                        .from('messages')
                        .select('phone_number')
                        .eq('direction', 'inbound')
                        .gte('created_at', startOfStats)
                        .lte('created_at', endOfStats)
                        .eq('clinic_id', profile.clinic_id),
                    // 10. Cancelled Appointments (Tracked by update time)
                    supabase
                        .from('appointments')
                        .select('*', { count: 'exact', head: true })
                        .eq('status', 'cancelled')
                        .gte('updated_at', startOfStats)
                        .lte('updated_at', endOfStats)
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
                        .gte('created_at', startOfPrev).lte('created_at', endOfPrev).eq('clinic_id', profile.clinic_id),
                    supabase.from('messages').select('phone_number')
                        .eq('direction', 'inbound').gte('created_at', startOfPrev).lte('created_at', endOfPrev).eq('clinic_id', profile.clinic_id),
                    supabase.from('messages').select('*', { count: 'exact', head: true })
                        .eq('direction', 'outbound').gte('created_at', startOfPrev).lte('created_at', endOfPrev).eq('clinic_id', profile.clinic_id),
                    supabase.from('reminder_logs').select('*', { count: 'exact', head: true })
                        .eq('status', 'sent').gte('created_at', startOfPrev).lte('created_at', endOfPrev).eq('clinic_id', profile.clinic_id),
                    supabase.from('appointments').select('*', { count: 'exact', head: true })
                        .eq('status', 'cancelled').gte('updated_at', startOfPrev).lte('updated_at', endOfPrev).eq('clinic_id', profile.clinic_id),
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

                const currentProspectsCount = new Set(prospectsRes.data?.map((m: any) => m.phone_number)).size
                const prevProspectsCount = new Set(prevProspectsRes.data?.map((m: any) => m.phone_number)).size

                setExtraStats({
                    remindersSent: remindersCountRes.count || 0,
                    newProspects: currentProspectsCount,
                    cancelledAppointments: cancelledCountRes.count || 0,
                    aiMessages: aiMessagesCountRes.count || 0,
                })

                setPrevStats({
                    appointments: prevAppointmentsRes.count || 0,
                    prospects: prevProspectsCount,
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
            name: 'CITAS AGENDADAS POR IA',
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
            color: 'text-sky-500',
            bg: 'bg-sky-500/10',
            change: calculatePercentage(extraStats.aiMessages, prevStats.aiMessages)
        },
        {
            name: 'RECORDATORIOS',
            value: extraStats.remindersSent.toString(),
            icon: Clock,
            color: 'text-amber-500',
            bg: 'bg-amber-500/10',
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
            color: 'text-emerald-500',
            bg: 'bg-emerald-500/10',
            change: 0
        }
    ]

    const ChangeBadge = ({ change }: { change: number }) => {
        const isPositive = change > 0
        const isNeutral = change === 0
        
        return (
            <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold ${
                isNeutral ? 'bg-silk-beige/50 text-charcoal/40' :
                isPositive ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
            }`}>
                {isNeutral ? null : 
                 isPositive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                {Math.abs(change)}%
            </div>
        )
    }

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Page Header — limpio y moderno */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-silk-beige">
                <div>
                    <h1 className="text-2xl font-extrabold tracking-tight text-charcoal">
                        ¡Hola, {profile?.full_name?.split(' ')[0]}! 👋
                    </h1>
                    <p className="text-sm text-charcoal/50 mt-1">
                        Tu asistente IA está activo y respondiendo 24/7.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="inline-flex items-center gap-2 bg-primary-50 border border-primary-200 text-primary-700 text-xs font-semibold px-3 py-1.5 rounded-full">
                        <span className="w-2 h-2 bg-primary-500 rounded-full animate-pulse" />
                        Agente activo
                    </div>
                    {/* Filtro de período */}
                    <div className="bg-white border border-silk-beige p-1 rounded-xl flex gap-1">
                        {[
                            { id: 'day', label: 'Hoy' },
                            { id: 'week', label: 'Semana' },
                            { id: 'month', label: 'Mes' },
                            { id: 'year', label: 'Año' }
                        ].map((range) => (
                            <button
                                key={range.id}
                                onClick={() => setTimeRange(range.id as any)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                                    timeRange === range.id
                                    ? 'bg-primary-500 text-white shadow-sm'
                                    : 'text-charcoal/50 hover:text-charcoal hover:bg-zinc-50'
                                }`}
                            >
                                {range.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                {statCards.map((stat) => (
                    <div key={stat.name} className="bg-white p-5 rounded-xl border border-silk-beige shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 group">
                        <div className="flex items-center justify-between mb-4">
                            <div className={`w-9 h-9 ${stat.bg} rounded-lg flex items-center justify-center`}>
                                <stat.icon className={`w-4.5 h-4.5 ${stat.color}`} />
                            </div>
                            <ChangeBadge change={stat.change} />
                        </div>
                        <p className="text-3xl font-extrabold text-charcoal tracking-tight">{stat.value}</p>
                        <p className="text-xs text-charcoal/40 mt-1 font-medium">{stat.name}</p>
                    </div>
                ))}
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* Upcoming Appointments */}
                <div className="lg:col-span-2 bg-white rounded-2xl border border-silk-beige shadow-sm overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                    <div className="bg-gradient-to-br from-primary-500 to-primary-700 p-5 text-white">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs font-bold uppercase tracking-widest text-primary-200 mb-1">Agenda</p>
                                <h3 className="text-lg font-extrabold tracking-tight">Próximas Citas</h3>
                            </div>
                            <div className="flex items-center gap-3">
                                <Link to="/app/appointments" className="text-xs text-primary-200 hover:text-white font-semibold bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-full transition-colors">
                                    Ver todas →
                                </Link>
                                <div className="w-10 h-10 bg-white/15 rounded-xl flex items-center justify-center">
                                    <Calendar className="w-5 h-5 text-white" />
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="p-5 space-y-2">
                        {upcomingAppointments.length === 0 ? (
                            <p className="text-charcoal/40 text-center py-8 text-sm">No hay próximas citas agendadas.</p>
                        ) : (
                            upcomingAppointments.map((appointment) => (
                                <div key={appointment.id} className="flex items-center gap-4 p-3.5 rounded-xl hover:bg-ivory transition-colors">
                                    <div className="w-10 h-10 bg-primary-50 rounded-xl flex items-center justify-center shrink-0">
                                        <Clock className="w-4.5 h-4.5 text-primary-600" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-semibold text-charcoal text-sm truncate">{appointment.patient_name}</p>
                                        <p className="text-xs text-charcoal/50 truncate">{appointment.service}</p>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className="font-bold text-charcoal text-sm">
                                            {new Date(appointment.appointment_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </p>
                                        <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium mt-0.5 ${
                                            appointment.status === 'confirmed'
                                            ? 'bg-emerald-100 text-emerald-700'
                                            : 'bg-amber-100 text-amber-700'
                                        }`}>
                                            {appointment.status === 'confirmed' ? 'Confirmada' : 'Pendiente'}
                                        </span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Recent Messages */}
                <div className="bg-white rounded-2xl border border-silk-beige shadow-sm overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                    <div className="bg-gradient-to-br from-sky-500 to-sky-700 p-5 text-white">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs font-bold uppercase tracking-widest text-sky-200 mb-1">WhatsApp IA</p>
                                <h3 className="text-lg font-extrabold tracking-tight">Mensajes Recientes</h3>
                            </div>
                            <div className="flex items-center gap-3">
                                <Link to="/app/messages" className="text-xs text-sky-200 hover:text-white font-semibold bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-full transition-colors">
                                    Ver todos →
                                </Link>
                                <div className="w-10 h-10 bg-white/15 rounded-xl flex items-center justify-center">
                                    <MessageSquare className="w-5 h-5 text-white" />
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="p-5 space-y-3">
                        {recentMessages.length === 0 ? (
                            <p className="text-charcoal/40 text-center py-8 text-sm">No hay mensajes recientes.</p>
                        ) : (
                            recentMessages.map((message) => (
                                <div key={message.id} className="p-3 rounded-xl hover:bg-ivory transition-colors cursor-pointer" onClick={() => window.location.href = `/app/messages`}>
                                    <div className="flex items-start gap-3">
                                        <div className="w-8 h-8 bg-sky-100 rounded-lg flex items-center justify-center shrink-0">
                                            <MessageSquare className="w-3.5 h-3.5 text-sky-600" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between gap-1">
                                                <p className="font-semibold text-charcoal text-xs truncate">{message.contact_phone}</p>
                                                <span className="text-[10px] text-charcoal/40 shrink-0">
                                                    {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            </div>
                                            <p className="text-xs text-charcoal/50 mt-1 line-clamp-2">{message.content}</p>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* Bottom Row: Ranking + Analytics */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* Services Ranking */}
                <div className="lg:col-span-1 bg-white rounded-2xl border border-silk-beige shadow-sm overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                    <div className="bg-gradient-to-br from-amber-500 to-amber-700 p-5 text-white">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs font-bold uppercase tracking-widest text-amber-200 mb-1">Este mes</p>
                                <h3 className="text-lg font-extrabold tracking-tight">Top Servicios</h3>
                            </div>
                            <div className="w-10 h-10 bg-white/15 rounded-xl flex items-center justify-center">
                                <Crown className="w-5 h-5 text-white" />
                            </div>
                        </div>
                    </div>
                    <div className="p-5 space-y-3.5">
                        {servicesRanking.length === 0 ? (
                            <p className="text-charcoal/40 text-center py-6 text-sm">Sin datos este mes.</p>
                        ) : (
                            servicesRanking.map((service, index) => (
                                <div key={service.name} className="flex items-center gap-3">
                                    <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                                        index === 0 ? 'bg-amber-100 text-amber-700' :
                                        index === 1 ? 'bg-silk-beige text-charcoal/60' :
                                        index === 2 ? 'bg-orange-100 text-orange-700' :
                                        'bg-ivory text-charcoal/40'
                                    }`}>{index + 1}</span>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex justify-between items-center mb-1">
                                            <p className="text-xs font-semibold text-charcoal truncate">{service.name}</p>
                                            <span className="text-xs text-charcoal/40 shrink-0 ml-2">{service.count}</span>
                                        </div>
                                        <div className="h-1.5 bg-silk-beige/50 rounded-full overflow-hidden">
                                            <div className="h-full bg-amber-500 rounded-full transition-all duration-500" style={{ width: `${service.percentage}%` }} />
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Conversion Rate */}
                <div className="bg-white rounded-2xl border border-silk-beige shadow-sm overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                    <div className="bg-gradient-to-br from-emerald-500 to-emerald-700 p-5 text-white">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs font-bold uppercase tracking-widest text-emerald-200 mb-1">IA Efectividad</p>
                                <h3 className="text-lg font-extrabold tracking-tight">Conversión</h3>
                            </div>
                            <div className="w-14 h-10 bg-white/15 rounded-xl flex items-center justify-center">
                                <span className="text-xl font-extrabold">{conversionStats.rate}<span className="text-sm font-bold opacity-80">%</span></span>
                            </div>
                        </div>
                    </div>
                    <div className="p-5">
                        <p className="text-xs text-charcoal/40 text-center mb-4">contactos que agendaron cita este mes</p>
                        <div className="grid grid-cols-3 gap-3 pt-4 border-t border-silk-beige/50">
                            <div className="text-center">
                                <p className="text-base font-bold text-charcoal">{conversionStats.consultations}</p>
                                <p className="text-xs text-charcoal/40">Contactos</p>
                            </div>
                            <div className="text-center border-x border-silk-beige/50">
                                <p className="text-base font-bold text-emerald-600">{conversionStats.converted}</p>
                                <p className="text-xs text-charcoal/40">Citas</p>
                            </div>
                            <div className="text-center">
                                <p className="text-base font-bold text-charcoal">{conversionStats.lost}</p>
                                <p className="text-xs text-charcoal/40">Sin cita</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Satisfaction NPS */}
                <div className="bg-white rounded-2xl border border-silk-beige shadow-sm overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                    <div className="bg-gradient-to-br from-violet-500 to-violet-700 p-5 text-white">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs font-bold uppercase tracking-widest text-violet-200 mb-1">Post-cita</p>
                                <h3 className="text-lg font-extrabold tracking-tight">Satisfacción NPS</h3>
                            </div>
                            <div className="w-10 h-10 bg-white/15 rounded-xl flex items-center justify-center">
                                <Star className="w-5 h-5 text-white fill-white/60" />
                            </div>
                        </div>
                    </div>
                    <div className="p-5">
                        <div className="text-center py-3">
                            <div className="flex justify-center gap-1 mb-2">
                                {[1, 2, 3, 4, 5].map((star) => (
                                    <Star key={star} className={`w-5 h-5 ${star <= Math.round(satisfactionStats.average) ? 'text-amber-400 fill-amber-400' : 'text-silk-beige'}`} />
                                ))}
                            </div>
                            <p className="text-3xl font-extrabold text-charcoal tracking-tight">{satisfactionStats.average.toFixed(1)}<span className="text-base text-charcoal/30">/5.0</span></p>
                            <p className="text-xs text-charcoal/40 mt-1">{satisfactionStats.responded} respuestas</p>
                        </div>
                        <div className="grid grid-cols-3 gap-3 pt-4 border-t border-silk-beige/50">
                            <div className="text-center">
                                <p className="text-base font-bold text-charcoal">{satisfactionStats.sent}</p>
                                <p className="text-xs text-charcoal/40">Enviadas</p>
                            </div>
                            <div className="text-center border-x border-silk-beige/50">
                                <p className="text-base font-bold text-charcoal">{satisfactionStats.responded}</p>
                                <p className="text-xs text-charcoal/40">Respondidas</p>
                            </div>
                            <div className="text-center">
                                <p className={`text-base font-bold ${satisfactionStats.nps > 0 ? 'text-emerald-600' : 'text-charcoal'}`}>
                                    {satisfactionStats.nps > 0 ? '+' : ''}{satisfactionStats.nps}
                                </p>
                                <p className="text-xs text-charcoal/40">NPS</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
