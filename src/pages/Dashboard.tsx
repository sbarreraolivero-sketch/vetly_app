import { useState, useEffect, useMemo, useRef } from 'react'
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
    Minus,
    ChevronLeft,
    ChevronRight,
    CalendarRange,
    X,
} from 'lucide-react'
import {
    startOfDay, endOfDay,
    startOfMonth, endOfMonth,
    getDay, addDays, addMonths, subMonths,
    isSameDay, isBefore, isAfter,
    differenceInCalendarDays, subDays,
    format as dateFnsFormat,
} from 'date-fns'
import { es as esLocale } from 'date-fns/locale'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useClinicTimezone } from '@/hooks/useClinicTimezone'
import { cn } from '@/lib/utils'
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

    const [timeRange, setTimeRange] = useState<'day' | 'week' | 'month' | 'year' | 'custom'>('month')
    const [customRange, setCustomRange] = useState<{ start: Date; end: Date } | null>(null)
    const [showDatePicker, setShowDatePicker] = useState(false)
    const datePickerRef = useRef<HTMLDivElement>(null)
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

    const { getDateRange, getPreviousDateRange, toUTC } = useClinicTimezone()

    // Estado real del agente IA (clinic_settings.ai_auto_respond)
    const [aiActive, setAiActive] = useState<boolean | null>(null)
    useEffect(() => {
        const fetchAiStatus = async () => {
            if (!profile?.clinic_id) { setAiActive(null); return }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data } = await (supabase as any)
                .from('clinic_settings')
                .select('ai_auto_respond')
                .eq('id', profile.clinic_id)
                .single()
            setAiActive(data?.ai_auto_respond ?? false)
        }
        fetchAiStatus()
    }, [profile?.clinic_id])

    // Cerrar el picker al hacer clic fuera
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (datePickerRef.current && !datePickerRef.current.contains(e.target as Node)) {
                setShowDatePicker(false)
            }
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [])

    useEffect(() => {
        let cancelled = false

        const fetchDashboardData = async () => {
            if (!user || !profile?.clinic_id) return
            if (timeRange === 'custom' && !customRange) return

            setLoading(true)

            try {
                // Use clinic timezone for all date boundaries
                const { start: monthStart } = getDateRange('month')
                const startOfMonth = monthStart.toISOString()

                // Calcular rango del período seleccionado
                let startOfStats: string, endOfStats: string, startOfPrev: string, endOfPrev: string

                if (timeRange === 'custom' && customRange) {
                    startOfStats = toUTC(startOfDay(customRange.start)).toISOString()
                    endOfStats   = toUTC(endOfDay(customRange.end)).toISOString()
                    const days   = differenceInCalendarDays(customRange.end, customRange.start) + 1
                    startOfPrev  = toUTC(startOfDay(subDays(customRange.start, days))).toISOString()
                    endOfPrev    = toUTC(endOfDay(subDays(customRange.end, days))).toISOString()
                } else {
                    const range  = getDateRange(timeRange as 'day' | 'week' | 'month' | 'year')
                    startOfStats = range.start.toISOString()
                    endOfStats   = range.end.toISOString()
                    const prev   = getPreviousDateRange(timeRange as 'day' | 'week' | 'month' | 'year')
                    startOfPrev  = prev.start.toISOString()
                    endOfPrev    = prev.end.toISOString()
                }

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
                    // 5. Appointments in period (for service ranking)
                    (supabase as any)
                        .from('appointments')
                        .select('service')
                        .gte('appointment_date', startOfStats)
                        .lte('appointment_date', endOfStats)
                        .eq('clinic_id', profile.clinic_id)
                        .limit(1000),
                    // 6. Inbound messages in period (for conversion rate)
                    (supabase as any)
                        .from('messages')
                        .select('phone_number')
                        .eq('direction', 'inbound')
                        .gte('created_at', startOfStats)
                        .lte('created_at', endOfStats)
                        .eq('clinic_id', profile.clinic_id)
                        .limit(1000),
                    // 7. Satisfaction surveys (always month — métrica lenta)
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
                    // 10. Cancelled Appointments (by created_at — no updated_at column)
                    supabase
                        .from('appointments')
                        .select('*', { count: 'exact', head: true })
                        .eq('status', 'cancelled')
                        .gte('created_at', startOfStats)
                        .lte('created_at', endOfStats)
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
                        .eq('status', 'cancelled').gte('created_at', startOfPrev).lte('created_at', endOfPrev).eq('clinic_id', profile.clinic_id),
                ])

                // Si el filtro cambió mientras esperábamos, descartar estos resultados
                if (cancelled) return

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
                if (!cancelled) console.error('Error fetching dashboard data:', error)
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        fetchDashboardData()
        return () => { cancelled = true }
    }, [user, profile?.clinic_id, timeRange, customRange])

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
            </div>
        )
    }

    // Tiempo ahorrado: basado en lo que tardaría un humano en hacer cada tarea
    // 3 min/mensaje IA (leer entrante + pensar + escribir respuesta)
    // 5 min/cita agendada (flujo de agendamiento + coordinación en agenda)
    // 2 min/recordatorio (buscar contacto + redactar + enviar manualmente)
    const minutosAhorradosTotal =
        (extraStats.aiMessages * 3) +
        (stats.appointmentsToday * 5) +
        (extraStats.remindersSent * 2);
    const horasAhorradas = Math.floor(minutosAhorradosTotal / 60);
    const minutosAhorrados = minutosAhorradosTotal % 60;
    const tiempoAhorradoStr = horasAhorradas > 0 ? `${horasAhorradas}h ${minutosAhorrados}m` : `${minutosAhorrados}m`;

    // Percentage calculation helper — null significa "sin datos comparables"
    const calculatePercentage = (current: number, previous: number): number | null => {
        if (previous === 0) return current > 0 ? null : 0
        return Math.round(((current - previous) / previous) * 100)
    }

    const compareLabel = timeRange === 'custom' && customRange
        ? `vs. ${differenceInCalendarDays(customRange.end, customRange.start) + 1}d ant.`
        : ({ day: 'vs. ayer', week: 'vs. sem. ant.', month: 'vs. mes ant.', year: 'vs. año ant.' } as Record<string, string>)[timeRange] ?? 'vs. ant.'

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
            name: 'CONVERSACIONES ÚNICAS',
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
            change: null as number | null
        }
    ]

    const ChangeBadge = ({ change }: { change: number | null }) => {
        if (change === null) return (
            <div className="flex flex-col items-end gap-0.5">
                <div className="flex items-center px-2 py-1 rounded-full text-[10px] font-bold bg-silk-beige/50 text-charcoal/30">
                    –
                </div>
                <span className="text-[9px] text-charcoal/25 font-medium pr-0.5">{compareLabel}</span>
            </div>
        )
        const isPositive = change > 0
        const isNeutral = change === 0
        return (
            <div className="flex flex-col items-end gap-0.5">
                <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold ${
                    isNeutral ? 'bg-silk-beige/50 text-charcoal/40' :
                    isPositive ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
                }`}>
                    {isNeutral ? null :
                     isPositive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                    {Math.abs(change)}%
                </div>
                <span className="text-[9px] text-charcoal/25 font-medium pr-0.5">{compareLabel}</span>
            </div>
        )
    }

    // ── Mini calendario de rango ──────────────────────────────────────────
    function MiniCalendar() {
        const [calMonth, setCalMonth] = useState(() => customRange?.start ?? new Date())
        const [selecting, setSelecting] = useState<Date | null>(customRange?.start ?? null)
        const [hovered, setHovered] = useState<Date | null>(null)

        const days = useMemo(() => {
            const first = startOfMonth(calMonth)
            const last  = endOfMonth(calMonth)
            const pad   = (getDay(first) + 6) % 7 // lunes primero
            const grid: (Date | null)[] = Array(pad).fill(null)
            let d = new Date(first)
            while (d <= last) { grid.push(new Date(d)); d = addDays(d, 1) }
            while (grid.length % 7 !== 0) grid.push(null)
            return grid
        }, [calMonth])

        const rangeEnd = selecting ? (hovered ?? null) : null

        const inRange = (d: Date) => {
            if (!selecting || !rangeEnd) return false
            const [a, b] = isBefore(selecting, rangeEnd) ? [selecting, rangeEnd] : [rangeEnd, selecting]
            return !isBefore(d, a) && !isAfter(d, b)
        }

        const isStart = (d: Date) => !!selecting && isSameDay(d, selecting)
        const isEnd   = (d: Date) => !!rangeEnd && isSameDay(d, rangeEnd)
        const isToday = (d: Date) => isSameDay(d, new Date())

        const handleDay = (d: Date) => {
            if (!selecting) {
                setSelecting(d)
            } else {
                const [s, e] = isBefore(d, selecting) ? [d, selecting] : [selecting, d]
                setCustomRange({ start: s, end: e })
                setTimeRange('custom')
                setShowDatePicker(false)
            }
        }

        const weekDays = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

        return (
            <div className="p-3 w-72">
                {/* Navegación de mes */}
                <div className="flex items-center justify-between mb-3">
                    <button onClick={() => setCalMonth(m => subMonths(m, 1))} className="p-1 hover:bg-silk-beige rounded-lg transition-colors">
                        <ChevronLeft className="w-4 h-4 text-charcoal/60" />
                    </button>
                    <span className="text-sm font-bold text-charcoal capitalize">
                        {dateFnsFormat(calMonth, 'MMMM yyyy', { locale: esLocale })}
                    </span>
                    <button onClick={() => setCalMonth(m => addMonths(m, 1))} className="p-1 hover:bg-silk-beige rounded-lg transition-colors">
                        <ChevronRight className="w-4 h-4 text-charcoal/60" />
                    </button>
                </div>
                {/* Cabecera días */}
                <div className="grid grid-cols-7 mb-1">
                    {weekDays.map((w, i) => (
                        <div key={i} className="text-center text-[10px] font-bold text-charcoal/30 py-1">{w}</div>
                    ))}
                </div>
                {/* Grid de días */}
                <div className="grid grid-cols-7">
                    {days.map((d, i) => {
                        if (!d) return <div key={i} />
                        const start = isStart(d)
                        const end   = isEnd(d)
                        const range = inRange(d)
                        const today = isToday(d)
                        return (
                            <button
                                key={i}
                                onMouseEnter={() => selecting && setHovered(d)}
                                onMouseLeave={() => setHovered(null)}
                                onClick={() => handleDay(d)}
                                className={`
                                    relative h-8 text-xs font-medium transition-colors
                                    ${start || end ? 'bg-primary-500 text-white rounded-lg z-10' : ''}
                                    ${range && !start && !end ? 'bg-primary-100 text-primary-700' : ''}
                                    ${!start && !end && !range ? 'hover:bg-silk-beige text-charcoal rounded-lg' : ''}
                                    ${today && !start && !end ? 'font-extrabold' : ''}
                                `}
                            >
                                {today && !start && !end && (
                                    <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-primary-400 rounded-full" />
                                )}
                                {d.getDate()}
                            </button>
                        )
                    })}
                </div>
                {/* Hint */}
                <p className="text-center text-[10px] text-charcoal/30 mt-3">
                    {selecting ? 'Selecciona la fecha de fin' : 'Selecciona la fecha de inicio'}
                </p>
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
                        {aiActive === false
                            ? 'Tu asistente IA está apagado y no responde mensajes.'
                            : 'Tu asistente IA está activo y respondiendo 24/7.'}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <div className={cn(
                        "inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full border",
                        aiActive === false
                            ? "bg-charcoal/5 border-silk-beige text-charcoal/50"
                            : "bg-primary-50 border-primary-200 text-primary-700"
                    )}>
                        <span className={cn(
                            "w-2 h-2 rounded-full",
                            aiActive === false ? "bg-charcoal/30" : "bg-primary-500 animate-pulse"
                        )} />
                        {aiActive === false ? 'Agente apagado' : 'Agente activo'}
                    </div>
                    {/* Filtro de período */}
                    <div className="flex items-center gap-2">
                        <div className="bg-white border border-silk-beige p-1 rounded-xl flex gap-1">
                            {([
                                { id: 'day',   label: 'Hoy' },
                                { id: 'week',  label: 'Sem.' },
                                { id: 'month', label: 'Mes' },
                                { id: 'year',  label: 'Año' },
                            ] as const).map((r) => (
                                <button
                                    key={r.id}
                                    onClick={() => { setTimeRange(r.id); setShowDatePicker(false) }}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                                        timeRange === r.id
                                        ? 'bg-primary-500 text-white shadow-sm'
                                        : 'text-charcoal/50 hover:text-charcoal hover:bg-zinc-50'
                                    }`}
                                >
                                    {r.label}
                                </button>
                            ))}
                        </div>

                        {/* Selector de rango personalizado */}
                        <div className="relative" ref={datePickerRef}>
                            <button
                                onClick={() => setShowDatePicker(v => !v)}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all duration-200 ${
                                    timeRange === 'custom'
                                    ? 'bg-primary-500 text-white border-primary-500 shadow-sm'
                                    : 'bg-white border-silk-beige text-charcoal/50 hover:text-charcoal'
                                }`}
                            >
                                <CalendarRange className="w-3.5 h-3.5" />
                                {timeRange === 'custom' && customRange
                                    ? `${dateFnsFormat(customRange.start, 'd MMM', { locale: esLocale })} – ${dateFnsFormat(customRange.end, 'd MMM', { locale: esLocale })}`
                                    : 'Rango'
                                }
                                {timeRange === 'custom' && customRange && (
                                    <span
                                        onClick={(e) => { e.stopPropagation(); setTimeRange('month'); setCustomRange(null) }}
                                        className="ml-0.5 hover:opacity-70"
                                    >
                                        <X className="w-3 h-3" />
                                    </span>
                                )}
                            </button>

                            {showDatePicker && (
                                <div className="absolute right-0 top-full mt-2 bg-white border border-silk-beige rounded-2xl shadow-xl z-50">
                                    <MiniCalendar />
                                </div>
                            )}
                        </div>
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
                                <h3 className="text-lg font-extrabold tracking-tight text-white">Próximas Citas</h3>
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
                                <h3 className="text-lg font-extrabold tracking-tight text-white">Mensajes Recientes</h3>
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
                                <p className="text-xs font-bold uppercase tracking-widest text-amber-200 mb-1">
                                    {({ day: 'Hoy', week: 'Esta semana', month: 'Este mes', year: 'Este año', custom: 'Período' } as Record<string,string>)[timeRange]}
                                </p>
                                <h3 className="text-lg font-extrabold tracking-tight text-white">Top Servicios</h3>
                            </div>
                            <div className="w-10 h-10 bg-white/15 rounded-xl flex items-center justify-center">
                                <Crown className="w-5 h-5 text-white" />
                            </div>
                        </div>
                    </div>
                    <div className="p-5 space-y-3.5">
                        {servicesRanking.length === 0 ? (
                            <p className="text-charcoal/40 text-center py-6 text-sm">Sin datos en el período.</p>
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
                                <h3 className="text-lg font-extrabold tracking-tight text-white">Conversión</h3>
                            </div>
                            <div className="w-14 h-10 bg-white/15 rounded-xl flex items-center justify-center">
                                <span className="text-xl font-extrabold">{conversionStats.rate}<span className="text-sm font-bold opacity-80">%</span></span>
                            </div>
                        </div>
                    </div>
                    <div className="p-5">
                        <p className="text-xs text-charcoal/40 text-center mb-4">
                            contactos que agendaron cita {({ day: 'hoy', week: 'esta semana', month: 'este mes', year: 'este año', custom: 'en el período' } as Record<string,string>)[timeRange]}
                        </p>
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
                                <h3 className="text-lg font-extrabold tracking-tight text-white">Satisfacción NPS</h3>
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
