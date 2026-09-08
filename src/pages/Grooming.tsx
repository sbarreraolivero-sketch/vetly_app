import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Scissors, Plus, Loader2, ClipboardCheck, CheckCircle2, Clock, Calendar, X, ShieldAlert, CalendarDays, LayoutList } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useClinicTimezone } from '@/hooks/useClinicTimezone'
import { toast } from 'react-hot-toast'
import { GroomingIntakeModal } from '@/components/grooming/GroomingIntakeModal'
import { GroomingClosureModal } from '@/components/grooming/GroomingClosureModal'
import { ConsentForm } from '@/components/patients/ConsentForm'
import { CalendarView, CalendarEvent } from '@/components/calendar/CalendarView'
import { MobileCalendarView } from '@/components/calendar/MobileCalendarView'
import { groomingService } from '@/services/groomingService'
import { consentService } from '@/services/consentService'

function ConsentBadge({ clinicId, patientId, patientName, tutor }: {
    clinicId: string; patientId: string; patientName: string; tutor?: { id: string; name?: string | null } | null
}) {
    const [showForm, setShowForm] = useState(false)
    const qc = useQueryClient()
    const { data } = useQuery({
        queryKey: ['consent-status', patientId, 'estetica'],
        queryFn: () => consentService.getConsentStatus(clinicId, patientId, 'estetica'),
        enabled: !!clinicId && !!patientId,
        staleTime: 1000 * 60 * 5,
    })
    if (!data || data.state === 'valid') return null
    const txt = data.state === 'expired' ? 'Consentimiento vencido'
        : data.state === 'outdated' ? 'Consentimiento desactualizado'
        : 'Falta consentimiento'
    return (
        <>
            <button onClick={() => setShowForm(true)}
                className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full hover:bg-amber-200">
                <ShieldAlert className="w-3 h-3" /> {txt}
            </button>
            {showForm && (
                <ConsentForm
                    patient={{ id: patientId, name: patientName, clinic_id: clinicId } as any}
                    tutor={tutor as any}
                    initialTemplateKey="estetica"
                    onClose={() => { setShowForm(false); qc.invalidateQueries({ queryKey: ['consent-status', patientId, 'estetica'] }) }}
                    onSave={() => qc.invalidateQueries({ queryKey: ['consent-status', patientId, 'estetica'] })}
                />
            )}
        </>
    )
}

interface GroomingAppt {
    id: string
    patient_id: string | null
    patient_name: string
    tutor_id: string | null
    tutor_name: string | null
    appointment_date: string
    service: string | null
    status: string
    professional_id: string | null
    duration_minutes?: number | null
}

