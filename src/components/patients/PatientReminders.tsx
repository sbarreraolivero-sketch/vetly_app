import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Loader2, Trash2, CalendarClock, Bell } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PatientRemindersProps {
    patientId: string
}

export function PatientReminders({ patientId }: PatientRemindersProps) {
    const { profile } = useAuth()
    const [loading, setLoading] = useState(true)
    const [reminders, setReminders] = useState<any[]>([])

    useEffect(() => {
        if (profile?.clinic_id && patientId) {
            fetchData()
        }
    }, [profile?.clinic_id, patientId])

    const fetchData = async () => {
        setLoading(true)
        try {
            // 1. Fetch Patient details to get the definitive clinic_id
            const { error: pError } = await (supabase as any)
                .from('patients')
                .select('clinic_id')
                .eq('id', patientId)
                .single()
            
            if (pError) throw pError

            // 2. Fetch Reminders for patient (Safe catch to avoid blocking global settings)
            try {
                const { data: rems, error: remError } = await (supabase as any)
                    .from('reminders')
                    .select('*')
                    .eq('patient_id', patientId)
                    .order('scheduled_date', { ascending: true })
                
                if (remError) throw remError
                setReminders(rems || [])
            } catch (err) {
                console.warn('Could not fetch specific reminders:', err)
            }

            
        } catch (error) {
            console.error('Error fetching data:', error)
        } finally {
            setLoading(false)
        }
    }


    const handleDeleteReminder = async (id: string) => {
        if (!confirm('¿Seguro que deseas eliminar este recordatorio programado?')) return
        try {
            await (supabase as any).from('reminders').delete().eq('id', id)
            setReminders(reminders.filter(r => r.id !== id))
        } catch (error) {
            console.error('Error deleting reminder:', error)
        }
    }

    if (loading) {
        return (
            <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
            </div>
        )
    }

    const upcomingReminders = reminders.filter(r => r.status === 'pending')
    const pastReminders = reminders.filter(r => r.status !== 'pending')

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in">
            {/* Main Reminders List */}
            <div className="lg:col-span-2 space-y-6">
                <div className="bg-white p-6 rounded-soft border border-silk-beige shadow-sm">
                    <div className="flex items-center gap-3 mb-6 pb-4 border-b border-silk-beige">
                        <div className="p-2 bg-primary-50 rounded-lg">
                            <CalendarClock className="w-5 h-5 text-primary-600" />
                        </div>
                        <div>
                            <h3 className="text-lg font-black text-charcoal uppercase tracking-tighter">Recordatorios Pendientes</h3>
                            <p className="text-xs text-charcoal/50 font-medium">Automatizaciones programadas para este paciente</p>
                        </div>
                    </div>

                    {upcomingReminders.length === 0 ? (
                        <div className="text-center py-12 border border-dashed border-silk-beige rounded-xl">
                            <Bell className="w-10 h-10 text-charcoal/20 mx-auto mb-3" />
                            <h4 className="text-charcoal font-bold uppercase tracking-tight">Sin recordatorios</h4>
                            <p className="text-xs text-charcoal/50 mt-1 max-w-xs mx-auto">Cuando registres una vacuna o desparasitación con próxima fecha, aparecerá aquí.</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {upcomingReminders.map(rem => (
                                <div key={rem.id} className="flex items-center justify-between p-4 bg-ivory rounded-xl border border-silk-beige hover:border-primary-200 transition-colors group">
                                    <div className="flex items-center gap-4">
                                        <div className="w-2 h-10 rounded-full bg-primary-400" />
                                        <div>
                                            <h5 className="font-bold text-charcoal uppercase text-sm">{rem.title}</h5>
                                            <div className="flex items-center gap-3 mt-1">
                                                <span className="text-[11px] font-bold text-charcoal/50 bg-white px-2 py-0.5 rounded border border-silk-beige">
                                                    Envío programado: {new Date(rem.scheduled_date).toLocaleDateString()}
                                                </span>
                                                {rem.type && (
                                                    <span className="text-[10px] font-bold text-primary-600 uppercase tracking-widest">
                                                        {rem.type === 'vaccine' ? 'Vacuna' : rem.type === 'deworming' ? 'Desparasitación' : rem.type}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <button 
                                        onClick={() => handleDeleteReminder(rem.id)}
                                        className="p-2 text-charcoal/30 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                        title="Eliminar recordatorio"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {pastReminders.length > 0 && (
                    <div className="bg-white p-6 rounded-soft border border-silk-beige shadow-sm opacity-70">
                        <h4 className="text-sm font-bold text-charcoal/50 uppercase tracking-widest mb-4">Historial de Recordatorios</h4>
                         <div className="space-y-3">
                            {pastReminders.map(rem => (
                                <div key={rem.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
                                    <div>
                                        <h5 className="font-semibold text-charcoal/70 text-sm line-through decoration-charcoal/20">{rem.title}</h5>
                                        <p className="text-xs text-charcoal/40 mt-0.5">Fecha: {new Date(rem.scheduled_date).toLocaleDateString()}</p>
                                    </div>
                                    <span className={cn(
                                        "text-[10px] font-bold px-2 py-1 rounded-sm uppercase tracking-widest",
                                        rem.status === 'sent' ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                                    )}>
                                        {rem.status === 'sent' ? 'Enviado' : rem.status}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
