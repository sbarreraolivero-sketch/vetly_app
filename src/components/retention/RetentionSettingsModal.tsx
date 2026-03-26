import { useState, useEffect } from 'react'
import { X, Save, Zap, MessageSquare, AlertTriangle, Clock, RefreshCw, ArrowRight } from 'lucide-react'
import { retentionService, type RetentionSettings, type YCloudTemplate } from '@/services/retentionService'
import { toast } from 'react-hot-toast'
import { cn } from '@/lib/utils'
import { Link } from 'react-router-dom'

interface RetentionSettingsModalProps {
    isOpen: boolean
    onClose: () => void
    clinicId: string
    onSaved: () => void
}

// Remove templates placeholder array to enforce real data

export function RetentionSettingsModal({ isOpen, onClose, clinicId, onSaved }: RetentionSettingsModalProps) {
    const [settings, setSettings] = useState<RetentionSettings>({
        autonomous_mode: false,
        medium_risk_template: 'retention_warning_soft',
        high_risk_template: 'retention_danger_offer'
    })
    const [templates, setTemplates] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [usingRemote, setUsingRemote] = useState(false)

    useEffect(() => {
        if (isOpen && clinicId) {
            loadData()
        }
    }, [isOpen, clinicId])

    const loadData = async () => {
        setLoading(true)
        try {
            // Parallel fetch: Settings + Remote Templates
            const [settingsData, remoteTemplates] = await Promise.all([
                retentionService.getSettings(clinicId),
                retentionService.getRemoteTemplates(clinicId).catch(err => {
                    console.warn('Failed to fetch remote templates:', err)
                    return []
                })
            ])

            setSettings(settingsData)

            if (remoteTemplates && remoteTemplates.length > 0) {
                setTemplates(remoteTemplates.map((t: YCloudTemplate) => ({
                    id: t.name,
                    name: t.name, // YCloud template name is the ID
                    desc: t.body || '(Sin vista previa)'
                })))
                setUsingRemote(true)
            } else {
                setUsingRemote(false)
                setTemplates([]) // No templates available
            }

        } catch (err) {
            console.error(err)
            toast.error('Error al cargar configuración')
        } finally {
            setLoading(false)
        }
    }

    const handleSave = async () => {
        setSaving(true)
        try {
            await retentionService.updateSettings(clinicId, settings)
            toast.success('Configuración guardada')
            onSaved()
            onClose()
        } catch (err) {
            console.error(err)
            toast.error('Error al guardar cambios')
        } finally {
            setSaving(false)
        }
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-charcoal/40 backdrop-blur-sm">
            <div className="bg-white w-full max-w-lg rounded-2xl shadow-xl border border-silk-beige overflow-hidden flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="px-6 py-4 border-b border-silk-beige flex items-center justify-between bg-ivory/50">
                    <h2 className="text-lg font-bold text-charcoal flex items-center gap-2">
                        <Zap className="w-5 h-5 text-primary-500" />
                        Configurar Motor de IA
                    </h2>
                    <button onClick={onClose} className="p-1 hover:bg-black/5 rounded-full transition-colors text-charcoal/50 hover:text-charcoal">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 overflow-y-auto space-y-6 flex-1">
                    {loading ? (
                        <div className="flex justify-center py-8">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
                        </div>
                    ) : (
                        <>
                            {/* Mode Section */}
                            <div className="space-y-3">
                                <label className="text-sm font-semibold text-charcoal">Modo de Operación</label>
                                <div className={cn(
                                    "flex items-start gap-4 p-4 rounded-xl border transition-all cursor-pointer",
                                    settings.autonomous_mode
                                        ? "bg-primary-50 border-primary-200"
                                        : "bg-white border-silk-beige hover:border-primary-200"
                                )}
                                    onClick={() => setSettings(s => ({ ...s, autonomous_mode: !s.autonomous_mode }))}
                                >
                                    <div className={cn(
                                        "w-10 h-6 rounded-full relative transition-colors mt-0.5 flex-shrink-0",
                                        settings.autonomous_mode ? "bg-primary-500" : "bg-charcoal/20"
                                    )}>
                                        <div className={cn(
                                            "absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform",
                                            settings.autonomous_mode ? "translate-x-4" : "translate-x-0"
                                        )} />
                                    </div>
                                    <div>
                                        <p className="font-semibold text-charcoal text-sm">
                                            {settings.autonomous_mode ? 'Modo Autónomo (Piloto Automático)' : 'Modo Supervisado'}
                                        </p>
                                        <p className="text-xs text-charcoal/60 mt-1 leading-relaxed">
                                            {settings.autonomous_mode
                                                ? 'La IA enviará los mensajes automáticamente cuando detecte riesgo, sin esperar tu aprobación.'
                                                : 'La IA generará sugerencias que deberás aprobar manualmente antes de ser enviadas.'}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <hr className="border-silk-beige" />

                            {/* Templates Section */}
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-sm font-semibold text-charcoal flex items-center gap-2">
                                        <MessageSquare className="w-4 h-4 text-primary-500" />
                                        Estrategia de Comunicación
                                    </h3>
                                    <div className="flex gap-2 items-center">
                                        {usingRemote && (
                                            <span className="text-xs font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                                Online
                                            </span>
                                        )}
                                        <Link
                                            to="/app/templates"
                                            onClick={() => onClose()}
                                            className="text-xs font-bold text-primary-600 hover:text-primary-700 font-bold flex items-center gap-1 transition-colors"
                                            title="Administrar plantillas de WhatsApp"
                                        >
                                            Administrar Plantillas <ArrowRight className="w-3 h-3" />
                                        </Link>
                                    </div>
                                </div>

                                {/* Medium Risk */}
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-charcoal/60 flex items-center gap-1.5 uppercase tracking-wide">
                                        <Clock className="w-3.5 h-3.5 text-amber-500" />
                                        Riesgo Medio (Retraso Leve)
                                    </label>
                                    <select
                                        value={settings.medium_risk_template}
                                        onChange={e => setSettings(s => ({ ...s, medium_risk_template: e.target.value }))}
                                        disabled={templates.length === 0}
                                        className="w-full p-2.5 bg-ivory border border-silk-beige rounded-xl text-sm text-charcoal focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <option value="">{templates.length === 0 ? 'No hay plantillas disponibles en YCloud' : 'Selecciona una plantilla...'}</option>
                                        {templates.map(t => (
                                            <option key={t.id} value={t.id}>{t.name}</option>
                                        ))}
                                    </select>
                                    <p className="text-xs text-charcoal/40 px-1 bg-gray-50 p-2 rounded-lg border border-dashed border-gray-200 min-h-[40px]">
                                        {templates.find(t => t.id === settings.medium_risk_template)?.desc || (templates.length === 0 ? 'Sin plantillas configuradas. Ve a la sección Plantillas para crear o sincronizar.' : 'Selecciona una plantilla para ver previsualización')}
                                    </p>
                                </div>

                                {/* High Risk */}
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-charcoal/60 flex items-center gap-1.5 uppercase tracking-wide">
                                        <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                                        Riesgo Alto (Pérdida Inminente)
                                    </label>
                                    <select
                                        value={settings.high_risk_template}
                                        onChange={e => setSettings(s => ({ ...s, high_risk_template: e.target.value }))}
                                        disabled={templates.length === 0}
                                        className="w-full p-2.5 bg-ivory border border-silk-beige rounded-xl text-sm text-charcoal focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <option value="">{templates.length === 0 ? 'No hay plantillas disponibles en YCloud' : 'Selecciona una plantilla...'}</option>
                                        {templates.map(t => (
                                            <option key={t.id} value={t.id}>{t.name}</option>
                                        ))}
                                    </select>
                                    <p className="text-xs text-charcoal/40 px-1 bg-gray-50 p-2 rounded-lg border border-dashed border-gray-200 min-h-[40px]">
                                        {templates.find(t => t.id === settings.high_risk_template)?.desc || (templates.length === 0 ? 'Sin plantillas configuradas. Ve a la sección Plantillas para crear o sincronizar.' : 'Selecciona una plantilla para ver previsualización')}
                                    </p>
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-silk-beige bg-ivory/30 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm text-charcoal/60 hover:text-charcoal font-medium hover:bg-black/5 rounded-xl transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving || loading}
                        className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-xl hover:bg-primary-700 transition-colors shadow-lg shadow-primary-500/20 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {saving ? (
                            <>
                                <RefreshCw className="w-4 h-4 animate-spin" />
                                Guardando...
                            </>
                        ) : (
                            <>
                                <Save className="w-4 h-4" />
                                Guardar Cambios
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    )
}