export default function Grooming() {
    const { profile, member } = useAuth()
    const queryClient = useQueryClient()
    const { timezone } = useClinicTimezone()
    const clinicId = member?.clinic_id || profile?.clinic_id
    const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: timezone || 'America/Santiago' })

    const [intakeAppt, setIntakeAppt] = useState<GroomingAppt | null>(null)
    const [closureAppt, setClosureAppt] = useState<GroomingAppt | null>(null)
    const [showNew, setShowNew] = useState(false)
    const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list')
    const [actionAppt, setActionAppt] = useState<GroomingAppt | null>(null)
    const [newDefaults, setNewDefaults] = useState<{ date?: string; time?: string }>({})

    const { data: appts = [], isLoading } = useQuery<GroomingAppt[]>({
        queryKey: ['grooming-appointments', clinicId],
        queryFn: async () => {
            const from = new Date(Date.now() - 30 * 86400000).toISOString()
            const to = new Date(Date.now() + 60 * 86400000).toISOString()
            const { data, error } = await supabase
                .from('appointments')
                .select('id, patient_id, patient_name, tutor_id, tutor_name, appointment_date, service, status, professional_id, duration_minutes')
                .eq('clinic_id', clinicId as string)
                .eq('appointment_type', 'grooming')
                .gte('appointment_date', from)
                .lte('appointment_date', to)
                .order('appointment_date', { ascending: true })
            if (error) throw error
            return (data as any) || []
        },
        enabled: !!clinicId,
    })

    const { data: groomers = [] } = useQuery<any[]>({
        queryKey: ['grooming-professionals', clinicId],
        queryFn: async () => {
            const { data } = await (supabase as any).rpc('get_clinic_professionals', { p_clinic_id: clinicId })
            return (data as any[]) || []
        },
        enabled: !!clinicId,
    })

    const refresh = () => queryClient.invalidateQueries({ queryKey: ['grooming-appointments', clinicId] })

    const assignGroomer = async (apptId: string, memberId: string) => {
        await (supabase as any).from('appointments').update({ professional_id: memberId || null }).eq('id', apptId)
        refresh()
    }

    const { today, upcoming } = useMemo(() => {
        const t: GroomingAppt[] = []
        const u: GroomingAppt[] = []
        for (const a of appts) {
            if (a.status === 'cancelled') continue
            const d = a.appointment_date.slice(0, 10)
            if (d === todayStr) t.push(a)
            else if (d > todayStr) u.push(a)
        }
        return { today: t, upcoming: u }
    }, [appts, todayStr])

    const waiting = today.filter(a => a.status === 'pending' || a.status === 'confirmed')
    const done = today.filter(a => a.status === 'completed')

    const calendarEvents = useMemo<CalendarEvent[]>(() => {
        return appts
            .filter(a => a.status !== 'cancelled' && a.appointment_date)
            .map(a => {
                const start = new Date(a.appointment_date)
                if (isNaN(start.getTime())) return null
                const dur = a.duration_minutes || 60
                const prof = a.professional_id ? groomers.find(g => g.member_id === a.professional_id) : null
                return {
                    id: a.id,
                    title: `${a.patient_name}${a.service ? ` · ${a.service}` : ''}`,
                    start,
                    end: new Date(start.getTime() + dur * 60000),
                    resource: {
                        type: 'local',
                        ...a,
                        professionalColor: prof?.color || undefined,
                        professionalName: prof ? `${prof.first_name || ''} ${prof.last_name || ''}`.trim() : undefined,
                    },
                } as CalendarEvent
            })
            .filter(Boolean) as CalendarEvent[]
    }, [appts, groomers])

    const openActionForEvent = (ev: CalendarEvent) => {
        const a = appts.find(x => x.id === ev.id)
        if (a) setActionAppt(a)
    }

    const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: timezone || 'America/Santiago' })

    const groomerName = (id: string | null) => {
        const g = groomers.find(x => x.member_id === id)
        return g ? [g.first_name, g.last_name].filter(Boolean).join(' ') : ''
    }

    const Card = ({ a, isDone }: { a: GroomingAppt; isDone?: boolean }) => (
        <div className="bg-white p-4 rounded-soft border border-silk-beige shadow-sm">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="font-bold text-charcoal">{a.patient_name}</p>
                    <p className="text-xs text-charcoal/50">{a.tutor_name || 'Sin tutor'} · {fmtTime(a.appointment_date)}</p>
                    {a.service && <p className="text-xs text-charcoal/60 mt-1">{a.service}</p>}
                    {!isDone && a.patient_id && (
                        <div className="mt-1.5">
                            <ConsentBadge
                                clinicId={clinicId as string}
                                patientId={a.patient_id}
                                patientName={a.patient_name}
                                tutor={a.tutor_id ? { id: a.tutor_id, name: a.tutor_name } : null}
                            />
                        </div>
                    )}
                </div>
                {isDone && <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />}
            </div>
            <div className="mt-3 flex items-center gap-2 flex-wrap">
                <select
                    value={a.professional_id || ''}
                    onChange={e => assignGroomer(a.id, e.target.value)}
                    className="input-soft py-1 text-xs max-w-[160px]"
                >
                    <option value="">Sin peluquero</option>
                    {groomers.map(g => <option key={g.member_id} value={g.member_id}>{[g.first_name, g.last_name].filter(Boolean).join(' ')}</option>)}
                </select>
                {!isDone && (
                    <>
                        <button onClick={() => setIntakeAppt(a)} className="text-xs font-bold uppercase tracking-widest text-charcoal/60 hover:text-primary-600 flex items-center gap-1.5 px-2.5 py-1.5 rounded hover:bg-primary-50">
                            <ClipboardCheck className="w-3.5 h-3.5" /> Ingreso
                        </button>
                        <button onClick={() => setClosureAppt(a)} disabled={!a.patient_id}
                            title={a.patient_id ? '' : 'La cita no tiene paciente vinculado'}
                            className="text-xs font-bold uppercase tracking-widest text-white bg-primary-600 hover:bg-primary-700 flex items-center gap-1.5 px-2.5 py-1.5 rounded disabled:opacity-40">
                            <Scissors className="w-3.5 h-3.5" /> Cerrar sesión
                        </button>
                    </>
                )}
                {isDone && a.patient_id && (
                    <button onClick={() => setClosureAppt(a)} className="text-xs font-bold uppercase tracking-widest text-charcoal/50 hover:text-primary-600 px-2.5 py-1.5 rounded hover:bg-primary-50">
                        Editar reporte
                    </button>
                )}
            </div>
        </div>
    )

    return (
        <div className="space-y-6">
            {/* Banner */}
            <div className="bg-gradient-to-br from-primary-500 to-primary-700 rounded-2xl p-5 sm:p-8 text-white">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
                    <div>
                        <p className="text-xs font-black uppercase tracking-widest text-primary-200">Clínica</p>
                        {/* text-white explícito: la regla base `h1 { text-charcoal }` de
                            index.css gana sobre el text-white heredado del contenedor. */}
                        <h1 className="text-xl sm:text-3xl font-extrabold tracking-tight mt-1 text-white">Estética</h1>
                        <p className="text-primary-100 text-xs sm:text-sm mt-1">La cola del día y la agenda de peluquería.</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 self-start flex-wrap">
                        <button onClick={() => setViewMode(v => v === 'list' ? 'calendar' : 'list')}
                            className="bg-white/15 text-white font-bold text-sm px-3 py-2 rounded-xl flex items-center gap-2 hover:bg-white/25">
                            {viewMode === 'list' ? <><CalendarDays className="w-4 h-4" /> Calendario</> : <><LayoutList className="w-4 h-4" /> Lista</>}
                        </button>
                        <button onClick={() => { setNewDefaults({}); setShowNew(true) }} className="bg-white text-primary-700 font-bold text-sm px-4 py-2 rounded-xl flex items-center gap-2">
                            <Plus className="w-4 h-4" /> Nueva cita
                        </button>
                    </div>
                </div>
            </div>

            {isLoading ? (
                <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary-500" /></div>
            ) : viewMode === 'calendar' ? (
                <>
                    <div className="hidden md:block card-soft p-2">
                        <CalendarView
                            events={calendarEvents}
                            onSelectEvent={openActionForEvent}
                            onEditEvent={openActionForEvent}
                            onSelectSlot={(slot) => {
                                setNewDefaults({
                                    date: slot.start.toISOString().slice(0, 10),
                                    time: slot.start.toTimeString().slice(0, 5),
                                })
                                setShowNew(true)
                            }}
                        />
                    </div>
                    <div className="block md:hidden">
                        <MobileCalendarView
                            events={calendarEvents}
                            onSelectEvent={openActionForEvent}
                            onSelectSlot={(date) => {
                                setNewDefaults({ date: date.toISOString().slice(0, 10), time: '10:00' })
                                setShowNew(true)
                            }}
                        />
                    </div>
                </>
            ) : (
                <>
                    <section>
                        <h2 className="text-sm font-black uppercase tracking-widest text-charcoal/50 mb-3 flex items-center gap-2">
                            <Clock className="w-4 h-4" /> Hoy — esperando ({waiting.length})
                        </h2>
                        {waiting.length === 0 ? (
                            <p className="text-sm text-charcoal/40 italic">Sin mascotas en espera hoy.</p>
                        ) : (
                            <div className="grid gap-3 sm:grid-cols-2">{waiting.map(a => <Card key={a.id} a={a} />)}</div>
                        )}
                    </section>

                    {done.length > 0 && (
                        <section>
                            <h2 className="text-sm font-black uppercase tracking-widest text-charcoal/50 mb-3 flex items-center gap-2">
                                <CheckCircle2 className="w-4 h-4" /> Hoy — listas ({done.length})
                            </h2>
                            <div className="grid gap-3 sm:grid-cols-2">{done.map(a => <Card key={a.id} a={a} isDone />)}</div>
                        </section>
                    )}

                    <section>
                        <h2 className="text-sm font-black uppercase tracking-widest text-charcoal/50 mb-3 flex items-center gap-2">
                            <Calendar className="w-4 h-4" /> Próximas citas
                        </h2>
                        {upcoming.length === 0 ? (
                            <p className="text-sm text-charcoal/40 italic">Sin citas de estética agendadas.</p>
                        ) : (
                            <div className="bg-white rounded-soft border border-silk-beige divide-y divide-silk-beige">
                                {upcoming.map(a => (
                                    <div key={a.id} className="p-3 flex items-center justify-between text-sm">
                                        <div>
                                            <span className="font-bold text-charcoal">{a.patient_name}</span>
                                            <span className="text-charcoal/50"> · {new Date(a.appointment_date).toLocaleDateString('es-CL', { weekday: 'short', day: '2-digit', month: 'short' })} {fmtTime(a.appointment_date)}</span>
                                        </div>
                                        <span className="text-xs text-charcoal/40">{groomerName(a.professional_id) || a.service || ''}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>
                </>
            )}

            {intakeAppt && (
                <GroomingIntakeModal
                    patient={{ id: intakeAppt.patient_id || '', name: intakeAppt.patient_name, clinic_id: clinicId as string }}
                    tutor={intakeAppt.tutor_id ? { id: intakeAppt.tutor_id, name: intakeAppt.tutor_name } : null}
                    appointmentId={intakeAppt.id}
                    onClose={() => setIntakeAppt(null)}
                    onSaved={() => { setIntakeAppt(null); refresh() }}
                />
            )}

            {closureAppt && closureAppt.patient_id && (
                <ClosureLoader
                    appt={closureAppt}
                    groomers={groomers}
                    onClose={() => setClosureAppt(null)}
                    onSaved={() => { setClosureAppt(null); refresh() }}
                />
            )}

            {showNew && (
                <NewGroomingAppointment
                    clinicId={clinicId as string}
                    groomers={groomers}
                    defaultDate={newDefaults.date}
                    defaultTime={newDefaults.time}
                    onClose={() => setShowNew(false)}
                    onCreated={() => { setShowNew(false); refresh() }}
                />
            )}

            {actionAppt && (
                <div className="fixed inset-0 bg-black/60 z-[99999] flex items-center justify-center p-4" onClick={() => setActionAppt(null)}>
                    <div className="bg-white rounded-soft w-full max-w-sm shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="p-4 border-b border-silk-beige flex items-center justify-between bg-primary-50/50">
                            <div>
                                <p className="font-bold text-charcoal">{actionAppt.patient_name}</p>
                                <p className="text-xs text-charcoal/50">{actionAppt.tutor_name || 'Sin tutor'} · {fmtTime(actionAppt.appointment_date)}</p>
                            </div>
                            <button onClick={() => setActionAppt(null)} className="p-1.5 hover:bg-silk-beige rounded-lg"><X className="w-5 h-5 text-charcoal/60" /></button>
                        </div>
                        <div className="p-4 space-y-2">
                            <select
                                value={actionAppt.professional_id || ''}
                                onChange={e => { assignGroomer(actionAppt.id, e.target.value); setActionAppt({ ...actionAppt, professional_id: e.target.value || null }) }}
                                className="input-soft w-full text-sm">
                                <option value="">Sin peluquero</option>
                                {groomers.map(g => <option key={g.member_id} value={g.member_id}>{[g.first_name, g.last_name].filter(Boolean).join(' ')}</option>)}
                            </select>
                            {actionAppt.status !== 'completed' && (
                                <>
                                    <button onClick={() => { setIntakeAppt(actionAppt); setActionAppt(null) }}
                                        className="w-full py-2.5 rounded-xl border border-silk-beige text-sm font-bold text-charcoal/70 hover:border-primary-300 hover:text-primary-600 flex items-center justify-center gap-2">
                                        <ClipboardCheck className="w-4 h-4" /> Ingreso
                                    </button>
                                    <button onClick={() => { setClosureAppt(actionAppt); setActionAppt(null) }} disabled={!actionAppt.patient_id}
                                        className="w-full py-2.5 rounded-xl bg-primary-600 text-white text-sm font-bold hover:bg-primary-700 disabled:opacity-40 flex items-center justify-center gap-2">
                                        <Scissors className="w-4 h-4" /> Cerrar sesión
                                    </button>
                                </>
                            )}
                            {actionAppt.status === 'completed' && actionAppt.patient_id && (
                                <button onClick={() => { setClosureAppt(actionAppt); setActionAppt(null) }}
                                    className="w-full py-2.5 rounded-xl border border-silk-beige text-sm font-bold text-charcoal/60 hover:text-primary-600">
                                    Editar reporte
                                </button>
                            )}
                            <button onClick={async () => {
                                if (!confirm('¿Cancelar esta cita de estética?')) return
                                await (supabase as any).from('appointments').update({ status: 'cancelled' }).eq('id', actionAppt.id)
                                setActionAppt(null); refresh()
                            }} className="w-full py-2 rounded-xl text-xs font-bold text-charcoal/40 hover:text-red-500">
                                Cancelar cita
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

// Carga el paciente + su perfil de estética + sesión existente antes de abrir el cierre.
function ClosureLoader({ appt, groomers, onClose, onSaved }: {
    appt: GroomingAppt; groomers: any[]; onClose: () => void; onSaved: () => void
}) {
    const { data, isLoading } = useQuery({
        queryKey: ['grooming-closure-ctx', appt.id],
        queryFn: async () => {
            const [{ data: pat }, gp, sess] = await Promise.all([
                (supabase as any).from('patients').select('id, name, clinic_id, breed, weight').eq('id', appt.patient_id).single(),
                groomingService.getProfile(appt.patient_id as string),
                groomingService.getSessionForAppointment(appt.id),
            ])
            return { pat, gp, sess }
        },
    })
    if (isLoading || !data?.pat) {
        return <div className="fixed inset-0 bg-black/50 z-[99999] flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-white" /></div>
    }
    return (
        <GroomingClosureModal
            patient={data.pat}
            tutor={appt.tutor_id ? { id: appt.tutor_id, name: appt.tutor_name } : null}
            appointmentId={appt.id}
            existingSessionId={data.sess?.id || null}
            size={data.gp?.size_category || null}
            coat={data.gp?.coat_type || null}
            groomers={groomers}
            onClose={onClose}
            onSaved={onSaved}
        />
    )
}

function NewGroomingAppointment({ clinicId, groomers, defaultDate, defaultTime, onClose, onCreated }: {
    clinicId: string; groomers: any[]; defaultDate?: string; defaultTime?: string; onClose: () => void; onCreated: () => void
}) {
    const [tutorQuery, setTutorQuery] = useState('')
    const [tutorId, setTutorId] = useState<string>('')
    const [patientId, setPatientId] = useState<string>('')
    const [serviceId, setServiceId] = useState<string>('')
    const [date, setDate] = useState(defaultDate || new Date().toISOString().slice(0, 10))
    const [time, setTime] = useState(defaultTime || '10:00')
    const [groomerId, setGroomerId] = useState('')
    const [saving, setSaving] = useState(false)

    const { data: tutors = [] } = useQuery<any[]>({
        queryKey: ['grooming-tutors', clinicId],
        queryFn: async () => {
            const { data } = await (supabase as any).rpc('get_unified_contacts', { p_clinic_id: clinicId })
            return ((data as any[]) || []).filter(c => c.type === 'tutor')
        },
    })
    const { data: patients = [] } = useQuery<any[]>({
        queryKey: ['grooming-patients', clinicId, tutorId],
        queryFn: async () => {
            if (!tutorId) return []
            const { data } = await (supabase as any).from('patients').select('id, name').eq('tutor_id', tutorId).eq('status', 'alive')
            return (data as any[]) || []
        },
        enabled: !!tutorId,
    })
    const { data: services = [] } = useQuery<any[]>({
        queryKey: ['grooming-svc', clinicId],
        queryFn: () => groomingService.getGroomingServices(clinicId),
    })

    const filteredTutors = useMemo(() => {
        const q = tutorQuery.toLowerCase().trim()
        if (!q) return tutors.slice(0, 8)
        return tutors.filter(t => (t.name || '').toLowerCase().includes(q)).slice(0, 8)
    }, [tutors, tutorQuery])

    const create = async () => {
        if (!tutorId || !patientId) { toast.error('Elige tutor y mascota'); return }
        setSaving(true)
        try {
            const tutor = tutors.find(t => t.id === tutorId)
            const patient = patients.find(p => p.id === patientId)
            const svc = services.find(s => s.id === serviceId)
            const { error } = await (supabase as any).from('appointments').insert({
                clinic_id: clinicId,
                appointment_type: 'grooming',
                booking_source: 'manual',
                status: 'pending',
                patient_id: patientId,
                pet_id: patientId,
                patient_name: patient?.name || 'Sin nombre',
                tutor_id: tutorId,
                tutor_name: tutor?.name || null,
                phone_number: (tutor?.phone_number || '').replace(/\D/g, ''),
                service: svc?.name || 'Estética',
                appointment_date: new Date(`${date}T${time}:00`).toISOString(),
                professional_id: groomerId || null,
                duration_minutes: svc?.duration || 60,
            })
            if (error) throw error
            toast.success('Cita de estética creada')
            onCreated()
        } catch (e: any) {
            toast.error(e.message || 'No se pudo crear la cita')
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[99999] p-4 backdrop-blur-sm">
            <div className="bg-white rounded-soft w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
                <div className="p-5 border-b border-silk-beige flex items-center justify-between bg-primary-50/50">
                    <h3 className="font-bold text-charcoal">Nueva cita de estética</h3>
                    <button onClick={onClose} className="p-1.5 hover:bg-silk-beige rounded-lg"><X className="w-5 h-5 text-charcoal/60" /></button>
                </div>
                <div className="p-5 space-y-3 overflow-y-auto">
                    <div>
                        <label className="text-xs font-bold text-charcoal/60">Tutor</label>
                        {tutorId ? (
                            <div className="flex items-center gap-2 mt-1">
                                <span className="input-soft flex-1 bg-ivory">{tutors.find(t => t.id === tutorId)?.name}</span>
                                <button onClick={() => { setTutorId(''); setPatientId('') }} className="text-xs text-charcoal/50">cambiar</button>
                            </div>
                        ) : (
                            <>
                                <input value={tutorQuery} onChange={e => setTutorQuery(e.target.value)} placeholder="Buscar tutor…" className="input-soft w-full mt-1" />
                                {tutorQuery && (
                                    <div className="border border-silk-beige rounded-lg mt-1 divide-y divide-silk-beige max-h-40 overflow-y-auto">
                                        {filteredTutors.map(t => (
                                            <button key={t.id} onClick={() => { setTutorId(t.id); setTutorQuery('') }} className="w-full text-left px-3 py-2 text-sm hover:bg-ivory">{t.name}</button>
                                        ))}
                                        {filteredTutors.length === 0 && <p className="px-3 py-2 text-xs text-charcoal/40">Sin resultados</p>}
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {tutorId && (
                        <div>
                            <label className="text-xs font-bold text-charcoal/60">Mascota</label>
                            <select value={patientId} onChange={e => setPatientId(e.target.value)} className="input-soft w-full mt-1">
                                <option value="">Elige…</option>
                                {patients.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                            {patientId && (
                                <div className="mt-1.5">
                                    <ConsentBadge
                                        clinicId={clinicId}
                                        patientId={patientId}
                                        patientName={patients.find(p => p.id === patientId)?.name || ''}
                                        tutor={{ id: tutorId, name: tutors.find(t => t.id === tutorId)?.name }}
                                    />
                                </div>
                            )}
                        </div>
                    )}

                    <div>
                        <label className="text-xs font-bold text-charcoal/60">Servicio</label>
                        <select value={serviceId} onChange={e => setServiceId(e.target.value)} className="input-soft w-full mt-1">
                            <option value="">Elige…</option>
                            {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                        {services.length === 0 && <p className="text-[11px] text-amber-600 mt-1">Aún no hay servicios de estética. Créalos en Configuración → Servicios y Precios.</p>}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="text-xs font-bold text-charcoal/60">Fecha</label>
                            <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input-soft w-full mt-1" />
                        </div>
                        <div>
                            <label className="text-xs font-bold text-charcoal/60">Hora</label>
                            <input type="time" value={time} onChange={e => setTime(e.target.value)} className="input-soft w-full mt-1" />
                        </div>
                    </div>

                    <div>
                        <label className="text-xs font-bold text-charcoal/60">Peluquero/a</label>
                        <select value={groomerId} onChange={e => setGroomerId(e.target.value)} className="input-soft w-full mt-1">
                            <option value="">—</option>
                            {groomers.map(g => <option key={g.member_id} value={g.member_id}>{[g.first_name, g.last_name].filter(Boolean).join(' ')}</option>)}
                        </select>
                    </div>
                </div>
                <div className="p-4 border-t border-silk-beige flex justify-end gap-2">
                    <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-bold text-charcoal/60 hover:bg-charcoal/5">Cancelar</button>
                    <button onClick={create} disabled={saving} className="btn-primary flex items-center gap-2 disabled:opacity-50">
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Crear
                    </button>
                </div>
            </div>
        </div>
    )
}
