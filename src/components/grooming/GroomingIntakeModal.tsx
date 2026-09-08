import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2, ClipboardCheck, ShieldCheck, ShieldAlert, Check } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from 'react-hot-toast'
import { groomingService, TEMPERAMENTS, TEMPERAMENT_LABEL } from '@/services/groomingService'
import { consentService, type ConsentState } from '@/services/consentService'
import { ConsentForm } from '@/components/patients/ConsentForm'

interface Props {
    patient: { id: string; name: string; clinic_id: string; species?: string | null; breed?: string | null; sex?: string | null; dob?: string | null }
    tutor?: any
    appointmentId?: string | null
    onClose: () => void
    onSaved: () => void
}

const MATTING = [
    { v: 'ninguno', l: 'Sin nudos' },
    { v: 'leve', l: 'Nudos leves' },
    { v: 'moderado', l: 'Nudos moderados' },
    { v: 'severo', l: 'Nudos severos (puede requerir rapado)' },
]

export function GroomingIntakeModal({ patient, tutor, appointmentId, onClose, onSaved }: Props) {
    const { profile, member } = useAuth()
    const [loading, setLoading] = useState(true)
    const [consentState, setConsentState] = useState<ConsentState>('missing')
    const [showConsent, setShowConsent] = useState(false)
    const [saving, setSaving] = useState(false)

    const [temperament, setTemperament] = useState('')
    const [matting, setMatting] = useState('ninguno')
    const [pests, setPests] = useState(false)
    const [behaviorNotes, setBehaviorNotes] = useState('')
    const [mattingAck, setMattingAck] = useState(false)
    const [medicalAlerts, setMedicalAlerts] = useState('')

    const checkConsent = async () => {
        if (!patient.id || !patient.clinic_id) { setConsentState('missing'); return }
        const st = await consentService.getConsentStatus(patient.clinic_id, patient.id, 'estetica')
        setConsentState(st.state)
    }

    useEffect(() => {
        ;(async () => {
            setLoading(true)
            const [p] = await Promise.all([groomingService.getProfile(patient.id), checkConsent()])
            if (p) {
                setTemperament(p.temperament || '')
                setMattingAck(!!p.matting_policy_ack)
                setMedicalAlerts(p.medical_alerts || '')
            }
            setLoading(false)
        })()
    }, [patient.id])

    const handleSave = async () => {
        setSaving(true)
        try {
            await groomingService.upsertProfile({
                patient_id: patient.id,
                clinic_id: patient.clinic_id,
                temperament: temperament || null,
                matting_policy_ack: mattingAck,
                medical_alerts: medicalAlerts.trim() || null,
                // no se tocan los demás campos persistentes en el ingreso
                coat_type: null, coat_length: null, size_category: null, preferred_cut: null,
                cut_reference_photo_url: null, products_notes: null, product_allergies: null, handling_notes: null,
            } as any)
        } catch { /* la ficha completa se edita en la pestaña Estética */ }

        try {
            const mattLbl = MATTING.find(m => m.v === matting)?.l || matting
            const intake = [
                `Ingreso: ${mattLbl}.`,
                pests ? 'Se observan pulgas/garrapatas.' : null,
                behaviorNotes.trim() ? `Comportamiento: ${behaviorNotes.trim()}.` : null,
            ].filter(Boolean).join(' ')
            await groomingService.startSession({
                clinicId: patient.clinic_id,
                patientId: patient.id,
                appointmentId: appointmentId ?? null,
                groomerMemberId: member?.id || null,
                intakeNotes: intake || null,
                createdBy: profile?.id || null,
            })
            toast.success('Ingreso registrado')
            onSaved()
        } catch (e: any) {
            toast.error(e.message || 'No se pudo registrar el ingreso')
        } finally {
            setSaving(false)
        }
    }

    return createPortal(
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[99999] p-4 backdrop-blur-sm">
            <div className="bg-white rounded-soft w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
                <div className="p-5 border-b border-silk-beige flex items-center justify-between bg-primary-50/50 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center"><ClipboardCheck className="w-5 h-5 text-primary-600" /></div>
                        <div>
                            <h3 className="font-bold text-charcoal">Ingreso a estética</h3>
                            <p className="text-xs text-charcoal/50">{patient.name}{tutor?.name ? ` — ${tutor.name}` : ''}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1.5 hover:bg-silk-beige rounded-lg"><X className="w-5 h-5 text-charcoal/60" /></button>
                </div>

                {loading ? (
                    <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary-500" /></div>
                ) : (
                    <div className="p-5 overflow-y-auto flex-1 space-y-4">
                        {/* Consentimiento */}
                        {consentState === 'valid' ? (
                            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center gap-2">
                                <ShieldCheck className="w-4 h-4" /> Consentimiento de estética firmado y vigente.
                            </div>
                        ) : (
                            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
                                <p className="flex items-center gap-2 font-bold">
                                    <ShieldAlert className="w-4 h-4" />
                                    {consentState === 'expired'
                                        ? 'El consentimiento de estética venció'
                                        : consentState === 'outdated'
                                            ? 'La plantilla del consentimiento cambió desde la última firma'
                                            : 'Falta el consentimiento de estética'}
                                </p>
                                <button onClick={() => setShowConsent(true)} className="mt-2 text-xs font-bold underline">
                                    {consentState === 'missing' ? 'Emitir y enviar consentimiento' : 'Volver a solicitar el consentimiento'}
                                </button>
                            </div>
                        )}

                        <div>
                            <label className="text-xs font-bold text-charcoal/60">Estado del pelaje al ingreso</label>
                            <div className="grid grid-cols-2 gap-2 mt-1">
                                {MATTING.map(m => (
                                    <button key={m.v} onClick={() => setMatting(m.v)}
                                        className={`text-left px-3 py-2 rounded-lg border text-xs transition-all ${matting === m.v ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-500' : 'border-silk-beige'}`}>
                                        {m.l}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <label className="flex items-center gap-2 text-sm text-charcoal/80">
                            <input type="checkbox" checked={pests} onChange={e => setPests(e.target.checked)} />
                            Se observan pulgas / garrapatas
                        </label>

                        <div>
                            <label className="text-xs font-bold text-charcoal/60">Temperamento</label>
                            <select value={temperament} onChange={e => setTemperament(e.target.value)} className="input-soft w-full mt-1">
                                <option value="">—</option>
                                {TEMPERAMENTS.map(t => <option key={t} value={t}>{TEMPERAMENT_LABEL[t]}</option>)}
                            </select>
                        </div>

                        <div>
                            <label className="text-xs font-bold text-charcoal/60">Comportamiento observado / notas</label>
                            <textarea value={behaviorNotes} onChange={e => setBehaviorNotes(e.target.value)} rows={2} className="input-soft w-full mt-1 resize-y" />
                        </div>

                        <div>
                            <label className="text-xs font-bold text-charcoal/60">Alertas médicas para el baño</label>
                            <input value={medicalAlerts} onChange={e => setMedicalAlerts(e.target.value)} className="input-soft w-full mt-1" placeholder="senior, cardíaco, epilepsia…" />
                        </div>

                        {matting === 'severo' && (
                            <label className="flex items-start gap-2 text-sm text-charcoal/80 p-2 rounded-lg bg-amber-50">
                                <input type="checkbox" className="mt-1" checked={mattingAck} onChange={e => setMattingAck(e.target.checked)} />
                                El tutor fue informado y acepta que los nudos severos pueden requerir rapado.
                            </label>
                        )}
                    </div>
                )}

                <div className="p-4 border-t border-silk-beige flex justify-end gap-2 shrink-0">
                    <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-bold text-charcoal/60 hover:bg-charcoal/5">Cancelar</button>
                    <button onClick={handleSave} disabled={saving || loading} className="btn-primary flex items-center gap-2 disabled:opacity-50">
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Registrar ingreso
                    </button>
                </div>
            </div>

            {showConsent && (
                <ConsentForm
                    patient={patient as any}
                    tutor={tutor}
                    initialTemplateKey="estetica"
                    appointmentId={appointmentId ?? null}
                    onClose={() => { setShowConsent(false); checkConsent() }}
                    onSave={() => checkConsent()}
                />
            )}
        </div>,
        document.body
    )
}
