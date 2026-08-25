/**
 * SchedulingRequestsPanel — solicitudes de agenda esperando que la coordinadora
 * decida qué horarios ofrecer.
 *
 * Se muestra solo en clínicas con scheduling_mode = 'coordinator_approval'. La IA
 * reúne los datos y la disponibilidad amplia del tutor, deja la conversación en
 * pausa, y aquí se escriben las alternativas viables según la ruta del día.
 *
 * Al autorizar se reactiva la IA para ese tutor: ella ofrece SOLO esas opciones y
 * agenda la que el cliente elija. El bloqueo real vive en el webhook.
 */
import { useCallback, useEffect, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { CalendarClock, Loader2, AlertTriangle, Check, MapPin, PawPrint, Stethoscope, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { cn, formatPhoneNumber } from '@/lib/utils'

interface SchedulingRequest {
    id: string
    tutor_phone: string
    tutor_name: string
    pet_name: string | null
    pet_details: string | null
    service_requested: string
    comuna: string | null
    sector: string | null
    address: string | null
    is_urgent: boolean
    availability_text: string
    additional_notes: string | null
    status: 'pending' | 'authorized' | 'fulfilled' | 'dismissed'
    authorized_options: string | null
    round: number
    created_at: string
}

interface SchedulingRequestsPanelProps {
    clinicId: string
}

export function SchedulingRequestsPanel({ clinicId }: SchedulingRequestsPanelProps) {
    const { user } = useAuth()
    const [requests, setRequests] = useState<SchedulingRequest[]>([])
    const [loading, setLoading] = useState(true)
    const [drafts, setDrafts] = useState<Record<string, string>>({})
    const [editing, setEditing] = useState<Record<string, boolean>>({})
    const [savingId, setSavingId] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    const fetchRequests = useCallback(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error: err } = await (supabase as any)
            .from('scheduling_requests')
            .select('*')
            .eq('clinic_id', clinicId)
            .in('status', ['pending', 'authorized'])
            .order('created_at', { ascending: true })

        if (err) {
            setError('No se pudieron cargar las solicitudes de agenda.')
        } else {
            // Las pendientes primero: son las que bloquean a un cliente esperando respuesta.
            const rows = (data || []) as SchedulingRequest[]
            setRequests([
                ...rows.filter(r => r.status === 'pending'),
                ...rows.filter(r => r.status !== 'pending'),
            ])
            setError(null)
        }
        setLoading(false)
    }, [clinicId])

    useEffect(() => {
        if (!clinicId) return
        setLoading(true)
        fetchRequests()

        // Realtime: son decisiones del día, no sirve enterarse al refrescar.
        const channel = supabase
            .channel(`scheduling-requests-${clinicId}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'scheduling_requests',
                filter: `clinic_id=eq.${clinicId}`,
            }, () => { fetchRequests() })
            .subscribe()

        return () => { supabase.removeChannel(channel) }
    }, [clinicId, fetchRequests])

    /** Reactiva la IA para ese tutor (la pausó la solicitud, no una persona). */
    const resumeAI = async (phone: string) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sb = supabase as any
        await sb.from('tutors').update({ requires_human: false })
            .eq('clinic_id', clinicId).eq('phone_number', phone)
        await sb.from('crm_prospects').update({ requires_human: false })
            .eq('clinic_id', clinicId).or(`phone.eq.${phone},phone.eq.+${phone}`)
    }

    const authorize = async (req: SchedulingRequest) => {
        const options = (drafts[req.id] ?? req.authorized_options ?? '').trim()
        if (!options) return

        setSavingId(req.id)
        setError(null)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: err } = await (supabase as any)
            .from('scheduling_requests')
            .update({
                status: 'authorized',
                authorized_options: options,
                reviewed_by: user?.id ?? null,
                reviewed_at: new Date().toISOString(),
            })
            .eq('id', req.id)

        if (err) {
            setError('No se pudo guardar la autorización. Intenta de nuevo.')
            setSavingId(null)
            return
        }

        await resumeAI(req.tutor_phone)
        setRequests(curr => curr.map(r =>
            r.id === req.id ? { ...r, status: 'authorized', authorized_options: options } : r
        ))
        setEditing(curr => ({ ...curr, [req.id]: false }))
        setSavingId(null)
    }

    const dismiss = async (req: SchedulingRequest) => {
        if (!confirm(`¿Descartar la solicitud de ${req.tutor_name}? La IA volverá a atender la conversación con normalidad.`)) return

        setSavingId(req.id)
        setError(null)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: err } = await (supabase as any)
            .from('scheduling_requests')
            .update({
                status: 'dismissed',
                reviewed_by: user?.id ?? null,
                reviewed_at: new Date().toISOString(),
            })
            .eq('id', req.id)

        if (err) {
            setError('No se pudo descartar la solicitud.')
            setSavingId(null)
            return
        }

        await resumeAI(req.tutor_phone)
        setRequests(curr => curr.filter(r => r.id !== req.id))
        setSavingId(null)
    }

    const pendingCount = requests.filter(r => r.status === 'pending').length

    return (
        <div className="bg-white rounded-2xl border border-silk-beige shadow-sm overflow-hidden">
            <div className="bg-gradient-to-br from-primary-500 to-primary-700 p-5 text-white">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-widest text-primary-200 mb-1">Coordinación</p>
                        <h3 className="text-lg font-extrabold tracking-tight text-white">Solicitudes de agenda</h3>
                        <p className="text-xs sm:text-sm text-primary-100 mt-1 max-w-xl">
                            La IA reunió los datos y la disponibilidad de estos tutores, pero no ofrece horarios.
                            Escribe las alternativas que te acomodan según la ruta del día y ella se encargará del resto.
                        </p>
                    </div>
                    <CalendarClock className="w-8 h-8 text-primary-200 hidden sm:block shrink-0" />
                </div>
                {pendingCount > 0 && (
                    <p className="text-xs font-bold text-primary-100 mt-3 bg-white/10 rounded-lg px-3 py-1.5 inline-block">
                        {pendingCount} {pendingCount === 1 ? 'solicitud esperando respuesta' : 'solicitudes esperando respuesta'}
                    </p>
                )}
            </div>

            <div className="p-5">
                {error && (
                    <div className="mb-4 text-sm font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
                        {error}
                    </div>
                )}

                {loading ? (
                    <div className="flex items-center gap-2 text-charcoal/60 text-sm py-6 justify-center">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Cargando solicitudes...
                    </div>
                ) : requests.length === 0 ? (
                    <p className="text-sm text-charcoal/50 text-center py-6">
                        No hay solicitudes pendientes 🎉
                    </p>
                ) : (
                    <div className="space-y-4">
                        {requests.map(req => {
                            const isPending = req.status === 'pending'
                            const showEditor = isPending || editing[req.id]
                            const draft = drafts[req.id] ?? req.authorized_options ?? ''

                            return (
                                <div
                                    key={req.id}
                                    className={cn(
                                        'rounded-xl border p-4',
                                        isPending ? 'border-primary-200 bg-primary-50/40' : 'border-silk-beige bg-ivory/60'
                                    )}
                                >
                                    <div className="flex items-start justify-between gap-3 flex-wrap">
                                        <div>
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <p className="font-extrabold text-charcoal">{req.tutor_name}</p>
                                                {req.is_urgent && (
                                                    <span className="flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md bg-red-100 text-red-700">
                                                        <AlertTriangle className="w-3 h-3" />
                                                        Urgente
                                                    </span>
                                                )}
                                                {req.round > 1 && (
                                                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-amber-100 text-amber-700">
                                                        {req.round}ª ronda
                                                    </span>
                                                )}
                                                {!isPending && (
                                                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-700">
                                                        Opciones enviadas
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-xs text-charcoal/50 mt-0.5">
                                                {formatPhoneNumber(req.tutor_phone)} · hace {formatDistanceToNow(new Date(req.created_at), { locale: es })}
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => dismiss(req)}
                                            disabled={savingId === req.id}
                                            title="Descartar solicitud y reactivar la IA"
                                            className="text-charcoal/40 hover:text-red-600 transition-colors disabled:opacity-50"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>

                                    <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 mt-3 text-sm">
                                        <p className="flex items-start gap-2 text-charcoal/80">
                                            <Stethoscope className="w-3.5 h-3.5 mt-0.5 shrink-0 text-charcoal/40" />
                                            {req.service_requested}
                                        </p>
                                        {req.pet_name && (
                                            <p className="flex items-start gap-2 text-charcoal/80">
                                                <PawPrint className="w-3.5 h-3.5 mt-0.5 shrink-0 text-charcoal/40" />
                                                {req.pet_name}{req.pet_details ? ` — ${req.pet_details}` : ''}
                                            </p>
                                        )}
                                        {(req.comuna || req.address) && (
                                            <p className="flex items-start gap-2 text-charcoal/80 sm:col-span-2">
                                                <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-charcoal/40" />
                                                {[req.address, req.comuna, req.sector].filter(Boolean).join(' · ')}
                                            </p>
                                        )}
                                    </div>

                                    <div className="mt-3 bg-white border border-silk-beige rounded-lg px-3 py-2">
                                        <p className="text-[11px] font-bold uppercase tracking-wide text-charcoal/40">Disponibilidad del tutor</p>
                                        <p className="text-sm text-charcoal mt-0.5">{req.availability_text}</p>
                                    </div>

                                    {req.additional_notes && (
                                        <p className="text-xs text-charcoal/60 mt-2">
                                            <span className="font-bold">Antecedentes:</span> {req.additional_notes}
                                        </p>
                                    )}

                                    {showEditor ? (
                                        <div className="mt-3">
                                            <label className="text-[11px] font-bold uppercase tracking-wide text-charcoal/40">
                                                Opciones que puedes ofrecerle
                                            </label>
                                            <textarea
                                                value={draft}
                                                onChange={e => setDrafts(curr => ({ ...curr, [req.id]: e.target.value }))}
                                                rows={2}
                                                placeholder="Ej: martes de 15:00 a 17:00 o jueves de 11:00 a 13:00"
                                                className="w-full mt-1 px-3 py-2 rounded-lg border border-silk-beige bg-white text-sm text-charcoal focus:outline-none focus:ring-2 focus:ring-primary-500/40 resize-y"
                                            />
                                            <div className="flex items-center gap-2 mt-2">
                                                <button
                                                    onClick={() => authorize(req)}
                                                    disabled={savingId === req.id || !draft.trim()}
                                                    className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors disabled:opacity-40"
                                                >
                                                    {savingId === req.id
                                                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                        : <Check className="w-3.5 h-3.5" />}
                                                    {isPending ? 'Autorizar y avisar al cliente' : 'Guardar cambios'}
                                                </button>
                                                {!isPending && (
                                                    <button
                                                        onClick={() => setEditing(curr => ({ ...curr, [req.id]: false }))}
                                                        className="text-xs font-bold px-3 py-2 rounded-lg text-charcoal/60 hover:bg-ivory transition-colors"
                                                    >
                                                        Cancelar
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="mt-3 flex items-start justify-between gap-3 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                                            <div>
                                                <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-700">Opciones autorizadas</p>
                                                <p className="text-sm text-charcoal mt-0.5">{req.authorized_options}</p>
                                            </div>
                                            <button
                                                onClick={() => setEditing(curr => ({ ...curr, [req.id]: true }))}
                                                className="text-xs font-bold text-emerald-700 hover:underline shrink-0"
                                            >
                                                Editar
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                )}

                <p className="text-xs text-charcoal/40 mt-4 pt-4 border-t border-silk-beige">
                    Al autorizar, la IA retoma la conversación y ofrece únicamente esas alternativas.
                    Si al cliente no le acomoda ninguna, le pedirá nueva disponibilidad y la solicitud
                    volverá a aparecer aquí.
                </p>
            </div>
        </div>
    )
}
