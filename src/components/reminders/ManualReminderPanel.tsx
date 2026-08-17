import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { addDays, format as dateFnsFormat } from 'date-fns'
import {
    ChevronLeft, ChevronRight, Loader2, CheckCircle2, Send,
    CalendarDays, Zap, Info,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useClinicTimezone } from '@/hooks/useClinicTimezone'
import { usePlan } from '@/hooks/usePlan'
import { UPGRADE_URL } from '@/components/common/PlanGate'
import { cn } from '@/lib/utils'

/** Mismos filtros anti-bloqueo que usa el cron (cron-process-reminders PART 1). */
const BLOCK_NAME_HINT = 'bloqueo'
const PLACEHOLDER_PHONE = '000000000'
const MIN_PHONE_DIGITS = 7

/** A partir de cuántos envíos manuales al mes se muestra el aviso de upgrade. */
const NUDGE_THRESHOLD = 10

interface ApptRow {
    id: string
    patient_name: string | null
    tutor_name: string | null
    phone_number: string | null
    service: string | null
    appointment_date: string
    status: string
}

interface Props {
    clinicId: string
    clinicName: string
    /** Plantilla de texto libre con placeholders {tutor} {paciente} etc. */
    template: string
}

const digitsOnly = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

export function ManualReminderPanel({ clinicId, clinicName, template }: Props) {
    const { timezone, toUTC, formatInTz } = useClinicTimezone()
    const { meetsPlan } = usePlan()
    const hasAutomation = meetsPlan('starter')

    // "Hoy" en la zona de la clínica — nunca derivar de toISOString() (bug UTC recurrente).
    const todayStr = useMemo(
        () => new Date().toLocaleDateString('sv-SE', { timeZone: timezone || 'America/Santiago' }),
        [timezone],
    )
    // Por defecto mañana: es el día que se recuerda la noche anterior.
    const [dayStr, setDayStr] = useState<string>(() =>
        dateFnsFormat(addDays(new Date(`${todayStr}T12:00:00`), 1), 'yyyy-MM-dd'),
    )

    const [appts, setAppts] = useState<ApptRow[]>([])
    const [sentIds, setSentIds] = useState<Record<string, string>>({})
    const [loading, setLoading] = useState(true)
    const [sendingId, setSendingId] = useState<string | null>(null)
    const [monthCount, setMonthCount] = useState(0)

    const shiftDay = (delta: number) =>
        setDayStr(prev => dateFnsFormat(addDays(new Date(`${prev}T12:00:00`), delta), 'yyyy-MM-dd'))

    const fetchDay = useCallback(async () => {
        if (!clinicId) return
        setLoading(true)
        try {
            const [y, m, d] = dayStr.split('-').map(Number)
            // Límites del día en hora de pared de la clínica, convertidos a UTC.
            const startUtc = toUTC(new Date(y, m - 1, d, 0, 0, 0, 0)).toISOString()
            const endUtc = toUTC(new Date(y, m - 1, d, 23, 59, 59, 999)).toISOString()

            const { data, error } = await supabase
                .from('appointments')
                .select('id, patient_name, tutor_name, phone_number, service, appointment_date, status')
                .eq('clinic_id', clinicId)
                .neq('status', 'cancelled')
                .gte('appointment_date', startUtc)
                .lte('appointment_date', endUtc)
                .order('appointment_date', { ascending: true })

            if (error) throw error

            const rows = ((data ?? []) as ApptRow[]).filter(a => {
                const phone = digitsOnly(a.phone_number)
                if (phone.length < MIN_PHONE_DIGITS) return false
                if (phone === PLACEHOLDER_PHONE) return false
                if ((a.patient_name ?? '').toLowerCase().includes(BLOCK_NAME_HINT)) return false
                return true
            })
            setAppts(rows)

            if (rows.length > 0) {
                const { data: logs } = await supabase
                    .from('reminder_logs')
                    .select('appointment_id, created_at')
                    .eq('clinic_id', clinicId)
                    .eq('type', 'manual_wa')
                    .in('appointment_id', rows.map(r => r.id))
                    .order('created_at', { ascending: false })

                const map: Record<string, string> = {}
                for (const l of (logs ?? []) as any[]) {
                    if (!map[l.appointment_id]) map[l.appointment_id] = l.created_at
                }
                setSentIds(map)
            } else {
                setSentIds({})
            }
        } catch (e) {
            console.error('Error cargando citas del día:', e)
            toast.error('No se pudieron cargar las citas de ese día')
            setAppts([])
        } finally {
            setLoading(false)
        }
    }, [clinicId, dayStr, toUTC])

    useEffect(() => { fetchDay() }, [fetchDay])

    // Contador mensual de envíos manuales — alimenta el aviso de upgrade.
    useEffect(() => {
        if (!clinicId) return
        const run = async () => {
            const monthStart = `${todayStr.slice(0, 7)}-01T00:00:00`
            const { count } = await supabase
                .from('reminder_logs')
                .select('id', { count: 'exact', head: true })
                .eq('clinic_id', clinicId)
                .eq('type', 'manual_wa')
                .gte('created_at', toUTC(new Date(monthStart)).toISOString())
            setMonthCount(count ?? 0)
        }
        run()
    }, [clinicId, todayStr, toUTC, sentIds])

    const buildMessage = (a: ApptRow) => {
        const fecha = formatInTz(a.appointment_date, "EEEE d 'de' MMMM")
        const hora = formatInTz(a.appointment_date, 'HH:mm')
        return (template || '')
            .split('{tutor}').join(a.tutor_name?.trim() || 'hola')
            .split('{paciente}').join(a.patient_name?.trim() || 'tu mascota')
            .split('{servicio}').join(a.service?.trim() || 'su visita')
            .split('{fecha}').join(fecha)
            .split('{hora}').join(hora)
            .split('{clinica}').join(clinicName || '')
            .trim()
    }

    const handleSend = async (a: ApptRow) => {
        const phone = digitsOnly(a.phone_number)
        if (phone.length < MIN_PHONE_DIGITS) {
            toast.error('Esta cita no tiene un teléfono válido')
            return
        }

        // Abrir la ventana ANTES del await: si se abre después de una promesa,
        // el navegador la trata como popup no solicitado y la bloquea.
        const url = `https://wa.me/${phone}?text=${encodeURIComponent(buildMessage(a))}`
        window.open(url, '_blank', 'noopener,noreferrer')

        setSendingId(a.id)
        try {
            const { error } = await (supabase as any).from('reminder_logs').insert({
                clinic_id: clinicId,
                appointment_id: a.id,
                type: 'manual_wa',
                phone_number: phone,
                status: 'sent',
                sent_at: new Date().toISOString(),
            })
            if (error) throw error
            setSentIds(prev => ({ ...prev, [a.id]: new Date().toISOString() }))
        } catch (e: any) {
            console.error('Error registrando el recordatorio manual:', e)
            // WhatsApp ya se abrió: el mensaje puede haberse enviado igual.
            toast.error('WhatsApp se abrió, pero no se pudo registrar el envío')
        } finally {
            setSendingId(null)
        }
    }

    const pendingCount = appts.filter(a => !sentIds[a.id]).length
    const dayLabel = formatInTz(dayStr, "EEEE d 'de' MMMM")
    const isToday = dayStr === todayStr

    return (
        <div className="space-y-4">
            {/* Selector de día */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => shiftDay(-1)}
                        aria-label="Día anterior"
                        className="p-2 rounded-lg border border-silk-beige text-charcoal/60 hover:bg-ivory hover:text-charcoal transition-colors"
                    >
                        <ChevronLeft className="w-4 h-4" />
                    </button>
                    <div className="min-w-[190px] text-center">
                        <p className="text-sm font-bold text-charcoal capitalize">{dayLabel}</p>
                        <p className="text-[11px] text-charcoal/40">
                            {isToday ? 'Hoy' : dayStr === dateFnsFormat(addDays(new Date(`${todayStr}T12:00:00`), 1), 'yyyy-MM-dd') ? 'Mañana' : ''}
                            {appts.length > 0 && `${isToday || dayStr === dateFnsFormat(addDays(new Date(`${todayStr}T12:00:00`), 1), 'yyyy-MM-dd') ? ' · ' : ''}${appts.length} cita${appts.length === 1 ? '' : 's'}`}
                        </p>
                    </div>
                    <button
                        onClick={() => shiftDay(1)}
                        aria-label="Día siguiente"
                        className="p-2 rounded-lg border border-silk-beige text-charcoal/60 hover:bg-ivory hover:text-charcoal transition-colors"
                    >
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </div>

                <div className="flex items-center gap-2">
                    <input
                        type="date"
                        value={dayStr}
                        onChange={e => e.target.value && setDayStr(e.target.value)}
                        className="text-sm border border-silk-beige rounded-lg px-3 py-2 text-charcoal bg-white"
                    />
                    <button
                        onClick={fetchDay}
                        className="p-2 rounded-lg border border-silk-beige text-charcoal/60 hover:bg-ivory transition-colors"
                        aria-label="Actualizar"
                    >
                        <Loader2 className={cn('w-4 h-4', loading && 'animate-spin')} />
                    </button>
                </div>
            </div>

            {/* Aviso de upgrade — sale de los datos reales del propio usuario */}
            {!hasAutomation && monthCount >= NUDGE_THRESHOLD && (
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-primary-200 bg-primary-50/60 px-4 py-3">
                    <Zap className="w-5 h-5 text-primary-600 shrink-0" />
                    <p className="text-sm text-charcoal/80 flex-1">
                        Enviaste <strong className="font-bold text-charcoal">{monthCount} recordatorios a mano</strong> este mes.
                        Automatizarlos toma 3 minutos.
                    </p>
                    <Link
                        to={UPGRADE_URL}
                        className="shrink-0 rounded-lg bg-primary-600 px-4 py-2 text-xs font-bold text-white hover:bg-primary-700 transition-colors"
                    >
                        Ver planes
                    </Link>
                </div>
            )}

            {/* Lista */}
            {loading ? (
                <div className="flex items-center justify-center py-16">
                    <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
                </div>
            ) : appts.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-silk-beige py-14 text-center">
                    <CalendarDays className="w-7 h-7 text-charcoal/25" />
                    <p className="text-sm font-semibold text-charcoal/60">No hay citas para este día</p>
                    <p className="text-xs text-charcoal/40">Elige otra fecha con las flechas o el calendario.</p>
                </div>
            ) : (
                <>
                    <div className="rounded-xl border border-silk-beige overflow-hidden bg-white">
                        {appts.map((a, i) => {
                            const sentAt = sentIds[a.id]
                            return (
                                <div
                                    key={a.id}
                                    className={cn(
                                        'flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3',
                                        i > 0 && 'border-t border-silk-beige',
                                        sentAt && 'bg-emerald-50/40',
                                    )}
                                >
                                    <span className="font-mono text-sm font-bold text-charcoal tabular-nums shrink-0 w-14">
                                        {formatInTz(a.appointment_date, 'HH:mm')}
                                    </span>

                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-charcoal truncate">
                                            {a.patient_name?.trim() || 'Sin nombre'}
                                            {a.tutor_name && (
                                                <span className="font-normal text-charcoal/50"> · {a.tutor_name}</span>
                                            )}
                                        </p>
                                        <p className="text-xs text-charcoal/40 truncate">
                                            {a.service?.trim() || 'Sin servicio'}
                                        </p>
                                    </div>

                                    {sentAt ? (
                                        <div className="flex items-center gap-3 shrink-0">
                                            <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                                                <CheckCircle2 className="w-4 h-4" />
                                                Enviado {formatInTz(sentAt, 'HH:mm')}
                                            </span>
                                            <button
                                                onClick={() => handleSend(a)}
                                                disabled={sendingId === a.id}
                                                className="text-xs font-semibold text-charcoal/50 hover:text-charcoal underline underline-offset-2 disabled:opacity-50"
                                            >
                                                Reenviar
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => handleSend(a)}
                                            disabled={sendingId === a.id}
                                            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-[#25D366] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#1da851] transition-colors disabled:opacity-60"
                                        >
                                            {sendingId === a.id
                                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                : <Send className="w-3.5 h-3.5" />}
                                            Enviar
                                        </button>
                                    )}
                                </div>
                            )
                        })}
                    </div>

                    <p className="flex items-start gap-2 text-xs text-charcoal/45">
                        <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
                        <span>
                            {pendingCount > 0
                                ? `Quedan ${pendingCount} por avisar. `
                                : 'Ya avisaste a todos los de este día. '}
                            El mensaje se abre listo en WhatsApp: solo tienes que pulsar enviar.
                            Estos envíos no consumen tu cuota mensual.
                        </span>
                    </p>
                </>
            )}
        </div>
    )
}
