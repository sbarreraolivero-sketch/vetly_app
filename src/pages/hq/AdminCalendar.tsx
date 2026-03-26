import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Calendar as CalendarIcon, Clock, Building2, Mail, Loader2, CheckCircle, XCircle } from 'lucide-react'

// Define un tipo extendido para incluir los datos de la clínica
type HQAppointment = {
    id: string
    clinic_id: string
    scheduled_at: string
    status: string
    duration_minutes: number
    notes: string | null
    created_at: string
    clinic_settings?: {
        clinic_name: string
    } | null
    clinic_members?: {
        first_name: string
        last_name: string
        email: string
        phone_number: string // Assuming phone number is stored somewhere, or we fetch from user_profiles if needed
    }[]
}

export default function AdminCalendar() {
    const [appointments, setAppointments] = useState<HQAppointment[]>([])
    const [loading, setLoading] = useState(true)

    const fetchAppointments = async () => {
        setLoading(true)
        try {
            // First get the appointments
            const { data: apts, error } = await (supabase as any)
                .from('hq_appointments')
                .select('*')
                .order('scheduled_at', { ascending: true })

            if (error) throw error

            // Now theoretically we should bring clinic_settings and their owner. 
            // In a real query we can do a inner join if proper foreign keys exist.
            // But let's fetch clinics for these apts
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
        } catch (error) {
            console.error('Error fetching calendar:', error)
        } finally {
            setLoading(false)
        }
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
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Calendario de Activaciones</h1>
                    <p className="text-gray-500">Sesiones estratégicas agendadas por prospectos pendientes</p>
                </div>
                <div className="flex gap-2">
                    <span className="px-3 py-1 bg-amber-50 text-amber-700 rounded-full text-sm font-medium border border-amber-200">
                        {appointments.filter(a => a.status === 'scheduled').length} Pendientes
                    </span>
                </div>
            </div>

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
    )
}
