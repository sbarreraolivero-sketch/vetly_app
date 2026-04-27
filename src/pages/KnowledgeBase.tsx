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
    Cpu,
    Zap,
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
    protocolos: { bg: 'bg-slate-100', text: 'text-slate-800', border: 'border-slate-300' },
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
    { value: 'protocolos', label: 'Protocolos Operativos' },
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
                id: 'linares-base', 
                name: 'Linares Base', 
                lat: -35.8453, 
                lng: -71.5979, 
                type: 'operational',
                max_time_mins: 45,
                time_ranges: [
                    { min: 0, max: 14, surcharge: 0, label: 'Radio Urbano' },
                    { min: 15, max: 24, surcharge: 6000, label: 'T1 Rural' },
                    { min: 25, max: 34, surcharge: 8000, label: 'T2 Rural' },
                    { min: 35, max: 44, surcharge: 10000, label: 'T4 Rural' }
                ]
            },
            { 
                id: 'talca-base', 
                name: 'Talca Base', 
                lat: -35.4264, 
                lng: -71.6554, 
                type: 'operational',
                max_time_mins: 50,
                time_ranges: [
                    { min: 0, max: 20, surcharge: 0, label: 'Radio Urbano' },
                    { min: 21, max: 30, surcharge: 6000, label: 'T2 Rural' },
                    { min: 31, max: 40, surcharge: 8000, label: 'T3 Rural' },
                    { min: 41, max: 50, surcharge: 10000, label: 'T4 Rural' }
                ]
            },
            { 
                id: 'sj-base', 
                name: 'San Javier Base', 
                lat: -35.5974, 
                lng: -71.7423, 
                type: 'operational',
                max_time_mins: 30,
                time_ranges: [
                    { min: 0, max: 10, surcharge: 0, label: 'Radio Urbano' },
                    { min: 11, max: 20, surcharge: 6000, label: 'T2 Rural' },
                    { min: 21, max: 30, surcharge: 8000, label: 'T3 Rural' },
                    { min: 31, max: 40, surcharge: 10000, label: 'T4 Rural' }
                ]
            },
            { 
                id: 'surgical-norte', 
                name: 'Hub Quirúrgico Norte (Talca)', 
                lat: -35.4232, 
                lng: -71.6734, 
                type: 'surgical_hub',
                max_time_mins: 45,
                time_ranges: [
                    { min: 0, max: 25, surcharge: 0, label: 'T1 Cirugía' },
                    { min: 26, max: 35, surcharge: 8000, label: 'T2 Cirugía' },
                    { min: 36, max: 45, surcharge: 16000, label: 'T3 Cirugía' }
                ]
            },
            { 
                id: 'surgical-sur', 
                name: 'Hub Quirúrgico Sur (Linares)', 
                lat: -35.8500, 
                lng: -71.6000, 
                type: 'surgical_hub',
                max_time_mins: 45,
                time_ranges: [
                    { min: 0, max: 25, surcharge: 0, label: 'T1 Cirugía' },
                    { min: 26, max: 35, surcharge: 8000, label: 'T2 Cirugía' },
                    { min: 36, max: 45, surcharge: 16000, label: 'T3 Cirugía' }
                ]
            }
        ],
        is_active: true
    })
    const [activeModel, setActiveModel] = useState<'hybrid' | 'mini' | 'pro'>('hybrid')
    const [savingPrompt, setSavingPrompt] = useState(false)
    const [promptSaved, setPromptSaved] = useState(false)
    const [showPromptSection, setShowPromptSection] = useState(true)
    const [showLogisticsSection, setShowLogisticsSection] = useState(false)

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
            const { data, error: fetchError } = await (supabase as any)
                .from('clinic_settings')
                .select('ai_personality, ai_behavior_rules, transfer_details, logistics_config, ai_active_model')
                .eq('id', profile.clinic_id)
                .single()

            if (fetchError && fetchError.code !== 'PGRST116') throw fetchError;
            if (!data) return;

            if (data.ai_personality) setMasterPrompt(data.ai_personality)
            if (data.ai_behavior_rules) setBehaviorRules(data.ai_behavior_rules)
            if (data.transfer_details) setTransferDetails(data.transfer_details)
            if (data.ai_active_model) setActiveModel(data.ai_active_model as 'hybrid' | 'mini' | 'pro')
            
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

                if (finalConfig) {
                    setLogisticsConfig(finalConfig);
                }
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
            console.log('KnowledgeBase: Saving started for clinic_id:', profile.clinic_id);
            console.log('KnowledgeBase: Saving logisticsConfig:', logisticsConfig);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data, error } = await (supabase as any)
                .from('clinic_settings')
                .upsert({
                    id: profile.clinic_id,
                    ai_personality: (masterPrompt || '').trim(),
                    ai_behavior_rules: (behaviorRules || '').trim(),
                    transfer_details: (transferDetails || '').trim(),
                    logistics_config: logisticsConfig,
                    ai_active_model: activeModel,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'id' })
                .select()

            if (error) {
                console.error('Supabase Persistence Error:', error)
                throw error
            }

            if (!data || data.length === 0) {
                throw new Error('Supabase no retornó datos después del guardado. Verifica si el registro existe.');
            }

            console.log('KnowledgeBase Save Success:', data)
            
            if (data && data[0]) {
                const savedData = data[0];
                if (savedData.ai_personality) setMasterPrompt(savedData.ai_personality);
                if (savedData.ai_behavior_rules) setBehaviorRules(savedData.ai_behavior_rules);
                if (savedData.transfer_details) setTransferDetails(savedData.transfer_details);
                if (savedData.ai_active_model) setActiveModel(savedData.ai_active_model);
                if (savedData.logistics_config) setLogisticsConfig(savedData.logistics_config);
            }

            setPromptSaved(true)
            setTimeout(() => setPromptSaved(false), 3000)
            
            // Success feedback
            // alert('Configuración guardada correctamente.')
        } catch (e: any) {
            console.error('Error in handleSaveMasterPrompt:', e)
            const errorMsg = e?.message || e?.error_description || 'Error desconocido'
            if (errorMsg.includes('permission denied') || e?.code === '42501') {
                alert('No tienes permisos suficientes (RLS) para modificar la configuración de la clínica.')
            } else {
                alert(`Error al guardar: ${errorMsg}`)
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
            <div className="bg-hero-gradient from-primary-600 to-primary-800 rounded-soft p-8 text-white relative overflow-hidden shadow-premium mb-8">
                <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-16 -mt-16 blur-2xl"></div>
                
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
                    <div className="animate-fade-in">
                        <div className="px-5 pb-5 space-y-6 border-t border-silk-beige/50">
                        
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
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

                        {/* Advanced Logistics Section */}
                        <div className="border-t border-silk-beige/30 mt-6 pt-0 overflow-hidden rounded-b-soft">
                            <button 
                                onClick={() => setShowLogisticsSection(!showLogisticsSection)}
                                className="w-full flex items-center justify-between py-5 px-0 hover:bg-ivory/30 transition-colors group"
                            >
                                <div className="flex items-center gap-4">
                                    <div className={`w-11 h-11 rounded-soft flex items-center justify-center shadow-md transition-all duration-300 ${showLogisticsSection ? 'bg-premium-gradient ring-2 ring-primary-100' : 'bg-silk-beige/30 group-hover:bg-silk-beige/50'}`}>
                                        <Tag className={`w-5.5 h-5.5 ${showLogisticsSection ? 'text-charcoal' : 'text-charcoal/40 group-hover:text-charcoal'}`} />
                                    </div>
                                    <div className="text-left">
                                        <h2 className="text-lg font-semibold text-charcoal flex items-center gap-2">
                                            Logística Pro (Tramos por Tiempo)
                                            <Sparkles className="w-4 h-4 text-emerald-500" />
                                        </h2>
                                        <p className="text-sm text-charcoal/50">Gestiona múltiples sedes, radios urbanos y tramos quirúrgicos</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    {showLogisticsSection && (
                                        <button 
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                const newLoc = {
                                                    id: Math.random().toString(36).substr(2, 9),
                                                    name: `Nueva Sede ${logisticsConfig.locations.length + 1}`,
                                                    lat: -35.8450,
                                                    lng: -71.5979,
                                                    type: 'operational',
                                                    max_time_mins: 30,
                                                    time_ranges: [{ min: 0, max: 10, surcharge: 0, label: 'Urbano' }]
                                                };
                                                setLogisticsConfig({
                                                    ...logisticsConfig,
                                                    locations: [...logisticsConfig.locations, newLoc]
                                                });
                                            }}
                                            className="btn-primary py-1.5 px-4 text-xs flex items-center gap-1.5 shadow-soft-sm"
                                        >
                                            <Plus className="w-3.5 h-3.5" /> Agregar Sede/Hub
                                        </button>
                                    )}
                                    <svg className={`w-5 h-5 text-charcoal/30 transition-transform duration-300 ${showLogisticsSection ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                </div>
                            </button>

                            {showLogisticsSection && (
                                <div className="space-y-5 py-4 animate-slide-up">
                                    {logisticsConfig.locations.length === 0 && (
                                        <div className="text-center py-10 bg-ivory/20 rounded-soft border border-dashed border-silk-beige/50">
                                            <p className="text-sm text-charcoal/40">No hay sedes configuradas. Haz clic en "Agregar Sede/Hub" para comenzar.</p>
                                        </div>
                                    )}
                                    
                                    <div className="grid grid-cols-1 gap-5">
                                        {logisticsConfig.locations.map((loc, index) => {
                                            const isSurgical = loc.type === 'surgical_hub';
                                            return (
                                                <div 
                                                    key={loc.id} 
                                                    className={`rounded-soft border shadow-soft-sm overflow-hidden transition-all hover:shadow-soft-md ${
                                                        isSurgical 
                                                        ? 'border-violet-200 bg-violet-50/20' 
                                                        : 'border-emerald-200 bg-emerald-50/20'
                                                    }`}
                                                >
                                                    <div className={`p-4 flex items-center justify-between gap-4 border-b ${
                                                        isSurgical ? 'bg-violet-100/40 border-violet-200' : 'bg-emerald-100/40 border-emerald-200'
                                                    }`}>
                                                        <div className="flex items-center gap-4 flex-1">
                                                            <div className={`w-10 h-10 rounded-soft flex items-center justify-center shadow-sm ${
                                                                isSurgical ? 'bg-violet-500 text-white' : 'bg-emerald-500 text-white'
                                                            }`}>
                                                                {isSurgical ? <Bot className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
                                                            </div>
                                                            <div className="flex-1 space-y-1">
                                                                <input
                                                                    type="text"
                                                                    value={loc.name}
                                                                    onChange={(e) => {
                                                                        const newLocs = [...logisticsConfig.locations];
                                                                        newLocs[index].name = e.target.value;
                                                                        setLogisticsConfig({ ...logisticsConfig, locations: newLocs });
                                                                    }}
                                                                    className="bg-transparent border-none p-0 text-base font-bold text-charcoal focus:ring-0 w-full placeholder:text-charcoal/30"
                                                                    placeholder="Nombre de la sede..."
                                                                />
                                                                <div className="flex items-center gap-2">
                                                                    <select
                                                                        value={loc.type}
                                                                        onChange={(e) => {
                                                                            const newLocs = [...logisticsConfig.locations];
                                                                            newLocs[index].type = e.target.value as any;
                                                                            setLogisticsConfig({ ...logisticsConfig, locations: newLocs });
                                                                        }}
                                                                        className={`text-[10px] font-bold uppercase rounded-full px-2.5 py-0.5 border shadow-sm ${
                                                                            isSurgical 
                                                                            ? 'bg-white border-violet-300 text-violet-700' 
                                                                            : 'bg-white border-emerald-300 text-emerald-700'
                                                                        }`}
                                                                    >
                                                                        <option value="operational">📍 Mundo A: Base Domicilios</option>
                                                                        <option value="surgical_hub">✂️ Mundo B: Centro Quirúrgico</option>
                                                                    </select>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        
                                                        <div className="flex items-center gap-3">
                                                            <div className="flex items-center gap-1.5 bg-white/80 px-3 py-1.5 rounded-soft border border-silk-beige/50 backdrop-blur-sm">
                                                                <Clock className="w-3.5 h-3.5 text-charcoal/40" />
                                                                <span className="text-[10px] uppercase font-bold text-charcoal/40">Límite:</span>
                                                                <input
                                                                    type="number"
                                                                    value={loc.max_time_mins}
                                                                    onChange={(e) => {
                                                                        const newLocs = [...logisticsConfig.locations];
                                                                        newLocs[index].max_time_mins = parseInt(e.target.value) || 0;
                                                                        setLogisticsConfig({ ...logisticsConfig, locations: newLocs });
                                                                    }}
                                                                    className="w-8 text-[11px] font-bold bg-transparent border-none p-0 focus:ring-0 text-center"
                                                                />
                                                                <span className="text-[10px] font-bold text-charcoal/40">min</span>
                                                            </div>
                                                            <button 
                                                                onClick={() => {
                                                                    const newLocs = logisticsConfig.locations.filter(l => l.id !== loc.id);
                                                                    setLogisticsConfig({ ...logisticsConfig, locations: newLocs });
                                                                }}
                                                                className="text-red-400 p-2 hover:bg-red-100/50 rounded-soft transition-colors shadow-soft-sm bg-white"
                                                                title="Eliminar Sede"
                                                            >
                                                                <Trash2 className="w-4 h-4" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                    
                                                    <div className="p-5 grid grid-cols-1 lg:grid-cols-12 gap-8">
                                                        <div className="lg:col-span-3 space-y-4">
                                                            <div className="p-3 bg-white/50 rounded-soft border border-silk-beige/30 space-y-3">
                                                                <h4 className="text-[10px] font-bold text-charcoal/40 uppercase tracking-widest flex items-center gap-1.5">
                                                                    <Tag className="w-3 h-3" /> Coordenadas GPS
                                                                </h4>
                                                                <div className="space-y-1">
                                                                    <label className="text-[9px] uppercase font-bold text-charcoal/30">Latitud</label>
                                                                    <input
                                                                        type="number"
                                                                        step="0.0001"
                                                                        value={loc.lat}
                                                                        onChange={(e) => {
                                                                            const newLocs = [...logisticsConfig.locations];
                                                                            newLocs[index].lat = parseFloat(e.target.value) || 0;
                                                                            setLogisticsConfig({ ...logisticsConfig, locations: newLocs });
                                                                        }}
                                                                        className="input-soft w-full text-xs py-1.5 focus:bg-white"
                                                                    />
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <label className="text-[9px] uppercase font-bold text-charcoal/30">Longitud</label>
                                                                    <input
                                                                        type="number"
                                                                        step="0.0001"
                                                                        value={loc.lng}
                                                                        onChange={(e) => {
                                                                            const newLocs = [...logisticsConfig.locations];
                                                                            newLocs[index].lng = parseFloat(e.target.value) || 0;
                                                                            setLogisticsConfig({ ...logisticsConfig, locations: newLocs });
                                                                        }}
                                                                        className="input-soft w-full text-xs py-1.5 focus:bg-white"
                                                                    />
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div className="lg:col-span-9 space-y-4">
                                                            <div className="flex items-center justify-between">
                                                                <label className="text-[11px] uppercase font-bold text-charcoal/60 tracking-wider flex items-center gap-2">
                                                                    <Clock className="w-4 h-4 text-primary-500" />
                                                                    Tramos de Tiempo y Recargos
                                                                </label>
                                                                <button 
                                                                    onClick={() => {
                                                                        const newLocs = [...logisticsConfig.locations];
                                                                        const lastMax = newLocs[index].time_ranges[newLocs[index].time_ranges.length - 1]?.max || 0;
                                                                        newLocs[index].time_ranges.push({
                                                                            min: lastMax + 1,
                                                                            max: lastMax + 15,
                                                                            surcharge: 0,
                                                                            label: `T${newLocs[index].time_ranges.length + 1} Rural`
                                                                        });
                                                                        setLogisticsConfig({ ...logisticsConfig, locations: newLocs });
                                                                    }}
                                                                    className={`text-[10px] font-bold px-3 py-1 rounded-full border transition-all shadow-soft-sm bg-white ${isSurgical ? 'text-violet-600 border-violet-200 hover:bg-violet-50' : 'text-emerald-600 border-emerald-200 hover:bg-emerald-50'}`}
                                                                >
                                                                    + Agregar Tramo
                                                                </button>
                                                            </div>
                                                            <div className="bg-white/80 rounded-soft border border-silk-beige/40 shadow-soft-sm overflow-hidden">
                                                                <table className="w-full text-left border-collapse">
                                                                    <thead className={`${isSurgical ? 'bg-violet-100/30' : 'bg-emerald-100/30'} text-[9px] uppercase font-bold text-charcoal/40`}>
                                                                        <tr>
                                                                            <th className="px-4 py-3">Etiqueta/Tramo</th>
                                                                            <th className="px-4 py-3 text-center">Rango Tiempo (Mins)</th>
                                                                            <th className="px-4 py-3 text-right">Recargo ($)</th>
                                                                            <th className="px-4 py-3 w-10"></th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody className="divide-y divide-silk-beige/20">
                                                                        {loc.time_ranges.map((range, rIndex) => (
                                                                            <tr key={rIndex} className="text-[12px] hover:bg-ivory/20 transition-colors">
                                                                                <td className="px-4 py-3">
                                                                                    <input
                                                                                        type="text"
                                                                                        value={range.label}
                                                                                        onChange={(e) => {
                                                                                            const newLocs = [...logisticsConfig.locations];
                                                                                            newLocs[index].time_ranges[rIndex].label = e.target.value;
                                                                                            setLogisticsConfig({ ...logisticsConfig, locations: newLocs });
                                                                                        }}
                                                                                        className="bg-transparent border-none p-0 w-full focus:ring-0 font-bold text-charcoal/70 placeholder:text-charcoal/20"
                                                                                        placeholder="Ej: Rural 1"
                                                                                    />
                                                                                </td>
                                                                                <td className="px-4 py-3">
                                                                                    <div className="flex items-center justify-center gap-3">
                                                                                        <div className="relative group/input">
                                                                                            <span className="absolute -top-3 left-0 text-[8px] font-bold text-charcoal/30 uppercase">Desde</span>
                                                                                            <input
                                                                                                type="number"
                                                                                                value={range.min}
                                                                                                onChange={(e) => {
                                                                                                    const newLocs = [...logisticsConfig.locations];
                                                                                                    newLocs[index].time_ranges[rIndex].min = parseInt(e.target.value) || 0;
                                                                                                    setLogisticsConfig({ ...logisticsConfig, locations: newLocs });
                                                                                                }}
                                                                                                className="w-14 text-center bg-silk-beige/20 rounded-soft border border-silk-beige/10 py-1.5 focus:ring-1 focus:ring-primary-400 focus:bg-white text-xs font-bold"
                                                                                            />
                                                                                        </div>
                                                                                        <span className="text-silk-beige">→</span>
                                                                                        <div className="relative group/input">
                                                                                            <span className="absolute -top-3 left-0 text-[8px] font-bold text-charcoal/30 uppercase">Hasta</span>
                                                                                            <input
                                                                                                type="number"
                                                                                                value={range.max}
                                                                                                onChange={(e) => {
                                                                                                    const newLocs = [...logisticsConfig.locations];
                                                                                                    newLocs[index].time_ranges[rIndex].max = parseInt(e.target.value) || 0;
                                                                                                    setLogisticsConfig({ ...logisticsConfig, locations: newLocs });
                                                                                                }}
                                                                                                className="w-14 text-center bg-silk-beige/20 rounded-soft border border-silk-beige/10 py-1.5 focus:ring-1 focus:ring-primary-400 focus:bg-white text-xs font-bold"
                                                                                            />
                                                                                        </div>
                                                                                    </div>
                                                                                </td>
                                                                                <td className="px-4 py-3 text-right">
                                                                                    <div className="flex justify-end items-center gap-2">
                                                                                        <span className="text-charcoal/30 font-bold">$</span>
                                                                                        <input
                                                                                            type="number"
                                                                                            value={range.surcharge}
                                                                                            onChange={(e) => {
                                                                                                const newLocs = [...logisticsConfig.locations];
                                                                                                newLocs[index].time_ranges[rIndex].surcharge = parseInt(e.target.value) || 0;
                                                                                                setLogisticsConfig({ ...logisticsConfig, locations: newLocs });
                                                                                            }}
                                                                                            className={`w-24 text-right rounded-soft border-none py-1.5 focus:ring-1 font-bold text-sm ${isSurgical ? 'bg-violet-50/50 focus:ring-violet-400' : 'bg-emerald-50/50 focus:ring-emerald-400'}`}
                                                                                        />
                                                                                    </div>
                                                                                </td>
                                                                                <td className="px-4 py-3 text-center">
                                                                                    <button 
                                                                                        onClick={() => {
                                                                                            const newLocs = [...logisticsConfig.locations];
                                                                                            newLocs[index].time_ranges.splice(rIndex, 1);
                                                                                            setLogisticsConfig({ ...logisticsConfig, locations: newLocs });
                                                                                        }}
                                                                                        className="text-charcoal/10 hover:text-red-500 transition-colors p-1"
                                                                                    >
                                                                                        <Trash2 className="w-4 h-4" />
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
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

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
                                        <li className="flex items-center gap-1.5"><div className="w-1 h-1 bg-amber-400 rounded-full"></div> Nombre del Titular</li>
                                        <li className="flex items-center gap-1.5"><div className="w-1 h-1 bg-amber-400 rounded-full"></div> RUT de la Empresa/Persona</li>
                                        <li className="flex items-center gap-1.5"><div className="w-1 h-1 bg-amber-400 rounded-full"></div> Banco y Tipo de Cuenta</li>
                                        <li className="flex items-center gap-1.5"><div className="w-1 h-1 bg-amber-400 rounded-full"></div> Número de Cuenta</li>
                                        <li className="flex items-center gap-1.5"><div className="w-1 h-1 bg-amber-400 rounded-full"></div> Link de pago (Transbank/Flow)</li>
                                        <li className="flex items-center gap-1.5"><div className="w-1 h-1 bg-amber-400 rounded-full"></div> Política de Devoluciones</li>
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
            <div className="mt-8 mb-4">
                <div className="flex flex-col md:flex-row md:items-center gap-4 w-full">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-premium-gradient rounded-soft flex items-center justify-center shadow-sm shrink-0">
                            <BookOpen className="w-5 h-5 text-charcoal" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-charcoal tracking-tight">Documentos de Conocimiento</h2>
                            <p className="text-xs text-charcoal/40 font-medium uppercase tracking-widest mt-0.5">Biblioteca Técnica del Agente</p>
                        </div>
                    </div>
                    
                    <div className="flex flex-1 items-center justify-end gap-4">
                        <label className="flex items-center gap-2 px-6 py-3 bg-charcoal/5 hover:bg-charcoal/10 border border-charcoal/10 rounded-soft text-sm font-bold text-charcoal transition-all cursor-pointer shadow-sm hover:shadow-md">
                            <Upload className="w-5 h-5 text-charcoal/60" />
                            {uploadingFile ? 'Procesando...' : 'Subir Archivo'}
                            <input
                                type="file"
                                accept=".txt,.md,.csv,.json"
                                onChange={handleFileUpload}
                                className="hidden"
                            />
                        </label>
                        <button
                            onClick={openNewModal}
                            className="bg-primary-600 text-white hover:bg-primary-700 px-7 py-3 rounded-soft text-sm font-bold transition-all shadow-md hover:shadow-lg flex items-center gap-2"
                        >
                            <Plus className="w-5 h-5" />
                            Nuevo Registro
                        </button>
                    </div>
                </div>

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
 
