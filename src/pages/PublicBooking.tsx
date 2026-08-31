import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { createClient } from '@supabase/supabase-js'
import { format, addDays, isSameDay, startOfToday, setHours, setMinutes, isWeekend } from 'date-fns'
import { fromZonedTime } from 'date-fns-tz'
import { es } from 'date-fns/locale'
import { Loader2, Calendar as CalendarIcon, Clock, CheckCircle2, ChevronLeft, Stethoscope } from 'lucide-react'

// Página pública por clínica -- sin sesión, mismo patrón que /agendar,
// /r/:code y /p/:code (cliente propio sin persistencia, evita el conflicto
// de Web Locks si se abre en el mismo navegador que ya tiene el dashboard
// abierto).
const publicClient = createClient(
    import.meta.env.VITE_SUPABASE_URL || '',
    import.meta.env.VITE_SUPABASE_ANON_KEY || '',
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
)

interface ClinicInfo {
    clinic_id: string
    clinic_name: string
    logo_url: string | null
    brand_color: string
    brand_color_secondary: string | null
    currency: string
    timezone: string
}

interface ServiceInfo {
    id: string
    name: string
    duration: number
    price: number
}

const currencySymbols: Record<string, string> = { CLP: '$', USD: 'US$', MXN: '$', COP: '$', PEN: 'S/' }

type Step = 'service' | 'datetime' | 'contact' | 'success'

