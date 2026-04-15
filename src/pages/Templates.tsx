import { useState, useEffect, useRef } from 'react'
import { FileText, Plus, X, MessageSquare, Clock, ShieldAlert, CheckCircle2, Sparkles, Smartphone, Trash2, Code, Lightbulb, Check, Info } from 'lucide-react'
import { retentionService, YCloudTemplate } from '@/services/retentionService'
import { useAuth } from '@/contexts/AuthContext'
import toast from 'react-hot-toast'
import { GuideBox } from '@/components/ui/GuideBox'

export default function Templates() {
    const { profile } = useAuth()
    const clinicId = profile?.clinic_id

    const [templates, setTemplates] = useState<YCloudTemplate[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [isCreating, setIsCreating] = useState(false)
    const [creatingTemplate, setCreatingTemplate] = useState(false)
    const [deletingTemplate, setDeletingTemplate] = useState<string | null>(null)
    const [newTemplate, setNewTemplate] = useState<{ name: string, body: string, category: string, buttons: string[] }>({ name: '', body: '', category: 'MARKETING', buttons: [] })

    const textareaRef = useRef<HTMLTextAreaElement>(null)

    const insertVariable = (num: number, example: string) => {
        const textarea = textareaRef.current
        if (!textarea) return

        const textToInsert = `{{${num}}}`

        // Store mappings for preview
        setVariableExamples(prev => ({ ...prev, [num]: example }))

        const start = textarea.selectionStart
        const end = textarea.selectionEnd

        const newBody = newTemplate.body.substring(0, start) + textToInsert + newTemplate.body.substring(end)
        setNewTemplate(prev => ({ ...prev, body: newBody }))

        // Reset cursor to end of inserted text
        setTimeout(() => {
            textarea.focus()
            textarea.setSelectionRange(start + textToInsert.length, start + textToInsert.length)
        }, 0)
    }

    const QUICK_VARIABLES = [
        { label: 'Nombre Mascota', icon: '🐾', example: 'Roco', num: 1 },
        { label: 'Servicio / Vacuna', icon: '💉', example: 'Vacunación', num: 2 },
        { label: 'Fecha recordatorio', icon: '📅', example: 'Lunes 15 de Mayo', num: 3 },
        { label: 'Horario', icon: '⏰', example: 'Durante el día', num: 4 },
        { label: 'Nombre Clínica', icon: '🏥', example: 'AnimalGrace', num: 5 },
        { label: 'Link de Interés', icon: '🔗', example: 'https://vetly.app/reserva', num: 6 },
    ]

    const [variableExamples, setVariableExamples] = useState<Record<number, string>>({})

    const genericExamples = [
        "Roco",
        "Vacunación",
        "Lunes 15 de Mayo",
        "Durante el día",
        "AnimalGrace",
        "https://vetly.app/reserva"
    ]

    const loadTemplates = async () => {
        if (!clinicId) return
        try {
            setLoading(true)
            setError(null)
            const remoteTemplates = await retentionService.getRemoteTemplates(clinicId)
            setTemplates(remoteTemplates)
        } catch (err: any) {
            console.error('Error loading templates:', err)
            setError(err.message || 'Error al cargar las plantillas de YCloud')
        } finally {
            setLoading(false)
        }
    }

    const handleDeleteTemplate = async (templateName: string) => {
        if (!confirm(`¿Estás seguro de que deseas eliminar la plantilla '${templateName}' de YCloud? Esta acción no se puede deshacer y fallará si está en uso.`)) return

        setDeletingTemplate(templateName)
        try {
            if (!clinicId) throw new Error('Clinic ID no encontrado')
            await retentionService.deleteRemoteTemplate(clinicId, templateName)
            toast.success('Plantilla eliminada exitosamente en YCloud')
            loadTemplates() // Refresh list automatically
        } catch (err: any) {
            console.error('Error deleting template:', err)
            toast.error(err.message || 'Error al eliminar la plantilla')
        } finally {
            setDeletingTemplate(null)
        }
    }

    useEffect(() => {
        loadTemplates()
    }, [clinicId])

    const handleCreateTemplate = async () => {
        if (!clinicId) return
        setCreatingTemplate(true)
        try {
            // Prepare examples array for Meta
            const examples = genericExamples.map((gen, i) => variableExamples[i + 1] || gen)

            const result = await retentionService.createRemoteTemplate(clinicId, newTemplate.name, newTemplate.body, newTemplate.buttons, examples)
            toast.success('Plantilla enviada a WhatsApp para revisión')

            // Add to list optimistically
            const created: YCloudTemplate = {
                id: result.formatted_name,
                name: result.formatted_name,
                desc: newTemplate.body,
                status: 'PENDING',
                language: 'es',
                category: newTemplate.category,
                body: newTemplate.body
            }
            setTemplates([created, ...templates])
            setNewTemplate({ name: '', body: '', category: 'MARKETING', buttons: [] })
            setIsCreating(false)

        } catch (err: any) {
            console.error(err)
            toast.error(err.message || 'Error al crear plantilla')
        } finally {
            setCreatingTemplate(false)
        }
    }

    const getStatusBadge = (status?: string) => {
        switch (status?.toUpperCase()) {
            case 'APPROVED':
                return <span className="px-2 py-1 text-xs font-black bg-emerald-100 text-emerald-800 rounded-full flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />Aprobada</span>
            case 'PENDING':
                return <span className="px-2 py-1 text-xs font-black bg-amber-100 text-amber-800 rounded-full flex items-center gap-1"><Clock className="w-3.5 h-3.5" />En Revisión</span>
            case 'REJECTED':
                return <span className="px-2 py-1 text-xs font-black bg-red-100 text-red-800 rounded-full flex items-center gap-1"><ShieldAlert className="w-3.5 h-3.5" />Rechazada</span>
            default:
                return null
        }
    }

    if (loading) {
        return (
            <div className="flex h-full items-center justify-center">
                <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
            </div>
        )
    }

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            {/* Header Banner */}
            <div className="bg-hero-gradient rounded-softer p-6 text-white shadow-soft-md relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-16 -mt-16 blur-2xl" />
                
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 bg-premium-gradient rounded-full flex items-center justify-center shadow-lg shrink-0">
                            <FileText className="w-7 h-7 text-charcoal" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-white tracking-tight">Plantillas de WhatsApp</h1>
                            <p className="text-white/80 text-sm mt-1 max-w-2xl leading-relaxed">
                                💬 Mensajes pre-aprobados por Meta. Úsalos en tus recordatorios de citas, campañas de marketing y motor de retención.
                            </p>
                        </div>
                    </div>

                    {!isCreating && (
                        <button
                            onClick={() => setIsCreating(true)}
                            className="bg-white text-primary-700 hover:bg-ivory px-6 py-2.5 rounded-soft text-sm font-bold transition-all shadow-sm flex items-center gap-2"
                        >
                            <Plus className="w-4 h-4" />
                            <span>Nueva Plantilla</span>
                        </button>
                    )}
                </div>
            </div>

            {/* Creation Form */}
            {isCreating && (
                <div className="bg-white p-6 rounded-2xl border border-silk-beige shadow-sm animate-in fade-in slide-in-from-top-4">
                    <div className="flex justify-between items-center mb-6">
                        <div>
                            <h2 className="text-lg font-bold text-charcoal">Nueva Plantilla de WhatsApp</h2>
                            <p className="text-sm text-charcoal/60 mt-1">Crea un nuevo mensaje y envíalo a YCloud para su aprobación.</p>
                        </div>
                        <button
                            onClick={() => setIsCreating(false)}
                            className="p-2 hover:bg-ivory rounded-full transition-colors text-charcoal/40 hover:text-charcoal"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    <GuideBox 
                        title="Guía: ¿Cómo crear plantillas efectivas?" 
                        summary="Aprende a usar variables {{n}} y cumplir con las reglas de Meta."
                    >
                        <p>Las plantillas de WhatsApp deben ser aprobadas por <b>Meta</b> antes de ser enviadas. Sigue estos consejos para evitar rechazos:</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                            <div className="bg-white/50 p-3.5 rounded-soft border border-silk-beige/30">
                                <p className="font-bold text-primary-700 text-[11px] mb-1.5 flex items-center gap-1.5 uppercase tracking-wider">
                                    <Check className="w-3.5 h-3.5" /> Uso de Variables {'{{n}}'}:
                                </p>
                                <p className="text-[11px] leading-relaxed text-charcoal/70">
                                    Usa llaves dobles con números correlativos para datos dinámicos. 
                                    Ej: <b>{'{{1}}'}</b> para el nombre del paciente, <b>{'{{2}}'}</b> para el nombre del doctor, <b>{'{{3}}'}</b> para la fecha/hora.
                                </p>
                            </div>
                            <div className="bg-white/50 p-3.5 rounded-soft border border-silk-beige/30">
                                <p className="font-bold text-primary-700 text-[11px] mb-1.5 flex items-center gap-1.5 uppercase tracking-wider">
                                    <Info className="w-3.5 h-3.5" /> Categorías de Meta:
                                </p>
                                <p className="text-[11px] leading-relaxed text-charcoal/70 list-disc">
                                    <b>• Marketing:</b> Promociones, ofertas y reactivación.<br/>
                                    <b>• Utility:</b> Recordatorios de cita y seguimientos.<br/>
                                    <b>• Authentication:</b> Solo para códigos de seguridad (OTP).
                                </p>
                            </div>
                        </div>
                        <p className="text-xs font-bold text-charcoal/50 mt-2 italic flex items-center gap-1.5">
                            <Lightbulb className="w-3 h-3" /> Tip: Meta suele aprobar rápido (minutos) si el mensaje es claro y profesional. Evita usar demasiadas mayúsculas o signos de exclamación.
                        </p>
                    </GuideBox>

                    {/* Pre-built Templates Library */}
                    <div className="mb-8 bg-ivory/50 rounded-xl p-4 border border-silk-beige">
                        <h3 className="text-sm font-semibold text-charcoal flex items-center gap-2 mb-3">
                            <Sparkles className="w-4 h-4 text-primary-500" />
                            Plantillas Recomendadas (Rápidas)
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <button
                                onClick={() => {
                                    setNewTemplate({
                                        name: 'reactivacion_mascota',
                                        category: 'MARKETING',
                                        body: 'Hola {{1}}, en {{5}} te extrañamos. Ya te toca tu próximo control de {{2}}. Responde este mensaje para agendar tu cupo.',
                                        buttons: ['Agendar Cita']
                                    })
                                    setVariableExamples({
                                        1: 'Roco',
                                        2: 'Vacunación',
                                        5: 'AnimalGrace'
                                    })
                                }}
                                className="text-left p-3 rounded-lg border border-silk-beige bg-white hover:border-primary-300 hover:shadow-soft-sm transition-all text-sm group"
                            >
                                <div className="font-bold text-charcoal mb-1 group-hover:text-primary-600 transition-colors">Reactivación</div>
                                <div className="text-charcoal/60 text-xs line-clamp-2">Hola {'{{1}}'}, en {'{{5}}'} te extrañamos...</div>
                            </button>
                            <button
                                onClick={() => {
                                    setNewTemplate({
                                        name: 'recordatorio_cita',
                                        category: 'UTILITY',
                                        body: 'Hola {{1}}, te recordamos tu cita de {{2}} para el día {{3}} en {{5}}. Por favor confirma respondiendo "Sí" o "No".',
                                        buttons: ['Sí, confirmo', 'No podré asistir']
                                    })
                                    setVariableExamples({
                                        1: 'Roco',
                                        2: 'Vacunación',
                                        3: 'Lunes 15 de Mayo',
                                        5: 'AnimalGrace'
                                    })
                                }}
                                className="text-left p-3 rounded-lg border border-silk-beige bg-white hover:border-primary-300 hover:shadow-soft-sm transition-all text-sm group"
                            >
                                <div className="font-bold text-charcoal mb-1 group-hover:text-primary-600 transition-colors">Recordatorio</div>
                                <div className="text-charcoal/60 text-xs line-clamp-2">Hola {'{{1}}'}, te recordamos tu cita...</div>
                            </button>
                            <button
                                onClick={() => {
                                    setNewTemplate({
                                        name: 'oferta_vacunacion',
                                        category: 'MARKETING',
                                        body: '¡Hola {{1}}! En {{5}} tenemos una promoción especial en {{2}} para ti. Responde este mensaje para reservar tu cupo.',
                                        buttons: ['Quiero reservar', 'Ver promoción']
                                    })
                                    setVariableExamples({
                                        1: 'Roco',
                                        2: 'Vacunación Anual',
                                        5: 'AnimalGrace'
                                    })
                                }}
                                className="text-left p-3 rounded-lg border border-silk-beige bg-white hover:border-primary-300 hover:shadow-soft-sm transition-all text-sm group"
                            >
                                <div className="font-bold text-charcoal mb-1 group-hover:text-primary-600 transition-colors">Oferta Especial</div>
                                <div className="text-charcoal/60 text-xs line-clamp-2">¡Hola {'{{1}}'}! Promoción en {'{{2}}'}...</div>
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        {/* Formularios e Inputs */}
                        <div className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-semibold text-charcoal mb-1">
                                        Nombre Interno <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        value={newTemplate.name}
                                        onChange={e => setNewTemplate({ ...newTemplate, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
                                        placeholder="ej. promocion_verano_2026"
                                        className="w-full p-3 bg-white border border-silk-beige rounded-xl text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none"
                                    />
                                    <p className="text-xs font-semibold text-charcoal/60 mt-1">Solo letras minúsculas, números y guiones bajos (_).</p>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-charcoal mb-1">
                                        Categoría
                                    </label>
                                    <select
                                        value={newTemplate.category}
                                        onChange={e => setNewTemplate({ ...newTemplate, category: e.target.value })}
                                        className="w-full p-3 bg-ivory border border-silk-beige rounded-xl text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none"
                                    >
                                        <option value="MARKETING">Marketing (Ofertas, Reactivación)</option>
                                        <option value="UTILITY">Utilidad (Recordatorios, Confirmaciones)</option>
                                        <option value="AUTHENTICATION">Autenticación (Códigos OTP)</option>
                                    </select>
                                </div>
                            </div>

                            <div className="flex-1 flex flex-col">
                                <label className="block text-sm font-semibold text-charcoal mb-2 flex items-center justify-between">
                                    <span>Cuerpo del Mensaje <span className="text-red-500">*</span></span>
                                </label>

                                {/* Seleccionador de Variables */}
                                <div className="mb-3 p-3 bg-white border border-silk-beige rounded-xl shadow-soft-sm">
                                    <div className="text-[11px] font-semibold text-charcoal/60 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                        <Code className="w-3.5 h-3.5 text-primary-500" /> Insertar Variables Dinámicas
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {QUICK_VARIABLES.map((v, i) => (
                                            <button
                                                key={i}
                                                type="button"
                                                onClick={() => insertVariable(v.num, v.example)}
                                                className="px-2.5 py-1.5 text-xs font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 hover:text-primary-800 border border-primary-200 rounded-lg transition-colors flex items-center gap-1.5"
                                                title={`Insertar variable para ${v.label}`}
                                            >
                                                <span>{v.icon}</span> {v.label}
                                            </button>
                                        ))}
                                    </div>
                                    <p className="text-xs font-bold text-charcoal/60 mt-2">Haz clic para insertar la variable en donde tienes el cursor del texto.</p>
                                </div>

                                <textarea
                                    ref={textareaRef}
                                    value={newTemplate.body}
                                    onChange={e => setNewTemplate({ ...newTemplate, body: e.target.value })}
                                    placeholder="Hola {{1}}, te escribimos de la clínica para recordarte..."
                                    className="w-full flex-1 p-3 bg-ivory border border-silk-beige rounded-xl text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none min-h-[120px] resize-none"
                                />

                                {/* Autocompletado Variables UI */}
                                {(() => {
                                    const matches = newTemplate.body.match(/\{\{\d+\}\}/g)
                                    if (!matches) return null

                                    const uniqueVars = Array.from(new Set(matches.map(m => parseInt(m.replace(/[{}]/g, ''))))).sort((a, b) => a - b)
                                    if (uniqueVars.length === 0) return null

                                    return (
                                        <div className="mt-3 p-3 bg-blue-50 rounded-xl border border-blue-100 animate-in fade-in">
                                            <h4 className="text-xs font-bold text-blue-800 flex items-center gap-1.5 mb-1">
                                                <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                                                Autocompletado de Variables Inteligente
                                            </h4>
                                            <p className="text-[11px] text-blue-700/80 mb-3">Detectamos las siguientes variables y le enviaremos a Meta estos ejemplos genéricos para asegurar su rápida aprobación:</p>
                                            <div className="flex flex-wrap gap-2">
                                                {uniqueVars.map((v) => {
                                                    const example = variableExamples[v] || genericExamples[v - 1] || "Ejemplo"
                                                    return (
                                                        <div key={v} className="flex flex-col bg-white border border-blue-200 rounded-lg p-2.5 shadow-soft-sm min-w-[110px]">
                                                            <span className="text-xs font-black text-blue-600 mb-1">Variable {'{{' + v + '}}'}</span>
                                                            <span className="text-xs font-medium text-charcoal">{example}</span>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    )
                                })()}
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-charcoal mb-2">Botones de Respuesta Rápida (Opcional, Max 3)</label>
                                {newTemplate.buttons.map((btn, idx) => (
                                    <div key={idx} className="flex gap-2 mb-2">
                                        <input
                                            type="text"
                                            value={btn}
                                            onChange={(e) => {
                                                const newButtons = [...newTemplate.buttons]
                                                newButtons[idx] = e.target.value
                                                setNewTemplate({ ...newTemplate, buttons: newButtons })
                                            }}
                                            placeholder={`Botón ${idx + 1}`}
                                            maxLength={25}
                                            className="flex-1 p-3 bg-white border border-silk-beige rounded-xl text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none"
                                        />
                                        <button
                                            onClick={() => setNewTemplate({ ...newTemplate, buttons: newTemplate.buttons.filter((_, i) => i !== idx) })}
                                            className="p-3 text-red-500 hover:bg-red-50 rounded-xl transition-colors border border-transparent hover:border-red-100 flex items-center justify-center"
                                        >
                                            <Trash2 className="w-5 h-5" />
                                        </button>
                                    </div>
                                ))}
                                {newTemplate.buttons.length < 3 && (
                                    <button
                                        onClick={() => setNewTemplate({ ...newTemplate, buttons: [...newTemplate.buttons, ''] })}
                                        className="text-sm text-primary-600 hover:text-primary-700 font-bold mt-1 flex items-center gap-1"
                                    >
                                        <Plus className="w-4 h-4" /> Agregar Botón
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Simulador Vista Previa (WhatsApp) */}
                        <div className="flex flex-col items-center justify-center p-6 lg:p-10 bg-gradient-to-br from-charcoal/5 to-charcoal/10 rounded-2xl border border-charcoal/10 relative overflow-hidden">
                            <div className="absolute top-4 left-4 flex gap-2 items-center text-charcoal/70 font-semibold text-xs uppercase tracking-wider bg-white/90 px-4 py-2 rounded-full shadow-sm">
                                <Smartphone className="w-4 h-4 text-primary-500" /> Simulador en Tiempo Real
                            </div>
                            {/* Marco de Teléfono */}
                            <div className="w-[320px] bg-[#EFEAE2] rounded-[2.5rem] p-4 shadow-2xl border-[12px] border-charcoal relative mt-8 h-[550px] flex flex-col justify-start overflow-hidden">
                                {/* WhatsApp Header */}
                                <div className="absolute top-0 left-0 right-0 bg-[#00A884] px-4 py-3 flex items-center gap-3 z-10 shadow-sm">
                                    <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center overflow-hidden">
                                        <div className="w-6 h-6 bg-white/40 rounded-full" />
                                    </div>
                                    <div>
                                        <p className="text-white text-sm font-semibold leading-tight">Tu Clínica</p>
                                        <p className="text-white/95 text-xs font-black tracking-tight">Cuenta de empresa</p>
                                    </div>
                                </div>
                                {/* Fondo con Patrón WhatsApp (CSS) */}
                                <div className="absolute inset-0 opacity-10 pointer-events-none" style={{
                                    backgroundImage: "radial-gradient(#000 1px, transparent 1px)",
                                    backgroundSize: "20px 20px"
                                }} />
                                {/* Contenedor de Mensajes */}
                                <div className="flex flex-col justify-end flex-1 pt-16 pb-4 relative z-10">
                                    {/* Chat bubble */}
                                    <div className="bg-white p-3.5 rounded-xl rounded-tl-sm shadow-sm text-[14px] text-[#111B21] mb-2 max-w-[92%] whitespace-pre-wrap leading-relaxed">
                                        {(() => {
                                            if (!newTemplate.body) return <span className="text-gray-400 italic font-light">Escribe el cuerpo del mensaje para previsualizar...</span>

                                            let previewBody = newTemplate.body
                                            // Replace {{n}} with actual examples in the simulator
                                            const matches = newTemplate.body.match(/\{\{\d+\}\}/g) || []
                                            matches.forEach(m => {
                                                const num = parseInt(m.replace(/[{}]/g, ''))
                                                const example = variableExamples[num] || genericExamples[num - 1] || m
                                                // Using split/join instead of replaceAll for broader compatibility
                                                previewBody = previewBody.split(m).join(`{{${example}}}`)
                                            })
                                            return previewBody
                                        })()}
                                        <div className="text-[11px] font-bold text-charcoal/50 text-right mt-1.5 ml-4 select-none">12:00</div>
                                    </div>

                                    {/* Buttons */}
                                    {newTemplate.buttons.map((btn, idx) => btn ? (
                                        <div key={idx} className="bg-white text-[#00A884] font-medium text-center p-2.5 rounded-xl shadow-[0_1px_1px_rgba(11,20,26,.1)] border border-gray-100 text-base mb-2 hover:bg-gray-50 transition-colors cursor-pointer select-none">
                                            {btn}
                                        </div>
                                    ) : null)}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="mt-6 flex justify-end gap-3 pt-6 border-t border-silk-beige">
                        <button
                            type="button"
                            onClick={() => setIsCreating(false)}
                            className="px-6 py-2.5 text-sm font-bold text-charcoal/60 hover:text-charcoal hover:bg-gray-100 rounded-xl transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={handleCreateTemplate}
                            disabled={creatingTemplate || !newTemplate.name || !newTemplate.body}
                            className="btn-primary"
                        >
                            {creatingTemplate ? 'Enviando...' : 'Enviar a Revisión'}
                        </button>
                    </div>
                </div>
            )}

            {/* Template List */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {templates.map(template => (
                    <div key={template.id} className="bg-white rounded-[1.5rem] border border-silk-beige p-5 hover:shadow-soft-md hover:border-primary-200 transition-all duration-300 flex flex-col group relative overflow-hidden">
                        {/* Soft background glow on hover */}
                        <div className="absolute inset-0 bg-gradient-to-br from-primary-50/0 via-transparent to-primary-50/50 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

                        <div className="flex justify-between items-start mb-5 relative z-10">
                            <div className="flex items-center gap-3.5">
                                <div className="p-3 bg-gradient-to-br from-primary-50 to-primary-100/50 rounded-2xl border border-primary-100 text-primary-600 group-hover:bg-primary-500 group-hover:text-white transition-all shadow-sm">
                                    <MessageSquare className="w-5 h-5 flex-shrink-0" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-charcoal text-base truncate max-w-[150px] leading-tight mb-1" title={template.name}>
                                        {template.name}
                                    </h3>
                                    {getStatusBadge(template.status)}
                                </div>
                            </div>
                            <button
                                onClick={() => handleDeleteTemplate(template.name)}
                                disabled={deletingTemplate === template.name}
                                className={`p-2 rounded-lg transition-colors ${deletingTemplate === template.name ? 'opacity-50 cursor-not-allowed' : 'text-charcoal/30 hover:text-red-500 hover:bg-red-50'}`}
                                title="Eliminar plantilla"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>

                        {/* WhatsApp-style bubble preview */}
                        <div className="flex-1 bg-[#EFEAE2]/50 rounded-2xl p-4 border border-[#cfc8bc]/30 relative z-10 shadow-inner flex flex-col">
                            {/* Decorative whatsapp pattern */}
                            <div className="absolute inset-0 opacity-[0.04] pointer-events-none rounded-2xl" style={{
                                backgroundImage: "radial-gradient(#000 1px, transparent 1px)",
                                backgroundSize: "12px 12px"
                            }} />

                            <div className="relative z-10 bg-white p-3.5 rounded-xl rounded-tl-sm shadow-sm text-[13.5px] text-charcoal/90 whitespace-pre-wrap leading-relaxed line-clamp-4 min-h-[80px]">
                                {template.desc || template.body || <span className="text-gray-400 italic">El contenido no está disponible para previsualizar...</span>}
                            </div>
                        </div>
                    </div>
                ))}

                {error && !isCreating && (
                    <div className="col-span-full py-16 text-center border-2 border-dashed border-red-200 bg-red-50/30 rounded-2xl">
                        <ShieldAlert className="w-12 h-12 text-red-500/40 mx-auto mb-4" />
                        <h3 className="text-lg font-bold text-red-700 mb-2">Error al sincronizar plantillas</h3>
                        <p className="text-red-600/70 max-w-sm mx-auto mb-6">
                            {error === 'Unauthorized' 
                                ? 'Tu sesión ha expirado o no tienes permisos suficientes. Por favor, intenta cerrar sesión y volver a entrar.'
                                : `Hubo un problema al conectar con YCloud: ${error}`}
                        </p>
                        <button
                            onClick={loadTemplates}
                            className="bg-red-600 hover:bg-red-700 text-white px-6 py-2.5 rounded-xl font-bold transition-all shadow-sm flex items-center gap-2 mx-auto"
                        >
                            <Sparkles className="w-4 h-4" />
                            Reintentar Sincronización
                        </button>
                    </div>
                )}

                {!error && templates.length === 0 && !isCreating && (
                    <div className="col-span-full py-16 text-center border-2 border-dashed border-silk-beige rounded-2xl">
                        <FileText className="w-12 h-12 text-charcoal/20 mx-auto mb-4" />
                        <h3 className="text-lg font-bold text-charcoal mb-2">No hay plantillas configuradas</h3>
                        <p className="text-charcoal/60 max-w-sm mx-auto mb-6">
                            Aún no has sincronizado plantillas desde YCloud. Crea tu primera plantilla para comenzar a usar la mensajería automática.
                        </p>
                        <button
                            onClick={() => setIsCreating(true)}
                            className="btn-primary mx-auto"
                        >
                            <Plus className="w-4 h-4 mr-2" />
                            Crear mi primera plantilla
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}
