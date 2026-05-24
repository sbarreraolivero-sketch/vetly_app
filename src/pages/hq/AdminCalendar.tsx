import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Calendar as CalendarIcon, Clock, Building2, Mail, Loader2, CheckCircle, XCircle, User, Phone } from 'lucide-react'

type HQAppointment = {
    id: string
    clinic_id: string
    scheduled_at: string
    status: string
    duration_minutes: number
    notes: string | null
    created_at: string
    clinic_settings?: { clinic_name: string } | null
    clinic_members?: { first_name: string; last_name: string; email: string }[]
}

type DemoRequest = {
    id: string
    name: string
    clinic_name: string | null
    phone: string | null
    email: string | null
    clinic_type: string | null
    needs: string | null
    role: string | null
    scheduled_at: string
    status: string
    created_at: string
}

export default function AdminCalendar() {
    const [appointments, setAppointments] = useState<HQAppointment[]>([])
    const [demoRequests, setDemoRequests] = useState<DemoRequest[]>([])
    const [loading, setLoading] = useState(true)

    const fetchAppointments = async () => {
        setLoading(true)
        try {
            const { data: apts, error } = await (supabase as any)
                .from('hq_appointments')
                .select('*')
                .order('scheduled_at', { ascending: true })

            if (error) throw error

            const clinicIds = [...new Set(apts.map((a: any) => a.clinic_id))]

            const { data: clinics } = await supabase
                .from('clinic_settings')
                .select('id, clinic_name')
                .in('id', clinicIds)

            const { data: members } = await supabase
                .from('clinic_members')
                .select('clinic_id, email, first_name, last_name, role')
                .in('clinic_id', clinicIds)
                .eq('role', 'owner')

            const enriched = apts.map((apt: any) => ({
                ...apt,
                clinic_settings: clinics?.find((c: any) => c.id === apt.clinic_id),
                clinic_members: members?.filter((m: any) => m.clinic_id === apt.clinic_id) || []
            }))

            setAppointments(enriched)

            // Fetch demo requests
            const { data: demos } = await (supabase as any)
                .from('demo_requests')
                .select('*')
                .order('scheduled_at', { ascending: true })

            setDemoRequests(demos || [])
        } catch (error) {
            console.error('Error fetching calendar:', error)
        } finally {
            setLoading(false)
        }
    }

    const handleUpdateDemoStatus = async (id: string, newStatus: string) => {
        await (supabase as any).from('demo_requests').update({ status: newStatus }).eq('id', id)
        fetchAppointments()
    }

    useEffect(() => {
        fetchAppointments()
    }, [])

    const handleUpdateStatus = async (id: string, newStatus: string, clinicId?: string) => {
        const { error } = await (supabase as any)
            .from('hq_appointments')
            .update({ status: newStatus })
            .eq('id', id)

        if (!error) {
            // Also update clinic activation status to "active" magically behind the scenes when HQ finishes the onboarding call
            if (newStatus === 'completed' && clinicId) {
                const now = new Date()
                const trialEnd = new Date()
                trialEnd.setDate(trialEnd.getDate() + 7) // 7 days from now

                // 1. Activate clinic and set trial properties
                await (supabase as any).from('clinic_settings').update({
                    activation_status: 'active',
                    trial_status: 'running',
                    trial_start_date: now.toISOString(),
                    trial_end_date: trialEnd.toISOString(),
                }).eq('id', clinicId)

                // 2. Also try to update subscription table for trials automatically setup
                await (supabase as any).from('subscriptions').update({
                    status: 'trial',
                    trial_ends_at: trialEnd.toISOString(),
                    current_period_start: now.toISOString(),
                }).eq('clinic_id', clinicId)
            }
            fetchAppointments()
        }
    }

    if (loading) {
        return (
            <div className="flex h-64 items-center justify-center">
                <Loader2 className="w-8 h-8 text-charcoal animate-spin" />
            </div>
        )
    }

    return (
        <div className="space-y-8 p-4 lg:p-8 max-w-7xl mx-auto">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Calendario</h1>
                    <p className="text-gray-500">Demos y activaciones agendadas</p>
                </div>
                <div className="flex gap-2">
                    <span className="px-3 py-1 bg-violet-50 text-violet-700 rounded-full text-sm font-medium border border-violet-200">
                        {demoRequests.filter(d => d.status === 'pending').length} Demos pendientes
                    </span>
                    <span className="px-3 py-1 bg-amber-50 text-amber-700 rounded-full text-sm font-medium border border-amber-200">
                        {appointments.filter(a => a.status === 'scheduled').length} Activaciones
                    </span>
                </div>
            </div>

            {/* ── Solicitudes de Demo ── */}
            <div>
                <h2 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-violet-500 inline-block" />
                    Reuniones Demo — Landing vetly.pro
                </h2>
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Fecha y Hora</th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Prospecto</th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Contacto</th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Tipo / Necesidad</th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Estado</th>
                                    <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {demoRequests.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-10 text-center text-gray-400 text-sm">
                                            No hay solicitudes de demo aún
                                        </td>
                                    </tr>
                                ) : demoRequests.map(demo => {
                                    const date = new Date(demo.scheduled_at)
                                    return (
                                        <tr key={demo.id} className="hover:bg-violet-50/30 transition-colors">
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className="text-sm font-bold text-gray-900 capitalize block">
                                                    {format(date, 'EEEE d MMM, yyyy', { locale: es })}
                                                </span>
                                                <span className="flex items-center text-sm text-gray-500 mt-1 gap-1">
                                                    <Clock className="w-3.5 h-3.5 text-violet-500" />
                                                    {format(date, 'HH:mm')} hrs
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-9 h-9 rounded-lg bg-violet-100 flex items-center justify-center text-violet-700 font-black text-sm shrink-0">
                                                        {(demo.name || '?').charAt(0).toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <p className="text-sm font-semibold text-gray-900">{demo.name || '—'}</p>
                                                        <p className="text-xs text-gray-500 flex items-center gap-1">
                                                            <Building2 className="w-3 h-3" />{demo.clinic_name || '—'}
                                                        </p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <p className="text-sm text-gray-800 flex items-center gap-1"><Mail className="w-3.5 h-3.5 text-gray-400" />{demo.email || '—'}</p>
                                                <p className="text-xs text-gray-500 flex items-center gap-1 mt-1"><Phone className="w-3 h-3 text-gray-400" />{demo.phone || '—'}</p>
                                            </td>
                                            <td className="px-6 py-4">
                                                <p className="text-xs font-medium text-gray-700">{demo.clinic_type || '—'}</p>
                                                <p className="text-xs text-gray-400 mt-0.5">{demo.needs || '—'}</p>
                                            </td>
                                            <td className="px-6 py-4">
                                                {demo.status === 'pending' && <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-violet-100 text-violet-800 border border-violet-200">Pendiente</span>}
                                                {demo.status === 'completed' && <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200">Completada</span>}
                                                {demo.status === 'cancelled' && <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 border border-red-200">Cancelada</span>}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-right">
                                                {demo.status === 'pending' && (
                                                    <div className="flex items-center justify-end gap-2">
                                                        <button onClick={() => handleUpdateDemoStatus(demo.id, 'completed')} className="p-1.5 text-green-600 hover:bg-green-50 rounded border border-green-200 shadow-sm transition-colors" title="Marcar completada"><CheckCircle className="w-4 h-4" /></button>
                                                        <button onClick={() => handleUpdateDemoStatus(demo.id, 'cancelled')} className="p-1.5 text-red-600 hover:bg-red-50 rounded border border-red-200 shadow-sm transition-colors" title="Cancelar"><XCircle className="w-4 h-4" /></button>
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* ── Activaciones HQ ── */}
            <div>
                <h2 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
                    Sesiones de Activación — Clínicas registradas
                </h2>

                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Fecha y Hora</th>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Clínica / Prospecto</th>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Contacto</th>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Estado</th>
                                <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {appointments.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                                        <CalendarIcon className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                                        No hay citas agendadas hasta el momento
                                    </td>
                                </tr>
                            ) : appointments.map((apt) => {
                                const date = new Date(apt.scheduled_at)
                                const owner = apt.clinic_members?.[0]

                                return (
                                    <tr key={apt.id} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex flex-col">
                                                <span className="text-sm font-bold text-gray-900 capitalize">
                                                    {format(date, 'EEEE d MMM, yyyy', { locale: es })}
                                                </span>
                                                <div className="flex items-center text-sm text-gray-500 mt-1">
                                                    <Clock className="w-4 h-4 mr-1.5 text-primary-500" />
                                                    {format(date, 'HH:mm')} hrs ({apt.duration_minutes} min)
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex items-center">
                                                <div className="flex-shrink-0 h-10 w-10 bg-gradient-to-br from-charcoal to-gray-800 rounded-lg flex items-center justify-center text-white font-bold">
                                                    {apt.clinic_settings?.clinic_name.charAt(0).toUpperCase()}
                                                </div>
                                                <div className="ml-4">
                                                    <div className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                                                        <Building2 className="w-4 h-4 text-gray-400" />
                                                        {apt.clinic_settings?.clinic_name || 'Desconocida'}
                                                    </div>
                                                    <div className="text-sm text-gray-500 mt-0.5">
                                                        Id: <span className="text-xs font-mono">{apt.clinic_id.substring(0, 8)}...</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm text-gray-900 font-medium">
                                                {owner ? `${owner.first_name || ''} ${owner.last_name || ''}`.trim() || 'Sin Nombre' : 'Sin Dueño'}
                                            </div>
                                            <div className="flex items-center text-sm text-gray-500 mt-1">
                                                <Mail className="w-3.5 h-3.5 mr-1.5" />
                                                {owner?.email || '-'}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {apt.status === 'scheduled' && (
                                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
                                                    Agendada
                                                </span>
                                            )}
                                            {apt.status === 'completed' && (
                                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200">
                                                    Completada
                                                </span>
                                            )}
                                            {apt.status === 'cancelled' && (
                                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 border border-red-200">
                                                    Cancelada
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                            {apt.status === 'scheduled' && (
                                                <div className="flex items-center justify-end gap-2">
                                                    <button
                                                        onClick={() => handleUpdateStatus(apt.id, 'completed', apt.clinic_id)}
                                                        className="p-1.5 text-green-600 hover:bg-green-50 rounded bg-white border border-green-200 shadow-sm transition-colors"
                                                        title="Marcar como Completada"
                                                    >
                                                        <CheckCircle className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleUpdateStatus(apt.id, 'cancelled', apt.clinic_id)}
                                                        className="p-1.5 text-red-600 hover:bg-red-50 rounded bg-white border border-red-200 shadow-sm transition-colors"
                                                        title="Cancelar Cita"
                                                    >
                                                        <XCircle className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
                </div>
            </div>
        </div>
    )
}
