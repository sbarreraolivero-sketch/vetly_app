import { useState, useEffect } from 'react'
import { X, Loader2, Save, Syringe, MessageSquare } from 'lucide-react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Patient } from '@/types/database'

export interface VaccineEvent {
    id: string
    patient_id: string
    name: string
    application_date: string
    next_dose_date?: string | null
    veterinarian_id?: string | null
    notes?: string | null
}

interface VaccineFormProps {
    patient: Patient
    event?: VaccineEvent | null
    onClose: () => void
    onSave: () => void
}

const DOG_VACCINES = ['Óctuple', 'Sextuple', 'KC', 'Antirrábica', 'Triple felina', 'Leucemia felina', 'Otra']
const CAT_VACCINES = ['Triple felina', 'Leucemia felina', 'Antirrábica', 'Otra']

export function VaccineForm({ patient, event, onClose, onSave }: VaccineFormProps) {
    const { profile } = useAuth()
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const species = patient.species?.toLowerCase().includes('felin') || patient.species?.toLowerCase().includes('gat') ? 'cat' : 'dog'
    const vaccineOptions = species === 'cat' ? CAT_VACCINES : DOG_VACCINES

    const [formData, setFormData] = useState({
        name: vaccineOptions[0],
        custom_name: '',
        application_date: new Date().toISOString().split('T')[0],
        next_dose_date: '',
        automate_reminder: true,
        whatsapp_template: '',
        weight: patient.weight || '',
        notes: ''
    })

    useEffect(() => {
        if (event) {
            const isCustom = !vaccineOptions.includes(event.name)
            setFormData((prev: any) => ({
                ...prev,
                name: isCustom ? 'Otra' : event.name,
                custom_name: isCustom ? event.name : '',
                application_date: event.application_date,
                next_dose_date: event.next_dose_date || '',
                notes: event.notes || ''
            }))
        }
    }, [event, vaccineOptions])

    useEffect(() => {
        if (profile?.clinic_id) {
            loadDefaultTemplate()
        }
    }, [profile?.clinic_id])

    const loadDefaultTemplate = async () => {
        try {
            const { data: settings } = await (supabase as any)
                .from('clinic_settings')
                .select('vaccine_reminder_template')
                .eq('clinic_id', profile!.clinic_id)
                .single()
            
            if (settings?.vaccine_reminder_template) {
                setFormData((prev: any) => ({ ...prev, whatsapp_template: settings.vaccine_reminder_template }))
            }
        } catch (error) {
            console.error('Error loading default template:', error)
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError(null)

        try {
            const finalName = formData.name === 'Otra' ? formData.custom_name : formData.name
            if (!finalName) throw new Error('Debe especificar el nombre de la vacuna')

            const vaccineData: any = {
                patient_id: patient.id,
                clinic_id: profile?.clinic_id,
                name: finalName,
                application_date: formData.application_date,
                next_dose_date: formData.next_dose_date || null,
                notes: formData.notes || null,
                veterinarian_id: profile?.id
            }

            if (event?.id) {
                const { error: updateError } = await (supabase as any)
                    .from('vaccines')
                    .update(vaccineData)
                    .eq('id', event.id)
                if (updateError) throw updateError
            } else {
                const { error: createError } = await (supabase as any)
                    .from('vaccines')
                    .insert([vaccineData])
                if (createError) throw createError
            }

            // Sincronizar peso con el paciente si ha cambiado
            if (formData.weight && formData.weight !== patient.weight) {
                const { error: weightError } = await (supabase as any)
                    .from('patients')
                    .update({ weight: parseFloat(formData.weight.toString()) })
                    .eq('id', patient.id)
                if (weightError) console.error('Error updating patient weight:', weightError)
            }

            // Integración para recordatorios: si hay fecha próxima de dosis, crear recordatorio automáticamente
            if (formData.next_dose_date && formData.automate_reminder && profile) {
                const scheduledDate = new Date(formData.next_dose_date + 'T12:00:00Z')
                scheduledDate.setUTCDate(scheduledDate.getUTCDate() - 1)

                const reminderData = {
                     clinic_id: profile.clinic_id,
                     patient_id: patient.id,
                     tutor_id: patient.tutor_id,
                     title: `Recordatorio: Vacuna ${finalName}`,
                     scheduled_date: scheduledDate.toISOString().split('T')[0],
                     type: 'vaccine',
                     status: 'pending',
                     whatsapp_template: formData.whatsapp_template || null
                }
                await (supabase as any).from('reminders').insert([reminderData])
            }

            onSave()
            onClose()
        } catch (err: any) {
            console.error('Error saving vaccine:', err)
            setError(err.message || 'Error al guardar la vacuna')
        } finally {
            setLoading(false)
        }
    }

    return createPortal(
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[99999] animate-fade-in p-4 backdrop-blur-sm">
            <div className="bg-white rounded-soft w-full max-w-lg shadow-2xl overflow-hidden">
                <div className="p-6 border-b border-silk-beige flex items-center justify-between bg-primary-50/50">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
                            <Syringe className="w-5 h-5 text-primary-600" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-charcoal uppercase tracking-tight">
                                 {event ? 'Editar Vacuna' : 'Registro de Vacunación'}
                            </h2>
                            <p className="text-[10px] text-charcoal/60 uppercase tracking-widest font-bold">{species === 'cat' ? 'Protocolo Felino' : 'Protocolo Canino'}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-silk-beige rounded-full transition-colors">
                        <X className="w-5 h-5 text-charcoal/60" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                    {error && (
                        <div className="p-3 bg-red-50 text-red-600 text-sm rounded flex items-center gap-2 font-bold">
                            <X className="w-4 h-4" /> {error}
                        </div>
                    )}

                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-charcoal/60 uppercase tracking-widest mb-1.5 ml-1">Vacuna <span className="text-red-500">*</span></label>
                            <select
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                className="input-soft w-full text-sm font-bold"
                            >
                                {vaccineOptions.map(opt => (
                                    <option key={opt} value={opt}>{opt}</option>
                                ))}
                            </select>
                        </div>
                        
                        {formData.name === 'Otra' && (
                            <div>
                                <label className="block text-xs font-bold text-charcoal/60 uppercase tracking-widest mb-1.5 ml-1">Especifique Vacuna <span className="text-red-500">*</span></label>
                                <input
                                    type="text"
                                    required
                                    value={formData.custom_name}
                                    onChange={(e) => setFormData({ ...formData, custom_name: e.target.value })}
                                    className="input-soft w-full font-bold"
                                    placeholder="Nombre de la vacuna..."
                                />
                            </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-end">
                            <div className="space-y-1.5">
                                <label className="block text-xs font-bold text-charcoal/60 uppercase tracking-widest ml-1 whitespace-nowrap">Fecha Aplicación <span className="text-red-500">*</span></label>
                                <input
                                    type="date"
                                    required
                                    value={formData.application_date}
                                    onChange={(e) => setFormData({ ...formData, application_date: e.target.value })}
                                    className="input-soft w-full text-sm h-11 font-bold"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="block text-xs font-bold text-charcoal/60 uppercase tracking-widest ml-1 flex justify-between">
                                    <span>Próxima</span>
                                    <span className="text-charcoal/30 font-normal">(opc)</span>
                                </label>
                                <input
                                    type="date"
                                    value={formData.next_dose_date}
                                    onChange={(e) => setFormData({ ...formData, next_dose_date: e.target.value })}
                                    className="input-soft w-full text-sm h-11 font-bold"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="block text-xs font-bold text-charcoal/60 uppercase tracking-widest ml-1 text-emerald-600">Peso Actual (kg)</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={formData.weight}
                                    onChange={(e) => setFormData({ ...formData, weight: e.target.value })}
                                    className="input-soft w-full text-sm h-11 font-bold"
                                    placeholder="0.00"
                                />
                            </div>
                        </div>

                        {formData.next_dose_date && (
                            <div className="p-4 bg-primary-50/50 rounded-xl border border-primary-100 animate-fade-in flex items-center justify-between gap-4">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <MessageSquare className="w-4 h-4 text-primary-600" />
                                        <h4 className="text-xs font-bold text-primary-700 uppercase tracking-widest">Automatizar Recordatorio</h4>
                                    </div>
                                    <p className="text-[11px] text-primary-900 font-bold leading-tight">
                                        Se enviará por WhatsApp 1 día antes usando la plantilla predeterminada.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setFormData((prev: any) => ({ ...prev, automate_reminder: !prev.automate_reminder }))}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${formData.automate_reminder ? 'bg-primary-600' : 'bg-charcoal/20'}`}
                                >
                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.automate_reminder ? 'translate-x-6' : 'translate-x-1'}`} />
                                </button>
                            </div>
                        )}

                        <div>
                            <label className="block text-xs font-bold text-charcoal/60 uppercase tracking-widest mb-1.5 ml-1">Notas adicionales</label>
                            <textarea
                                value={formData.notes}
                                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                className="input-soft w-full min-h-[80px] text-sm"
                                placeholder="Marca, lote, peso, o reacciones..."
                            />
                        </div>
                    </div>

                    <div className="pt-4 flex items-center justify-end gap-3 border-t border-silk-beige">
                        <button type="button" onClick={onClose} className="btn-ghost text-sm uppercase font-bold tracking-widest" disabled={loading}>Cancelar</button>
                        <button type="submit" className="btn-primary py-2 px-6 flex items-center gap-2 text-sm shadow-premium uppercase font-bold tracking-widest" disabled={loading}>
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            {loading ? 'Guardando...' : 'Guardar Vacuna'}
                        </button>
                    </div>
                </form>
            </div>
        </div>,
        document.body
    )
}
