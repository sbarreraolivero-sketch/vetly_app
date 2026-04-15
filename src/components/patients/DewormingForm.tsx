import { useState, useEffect } from 'react'
import { X, Loader2, Save, ShieldAlert, MessageSquare } from 'lucide-react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Patient } from '@/types/database'

export interface DewormingEvent {
    id: string
    patient_id: string
    type: string
    brand?: string | null
    weight?: number | null
    application_date: string
    next_dose_date?: string | null
    veterinarian_id?: string | null
    notes?: string | null
}

interface DewormingFormProps {
    patient: Patient
    event?: DewormingEvent | null
    onClose: () => void
    onSave: () => void
}

export function DewormingForm({ patient, event, onClose, onSave }: DewormingFormProps) {
    const { profile } = useAuth()
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const [formData, setFormData] = useState({
        type: 'Interno',
        brand: '',
        weight: patient.weight ? patient.weight.toString() : '',
        application_date: new Date().toISOString().split('T')[0],
        next_dose_date: '',
        automate_reminder: true,
        whatsapp_template: '',
        notes: ''
    })

    useEffect(() => {
        if (event) {
            setFormData((prev: any) => ({
                ...prev,
                type: event.type || 'Interno',
                brand: event.brand || '',
                weight: event.weight ? event.weight.toString() : (patient.weight ? patient.weight.toString() : ''),
                application_date: event.application_date,
                next_dose_date: event.next_dose_date || '',
                notes: event.notes || ''
            }))
        }
    }, [event, patient.weight])

    useEffect(() => {
        if (profile?.clinic_id) {
            loadDefaultTemplate()
        }
    }, [profile?.clinic_id])

    const loadDefaultTemplate = async () => {
        try {
            const { data: settings } = await (supabase as any)
                .from('clinic_settings')
                .select('deworming_reminder_template')
                .eq('clinic_id', profile!.clinic_id)
                .single()
            
            if (settings?.deworming_reminder_template) {
                setFormData((prev: any) => ({ ...prev, whatsapp_template: settings.deworming_reminder_template }))
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
            const dewormingData: any = {
                patient_id: patient.id,
                clinic_id: profile?.clinic_id,
                type: formData.type,
                brand: formData.brand || null,
                weight: formData.weight ? parseFloat(formData.weight) : null,
                application_date: formData.application_date,
                next_dose_date: formData.next_dose_date || null,
                notes: formData.notes || null,
                veterinarian_id: profile?.id
            }

            if (event?.id) {
                const { error: updateError } = await (supabase as any)
                    .from('deworming')
                    .update(dewormingData)
                    .eq('id', event.id)
                if (updateError) throw updateError
            } else {
                const { error: createError } = await (supabase as any)
                    .from('deworming')
                    .insert([dewormingData])
                if (createError) throw createError
            }

            // Sync weight with patient if provided
            if (formData.weight && !isNaN(parseFloat(formData.weight))) {
                await (supabase as any)
                    .from('patients')
                    .update({ weight: parseFloat(formData.weight) })
                    .eq('id', patient.id)
            }

            // Recordatorio de próxima dosis
            if (formData.next_dose_date && formData.automate_reminder && profile) {
                // Guardamos la fecha REAL de la dosis.
                // El proceso automático (Cron) se encargará de avisar 1 día antes de esta fecha.
                const reminderData = {
                     clinic_id: profile.clinic_id,
                     patient_id: patient.id,
                     tutor_id: patient.tutor_id,
                     title: `Recordatorio: Desparasitación ${formData.type === 'Interno' ? 'Interna' : 'Externa'}`,
                     scheduled_date: formData.next_dose_date,
                     type: 'deworming',
                     status: 'pending',
                     whatsapp_template: formData.whatsapp_template || null
                }
                await (supabase as any).from('reminders').insert([reminderData])
            }

            onSave()
            onClose()
        } catch (err: any) {
            console.error('Error saving deworming:', err)
            setError(err.message || 'Error al guardar el control antiparasitario')
        } finally {
            setLoading(false)
        }
    }

    return createPortal(
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[99999] animate-fade-in p-4 backdrop-blur-sm">
            <div className="bg-white rounded-soft w-full max-w-lg shadow-2xl overflow-hidden">
                <div className="p-6 border-b border-silk-beige flex items-center justify-between bg-amber-50/50">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                            <ShieldAlert className="w-5 h-5 text-amber-600" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-charcoal uppercase tracking-tight">
                                {event ? 'Editar Desparasitación' : 'Nueva Desparasitación'}
                            </h2>
                            <p className="text-xs text-charcoal/60 uppercase tracking-widest font-bold">Control Antiparasitario</p>
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
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-charcoal/60 uppercase tracking-widest mb-1.5 ml-1">Tipo <span className="text-red-500">*</span></label>
                                <select
                                    value={formData.type}
                                    onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                                    className="input-soft w-full font-bold"
                                >
                                    <option value="Interno">Interno</option>
                                    <option value="Externo">Externo</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-charcoal/60 uppercase tracking-widest mb-1.5 ml-1">Peso Pcte. (kg)</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={formData.weight}
                                    onChange={(e) => setFormData({ ...formData, weight: e.target.value })}
                                    className="input-soft w-full font-bold h-11"
                                    placeholder="0.00"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-charcoal/60 uppercase tracking-widest mb-1.5 ml-1">Marca / Producto</label>
                            <input
                                type="text"
                                value={formData.brand}
                                onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                                className="input-soft w-full font-bold"
                                placeholder="Ej: Bravecto, Nexgard, Drontal..."
                            />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                            <div className="space-y-1.5">
                                <label className="block text-xs font-bold text-charcoal/60 uppercase tracking-widest ml-1">Fecha Aplicación <span className="text-red-500">*</span></label>
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
                                    <span>Próxima Dosis</span>
                                    <span className="text-charcoal/30 font-normal">(opc)</span>
                                </label>
                                <input
                                    type="date"
                                    value={formData.next_dose_date}
                                    onChange={(e) => setFormData({ ...formData, next_dose_date: e.target.value })}
                                    className="input-soft w-full text-sm h-11 border-amber-100 bg-amber-50/10 font-bold"
                                />
                            </div>
                        </div>

                        {formData.next_dose_date && (
                            <div className="p-4 bg-amber-50/50 rounded-xl border border-amber-100 animate-fade-in flex items-center justify-between gap-4">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <MessageSquare className="w-4 h-4 text-amber-600" />
                                        <h4 className="text-xs font-bold text-amber-700 uppercase tracking-widest">Automatizar Recordatorio</h4>
                                    </div>
                                    <p className="text-[11px] text-amber-800 font-bold leading-tight">
                                        Se enviará por WhatsApp 1 día antes usando la plantilla predeterminada.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setFormData((prev: any) => ({ ...prev, automate_reminder: !prev.automate_reminder }))}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${formData.automate_reminder ? 'bg-amber-600' : 'bg-charcoal/20'}`}
                                >
                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.automate_reminder ? 'translate-x-6' : 'translate-x-1'}`} />
                                </button>
                            </div>
                        )}

                        <div>
                            <label className="block text-xs font-bold text-charcoal/60 uppercase tracking-widest mb-1.5 ml-1">Notas / Dosis Administrada</label>
                            <textarea
                                value={formData.notes}
                                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                className="input-soft w-full min-h-[80px] text-sm"
                                placeholder="Dosis exacta, lote, observaciones..."
                            />
                        </div>
                    </div>

                    <div className="pt-4 flex items-center justify-end gap-3 border-t border-silk-beige">
                        <button type="button" onClick={onClose} className="btn-ghost text-sm uppercase font-bold tracking-widest" disabled={loading}>Cancelar</button>
                        <button type="submit" className="btn-primary py-2 px-6 flex items-center gap-2 text-sm shadow-premium uppercase font-bold tracking-widest bg-amber-600 hover:bg-amber-700" disabled={loading}>
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            {loading ? 'Guardando...' : 'Guardar Registro'}
                        </button>
                    </div>
                </form>
            </div>
        </div>,
        document.body
    )
}
