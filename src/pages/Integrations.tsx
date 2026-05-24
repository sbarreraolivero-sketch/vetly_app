import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import {
    Plug, MessageSquare, Webhook, Globe, Save, Plus, Trash2,
    ChevronRight, Check, Copy, Send, ToggleLeft, ToggleRight,
    Loader2, X, AlertCircle, CheckCircle2, ShieldCheck
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'react-hot-toast'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''

interface WebhookConfig {
    id?: string
    name: string
    url: string
    events: string[]
    is_active: boolean
    secret: string
    last_triggered_at?: string | null
    last_status_code?: number | null
}

const WEBHOOK_EVENTS = [
    { value: 'appointment.created', label: 'Nueva cita creada' },
    { value: 'appointment.confirmed', label: 'Cita confirmada' },
    { value: 'appointment.cancelled', label: 'Cita cancelada' },
    { value: 'appointment.rescheduled', label: 'Cita reagendada' },
    { value: 'message.received', label: 'Mensaje recibido' },
    { value: 'message.sent', label: 'Mensaje enviado' },
    { value: 'patient.created', label: 'Nuevo paciente' },
    { value: 'patient.updated', label: 'Paciente actualizado' },
]

export default function Integrations() {
    const { profile } = useAuth()

    const [yCloudApiKey, setYCloudApiKey] = useState('')
    const [yCloudPhoneNumber, setYCloudPhoneNumber] = useState('')
    const [yCloudWebhookSecret, setYCloudWebhookSecret] = useState('')
    const [copiedWebhook, setCopiedWebhook] = useState(false)
    const [isSaving, setIsSaving] = useState(false)
    const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')

    const [webhooks, setWebhooks] = useState<WebhookConfig[]>([])
    const [showWebhookModal, setShowWebhookModal] = useState(false)
    const [editingWebhook, setEditingWebhook] = useState<WebhookConfig | null>(null)
    const [webhookForm, setWebhookForm] = useState<WebhookConfig>({ name: '', url: '', events: [], is_active: true, secret: '' })
    const [savingWebhook, setSavingWebhook] = useState(false)
    const [testingWebhook, setTestingWebhook] = useState<string | null>(null)

    const webhookUrl = `${SUPABASE_URL}/functions/v1/ycloud-whatsapp-webhook`

    useEffect(() => {
        if (!profile?.clinic_id) return
        const load = async () => {
            const [{ data: cs }, { data: whs }] = await Promise.all([
                (supabase as any).from('clinic_settings').select('ycloud_api_key,ycloud_phone_number,ycloud_webhook_secret').eq('id', profile.clinic_id).single(),
                (supabase as any).from('webhooks').select('*').eq('clinic_id', profile.clinic_id).order('created_at', { ascending: true })
            ])
            if (cs) {
                setYCloudApiKey(cs.ycloud_api_key || '')
                setYCloudPhoneNumber(cs.ycloud_phone_number || '')
                setYCloudWebhookSecret(cs.ycloud_webhook_secret || '')
            }
            if (whs) setWebhooks(whs)
        }
        load()
    }, [profile?.clinic_id])

    const copyWebhookUrl = async () => {
        await navigator.clipboard.writeText(webhookUrl)
        setCopiedWebhook(true)
        setTimeout(() => setCopiedWebhook(false), 2000)
    }

    const saveIntegrations = async () => {
        if (!profile?.clinic_id) return
        setIsSaving(true)
        setSaveStatus('idle')
        try {
            const { error } = await (supabase as any).from('clinic_settings').update({
                ycloud_api_key: yCloudApiKey || null,
                ycloud_phone_number: yCloudPhoneNumber || null,
                ycloud_webhook_secret: yCloudWebhookSecret || null,
                updated_at: new Date().toISOString(),
            }).eq('id', profile.clinic_id)
            if (error) throw error
            setSaveStatus('success')
            toast.success('Integraciones guardadas correctamente')
            setTimeout(() => setSaveStatus('idle'), 3000)
        } catch (error: any) {
            toast.error('Error al guardar: ' + (error?.message || 'Intenta nuevamente'))
            setSaveStatus('error')
            setTimeout(() => setSaveStatus('idle'), 3000)
        } finally {
            setIsSaving(false)
        }
    }

    const openWebhookModal = (webhook?: WebhookConfig) => {
        if (webhook) {
            setEditingWebhook(webhook)
            setWebhookForm({ ...webhook })
        } else {
            setEditingWebhook(null)
            setWebhookForm({ name: '', url: '', events: [], is_active: true, secret: '' })
        }
        setShowWebhookModal(true)
    }

    const closeWebhookModal = () => {
        setShowWebhookModal(false)
        setEditingWebhook(null)
        setWebhookForm({ name: '', url: '', events: [], is_active: true, secret: '' })
    }

    const handleSaveWebhook = async () => {
        if (!profile?.clinic_id || !webhookForm.url.trim() || !webhookForm.name.trim()) return
        setSavingWebhook(true)
        try {
            if (editingWebhook?.id) {
                const { error } = await (supabase as any).from('webhooks').update({
                    name: webhookForm.name.trim(), url: webhookForm.url.trim(),
                    events: webhookForm.events, is_active: webhookForm.is_active,
                    secret: webhookForm.secret || null, updated_at: new Date().toISOString(),
                }).eq('id', editingWebhook.id)
                if (error) throw error
            } else {
                const { error } = await (supabase as any).from('webhooks').insert({
                    clinic_id: profile.clinic_id, name: webhookForm.name.trim(),
                    url: webhookForm.url.trim(), events: webhookForm.events,
                    is_active: webhookForm.is_active, secret: webhookForm.secret || null,
                })
                if (error) throw error
            }
            closeWebhookModal()
            const { data } = await (supabase as any).from('webhooks').select('*').eq('clinic_id', profile.clinic_id).order('created_at', { ascending: true })
            if (data) setWebhooks(data)
        } catch (error) {
            console.error('Error saving webhook:', error)
            alert('Error al guardar el webhook.')
        } finally {
            setSavingWebhook(false)
        }
    }

    const handleDeleteWebhook = async (id: string) => {
        if (!profile?.clinic_id) return
        const { error } = await (supabase as any).from('webhooks').delete().eq('id', id)
        if (!error) setWebhooks(prev => prev.filter(w => w.id !== id))
    }

    const handleToggleWebhook = async (id: string, currentActive: boolean) => {
        const { error } = await (supabase as any).from('webhooks').update({ is_active: !currentActive, updated_at: new Date().toISOString() }).eq('id', id)
        if (!error) setWebhooks(prev => prev.map(w => w.id === id ? { ...w, is_active: !currentActive } : w))
    }

    const handleTestWebhook = async (webhook: WebhookConfig) => {
        if (!webhook.id) return
        setTestingWebhook(webhook.id)
        try {
            await fetch(webhook.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(webhook.secret ? { 'X-Webhook-Secret': webhook.secret } : {}) },
                mode: 'no-cors',
                body: JSON.stringify({ event: 'test.ping', timestamp: new Date().toISOString(), data: { message: 'Test webhook from Vetly AI' } }),
            })
            await (supabase as any).from('webhooks').update({ last_triggered_at: new Date().toISOString() }).eq('id', webhook.id)
            setWebhooks(prev => prev.map(w => w.id === webhook.id ? { ...w, last_triggered_at: new Date().toISOString() } : w))
            alert('✅ Webhook de prueba enviado correctamente.')
        } catch {
            alert('⚠️ No se pudo verificar la respuesta del webhook (puede ser un problema de CORS). El webhook podría haber sido recibido igualmente.')
        } finally {
            setTestingWebhook(null)
        }
    }

    const toggleWebhookEvent = (event: string) => {
        setWebhookForm(prev => ({
            ...prev,
            events: prev.events.includes(event) ? prev.events.filter(e => e !== event) : [...prev.events, event]
        }))
    }

    return (
        <div className="space-y-6 max-w-5xl mx-auto pb-20 animate-fade-in">
            {/* Banner */}
            <div className="bg-gradient-to-br from-sky-500 to-sky-700 rounded-2xl overflow-hidden shadow-soft-md">
                <div className="p-6 sm:p-8">
                    <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                            <p className="text-xs font-black uppercase tracking-widest text-sky-200 mb-2">Agente IA</p>
                            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">Integraciones</h1>
                            <p className="text-sm text-sky-100/80 font-light mt-1">Conecta tu número de WhatsApp Business y automatizaciones externas.</p>
                        </div>
                        <div className="w-12 h-12 bg-white/15 rounded-2xl flex items-center justify-center shrink-0">
                            <Plug className="w-6 h-6 text-white" />
                        </div>
                    </div>
                </div>
            </div>

            {/* YCloud */}
            <div className="bg-white rounded-2xl border border-silk-beige shadow-sm overflow-hidden">
                <div className="p-5 sm:p-6 border-b border-silk-beige bg-sky-50/50 flex items-center gap-4">
                    <div className="w-11 h-11 bg-emerald-100 rounded-xl flex items-center justify-center">
                        <MessageSquare className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div>
                        <h2 className="text-base font-black text-charcoal">YCloud WhatsApp API</h2>
                        <p className="text-xs text-charcoal/50 mt-0.5">Conecta tu número de WhatsApp Business</p>
                    </div>
                </div>
                <div className="p-5 sm:p-6 space-y-5">
                    <div>
                        <label className="block text-xs font-black text-charcoal/60 uppercase tracking-wider mb-2">API Key</label>
                        <input
                            type="password"
                            placeholder="yc_xxxxxxxxxxxxxxxxxxxxxx"
                            value={yCloudApiKey}
                            onChange={(e) => setYCloudApiKey(e.target.value)}
                            className="w-full bg-ivory border border-silk-beige rounded-xl px-4 py-2.5 text-sm font-medium text-charcoal focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20 transition-all"
                        />
                        <p className="text-xs text-charcoal/40 mt-1.5">
                            Obtén tu API Key desde <a href="https://www.ycloud.com" target="_blank" rel="noopener noreferrer" className="text-sky-600 hover:underline">ycloud.com</a>
                        </p>
                    </div>
                    <div>
                        <label className="block text-xs font-black text-charcoal/60 uppercase tracking-wider mb-2">Número de WhatsApp</label>
                        <input
                            type="text"
                            placeholder="+521234567890"
                            value={yCloudPhoneNumber}
                            onChange={(e) => setYCloudPhoneNumber(e.target.value)}
                            className="w-full bg-ivory border border-silk-beige rounded-xl px-4 py-2.5 text-sm font-medium text-charcoal focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20 transition-all"
                        />
                        <p className="text-xs text-charcoal/40 mt-1.5">Número registrado en YCloud, con código de país</p>
                    </div>
                    <div>
                        <label className="block text-xs font-black text-charcoal/60 uppercase tracking-wider mb-2">Webhook Secret</label>
                        <input
                            type="password"
                            placeholder="whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                            value={yCloudWebhookSecret}
                            onChange={(e) => setYCloudWebhookSecret(e.target.value)}
                            className="w-full bg-ivory border border-silk-beige rounded-xl px-4 py-2.5 text-sm font-medium text-charcoal focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20 transition-all"
                        />
                        <p className="text-xs text-charcoal/40 mt-1.5 flex items-center gap-1.5">
                            <ShieldCheck className="w-3.5 h-3.5 text-sky-500" />
                            Firma HMAC-SHA256 — YCloud → Developer → Webhooks → Signing Secret
                        </p>
                    </div>
                    <div>
                        <label className="block text-xs font-black text-charcoal/60 uppercase tracking-wider mb-2">Webhook URL</label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={webhookUrl}
                                disabled
                                className="flex-1 bg-ivory border border-silk-beige rounded-xl px-4 py-2.5 text-sm font-mono text-charcoal/60"
                            />
                            <button
                                onClick={copyWebhookUrl}
                                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-silk-beige bg-white text-sm font-bold text-charcoal hover:bg-sky-50 hover:border-sky-300 hover:text-sky-700 transition-all"
                            >
                                {copiedWebhook ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                {copiedWebhook ? 'Copiado' : 'Copiar'}
                            </button>
                        </div>
                        <p className="text-xs text-charcoal/40 mt-1.5">Configura esta URL en YCloud → Developer → Webhooks</p>
                    </div>
                </div>
            </div>

            {/* Webhooks */}
            <div className="bg-white rounded-2xl border border-silk-beige shadow-sm overflow-hidden">
                <div className="p-5 sm:p-6 border-b border-silk-beige bg-sky-50/50 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <div className="w-11 h-11 bg-orange-100 rounded-xl flex items-center justify-center">
                            <Webhook className="w-5 h-5 text-orange-600" />
                        </div>
                        <div>
                            <h2 className="text-base font-black text-charcoal">Webhooks</h2>
                            <p className="text-xs text-charcoal/50 mt-0.5">Conecta con n8n, Make, Zapier y otras automatizaciones</p>
                        </div>
                    </div>
                    <button
                        onClick={() => openWebhookModal()}
                        className="flex items-center gap-2 bg-sky-500 text-white text-xs font-black uppercase tracking-widest px-4 py-2.5 rounded-xl hover:bg-sky-600 transition-colors shadow-sm"
                    >
                        <Plus className="w-4 h-4" />
                        Añadir
                    </button>
                </div>
                <div className="p-5 sm:p-6">
                    {webhooks.length === 0 ? (
                        <div className="text-center py-10 border-2 border-dashed border-silk-beige rounded-2xl">
                            <Globe className="w-10 h-10 text-charcoal/20 mx-auto mb-3" />
                            <p className="text-charcoal/50 text-sm font-medium mb-1">No hay webhooks configurados</p>
                            <p className="text-charcoal/40 text-xs">Añade un webhook para enviar eventos a herramientas externas</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {webhooks.map((wh) => (
                                <div
                                    key={wh.id}
                                    className={cn(
                                        'border rounded-xl p-4 transition-all',
                                        wh.is_active ? 'border-silk-beige bg-white hover:shadow-sm' : 'border-silk-beige bg-ivory/50 opacity-60'
                                    )}
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-3">
                                            <div className={cn('w-2.5 h-2.5 rounded-full', wh.is_active ? 'bg-emerald-400' : 'bg-charcoal/20')} />
                                            <h3 className="font-bold text-charcoal text-sm">{wh.name}</h3>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <button onClick={() => handleTestWebhook(wh)} disabled={!wh.is_active || testingWebhook === wh.id} className="p-1.5 rounded-lg hover:bg-blue-50 transition-colors disabled:opacity-50" title="Enviar prueba">
                                                {testingWebhook === wh.id ? <Loader2 className="w-4 h-4 text-blue-500 animate-spin" /> : <Send className="w-4 h-4 text-blue-500" />}
                                            </button>
                                            <button onClick={() => handleToggleWebhook(wh.id!, wh.is_active)} className="p-1.5 rounded-lg hover:bg-ivory transition-colors" title={wh.is_active ? 'Desactivar' : 'Activar'}>
                                                {wh.is_active ? <ToggleRight className="w-5 h-5 text-emerald-500" /> : <ToggleLeft className="w-5 h-5 text-charcoal/30" />}
                                            </button>
                                            <button onClick={() => openWebhookModal(wh)} className="p-1.5 rounded-lg hover:bg-ivory transition-colors" title="Editar">
                                                <ChevronRight className="w-4 h-4 text-charcoal/50" />
                                            </button>
                                            <button onClick={() => handleDeleteWebhook(wh.id!)} className="p-1.5 rounded-lg hover:bg-red-50 transition-colors" title="Eliminar">
                                                <Trash2 className="w-4 h-4 text-red-400" />
                                            </button>
                                        </div>
                                    </div>
                                    <p className="text-xs text-charcoal/40 font-mono truncate mb-2 pl-5">{wh.url}</p>
                                    <div className="flex items-center gap-2 flex-wrap pl-5">
                                        {wh.events.length > 0 ? wh.events.map(ev => (
                                            <span key={ev} className="text-xs bg-orange-50 text-orange-600 px-2 py-0.5 rounded-full border border-orange-200">{ev}</span>
                                        )) : (
                                            <span className="text-xs text-charcoal/30">Sin eventos seleccionados</span>
                                        )}
                                        {wh.last_triggered_at && (
                                            <span className="text-xs text-charcoal/30 ml-auto">Último: {new Date(wh.last_triggered_at).toLocaleString()}</span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="mt-5 p-3 bg-amber-50/80 rounded-xl border border-amber-200/50">
                        <p className="text-xs text-amber-700">
                            <strong>💡 Tip:</strong> En n8n, usa el nodo "Webhook" y pega la URL generada por n8n aquí. Selecciona los eventos que deseas recibir.
                        </p>
                    </div>
                </div>
            </div>

            {/* Save button */}
            <div className="flex items-center gap-4">
                <button
                    onClick={saveIntegrations}
                    disabled={isSaving}
                    className="flex items-center gap-2 bg-sky-500 text-white font-black text-sm px-6 py-3 rounded-xl hover:bg-sky-600 transition-colors shadow-sm disabled:opacity-50"
                >
                    {isSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</> : <><Save className="w-4 h-4" /> Guardar Integraciones</>}
                </button>
                {saveStatus === 'success' && (
                    <div className="flex items-center gap-2 text-emerald-600 text-sm bg-emerald-50 px-4 py-2.5 rounded-xl">
                        <CheckCircle2 className="w-4 h-4" /> Guardado correctamente
                    </div>
                )}
                {saveStatus === 'error' && (
                    <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 px-4 py-2.5 rounded-xl">
                        <AlertCircle className="w-4 h-4" /> Error al guardar
                    </div>
                )}
            </div>

            {/* Webhook Modal */}
            {showWebhookModal && (
                <div className="fixed inset-0 bg-charcoal/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
                        <div className="flex items-center justify-between p-6 border-b border-silk-beige">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center">
                                    <Webhook className="w-5 h-5 text-orange-500" />
                                </div>
                                <h2 className="text-base font-black text-charcoal">
                                    {editingWebhook ? 'Editar Webhook' : 'Nuevo Webhook'}
                                </h2>
                            </div>
                            <button onClick={closeWebhookModal} className="p-2 hover:bg-ivory rounded-xl transition-colors">
                                <X className="w-5 h-5 text-charcoal/50" />
                            </button>
                        </div>
                        <div className="p-6 space-y-5">
                            <div>
                                <label className="block text-xs font-black text-charcoal/60 uppercase tracking-wider mb-2">Nombre</label>
                                <input
                                    type="text"
                                    value={webhookForm.name}
                                    onChange={(e) => setWebhookForm(prev => ({ ...prev, name: e.target.value }))}
                                    placeholder="Ej: n8n - Notificaciones"
                                    className="w-full bg-ivory border border-silk-beige rounded-xl px-4 py-2.5 text-sm font-medium text-charcoal focus:outline-none focus:border-sky-400"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-black text-charcoal/60 uppercase tracking-wider mb-2">URL del Webhook</label>
                                <input
                                    type="url"
                                    value={webhookForm.url}
                                    onChange={(e) => setWebhookForm(prev => ({ ...prev, url: e.target.value }))}
                                    placeholder="https://tu-n8n-instance.com/webhook/..."
                                    className="w-full bg-ivory border border-silk-beige rounded-xl px-4 py-2.5 text-sm font-mono text-charcoal focus:outline-none focus:border-sky-400"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-black text-charcoal/60 uppercase tracking-wider mb-2">Secret (opcional)</label>
                                <input
                                    type="password"
                                    value={webhookForm.secret}
                                    onChange={(e) => setWebhookForm(prev => ({ ...prev, secret: e.target.value }))}
                                    placeholder="Tu clave secreta para verificar webhooks"
                                    className="w-full bg-ivory border border-silk-beige rounded-xl px-4 py-2.5 text-sm font-medium text-charcoal focus:outline-none focus:border-sky-400"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-black text-charcoal/60 uppercase tracking-wider mb-2">Eventos a escuchar</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {WEBHOOK_EVENTS.map(ev => (
                                        <label
                                            key={ev.value}
                                            className={cn(
                                                'flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer transition-all text-sm',
                                                webhookForm.events.includes(ev.value)
                                                    ? 'bg-orange-50 border-orange-300 text-orange-700'
                                                    : 'bg-white border-silk-beige text-charcoal/60 hover:bg-ivory'
                                            )}
                                        >
                                            <input type="checkbox" checked={webhookForm.events.includes(ev.value)} onChange={() => toggleWebhookEvent(ev.value)} className="sr-only" />
                                            <div className={cn('w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0', webhookForm.events.includes(ev.value) ? 'bg-orange-500 border-orange-500' : 'border-silk-beige')}>
                                                {webhookForm.events.includes(ev.value) && <Check className="w-3 h-3 text-white" />}
                                            </div>
                                            {ev.label}
                                        </label>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 p-6 border-t border-silk-beige">
                            <button onClick={closeWebhookModal} className="px-4 py-2.5 text-sm font-bold text-charcoal/60 hover:text-charcoal transition-colors">Cancelar</button>
                            <button
                                onClick={handleSaveWebhook}
                                disabled={savingWebhook || !webhookForm.name.trim() || !webhookForm.url.trim()}
                                className="flex items-center gap-2 bg-sky-500 text-white font-black text-sm px-5 py-2.5 rounded-xl hover:bg-sky-600 disabled:opacity-50 transition-colors"
                            >
                                {savingWebhook ? <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</> : <><Save className="w-4 h-4" /> {editingWebhook ? 'Guardar' : 'Crear Webhook'}</>}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
