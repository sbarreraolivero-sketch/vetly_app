import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { toast } from 'react-hot-toast'
import { DollarSign, Plus, Trash2, Loader2, ChevronDown, ChevronUp, Sparkles, AlertTriangle } from 'lucide-react'

// Matrices de precio — reemplaza el hardcode de precios que dependen de
// especie/sexo/peso/tramo/anestesia (antes una tabla de texto que la IA leía
// a mano, causa confirmada de 3 cotizaciones incorrectas reales). Cada
// clínica configura sus propias matrices acá, sin código ni deploy nuevo — el
// agente las consulta vía la función `calculate_matrix_price`.
//
// Mismo patrón que "Logística Pro" en KnowledgeBase.tsx: estado anidado en
// memoria + tabla editable con inputs inline + un botón único "Guardar" que
// reemplaza el set completo (acá vía la RPC replace_price_matrix).

type Dimensions = {
    species?: boolean
    sex?: boolean
    procedure_type?: boolean
    anesthesia_type?: boolean
    tramo?: boolean
    weight_by_species?: string[]
}

interface MatrixMeta {
    id: string
    matrix_key: string
    label: string
    dimensions_used: Dimensions
    tramo_ranges: { key: string; max_minutes: number }[] | null
    status: string
}

interface CellRow {
    localId: string
    species?: string
    sex?: string
    procedure_type?: string
    anesthesia_type?: string
    weight_min?: number
    weight_max?: number
    price?: number
    price_t1?: number
    price_t2?: number
    price_t3?: number
    requires_human?: boolean
}

interface ModifierRow {
    localId: string
    key: string
    label: string
    amount: number
    applies_when: Record<string, string>
}

const PRESETS: { name: string; dimensions: Dimensions; tramo_ranges: MatrixMeta['tramo_ranges'] }[] = [
    {
        name: 'Cirugía simple (especie/sexo/peso/tramo)',
        dimensions: { species: true, sex: true, weight_by_species: ['perro'], tramo: true },
        tramo_ranges: [{ key: 'T1', max_minutes: 25 }, { key: 'T2', max_minutes: 35 }, { key: 'T3', max_minutes: 45 }],
    },
    {
        name: 'Cirugía con anestesia (especie/sexo/procedimiento/anestesia/peso)',
        dimensions: { species: true, sex: true, procedure_type: true, anesthesia_type: true, weight_by_species: ['perro'] },
        tramo_ranges: null,
    },
    {
        name: 'Destartraje simple (especie/peso)',
        dimensions: { species: true, weight_by_species: ['perro'] },
        tramo_ranges: null,
    },
    {
        name: 'Destartraje con anestesia (especie/peso/anestesia)',
        dimensions: { species: true, weight_by_species: ['perro'], anesthesia_type: true },
        tramo_ranges: null,
    },
]

const SPECIES_OPTS = ['perro', 'gato']
const SEX_OPTS = ['hembra', 'macho']
const PROCEDURE_OPTS = ['esterilizacion', 'castracion', 'criptorquideo']
const ANESTHESIA_OPTS = ['inyectable', 'inhalatoria']

const uid = () => Math.random().toString(36).slice(2)
const money = (n: number | undefined) => n === undefined || n === null ? '' : n.toString()

