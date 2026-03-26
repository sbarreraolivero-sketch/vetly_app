import { useState, useEffect } from 'react'
import { format, addDays, isSameDay, startOfToday, setHours, setMinutes, isBefore, isWeekend } from 'date-fns'
import { es } from 'date-fns/locale'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Loader2, Calendar as CalendarIcon, Clock, CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react'

export function HQBookingForm() {
    const { profile } = useAuth()
    const [selectedDate, setSelectedDate] = useState<Date | null>(null)
    const [selectedTime, setSelectedTime] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [success, setSuccess] = useState(false)
    const [existingAppointments, setExistingAppointments] = useState<Date[]>([])
    const [currentWeekStart, setCurrentWeekStart] = useState(startOfToday())

    // Generar próximos 14 días disponibles (saltando fines de semana)
    const availableDates = Array.from({ length: 14 }).map((_, i) => addDays(currentWeekStart, i)).filter(d => !isWeekend(d)).slice(0, 5)

    // Horarios disponibles (9:00 a 17:00, cada 30 min)
    const timeSlots = []
    for (let h = 9; h <= 17; h++) {
        timeSlots.push(`${h.toString().padStart(2, '0')}:00`)
        if (h !== 17) { // No 17:30
            timeSlots.push(`${h.toString().padStart(2, '0')}:30`)
        }
    }

    useEffect(() => {
        // Fetch existing appointments to block taken slots
        const fetchAppointments = async () => {
            const { data, error } = await (supabase as any)
                .from('hq_appointments')
                .select('scheduled_at')
                .gte('scheduled_at', currentWeekStart.toISOString())
                .eq('status', 'scheduled')

            if (data && !error) {
                setExistingAppointments(data.map((a: any) => new Date(a.scheduled_at)))
            }
        }
        fetchAppointments()
    }, [currentWeekStart])

    const handleNextWeek = () => setCurrentWeekStart(prev => addDays(prev, 7))
    const handlePrevWeek = () => {
        const newStart = addDays(currentWeekStart, -7)
        if (!isBefore(newStart, startOfToday())) {
            setCurrentWeekStart(newStart)
        }
    }

    const handleConfirm = async () => {
        if (!selectedDate || !selectedTime || !profile?.clinic_id) return

        setLoading(true)
        try {
            const [hours, minutes] = selectedTime.split(':').map(Number)
            const scheduledDatetime = setMinutes(setHours(selectedDate, hours), minutes)

            const { error } = await (supabase as any).from('hq_appointments').insert({
                clinic_id: profile.clinic_id,
                scheduled_at: scheduledDatetime.toISOString(),
                duration_minutes: 15,
                status: 'scheduled'
            })

            if (error) throw error

            try {
                const dateStr = format(selectedDate, "EEEE d 'de' MMMM, yyyy", { locale: es })
                await supabase.functions.invoke('send-booking-email', {
                    body: {
                        email: profile.email,
                        name: profile.full_name,
                        dateStr,
                        timeStr: selectedTime
                    }
                });
            } catch (e) {
                console.error("Error sending booking email:", e);
            }

            setSuccess(true)
        } catch (error) {
            console.error('Error booking appointment:', error)
            alert('Error al agendar la cita. Por favor intenta nuevamente.')
        } finally {
            setLoading(false)
        }
    }

    if (success) {
        return (
            <div className="flex flex-col items-center justify-center p-12 text-center h-full">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-6">
                    <CheckCircle2 className="w-10 h-10 text-green-600" />
                </div>
                <h3 className="text-2xl font-black text-charcoal mb-4">¡Sesión Agendada Exitosamente!</h3>
                <p className="text-gray-600 mb-8 max-w-md">
                    Hemos reservado tu horario. Un consultor estratégico de Vetly AI se conectará contigo para tu activación oficial.
                    <br /><br />
                    <strong>Te hemos enviado un correo con el enlace a la videollamada para que lo guardes en tu calendario.</strong>
                </p>
                <div className="bg-gray-50 p-6 rounded-2xl w-full max-w-sm border border-gray-100">
                    <div className="flex items-center gap-3 text-charcoal mb-3">
                        <CalendarIcon className="w-5 h-5 text-primary-600" />
                        <span className="font-medium capitalize">{selectedDate && format(selectedDate, 'EEEE d, MMMM', { locale: es })}</span>
                    </div>
                    <div className="flex items-center gap-3 text-charcoal">
                        <Clock className="w-5 h-5 text-primary-600" />
                        <span className="font-medium">{selectedTime} hrs</span>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col h-full bg-white">
            <div className="p-8 border-b border-gray-100">
                <h2 className="text-2xl font-bold text-charcoal">Selecciona tu horario</h2>
                <p className="text-gray-500 mt-2">Sesión de Activación Estratégica (30-45 min aprox)</p>
                <div className="mt-4 bg-primary-50 text-primary-700 p-3 rounded-lg text-sm flex gap-3 items-start">
                    <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                    <p>Al confirmar tu horario, te enviaremos un correo electrónico con el enlace de Google Meet para nuestra videollamada.</p>
                </div>
            </div>

            <div className="flex-1 flex flex-col md:flex-row p-6 gap-8 overflow-y-auto">
                {/* Selector de Fecha */}
                <div className="flex-1">
                    <div className="flex items-center justify-between mb-6">
                        <button
                            onClick={handlePrevWeek}
                            disabled={isBefore(addDays(currentWeekStart, -7), startOfToday())}
                            className="p-2 hover:bg-gray-100 rounded-full disabled:opacity-50 transition-colors"
                        >
                            <ChevronLeft className="w-5 h-5 text-charcoal" />
                        </button>
                        <span className="font-bold text-charcoal capitalize">
                            {format(currentWeekStart, 'MMMM yyyy', { locale: es })}
                        </span>
                        <button
                            onClick={handleNextWeek}
                            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                        >
                            <ChevronRight className="w-5 h-5 text-charcoal" />
                        </button>
                    </div>

                    <div className="space-y-3">
                        {availableDates.map(date => {
                            const isSelected = selectedDate && isSameDay(date, selectedDate)
                            return (
                                <button
                                    key={date.toISOString()}
                                    onClick={() => { setSelectedDate(date); setSelectedTime(null); }}
                                    className={`w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all ${isSelected
                                        ? 'border-primary-500 bg-primary-50 text-primary-700'
                                        : 'border-gray-100 hover:border-primary-300 hover:bg-gray-50 text-charcoal'
                                        }`}
                                >
                                    <span className="font-bold capitalize">{format(date, 'EEEE', { locale: es })}</span>
                                    <span className={isSelected ? 'text-primary-600 font-medium' : 'text-gray-500'}>
                                        {format(date, 'd MMM', { locale: es })}
                                    </span>
                                </button>
                            )
                        })}
                    </div>
                </div>

                {/* Selector de Hora */}
                <div className="flex-1 border-t md:border-t-0 md:border-l border-gray-100 pt-6 md:pt-0 md:pl-8">
                    {selectedDate ? (
                        <>
                            <h3 className="font-bold text-charcoal mb-6 capitalize">
                                {format(selectedDate, 'EEEE d, MMMM', { locale: es })}
                            </h3>
                            <div className="grid grid-cols-2 gap-3">
                                {timeSlots.map(time => {
                                    const [hours, minutes] = time.split(':').map(Number)
                                    const slotTime = setMinutes(setHours(selectedDate, hours), minutes)
                                    const isBooked = existingAppointments.some(a => a.getTime() === slotTime.getTime())
                                    const isSelected = selectedTime === time

                                    return (
                                        <button
                                            key={time}
                                            disabled={isBooked}
                                            onClick={() => setSelectedTime(time)}
                                            className={`p-3 rounded-xl border-2 font-bold text-center transition-all ${isBooked
                                                ? 'border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed'
                                                : isSelected
                                                    ? 'border-primary-500 bg-primary-500 text-white shadow-md'
                                                    : 'border-gray-200 text-charcoal hover:border-primary-500 hover:text-primary-600'
                                                }`}
                                        >
                                            {time}
                                        </button>
                                    )
                                })}
                            </div>
                        </>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-gray-400">
                            <CalendarIcon className="w-12 h-12 mb-4 opacity-50" />
                            <p>Selecciona un día para ver los horarios disponibles</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Sticky Footer */}
            <div className="p-6 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
                <div>
                    {selectedDate && selectedTime ? (
                        <p className="text-sm font-medium text-charcoal">
                            Reserva para el <span className="capitalize">{format(selectedDate, 'EEEE d')} a las {selectedTime}hrs</span>
                        </p>
                    ) : (
                        <p className="text-sm text-gray-500">Selecciona día y hora</p>
                    )}
                </div>
                <button
                    disabled={!selectedDate || !selectedTime || loading}
                    onClick={handleConfirm}
                    className="btn-primary px-8 py-3 w-full sm:w-auto shadow-sm disabled:opacity-50 flex items-center justify-center gap-2"
                >
                    {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                    Confirmar Sesión
                </button>
            </div>
        </div>
    )
}
