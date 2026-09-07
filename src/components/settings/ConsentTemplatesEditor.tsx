import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { toast } from 'react-hot-toast'
import { FileSignature, ChevronDown, ChevronUp, Loader2, Plus, Trash2, RotateCcw, Eye, EyeOff } from 'lucide-react'

// Biblioteca de plantillas de consentimiento — Configuración → Consentimientos.
// Vetly precarga 10 plantillas (seed_consent_templates); acá la clínica las
// edita. Se emiten y firman desde la ficha del paciente y el ingreso de
// estética. Patrón de PriceMatrixEditor.tsx: estado en memoria + guardar por
// plantilla.

type SigMode = 'one_click' | 'typed' | 'drawn'
interface CheckboxDef { key: string; label: string; required?: boolean }

interface Template {
    id: string
    template_key: string
    category: string
    title: string
    body: string
    signature_mode: SigMode
    checkboxes: CheckboxDef[]
    validity_days: number | null
    is_active: boolean
}

const SIG_LABEL: Record<SigMode, string> = {
    one_click: 'Un clic (marcar y aceptar)',
    typed: 'Nombre escrito',
    drawn: 'Firma dibujada',
}

const CATEGORY_LABEL: Record<string, string> = {
    general: 'General', quirurgico: 'Quirúrgico', anestesico: 'Anestésico',
    hospitalizacion: 'Hospitalización', eutanasia: 'Eutanasia', tratamiento: 'Tratamiento',
    estetica: 'Estética', diagnostico: 'Diagnóstico', imagenes: 'Imágenes', no_show: 'Reservas',
}

const uid = () => Math.random().toString(36).slice(2)

