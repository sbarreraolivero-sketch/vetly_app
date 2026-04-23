import { useState, useEffect, useCallback } from 'react'
import {
    BookOpen,
    Plus,
    Search,
    FileText,
    CheckCircle2,
    Clock,
    Tag,
    Loader2,
    X,
    Save,
    Trash2,
    Edit3,
    ToggleLeft,
    ToggleRight,
    Upload,
    AlertCircle,
    Bot,
    Sparkles,
    Lightbulb,
    Check,
    Info,
    DollarSign,
    Globe,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { GuideBox } from '@/components/ui/GuideBox'

interface KnowledgeDocument {
    id: string
    clinic_id: string
    title: string
    content: string
    category: string
    status: 'active' | 'inactive'
    sync_status: 'synced' | 'pending'
    created_at: string
    updated_at: string
}

const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
    general: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
    precios: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
    servicios: { bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200' },
    casos_uso: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
    faq: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
    politicas: { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200' },
    promociones: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
    horarios: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200' },
}

const CATEGORY_OPTIONS = [
    { value: 'general', label: 'General' },
    { value: 'precios', label: 'Precios' },
    { value: 'servicios', label: 'Servicios' },
    { value: 'casos_uso', label: 'Casos de Uso' },
    { value: 'faq', label: 'Preguntas Frecuentes' },
    { value: 'politicas', label: 'Políticas' },
    { value: 'promociones', label: 'Promociones' },
    { value: 'horarios', label: 'Horarios' },
]

function getCategoryColor(category: string) {
    return CATEGORY_COLORS[category] || CATEGORY_COLORS.general
}

export default function KnowledgeBase() {
    const { profile } = useAuth()
    const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')
    const [filterCategory, setFilterCategory] = useState('all')
    const [filterStatus, setFilterStatus] = useState('all')
    const [showModal, setShowModal] = useState(false)
    const [editingDoc, setEditingDoc] = useState<KnowledgeDocument | null>(null)
    const [saving, setSaving] = useState(false)
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

    // AI Master Prompt/Behavior Rules state
    const [masterPrompt, setMasterPrompt] = useState('')
    const [behaviorRules, setBehaviorRules] = useState('')
    const [transferDetails, setTransferDetails] = useState('')
    const [logisticsConfig, setLogisticsConfig] = useState({
        locations: [
            { 
                id: '1', 
                name: 'Linares Urbano', 
                lat: -35.8453, 
                lng: -71.5979, 
                type: 'operational',
                max_time_mins: 30,
                time_ranges: [
                    { min: 0, max: 10, surcharge: 0, label: 'Urbano' },
                    { min: 11, max: 20, surcharge: 6000, label: 'Rural 1' },
                    { min: 21, max: 30, surcharge: 8000, label: 'Rural 2' }
                ]
            }
        ],
        is_active: true
    })
    const [savingPrompt, setSavingPrompt] = useState(false)
    const [promptSaved, setPromptSaved] = useState(false)
    const [showPromptSection, setShowPromptSection] = useState(true)

    // Form state
    const [formTitle, setFormTitle] = useState('')
    const [formContent, setFormContent] = useState('')
    const [formCategory, setFormCategory] = useState('general')
    const [formStatus, setFormStatus] = useState<'active' | 'inactive'>('active')

    // File upload
    const [uploadingFile, setUploadingFile] = useState(false)

    const fetchDocuments = useCallback(async () => {
        if (!profile?.clinic_id) return

        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data, error } = await (supabase as any)
                .from('knowledge_base')
                .select('*')
                .eq('clinic_id', profile.clinic_id)
                .order('updated_at', { ascending: false })

            if (error) throw error
            setDocuments(data || [])
        } catch (error) {
            console.error('Error fetching knowledge base:', error)
        } finally {
            setLoading(false)
        }
    }, [profile?.clinic_id])

    // Fetch AI master prompt
    const fetchMasterPrompt = useCallback(async () => {
        if (!profile?.clinic_id) return
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data } = await (supabase as any)
                .from('clinic_settings')
                .select('ai_personality, ai_behavior_rules, transfer_details, logistics_config')
                .eq('id', profile.clinic_id)
                .single()
            if (data?.ai_personality) setMasterPrompt(data.ai_personality)
            if (data?.ai_behavior_rules) setBehaviorRules(data.ai_behavior_rules)
            if (data?.transfer_details) setTransferDetails(data.transfer_details)
            
                // Migration: Handle old schema if necessary
                let finalConfig = data.logistics_config;
                if (finalConfig && !finalConfig.locations) {
                    finalConfig = {
                        is_active: finalConfig.is_active ?? true,
                        locations: [
                            { 
                                id: '1', 
                                name: 'Base Principal', 
                                lat: finalConfig.base_coordinates?.lat || -35.8450, 
                                lng: finalConfig.base_coordinates?.lng || -71.5979,
                                type: 'operational',
                                max_time_mins: 30,
                                time_ranges: [
                                    { min: 0, max: 10, surcharge: 0, label: 'Urbano' }
                                ]
                            }
                        ]
                    };
                }

                if (finalConfig) setLogisticsConfig(finalConfig)
        } catch (e) {
            console.error('Error fetching master prompt:', e)
        }
    }, [profile?.clinic_id])

    const handleSaveMasterPrompt = async () => {
        if (!profile?.clinic_id) {
            alert('No se pudo identificar tu clínica. Refresca la página e intenta de nuevo.')
            return
        }
        setSavingPrompt(true)
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error } = await (supabase as any)
                .from('clinic_settings')
                .update({
                    ai_personality: masterPrompt.trim(),
                    ai_behavior_rules: behaviorRules.trim(),
                    transfer_details: transferDetails.trim(),
                    logistics_config: logisticsConfig,
                    updated_at: new Date().toISOString()
                })
                .eq('id', profile.clinic_id)
            if (error) throw error
            setPromptSaved(true)
            setTimeout(() => setPromptSaved(false), 3000)
        } catch (e: any) {
            console.error('Error saving prompt settings:', e)
            const errorMsg = e?.message || ''
            if (errorMsg.includes('permission denied') || e?.code === '42501') {
                alert('No tienes los permisos necesarios para modificar la configuración de la clínica. Solo los Administradores o Dueños pueden realizar esta acción.')
            } else {
                alert('Error al guardar la configuración. Por favor, verifica tu conexión e intenta de nuevo.')
            }
        } finally {
            setSavingPrompt(false)
        }
    }

    useEffect(() => {
        fetchDocuments()
        fetchMasterPrompt()
    }, [fetchDocuments, fetchMasterPrompt])

    // Stats
    const totalDocs = documents.length
    const syncedDocs = documents.filter(d => d.sync_status === 'synced').length
    const pendingDocs = documents.filter(d => d.sync_status === 'pending').length
    const uniqueCategories = [...new Set(documents.map(d => d.category))].length

    // Filtered documents
    const filteredDocuments = documents.filter(doc => {
        const matchesSearch =
            doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            doc.content.toLowerCase().includes(searchQuery.toLowerCase())
        const matchesCategory = filterCategory === 'all' || doc.category === filterCategory
        const matchesStatus = filterStatus === 'all' || doc.status === filterStatus
        return matchesSearch && matchesCategory && matchesStatus
    })

    const openNewModal = () => {
        setEditingDoc(null)
        setFormTitle('')
        setFormContent('')
        setFormCategory('general')
        setFormStatus('active')
        setShowModal(true)
    }

    const openEditModal = (doc: KnowledgeDocument) => {
        setEditingDoc(doc)
        setFormTitle(doc.title)
        setFormContent(doc.content)
        setFormCategory(doc.category)
        setFormStatus(doc.status)
        setShowModal(true)
    }

    const closeModal = () => {
        setShowModal(false)
        setEditingDoc(null)
        setFormTitle('')
        setFormContent('')
        setFormCategory('general')
        setFormStatus('active')
    }

    const handleSave = async () => {
        if (!profile?.clinic_id) {
            alert('No se pudo identificar tu clínica. Refresca la página e intenta de nuevo.')
            return
        }
        
        if (!formTitle.trim() || !formContent.trim()) {
            alert('Por favor, completa el título y el contenido del documento.')
            return
        }

        setSaving(true)
        try {
            if (editingDoc) {
                // Update
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { error } = await (supabase as any)
                    .from('knowledge_base')
                    .update({
                        title: formTitle.trim(),
                        content: formContent.trim(),
                        category: formCategory,
                        status: formStatus,
                        sync_status: 'synced',
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', editingDoc.id)

                if (error) throw error
            } else {
                // Create
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { error } = await (supabase as any)
                    .from('knowledge_base')
                    .insert({
                        clinic_id: profile.clinic_id,
                        title: formTitle.trim(),
                        content: formContent.trim(),
                        category: formCategory,
                        status: formStatus,
                        sync_status: 'synced',
                    })

                if (error) throw error
            }

            closeModal()
            fetchDocuments()
        } catch (error: any) {
            console.error('Error saving document:', error)
            const errorMsg = error?.message || ''
            if (errorMsg.includes('permission denied') || error?.code === '42501') {
                alert('No tienes permisos suficientes para guardar cambios en la base de conocimiento.')
            } else {
                alert('Ocurrió un error al intentar guardar el documento. Por favor, verifica tu conexión e intenta de nuevo.')
            }
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async (id: string) => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error } = await (supabase as any)
                .from('knowledge_base')
                .delete()
                .eq('id', id)

            if (error) throw error
            setDeleteConfirm(null)
            fetchDocuments()
        } catch (error) {
            console.error('Error deleting document:', error)
            alert('Error al eliminar el documento.')
        }
    }

    const handleToggleStatus = async (doc: KnowledgeDocument) => {
        const newStatus = doc.status === 'active' ? 'inactive' : 'active'
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error } = await (supabase as any)
                .from('knowledge_base')
                .update({ status: newStatus, updated_at: new Date().toISOString() })
                .eq('id', doc.id)

            if (error) throw error
            fetchDocuments()
        } catch (error) {
            console.error('Error toggling status:', error)
        }
    }

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        setUploadingFile(true)
        try {
            const text = await file.text()
            setFormTitle(file.name.replace(/\.[^/.]+$/, ''))
            setFormContent(text)
            if (!showModal) {
                setEditingDoc(null)
                setFormCategory('general')
                setFormStatus('active')
                setShowModal(true)
            }
        } catch (error) {
            console.error('Error reading file:', error)
            alert('Error al leer el archivo. Asegúrate de que sea un archivo de texto.')
        } finally {
            setUploadingFile(false)
            e.target.value = ''
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-96">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
                    <p className="text-charcoal/50">Cargando base de conocimiento...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Header Banner */}
            <div className="bg-hero-gradient rounded-softer p-6 text-white shadow-soft-md relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-16 -mt-16 blur-2xl" />
                
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 bg-premium-gradient rounded-full flex items-center justify-center shadow-lg shrink-0">
                            <BookOpen className="w-7 h-7 text-charcoal" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-white tracking-tight">Base de Conocimiento</h1>
                            <p className="text-white/80 text-sm mt-1 max-w-2xl leading-relaxed">
                                🧠 Entrena a tu Agente IA con datos sobre tu clínica, servicios y procedimientos para que atienda a tus pacientes, maneje recordatorios y resuelva dudas sin errores.
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap">
                        <label className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-soft text-sm font-medium text-white transition-all cursor-pointer backdrop-blur-sm">
                            <Upload className="w-4 h-4" />
                            {uploadingFile ? 'Leyendo...' : 'Subir Archivo'}
                            <input
                                type="file"
                                accept=".txt,.md,.csv,.json"
                                onChange={handleFileUpload}
                                className="hidden"
                            />
                        </label>
                        <button
                            onClick={openNewModal}
                            className="bg-white text-primary-700 hover:bg-ivory px-5 py-2 rounded-soft text-sm font-bold transition-all shadow-sm flex items-center gap-2"
                        >
                            <Plus className="w-4 h-4" />
                            Nuevo Registro
                        </button>
                    </div>
                </div>
            </div>

            {/* AI Agent Master Prompt Section */}
            <div className="card-soft overflow-hidden">
                <button
                    onClick={() => setShowPromptSection(!showPromptSection)}
                    className="w-full p-5 flex items-center justify-between hover:bg-ivory/50 transition-colors"
                >
                    <div className="flex items-center gap-4">
                        <div className="w-11 h-11 bg-premium-gradient rounded-soft flex items-center justify-center shadow-md">
                            <Bot className="w-5.5 h-5.5 text-charcoal" />
                        </div>
                        <div className="text-left">
                            <h2 className="text-lg font-semibold text-charcoal flex items-center gap-2">
                                Agente IA
                                <Sparkles className="w-4 h-4 text-violet-500" />
                            </h2>
                            <p className="text-sm text-charcoal/50">Master Prompt — Define la personalidad y comportamiento de tu asistente</p>
                        </div>
                    </div>
                    <svg className={`w-5 h-5 text-charcoal/40 transition-transform ${showPromptSection ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </button>

                {showPromptSection && (
                    <div className="px-5 pb-5 space-y-4 border-t border-silk-beige/50">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-sm font-medium text-charcoal">Master Prompt (Personalidad)</label>
                                    <span className="text-xs text-charcoal/40">{masterPrompt.length} caracteres</span>
                                </div>
                                <textarea
                                    value={masterPrompt}
                                    onChange={(e) => setMasterPrompt(e.target.value)}
                                    placeholder={`Ej: Eres Ary, una asistente amable y experta para una clínica veterinaria móvil.\n\nReglas:\n- Responde de manera empática, profesional y clara\n- Nunca inventes precios o servicios que no existan\n- Usa emojis como 🐶 o 🐱 para dar calidez\n- Siempre sugiere agendar una cita cuando el tutor muestre interés real\n- Si no sabes algo, ofrece comunicar al cliente con el equipo médico`}
                                    rows={8}
                                    className="input-soft w-full resize-none font-mono text-sm leading-relaxed"
                                />
                                <GuideBox 
                                    title="Guía: Personalidad de la IA" 
                                    summary="Define el tono, voz y alma de tu clínica."
                                >
                                    <p>La <b>personalidad</b> determina cómo se siente hablar con tu clínica. Una buena personalidad genera confianza y cercanía inmediata.</p>
                                    <div className="bg-white/50 p-3 rounded-soft border border-silk-beige/30">
                                        <p className="font-bold mb-1.5 flex items-center gap-1.5 text-primary-700 text-[11px]">
                                            <Check className="w-3.5 h-3.5" /> EJEMPLO RECOMENDADO:
                                        </p>
                                        <p className="italic text-[11.5px] leading-relaxed text-charcoal/80">"Eres un asesor experto en salud veterinaria. Habla de manera empática y profesional sobre el cuidado de las mascotas. Usa 'nosotros' para referirte a la clínica y enfócate siempre en resolver dudas sobre bienestar animal."</p>
                                    </div>
                                    <div className="mt-3 grid grid-cols-2 gap-2 text-[10.5px]">
                                        <div className="p-2 bg-silk-beige/20 rounded border border-silk-beige/30">
                                            <b>🎩 Formal:</b> Ideal para hospitales veterinarios o centros quirúrgicos.
                                        </div>
                                        <div className="p-2 bg-silk-beige/20 rounded border border-silk-beige/30">
                                            <b>✨ Cercana:</b> Ideal para clínicas veterinarias móviles, peluquerías caninas o pet shops.
                                        </div>
                                    </div>
                                </GuideBox>
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-sm font-medium text-charcoal">Instrucciones de Comportamiento</label>
                                    <span className="text-xs text-charcoal/60">{behaviorRules.length} caracteres</span>
                                </div>
                                <textarea
                                    value={behaviorRules}
                                    onChange={(e) => setBehaviorRules(e.target.value)}
                                    placeholder={`Instrucciones específicas de atención:\n- Saluda siempre preguntando el nombre si no lo sabes.\n- Si te preguntan por precios, redirige a la tabla de servicios.\n- Si el cliente está molesto, escala a un humano inmediatamente.`}
                                    rows={8}
                                    className="input-soft w-full resize-none font-mono text-sm leading-relaxed"
                                />
                                <GuideBox 
                                    title="Guía: Reglas de Atención" 
                                    summary="Reglas tácticas para manejar conversaciones."
                                >
                                    <p>Las <b>reglas de comportamiento</b> dictan qué debe (y qué no) hacer el bot en situaciones críticas de atención al cliente.</p>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                                        <div className="bg-emerald-50/50 p-2.5 rounded-soft border border-emerald-100">
                                            <p className="font-bold text-emerald-700 text-xs font-bold uppercase tracking-wider mb-1.5">✅ LO QUE SÍ DEBE HACER:</p>
                                            <ul className="text-[10.5px] space-y-1 text-emerald-800/80">
                                                <li>• Saludar preguntando el nombre.</li>
                                                <li>• Sugerir cita ante cualquier interés.</li>
                                                <li>• Usar emojis amigables (🐶🐱🐾).</li>
                                                <li>• Confirmar disponibilidad antes de citar.</li>
                                            </ul>
                                        </div>
                                        <div className="bg-red-50/50 p-2.5 rounded-soft border border-red-100">
                                            <p className="font-bold text-red-700 text-xs font-bold uppercase tracking-wider mb-1.5">❌ LO QUE NO DEBE HACER:</p>
                                            <ul className="text-[10.5px] space-y-1 text-red-800/80">
                                                <li>• No dar precios sin explicar el valor.</li>
                                                <li>• No discutir ni usar lenguaje demasiado técnico.</li>
                                                <li>• No prometer resultados médicos garantizados.</li>
                                                <li>• No agendar sin el abono requerido.</li>
                                            </ul>
                                        </div>
                                    </div>
                                </GuideBox>
                            </div>
                        </div>

                        {/* NEW: Advanced Logistics Section */}
                        <div className="border-t border-silk-beige/30 pt-6 mt-2">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2">
                                    <Tag className="w-5 h-5 text-primary-500" />
                                    <h3 className="text-sm font-bold text-charcoal uppercase tracking-wider">Logística Pro (Tramos por Tiempo)</h3>
                                </div>
                                <button 
                                    onClick={() => {
                                        const newLoc = {
                                            id: Math.random().toString(36).substr(2, 9),
                                            name: `Nueva Sede ${logisticsConfig.locations.length + 1}`,
                                            lat: -35.8450,
                                            lng: -71.5979,
                                            type: 'operational',
                                            max_time_mins: 30,
                                            time_ranges: [{ min: 0, max: 10, surcharge: 0, label: 'T1' }]
                                        };
                                        setLogisticsConfig({
                                            ...logisticsConfig,
                                            locations: [...logisticsConfig.locations, newLoc]
                                        });
                                    }}
                                    className="btn-primary py-1 px-3 text-xs flex items-center gap-1.5"
                                >
                                    <Plus className="w-3.5 h-3.5" /> Agregar Sede/Hub
                                </button>
                            </div>

                            <div className="space-y-4">
                                {logisticsConfig.locations.map((loc, index) => (
                                    <div key={loc.id} className="bg-white rounded-soft border border-silk-beige/60 shadow-sm overflow-hidden group">
                                        <div className="p-3 bg-ivory/30 border-b border-silk-beige/40 flex items-center justify-between gap-4">
                                            <div className="flex items-center gap-3 flex-1">
                                                <input
                                                    type="text"
                                                    value={loc.name}
                                                    onChange={(e) => {
                                                        const newLocs = [...logisticsConfig.locations];
                                                        newLocs[index].name = e.target.value;
                                                        setLogisticsConfig({ ...logisticsConfig, locations: newLocs });
                                                    }}
                                                    className="bg-transparent border-none p-0 text-sm font-bold text-charcoal focus:ring-0 w-full"
                                                />
                                                <select
                                                    value={loc.type}
                                                    onChange={(e) => {
                                                        const newLocs = [...logisticsConfig.locations];
                                                        newLocs[index].type = e.target.value as any;
                                                        setLogisticsConfig({ ...logisticsConfig, locations: newLocs });
                                                    }}
                                                    className="bg-white border border-silk-beige/50 text-[10px] font-bold uppercase rounded px-2 py-0.5"
                                                >
                                                    <option value="operational">Base Operativa (Domicilios)</option>
                                                    <option value="surgical_hub">Clínica Socia (Cirugías)</option>
                                                </select>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <div className="flex items-center gap-1 bg-white px-2 py-1 rounded border border-silk-beige/50">
                                                    <span className="text-[9px] uppercase font-bold text-charcoal/40">Límite:</span>
                                                    <input
                                                        type="number"
                                                        value={loc.max_time_mins}
                                                        onChange={(e) => {
                                                            const newLocs = [...logisticsConfig.locations];
                                                            newLocs[index].max_time_mins = parseInt(e.target.value);
                                                            setLogisticsConfig({ ...logisticsConfig, locations: newLocs });
                                                        }}
                                                        className="w-8 text-[10px] font-bold bg-transparent border-none p-0 focus:ring-0"
                                                    />
                                                    <span className="text-[9px] font-bold text-charcoal/40">min</span>
                                                </div>
                                                <button 
                                                    onClick={() => {
                                                        const newLocs = logisticsConfig.locations.filter(l => l.id !== loc.id);
                                                        setLogisticsConfig({ ...logisticsConfig, locations: newLocs });
                                                    }}
                                                    className="text-red-400 p-1 hover:bg-red-50 rounded transition-colors"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>
                                        
                                        <div className="p-4 grid grid-cols-1 lg:grid-cols-12 gap-6">
                                            {/* GPS Coords */}
                                            <div className="lg:col-span-3 space-y-3">
                                                <div className="space-y-1">
                                                    <label className="text-[10px] uppercase font-bold text-charcoal/40 tracking-wider">Latitud</label>
                                                    <input
                                                        type="number"
                                                        step="0.0001"
                                                        value={loc.lat}
                                                        onChange={(e) => {
                                                            const newLocs = [...logisticsConfig.locations];
                                                            newLocs[index].lat = parseFloat(e.target.value);
                                                            setLogisticsConfig({ ...logisticsConfig, locations: newLocs });
                                                        }}
                                                        className="input-soft w-full text-xs"
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-[10px] uppercase font-bold text-charcoal/40 tracking-wider">Longitud</label>
                                                    <input
                                                        type="number"
                                                        step="0.0001"
                                                        value={loc.lng}
                                                        onChange={(e) => {
                                                            const newLocs = [...logisticsConfig.locations];
                                                            newLocs[index].lng = parseFloat(e.target.value);
                                                            setLogisticsConfig({ ...logisticsConfig, locations: newLocs });
                                                        }}
                                                        className="input-soft w-full text-xs"
                                                    />
                                                </div>
                                            </div>

                                            {/* Time Ranges Table */}
                                            <div className="lg:col-span-9 space-y-3">
                                                <div className="flex items-center justify-between">
                                                    <label className="text-[10px] uppercase font-bold text-charcoal/40 tracking-wider">Tramos de Tiempo y Recargos</label>
                                                    <button 
                                                        onClick={() => {
                                                            const newLocs = [...logisticsConfig.locations];
                                                            const lastMax = newLocs[index].time_ranges[newLocs[index].time_ranges.length - 1]?.max || 0;
                                                            newLocs[index].time_ranges.push({
                                                                min: lastMax + 1,
                                                                max: lastMax + 10,
                                                                surcharge: 0,
                                                                label: `T${newLocs[index].time_ranges.length + 1}`
                                                            });
                                                            setLogisticsConfig({ ...logisticsConfig, locations: newLocs });
                                                        }}
                                                        className="text-[10px] text-primary-600 font-bold hover:underline"
                                                    >
                                                        + Agregar Tramo
                                                    </button>
                                                </div>
                                                <div className="bg-silk-beige/10 rounded border border-silk-beige/30 overflow-hidden">
                                                    <table className="w-full text-left border-collapse">
                                                        <thead className="bg-silk-beige/20 text-[9px] uppercase font-bold text-charcoal/40">
                                                            <tr>
                                                                <th className="px-3 py-2">Etiqueta/Tramo</th>
                                                                <th className="px-3 py-2 text-center">Minutos (Min - Max)</th>
                                                                <th className="px-3 py-2 text-right">Recargo ($)</th>
                                                                <th className="px-3 py-2 w-10"></th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-silk-beige/20">
                                                            {loc.time_ranges.map((range, rIndex) => (
                                                                <tr key={rIndex} className="text-[11px] hover:bg-white/50 transition-colors">
                                                                    <td className="px-3 py-2">
                                                                        <input
                                                                            type="text"
                                                                            value={range.label}
                                                                            onChange={(e) => {
                                                                                const newLocs = [...logisticsConfig.locations];
                                                                                newLocs[index].time_ranges[rIndex].label = e.target.value;
                                                                                setLogisticsConfig({ ...logisticsConfig, locations: newLocs });
                                                                            }}
                                                                            className="bg-transparent border-none p-0 w-20 focus:ring-0 font-medium"
                                                                        />
                                                                    </td>
                                                                    <td className="px-3 py-2">
                                                                        <div className="flex items-center justify-center gap-2">
                                                                            <input
                                                                                type="number"
                                                                                value={range.min}
                                                                                onChange={(e) => {
                                                                                    const newLocs = [...logisticsConfig.locations];
                                                                                    newLocs[index].time_ranges[rIndex].min = parseInt(e.target.value);
                                                                                    setLogisticsConfig({ ...logisticsConfig, locations: newLocs });
                                                                                }}
                                                                                className="w-10 text-center bg-silk-beige/30 rounded border-none py-0.5 focus:ring-1 focus:ring-primary-400"
                                                                            />
                                                                            <span>-</span>
                                                                            <input
                                                                                type="number"
                                                                                value={range.max}
                                                                                onChange={(e) => {
                                                                                    const newLocs = [...logisticsConfig.locations];
                                                                                    newLocs[index].time_ranges[rIndex].max = parseInt(e.target.value);
                                                                                    setLogisticsConfig({ ...logisticsConfig, locations: newLocs });
                                                                                }}
                                                                                className="w-10 text-center bg-silk-beige/30 rounded border-none py-0.5 focus:ring-1 focus:ring-primary-400"
                                                                            />
                                                                        </div>
                                                                    </td>
                                                                    <td className="px-3 py-2 text-right">
                                                                        <div className="flex justify-end items-center gap-1">
                                                                            <span className="text-charcoal/40">$</span>
                                                                            <input
                                                                                type="number"
                                                                                value={range.surcharge}
                                                                                onChange={(e) => {
                                                                                    const newLocs = [...logisticsConfig.locations];
                                                                                    newLocs[index].time_ranges[rIndex].surcharge = parseInt(e.target.value);
                                                                                    setLogisticsConfig({ ...logisticsConfig, locations: newLocs });
                                                                                }}
                                                                                className="w-20 text-right bg-emerald-50/50 rounded border-none py-0.5 focus:ring-1 focus:ring-emerald-400"
                                                                            />
                                                                        </div>
                                                                    </td>
                                                                    <td className="px-3 py-2 text-center">
                                                                        <button 
                                                                            onClick={() => {
                                                                                const newLocs = [...logisticsConfig.locations];
                                                                                newLocs[index].time_ranges.splice(rIndex, 1);
                                                                                setLogisticsConfig({ ...logisticsConfig, locations: newLocs });
                                                                            }}
                                                                            className="text-charcoal/20 hover:text-red-500 transition-colors"
                                                                        >
                                                                            <X className="w-3 h-3" />
                                                                        </button>
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            
                            <div className="mt-4 flex items-center gap-2 p-3 bg-primary-50/50 rounded-soft border border-primary-200/50">
                                <label className="flex items-center gap-3 cursor-pointer group">
                                    <div className="relative">
                                        <input
                                            type="checkbox"
                                            checked={logisticsConfig.is_active}
                                            onChange={(e) => setLogisticsConfig({ ...logisticsConfig, is_active: e.target.checked })}
                                            className="sr-only"
                                        />
                                        <div className={`w-10 h-5 rounded-full transition-colors ${logisticsConfig.is_active ? 'bg-emerald-500' : 'bg-charcoal/20'}`}></div>
                                        <div className={`absolute top-1 left-1 w-3 h-3 bg-white rounded-full shadow-sm transition-transform ${logisticsConfig.is_active ? 'translate-x-5' : 'translate-x-0'}`}></div>
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-[11px] font-bold text-charcoal uppercase tracking-wider">Activar Motor Logístico Pro</span>
                                        <span className="text-[10px] text-charcoal/50">Utiliza Google Maps para validar tramos de tiempo.</span>
                                    </div>
                                </label>
                            </div>
                        </div>

                        <div className="mt-8">
                            <div className="flex items-center justify-between mb-2">
                                <label className="text-sm font-medium text-charcoal">Datos Oficiales (Transferencia / Pagos)</label>
                                <span className="text-xs text-charcoal/40">{transferDetails.length} caracteres</span>
                            </div>
                            <textarea
                                value={transferDetails}
                                onChange={(e) => setTransferDetails(e.target.value)}
                                placeholder={`Ej: Datos para el abono de reserva ($15.000):\n- Nombre: [Nombre del Titular]\n- RUT: [12.345.678-9]\n- Banco: [Nombre del Banco]\n- Tipo de Cuenta: [Corriente/Vista]\n- Número de Cuenta: [1234567890]\n- Email: pagos@tuclínica.com`}
                                rows={6}
                                className="input-soft w-full resize-none font-mono text-sm leading-relaxed"
                            />
                            <GuideBox 
                                title="Guía: Pagos y Datos de Transferencia" 
                                summary="Configura la información bancaria oficial para reservas."
                            >
                                <p>Esta información es <b>crítica</b> para cerrar procesos de reserva. El bot solo la entrega cuando el paciente ya está listo para pagar o confirmar una cita.</p>
                                <div className="bg-white/50 p-3 rounded-soft border border-silk-beige/30 mt-2">
                                    <p className="font-bold mb-2 flex items-center gap-1.5 text-amber-700 text-[11px] uppercase tracking-wider">
                                        <Info className="w-3.5 h-3.5" /> Datos recomendados:
                                    </p>
                                    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-[11px] text-charcoal/80">
                                        <li className="flex items-center gap-1.5"><div className="w-1 h-1 bg-amber-400 rounded-full" /> Nombre del Titular</li>
                                        <li className="flex items-center gap-1.5"><div className="w-1 h-1 bg-amber-400 rounded-full" /> RUT de la Empresa/Persona</li>
                                        <li className="flex items-center gap-1.5"><div className="w-1 h-1 bg-amber-400 rounded-full" /> Banco y Tipo de Cuenta</li>
                                        <li className="flex items-center gap-1.5"><div className="w-1 h-1 bg-amber-400 rounded-full" /> Número de Cuenta</li>
                                        <li className="flex items-center gap-1.5"><div className="w-1 h-1 bg-amber-400 rounded-full" /> Link de pago (Transbank/Flow)</li>
                                        <li className="flex items-center gap-1.5"><div className="w-1 h-1 bg-amber-400 rounded-full" /> Política de Devoluciones</li>
                                    </ul>
                                </div>
                                <p className="text-xs font-bold text-charcoal/50 mt-3 italic flex items-center gap-1.5">
                                    <Lightbulb className="w-3 h-3" /> Tip: Incluir un email para comprobantes acelera la validación manual por parte de tu equipo.
                                </p>
                            </GuideBox>
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={handleSaveMasterPrompt}
                                disabled={savingPrompt}
                                className="btn-primary flex items-center gap-2"
                            >
                                {savingPrompt ? (
                                    <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</>
                                ) : (
                                    <><Save className="w-4 h-4" /> Guardar Prompt</>
                                )}
                            </button>
                            {promptSaved && (
                                <div className="flex items-center gap-2 text-emerald-600 text-sm animate-fade-in bg-emerald-50 px-3 py-1.5 rounded-soft">
                                    <CheckCircle2 className="w-4 h-4" />
                                    ¡Guardado!
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="card-soft p-5 flex items-center justify-between group hover:shadow-premium transition-shadow">
                    <div>
                        <p className="text-xs font-medium text-charcoal/50 uppercase tracking-wider">Total Documentos</p>
                        <p className="text-3xl font-bold text-charcoal mt-1">{totalDocs}</p>
                    </div>
                    <div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center text-blue-500 group-hover:scale-110 transition-transform">
                        <FileText className="w-5 h-5" />
                    </div>
                </div>
                <div className="card-soft p-5 flex items-center justify-between group hover:shadow-premium transition-shadow">
                    <div>
                        <p className="text-xs font-medium text-charcoal/50 uppercase tracking-wider">Sincronizados</p>
                        <p className="text-3xl font-bold text-emerald-600 mt-1">{syncedDocs}</p>
                    </div>
                    <div className="w-10 h-10 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-500 group-hover:scale-110 transition-transform">
                        <CheckCircle2 className="w-5 h-5" />
                    </div>
                </div>
                <div className="card-soft p-5 flex items-center justify-between group hover:shadow-premium transition-shadow">
                    <div>
                        <p className="text-xs font-medium text-charcoal/50 uppercase tracking-wider">Pendientes</p>
                        <p className="text-3xl font-bold text-amber-600 mt-1">{pendingDocs}</p>
                    </div>
                    <div className="w-10 h-10 bg-amber-50 rounded-full flex items-center justify-center text-amber-500 group-hover:scale-110 transition-transform">
                        <Clock className="w-5 h-5" />
                    </div>
                </div>
                <div className="card-soft p-5 flex items-center justify-between group hover:shadow-premium transition-shadow">
                    <div>
                        <p className="text-xs font-medium text-charcoal/50 uppercase tracking-wider">Categorías</p>
                        <p className="text-3xl font-bold text-violet-600 mt-1">{uniqueCategories}</p>
                    </div>
                    <div className="w-10 h-10 bg-violet-50 rounded-full flex items-center justify-center text-violet-500 group-hover:scale-110 transition-transform">
                        <Tag className="w-5 h-5" />
                    </div>
                </div>
            </div>

            {/* Search & Filters */}
            <div className="mt-8 mb-4 flex items-center gap-3">
                <div className="w-10 h-10 bg-premium-gradient rounded-soft flex items-center justify-center shadow-sm shrink-0">
                    <BookOpen className="w-5 h-5 text-charcoal" />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-charcoal">Documentos de Conocimiento</h2>
                    <GuideBox 
                        title="Guía: Tu Biblioteca Técnica" 
                        summary="Usa esto como el cerebro estático de la IA."
                    >
                        <p>Aquí vive toda la información técnica que no cambia seguido. El Agente IA la consultará como una enciclopedia antes de responder.</p>
                        <div className="bg-white/50 p-4 rounded-soft border border-silk-beige/30 flex gap-4 mt-2">
                            <div className="bg-violet-100 w-12 h-12 rounded-full flex items-center justify-center shrink-0">
                                <FileText className="w-6 h-6 text-violet-600" />
                            </div>
                            <div className="space-y-1">
                                <p className="font-bold text-[13px] text-charcoal">¿Qué es ideal subir aquí?</p>
                                <p className="text-[11px] text-charcoal/70 leading-relaxed">
                                    Listas de precios detalladas, descripción de cada tratamiento, horarios de todas las sucursales, ubicación exacta con links a Google Maps y una lista de preguntas frecuentes (FAQ) con sus respuestas ideales.
                                </p>
                            </div>
                        </div>
                    </GuideBox>
                </div>
            </div>

            <div className="card-soft p-4">
                <div className="flex flex-col md:flex-row gap-3">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal/40" />
                        <input
                            type="text"
                            placeholder="Buscar por título o contenido..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="input-soft w-full pl-10"
                        />
                    </div>
                    <select
                        value={filterCategory}
                        onChange={(e) => setFilterCategory(e.target.value)}
                        className="input-soft min-w-[180px]"
                    >
                        <option value="all">Todas las categorías</option>
                        {CATEGORY_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                    <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        className="input-soft min-w-[120px]"
                    >
                        <option value="all">Todos</option>
                        <option value="active">Activos</option>
                        <option value="inactive">Inactivos</option>
                    </select>
                </div>
            </div>

            {/* Documents Grid */}
            {filteredDocuments.length === 0 ? (
                <div className="card-soft p-12 text-center">
                    <div className="flex flex-col items-center gap-4">
                        <div className="w-16 h-16 bg-silk-beige/30 rounded-full flex items-center justify-center">
                            <BookOpen className="w-8 h-8 text-charcoal/30" />
                        </div>
                        <div>
                            <h3 className="text-lg font-medium text-charcoal mb-1">
                                {documents.length === 0 ? 'Sin documentos aún' : 'Sin resultados'}
                            </h3>
                            <p className="text-charcoal/50 text-sm max-w-sm mx-auto">
                                {documents.length === 0
                                    ? 'Crea tu primer documento de conocimiento para que tu agente IA pueda responder mejor a tus clientes.'
                                    : 'No se encontraron documentos con los filtros seleccionados.'}
                            </p>
                        </div>
                        {documents.length === 0 && (
                            <button onClick={openNewModal} className="btn-primary flex items-center gap-2 mt-2">
                                <Plus className="w-4 h-4" />
                                Crear primer documento
                            </button>
                        )}
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredDocuments.map((doc) => {
                        const catColor = getCategoryColor(doc.category)
                        const catLabel = CATEGORY_OPTIONS.find(o => o.value === doc.category)?.label || doc.category

                        return (
                            <div
                                key={doc.id}
                                className={cn(
                                    'card-soft p-5 hover:shadow-premium transition-all duration-200 cursor-pointer group relative',
                                    doc.status === 'inactive' && 'opacity-60'
                                )}
                                onClick={() => openEditModal(doc)}
                            >
                                {/* Category Badge */}
                                <div className="mb-3">
                                    <span className={cn(
                                        'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border',
                                        catColor.bg, catColor.text, catColor.border
                                    )}>
                                        {catLabel}
                                    </span>
                                </div>

                                {/* Title */}
                                <h3 className="font-semibold text-charcoal text-base mb-2 line-clamp-1 group-hover:text-primary-600 transition-colors">
                                    {doc.title}
                                </h3>

                                {/* Content Preview */}
                                <p className="text-sm text-charcoal/60 line-clamp-3 mb-4 leading-relaxed">
                                    {doc.content}
                                </p>

                                {/* Footer */}
                                <div className="flex items-center justify-between pt-3 border-t border-silk-beige/50">
                                    <div className="flex items-center gap-1.5">
                                        {doc.sync_status === 'synced' ? (
                                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                                        ) : (
                                            <Clock className="w-3.5 h-3.5 text-amber-500" />
                                        )}
                                        <span className={cn(
                                            'text-xs font-medium',
                                            doc.sync_status === 'synced' ? 'text-emerald-600' : 'text-amber-600'
                                        )}>
                                            {doc.sync_status === 'synced' ? 'Sincronizado' : 'Pendiente'}
                                        </span>
                                    </div>
                                    <span className={cn(
                                        'text-xs font-medium px-2 py-0.5 rounded-full',
                                        doc.status === 'active'
                                            ? 'bg-emerald-50 text-emerald-600'
                                            : 'bg-gray-100 text-gray-500'
                                    )}>
                                        {doc.status === 'active' ? 'Activo' : 'Inactivo'}
                                    </span>
                                </div>

                                {/* Quick Actions (on hover) */}
                                <div className="absolute top-3 right-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            handleToggleStatus(doc)
                                        }}
                                        className="p-1.5 rounded-soft hover:bg-ivory transition-colors"
                                        title={doc.status === 'active' ? 'Desactivar' : 'Activar'}
                                    >
                                        {doc.status === 'active' ? (
                                            <ToggleRight className="w-4 h-4 text-emerald-500" />
                                        ) : (
                                            <ToggleLeft className="w-4 h-4 text-gray-400" />
                                        )}
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            setDeleteConfirm(doc.id)
                                        }}
                                        className="p-1.5 rounded-soft hover:bg-red-50 transition-colors"
                                        title="Eliminar"
                                    >
                                        <Trash2 className="w-4 h-4 text-red-400 hover:text-red-600" />
                                    </button>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {deleteConfirm && (
                <div className="fixed inset-0 bg-charcoal/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                    <div className="bg-white rounded-soft shadow-premium-lg w-full max-w-sm animate-scale-in p-6">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 bg-red-50 rounded-full flex items-center justify-center">
                                <AlertCircle className="w-5 h-5 text-red-500" />
                            </div>
                            <h3 className="text-lg font-semibold text-charcoal">¿Eliminar documento?</h3>
                        </div>
                        <p className="text-sm text-charcoal/60 mb-6">
                            Esta acción no se puede deshacer. El documento será eliminado permanentemente de la base de conocimiento.
                        </p>
                        <div className="flex justify-end gap-3">
                            <button onClick={() => setDeleteConfirm(null)} className="btn-ghost">
                                Cancelar
                            </button>
                            <button
                                onClick={() => handleDelete(deleteConfirm)}
                                className="px-4 py-2 bg-red-500 text-white rounded-soft text-sm font-medium hover:bg-red-600 transition-colors"
                            >
                                Eliminar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Create/Edit Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-charcoal/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                    <div className="bg-white rounded-soft shadow-premium-lg w-full max-w-2xl animate-scale-in max-h-[90vh] flex flex-col">
                        {/* Modal Header */}
                        <div className="flex items-center justify-between p-6 border-b border-silk-beige">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-primary-50 rounded-full flex items-center justify-center">
                                    {editingDoc ? (
                                        <Edit3 className="w-5 h-5 text-primary-500" />
                                    ) : (
                                        <Plus className="w-5 h-5 text-primary-500" />
                                    )}
                                </div>
                                <h2 className="text-xl font-bold text-charcoal">
                                    {editingDoc ? 'Editar Documento' : 'Nuevo Documento'}
                                </h2>
                            </div>
                            <button
                                onClick={closeModal}
                                className="p-2 hover:bg-ivory rounded-soft transition-colors"
                            >
                                <X className="w-5 h-5 text-charcoal/50" />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="p-6 space-y-5 overflow-y-auto flex-1">
                            <div>
                                <label className="block text-sm font-medium text-charcoal mb-2">
                                    Título *
                                </label>
                                <input
                                    type="text"
                                    value={formTitle}
                                    onChange={(e) => setFormTitle(e.target.value)}
                                    placeholder="Ej: Precios y Planes"
                                    className="input-soft w-full"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-charcoal mb-2">
                                        Categoría
                                    </label>
                                    <select
                                        value={formCategory}
                                        onChange={(e) => setFormCategory(e.target.value)}
                                        className="input-soft w-full"
                                    >
                                        {CATEGORY_OPTIONS.map(opt => (
                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-charcoal mb-2">
                                        Estado
                                    </label>
                                    <select
                                        value={formStatus}
                                        onChange={(e) => setFormStatus(e.target.value as 'active' | 'inactive')}
                                        className="input-soft w-full"
                                    >
                                        <option value="active">Activo</option>
                                        <option value="inactive">Inactivo</option>
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-charcoal mb-2">
                                    Contenido *
                                </label>
                                <textarea
                                    value={formContent}
                                    onChange={(e) => setFormContent(e.target.value)}
                                    placeholder="Escribe aquí la información que el agente IA utilizará para responder a los clientes...&#10;&#10;Ejemplo:&#10;- Vacuna Óctuple: $23.000 — Previene Distemper, Parvo y otros.&#10;- Consulta Médica: $20.000 — Revisión completa a domicilio.&#10;- Desparasitación Interna: Desde $3.000 según peso."
                                    rows={12}
                                    className="input-soft w-full resize-none font-mono text-sm leading-relaxed"
                                />
                                <p className="text-xs text-charcoal/40 mt-2">
                                    💡 Escribe la información de forma clara y estructurada. El agente IA usará este texto como referencia para responder consultas.
                                </p>
                            </div>

                            {/* File upload inside modal */}
                            <div className="p-4 border-2 border-dashed border-silk-beige rounded-soft bg-ivory/30 hover:bg-ivory/60 transition-colors">
                                <label className="flex flex-col items-center gap-2 cursor-pointer">
                                    <Upload className="w-6 h-6 text-charcoal/40" />
                                    <span className="text-sm text-charcoal/60">
                                        O arrastra un archivo de texto (.txt, .md, .csv, .json)
                                    </span>
                                    <input
                                        type="file"
                                        accept=".txt,.md,.csv,.json"
                                        onChange={handleFileUpload}
                                        className="hidden"
                                    />
                                </label>
                            </div>
                        </div>

                        {/* Modal Footer */}
                        <div className="flex justify-between items-center p-6 border-t border-silk-beige">
                            <div>
                                {editingDoc && (
                                    <button
                                        onClick={() => {
                                            setDeleteConfirm(editingDoc.id)
                                            closeModal()
                                        }}
                                        className="text-sm text-red-500 hover:text-red-700 font-medium underline decoration-red-200 hover:decoration-red-500 underline-offset-4 transition-all"
                                    >
                                        Eliminar documento
                                    </button>
                                )}
                            </div>
                            <div className="flex gap-3">
                                <button onClick={closeModal} className="btn-ghost">
                                    Cancelar
                                </button>
                                <button
                                    onClick={handleSave}
                                    disabled={saving || !formTitle.trim() || !formContent.trim()}
                                    className="btn-primary flex items-center gap-2"
                                >
                                    {saving ? (
                                        <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</>
                                    ) : (
                                        <><Save className="w-4 h-4" /> {editingDoc ? 'Guardar Cambios' : 'Crear Documento'}</>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
 
