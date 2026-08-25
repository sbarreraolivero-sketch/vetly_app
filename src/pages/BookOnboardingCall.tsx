import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { createClient } from '@supabase/supabase-js'
import { format, addDays, isSameDay, startOfToday, setHours, setMinutes, isWeekend } from 'date-fns'
import { es } from 'date-fns/locale'
import { Loader2, Calendar as CalendarIcon, Clock, CheckCircle2, PawPrint } from 'lucide-react'

// Página pública — puede abrirse sin sesión iniciada (llega por el correo de
// bienvenida). Cliente propio sin persistencia de sesión: si se abre en el
// mismo navegador donde ya hay una sesión de dashboard activa, evita el
// conflicto de Web Locks documentado en ReferralRedirect.tsx / PetOwnerPortal.tsx.
const publicClient = createClient(
    import.meta.env.VITE_SUPABASE_URL || '',
    import.meta.env.VITE_SUPABASE_ANON_KEY || '',
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
)

const timeSlots: string[] = []
for (let h = 9; h < 18; h++) {
    timeSlots.push(`${h.toString().padStart(2, '0')}:00`)
    timeSlots.push(`${h.toString().padStart(2, '0')}:30`)
}

export default function BookOnboardingCall() {
    const [searchParams] = useSearchParams()
    const clinicId = searchParams.get('clinic_id') || null
    const plan = searchParams.get('plan') || null

    const [name, setName] = useState(searchParams.get('name') || '')
    const [email, setEmail] = useState(searchParams.get('email') || '')
    const [clinicName] = useState(searchParams.get('clinic') || '')
    const [phone, setPhone] = useState('')

    const [selectedDate, setSelectedDate] = useState<Date | null>(null)
    const [selectedTime, setSelectedTime] = useState<string | null>(null)
    const [bookedSlots, setBookedSlots] = useState<Date[]>([])
    const [loadingSlots, setLoadingSlots] = useState(true)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState(false)

    const availableDates = useMemo(
        () => Array.from({ length: 14 }).map((_, i) => addDays(startOfToday(), i + 1)).filter(d => !isWeekend(d)).slice(0, 8),
        []
    )

    useEffect(() => {
        (publicClient as any).rpc('get_hq_booked_slots', { p_days: 21 })
            .then(({ data }: any) => {
                setBookedSlots((data || []).map((r: any) => new Date(r.scheduled_at)))
            })
            .finally(() => setLoadingSlots(false))
    }, [])

    const handleConfirm = async () => {
        if (!selectedDate || !selectedTime || !name.trim() || !email.trim()) {
            setError('Completa tu nombre, correo y elige día/hora.')
            return
        }
        setError(null)
        setSubmitting(true)
        try {
            const [hours, minutes] = selectedTime.split(':').map(Number)
            const scheduledDatetime = setMinutes(setHours(selectedDate, hours), minutes)

            const { data: inserted, error: insertErr } = await (publicClient as any)
                .from('hq_appointments')
                .insert({
                    clinic_id: clinicId,
                    contact_name: name.trim(),
                    contact_email: email.trim(),
                    contact_phone: phone.trim() ? phone.trim().replace(/\D/g, '') : null,
                    plan,
                    scheduled_at: scheduledDatetime.toISOString(),
                    duration_minutes: 30,
                    status: 'scheduled',
                    source: 'welcome_email',
                })
                .select('id')
                .single()

            if (insertErr) throw insertErr

            // Fire-and-forget: la reserva ya quedó guardada, la notificación no
            // debe bloquear la pantalla de éxito si falla.
            publicClient.functions.invoke('hq-booking-notify', { body: { appointment_id: inserted.id } }).catch(() => {})

            setSuccess(true)
        } catch (err: any) {
            console.error('Error al agendar:', err)
            setError('No pudimos guardar tu reserva. Intenta de nuevo o escríbenos por WhatsApp.')
        } finally {
            setSubmitting(false)
        }
    }

    if (success) {
        return (
            <div className="min-h-screen bg-ivory flex items-center justify-center px-6 py-12">
                <div className="max-w-md w-full text-center">
                    <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
                        <CheckCircle2 className="w-10 h-10 text-emerald-600" />
                    </div>
                    <h1 className="text-2xl font-black text-charcoal mb-3">¡Videollamada agendada!</h1>
                    <p className="text-charcoal/60 mb-8">
                        Te enviamos la confirmación a <strong>{email}</strong>. Nuestro equipo te escribirá por WhatsApp a la hora agendada para conectar la llamada.
                    </p>
                    {selectedDate && selectedTime && (
                        <div className="bg-white p-6 rounded-2xl border border-silk-beige text-left">
                            <div className="flex items-center gap-3 text-charcoal mb-3">
                                <CalendarIcon className="w-5 h-5 text-primary-600" />
                                <span className="font-bold capitalize">{format(selectedDate, "EEEE d 'de' MMMM", { locale: es })}</span>
                            </div>
                            <div className="flex items-center gap-3 text-charcoal">
                                <Clock className="w-5 h-5 text-primary-600" />
                                <span className="font-bold">{selectedTime} hrs (Chile)</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-ivory px-4 py-10 sm:py-16">
            <div className="max-w-3xl mx-auto">
                <div className="text-center mb-10">
                    <PawPrint className="w-10 h-10 text-primary-600 mx-auto mb-3" />
                    <h1 className="text-3xl font-black text-charcoal">Agenda tu videollamada de activación</h1>
                    <p className="text-charcoal/60 mt-2 max-w-xl mx-auto">
                        30 minutos con nuestro equipo para conocer la plataforma y dejar tu clínica {clinicName ? <strong>{clinicName}</strong> : ''} funcionando correctamente desde el primer día.
                    </p>
                </div>

                <div className="bg-white rounded-3xl border border-silk-beige shadow-sm overflow-hidden">
                    <div className="p-6 sm:p-8 border-b border-silk-beige grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <input
                            type="text" placeholder="Tu nombre" value={name}
                            onChange={e => setName(e.target.value)}
                            className="px-4 py-3 rounded-xl border border-silk-beige bg-ivory/60 focus:outline-none focus:ring-2 focus:ring-primary-500/30 text-charcoal font-medium"
                        />
                        <input
                            type="email" placeholder="Tu correo" value={email}
                            onChange={e => setEmail(e.target.value)}
                            className="px-4 py-3 rounded-xl border border-silk-beige bg-ivory/60 focus:outline-none focus:ring-2 focus:ring-primary-500/30 text-charcoal font-medium"
                        />
                        <input
                            type="tel" placeholder="WhatsApp (opcional)" value={phone}
                            onChange={e => setPhone(e.target.value)}
                            className="px-4 py-3 rounded-xl border border-silk-beige bg-ivory/60 focus:outline-none focus:ring-2 focus:ring-primary-500/30 text-charcoal font-medium"
                        />
                    </div>

                    <div className="flex flex-col md:flex-row p-6 sm:p-8 gap-8">
                        <div className="flex-1">
                            <h3 className="text-xs font-black uppercase tracking-widest text-charcoal/40 mb-4">Elige un día</h3>
                            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                                {availableDates.map(date => {
                                    const isSelected = selectedDate && isSameDay(date, selectedDate)
                                    return (
                                        <button
                                            key={date.toISOString()}
                                            onClick={() => { setSelectedDate(date); setSelectedTime(null) }}
                                            className={`w-full flex items-center justify-between p-3.5 rounded-xl border-2 transition-all ${isSelected
                                                ? 'border-primary-500 bg-primary-50 text-primary-700'
                                                : 'border-silk-beige hover:border-primary-300 text-charcoal'
                                                }`}
                                        >
                                            <span className="font-bold capitalize text-sm">{format(date, 'EEEE', { locale: es })}</span>
                                            <span className="text-sm text-charcoal/50">{format(date, 'd MMM', { locale: es })}</span>
                                        </button>
                                    )
                                })}
                            </div>
                        </div>

                        <div className="flex-1 border-t md:border-t-0 md:border-l border-silk-beige pt-6 md:pt-0 md:pl-8">
                            <h3 className="text-xs font-black uppercase tracking-widest text-charcoal/40 mb-4">Elige un horario</h3>
                            {loadingSlots ? (
                                <div className="flex items-center justify-center h-40 text-charcoal/30">
                                    <Loader2 className="w-6 h-6 animate-spin" />
                                </div>
                            ) : selectedDate ? (
                                <div className="grid grid-cols-3 gap-2">
                                    {timeSlots.map(time => {
                                        const [h, m] = time.split(':').map(Number)
                                        const slotTime = setMinutes(setHours(selectedDate, h), m)
                                        const isBooked = bookedSlots.some(b => b.getTime() === slotTime.getTime())
                                        const isSelected = selectedTime === time
                                        return (
                                            <button
                                                key={time}
                                                disabled={isBooked}
                                                onClick={() => setSelectedTime(time)}
                                                className={`py-2.5 rounded-lg border-2 font-bold text-sm text-center transition-all ${isBooked
                                                    ? 'border-silk-beige bg-ivory text-charcoal/20 cursor-not-allowed line-through'
                                                    : isSelected
                                                        ? 'border-primary-500 bg-primary-500 text-white'
                                                        : 'border-silk-beige text-charcoal hover:border-primary-400'
                                                    }`}
                                            >
                                                {time}
                                            </button>
                                        )
                                    })}
                                </div>
                            ) : (
                                <p className="text-sm text-charcoal/40">Selecciona un día para ver los horarios.</p>
                            )}
                        </div>
                    </div>

                    <div className="p-6 sm:p-8 border-t border-silk-beige bg-ivory/60 flex flex-col sm:flex-row items-center justify-between gap-4">
                        <div className="text-sm text-charcoal/60">
                            {error && <span className="text-red-600 font-medium">{error}</span>}
                            {!error && selectedDate && selectedTime && (
                                <span>Reserva para el <strong className="capitalize">{format(selectedDate, 'EEEE d')} a las {selectedTime}</strong> hrs</span>
                            )}
                        </div>
                        <button
                            disabled={submitting}
                            onClick={handleConfirm}
                            className="btn-primary px-8 py-3 w-full sm:w-auto shadow-sm disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                            Confirmar videollamada
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