export function PriceMatrixEditor({ clinicId }: { clinicId: string | undefined }) {
    const [matrices, setMatrices] = useState<MatrixMeta[]>([])
    const [loading, setLoading] = useState(true)
    const [expandedId, setExpandedId] = useState<string | null>(null)
    const [showPresets, setShowPresets] = useState(false)

    useEffect(() => {
        if (!clinicId) return
        loadMatrices()
    }, [clinicId])

    const loadMatrices = async () => {
        if (!clinicId) return
        setLoading(true)
        const { data, error } = await (supabase as any)
            .from('clinic_price_matrices')
            .select('id, matrix_key, label, dimensions_used, tramo_ranges, status')
            .eq('clinic_id', clinicId)
            .eq('status', 'active')
            .order('created_at', { ascending: true })
        if (!error) setMatrices(data || [])
        setLoading(false)
    }

    const createFromPreset = async (preset: typeof PRESETS[number]) => {
        if (!clinicId) return
        const label = prompt('Nombre de la matriz (ej. "Cirugía Esterilización/Castración"):', preset.name.split(' (')[0])
        if (!label) return
        const matrixKey = prompt(
            'Clave técnica (matrix_key) — la usa el agente de IA, sin espacios ni tildes:',
            label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
        )
        if (!matrixKey) return
        const { error } = await (supabase as any).from('clinic_price_matrices').insert({
            clinic_id: clinicId, matrix_key: matrixKey, label,
            dimensions_used: preset.dimensions, tramo_ranges: preset.tramo_ranges,
        })
        if (error) {
            toast.error(error.message?.includes('duplicate') ? 'Ya existe una matriz con esa clave en esta clínica.' : 'Error al crear la matriz.')
            return
        }
        toast.success('Matriz creada — agrégale filas de precio.')
        setShowPresets(false)
        await loadMatrices()
    }

    const deleteMatrix = async (m: MatrixMeta) => {
        if (!confirm(`¿Eliminar la matriz "${m.label}"? Los servicios que la usen quedarán sin precio hasta que elijas otra.`)) return
        const { error } = await (supabase as any).from('clinic_price_matrices').delete().eq('id', m.id)
        if (error) { toast.error('Error al eliminar.'); return }
        toast.success('Matriz eliminada.')
        await loadMatrices()
    }

    if (!clinicId) return null

    return (
        <div className="card-soft p-4 sm:p-6">
            <div className="flex items-center justify-between mb-2">
                <div>
                    <h2 className="text-lg font-semibold text-charcoal flex items-center gap-2">
                        <DollarSign className="w-5 h-5 text-primary-500" />
                        Matrices de Precio
                    </h2>
                    <p className="text-sm text-charcoal/50 mt-1">
                        Para servicios cuyo precio depende de especie, sexo, peso, tipo de anestesia o distancia —
                        el agente de IA consulta esto en vez de calcular a mano.
                    </p>
                </div>
                <button onClick={() => setShowPresets(v => !v)} className="btn-ghost flex items-center gap-2 text-primary-500">
                    <Plus className="w-4 h-4" /> Nueva matriz
                </button>
            </div>

            {showPresets && (
                <div className="mb-6 p-4 bg-ivory rounded-soft border border-silk-beige space-y-2">
                    <p className="text-xs font-bold text-charcoal/60 uppercase tracking-wider flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-primary-500" /> Elige el tipo de matriz
                    </p>
                    {PRESETS.map((p) => (
                        <button
                            key={p.name}
                            onClick={() => createFromPreset(p)}
                            className="w-full text-left px-4 py-2.5 rounded-soft border border-silk-beige bg-white hover:border-primary-300 hover:shadow-soft-sm transition-all text-sm"
                        >
                            {p.name}
                        </button>
                    ))}
                </div>
            )}

            {loading ? (
                <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary-500" /></div>
            ) : matrices.length === 0 ? (
                <p className="text-sm text-charcoal/40 italic py-4">No hay matrices configuradas todavía. Los servicios con precios simples no necesitan esto.</p>
            ) : (
                <div className="space-y-3">
                    {matrices.map((m) => (
                        <div key={m.id} className="border border-silk-beige rounded-soft overflow-hidden">
                            <div className="flex items-center justify-between px-4 py-3 bg-ivory/50">
                                <button onClick={() => setExpandedId(expandedId === m.id ? null : m.id)} className="flex items-center gap-2 text-left flex-1">
                                    {expandedId === m.id ? <ChevronUp className="w-4 h-4 text-charcoal/40" /> : <ChevronDown className="w-4 h-4 text-charcoal/40" />}
                                    <span className="font-semibold text-charcoal text-sm">{m.label}</span>
                                    <span className="text-xs text-charcoal/40 font-mono">({m.matrix_key})</span>
                                </button>
                                <button onClick={() => deleteMatrix(m)} className="p-1.5 text-charcoal/30 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                            {expandedId === m.id && (
                                <MatrixCellsEditor matrix={m} onSaved={loadMatrices} />
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

function MatrixCellsEditor({ matrix, onSaved }: { matrix: MatrixMeta; onSaved: () => void }) {
    const [rows, setRows] = useState<CellRow[]>([])
    const [modifiers, setModifiers] = useState<ModifierRow[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    const dims = matrix.dimensions_used || {}
    const usesTramo = !!dims.tramo
    const needsWeightFor = dims.weight_by_species || []

    useEffect(() => { loadCells() }, [matrix.id])

    const loadCells = async () => {
        setLoading(true)
        const { data: cells } = await (supabase as any)
            .from('clinic_price_matrix_cells')
            .select('*')
            .eq('matrix_id', matrix.id)
        const { data: mods } = await (supabase as any)
            .from('clinic_price_matrix_modifiers')
            .select('*')
            .eq('matrix_id', matrix.id)

        if (usesTramo) {
            // Agrupa las 3 celdas T1/T2/T3 que comparten las mismas dimensiones
            // en una sola fila de la UI (una fila = una combinación real, con 3
            // precios) — así se guardan como 3 celdas pero se editan como 1 fila.
            const groups = new Map<string, CellRow>()
            for (const c of cells || []) {
                const key = [c.species, c.sex, c.procedure_type, c.anesthesia_type, c.weight_min, c.weight_max].join('|')
                if (!groups.has(key)) {
                    groups.set(key, {
                        localId: uid(), species: c.species, sex: c.sex, procedure_type: c.procedure_type,
                        anesthesia_type: c.anesthesia_type, weight_min: c.weight_min, weight_max: c.weight_max,
                    })
                }
                const row = groups.get(key)!
                if (c.tramo === 'T1') row.price_t1 = c.price
                if (c.tramo === 'T2') row.price_t2 = c.price
                if (c.tramo === 'T3') row.price_t3 = c.price
            }
            setRows(Array.from(groups.values()))
        } else {
            setRows((cells || []).map((c: any) => ({
                localId: uid(), species: c.species, sex: c.sex, procedure_type: c.procedure_type,
                anesthesia_type: c.anesthesia_type, weight_min: c.weight_min, weight_max: c.weight_max,
                price: c.price, requires_human: c.requires_human,
            })))
        }
        setModifiers((mods || []).map((m: any) => ({ localId: uid(), key: m.key, label: m.label, amount: m.amount, applies_when: m.applies_when || {} })))
        setLoading(false)
    }

    const addRow = () => setRows(r => [...r, { localId: uid() }])
    const removeRow = (localId: string) => setRows(r => r.filter(x => x.localId !== localId))
    const updateRow = (localId: string, patch: Partial<CellRow>) =>
        setRows(r => r.map(x => x.localId === localId ? { ...x, ...patch } : x))

    const addModifier = () => setModifiers(m => [...m, { localId: uid(), key: '', label: '', amount: 0, applies_when: {} }])
    const removeModifier = (localId: string) => setModifiers(m => m.filter(x => x.localId !== localId))
    const updateModifier = (localId: string, patch: Partial<ModifierRow>) =>
        setModifiers(m => m.map(x => x.localId === localId ? { ...x, ...patch } : x))

    const handleSave = async () => {
        setSaving(true)
        try {
            const cellsPayload: any[] = []
            for (const r of rows) {
                const base = {
                    species: r.species || null, sex: r.sex || null, procedure_type: r.procedure_type || null,
                    anesthesia_type: r.anesthesia_type || null,
                    weight_min: needsWeightFor.includes(r.species || '') ? (r.weight_min ?? null) : null,
                    weight_max: needsWeightFor.includes(r.species || '') ? (r.weight_max ?? null) : null,
                }
                if (usesTramo) {
                    cellsPayload.push({ ...base, tramo: 'T1', price: r.price_t1 ?? null, requires_human: r.price_t1 === undefined })
                    cellsPayload.push({ ...base, tramo: 'T2', price: r.price_t2 ?? null, requires_human: r.price_t2 === undefined })
                    cellsPayload.push({ ...base, tramo: 'T3', price: r.price_t3 ?? null, requires_human: r.price_t3 === undefined })
                } else {
                    cellsPayload.push({ ...base, tramo: null, price: r.requires_human ? null : (r.price ?? null), requires_human: !!r.requires_human })
                }
            }
            const modifiersPayload = modifiers.filter(m => m.key.trim()).map(m => ({
                key: m.key.trim(), label: m.label.trim() || m.key.trim(), amount: m.amount, applies_when: m.applies_when,
            }))

            const { error } = await (supabase as any).rpc('replace_price_matrix', {
                p_matrix_id: matrix.id, p_cells: cellsPayload, p_modifiers: modifiersPayload,
            })
            if (error) throw error
            toast.success('Matriz guardada.')
            onSaved()
        } catch (e: any) {
            toast.error(e.message || 'Error al guardar la matriz.')
        } finally {
            setSaving(false)
        }
    }

    if (loading) return <div className="p-4 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary-500" /></div>

    return (
        <div className="p-4 space-y-4 bg-white">
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-left text-xs font-bold text-charcoal/50 uppercase tracking-wider">
                            {dims.species && <th className="pb-2 pr-2">Especie</th>}
                            {dims.sex && <th className="pb-2 pr-2">Sexo</th>}
                            {dims.procedure_type && <th className="pb-2 pr-2">Procedimiento</th>}
                            {dims.anesthesia_type && <th className="pb-2 pr-2">Anestesia</th>}
                            <th className="pb-2 pr-2">Peso min</th>
                            <th className="pb-2 pr-2">Peso max</th>
                            {usesTramo
                                ? <><th className="pb-2 pr-2">T1</th><th className="pb-2 pr-2">T2</th><th className="pb-2 pr-2">T3</th></>
                                : <th className="pb-2 pr-2">Precio</th>}
                            <th className="pb-2"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r) => (
                            <tr key={r.localId} className="border-t border-silk-beige/50">
                                {dims.species && (
                                    <td className="py-1.5 pr-2">
                                        <select value={r.species || ''} onChange={e => updateRow(r.localId, { species: e.target.value || undefined })} className="input-soft py-1 text-xs">
                                            <option value="">—</option>
                                            {SPECIES_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
                                        </select>
                                    </td>
                                )}
                                {dims.sex && (
                                    <td className="py-1.5 pr-2">
                                        <select value={r.sex || ''} onChange={e => updateRow(r.localId, { sex: e.target.value || undefined })} className="input-soft py-1 text-xs">
                                            <option value="">—</option>
                                            {SEX_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
                                        </select>
                                    </td>
                                )}
                                {dims.procedure_type && (
                                    <td className="py-1.5 pr-2">
                                        <select value={r.procedure_type || ''} onChange={e => updateRow(r.localId, { procedure_type: e.target.value || undefined })} className="input-soft py-1 text-xs">
                                            <option value="">—</option>
                                            {PROCEDURE_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
                                        </select>
                                    </td>
                                )}
                                {dims.anesthesia_type && (
                                    <td className="py-1.5 pr-2">
                                        <select value={r.anesthesia_type || ''} onChange={e => updateRow(r.localId, { anesthesia_type: e.target.value || undefined })} className="input-soft py-1 text-xs">
                                            <option value="">—</option>
                                            {ANESTHESIA_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
                                        </select>
                                    </td>
                                )}
                                <td className="py-1.5 pr-2">
                                    <input type="number" value={money(r.weight_min)} onChange={e => updateRow(r.localId, { weight_min: e.target.value ? Number(e.target.value) : undefined })}
                                        placeholder="kg" className="input-soft py-1 text-xs w-16" />
                                </td>
                                <td className="py-1.5 pr-2">
                                    <input type="number" value={money(r.weight_max)} onChange={e => updateRow(r.localId, { weight_max: e.target.value ? Number(e.target.value) : undefined })}
                                        placeholder="kg" className="input-soft py-1 text-xs w-16" />
                                </td>
                                {usesTramo ? (
                                    <>
                                        <td className="py-1.5 pr-2"><input type="number" value={money(r.price_t1)} onChange={e => updateRow(r.localId, { price_t1: e.target.value ? Number(e.target.value) : undefined })} className="input-soft py-1 text-xs w-24" /></td>
                                        <td className="py-1.5 pr-2"><input type="number" value={money(r.price_t2)} onChange={e => updateRow(r.localId, { price_t2: e.target.value ? Number(e.target.value) : undefined })} className="input-soft py-1 text-xs w-24" /></td>
                                        <td className="py-1.5 pr-2"><input type="number" value={money(r.price_t3)} onChange={e => updateRow(r.localId, { price_t3: e.target.value ? Number(e.target.value) : undefined })} className="input-soft py-1 text-xs w-24" /></td>
                                    </>
                                ) : (
                                    <td className="py-1.5 pr-2">
                                        {r.requires_human ? (
                                            <span className="text-xs text-amber-600 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Escalar a humano</span>
                                        ) : (
                                            <input type="number" value={money(r.price)} onChange={e => updateRow(r.localId, { price: e.target.value ? Number(e.target.value) : undefined })} className="input-soft py-1 text-xs w-24" />
                                        )}
                                        <label className="flex items-center gap-1 mt-1 text-[10px] text-charcoal/50">
                                            <input type="checkbox" checked={!!r.requires_human} onChange={e => updateRow(r.localId, { requires_human: e.target.checked })} />
                                            Sin precio (escalar)
                                        </label>
                                    </td>
                                )}
                                <td className="py-1.5">
                                    <button onClick={() => removeRow(r.localId)} className="p-1 text-charcoal/30 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <button onClick={addRow} className="text-xs text-primary-600 hover:text-primary-700 font-bold flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" /> Agregar fila
            </button>

            <div className="pt-3 border-t border-silk-beige">
                <p className="text-xs font-bold text-charcoal/60 uppercase tracking-wider mb-2">Recargos condicionales (opcional)</p>
                {modifiers.map((m) => (
                    <div key={m.localId} className="flex items-center gap-2 mb-2">
                        <input placeholder="Etiqueta (ej. Celo o preñez)" value={m.label} onChange={e => updateModifier(m.localId, { label: e.target.value, key: m.key || e.target.value.toLowerCase().replace(/\s+/g, '_') })} className="input-soft py-1 text-xs flex-1" />
                        <input type="number" placeholder="Monto" value={money(m.amount)} onChange={e => updateModifier(m.localId, { amount: Number(e.target.value) || 0 })} className="input-soft py-1 text-xs w-28" />
                        <select
                            value={m.applies_when.sex || ''}
                            onChange={e => updateModifier(m.localId, { applies_when: e.target.value ? { sex: e.target.value } : {} })}
                            className="input-soft py-1 text-xs w-32"
                        >
                            <option value="">Aplica siempre</option>
                            <option value="hembra">Solo hembra</option>
                            <option value="macho">Solo macho</option>
                        </select>
                        <button onClick={() => removeModifier(m.localId)} className="p-1 text-charcoal/30 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                ))}
                <button onClick={addModifier} className="text-xs text-primary-600 hover:text-primary-700 font-bold flex items-center gap-1">
                    <Plus className="w-3.5 h-3.5" /> Agregar recargo
                </button>
            </div>

            <div className="flex justify-end pt-2">
                <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2">
                    {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                    Guardar matriz
                </button>
            </div>
        </div>
    )
}