export function ConsentTemplatesEditor({ clinicId }: { clinicId: string | undefined }) {
    const [templates, setTemplates] = useState<Template[]>([])
    const [library, setLibrary] = useState<Record<string, Partial<Template>>>({})
    const [loading, setLoading] = useState(true)
    const [expandedId, setExpandedId] = useState<string | null>(null)

    useEffect(() => {
        if (!clinicId) return
        void load()
    }, [clinicId])

    const load = async () => {
        if (!clinicId) return
        setLoading(true)
        const [{ data: tpl }, { data: lib }] = await Promise.all([
            (supabase as any).from('consent_templates')
                .select('id, template_key, category, title, body, signature_mode, checkboxes, validity_days, is_active')
                .eq('clinic_id', clinicId)
                .order('category', { ascending: true }),
            (supabase as any).rpc('get_consent_template_library'),
        ])
        setTemplates((tpl || []).map((t: any) => ({ ...t, checkboxes: Array.isArray(t.checkboxes) ? t.checkboxes : [] })))
        const libMap: Record<string, Partial<Template>> = {}
        for (const l of (lib || [])) libMap[l.template_key] = l
        setLibrary(libMap)
        setLoading(false)
    }

    const patch = (id: string, p: Partial<Template>) =>
        setTemplates(ts => ts.map(t => t.id === id ? { ...t, ...p } : t))

    const save = async (t: Template) => {
        const { error } = await (supabase as any).from('consent_templates').update({
            title: t.title.trim(),
            body: t.body,
            signature_mode: t.signature_mode,
            checkboxes: t.checkboxes.filter(c => c.key.trim() && c.label.trim()),
            validity_days: t.validity_days || null,
            is_active: t.is_active,
        }).eq('id', t.id)
        if (error) { toast.error('No se pudo guardar la plantilla.'); return }
        toast.success('Plantilla guardada.')
    }

    const restore = (t: Template) => {
        const lib = library[t.template_key]
        if (!lib) { toast.error('No hay texto recomendado para esta plantilla.'); return }
        if (!confirm(`Restaurar el texto recomendado de "${t.title}"? Perderás tus cambios en el cuerpo.`)) return
        patch(t.id, {
            body: lib.body ?? t.body,
            checkboxes: (lib.checkboxes as CheckboxDef[]) ?? t.checkboxes,
            signature_mode: (lib.signature_mode as SigMode) ?? t.signature_mode,
        })
        toast.success('Texto recomendado cargado. Recuerda guardar.')
    }

    const seedMissing = async () => {
        if (!clinicId) return
        const { data, error } = await (supabase as any).rpc('seed_consent_templates', { p_clinic_id: clinicId })
        if (error) { toast.error('No se pudieron cargar las plantillas.'); return }
        toast.success(data > 0 ? `${data} plantilla(s) agregada(s).` : 'Ya tienes todas las plantillas.')
        await load()
    }

    if (!clinicId) return null

    return (
        <div className="card-soft p-4 sm:p-6">
            <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
                <div>
                    <h2 className="text-lg font-semibold text-charcoal flex items-center gap-2">
                        <FileSignature className="w-5 h-5 text-primary-500" />
                        Plantillas de consentimiento
                    </h2>
                    <p className="text-sm text-charcoal/50 mt-1 max-w-xl">
                        Edita el texto de cada consentimiento. Se emiten y se firman por enlace desde la ficha
                        del paciente. Placeholders disponibles:
                        <code className="mx-1 px-1 bg-ivory rounded">{'{tutor}'}</code>
                        <code className="mx-1 px-1 bg-ivory rounded">{'{paciente}'}</code>
                        <code className="mx-1 px-1 bg-ivory rounded">{'{clinica}'}</code>
                        <code className="mx-1 px-1 bg-ivory rounded">{'{servicio}'}</code>
                        <code className="mx-1 px-1 bg-ivory rounded">{'{fecha}'}</code>
                    </p>
                </div>
                <button onClick={seedMissing} className="btn-ghost flex items-center gap-2 text-primary-500 text-sm">
                    <Plus className="w-4 h-4" /> Restaurar biblioteca
                </button>
            </div>

            {loading ? (
                <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary-500" /></div>
            ) : templates.length === 0 ? (
                <p className="text-sm text-charcoal/40 italic py-4">
                    No hay plantillas. Toca "Restaurar biblioteca" para cargar las 10 plantillas recomendadas.
                </p>
            ) : (
                <div className="space-y-2">
                    {templates.map((t) => (
                        <div key={t.id} className="border border-silk-beige rounded-soft overflow-hidden">
                            <div className="flex items-center gap-2 px-4 py-3 bg-ivory/50">
                                <button onClick={() => setExpandedId(expandedId === t.id ? null : t.id)} className="flex items-center gap-2 text-left flex-1 min-w-0">
                                    {expandedId === t.id ? <ChevronUp className="w-4 h-4 text-charcoal/40 shrink-0" /> : <ChevronDown className="w-4 h-4 text-charcoal/40 shrink-0" />}
                                    <span className="font-semibold text-charcoal text-sm truncate">{t.title}</span>
                                    <span className="text-[10px] uppercase tracking-wider text-charcoal/40 shrink-0">{CATEGORY_LABEL[t.category] || t.category}</span>
                                </button>
                                {!t.is_active && <span className="text-[10px] uppercase font-bold text-charcoal/30 flex items-center gap-1"><EyeOff className="w-3 h-3" /> Oculta</span>}
                            </div>
                            {expandedId === t.id && (
                                <div className="p-4 space-y-3 bg-white">
                                    <div>
                                        <label className="text-xs font-bold text-charcoal/60">Título</label>
                                        <input value={t.title} onChange={e => patch(t.id, { title: e.target.value })} className="input-soft w-full mt-1" />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-charcoal/60">Texto del consentimiento</label>
                                        <textarea value={t.body} onChange={e => patch(t.id, { body: e.target.value })} rows={12} className="input-soft w-full mt-1 font-mono text-xs leading-relaxed resize-y" />
                                    </div>
                                    <div className="grid sm:grid-cols-2 gap-3">
                                        <div>
                                            <label className="text-xs font-bold text-charcoal/60">Modo de firma</label>
                                            <select value={t.signature_mode} onChange={e => patch(t.id, { signature_mode: e.target.value as SigMode })} className="input-soft w-full mt-1">
                                                {(['one_click', 'typed', 'drawn'] as SigMode[]).map(m => <option key={m} value={m}>{SIG_LABEL[m]}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-charcoal/60">Vence a los (días)</label>
                                            <input type="number" value={t.validity_days ?? ''} onChange={e => patch(t.id, { validity_days: e.target.value ? Number(e.target.value) : null })} placeholder="No vence" className="input-soft w-full mt-1" />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="text-xs font-bold text-charcoal/60 mb-1 block">Casillas adicionales (opcional)</label>
                                        {t.checkboxes.map((cb, i) => (
                                            <div key={i} className="flex items-center gap-2 mb-2">
                                                <input placeholder="Texto de la casilla" value={cb.label}
                                                    onChange={e => patch(t.id, { checkboxes: t.checkboxes.map((x, j) => j === i ? { ...x, label: e.target.value, key: x.key || e.target.value.toLowerCase().replace(/\s+/g, '_').slice(0, 40) } : x) })}
                                                    className="input-soft py-1 text-xs flex-1" />
                                                <label className="flex items-center gap-1 text-[11px] text-charcoal/60 shrink-0">
                                                    <input type="checkbox" checked={!!cb.required} onChange={e => patch(t.id, { checkboxes: t.checkboxes.map((x, j) => j === i ? { ...x, required: e.target.checked } : x) })} />
                                                    Obligatoria
                                                </label>
                                                <button onClick={() => patch(t.id, { checkboxes: t.checkboxes.filter((_, j) => j !== i) })} className="p-1 text-charcoal/30 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                                            </div>
                                        ))}
                                        <button onClick={() => patch(t.id, { checkboxes: [...t.checkboxes, { key: uid(), label: '', required: false }] })} className="text-xs text-primary-600 font-bold flex items-center gap-1">
                                            <Plus className="w-3.5 h-3.5" /> Agregar casilla
                                        </button>
                                    </div>

                                    <label className="flex items-center gap-2 text-sm text-charcoal/70">
                                        <input type="checkbox" checked={t.is_active} onChange={e => patch(t.id, { is_active: e.target.checked })} />
                                        <Eye className="w-3.5 h-3.5" /> Disponible al emitir
                                    </label>

                                    <div className="flex items-center justify-between pt-2 border-t border-silk-beige">
                                        <button onClick={() => restore(t)} className="text-xs text-charcoal/50 hover:text-primary-600 font-bold flex items-center gap-1.5">
                                            <RotateCcw className="w-3.5 h-3.5" /> Restaurar texto recomendado
                                        </button>
                                        <button onClick={() => save(t)} className="btn-primary py-1.5 px-4 text-sm">Guardar</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