export default function PublicBooking() {
    const { slug } = useParams<{ slug: string }>()

    const [loading, setLoading] = useState(true)
    const [clinic, setClinic] = useState<ClinicInfo | null>(null)
    const [services, setServices] = useState<ServiceInfo[]>([])
    const [step, setStep] = useState<Step>('service')
    const [error, setError] = useState<string | null>(null)

    const [selectedService, setSelectedService] = useState<ServiceInfo | null>(null)
    const [selectedDate, setSelectedDate] = useState<Date | null>(null)
    const [selectedTime, setSelectedTime] = useState<string | null>(null)
    const [slots, setSlots] = useState<{ slot_time: string; is_available: boolean }[]>([])
    const [loadingSlots, setLoadingSlots] = useState(false)

    const [firstName, setFirstName] = useState('')
    const [lastName, setLastName] = useState('')
    const [phone, setPhone] = useState('')
    const [email, setEmail] = useState('')
    const [petName, setPetName] = useState('')
    const [submitting, setSubmitting] = useState(false)

    const brandColor = clinic?.brand_color || '#0d9488'
    const brandColorTo = clinic?.brand_color_secondary || `${brandColor}cc`

    useEffect(() => {
        if (!slug) { setLoading(false); return }
        ;(async () => {
            const { data: clinicRows } = await (publicClient as any).rpc('get_public_booking_clinic', { p_slug: slug })
            const clinicInfo = clinicRows?.[0] as ClinicInfo | undefined
            if (!clinicInfo) { setLoading(false); return }
            setClinic(clinicInfo)

            const { data: serviceRows } = await (publicClient as any).rpc('get_public_booking_services', { p_clinic_id: clinicInfo.clinic_id })
            setServices(serviceRows || [])
            setLoading(false)
        })()
    }, [slug])

    const availableDates = useMemo(
        () => Array.from({ length: 21 }).map((_, i) => addDays(startOfToday(), i + 1)).filter(d => !isWeekend(d)).slice(0, 10),
        []
    )

    // Los horarios ofrecidos son siempre en la zona horaria REAL de la
    // clínica (no asumir Chile) -- mismo bug que se corrigió en /agendar.
    const clinicDateTime = (date: Date, timeStr: string): Date => {
        const [hours, minutes] = timeStr.split(':').map(Number)
        const naive = setMinutes(setHours(date, hours), minutes)
        return fromZonedTime(naive, clinic?.timezone || 'America/Santiago')
    }

    useEffect(() => {
        if (!selectedDate || !selectedService || !clinic) return
        setLoadingSlots(true)
        setSelectedTime(null)
        const dateStr = format(selectedDate, 'yyyy-MM-dd')
        ;(publicClient as any).rpc('get_public_booking_slots', {
            p_clinic_id: clinic.clinic_id, p_date: dateStr, p_duration: selectedService.duration,
        })
            .then(({ data }: any) => setSlots((data || []).filter((s: any) => s.is_available)))
            .finally(() => setLoadingSlots(false))
    }, [selectedDate, selectedService, clinic])

    const handleConfirm = async () => {
        if (!clinic || !selectedService || !selectedDate || !selectedTime || !firstName.trim() || !lastName.trim() || !phone.trim() || !petName.trim()) {
            setError('Completa todos los campos y elige día/hora.')
            return
        }
        setError(null)
        setSubmitting(true)
        try {
            const normalizedPhone = phone.trim().replace(/\D/g, '')
            const fullName = `${firstName.trim()} ${lastName.trim()}`.trim()

            // Buscar tutor existente por teléfono antes de crear uno nuevo --
            // mismo patrón find-or-create del importador CSV. anon no tiene
            // SELECT sobre tutors (evita fugar contactos de otros clientes),
            // así que la búsqueda pasa por una RPC dedicada que solo
            // devuelve el id.
            const { data: existingTutorId } = await (publicClient as any).rpc('find_tutor_by_phone_public', {
                p_clinic_id: clinic.clinic_id, p_phone: normalizedPhone,
            })

            let tutorId = existingTutorId as string | null
            if (!tutorId) {
                tutorId = crypto.randomUUID()
                const { error: tutorErr } = await (publicClient as any).from('tutors').insert({
                    id: tutorId, clinic_id: clinic.clinic_id, phone_number: normalizedPhone,
                    name: fullName, email: email.trim() || null,
                })
                if (tutorErr) throw tutorErr
            }

            const scheduledDatetime = clinicDateTime(selectedDate, selectedTime)
            const appointmentId = crypto.randomUUID()

            const { error: apptErr } = await (publicClient as any).from('appointments').insert({
                id: appointmentId,
                clinic_id: clinic.clinic_id,
                tutor_id: tutorId,
                tutor_name: fullName,
                phone_number: normalizedPhone,
                email: email.trim() || null,
                patient_name: petName.trim(),
                service: selectedService.name,
                price: selectedService.price,
                duration: selectedService.duration,
                duration_minutes: selectedService.duration,
                appointment_date: scheduledDatetime.toISOString(),
                status: 'confirmed',
                booking_source: 'online',
            })
            if (apptErr) throw apptErr

            publicClient.functions.invoke('public-booking-notify', { body: { appointment_id: appointmentId } }).catch(() => {})

            setStep('success')
        } catch (err: any) {
            console.error('Error al agendar:', err)
            setError('No pudimos guardar tu reserva. Intenta de nuevo en unos minutos.')
        } finally {
            setSubmitting(false)
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-ivory flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-charcoal/30" />
            </div>
        )
    }

    if (!clinic) {
        return (
            <div className="min-h-screen bg-ivory flex items-center justify-center px-6 text-center">
                <div>
                    <p className="text-2xl font-black text-charcoal mb-2">Página no disponible</p>
                    <p className="text-charcoal/60">Este enlace de reservas no existe o ya no está activo.</p>
                </div>
            </div>
        )
    }

    const currencySymbol = currencySymbols[clinic.currency] || '$'

    return (
        <div className="min-h-screen bg-ivory">
            <div className="p-6 sm:p-8 text-center text-white" style={{ background: `linear-gradient(135deg, ${brandColor}, ${brandColorTo})` }}>
                {clinic.logo_url && (
                    <img src={clinic.logo_url} alt={clinic.clinic_name} className="h-14 mx-auto mb-3 object-contain" />
                )}
                {/* text-white explícito + sombra: la regla base h1{text-charcoal} de index.css
                    gana sobre el text-white heredado del contenedor con gradiente. */}
                <h1 className="text-2xl font-black text-white" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.35)' }}>{clinic.clinic_name}</h1>
                <p className="text-white/90 text-sm mt-1" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.25)' }}>Agenda tu cita online</p>
            </div>

            <div className="max-w-2xl mx-auto p-4 sm:p-6 -mt-4">
                <div className="bg-white rounded-3xl border border-silk-beige shadow-lg overflow-hidden">
                    {error && (
                        <div className="m-6 mb-0 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>
                    )}

                    {step === 'service' && (
                        <div className="p-6 sm:p-8">
                            <h2 className="text-lg font-black text-charcoal mb-4">¿Qué servicio necesitas?</h2>
                            {services.length === 0 ? (
                                <p className="text-charcoal/50 text-sm">Esta clínica todavía no tiene servicios disponibles para reservar online.</p>
                            ) : (
                                <div className="space-y-2">
                                    {services.map(s => (
                                        <button
                                            key={s.id}
                                            onClick={() => { setSelectedService(s); setStep('datetime') }}
                                            className="w-full flex items-center justify-between p-4 rounded-xl border-2 border-silk-beige hover:border-current text-left transition-colors"
                                            style={{ ['--tw-border-opacity' as any]: 1 }}
                                            onMouseEnter={e => (e.currentTarget.style.borderColor = brandColor)}
                                            onMouseLeave={e => (e.currentTarget.style.borderColor = '')}
                                        >
                                            <div className="flex items-center gap-3">
                                                <Stethoscope className="w-5 h-5 shrink-0" style={{ color: brandColor }} />
                                                <div>
                                                    <p className="font-bold text-charcoal">{s.name}</p>
                                                    <p className="text-xs text-charcoal/50">{s.duration} min</p>
                                                </div>
                                            </div>
                                            <p className="font-black text-charcoal">{currencySymbol}{s.price.toLocaleString()}</p>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {step === 'datetime' && selectedService && (
                        <div className="p-6 sm:p-8">
                            <button onClick={() => setStep('service')} className="flex items-center gap-1 text-sm text-charcoal/50 hover:text-charcoal mb-4">
                                <ChevronLeft className="w-4 h-4" /> Cambiar servicio
                            </button>
                            <h2 className="text-lg font-black text-charcoal mb-1">{selectedService.name}</h2>
                            <p className="text-sm text-charcoal/50 mb-6">{selectedService.duration} min · {currencySymbol}{selectedService.price.toLocaleString()}</p>

                            <div className="flex flex-col md:flex-row gap-8">
                                <div className="flex-1">
                                    <h3 className="text-xs font-black uppercase tracking-widest text-charcoal/40 mb-3">Elige un día</h3>
                                    <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                                        {availableDates.map(date => {
                                            const isSelected = selectedDate && isSameDay(date, selectedDate)
                                            return (
                                                <button
                                                    key={date.toISOString()}
                                                    onClick={() => setSelectedDate(date)}
                                                    className="w-full flex items-center justify-between p-3 rounded-xl border-2 transition-all"
                                                    style={isSelected ? { borderColor: brandColor, backgroundColor: `${brandColor}14`, color: brandColor } : { borderColor: '#EDE6DE' }}
                                                >
                                                    <span className="font-bold capitalize text-sm">{format(date, 'EEEE', { locale: es })}</span>
                                                    <span className="text-sm opacity-60">{format(date, 'd MMM', { locale: es })}</span>
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>
                                <div className="flex-1 border-t md:border-t-0 md:border-l border-silk-beige pt-6 md:pt-0 md:pl-8">
                                    <h3 className="text-xs font-black uppercase tracking-widest text-charcoal/40 mb-3">Elige un horario</h3>
                                    {!selectedDate ? (
                                        <p className="text-sm text-charcoal/40">Selecciona un día primero.</p>
                                    ) : loadingSlots ? (
                                        <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-charcoal/30" /></div>
                                    ) : slots.length === 0 ? (
                                        <p className="text-sm text-charcoal/40">No hay horarios disponibles ese día. Elige otra fecha.</p>
                                    ) : (
                                        <div className="grid grid-cols-3 gap-2">
                                            {slots.map(s => {
                                                const timeLabel = s.slot_time.slice(0, 5)
                                                const isSelected = selectedTime === timeLabel
                                                return (
                                                    <button
                                                        key={s.slot_time}
                                                        onClick={() => setSelectedTime(timeLabel)}
                                                        className="py-2.5 rounded-lg border-2 font-bold text-sm text-center transition-all"
                                                        style={isSelected ? { borderColor: brandColor, backgroundColor: brandColor, color: 'white' } : { borderColor: '#EDE6DE' }}
                                                    >
                                                        {timeLabel}
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <button
                                disabled={!selectedDate || !selectedTime}
                                onClick={() => setStep('contact')}
                                className="w-full mt-6 py-3 rounded-xl font-bold text-white disabled:opacity-40 transition-opacity"
                                style={{ backgroundColor: brandColor }}
                            >
                                Continuar
                            </button>
                        </div>
                    )}

                    {step === 'contact' && selectedService && selectedDate && selectedTime && (
                        <div className="p-6 sm:p-8">
                            <button onClick={() => setStep('datetime')} className="flex items-center gap-1 text-sm text-charcoal/50 hover:text-charcoal mb-4">
                                <ChevronLeft className="w-4 h-4" /> Cambiar horario
                            </button>
                            <h2 className="text-lg font-black text-charcoal mb-1">Tus datos</h2>
                            <p className="text-sm text-charcoal/50 mb-6 capitalize">
                                {format(selectedDate, "EEEE d 'de' MMMM", { locale: es })} a las {selectedTime} hrs
                            </p>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <input type="text" placeholder="Nombre" value={firstName} onChange={e => setFirstName(e.target.value)}
                                    className="px-4 py-3 rounded-xl border border-silk-beige bg-ivory/60 focus:outline-none text-charcoal font-medium" />
                                <input type="text" placeholder="Apellido" value={lastName} onChange={e => setLastName(e.target.value)}
                                    className="px-4 py-3 rounded-xl border border-silk-beige bg-ivory/60 focus:outline-none text-charcoal font-medium" />
                                <input type="tel" placeholder="WhatsApp" value={phone} onChange={e => setPhone(e.target.value)}
                                    className="px-4 py-3 rounded-xl border border-silk-beige bg-ivory/60 focus:outline-none text-charcoal font-medium" />
                                <input type="email" placeholder="Correo (opcional)" value={email} onChange={e => setEmail(e.target.value)}
                                    className="px-4 py-3 rounded-xl border border-silk-beige bg-ivory/60 focus:outline-none text-charcoal font-medium" />
                                <input type="text" placeholder="Nombre de tu mascota" value={petName} onChange={e => setPetName(e.target.value)}
                                    className="px-4 py-3 rounded-xl border border-silk-beige bg-ivory/60 focus:outline-none text-charcoal font-medium sm:col-span-2" />
                            </div>

                            <button
                                disabled={submitting}
                                onClick={handleConfirm}
                                className="w-full mt-6 py-3 rounded-xl font-bold text-white disabled:opacity-40 transition-opacity flex items-center justify-center gap-2"
                                style={{ backgroundColor: brandColor }}
                            >
                                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                                Confirmar cita
                            </button>
                        </div>
                    )}

                    {step === 'success' && selectedService && selectedDate && selectedTime && (
                        <div className="p-6 sm:p-8 text-center">
                            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                <CheckCircle2 className="w-8 h-8 text-emerald-600" />
                            </div>
                            <h2 className="text-xl font-black text-charcoal mb-2">¡Cita confirmada!</h2>
                            <p className="text-charcoal/60 mb-6">Te esperamos. Cualquier cambio, contáctanos directamente.</p>
                            <div className="bg-ivory p-5 rounded-2xl border border-silk-beige text-left space-y-3">
                                <div className="flex items-center gap-3 text-charcoal">
                                    <Stethoscope className="w-5 h-5" style={{ color: brandColor }} />
                                    <span className="font-bold">{selectedService.name}</span>
                                </div>
                                <div className="flex items-center gap-3 text-charcoal">
                                    <CalendarIcon className="w-5 h-5" style={{ color: brandColor }} />
                                    <span className="font-bold capitalize">{format(selectedDate, "EEEE d 'de' MMMM", { locale: es })}</span>
                                </div>
                                <div className="flex items-center gap-3 text-charcoal">
                                    <Clock className="w-5 h-5" style={{ color: brandColor }} />
                                    <span className="font-bold">{selectedTime} hrs</span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <p className="text-center text-xs text-charcoal/30 mt-6">Reservas online por Vetly</p>
            </div>
        </div>
    )
}
