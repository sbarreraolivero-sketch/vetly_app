import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { toast } from 'react-hot-toast'
import { Scissors, ChevronDown, ChevronUp, Loader2, Plus, Trash2 } from 'lucide-react'
import { COAT_TYPES, SIZE_CATEGORIES, SIZE_LABEL } from '@/services/groomingService'

// Reglas de precio por servicio de estética: talla / pelaje / rango de peso /
// raza. Se resuelve de más específico a menos (breed > talla > pelaje > peso).
// Mismo patrón de "guardar todo" que PriceMatrixEditor.

const COAT_LABEL: Record<string, string> = {
    corto: 'Corto', medio: 'Medio', largo: 'Largo', doble: 'Doble', rizado: 'Rizado', sin_pelo: 'Sin pelo',
}

interface Rule {
    localId: string
    size_category?: string
    coat_type?: string
    weight_min?: number
    weight_max?: number
    breed?: string
    price?: number
}

const uid = () => Math.random().toString(36).slice(2)

export function GroomingPriceEditor({ clinicId, groomingServices = [] }: {
    clinicId: string | undefined
    groomingServices?: { id: string; name: string }[]
}) {
    const [expandedId, setExpandedId] = useState<string | null>(null)

    if (!clinicId) return null

    return (
        <div className="card-soft p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-charcoal flex items-center gap-2">
                <Scissors className="w-5 h-5 text-primary-500" /> Reglas de precio de estética
            </h2>
            <p className="text-sm text-charcoal/50 mt-1 mb-4">
                Para cada servicio de estética, define el precio según talla, tipo de pelaje, peso o raza.
                Sin reglas, se usa el precio fijo del servicio.
            </p>
            {groomingServices.length === 0 ? (
                <p className="text-sm text-charcoal/40 bg-ivory/60 border border-silk-beige rounded-soft px-4 py-6 text-center">
                    Aún no tienes servicios de estética. Crea uno más abajo con el tipo
                    <span className="font-semibold text-charcoal/60"> «Estética» </span>
                    y aparecerá aquí para configurar su precio por talla, pelaje o raza.
                </p>
            ) : (
            <div className="space-y-2">
                {groomingServices.map(s => (
                    <div key={s.id} className="border border-silk-beige rounded-soft overflow-hidden">
                        <button onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                            className="w-full flex items-center gap-2 px-4 py-3 bg-ivory/50 text-left">
                            {expandedId === s.id ? <ChevronUp className="w-4 h-4 text-charcoal/40" /> : <ChevronDown className="w-4 h-4 text-charcoal/40" />}
                            <span className="font-semibold text-charcoal text-sm">{s.name}</span>
                        </button>
                        {expandedId === s.id && <RulesEditor serviceId={s.id} />}
                    </div>
                ))}
            </div>
            )}
        </div>
    )
}

function RulesEditor({ serviceId }: { serviceId: string }) {
    const [rules, setRules] = useState<Rule[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        ;(async () => {
            setLoading(true)
            const { data } = await (supabase as any)
                .from('grooming_price_rules').select('*').eq('service_id', serviceId)
            setRules((data as any[] || []).map((r: any) => ({
                localId: uid(),
                size_category: r.size_category || undefined,
                coat_type: r.coat_type || undefined,
                weight_min: r.weight_min ?? undefined,
                weight_max: r.weight_max ?? undefined,
                breed: r.breed || undefined,
                price: r.price ?? undefined,
            })))
            setLoading(false)
        })()
    }, [serviceId])

    const patch = (localId: string, p: Partial<Rule>) => setRules(rs => rs.map(r => r.localId === localId ? { ...r, ...p } : r))

    const save = async () => {
        setSaving(true)
        try {
            const payload = rules
                .filter(r => r.price !== undefined && r.price !== null)
                .map(r => ({
                    size_category: r.size_category || '',
                    coat_type: r.coat_type || '',
                    weight_min: r.weight_min ?? null,
                    weight_max: r.weight_max ?? null,
                    breed: r.breed || '',
                    price: r.price,
                }))
            const { error } = await (supabase as any).rpc('replace_grooming_price_rules', { p_service_id: serviceId, p_rules: payload })
            if (error) throw error
            toast.success('Reglas guardadas')
        } catch (e: any) {
            toast.error(e.message || 'No se pudo guardar')
        } finally {
            setSaving(false)
        }
    }

    if (loading) return <div className="p-4 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-primary-500" /></div>

    return (
        <div className="p-4 bg-white space-y-3">
            <div className="overflow-x-auto">
                <table className="w-full text-xs">
                    <thead>
                        <tr className="text-left text-[10px] font-bold text-charcoal/50 uppercase tracking-wider">
                            <th className="pb-2 pr-2">Talla</th>
                            <th className="pb-2 pr-2">Pelaje</th>
                            <th className="pb-2 pr-2">Peso min</th>
                            <th className="pb-2 pr-2">Peso max</th>
                            <th className="pb-2 pr-2">Raza (opcional)</th>
                            <th className="pb-2 pr-2">Precio</th>
                            <th className="pb-2"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {rules.map(r => (
                            <tr key={r.localId} className="border-t border-silk-beige/50">
                                <td className="py-1.5 pr-2">
                                    <select value={r.size_category || ''} onChange={e => patch(r.localId, { size_category: e.target.value || undefined })} className="input-soft py-1 text-xs">
                                        <option value="">—</option>
                                        {SIZE_CATEGORIES.map(s => <option key={s} value={s}>{SIZE_LABEL[s]}</option>)}
                                    </select>
                                </td>
                                <td className="py-1.5 pr-2">
                                    <select value={r.coat_type || ''} onChange={e => patch(r.localId, { coat_type: e.target.value || undefined })} className="input-soft py-1 text-xs">
                                        <option value="">—</option>
                                        {COAT_TYPES.map(c => <option key={c} value={c}>{COAT_LABEL[c]}</option>)}
                                    </select>
                                </td>
                                <td className="py-1.5 pr-2"><input type="number" value={r.weight_min ?? ''} onChange={e => patch(r.localId, { weight_min: e.target.value ? Number(e.target.value) : undefined })} className="input-soft py-1 text-xs w-16" /></td>
                                <td className="py-1.5 pr-2"><input type="number" value={r.weight_max ?? ''} onChange={e => patch(r.localId, { weight_max: e.target.value ? Number(e.target.value) : undefined })} className="input-soft py-1 text-xs w-16" /></td>
                                <td className="py-1.5 pr-2"><input value={r.breed || ''} onChange={e => patch(r.localId, { breed: e.target.value || undefined })} className="input-soft py-1 text-xs w-28" /></td>
                                <td className="py-1.5 pr-2"><input type="number" value={r.price ?? ''} onChange={e => patch(r.localId, { price: e.target.value ? Number(e.target.value) : undefined })} className="input-soft py-1 text-xs w-24" /></td>
                                <td className="py-1.5"><button onClick={() => setRules(rs => rs.filter(x => x.localId !== r.localId))} className="p-1 text-charcoal/30 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <button onClick={() => setRules(rs => [...rs, { localId: uid() }])} className="text-xs text-primary-600 font-bold flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" /> Agregar regla
            </button>
            <div className="flex justify-end pt-2 border-t border-silk-beige">
                <button onClick={save} disabled={saving} className="btn-primary py-1.5 px-4 text-sm disabled:opacity-50">
                    {saving ? 'Guardando…' : 'Guardar reglas'}
                </button>
            </div>
        </div>
    )
}
