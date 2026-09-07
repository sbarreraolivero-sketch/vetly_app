import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { toast } from 'react-hot-toast'
import { Scissors, Loader2, Save, AlertTriangle } from 'lucide-react'
import { groomingService, COAT_TYPES, SIZE_CATEGORIES, TEMPERAMENTS, SIZE_LABEL, TEMPERAMENT_LABEL, type GroomingProfile } from '@/services/groomingService'
import { PhotoUpload } from '@/components/patients/PhotoUpload'

const COAT_LABEL: Record<string, string> = {
    corto: 'Corto', medio: 'Medio', largo: 'Largo', doble: 'Doble capa', rizado: 'Rizado', sin_pelo: 'Sin pelo',
}

interface Props {
    patientId: string
    clinicId: string
    patientBreed?: string | null
    patientWeight?: number | null
}

const empty = (patientId: string, clinicId: string): GroomingProfile => ({
    patient_id: patientId, clinic_id: clinicId,
    coat_type: null, coat_length: null, size_category: null, preferred_cut: null,
    cut_reference_photo_url: null, products_notes: null, product_allergies: null,
    temperament: null, handling_notes: null, matting_policy_ack: false, medical_alerts: null,
})

export function GroomingProfileCard({ patientId, clinicId }: Props) {
    const [profile, setProfile] = useState<GroomingProfile>(empty(patientId, clinicId))
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [refPhoto, setRefPhoto] = useState<File | null>(null)

    useEffect(() => {
        ;(async () => {
            setLoading(true)
            const p = await groomingService.getProfile(patientId)
            setProfile(p ? { ...empty(patientId, clinicId), ...p } : empty(patientId, clinicId))
            setLoading(false)
        })()
    }, [patientId, clinicId])

    const set = (k: keyof GroomingProfile, v: any) => setProfile(p => ({ ...p, [k]: v }))

    const save = async () => {
        setSaving(true)
        try {
            let refUrl = profile.cut_reference_photo_url
            if (refPhoto) {
                const ext = refPhoto.name.split('.').pop() || 'jpg'
                const path = `${clinicId}/${patientId}/grooming/reference-${Date.now()}.${ext}`
                const { error } = await supabase.storage.from('patient-documents').upload(path, refPhoto, { upsert: true })
                if (error) throw error
                refUrl = supabase.storage.from('patient-documents').getPublicUrl(path).data.publicUrl
            }
            await groomingService.upsertProfile({ ...profile, cut_reference_photo_url: refUrl })
            setProfile(p => ({ ...p, cut_reference_photo_url: refUrl }))
            setRefPhoto(null)
            toast.success('Ficha de estética guardada')
        } catch (e: any) {
            toast.error(e.message || 'No se pudo guardar')
        } finally {
            setSaving(false)
        }
    }

    if (loading) {
        return <div className="bg-white p-8 rounded-soft border border-silk-beige flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary-500" /></div>
    }

    return (
        <div className="bg-white p-5 rounded-soft border border-silk-beige shadow-sm space-y-4">
            <div className="flex items-center gap-2">
                <Scissors className="w-5 h-5 text-primary-500" />
                <h3 className="font-bold text-charcoal uppercase tracking-tighter">Ficha de estética</h3>
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
                <div>
                    <label className="text-xs font-bold text-charcoal/60">Tipo de pelaje</label>
                    <select value={profile.coat_type ?? ''} onChange={e => set('coat_type', e.target.value || null)} className="input-soft w-full mt-1">
                        <option value="">—</option>
                        {COAT_TYPES.map(c => <option key={c} value={c}>{COAT_LABEL[c]}</option>)}
                    </select>
                </div>
                <div>
                    <label className="text-xs font-bold text-charcoal/60">Talla</label>
                    <select value={profile.size_category ?? ''} onChange={e => set('size_category', e.target.value || null)} className="input-soft w-full mt-1">
                        <option value="">—</option>
                        {SIZE_CATEGORIES.map(s => <option key={s} value={s}>{SIZE_LABEL[s]}</option>)}
                    </select>
                </div>
                <div>
                    <label className="text-xs font-bold text-charcoal/60">Largo del pelo</label>
                    <input value={profile.coat_length ?? ''} onChange={e => set('coat_length', e.target.value)} placeholder="ej. #3 en el cuerpo" className="input-soft w-full mt-1" />
                </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
                <div>
                    <label className="text-xs font-bold text-charcoal/60">Corte preferido</label>
                    <textarea value={profile.preferred_cut ?? ''} onChange={e => set('preferred_cut', e.target.value)} rows={2} className="input-soft w-full mt-1 resize-y" placeholder="Cómo le gusta el corte al tutor" />
                </div>
                <div>
                    <PhotoUpload
                        selectedFile={refPhoto}
                        onFileSelect={setRefPhoto}
                        onClear={() => setRefPhoto(null)}
                    />
                    {!refPhoto && profile.cut_reference_photo_url && (
                        <img src={profile.cut_reference_photo_url} alt="Referencia" className="mt-2 h-24 rounded-lg border border-silk-beige object-cover" />
                    )}
                </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
                <div>
                    <label className="text-xs font-bold text-charcoal/60">Temperamento en el baño</label>
                    <select value={profile.temperament ?? ''} onChange={e => set('temperament', e.target.value || null)} className="input-soft w-full mt-1">
                        <option value="">—</option>
                        {TEMPERAMENTS.map(t => <option key={t} value={t}>{TEMPERAMENT_LABEL[t]}</option>)}
                    </select>
                </div>
                <div>
                    <label className="text-xs font-bold text-charcoal/60">Notas de manejo</label>
                    <input value={profile.handling_notes ?? ''} onChange={e => set('handling_notes', e.target.value)} className="input-soft w-full mt-1" placeholder="ej. no le gusta el secador de pie" />
                </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
                <div>
                    <label className="text-xs font-bold text-charcoal/60">Productos / champú especial</label>
                    <input value={profile.products_notes ?? ''} onChange={e => set('products_notes', e.target.value)} className="input-soft w-full mt-1" />
                </div>
                <div>
                    <label className="text-xs font-bold text-charcoal/60">Alergias a productos</label>
                    <input value={profile.product_allergies ?? ''} onChange={e => set('product_allergies', e.target.value)} className="input-soft w-full mt-1" />
                </div>
            </div>

            <div>
                <label className="text-xs font-bold text-charcoal/60 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> Alertas médicas para el baño</label>
                <input value={profile.medical_alerts ?? ''} onChange={e => set('medical_alerts', e.target.value)} className="input-soft w-full mt-1" placeholder="ej. senior, soplo cardíaco, epilepsia" />
            </div>

            <label className="flex items-center gap-2 text-sm text-charcoal/70">
                <input type="checkbox" checked={profile.matting_policy_ack} onChange={e => set('matting_policy_ack', e.target.checked)} />
                El tutor aceptó la política de rapado por nudos severos
            </label>

            <div className="flex justify-end pt-2 border-t border-silk-beige">
                <button onClick={save} disabled={saving} className="btn-primary flex items-center gap-2 disabled:opacity-50">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar
                </button>
            </div>
        </div>
    )
}
