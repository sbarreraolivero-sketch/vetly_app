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
    CheckCircle2,
    BarChart3,
    GripVertical,
    X,
    Loader2,
    Save,
    Trash2,
    Edit2,
    ChevronDown,
    Briefcase,
    Settings2,
    ChevronUp,
    Users
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { GuideBox } from '@/components/ui/GuideBox'

// Types
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
    { name: 'Nuevo Prospecto', color: '#6366f1', position: 0, is_default: true },
    { name: 'Consulta disponibilidad', color: '#3b82f6', position: 1, is_default: false },
    { name: 'Calificado', color: '#f59e0b', position: 2, is_default: false },
    { name: 'Cita agendada', color: '#10b981', position: 3, is_default: false },
    { name: 'Cerrado', color: '#ef4444', position: 4, is_default: false },
]

const TAG_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316']

export default function CRM() {
    const { profile } = useAuth()
    const [loading, setLoading] = useState(true)
    const [stages, setStages] = useState<PipelineStage[]>([])
    const [prospects, setProspects] = useState<Prospect[]>([])
    const [tags, setTags] = useState<CrmTag[]>([])
    const [prospectTags, setProspectTags] = useState<Record<string, string[]>>({})
    const [searchQuery, setSearchQuery] = useState('')
    const [filterTag, setFilterTag] = useState('')

    // Modals
    const [showProspectModal, setShowProspectModal] = useState(false)
    const [editingProspect, setEditingProspect] = useState<Prospect | null>(null)
    const [showStageConfig, setShowStageConfig] = useState(false)
    const [showTagManager, setShowTagManager] = useState(false)
    const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null)

    // Form
    const [prospectForm, setProspectForm] = useState({
        name: '', phone: '', email: '', address: '',
        service_interest: '', source: 'whatsapp', notes: '', stage_id: '', score: 0,
    })
    const [selectedFormTags, setSelectedFormTags] = useState<string[]>([])
    const [saving, setSaving] = useState(false)

    // Stage config form
    const [stageForm, setStageForm] = useState({ name: '', color: '#6366f1' })
    const [editingStage, setEditingStage] = useState<PipelineStage | null>(null)

    // Tag form
    const [tagForm, setTagForm] = useState({ name: '', color: '#f59e0b' })

    // Drag state
    const draggedProspect = useRef<string | null>(null)
    const [dragOverStage, setDragOverStage] = useState<string | null>(null)

    // Services for dropdown
    const [services, setServices] = useState<{ id: string; name: string }[]>([])

    // Fetch all data
    useEffect(() => {
        if (!profile?.clinic_id) return
        fetchAll()
    }, [profile?.clinic_id])

    const fetchAll = async () => {
        if (!profile?.clinic_id) return
        setLoading(true)
        try {
            // Stages
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let { data: stagesData } = await (supabase as any)
                .from('crm_pipeline_stages')
                .select('*')
                .eq('clinic_id', profile.clinic_id)
                .order('position', { ascending: true })

            // Seed default stages if empty
            if (!stagesData || stagesData.length === 0) {
                const inserts = DEFAULT_STAGES.map(s => ({ ...s, clinic_id: profile.clinic_id }))
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { data: newStages } = await (supabase as any)
                    .from('crm_pipeline_stages')
                    .insert(inserts)
                    .select()
                stagesData = newStages || []
            }
            setStages(stagesData || [])

            // Prospects
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: prospectsData } = await (supabase as any)
                .from('crm_prospects')
                .select('*')
                .eq('clinic_id', profile.clinic_id)
                .order('created_at', { ascending: false })
            setProspects(prospectsData || [])

            // Tags
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: tagsData } = await (supabase as any)
                .from('crm_tags')
                .select('*')
                .eq('clinic_id', profile.clinic_id)
                .order('name', { ascending: true })
            setTags(tagsData || [])

            // Prospect-Tag relations
            if (prospectsData && prospectsData.length > 0) {
                const prospectIds = prospectsData.map((p: Prospect) => p.id)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

            // Services
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: svcData } = await (supabase as any)
                .from("clinic_services")
                .select('id, name')
                .eq('clinic_id', profile.clinic_id)
                .order('name')
            setServices(svcData || [])
        } catch (err) {
            console.error('Error fetching CRM data:', err)
        } finally {
            setLoading(false)
        }
    }

    // Stats
    const totalConversations = prospects.length
    const qualifiedLeads = prospects.filter(p => {
        const stage = stages.find(s => s.id === p.stage_id)
        return stage && stage.name.toLowerCase() === 'calificado'
    }).length
    const scheduledAppointments = prospects.filter(p => {
        const stage = stages.find(s => s.id === p.stage_id)
        return stage && stage.name.toLowerCase().includes('cita')
    }).length
    const closedLeads = prospects.filter(p => {
        const stage = stages.find(s => s.id === p.stage_id)
        return stage && stage.position === stages.length - 1
    }).length

    // Filter prospects
    const filteredProspects = prospects.filter(p => {
        const matchesSearch = !searchQuery ||
            p.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            p.phone?.includes(searchQuery) ||
            p.email?.toLowerCase().includes(searchQuery.toLowerCase())
        const matchesTag = !filterTag || (prospectTags[p.id] || []).includes(filterTag)
        return matchesSearch && matchesTag
    })

    // Drag handlers
    const onDragStart = (prospectId: string) => {
        draggedProspect.current = prospectId
    }
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

        // Optimistic update
        setProspects(prev => prev.map(p => p.id === prospectId ? { ...p, stage_id: stageId } : p))

        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase as any)
                .from('crm_prospects')
                .update({ stage_id: stageId, updated_at: new Date().toISOString() })
                .eq('id', prospectId)
        } catch (err) {
            console.error('Error moving prospect:', err)
            fetchAll()
        }
    }

    // Prospect CRUD
    const openProspectModal = (prospect?: Prospect) => {
        if (prospect) {
            setEditingProspect(prospect)
            setProspectForm({
                name: prospect.name || '',
                phone: prospect.phone || '',
                email: prospect.email || '',
                address: prospect.address || '',
                service_interest: prospect.service_interest || '',
                source: prospect.source || 'whatsapp',
                notes: prospect.notes || '',
                stage_id: prospect.stage_id || '',
                score: prospect.score || 0,
            })
            setSelectedFormTags(prospectTags[prospect.id] || [])
        } else {
            setEditingProspect(null)
            const defaultStage = stages.find(s => s.is_default) || stages[0]
            setProspectForm({
                name: '', phone: '', email: '', address: '',
                service_interest: '', source: 'whatsapp', notes: '',
                stage_id: defaultStage?.id || '', score: 0,
            })
            setSelectedFormTags([])
        }
        setShowProspectModal(true)
    }

    const handleSaveProspect = async () => {
        if (!profile?.clinic_id) return
        setSaving(true)
        try {
            const data = {
                clinic_id: profile.clinic_id,
                name: prospectForm.name || null,
                phone: prospectForm.phone || null,
                email: prospectForm.email || null,
                address: prospectForm.address || null,
                service_interest: prospectForm.service_interest || null,
                source: prospectForm.source || 'whatsapp',
                notes: prospectForm.notes || null,
                stage_id: prospectForm.stage_id || null,
                score: prospectForm.score,
            }

            let prospectId = editingProspect?.id
            if (prospectId) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await (supabase as any).from('crm_prospects')
                    .update({ ...data, updated_at: new Date().toISOString() })
                    .eq('id', prospectId)
            } else {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { data: newP } = await (supabase as any)
                    .from('crm_prospects')
                    .insert(data)
                    .select()
                    .single()
                prospectId = newP?.id
            }

            // Update tags
            if (prospectId) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await (supabase as any).from('crm_prospect_tags').delete().eq('prospect_id', prospectId)
                if (selectedFormTags.length > 0) {
                    const tagInserts = selectedFormTags.map(tagId => ({ prospect_id: prospectId, tag_id: tagId }))
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    await (supabase as any).from('crm_prospect_tags').insert(tagInserts)
                }
            }

            setShowProspectModal(false)
            fetchAll()
        } catch (err) {
            console.error('Error saving prospect:', err)
        } finally {
            setSaving(false)
        }
    }

    const handleDeleteProspect = async (id: string) => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase as any).from('crm_prospects').delete().eq('id', id)
            setProspects(prev => prev.filter(p => p.id !== id))
            setShowDeleteConfirm(null)
        } catch (err) {
            console.error('Error deleting prospect:', err)
        }
    }

    // Stage CRUD
    const handleSaveStage = async () => {
        if (!profile?.clinic_id || !stageForm.name.trim()) return
        try {
            if (editingStage) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await (supabase as any).from('crm_pipeline_stages')
                    .update({ name: stageForm.name.trim(), color: stageForm.color })
                    .eq('id', editingStage.id)
            } else {
                const maxPos = stages.length > 0 ? Math.max(...stages.map(s => s.position)) + 1 : 0
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await (supabase as any).from('crm_pipeline_stages')
                    .insert({ clinic_id: profile.clinic_id, name: stageForm.name.trim(), color: stageForm.color, position: maxPos })
            }
            setStageForm({ name: '', color: '#6366f1' })
            setEditingStage(null)
            fetchAll()
        } catch (err) { console.error('Error saving stage:', err) }
    }

    const handleDeleteStage = async (id: string) => {
        if (!profile?.clinic_id) return
        try {
            // Move prospects from this stage to another stage first (FK constraint)
            const remainingStages = stages.filter(s => s.id !== id)
            const fallbackStage = remainingStages[0]
            if (fallbackStage) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await (supabase as any).from('crm_prospects')
                    .update({ stage_id: fallbackStage.id })
                    .eq('stage_id', id)
                    .eq('clinic_id', profile.clinic_id)
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error } = await (supabase as any).from('crm_pipeline_stages').delete().eq('id', id)
            if (error) {
                console.error('Error deleting stage:', error)
                return
            }
            fetchAll()
        } catch (err) { console.error('Error deleting stage:', err) }
    }

    const handleMoveStage = async (index: number, direction: 'up' | 'down') => {
        if (!profile?.clinic_id) return
        const newStages = [...stages]
        const targetIndex = direction === 'up' ? index - 1 : index + 1

        if (targetIndex < 0 || targetIndex >= newStages.length) return

        // Swap positions in local array
        const temp = newStages[index]
        newStages[index] = newStages[targetIndex]
        newStages[targetIndex] = temp

        // Update positions numbers
        newStages.forEach((s, i) => s.position = i)
        setStages(newStages)

        try {
            // Update all stages positions in DB
            const updates = newStages.map(s => ({
                id: s.id,
                position: s.position,
                updated_at: new Date().toISOString()
            }))

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase as any).from('crm_pipeline_stages').upsert(updates)
        } catch (err) {
            console.error('Error reordering stages:', err)
            fetchAll() // Revert on error
        }
    }

    // Tag CRUD
    const handleSaveTag = async () => {
        if (!profile?.clinic_id || !tagForm.name.trim()) return
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase as any).from('crm_tags')
                .insert({ clinic_id: profile.clinic_id, name: tagForm.name.trim(), color: tagForm.color })
            setTagForm({ name: '', color: '#f59e0b' })
            fetchAll()
        } catch (err) { console.error('Error saving tag:', err) }
    }

    const handleDeleteTag = async (id: string) => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase as any).from('crm_tags').delete().eq('id', id)
            fetchAll()
        } catch (err) { console.error('Error deleting tag:', err) }
    }

    const getTagsForProspect = (prospectId: string) => {
        const tagIds = prospectTags[prospectId] || []
        return tags.filter(t => tagIds.includes(t.id))
    }

    const formatDate = (d: string) => new Date(d).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
            </div>
        )
    }

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Header Banner */}
            <div className="bg-hero-gradient rounded-3xl p-8 sm:p-10 text-white relative overflow-hidden shadow-2xl mb-10 border border-white/10">
                {/* Decorative blobs */}
                <div className="absolute top-0 right-0 w-96 h-96 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none animate-pulse"></div>
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-primary-400/20 rounded-full blur-2xl translate-y-1/3 -translate-x-1/4 pointer-events-none"></div>

                <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-8">
                    <div className="flex items-center gap-6">
                        <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20 shadow-inner group transition-all duration-500 hover:scale-110">
                            <div className="p-3 bg-gradient-to-br from-amber-200 via-yellow-400 to-amber-600 rounded-xl shadow-lg">
                                <Users className="w-8 h-8 sm:w-10 sm:h-10 text-white drop-shadow-md" />
                            </div>
                        </div>
                        <div>
                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-[12px] font-bold uppercase tracking-widest mb-3 animate-fade-in">
                                <Target className="w-3.5 h-3.5 text-amber-300" />
                                <span className="text-amber-50">Ventas y Seguimiento</span>
                            </div>
                            <h1 className="text-2xl sm:text-3xl font-black mb-2 tracking-tight drop-shadow-sm uppercase text-white">
                                CRM de Prospectos
                            </h1>
                            <p className="text-emerald-50/90 text-sm sm:text-base max-w-xl font-semibold leading-relaxed">
                                Gestiona tus prospectos, embudos de venta y aumenta la conversión de tu clínica veterinaria.
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-col flex-wrap sm:flex-row items-center gap-3">
                        <button onClick={() => setShowTagManager(true)} className="w-full sm:w-auto px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white transition-all font-bold rounded-xl flex items-center justify-center gap-2 border border-white/20 backdrop-blur-sm uppercase text-xs tracking-widest btn-gold-border">
                            <Tag className="w-4 h-4" /> Etiquetas
                        </button>
                        <button onClick={() => setShowStageConfig(true)} className="w-full sm:w-auto px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white transition-all font-bold rounded-xl flex items-center justify-center gap-2 border border-white/20 backdrop-blur-sm uppercase text-xs tracking-widest btn-gold-border">
                            <Settings2 className="w-4 h-4" /> Etapas
                        </button>
                        <button onClick={() => openProspectModal()} className="w-full sm:w-auto px-8 py-3.5 bg-white text-emerald-900 hover:bg-emerald-50 transition-all font-black rounded-xl flex items-center justify-center gap-2 shadow-premium hover:scale-105 active:scale-95 uppercase text-xs tracking-widest mt-2 sm:mt-0">
                            <Plus className="w-5 h-5" />
                            Nuevo Prospecto
                        </button>
                    </div>
                </div>
            </div>

            <GuideBox title="Gestión de CRM y Pipeline" summary="Aprende a captar y llevar prospectos hasta convertirlos en clientes reales.">
                <div className="space-y-4">
                    <p>El CRM te ayuda a dar seguimiento a personas interesadas que aún no han sido pacientes frecuentes.</p>
                    <ul className="list-disc pl-5 space-y-2">
                        <li><strong>Etapas Personalizables:</strong> Configura el embudo (Nuevo, Contactado, etc.) según el flujo de venta de tu clínica.</li>
                        <li><strong>Arrastrar y Soltar:</strong> Mueve a los prospectos de etapa en etapa fácilmente.</li>
                        <li><strong>Puntuación (Scoring):</strong> Asigna un puntaje a los prospectos más valiosos para priorizarlos.</li>
                    </ul>
                </div>
            </GuideBox>

            {/* Stats */}
            <div className="rounded-soft p-5" style={{ background: 'linear-gradient(135deg, #f5e6c8 0%, #e8c97a 25%, #d4a84b 50%, #e8c97a 75%, #f5e6c8 100%)' }}>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-white/80 backdrop-blur-sm rounded-soft p-3 sm:p-4 flex items-center gap-2 sm:gap-3 border border-white/50 shadow-sm min-w-0">
                        <div className="w-8 h-8 sm:w-10 sm:h-10 bg-blue-50 rounded-soft flex items-center justify-center flex-shrink-0">
                            <MessageSquare className="w-4 h-4 sm:w-5 sm:h-5 text-blue-500" />
                        </div>
                        <div className="min-w-0">
                            <p className="text-xs font-bold sm:text-xs font-semibold text-charcoal/80 truncate sm:whitespace-normal">Conversaciones</p>
                            <p className="text-xl sm:text-2xl font-bold text-charcoal leading-tight">{totalConversations}</p>
                        </div>
                    </div>
                    <div className="bg-white/80 backdrop-blur-sm rounded-soft p-3 sm:p-4 flex items-center gap-2 sm:gap-3 border border-white/50 shadow-sm min-w-0">
                        <div className="w-8 h-8 sm:w-10 sm:h-10 bg-emerald-50 rounded-soft flex items-center justify-center flex-shrink-0">
                            <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-500" />
                        </div>
                        <div className="min-w-0">
                            <p className="text-xs font-bold sm:text-xs font-semibold text-charcoal/80 leading-tight">Leads calificados</p>
                            <p className="text-xl sm:text-2xl font-bold text-charcoal leading-tight">{qualifiedLeads}</p>
                        </div>
                    </div>
                    <div className="bg-white/80 backdrop-blur-sm rounded-soft p-3 sm:p-4 flex items-center gap-2 sm:gap-3 border border-white/50 shadow-sm min-w-0">
                        <div className="w-8 h-8 sm:w-10 sm:h-10 bg-amber-50 rounded-soft flex items-center justify-center flex-shrink-0">
                            <Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-amber-500" />
                        </div>
                        <div className="min-w-0">
                            <p className="text-xs font-bold sm:text-xs font-semibold text-charcoal/80 leading-tight">Citas agendadas</p>
                            <p className="text-xl sm:text-2xl font-bold text-charcoal leading-tight">{scheduledAppointments}</p>
                        </div>
                    </div>
                    <div className="bg-white/80 backdrop-blur-sm rounded-soft p-3 sm:p-4 flex items-center gap-2 sm:gap-3 border border-white/50 shadow-sm min-w-0">
                        <div className="w-8 h-8 sm:w-10 sm:h-10 bg-violet-50 rounded-soft flex items-center justify-center flex-shrink-0">
                            <BarChart3 className="w-4 h-4 sm:w-5 sm:h-5 text-violet-500" />
                        </div>
                        <div className="min-w-0">
                            <p className="text-xs font-bold sm:text-xs font-semibold text-charcoal/80 leading-tight">Leads atribuidos</p>
                            <p className="text-xl sm:text-2xl font-bold text-charcoal leading-tight">{closedLeads}</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Filters */}
            <div className="card-soft p-4">
                <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal/40" />
                        <input
                            type="text"
                            placeholder="Buscar por nombre, teléfono o email..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="input-soft pl-10 w-full text-sm"
                        />
                    </div>
                    <select
                        value={filterTag}
                        onChange={(e) => setFilterTag(e.target.value)}
                        className="input-soft text-sm w-44"
                    >
                        <option value="">Todas las etiquetas</option>
                        {tags.map(t => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Pipeline Kanban */}
            <div className="overflow-x-auto pb-4 -mx-2">
                <div className="flex gap-4 min-w-max px-2">
                    {stages.map(stage => {
                        const stageProspects = filteredProspects.filter(p => p.stage_id === stage.id)
                        return (
                            <div
                                key={stage.id}
                                className={cn(
                                    'w-72 flex-shrink-0 rounded-soft bg-ivory border-2 transition-colors',
                                    dragOverStage === stage.id
                                        ? 'border-primary-400 bg-primary-50/30'
                                        : 'border-transparent'
                                )}
                                onDragOver={(e) => onDragOver(e, stage.id)}
                                onDragLeave={onDragLeave}
                                onDrop={() => onDrop(stage.id)}
                            >
                                {/* Stage header */}
                                <div className="p-3 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div
                                            className="w-3 h-3 rounded-full"
                                            style={{ backgroundColor: stage.color }}
                                        />
                                        <span className="font-semibold text-sm text-charcoal">{stage.name}</span>
                                        <span className="text-xs text-charcoal/40 bg-white px-2 py-0.5 rounded-full border border-silk-beige">
                                            {stageProspects.length}
                                        </span>
                                    </div>
                                    <button
                                        onClick={() => {
                                            const defaultStage = stage
                                            setProspectForm(prev => ({ ...prev, stage_id: defaultStage.id }))
                                            setEditingProspect(null)
                                            setSelectedFormTags([])
                                            setShowProspectModal(true)
                                        }}
                                        className="p-1 hover:bg-white rounded transition-colors"
                                    >
                                        <Plus className="w-4 h-4 text-charcoal/40" />
                                    </button>
                                </div>

                                {/* Prospect cards */}
                                <div className="px-3 pb-3 space-y-2 min-h-[60px]">
                                    {stageProspects.map(prospect => (
                                        <div
                                            key={prospect.id}
                                            draggable
                                            onDragStart={() => onDragStart(prospect.id)}
                                            className="bg-white rounded-soft border border-silk-beige p-3 cursor-grab active:cursor-grabbing hover:shadow-sm transition-all group"
                                        >
                                            <div className="flex items-start justify-between mb-2">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <GripVertical className="w-3.5 h-3.5 text-charcoal/20 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                                                    <p className="font-medium text-sm text-charcoal truncate">
                                                        {prospect.name || 'Sin nombre'}
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-0.5 flex-shrink-0">
                                                    <button
                                                        onClick={() => openProspectModal(prospect)}
                                                        className="p-1 hover:bg-primary-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                                                    >
                                                        <Edit2 className="w-3 h-3 text-primary-500" />
                                                    </button>
                                                    {showDeleteConfirm === prospect.id ? (
                                                        <div className="flex items-center gap-1 bg-red-50 px-1 rounded animate-fade-in">
                                                            <button
                                                                onClick={() => handleDeleteProspect(prospect.id)}
                                                                className="text-xs font-bold text-red-600 font-medium px-1"
                                                            >Sí</button>
                                                            <button
                                                                onClick={() => setShowDeleteConfirm(null)}
                                                                className="text-xs font-bold text-charcoal/50 px-1"
                                                            >No</button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            onClick={() => setShowDeleteConfirm(prospect.id)}
                                                            className="p-1 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                                                        >
                                                            <Trash2 className="w-3 h-3 text-red-400" />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>

                                            {prospect.phone && (
                                                <div className="flex items-center gap-1.5 text-xs text-charcoal/60 mb-1">
                                                    <Phone className="w-3 h-3" />
                                                    {prospect.phone}
                                                </div>
                                            )}

                                            {prospect.service_interest && (
                                                <div className="flex items-center gap-1.5 text-xs text-charcoal/60 mb-1">
                                                    <Briefcase className="w-3 h-3" />
                                                    {prospect.service_interest}
                                                </div>
                                            )}

                                            {/* Tags */}
                                            {getTagsForProspect(prospect.id).length > 0 && (
                                                <div className="flex flex-wrap gap-1 mt-2">
                                                    {getTagsForProspect(prospect.id).map(tag => (
                                                        <span
                                                            key={tag.id}
                                                            className="text-xs font-bold px-1.5 py-0.5 rounded-full text-white font-medium"
                                                            style={{ backgroundColor: tag.color }}
                                                        >
                                                            {tag.name}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}

                                            <div className="flex items-center justify-between mt-2 pt-2 border-t border-silk-beige/50">
                                                <span className="text-xs font-bold text-charcoal/40">
                                                    {formatDate(prospect.created_at)}
                                                </span>
                                                {prospect.source && (
                                                    <span className="text-xs font-bold text-charcoal/30 bg-ivory px-1.5 py-0.5 rounded">
                                                        {prospect.source}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    ))}

                                    {stageProspects.length === 0 && (
                                        <div className="text-center py-6 text-sm font-medium text-charcoal/60">
                                            Arrastra prospectos aquí
                                        </div>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>

            {/* Prospect Create/Edit Modal */}
            {showProspectModal && createPortal(
                <div className="fixed inset-0 bg-charcoal/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                    <div className="bg-white rounded-soft shadow-premium-lg w-full max-w-lg animate-scale-in flex flex-col max-h-[90vh]">
                        <div className="flex items-center justify-between p-6 border-b border-silk-beige">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-primary-50 rounded-full flex items-center justify-center">
                                    <Target className="w-5 h-5 text-primary-500" />
                                </div>
                                <h2 className="text-lg font-bold text-charcoal">
                                    {editingProspect ? 'Editar Prospecto' : 'Nuevo Prospecto'}
                                </h2>
                            </div>
                            <button onClick={() => setShowProspectModal(false)} className="p-2 hover:bg-ivory rounded-soft transition-colors">
                                <X className="w-5 h-5 text-charcoal/50" />
                            </button>
                        </div>

                        <div className="p-6 space-y-4 overflow-y-auto flex-1">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="col-span-2">
                                    <label className="block text-sm font-medium text-charcoal mb-1">Nombre</label>
                                    <input
                                        type="text"
                                        value={prospectForm.name}
                                        onChange={e => setProspectForm(p => ({ ...p, name: e.target.value }))}
                                        className="input-soft w-full"
                                        placeholder="Nombre del prospecto"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-charcoal mb-1">Teléfono</label>
                                    <input
                                        type="tel"
                                        value={prospectForm.phone}
                                        onChange={e => setProspectForm(p => ({ ...p, phone: e.target.value }))}
                                        className="input-soft w-full"
                                        placeholder="+521234567890"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-charcoal mb-1">Email</label>
                                    <input
                                        type="email"
                                        value={prospectForm.email}
                                        onChange={e => setProspectForm(p => ({ ...p, email: e.target.value }))}
                                        className="input-soft w-full"
                                        placeholder="correo@ejemplo.com"
                                    />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-sm font-medium text-charcoal mb-1">Dirección</label>
                                    <input
                                        type="text"
                                        value={prospectForm.address}
                                        onChange={e => setProspectForm(p => ({ ...p, address: e.target.value }))}
                                        className="input-soft w-full"
                                        placeholder="Dirección del prospecto"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-charcoal mb-1">Servicio de interés</label>
                                    {services.length > 0 ? (
                                        <select
                                            value={prospectForm.service_interest}
                                            onChange={e => setProspectForm(p => ({ ...p, service_interest: e.target.value }))}
                                            className="input-soft w-full"
                                        >
                                            <option value="">Seleccionar...</option>
                                            {services.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                                        </select>
                                    ) : (
                                        <input
                                            type="text"
                                            value={prospectForm.service_interest}
                                            onChange={e => setProspectForm(p => ({ ...p, service_interest: e.target.value }))}
                                            className="input-soft w-full"
                                            placeholder="Ej: Botox, Limpieza..."
                                        />
                                    )}
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-charcoal mb-1">Fuente</label>
                                    <select
                                        value={prospectForm.source}
                                        onChange={e => setProspectForm(p => ({ ...p, source: e.target.value }))}
                                        className="input-soft w-full"
                                    >
                                        <option value="whatsapp">WhatsApp</option>
                                        <option value="instagram">Instagram</option>
                                        <option value="facebook">Facebook</option>
                                        <option value="website">Sitio Web</option>
                                        <option value="referido">Referido</option>
                                        <option value="otro">Otro</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-charcoal mb-1">Etapa</label>
                                    <select
                                        value={prospectForm.stage_id}
                                        onChange={e => setProspectForm(p => ({ ...p, stage_id: e.target.value }))}
                                        className="input-soft w-full"
                                    >
                                        <option value="">Sin etapa</option>
                                        {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-charcoal mb-1">Puntuación</label>
                                    <input
                                        type="number"
                                        min="0"
                                        max="100"
                                        value={prospectForm.score}
                                        onChange={e => setProspectForm(p => ({ ...p, score: parseInt(e.target.value) || 0 }))}
                                        className="input-soft w-full"
                                    />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-sm font-medium text-charcoal mb-1">Notas</label>
                                    <textarea
                                        value={prospectForm.notes}
                                        onChange={e => setProspectForm(p => ({ ...p, notes: e.target.value }))}
                                        className="input-soft w-full min-h-[80px] resize-y"
                                        placeholder="Notas internas sobre el prospecto..."
                                    />
                                </div>
                            </div>

                            {/* Tags selection */}
                            {tags.length > 0 && (
                                <div>
                                    <label className="block text-sm font-medium text-charcoal mb-2">Etiquetas</label>
                                    <div className="flex flex-wrap gap-2">
                                        {tags.map(tag => (
                                            <button
                                                key={tag.id}
                                                type="button"
                                                onClick={() => {
                                                    setSelectedFormTags(prev =>
                                                        prev.includes(tag.id)
                                                            ? prev.filter(t => t !== tag.id)
                                                            : [...prev, tag.id]
                                                    )
                                                }}
                                                className={cn(
                                                    'text-xs px-3 py-1.5 rounded-full border transition-all font-medium',
                                                    selectedFormTags.includes(tag.id)
                                                        ? 'text-white border-transparent'
                                                        : 'text-charcoal/60 border-silk-beige bg-white hover:bg-ivory'
                                                )}
                                                style={selectedFormTags.includes(tag.id) ? { backgroundColor: tag.color } : {}}
                                            >
                                                {tag.name}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="flex justify-end gap-3 p-6 border-t border-silk-beige">
                            <button onClick={() => setShowProspectModal(false)} className="btn-ghost">Cancelar</button>
                            <button
                                onClick={handleSaveProspect}
                                disabled={saving}
                                className="btn-primary flex items-center gap-2"
                            >
                                {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</>
                                    : <><Save className="w-4 h-4" /> {editingProspect ? 'Guardar' : 'Crear Prospecto'}</>}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Stage Config Modal */}
            {showStageConfig && createPortal(
                <div className="fixed inset-0 bg-charcoal/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                    <div className="bg-white rounded-soft shadow-premium-lg w-full max-w-md animate-scale-in">
                        <div className="flex items-center justify-between p-6 border-b border-silk-beige">
                            <h2 className="text-lg font-bold text-charcoal">Configurar Etapas</h2>
                            <button onClick={() => { setShowStageConfig(false); setEditingStage(null); setStageForm({ name: '', color: '#6366f1' }) }} className="p-2 hover:bg-ivory rounded-soft transition-colors">
                                <X className="w-5 h-5 text-charcoal/50" />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            {/* Existing stages */}
                            <div className="space-y-2">
                                {stages.map(s => (
                                    <div key={s.id} className="flex items-center gap-3 p-3 bg-ivory rounded-soft">
                                        <div className="flex flex-col gap-0.5">
                                            <button
                                                onClick={() => handleMoveStage(stages.indexOf(s), 'up')}
                                                disabled={stages.indexOf(s) === 0}
                                                className="p-0.5 hover:bg-white rounded text-charcoal/40 hover:text-charcoal disabled:opacity-20 disabled:hover:bg-transparent"
                                            >
                                                <ChevronUp className="w-3 h-3" />
                                            </button>
                                            <button
                                                onClick={() => handleMoveStage(stages.indexOf(s), 'down')}
                                                disabled={stages.indexOf(s) === stages.length - 1}
                                                className="p-0.5 hover:bg-white rounded text-charcoal/40 hover:text-charcoal disabled:opacity-20 disabled:hover:bg-transparent"
                                            >
                                                <ChevronDown className="w-3 h-3" />
                                            </button>
                                        </div>
                                        <div className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                                        <span className="text-sm font-medium text-charcoal flex-1">{s.name}</span>
                                        <button
                                            onClick={() => { setEditingStage(s); setStageForm({ name: s.name, color: s.color }) }}
                                            className="p-1 hover:bg-white rounded transition-colors"
                                        >
                                            <Edit2 className="w-3.5 h-3.5 text-charcoal/50" />
                                        </button>
                                        <button
                                            onClick={() => handleDeleteStage(s.id)}
                                            className="p-1 hover:bg-red-50 rounded transition-colors"
                                        >
                                            <Trash2 className="w-3.5 h-3.5 text-red-400" />
                                        </button>
                                    </div>
                                ))}
                            </div>

                            {/* Add/Edit form */}
                            <div className="border-t border-silk-beige pt-4">
                                <p className="text-sm font-medium text-charcoal mb-2">
                                    {editingStage ? 'Editar etapa' : 'Agregar etapa'}
                                </p>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={stageForm.name}
                                        onChange={e => setStageForm(p => ({ ...p, name: e.target.value }))}
                                        className="input-soft flex-1"
                                        placeholder="Nombre de la etapa"
                                    />
                                    <input
                                        type="color"
                                        value={stageForm.color}
                                        onChange={e => setStageForm(p => ({ ...p, color: e.target.value }))}
                                        className="w-10 h-10 rounded-soft cursor-pointer border border-silk-beige"
                                    />
                                    <button onClick={handleSaveStage} className="btn-primary px-3">
                                        {editingStage ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Tag Manager Modal */}
            {showTagManager && createPortal(
                <div className="fixed inset-0 bg-charcoal/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                    <div className="bg-white rounded-soft shadow-premium-lg w-full max-w-md animate-scale-in">
                        <div className="flex items-center justify-between p-6 border-b border-silk-beige">
                            <h2 className="text-lg font-bold text-charcoal">Gestionar Etiquetas</h2>
                            <button onClick={() => setShowTagManager(false)} className="p-2 hover:bg-ivory rounded-soft transition-colors">
                                <X className="w-5 h-5 text-charcoal/50" />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            {/* Existing tags */}
                            <div className="flex flex-wrap gap-2">
                                {tags.map(t => (
                                    <div key={t.id} className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-full text-white font-medium group" style={{ backgroundColor: t.color }}>
                                        {t.name}
                                        <button onClick={() => handleDeleteTag(t.id)} className="ml-0.5 opacity-60 hover:opacity-100">
                                            <X className="w-3 h-3" />
                                        </button>
                                    </div>
                                ))}
                                {tags.length === 0 && (
                                    <p className="text-sm text-charcoal/40">No hay etiquetas creadas</p>
                                )}
                            </div>

                            {/* Add form */}
                            <div className="border-t border-silk-beige pt-4">
                                <p className="text-sm font-medium text-charcoal mb-2">Nueva etiqueta</p>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={tagForm.name}
                                        onChange={e => setTagForm(p => ({ ...p, name: e.target.value }))}
                                        className="input-soft flex-1"
                                        placeholder="Ej: VIP, Interesado, Facebook..."
                                    />
                                    <div className="flex gap-1">
                                        {TAG_COLORS.map(c => (
                                            <button
                                                key={c}
                                                onClick={() => setTagForm(p => ({ ...p, color: c }))}
                                                className={cn(
                                                    'w-7 h-7 rounded-full border-2 transition-all',
                                                    tagForm.color === c ? 'border-charcoal scale-110' : 'border-transparent'
                                                )}
                                                style={{ backgroundColor: c }}
                                            />
                                        ))}
                                    </div>
                                </div>
                                <button
                                    onClick={handleSaveTag}
                                    disabled={!tagForm.name.trim()}
                                    className="btn-primary mt-3 w-full flex items-center justify-center gap-2"
                                >
                                    <Plus className="w-4 h-4" /> Crear Etiqueta
                                </button>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    )
}
