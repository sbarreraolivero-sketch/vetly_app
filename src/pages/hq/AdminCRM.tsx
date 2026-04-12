import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
    Search,
    Plus,
    Phone,
    Tag,
    Target,
    MessageSquare,
    Calendar,
    Sparkles,
    CheckCircle2,
    ChevronUp,
    ChevronDown,
    Trash2,
    X,
    Loader2,
    Save,
    Edit2,
    Settings2,
    Users
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'

const HQ_ID = '00000000-0000-0000-0000-000000000000'

interface PipelineStage {
    id: string
    clinic_id: string
    name: string
    color: string
    position: number
    is_default: boolean
}

interface CrmTag {
    id: string
    clinic_id: string
    name: string
    color: string
}

interface Prospect {
    id: string
    clinic_id: string
    stage_id: string | null
    name: string | null
    phone: string | null
    email: string | null
    address: string | null
    service_interest: string | null
    source: string | null
    notes: string | null
    score: number
    created_at: string
    updated_at: string
    tags?: CrmTag[]
}

const DEFAULT_STAGES = [
    { name: 'Nuevo', color: '#6366f1', position: 0, is_default: true },
    { name: 'Contactado', color: '#3b82f6', position: 1, is_default: false },
    { name: 'Prueba Iniciada', color: '#f59e0b', position: 2, is_default: false },
    { name: 'Convertido', color: '#10b981', position: 3, is_default: false },
    { name: 'Postergado/Perdido', color: '#ef4444', position: 4, is_default: false },
]

const TAG_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316']

