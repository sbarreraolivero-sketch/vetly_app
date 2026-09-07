import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2, FileSignature, Send, MessageCircle, Mail, PenLine, Check } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Patient, Tutor } from '@/types/database'
import { toast } from 'react-hot-toast'

interface CheckboxDef { key: string; label: string; required?: boolean }
interface ConsentTemplate {
    id: string
    template_key: string
    title: string
    body: string
    signature_mode: 'one_click' | 'typed' | 'drawn'
    checkboxes: CheckboxDef[]
    validity_days: number | null
    updated_at: string
}

interface ConsentFormProps {
    patient: Patient
    tutor?: Tutor | null
    initialTemplateKey?: string
    appointmentId?: string | null
    serviceName?: string | null
    onClose: () => void
    onSave: () => void
}

const resolvePlaceholders = (body: string, ctx: Record<string, string>): string =>
    body
        .replace(/\{tutor\}/g, ctx.tutor || 'el tutor')
        .replace(/\{paciente\}/g, ctx.paciente || 'la mascota')
        .replace(/\{clinica\}/g, ctx.clinica || 'la clínica')
        .replace(/\{servicio\}/g, ctx.servicio || 'el servicio indicado')
        .replace(/\{fecha\}/g, ctx.fecha || '')

export function ConsentForm({ patient, tutor, initialTemplateKey, appointmentId, serviceName, onClose, onSave }: ConsentFormProps) {
    const { profile } = useAuth()
    const [templates, setTemplates] = useState<ConsentTemplate[]>([])
    const [clinicName, setClinicName] = useState('')
    const [loading, setLoading] = useState(true)
    const [selectedKey, setSelectedKey] = useState<string>('')
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [created, setCreated] = useState<{ id: string; token: string } | null>(null)
    const [sending, setSending] = useState<string | null>(null)

    useEffect(() => {
        ;(async () => {
            const [{ data: tpl }, { data: clinic }] = await Promise.all([
                (supabase as any).from('consent_templates')
                    .select('id, template_key, title, body, signature_mode, checkboxes, validity_days, updated_at')
                    .eq('clinic_id', patient.clinic_id)
                    .eq('is_active', true)
                    .order('category', { ascending: true }),
                (supabase as any).from('clinic_settings').select('clinic_name').eq('id', patient.clinic_id).maybeSingle(),
            ])
            const list = (tpl || []).map((t: any) => ({ ...t, checkboxes: Array.isArray(t.checkboxes) ? t.checkboxes : [] }))
            setTemplates(list)
            setClinicName(clinic?.clinic_name || '')
            setSelectedKey(
                initialTemplateKey && list.some((t: ConsentTemplate) => t.template_key === initialTemplateKey)
                    ? initialTemplateKey
                    : (list[0]?.template_key || '')
            )
            setLoading(false)
        })()
    }, [patient.clinic_id, initialTemplateKey])

    const selected = useMemo(() => templates.find(t => t.template_key === selectedKey) || null, [templates, selectedKey])

    const resolvedBody = useMemo(() => {
        if (!selected) return ''
        return resolvePlaceholders(selected.body, {
            tutor: tutor?.name || '',
            paciente: patient.name || '',
            clinica: clinicName,
            servicio: serviceName || '',
            fecha: new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' }),
        })
    }, [selected, tutor, patient, clinicName, serviceName])

    const handleCreate = async () => {
        if (!selected) return
        setError(null)
        setSaving(true)
        try {
            const insert = {
                clinic_id: patient.clinic_id,
                patient_id: patient.id,
                tutor_id: tutor?.id ?? null,
                appointment_id: appointmentId ?? null,
                template_key: selected.template_key,
                template_title: selected.title,
                template_body: resolvedBody,
                template_version_at: selected.updated_at,
                checkboxes: selected.checkboxes,
                patient_snapshot: {
                    name: patient.name, species: patient.species, breed: patient.breed,
                    sex: patient.sex, dob: patient.dob,
                },
                tutor_name: tutor?.name ?? null,
                required_signature_mode: selected.signature_mode,
                created_by: profile?.id ?? null,
            }
            const { data, error: insErr } = await (supabase as any)
                .from('consent_records').insert([insert]).select('id, public_token').single()
            if (insErr) throw insErr
            setCreated({ id: data.id, token: data.public_token })
            onSave()
        } catch (e: any) {
            setError(e.message || 'No se pudo crear el consentimiento.')
        } finally {
            setSaving(false)
        }
    }

    const handleSend = async (channel: 'whatsapp' | 'email') => {
        if (!created) return
        setSending(channel)
        try {
            const { data, error: fnErr } = await supabase.functions.invoke('send-consent', {
                body: { consent_id: created.id, channel },
            })
            if (fnErr) throw fnErr
            if (!(data as any)?.success) throw new Error((data as any)?.error || 'No se pudo enviar.')
            toast.success(channel === 'whatsapp' ? 'Enviado por WhatsApp' : 'Enviado por correo')
        } catch (e: any) {
            toast.error(e?.message || 'No se pudo enviar.')
        } finally {
            setSending(null)
        }
    }

    return createPortal(
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[99999] animate-fade-in p-4 backdrop-blur-sm">
            <div className="bg-white rounded-soft w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
                <div className="p-6 border-b border-silk-beige flex items-center justify-between bg-primary-50/50 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
                            <FileSignature className="w-5 h-5 text-primary-600" />
                        </div>
                        <div>
                            <h3 className="font-bold text-charcoal">Emitir consentimiento</h3>
                            <p className="text-xs text-charcoal/50">{patient.name}{tutor?.name ? ` — ${tutor.name}` : ''}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1.5 hover:bg-silk-beige rounded-lg"><X className="w-5 h-5 text-charcoal/60" /></button>
                </div>

                <div className="p-6 overflow-y-auto flex-1 space-y-4">
                    {loading ? (
                        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary-500" /></div>
                    ) : templates.length === 0 ? (
                        <p className="text-sm text-charcoal/50">
                            No hay plantillas activas. Configúralas en Configuración → Consentimientos.
                        </p>
                    ) : created ? (
                        <div className="space-y-4">
                            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center gap-2">
                                <Check className="w-4 h-4" /> Consentimiento creado. Ahora envíalo o fírmalo en este dispositivo.
                            </div>
                            <div className="grid sm:grid-cols-3 gap-2">
                                <button onClick={() => handleSend('whatsapp')} disabled={sending !== null}
                                    className="flex items-center justify-center gap-2 py-2.5 rounded-xl border border-silk-beige text-sm font-bold text-charcoal/70 hover:border-emerald-300 hover:text-emerald-600 disabled:opacity-40">
                                    {sending === 'whatsapp' ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />} WhatsApp
                                </button>
                                <button onClick={() => handleSend('email')} disabled={sending !== null || !tutor?.email}
                                    title={tutor?.email ? '' : 'El tutor no tiene correo'}
                                    className="flex items-center justify-center gap-2 py-2.5 rounded-xl border border-silk-beige text-sm font-bold text-charcoal/70 hover:border-primary-300 hover:text-primary-600 disabled:opacity-40">
                                    {sending === 'email' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />} Correo
                                </button>
                                <a href={`/consentimiento/${created.token}`} target="_blank" rel="noopener"
                                    className="flex items-center justify-center gap-2 py-2.5 rounded-xl border border-silk-beige text-sm font-bold text-charcoal/70 hover:border-primary-300 hover:text-primary-600">
                                    <PenLine className="w-4 h-4" /> Firmar aquí
                                </a>
                            </div>
                            <button onClick={onClose} className="w-full py-2.5 rounded-xl bg-charcoal/5 text-sm font-bold text-charcoal/60 hover:bg-charcoal/10">Cerrar</button>
                        </div>
                    ) : (
                        <>
                            <div>
                                <label className="text-xs font-bold text-charcoal/60">Plantilla</label>
                                <select value={selectedKey} onChange={e => setSelectedKey(e.target.value)} className="input-soft w-full mt-1">
                                    {templates.map(t => <option key={t.template_key} value={t.template_key}>{t.title}</option>)}
                                </select>
                            </div>
                            {selected && (
                                <div>
                                    <p className="text-xs font-bold text-charcoal/60 mb-1">
                                        Vista previa · firma: {selected.signature_mode === 'drawn' ? 'dibujada' : selected.signature_mode === 'typed' ? 'nombre escrito' : 'un clic'}
                                    </p>
                                    <div className="p-4 rounded-xl bg-ivory/60 border border-silk-beige max-h-64 overflow-y-auto text-sm text-charcoal/80 whitespace-pre-wrap leading-relaxed">
                                        {resolvedBody}
                                    </div>
                                    {(selected.checkboxes || []).length > 0 && (
                                        <ul className="mt-2 text-xs text-charcoal/50 list-disc list-inside">
                                            {selected.checkboxes.map(c => <li key={c.key}>{c.label}{c.required ? ' (obligatoria)' : ''}</li>)}
                                        </ul>
                                    )}
                                </div>
                            )}
                            {error && <p className="text-sm text-red-600">{error}</p>}
                        </>
                    )}
                </div>

                {!loading && !created && templates.length > 0 && (
                    <div className="p-4 border-t border-silk-beige flex justify-end gap-2 shrink-0">
                        <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-bold text-charcoal/60 hover:bg-charcoal/5">Cancelar</button>
                        <button onClick={handleCreate} disabled={saving || !selected}
                            className="btn-primary flex items-center gap-2 disabled:opacity-50">
                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Crear
                        </button>
                    </div>
                )}
            </div>
        </div>,
        document.body
    )
}
