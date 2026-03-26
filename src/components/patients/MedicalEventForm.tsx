import { useState, useEffect } from 'react'
import { X, Loader2, Save, Activity, HeartPulse, Stethoscope, FileText, Scale } from 'lucide-react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'

export interface MedicalHistoryEvent {
    id: string
    patient_id: string
    event_date: string
    event_type: string | null
    reason?: string | null
    anamnesis?: string | null
    physical_exam?: any | null
    weight?: number | null
    diagnosis: string | null
    procedure_notes: string | null
    veterinarian_id: string | null
    created_at: string
}

interface MedicalEventFormProps {
    patientId: string
    event?: MedicalHistoryEvent | null
    onClose: () => void
    onSave: () => void
}

const eventTypeOptions = [
    'Consulta General',
    'Control de Seguimiento',
    'Cirugía / Procedimiento',
    'Urgencia',
    'Vacunación / Desparasitación',
    'Examen de Laboratorio',
    'Otro'
]

export function MedicalEventForm({ patientId, event, onClose, onSave }: MedicalEventFormProps) {
    const { profile } = useAuth()
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [activeTab, setActiveTab] = useState<'anamnesis' | 'exam' | 'diagnosis'>('anamnesis')

    const [formData, setFormData] = useState({
        event_date: new Date().toISOString().split('T')[0],
        event_type: 'Consulta General',
        reason: '',
        anamnesis: '',
        weight: '',
        physical_exam: {
            fc: '',
            fr: '',
            temp: '',
            mucous: '',
            lymph_nodes: '',
            attitude: '',
            hydration: '',
            body_condition: '',
            coat: ''
        },
        diagnosis: '',
        procedure_notes: ''
    })

    useEffect(() => {
        if (event) {
            setFormData({
                event_date: event.event_date.split('T')[0],
                event_type: event.event_type || 'Consulta General',
                reason: event.reason || '',
                anamnesis: event.anamnesis || '',
                weight: event.weight ? event.weight.toString() : '',
                physical_exam: event.physical_exam || {
                    fc: '', fr: '', temp: '', mucous: '', lymph_nodes: '',
                    attitude: '', hydration: '', body_condition: '', coat: ''
                },
                diagnosis: event.diagnosis || '',
                procedure_notes: event.procedure_notes || ''
            })
        }
    }, [event])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!patientId) return

        setLoading(true)
        setError(null)

        try {
            const historyData: any = {
                patient_id: patientId,
                event_date: formData.event_date,
                event_type: formData.event_type,
                reason: formData.reason || null,
                anamnesis: formData.anamnesis || null,
                weight: formData.weight ? parseFloat(formData.weight) : null,
                physical_exam: formData.physical_exam,
                diagnosis: formData.diagnosis || null,
                procedure_notes: formData.procedure_notes || null,
                veterinarian_id: profile?.id || null
            }

            if (event?.id) {
                const { error: updateError } = await (supabase as any)
                    .from('medical_history')
                    .update(historyData)
                    .eq('id', event.id)

                if (updateError) throw updateError
            } else {
                const { error: createError } = await (supabase as any)
                    .from('medical_history')
                    .insert([historyData])

                if (createError) throw createError
            }

            // Sync weight with patient if provided
            if (formData.weight && !isNaN(parseFloat(formData.weight))) {
                await (supabase as any)
                    .from('patients')
                    .update({ weight: parseFloat(formData.weight) })
                    .eq('id', patientId)
            }

            onSave()
            onClose()
        } catch (err: any) {
            console.error('Error saving medical event:', err)
            setError(err.message || 'Error al guardar el registro médico')
        } finally {
            setLoading(false)
        }
    }

    return createPortal(
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[99999] animate-fade-in p-4 backdrop-blur-sm">
            <div className="bg-white rounded-soft w-full max-w-4xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
                <div className="p-6 border-b border-silk-beige flex items-center justify-between bg-ivory rounded-t-soft">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
                            <Activity className="w-5 h-5 text-primary-600" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-charcoal uppercase tracking-tight">
                                {event ? 'Editar Registro Médico' : 'Nueva Evolución / Atención'}
                            </h2>
                            <p className="text-xs text-charcoal/50 uppercase tracking-widest mt-0.5">Historial Clínico</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-silk-beige rounded-full transition-colors"
                    >
                        <X className="w-5 h-5 text-charcoal/60" />
                    </button>
                </div>

                <div className="flex bg-gray-50/50 border-b border-silk-beige px-6 pt-4 gap-6">
                    <button
                        type="button"
                        onClick={() => setActiveTab('anamnesis')}
                        className={`pb-3 text-sm font-bold uppercase tracking-widest transition-colors relative flex items-center gap-2 ${activeTab === 'anamnesis' ? 'text-primary-600' : 'text-charcoal/40 hover:text-charcoal'}`}
                    >
                        <FileText className="w-4 h-4" />
                        Motivo y Anamnesis
                        {activeTab === 'anamnesis' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-600 rounded-t-full" />}
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('exam')}
                        className={`pb-3 text-sm font-bold uppercase tracking-widest transition-colors relative flex items-center gap-2 ${activeTab === 'exam' ? 'text-primary-600' : 'text-charcoal/40 hover:text-charcoal'}`}
                    >
                        <HeartPulse className="w-4 h-4" />
                        Examen Físico
                        {activeTab === 'exam' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-600 rounded-t-full" />}
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('diagnosis')}
                        className={`pb-3 text-sm font-bold uppercase tracking-widest transition-colors relative flex items-center gap-2 ${activeTab === 'diagnosis' ? 'text-primary-600' : 'text-charcoal/40 hover:text-charcoal'}`}
                    >
                        <Stethoscope className="w-4 h-4" />
                        Evolución y Diagnóstico
                        {activeTab === 'diagnosis' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-600 rounded-t-full" />}
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-8 overflow-y-auto flex-1 bg-white scrollbar-soft">
                    {error && (
                        <div className="mb-6 p-4 bg-red-50 text-red-600 text-sm rounded-soft flex items-center gap-2 border border-red-100 font-bold">
                            <X className="w-4 h-4" /> {error}
                        </div>
                    )}

                    {/* TAB: ANAMNESIS */}
                    {activeTab === 'anamnesis' && (
                        <div className="space-y-6 animate-fade-in">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-6 border-b border-silk-beige/50">
                                <div>
                                    <label className="block text-xs font-bold text-charcoal/60 uppercase tracking-widest mb-2 ml-1">
                                        Fecha <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="date"
                                        required
                                        value={formData.event_date}
                                        onChange={(e) => setFormData({ ...formData, event_date: e.target.value })}
                                        className="input-soft font-bold"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-charcoal/60 uppercase tracking-widest mb-2 ml-1">
                                        Tipo de Atención
                                    </label>
                                    <select
                                        value={formData.event_type}
                                        onChange={(e) => setFormData({ ...formData, event_type: e.target.value })}
                                        className="input-soft font-bold"
                                    >
                                        {eventTypeOptions.map(opt => (
                                            <option key={opt} value={opt}>{opt}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-charcoal/60 uppercase tracking-widest mb-2 ml-1">
                                    Motivo de Consulta <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    required
                                    value={formData.reason}
                                    onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                                    className="input-soft font-bold"
                                    placeholder="Ej: Viene por vómitos desde hace 2 días..."
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-charcoal/60 uppercase tracking-widest mb-2 ml-1">
                                    Anamnesis (Historia Clínica Previa)
                                </label>
                                <textarea
                                    value={formData.anamnesis}
                                    onChange={(e) => setFormData({ ...formData, anamnesis: e.target.value })}
                                    className="input-soft min-h-[140px] resize-none text-sm"
                                    placeholder="Detalles sobre dieta, estilo de vida, enfermedades previas, medicación actual..."
                                />
                            </div>
                        </div>
                    )}

                    {/* TAB: EXAMEN FÍSICO */}
                    {activeTab === 'exam' && (
                        <div className="space-y-8 animate-fade-in">
                            <div className="p-4 bg-silk-beige/20 rounded-soft border border-silk-beige flex items-center gap-4 max-w-sm shadow-sm">
                                <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center border border-silk-beige shadow-sm text-primary-600">
                                    <Scale className="w-6 h-6" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-charcoal/60 uppercase tracking-widest mb-1 ml-1">
                                        Peso Actual (kg)
                                    </label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={formData.weight}
                                        onChange={(e) => setFormData({ ...formData, weight: e.target.value })}
                                        className="input-soft py-1.5 w-32 font-bold text-lg text-primary-700"
                                        placeholder="0.00"
                                    />
                                </div>
                            </div>

                            <div>
                                <h3 className="text-sm font-bold uppercase tracking-widest text-charcoal/70 mb-4 pb-2 border-b border-silk-beige flex items-center gap-2">
                                    <HeartPulse className="w-4 h-4 text-rose-500" />
                                    Constantes Vitales y Examen
                                </h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
                                    {/* FC */}
                                    <div>
                                        <label className="block text-[11px] font-bold text-charcoal/50 uppercase mb-1.5 ml-1">Frec. Cardíaca (LPM)</label>
                                        <input type="text" value={formData.physical_exam.fc} onChange={(e) => setFormData({ ...formData, physical_exam: { ...formData.physical_exam, fc: e.target.value } })} className="input-soft py-2 font-bold" placeholder="Ej: 120" />
                                    </div>
                                    {/* FR */}
                                    <div>
                                        <label className="block text-[11px] font-bold text-charcoal/50 uppercase mb-1.5 ml-1">Frec. Respiratoria (RPM)</label>
                                        <input type="text" value={formData.physical_exam.fr} onChange={(e) => setFormData({ ...formData, physical_exam: { ...formData.physical_exam, fr: e.target.value } })} className="input-soft py-2 font-bold" placeholder="Ej: 30" />
                                    </div>
                                    {/* Temp */}
                                    <div>
                                        <label className="block text-[11px] font-bold text-charcoal/50 uppercase mb-1.5 ml-1">Temperatura (°C)</label>
                                        <input type="text" value={formData.physical_exam.temp} onChange={(e) => setFormData({ ...formData, physical_exam: { ...formData.physical_exam, temp: e.target.value } })} className="input-soft py-2 font-bold" placeholder="Ej: 38.5" />
                                    </div>
                                    {/* Mucosas */}
                                    <div>
                                        <label className="block text-[11px] font-bold text-charcoal/50 uppercase mb-1.5 ml-1">Mucosas</label>
                                        <input type="text" value={formData.physical_exam.mucous} onChange={(e) => setFormData({ ...formData, physical_exam: { ...formData.physical_exam, mucous: e.target.value } })} className="input-soft py-2 font-bold" placeholder="Ej: Rosadas, Palidas..." />
                                    </div>
                                    {/* Ganglios */}
                                    <div>
                                        <label className="block text-[11px] font-bold text-charcoal/50 uppercase mb-1.5 ml-1">Ganglios Linfáticos</label>
                                        <input type="text" value={formData.physical_exam.lymph_nodes} onChange={(e) => setFormData({ ...formData, physical_exam: { ...formData.physical_exam, lymph_nodes: e.target.value } })} className="input-soft py-2 font-bold" placeholder="Ej: Normales, Aumentados..." />
                                    </div>
                                    {/* Actitud */}
                                    <div>
                                        <label className="block text-[11px] font-bold text-charcoal/50 uppercase mb-1.5 ml-1">Actitud</label>
                                        <input type="text" value={formData.physical_exam.attitude} onChange={(e) => setFormData({ ...formData, physical_exam: { ...formData.physical_exam, attitude: e.target.value } })} className="input-soft py-2 font-bold" placeholder="Ej: Alerta, Deprimido..." />
                                    </div>
                                    {/* Pelaje */}
                                    <div>
                                        <label className="block text-[11px] font-bold text-charcoal/50 uppercase mb-1.5 ml-1">Pelaje / Piel</label>
                                        <input type="text" value={formData.physical_exam.coat} onChange={(e) => setFormData({ ...formData, physical_exam: { ...formData.physical_exam, coat: e.target.value } })} className="input-soft py-2 font-bold" placeholder="Ej: Sano, Alopecia..." />
                                    </div>
                                    {/* Hidratación */}
                                    <div>
                                        <label className="block text-[11px] font-bold text-charcoal/50 uppercase mb-1.5 ml-1">Hidratación</label>
                                        <input type="text" value={formData.physical_exam.hydration} onChange={(e) => setFormData({ ...formData, physical_exam: { ...formData.physical_exam, hydration: e.target.value } })} className="input-soft py-2 font-bold" placeholder="Ej: 5%, Normal..." />
                                    </div>
                                    {/* Condicion Corporal */}
                                    <div>
                                        <label className="block text-[11px] font-bold text-charcoal/50 uppercase mb-1.5 ml-1">Condición Corporal</label>
                                        <input type="text" value={formData.physical_exam.body_condition} onChange={(e) => setFormData({ ...formData, physical_exam: { ...formData.physical_exam, body_condition: e.target.value } })} className="input-soft py-2 font-bold" placeholder="Ej: 3/5, 5/9..." />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* TAB: DIAGNOSTICO */}
                    {activeTab === 'diagnosis' && (
                        <div className="space-y-6 animate-fade-in">
                            <div>
                                <label className="block text-xs font-bold text-charcoal/60 uppercase tracking-widest mb-2 ml-1">
                                    Diagnóstico Presuntivo / Definitivo <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    required
                                    value={formData.diagnosis}
                                    onChange={(e) => setFormData({ ...formData, diagnosis: e.target.value })}
                                    className="input-soft font-bold text-primary-700"
                                    placeholder="Ej: Gastroenteritis hemorrágica, Control Sano..."
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-charcoal/60 uppercase tracking-widest mb-2 flex items-center justify-between ml-1">
                                    <span>Tratamiento y Evolución (Plan a seguir)</span>
                                </label>
                                <textarea
                                    value={formData.procedure_notes}
                                    onChange={(e) => setFormData({ ...formData, procedure_notes: e.target.value })}
                                    className="input-soft min-h-[220px] resize-none leading-relaxed text-sm font-medium"
                                    placeholder="Describe detalladamente el tratamiento aplicado, medicamentos RECETADOS y recomendaciones para el tutor..."
                                />
                            </div>
                        </div>
                    )}
                </form>

                <div className="p-6 border-t border-silk-beige flex justify-between gap-3 bg-gray-50/50 rounded-b-soft">
                    <div className="text-xs font-bold text-charcoal/40 uppercase tracking-widest flex items-center">
                        {activeTab === 'anamnesis' && 'Paso 1 de 3'}
                        {activeTab === 'exam' && 'Paso 2 de 3'}
                        {activeTab === 'diagnosis' && 'Paso 3 de 3'}
                    </div>
                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="btn-ghost text-xs font-bold uppercase tracking-widest"
                            disabled={loading}
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={loading}
                            className="btn-primary flex items-center gap-2 py-2.5 px-6 text-xs font-bold uppercase tracking-widest"
                        >
                            {loading ? (
                                <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</>
                            ) : (
                                <><Save className="w-4 h-4" /> Guardar Evolución</>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    )
}
