import { useEffect, useRef, useState } from 'react'
import { MessageSquare, Check, Loader2, AlertCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'

// App "Vetly Omnicanal" y su configuración de Embedded Signup (Tech Provider).
// Ambos son públicos por diseño — el secreto vive en Supabase (META_APP_SECRET).
const META_APP_ID = '1658152138764158'
const META_CONFIG_ID = '1533217227702013'
const GRAPH_VERSION = 'v22.0'

// featureType 'whatsapp_business_app_onboarding' es lo que activa la coexistencia:
// conecta un número que ya vive en la WhatsApp Business App sin desconectar al usuario
// de su teléfono. El valor antiguo 'coexistence' quedó obsoleto. Sin este parámetro,
// el flujo registra el número como nuevo y expulsa a la clínica de su propia app.
const COEXISTENCE_FEATURE = 'whatsapp_business_app_onboarding'

interface Props {
    clinicId: string
    connectedPhoneNumberId?: string | null
    connectedWabaId?: string | null
    onConnected?: () => void
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare global { interface Window { FB?: any; fbAsyncInit?: () => void } }

type Status = 'idle' | 'loading_sdk' | 'connecting' | 'saving' | 'done' | 'error'

export default function MetaWhatsAppConnect({
    clinicId, connectedPhoneNumberId, connectedWabaId, onConnected,
}: Props) {
    const [status, setStatus] = useState<Status>('idle')
    const [error, setError] = useState<string | null>(null)
    const [result, setResult] = useState<{ phoneNumberId: string; wabaId: string } | null>(null)

    // El popup de Meta emite los IDs por postMessage y el code por el callback de FB.login.
    // Son dos canales distintos que llegan en orden variable, así que se guardan en refs
    // y se envían al backend cuando ambos están disponibles.
    const signupData = useRef<{ phoneNumberId?: string; wabaId?: string }>({})
    const codeRef = useRef<string | null>(null)

    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            if (!/(^|\.)facebook\.com$/.test(new URL(event.origin).hostname)) return
            try {
                const data = JSON.parse(event.data)
                if (data.type !== 'WA_EMBEDDED_SIGNUP') return
                if (data.event === 'FINISH' || data.event === 'FINISH_ONLY_WABA') {
                    signupData.current = {
                        phoneNumberId: data.data?.phone_number_id,
                        wabaId: data.data?.waba_id,
                    }
                } else if (data.event === 'CANCEL') {
                    setStatus('idle')
                    setError(data.data?.current_step ? `Cancelado en: ${data.data.current_step}` : 'Conexión cancelada')
                }
            } catch { /* mensajes ajenos al flujo */ }
        }
        window.addEventListener('message', onMessage)
        return () => window.removeEventListener('message', onMessage)
    }, [])

    const loadSdk = () => new Promise<void>((resolve, reject) => {
        if (window.FB) return resolve()
        const existing = document.getElementById('facebook-jssdk')
        if (existing) {
            existing.addEventListener('load', () => resolve())
            return
        }
        window.fbAsyncInit = () => {
            window.FB.init({ appId: META_APP_ID, autoLogAppEvents: true, xfbml: false, version: GRAPH_VERSION })
            resolve()
        }
        const script = document.createElement('script')
        script.id = 'facebook-jssdk'
        script.src = 'https://connect.facebook.net/en_US/sdk.js'
        script.async = true
        script.defer = true
        script.crossOrigin = 'anonymous'
        script.onerror = () => reject(new Error('No se pudo cargar el SDK de Meta'))
        document.body.appendChild(script)
    })

    const persist = async () => {
        const { phoneNumberId, wabaId } = signupData.current
        const code = codeRef.current
        if (!code) throw new Error('Meta no devolvió el código de autorización')

        setStatus('saving')
        const { data, error: fnError } = await supabase.functions.invoke('meta-embedded-signup', {
            body: { clinic_id: clinicId, code, phone_number_id: phoneNumberId, waba_id: wabaId },
        })
        if (fnError) throw new Error(fnError.message)
        if (data?.error) throw new Error(data.error)

        setResult({ phoneNumberId: data.phone_number_id, wabaId: data.waba_id })
        setStatus('done')
        onConnected?.()
    }

    const handleConnect = async () => {
        setError(null)
        signupData.current = {}
        codeRef.current = null

        try {
            setStatus('loading_sdk')
            await loadSdk()
            setStatus('connecting')

            window.FB.login(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (response: any) => {
                    if (response.authResponse?.code) {
                        codeRef.current = response.authResponse.code
                        persist().catch((e: Error) => { setError(e.message); setStatus('error') })
                    } else {
                        setStatus('idle')
                        setError('No se completó la autorización con Meta')
                    }
                },
                {
                    config_id: META_CONFIG_ID,
                    response_type: 'code',
                    override_default_response_type: true,
                    extras: {
                        setup: {},
                        featureType: COEXISTENCE_FEATURE,
                        sessionInfoVersion: '3',
                    },
                },
            )
        } catch (e) {
            setError((e as Error).message)
            setStatus('error')
        }
    }

    const isConnected = Boolean(connectedPhoneNumberId) || status === 'done'
    const busy = status === 'loading_sdk' || status === 'connecting' || status === 'saving'

    return (
        <div className="bg-white rounded-2xl border border-silk-beige shadow-sm overflow-hidden">
            <div className="p-5 sm:p-6 border-b border-silk-beige bg-sky-50/50 flex items-center gap-4">
                <div className="w-11 h-11 bg-emerald-100 rounded-xl flex items-center justify-center">
                    <MessageSquare className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                    <h2 className="text-base font-black text-charcoal">WhatsApp Cloud API (Meta)</h2>
                    <p className="text-xs text-charcoal/50 mt-0.5">
                        Conecta el número manteniendo la app en el teléfono
                    </p>
                </div>
            </div>

            <div className="p-5 sm:p-6">
            {isConnected ? (
                <div className="space-y-4">
                    <div className="flex items-start gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                        <Check className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                        <div className="text-sm">
                            <p className="font-medium text-emerald-900">Número conectado</p>
                            <p className="text-emerald-700/80 mt-1">
                                La clínica sigue usando WhatsApp Business en el teléfono y Vetly recibe los mensajes en paralelo.
                            </p>
                        </div>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-3 text-xs font-mono">
                        <div className="p-3 bg-ivory rounded-xl border border-silk-beige">
                            <p className="text-charcoal/40 mb-1">Phone Number ID</p>
                            <p className="text-charcoal break-all">{result?.phoneNumberId || connectedPhoneNumberId}</p>
                        </div>
                        <div className="p-3 bg-ivory rounded-xl border border-silk-beige">
                            <p className="text-charcoal/40 mb-1">WABA ID</p>
                            <p className="text-charcoal break-all">{result?.wabaId || connectedWabaId || '—'}</p>
                        </div>
                    </div>

                    {/* Estos IDs vienen de la base: si la WABA se eliminó del lado de Meta
                        siguen figurando acá aunque estén muertos, así que siempre debe haber
                        una salida para volver a conectar. */}
                    <button
                        onClick={handleConnect}
                        disabled={busy}
                        className="text-xs font-bold text-charcoal/50 hover:text-emerald-700 underline underline-offset-2 disabled:opacity-60"
                    >
                        {busy ? 'Conectando…' : 'Volver a conectar'}
                    </button>
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="text-sm text-charcoal/70 space-y-2">
                        <p>Antes de empezar, ten a mano el teléfono con WhatsApp Business abierto:</p>
                        <ol className="list-decimal list-inside space-y-1 text-charcoal/60">
                            <li>Elige el portfolio comercial y escribe el número de la clínica.</li>
                            <li>Llegará un mensaje del <span className="font-medium">Facebook Business Account</span> a ese WhatsApp.</li>
                            <li>Toca <span className="font-medium">"Conectar a la plataforma comercial"</span> y acepta compartir el historial.</li>
                            <li>Pega acá el código que aparezca en el teléfono.</li>
                        </ol>
                        <p className="text-xs text-charcoal/40">
                            Requiere WhatsApp Business 2.24.17 o superior. Las listas de difusión quedan deshabilitadas mientras el número esté conectado.
                        </p>
                    </div>

                    <button
                        onClick={handleConnect}
                        disabled={busy}
                        className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl transition-colors flex items-center gap-2 disabled:opacity-60"
                    >
                        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                        {status === 'loading_sdk' && 'Cargando…'}
                        {status === 'connecting' && 'Esperando a Meta…'}
                        {status === 'saving' && 'Guardando conexión…'}
                        {(status === 'idle' || status === 'error') && 'Conectar WhatsApp'}
                    </button>
                </div>
            )}

            {error && (
                <div className="flex items-start gap-2 mt-4 p-3 bg-rose-50 border border-rose-200 rounded-xl">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <p className="text-sm text-rose-700">{error}</p>
                </div>
            )}
            </div>
        </div>
    )
}
