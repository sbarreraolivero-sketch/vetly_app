import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Scissors, Plus, Loader2, ClipboardCheck, CheckCircle2, Clock, Calendar, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useClinicTimezone } from '@/hooks/useClinicTimezone'
import { toast } from 'react-hot-toast'
import { GroomingIntakeModal } from '@/components/grooming/GroomingIntakeModal'
import { GroomingClosureModal } from '@/components/grooming/GroomingClosureModal'
import { groomingService } from '@/services/groomingService'

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

    const { data: appts = [], isLoading } = useQuery<GroomingAppt[]>({
        queryKey: ['grooming-appointments', clinicId],
        queryFn: async () => {
            const from = new Date(Date.now() - 86400000).toISOString()
            const to = new Date(Date.now() + 14 * 86400000).toISOString()
            const { data, error } = await supabase
                .from('appointments')
                .select('id, patient_id, patient_name, tutor_id, tutor_name, appointment_date, service, status, professional_id')
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
                        <h1 className="text-xl sm:text-3xl font-extrabold tracking-tight mt-1">Estética</h1>
                        <p className="text-primary-100 text-xs sm:text-sm mt-1">La cola del día y la agenda de peluquería.</p>
                    </div>
                    <button onClick={() => setShowNew(true)} className="bg-white text-primary-700 font-bold text-sm px-4 py-2 rounded-xl flex items-center gap-2 shrink-0 self-start">
                        <Plus className="w-4 h-4" /> Nueva cita de estética
                    </button>
                </div>
            </div>

            {isLoading ? (
                <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary-500" /></div>
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
                <NewGroomingAppointment clinicId={clinicId as string} groomers={groomers} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); refresh() }} />
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

function NewGroomingAppointment({ clinicId, groomers, onClose, onCreated }: {
    clinicId: string; groomers: any[]; onClose: () => void; onCreated: () => void
}) {
    const [tutorQuery, setTutorQuery] = useState('')
    const [tutorId, setTutorId] = useState<string>('')
    const [patientId, setPatientId] = useState<string>('')
    const [serviceId, setServiceId] = useState<string>('')
    const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
    const [time, setTime] = useState('10:00')
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
