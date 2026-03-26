import { useState, useEffect } from 'react'
import { Plus, Trash2, Smartphone, Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'

interface TemplateComponent {
    type: 'BODY' | 'BUTTONS'
    text?: string
    buttons?: Array<{ type: 'QUICK_REPLY'; text: string }>
}

interface Template {
    name: string
    language: string
    status: 'APPROVED' | 'PENDING' | 'REJECTED'
    category: string
    components: TemplateComponent[]
}

export function WhatsAppTemplates() {
    const [templates, setTemplates] = useState<Template[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState('')

    // Form state
    const [showForm, setShowForm] = useState(false)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [templateName, setTemplateName] = useState('')
    const [bodyText, setBodyText] = useState('')
    const [buttons, setButtons] = useState<string[]>([])

    const { profile } = useAuth()

    const fetchTemplates = async () => {
        if (!profile?.clinic_id) return

        setIsLoading(true)
        setError('')
        try {
            const { data, error } = await supabase.functions.invoke('get-ycloud-templates', {
                body: { clinic_id: profile.clinic_id }
            })

            if (error) throw error
            if (data?.isError || data?.error) {
                throw new Error(data.error || data.message || 'Error en la respuesta de la función')
            }

            if (data?.templates) {
                setTemplates(data.templates)
            }
        } catch (err: any) {
            console.error('Error fetching templates:', err)
            setError(err.message || 'Error al cargar las plantillas o no tienes configurada la API Key de YCloud.')
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        fetchTemplates()
    }, [])

    const handleAddButton = () => {
        if (buttons.length < 3) {
            setButtons([...buttons, ''])
        }
    }

    const handleButtonChange = (index: number, value: string) => {
        const newButtons = [...buttons]
        newButtons[index] = value
        setButtons(newButtons)
    }

    const handleRemoveButton = (index: number) => {
        setButtons(buttons.filter((_, i) => i !== index))
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!templateName || !bodyText) return

        setIsSubmitting(true)
        try {
            const validButtons = buttons.filter(b => b.trim() !== '')

            const payload = {
                clinic_id: profile?.clinic_id,
                name: templateName.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
                body_text: bodyText,
                category: 'UTILITY',
                buttons: validButtons
            }

            const { data, error } = await supabase.functions.invoke('create-ycloud-template', {
                body: payload
            })

            if (error) throw error
            if (data?.isError || data?.error) {
                throw new Error(data.error || data.message || 'Error al procesar la plantilla')
            }

            // Success
            setShowForm(false)
            setTemplateName('')
            setBodyText('')
            setButtons([])
            fetchTemplates()
        } catch (err: any) {
            console.error('Submit error:', err)
            alert(err.message || 'Error al enviar la plantilla a revisión')
        } finally {
            setIsSubmitting(false)
        }
    }



    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'APPROVED': return <CheckCircle2 className="w-4 h-4 text-green-500" />
            case 'PENDING': return <Clock className="w-4 h-4 text-amber-500" />
            case 'REJECTED': return <XCircle className="w-4 h-4 text-red-500" />
            default: return null
        }
    }

    if (isLoading) {
        return (
            <div className="flex justify-center p-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
        )
    }

    if (error) {
        return (
            <div className="bg-red-50 text-red-600 p-4 rounded-xl border border-red-100 flex flex-col items-center justify-center text-center">
                <p>{error}</p>
                <button onClick={fetchTemplates} className="mt-4 text-primary hover:underline text-sm font-medium">Reintentar</button>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-charcoal">Plantillas de WhatsApp</h3>
                    <p className="text-sm text-charcoal/60">Gestiona las plantillas oficiales pre-aprobadas para tus automatizaciones.</p>
                </div>
                {!showForm && (
                    <button
                        onClick={() => setShowForm(true)}
                        className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors flex items-center font-medium"
                    >
                        <Plus className="w-4 h-4 mr-2" />
                        Crear Plantilla
                    </button>
                )}
            </div>

            {showForm ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 bg-white p-6 rounded-xl border border-charcoal/10">
                    {/* Constructor */}
                    <div className="space-y-6">
                        <div className="flex items-center justify-between">
                            <h4 className="font-medium text-charcoal">Nueva Plantilla</h4>
                            <button onClick={() => setShowForm(false)} className="text-sm text-charcoal/50 hover:text-charcoal p-2">Cancelar</button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-charcoal mb-2">Nombre de Plantilla</label>
                                <input
                                    type="text"
                                    value={templateName}
                                    onChange={(e) => setTemplateName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                                    placeholder="ej: encuestra_satisfaccion"
                                    className="w-full px-4 py-2 bg-white border border-charcoal/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 text-charcoal"
                                />
                                <p className="text-xs text-charcoal/50 mt-1">Solo minúsculas y guiones bajos.</p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-charcoal mb-2">Mensaje (Texto)</label>
                                <textarea
                                    value={bodyText}
                                    onChange={(e) => setBodyText(e.target.value)}
                                    placeholder="Hola {{1}}, gracias por tu visita a {{2}}..."
                                    className="w-full px-4 py-2 bg-white border border-charcoal/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 text-charcoal min-h-[100px]"
                                />
                                <p className="text-xs text-charcoal/50 mt-1">Usa {"{{1}}"}, {"{{2}}"} para variables que rellenará Vetly AI AI de forma automática.</p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-charcoal mb-2">Botones de Respuesta Rápida (Opcional, Max 3)</label>
                                {buttons.map((btn, idx) => (
                                    <div key={idx} className="flex gap-2 mb-2">
                                        <input
                                            type="text"
                                            value={btn}
                                            onChange={(e) => handleButtonChange(idx, e.target.value)}
                                            placeholder={`Botón ${idx + 1}`}
                                            maxLength={20}
                                            className="flex-1 px-4 py-2 bg-white border border-charcoal/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 text-charcoal text-sm"
                                        />
                                        <button onClick={() => handleRemoveButton(idx)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg">
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                                {buttons.length < 3 && (
                                    <button onClick={handleAddButton} className="text-sm text-primary hover:underline font-medium mt-1">
                                        + Agregar Botón
                                    </button>
                                )}
                            </div>
                        </div>

                        <button
                            onClick={handleSubmit}
                            disabled={!templateName || !bodyText || isSubmitting}
                            className="w-full px-4 py-2.5 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 font-medium mt-4 flex items-center justify-center"
                        >
                            {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Enviar a Revisión en Meta'}
                        </button>
                        <p className="text-xs text-center text-charcoal/50">La aprobación suele tardar desde unos minutos hasta 24 horas.</p>
                    </div>

                    {/* Simulador Vista Previa */}
                    <div className="flex flex-col items-center justify-center p-6 bg-charcoal/5 rounded-xl border border-charcoal/10 relative overflow-hidden">
                        <div className="absolute top-4 left-4 flex gap-2 items-center text-charcoal/40 font-medium text-xs uppercase tracking-wider">
                            <Smartphone className="w-4 h-4" /> Simulador
                        </div>
                        <div className="w-[300px] bg-[#EFEAE2] rounded-[2rem] p-4 shadow-xl border-8 border-white relative mt-6 h-[400px] flex flex-col justify-end">
                            {/* Chate bubble */}
                            <div className="bg-white p-3 rounded-lg rounded-tl-none shadow-sm text-sm text-[#111B21] mb-2 max-w-[90%] whitespace-pre-wrap">
                                {bodyText || <span className="text-gray-400 italic">Escribe un mensaje para previsualizarlo...</span>}
                            </div>

                            {/* Buttons */}
                            {buttons.map((btn, idx) => btn ? (
                                <div key={idx} className="bg-white text-[#00A884] font-medium text-center p-3 rounded-lg shadow-sm text-sm mb-2 border border-gray-100 flex items-center justify-center">
                                    {btn}
                                </div>
                            ) : null)}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {templates.map(tpl => (
                        <div key={tpl.name} className="bg-white border border-charcoal/10 rounded-xl p-5 hover:border-primary/20 transition-colors text-left flex flex-col h-full">
                            <div className="flex items-center justify-between mb-2">
                                <span className="font-semibold text-charcoal truncate pr-2 flex-1 break-all" title={tpl.name}>{tpl.name}</span>
                                <div className="flex items-center gap-1.5 px-2 py-1 bg-charcoal/5 rounded-full whitespace-nowrap">
                                    {getStatusIcon(tpl.status)}
                                    <span className="text-xs font-medium text-charcoal/70">{tpl.status}</span>
                                </div>
                            </div>
                            <div className="flex-1 bg-charcoal/5 rounded-lg p-3 text-sm text-charcoal/80 whitespace-pre-wrap overflow-y-auto mb-4 max-h-[120px]">
                                {tpl.components.find(c => c.type === 'BODY')?.text || 'Sin texto'}
                            </div>
                            {/* Quick Replies list if any */}
                            {tpl.components.find(c => c.type === 'BUTTONS')?.buttons?.length ? (
                                <div className="flex flex-wrap gap-2 mb-3">
                                    {tpl.components.find(c => c.type === 'BUTTONS')?.buttons?.map((btn, i) => (
                                        <span key={i} className="text-xs font-bold font-medium px-2 py-1 bg-[#00A884]/10 text-[#00A884] rounded-md border border-[#00A884]/20 border-b-2">
                                            {btn.text}
                                        </span>
                                    ))}
                                </div>
                            ) : null}
                            <div className="text-xs text-charcoal/40 font-medium">Idioma: {tpl.language}</div>
                        </div>
                    ))}
                    {templates.length === 0 && (
                        <div className="col-span-full py-12 text-center border-2 border-dashed border-charcoal/10 rounded-xl">
                            <p className="text-charcoal/60 font-medium">No hay plantillas registradas. ¡Crea tu primera plantilla!</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
