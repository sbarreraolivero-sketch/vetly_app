import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Loader2, Save, Trash2, CalendarClock, Settings2, Bell } from 'lucide-react'
import { TemplateSelector } from '@/components/settings/TemplateSelector'
import { cn } from '@/lib/utils'
import toast from 'react-hot-toast'

interface PatientRemindersProps {
    patientId: string
}

export function PatientReminders({ patientId }: PatientRemindersProps) {
    const { profile, clinics } = useAuth()
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [reminders, setReminders] = useState<any[]>([])
    
    const [vaccineTemplate, setVaccineTemplate] = useState('')
    const [dewormingTemplate, setDewormingTemplate] = useState('')
    const [activeClinicId, setActiveClinicId] = useState<string | null>(null)

    useEffect(() => {
        if (profile?.clinic_id && patientId) {
            fetchData()
        }
    }, [profile?.clinic_id, patientId])

    const fetchData = async () => {
        setLoading(true)
        try {
            // 1. Fetch Patient details to get the definitive clinic_id
            const { data: patient, error: pError } = await (supabase as any)
                .from('patients')
                .select('clinic_id')
                .eq('id', patientId)
                .single()
            
            if (pError) throw pError
            const clinicId = patient?.clinic_id || profile?.clinic_id
            setActiveClinicId(clinicId)

            console.log('[PatientReminders] Logic IDs:', { 
                patientClinicId: patient?.clinic_id,
                profileClinicId: profile?.clinic_id,
                using: clinicId
            })

            // 2. Fetch Reminders for patient
            const { data: rems, error: remError } = await (supabase as any)
                .from('reminders')
                .select('*')
                .eq('patient_id', patientId)
                .order('scheduled_date', { ascending: true })
            
            if (remError) throw remError
            setReminders(rems || [])

            // 3. Fetch Clinic Settings using the patient-derived clinic_id
            const { data: settingsArray, error: setError } = await (supabase as any)
                .from('clinic_settings')
                .select('*')
                .eq('id', clinicId)
            
            console.log('[PatientReminders] settingsArray result:', settingsArray)

            if (setError) {
                console.error("Error fetching clinic settings:", setError)
            } else if (settingsArray && settingsArray.length > 0) {
                const settings = settingsArray[0]
                setVaccineTemplate(settings.vaccine_reminder_template || '')
                setDewormingTemplate(settings.deworming_reminder_template || '')
            }
            
        } catch (error) {
            console.error('Error fetching reminders data:', error)
        } finally {
            setLoading(false)
        }
    }

    const handleSaveSettings = async () => {
        const clinicIdToUse = activeClinicId || profile?.clinic_id
        if (!clinicIdToUse) {
            toast.error('Sesión no válida. Intenta cerrar sesión e ingresar de nuevo.')
            return
        }
        
        setSaving(true)
        const toastId = toast.loading('Guardando preferencias...')
        
        console.log('[PatientReminders] Saving templates:', { v: vaccineTemplate, d: dewormingTemplate, id: clinicIdToUse })
        
        try {
            const currentClinic = clinics.find(c => c.clinic_id === clinicIdToUse)
            
            // Using upsert to handle case where record might not exist yet
            const { data, error } = await (supabase as any)
                .from('clinic_settings')
                .upsert({
                    id: clinicIdToUse,
                    clinic_name: currentClinic?.clinic_name || 'Mi Clínica',
                    vaccine_reminder_template: vaccineTemplate,
                    deworming_reminder_template: dewormingTemplate,
                    updated_at: new Date().toISOString()
                })
                .select()
            
            console.log('[PatientReminders] Upsert response:', { data, error })
            
            if (error) throw error
            
            toast.success('Preferencias guardadas correctamente', { id: toastId })
        } catch (error: any) {
            console.error('Error saving template settings:', error)
            toast.error(`Error al guardar: ${error.message || 'Error desconocido'}`, { id: toastId })
        } finally {
            setSaving(false)
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

            {/* Global Settings Sidebar */}
            <div className="bg-gradient-to-br from-primary-900 to-charcoal rounded-soft p-6 shadow-xl text-white h-fit sticky top-6">
                <div className="flex items-center gap-3 mb-6 pb-4 border-b border-white/10">
                    <div className="p-2 bg-white/10 rounded-lg">
                        <Settings2 className="w-5 h-5 text-primary-200" />
                    </div>
                    <div>
                        <h3 className="text-xl font-black uppercase tracking-tighter text-white">Ajustes Globales</h3>
                        <p className="text-[10px] text-primary-200 uppercase tracking-widest font-bold">Automatización de Clínica</p>
                    </div>
                </div>

                <div className="space-y-6">
                    <p className="text-xs text-white leading-relaxed font-bold">
                        Configura las plantillas de WhatsApp predeterminadas. Al registrar una nueva vacuna o desparasitación para <span className="text-primary-300 font-black underline decoration-primary-300 decoration-2 underline-offset-2">cualquier paciente</span>, el sistema usará estas plantillas enviándolas automáticamente 1 día antes de la próxima dosis.
                    </p>

                    <div className="space-y-5">
                        <div className="bg-white/10 p-4 rounded-xl border border-white/20 backdrop-blur-md">
                           <TemplateSelector 
                                label="Plantilla: Vacunas"
                                value={vaccineTemplate}
                                onChange={setVaccineTemplate}
                                placeholder="Elegir plantilla..."
                                labelClassName="text-white"
                           />
                        </div>

                        <div className="bg-white/10 p-4 rounded-xl border border-white/20 backdrop-blur-md">
                           <TemplateSelector 
                                label="Plantilla: Parasitología"
                                value={dewormingTemplate}
                                onChange={setDewormingTemplate}
                                placeholder="Elegir plantilla..."
                                labelClassName="text-white"
                           />
                        </div>
                    </div>

                    <button 
                        onClick={handleSaveSettings}
                        disabled={saving}
                        className="w-full btn-primary bg-primary-600 hover:bg-primary-500 text-white border-none font-bold py-4 shadow-xl flex items-center justify-center gap-3 mt-4 transition-all hover:scale-[1.02]"
                    >
                        {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                        <span className="uppercase tracking-widest text-sm">Guardar Preferencias</span>
                    </button>
                </div>
            </div>
        </div>
    )
}
