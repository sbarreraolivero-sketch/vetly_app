import { useState } from 'react'
import { X, Loader2, Save, Pill, Plus, Trash2, AlertCircle } from 'lucide-react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Patient } from '@/types/database'

export interface PrescriptionItem {
    drug: string
    presentation: string
    dose: string
    route: string
    frequency: string
    duration: string
    quantity: string
    instructions: string
}

export interface Prescription {
    id: string
    clinic_id: string
    patient_id: string
    issued_date: string
    diagnosis: string | null
    patient_weight: number | null
    tutor_name: string | null
    prescriber_name: string | null
    prescriber_license: string | null
    prescriber_title: string | null
    items: PrescriptionItem[]
    general_instructions: string | null
    notes: string | null
    public_token: string
    created_at: string
}

interface PrescriptionFormProps {
    patient: Patient
    tutorName?: string | null
    onClose: () => void
    onSave: () => void
}

const ROUTES = ['Oral', 'Tópica', 'Subcutánea', 'Intramuscular', 'Intravenosa', 'Ótica', 'Oftálmica', 'Otra']

const emptyItem = (): PrescriptionItem => ({
    drug: '', presentation: '', dose: '', route: 'Oral',
    frequency: '', duration: '', quantity: '', instructions: '',
})

export function PrescriptionForm({ patient, tutorName, onClose, onSave }: PrescriptionFormProps) {
    const { profile, member } = useAuth()
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const [issuedDate, setIssuedDate] = useState(new Date().toISOString().split('T')[0])
    const [diagnosis, setDiagnosis] = useState('')
    const [weight, setWeight] = useState<string>(patient.weight ? String(patient.weight) : '')
    const [items, setItems] = useState<PrescriptionItem[]>([emptyItem()])
    const [generalInstructions, setGeneralInstructions] = useState('')
    const [notes, setNotes] = useState('')

    const memberAny = member as any
    const prescriberTitle: string = memberAny?.professional_title || ''
    const prescriberLicense: string = memberAny?.professional_license || ''
    const prescriberSignatureUrl: string = memberAny?.signature_url || ''

    const updateItem = (idx: number, field: keyof PrescriptionItem, value: string) => {
        setItems(prev => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)))
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)

        const cleanItems = items
            .map(it => ({ ...it, drug: it.drug.trim() }))
            .filter(it => it.drug.length > 0)

        if (cleanItems.length === 0) {
            setError('Agrega al menos un medicamento con nombre.')
            return
        }

        setLoading(true)
        try {
            const parsedWeight = weight ? parseFloat(weight) : null

            const insert = {
                clinic_id: patient.clinic_id,
                patient_id: patient.id,
                medical_history_id: null,
                prescriber_member_id: member?.id ?? null,
                prescriber_name: [member?.first_name, member?.last_name].filter(Boolean).join(' ') || null,
                prescriber_license: prescriberLicense || null,
                prescriber_title: prescriberTitle || null,
                prescriber_signature_url: prescriberSignatureUrl || null,
                issued_date: issuedDate,
                patient_snapshot: {
                    name: patient.name,
                    species: patient.species,
                    breed: patient.breed,
                    sex: patient.sex,
                    dob: patient.dob,
                    microchip_id: (patient as any).microchip_id ?? null,
                    weight: parsedWeight,
                    weight_unit: (patient as any).weight_unit ?? 'kg',
                },
                patient_weight: parsedWeight,
                tutor_name: tutorName ?? null,
                diagnosis: diagnosis.trim() || null,
                items: cleanItems,
                general_instructions: generalInstructions.trim() || null,
                notes: notes.trim() || null,
                created_by: profile?.id ?? null,
            }

            const { error: insertError } = await (supabase as any).from('prescriptions').insert([insert])
            if (insertError) throw insertError

            // Sincronizar el peso con el paciente si cambió (mismo criterio que VaccineForm).
            if (parsedWeight && parsedWeight !== patient.weight) {
                const { error: weightError } = await (supabase as any)
                    .from('patients')
                    .update({ weight: parsedWeight })
                    .eq('id', patient.id)
                if (weightError) console.error('Error updating patient weight:', weightError)
            }

            onSave()
            onClose()
        } catch (err: any) {
            console.error('Error saving prescription:', err)
            setError(err.message || 'Error al guardar la receta')
        } finally {
            setLoading(false)
        }
    }

    return createPortal(
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[99999] animate-fade-in p-4 backdrop-blur-sm">
            <div className="bg-white rounded-soft w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
                <div className="p-6 border-b border-silk-beige flex items-center justify-between bg-primary-50/50 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
                            <Pill className="w-5 h-5 text-primary-600" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-charcoal uppercase tracking-tight">Nueva Receta</h2>
                            <p className="text-[10px] text-charcoal/60 uppercase tracking-widest font-bold">
                                {patient.name} {tutorName ? `· ${tutorName}` : ''}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-silk-beige rounded-full transition-colors">
                        <X className="w-5 h-5 text-charcoal/60" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto">
                    {error && (
                        <div className="p-3 bg-red-50 text-red-600 text-sm rounded flex items-center gap-2 font-bold">
                            <X className="w-4 h-4" /> {error}
                        </div>
                    )}

                    {!prescriberTitle && (
                        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                            Completa tu título profesional y matrícula en <strong>Configuración → Mi Perfil</strong> para que aparezcan en la receta.
                        </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-charcoal/60 uppercase tracking-widest mb-1.5 ml-1">Fecha de emisión <span className="text-red-500">*</span></label>
                            <input type="date" required value={issuedDate} onChange={e => setIssuedDate(e.target.value)} className="input-soft w-full text-sm h-11 font-bold" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-charcoal/60 uppercase tracking-widest mb-1.5 ml-1">Peso (kg)</label>
                            <input type="number" step="0.01" value={weight} onChange={e => setWeight(e.target.value)} placeholder="0.00" className="input-soft w-full text-sm h-11 font-bold" />
                        </div>
                        <div className="sm:col-span-3">
                            <label className="block text-xs font-bold text-charcoal/60 uppercase tracking-widest mb-1.5 ml-1">Diagnóstico</label>
                            <input type="text" value={diagnosis} onChange={e => setDiagnosis(e.target.value)} placeholder="Diagnóstico presuntivo o definitivo" className="input-soft w-full font-medium" />
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-bold text-charcoal/60 uppercase tracking-widest ml-1">Medicamentos <span className="text-red-500">*</span></label>
                            <button type="button" onClick={() => setItems(prev => [...prev, emptyItem()])} className="text-xs font-bold text-primary-600 hover:text-primary-700 flex items-center gap-1">
                                <Plus className="w-3.5 h-3.5" /> Agregar
                            </button>
                        </div>

                        {items.map((it, idx) => (
                            <div key={idx} className="p-4 rounded-xl border border-silk-beige bg-ivory/40 space-y-3 relative">
                                {items.length > 1 && (
                                    <button type="button" onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))} className="absolute top-2 right-2 p-1.5 text-charcoal/30 hover:text-red-500 hover:bg-red-50 rounded">
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                )}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div className="sm:col-span-2">
                                        <label className="block text-[10px] font-bold text-charcoal/40 uppercase tracking-widest mb-1">Fármaco</label>
                                        <input type="text" value={it.drug} onChange={e => updateItem(idx, 'drug', e.target.value)} placeholder="Nombre del medicamento" className="input-soft w-full text-sm font-bold" />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-charcoal/40 uppercase tracking-widest mb-1">Presentación / concentración</label>
                                        <input type="text" value={it.presentation} onChange={e => updateItem(idx, 'presentation', e.target.value)} placeholder="Ej: comprimidos 50 mg" className="input-soft w-full text-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-charcoal/40 uppercase tracking-widest mb-1">Vía</label>
                                        <select value={it.route} onChange={e => updateItem(idx, 'route', e.target.value)} className="input-soft w-full text-sm">
                                            {ROUTES.map(r => <option key={r} value={r}>{r}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-charcoal/40 uppercase tracking-widest mb-1">Dosis</label>
                                        <input type="text" value={it.dose} onChange={e => updateItem(idx, 'dose', e.target.value)} placeholder="Ej: 1 comprimido" className="input-soft w-full text-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-charcoal/40 uppercase tracking-widest mb-1">Frecuencia</label>
                                        <input type="text" value={it.frequency} onChange={e => updateItem(idx, 'frequency', e.target.value)} placeholder="Ej: cada 12 h" className="input-soft w-full text-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-charcoal/40 uppercase tracking-widest mb-1">Duración</label>
                                        <input type="text" value={it.duration} onChange={e => updateItem(idx, 'duration', e.target.value)} placeholder="Ej: 7 días" className="input-soft w-full text-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-charcoal/40 uppercase tracking-widest mb-1">Cantidad a dispensar</label>
                                        <input type="text" value={it.quantity} onChange={e => updateItem(idx, 'quantity', e.target.value)} placeholder="Ej: 1 caja" className="input-soft w-full text-sm" />
                                    </div>
                                    <div className="sm:col-span-2">
                                        <label className="block text-[10px] font-bold text-charcoal/40 uppercase tracking-widest mb-1">Indicaciones</label>
                                        <input type="text" value={it.instructions} onChange={e => updateItem(idx, 'instructions', e.target.value)} placeholder="Ej: administrar con alimento" className="input-soft w-full text-sm" />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-charcoal/60 uppercase tracking-widest mb-1.5 ml-1">Instrucciones generales <span className="text-charcoal/40 font-normal">(las ve el tutor)</span></label>
                        <textarea value={generalInstructions} onChange={e => setGeneralInstructions(e.target.value)} className="input-soft w-full min-h-[70px] text-sm" placeholder="Recomendaciones adicionales, cuidados, controles..." />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-charcoal/60 uppercase tracking-widest mb-1.5 ml-1">Notas internas <span className="text-charcoal/40 font-normal">(no se imprimen)</span></label>
                        <textarea value={notes} onChange={e => setNotes(e.target.value)} className="input-soft w-full min-h-[50px] text-sm" placeholder="Solo para el equipo de la clínica" />
                    </div>

                    <div className="pt-4 flex items-center justify-end gap-3 border-t border-silk-beige">
                        <button type="button" onClick={onClose} className="btn-ghost text-sm uppercase font-bold tracking-widest" disabled={loading}>Cancelar</button>
                        <button type="submit" className="btn-primary py-2 px-6 flex items-center gap-2 text-sm shadow-premium uppercase font-bold tracking-widest" disabled={loading}>
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            {loading ? 'Guardando...' : 'Guardar Receta'}
                        </button>
                    </div>
                </form>
            </div>
        </div>,
        document.body
    )
}