export default function AdminCRM() {
    const [loading, setLoading] = useState(true)
    const [stages, setStages] = useState<PipelineStage[]>([])
    const [prospects, setProspects] = useState<Prospect[]>([])
    const [tags, setTags] = useState<CrmTag[]>([])
    const [prospectTags, setProspectTags] = useState<Record<string, string[]>>({})
    const [searchQuery, setSearchQuery] = useState('')
    const [filterTag, setFilterTag] = useState('')

    const [showProspectModal, setShowProspectModal] = useState(false)
    const [editingProspect, setEditingProspect] = useState<Prospect | null>(null)
    const [showStageConfig, setShowStageConfig] = useState(false)
    const [showTagManager, setShowTagManager] = useState(false)

    const [prospectForm, setProspectForm] = useState({
        name: '', phone: '', email: '', address: '',
        service_interest: '', source: 'whatsapp', notes: '', stage_id: '', score: 0,
    })
    const [selectedFormTags, setSelectedFormTags] = useState<string[]>([])
    const [saving, setSaving] = useState(false)

    const [stageForm, setStageForm] = useState({ name: '', color: '#6366f1' })
    const [editingStage, setEditingStage] = useState<PipelineStage | null>(null)

    const [tagForm, setTagForm] = useState({ name: '', color: '#f59e0b' })

    const draggedProspect = useRef<string | null>(null)
    const [dragOverStage, setDragOverStage] = useState<string | null>(null)

    useEffect(() => {
        fetchAll()
    }, [])

    const fetchAll = async () => {
        setLoading(true)
        try {
            let { data: stagesData } = await (supabase as any)
                .from('crm_pipeline_stages')
                .select('*')
                .eq('clinic_id', HQ_ID)
                .order('position', { ascending: true })

            if (!stagesData || stagesData.length === 0) {
                const inserts = DEFAULT_STAGES.map(s => ({ ...s, clinic_id: HQ_ID }))
                const { data: newStages } = await (supabase as any)
                    .from('crm_pipeline_stages')
                    .insert(inserts)
                    .select()
                stagesData = newStages || []
            }
            setStages(stagesData || [])

            const { data: prospectsData } = await (supabase as any)
                .from('crm_prospects')
                .select('*')
                .eq('clinic_id', HQ_ID)
                .order('created_at', { ascending: false })
            setProspects(prospectsData || [])

            const { data: tagsData } = await (supabase as any)
                .from('crm_tags')
                .select('*')
                .eq('clinic_id', HQ_ID)
                .order('name', { ascending: true })
            setTags(tagsData || [])

            if (prospectsData && prospectsData.length > 0) {
                const prospectIds = prospectsData.map((p: Prospect) => p.id)
                const { data: ptData } = await (supabase as any)
                    .from('crm_prospect_tags')
                    .select('prospect_id, tag_id')
                    .in('prospect_id', prospectIds)

                const ptMap: Record<string, string[]> = {}
                if (ptData) {
                    for (const pt of ptData) {
                        if (!ptMap[pt.prospect_id]) ptMap[pt.prospect_id] = []
                        ptMap[pt.prospect_id].push(pt.tag_id)
                    }
                }
                setProspectTags(ptMap)
            }
        } catch (err) {
            console.error('Error fetching CRM data:', err)
        } finally {
            setLoading(false)
        }
    }

    const totalProspects = prospects.length
    const trialsStarted = prospects.filter(p => {
        const stage = stages.find(s => s.id === p.stage_id)
        return stage && stage.name === 'Prueba Iniciada'
    }).length
    const converted = prospects.filter(p => {
        const stage = stages.find(s => s.id === p.stage_id)
        return stage && stage.name === 'Convertido'
    }).length

    const filteredProspects = prospects.filter(p => {
        const matchesSearch = !searchQuery ||
            p.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            p.phone?.includes(searchQuery) ||
            p.email?.toLowerCase().includes(searchQuery.toLowerCase())
        const matchesTag = !filterTag || (prospectTags[p.id] || []).includes(filterTag)
        return matchesSearch && matchesTag
    })

    const onDragStart = (prospectId: string) => { draggedProspect.current = prospectId }
    const onDragOver = (e: React.DragEvent, stageId: string) => {
        e.preventDefault()
        setDragOverStage(stageId)
    }
    const onDragLeave = () => setDragOverStage(null)
    const onDrop = async (stageId: string) => {
        setDragOverStage(null)
        if (!draggedProspect.current) return
        const prospectId = draggedProspect.current
        draggedProspect.current = null
        setProspects(prev => prev.map(p => p.id === prospectId ? { ...p, stage_id: stageId } : p))
        try {
            await (supabase as any).from('crm_prospects').update({ stage_id: stageId, updated_at: new Date().toISOString() }).eq('id', prospectId)
        } catch (err) { console.error(err); fetchAll() }
    }

    const openProspectModal = (prospect?: Prospect) => {
        if (prospect) {
            setEditingProspect(prospect)
            setProspectForm({
                name: prospect.name || '', phone: prospect.phone || '', email: prospect.email || '', address: prospect.address || '',
                service_interest: prospect.service_interest || '', source: prospect.source || 'whatsapp', notes: prospect.notes || '',
                stage_id: prospect.stage_id || '', score: prospect.score || 0,
            })
            setSelectedFormTags(prospectTags[prospect.id] || [])
        } else {
            setEditingProspect(null)
            const defaultStage = stages.find(s => s.is_default) || stages[0]
            setProspectForm({
                name: '', phone: '', email: '', address: '', service_interest: '', source: 'whatsapp', notes: '',
                stage_id: defaultStage?.id || '', score: 0,
            })
            setSelectedFormTags([])
        }
        setShowProspectModal(true)
    }

    const handleSaveProspect = async () => {
        setSaving(true)
        try {
            const data = {
                clinic_id: HQ_ID, name: prospectForm.name || null, phone: prospectForm.phone || null, email: prospectForm.email || null,
                address: prospectForm.address || null, service_interest: prospectForm.service_interest || null,
                source: prospectForm.source || 'whatsapp', notes: prospectForm.notes || null, stage_id: prospectForm.stage_id || null, score: prospectForm.score,
            }
            let prospectId = editingProspect?.id
            if (prospectId) {
                await (supabase as any).from('crm_prospects').update({ ...data, updated_at: new Date().toISOString() }).eq('id', prospectId)
            } else {
                const { data: newP } = await (supabase as any).from('crm_prospects').insert(data).select().single()
                prospectId = newP?.id
            }
            if (prospectId) {
                await (supabase as any).from('crm_prospect_tags').delete().eq('prospect_id', prospectId)
                if (selectedFormTags.length > 0) {
                    await (supabase as any).from('crm_prospect_tags').insert(selectedFormTags.map(tagId => ({ prospect_id: prospectId, tag_id: tagId })))
                }
            }
            setShowProspectModal(false)
            fetchAll()
        } catch (err) { console.error(err) } finally { setSaving(false) }
    }

    const handleDeleteProspect = async (id: string) => {
        try {
            await (supabase as any).from('crm_prospects').delete().eq('id', id)
            setProspects(prev => prev.filter(p => p.id !== id))
        } catch (err) { console.error(err) }
    }

    const handleSaveStage = async () => {
        if (!stageForm.name.trim()) return
        try {
            if (editingStage) {
                await (supabase as any).from('crm_pipeline_stages').update({ name: stageForm.name.trim(), color: stageForm.color }).eq('id', editingStage.id)
            } else {
                const maxPos = stages.length > 0 ? Math.max(...stages.map(s => s.position)) + 1 : 0
                await (supabase as any).from('crm_pipeline_stages').insert({ clinic_id: HQ_ID, name: stageForm.name.trim(), color: stageForm.color, position: maxPos })
            }
            setStageForm({ name: '', color: '#6366f1' }); setEditingStage(null); fetchAll()
        } catch (err) { console.error(err) }
    }

    const handleDeleteStage = async (id: string) => {
        try {
            const fallback = stages.filter(s => s.id !== id)[0]
            if (fallback) await (supabase as any).from('crm_prospects').update({ stage_id: fallback.id }).eq('stage_id', id).eq('clinic_id', HQ_ID)
            await (supabase as any).from('crm_pipeline_stages').delete().eq('id', id)
            fetchAll()
        } catch (err) { console.error(err) }
    }

    const handleMoveStage = async (index: number, direction: 'up' | 'down') => {
        const newStages = [...stages]
        const targetIndex = direction === 'up' ? index - 1 : index + 1
        if (targetIndex < 0 || targetIndex >= newStages.length) return
        const temp = newStages[index]; newStages[index] = newStages[targetIndex]; newStages[targetIndex] = temp
        newStages.forEach((s, i) => s.position = i)
        setStages(newStages)
        try {
            await (supabase as any).from('crm_pipeline_stages').upsert(newStages.map(s => ({ id: s.id, position: s.position, updated_at: new Date().toISOString() })))
        } catch (err) { console.error(err); fetchAll() }
    }

    const handleSaveTag = async () => {
        if (!tagForm.name.trim()) return
        try {
            await (supabase as any).from('crm_tags').insert({ clinic_id: HQ_ID, name: tagForm.name.trim(), color: tagForm.color })
            setTagForm({ name: '', color: '#f59e0b' }); fetchAll()
        } catch (err) { console.error(err) }
    }

    const handleDeleteTag = async (id: string) => {
        try {
            await (supabase as any).from('crm_tags').delete().eq('id', id)
            fetchAll()
        } catch (err) { console.error(err) }
    }

    const getTagsForProspect = (prospectId: string) => {
        const tagIds = prospectTags[prospectId] || []
        return tags.filter(t => tagIds.includes(t.id))
    }

    if (loading) return <div className="flex items-center justify-center h-full"><Loader2 className="w-8 h-8 text-primary-500 animate-spin" /></div>

    return (
        <div className="space-y-8 p-8 max-w-7xl mx-auto animate-fade-in">
            {/* HQ Header */}
            <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-[2.5rem] p-12 text-white shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-1/2 h-full bg-primary-500/10 blur-[120px] -z-0" />
                <div className="relative z-10">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8">
                        <div>
                            <div className="flex items-center gap-3 mb-4">
                                <span className="px-3 py-1 bg-primary-500/20 text-primary-400 text-[10px] font-black uppercase tracking-widest rounded-full border border-primary-500/30">HQ Exclusive</span>
                            </div>
                            <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4">CRM de Prospectos</h1>
                            <p className="text-gray-400 font-medium max-w-xl text-lg">Centraliza y gestiona el flujo de adquisición de nuevas clínicas para Vetly.</p>
                        </div>
                        <div className="flex gap-4">
                            <div className="relative group">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/30 group-focus-within:text-white transition-all" />
                                <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Buscar leads..." className="pl-12 pr-6 py-4 bg-white/5 border border-white/10 rounded-2xl focus:bg-white/10 focus:ring-2 focus:ring-primary-500/20 transition-all text-white placeholder:text-white/20 font-bold" />
                            </div>
                            <div className="relative group">
                                <Tag className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/30 group-focus-within:text-white transition-all" />
                                <select value={filterTag} onChange={e => setFilterTag(e.target.value)} className="pl-12 pr-10 py-4 bg-white/5 border border-white/10 rounded-2xl focus:bg-white/10 focus:ring-2 focus:ring-primary-500/20 transition-all text-white font-bold appearance-none cursor-pointer">
                                    <option value="" className="bg-gray-900">Todas las etiquetas</option>
                                    {tags.map(t => (
                                        <option key={t.id} value={t.id} className="bg-gray-900">{t.name}</option>
                                    ))}
                                </select>
                                <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
                            </div>
                            <button onClick={() => setShowTagManager(true)} className="p-4 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/10 transition-all text-white/60 hover:text-white"><Tag className="w-6 h-6" /></button>
                            <button onClick={() => setShowStageConfig(true)} className="p-4 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/10 transition-all text-white/60 hover:text-white"><Settings2 className="w-6 h-6" /></button>
                            <button onClick={() => openProspectModal()} className="px-8 py-4 bg-primary-500 hover:bg-primary-600 text-white font-black rounded-2xl shadow-lg shadow-primary-500/20 transition-all hover:-translate-y-1 active:scale-95 flex items-center gap-3"><Plus className="w-6 h-6" /> Nuevo Lead</button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Stats Dashboard */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {[
                    { label: 'Leads Totales', value: totalProspects, icon: Users, color: 'blue' },
                    { label: 'Pruebas de 7 Días', value: trialsStarted, icon: Sparkles, color: 'amber' },
                    { label: 'Clínicas Convertidas', value: converted, icon: CheckCircle2, color: 'emerald' }
                ].map((stat, i) => (
                    <div key={i} className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 flex items-center justify-between group hover:border-primary-500/30 transition-all">
                        <div>
                            <p className="text-xs font-black uppercase tracking-widest text-gray-400 mb-2">{stat.label}</p>
                            <p className="text-4xl font-black text-gray-900">{stat.value}</p>
                        </div>
                        <div className={`w-16 h-16 rounded-2xl bg-${stat.color}-50 flex items-center justify-center group-hover:scale-110 transition-transform`}>
                            <stat.icon className={`w-8 h-8 text-${stat.color}-500`} />
                        </div>
                    </div>
                ))}
            </div>

            {/* Kanban Board */}
            <div className="flex gap-6 overflow-x-auto pb-8 -mx-8 px-8 scrollbar-hide">
                {stages.map(stage => {
                    const stageProspects = filteredProspects.filter(p => p.stage_id === stage.id)
                    return (
                        <div key={stage.id} className={cn("w-80 flex-shrink-0 flex flex-col gap-4", dragOverStage === stage.id && "opacity-50")} onDragOver={(e) => onDragOver(e, stage.id)} onDragLeave={onDragLeave} onDrop={() => onDrop(stage.id)}>
                            <div className="flex items-center justify-between px-2">
                                <div className="flex items-center gap-3">
                                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: stage.color }} />
                                    <h3 className="font-black text-gray-900 uppercase tracking-wider text-sm">{stage.name}</h3>
                                    <span className="text-[10px] font-black bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{stageProspects.length}</span>
                                </div>
                            </div>

                            <div className="flex-1 flex flex-col gap-3 min-h-[500px]">
                                {stageProspects.map(prospect => (
                                    <div key={prospect.id} draggable onDragStart={() => onDragStart(prospect.id)} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 hover:shadow-xl hover:border-primary-500/20 transition-all cursor-grab active:cursor-grabbing group relative overflow-hidden">
                                        <div className="absolute top-0 left-0 w-1 h-full" style={{ backgroundColor: stage.color }} />
                                        <div className="flex flex-col gap-4">
                                            <div className="flex justify-between items-start">
                                                <h4 className="font-bold text-gray-900 text-lg leading-tight flex items-center gap-2">
                                                    <Target className="w-4 h-4 text-primary-500" />
                                                    {prospect.name || 'Sin nombre'}
                                                </h4>
                                                <div className="flex gap-1">
                                                    <button onClick={() => openProspectModal(prospect)} className="p-2 text-gray-400 hover:text-primary-500 hover:bg-primary-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"><Edit2 className="w-4 h-4" /></button>
                                                    <button onClick={() => handleDeleteProspect(prospect.id)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"><Trash2 className="w-4 h-4" /></button>
                                                </div>
                                            </div>
                                            
                                            <div className="flex flex-col gap-2">
                                                {prospect.phone && (
                                                    <div className="flex items-center gap-2 text-gray-500 font-medium">
                                                        <Phone className="w-4 h-4 text-primary-500" />
                                                        <span className="text-sm">{prospect.phone}</span>
                                                    </div>
                                                )}
                                                {prospect.notes && (
                                                    <div className="flex items-start gap-2 text-gray-400 font-medium">
                                                        <MessageSquare className="w-4 h-4 text-primary-500 shrink-0 mt-0.5" />
                                                        <span className="text-xs line-clamp-2">{prospect.notes}</span>
                                                    </div>
                                                )}
                                            </div>

                                            <div className="flex flex-wrap gap-2">
                                                {getTagsForProspect(prospect.id).map(tag => (
                                                    <span key={tag.id} className="px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white rounded-lg shadow-sm" style={{ backgroundColor: tag.color }}>{tag.name}</span>
                                                ))}
                                            </div>

                                            <div className="flex items-center justify-between pt-4 border-t border-gray-50">
                                                <div className="flex items-center gap-2">
                                                    <Calendar className="w-3 h-3 text-gray-300" />
                                                    <span className="text-[10px] font-black text-gray-400 uppercase">{new Date(prospect.created_at).toLocaleDateString()}</span>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-primary-500" />
                                                    <span className="text-[10px] font-black text-primary-500 uppercase tracking-tighter">{prospect.source}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {stageProspects.length === 0 && <div className="h-32 border-2 border-dashed border-gray-200 rounded-2xl flex items-center justify-center text-gray-300 font-bold uppercase tracking-widest text-[10px]">Vacío</div>}
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* Modals are handled via createPortal to body */}
            {showProspectModal && createPortal(
                <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-md z-[100] flex items-center justify-center p-4 animate-fade-in">
                    <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-xl overflow-hidden animate-scale-in">
                        <div className="p-10 border-b border-gray-50 flex justify-between items-center bg-gray-900 text-white">
                            <div>
                                <h2 className="text-2xl font-black uppercase tracking-tight">{editingProspect ? 'Editar Lead' : 'Nuevo Lead HQ'}</h2>
                                <p className="text-gray-400 text-sm font-medium mt-1">Registra la información del prospecto de Vetly</p>
                            </div>
                            <button onClick={() => setShowProspectModal(false)} className="p-3 bg-white/10 hover:bg-white/20 rounded-2xl transition-all"><X className="w-6 h-6" /></button>
                        </div>
                        <div className="p-10 space-y-6 max-h-[70vh] overflow-y-auto scrollbar-hide">
                            <div className="grid grid-cols-2 gap-6">
                                <div className="col-span-2">
                                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Nombre Completo</label>
                                    <input type="text" value={prospectForm.name} onChange={e => setProspectForm(p => ({ ...p, name: e.target.value }))} className="w-full px-6 py-4 bg-gray-50 border-transparent focus:bg-white focus:ring-2 focus:ring-primary-500/20 rounded-2xl transition-all font-bold" placeholder="Nombre de la clínica / Dr." />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">WhatsApp</label>
                                    <input type="tel" value={prospectForm.phone} onChange={e => setProspectForm(p => ({ ...p, phone: e.target.value }))} className="w-full px-6 py-4 bg-gray-50 border-transparent focus:bg-white focus:ring-2 focus:ring-primary-500/20 rounded-2xl transition-all font-bold" placeholder="+56..." />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Email</label>
                                    <input type="email" value={prospectForm.email} onChange={e => setProspectForm(p => ({ ...p, email: e.target.value }))} className="w-full px-6 py-4 bg-gray-50 border-transparent focus:bg-white focus:ring-2 focus:ring-primary-500/20 rounded-2xl transition-all font-bold" placeholder="email@vet..." />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Notas Consultivas</label>
                                    <textarea value={prospectForm.notes} onChange={e => setProspectForm(p => ({ ...p, notes: e.target.value }))} className="w-full px-6 py-4 bg-gray-50 border-transparent focus:bg-white focus:ring-2 focus:ring-primary-500/20 rounded-2xl transition-all font-bold min-h-[120px]" placeholder="Puntos de dolor identificados, objeciones..." />
                                </div>
                            </div>
                        </div>
                        <div className="p-10 bg-gray-50 border-t border-gray-100 flex justify-end gap-4">
                            <button onClick={() => setShowProspectModal(false)} className="px-8 py-4 font-black uppercase text-xs tracking-widest text-gray-400 hover:text-gray-600 transition-all">Cancelar</button>
                            <button onClick={handleSaveProspect} disabled={saving} className="px-10 py-4 bg-primary-500 hover:bg-primary-600 text-white font-black rounded-2xl shadow-xl shadow-primary-500/20 transition-all flex items-center gap-3">{saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />} {editingProspect ? 'Actualizar' : 'Crear Lead'}</button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
            
            {/* Stage Config Modal */}
            {showStageConfig && createPortal(
                <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-md z-[100] flex items-center justify-center p-4 animate-fade-in">
                    <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-md animate-scale-in">
                        <div className="p-8 border-b border-gray-50 flex justify-between items-center">
                            <h2 className="text-xl font-black uppercase tracking-tight">Etapas del Embudo</h2>
                            <button onClick={() => setShowStageConfig(false)} className="p-2 hover:bg-gray-100 rounded-xl transition-all"><X className="w-5 h-5" /></button>
                        </div>
                        <div className="p-8 space-y-4">
                            {stages.map((s, idx) => (
                                <div key={s.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-2xl border border-gray-100">
                                    <div className="flex flex-col gap-1">
                                        <button onClick={() => handleMoveStage(idx, 'up')} disabled={idx === 0} className="p-1 hover:bg-white rounded shadow-sm disabled:opacity-30"><ChevronUp className="w-3 h-3" /></button>
                                        <button onClick={() => handleMoveStage(idx, 'down')} disabled={idx === stages.length - 1} className="p-1 hover:bg-white rounded shadow-sm disabled:opacity-30"><ChevronDown className="w-3 h-3" /></button>
                                    </div>
                                    <div className="w-4 h-4 rounded-full" style={{ backgroundColor: s.color }} />
                                    <span className="flex-1 font-bold text-sm">{s.name}</span>
                                    <button onClick={() => handleDeleteStage(s.id)} className="p-2 text-red-400 hover:bg-red-50 rounded-xl transition-all"><Trash2 className="w-4 h-4" /></button>
                                </div>
                            ))}
                            <div className="pt-6 border-t border-gray-100 flex gap-2">
                                <input type="text" value={stageForm.name} onChange={e => setStageForm(p => ({ ...p, name: e.target.value }))} className="flex-1 px-4 py-3 bg-gray-100 rounded-xl font-bold text-sm" placeholder="Nueva etapa..." />
                                <input type="color" value={stageForm.color} onChange={e => setStageForm(p => ({ ...p, color: e.target.value }))} className="w-12 h-12 rounded-xl bg-gray-100 p-1 border-none cursor-pointer" />
                                <button onClick={handleSaveStage} className="p-3 bg-primary-500 text-white rounded-xl shadow-lg shadow-primary-500/20"><Plus className="w-6 h-6" /></button>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Tag Manager Modal */}
            {showTagManager && createPortal(
                <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-md z-[100] flex items-center justify-center p-4 animate-fade-in">
                    <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-md animate-scale-in">
                        <div className="p-8 border-b border-gray-50 flex justify-between items-center">
                            <h2 className="text-xl font-black uppercase tracking-tight">Etiquetas</h2>
                            <button onClick={() => setShowTagManager(false)} className="p-2 hover:bg-gray-100 rounded-xl transition-all"><X className="w-5 h-5" /></button>
                        </div>
                        <div className="p-8 space-y-6">
                            <div className="flex flex-wrap gap-2">
                                {tags.map(t => (
                                    <span key={t.id} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-white text-[10px] font-black uppercase tracking-widest shadow-sm" style={{ backgroundColor: t.color }}>
                                        {t.name}
                                        <button onClick={() => handleDeleteTag(t.id)}><X className="w-3 h-3" /></button>
                                    </span>
                                ))}
                            </div>
                            <div className="pt-6 border-t border-gray-100 space-y-4">
                                <input type="text" value={tagForm.name} onChange={e => setTagForm(p => ({ ...p, name: e.target.value }))} className="w-full px-4 py-3 bg-gray-100 rounded-xl font-bold text-sm" placeholder="Nombre etiqueta..." />
                                <div className="flex justify-between">
                                    {TAG_COLORS.map(c => (
                                        <button key={c} onClick={() => setTagForm(p => ({ ...p, color: c }))} className={cn("w-6 h-6 rounded-full border-2 transition-all", tagForm.color === c ? "border-gray-900 scale-125" : "border-transparent")} style={{ backgroundColor: c }} />
                                    ))}
                                </div>
                                <button onClick={handleSaveTag} className="w-full py-4 bg-primary-500 text-white font-black rounded-2xl shadow-xl shadow-primary-500/20 uppercase tracking-widest text-xs">Crear Etiqueta</button>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    )
}
