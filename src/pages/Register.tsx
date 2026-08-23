import { useState, useEffect, useRef } from 'react'
import { toast } from 'react-hot-toast'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Sparkles, Mail, Lock, User, Building2, ArrowRight, Loader2, Check, ShieldCheck, MessageCircle, Star } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { PLANS } from '@/lib/mercadopago'
import { PADDLE_PLANS } from '@/lib/paddle'
import { getAttribution, hasPaidAttribution } from '@/lib/attribution'
// Payment SDKs removed for free-trial onboarding

const PLAN_ORDER = ['core', 'starter', 'pro', 'enterprise'] as const

// Site key pública — segura de exponer en el bundle. Sin configurar, el
// widget simplemente no se monta (signup-handler tampoco bloquea sin la
// secret key del lado del servidor — ver fail-open ahí).
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined

declare global {
    interface Window {
        turnstile?: {
            render: (container: HTMLElement, options: { sitekey: string; callback: (token: string) => void; 'expired-callback'?: () => void }) => string
            remove: (widgetId: string) => void
        }
        gtag?: (...args: unknown[]) => void
        vetlyGa4Ready?: boolean
        fbq?: (...args: unknown[]) => void
    }
}

// Conversión "Registros" de Google Ads (AW-18395838136/CU91CNiuu-McELjt6MNE).
// Se dispara SOLO cuando el registro se completó de verdad — nunca al hacer
// click en un link hacia esta página, que solo mide intención, no conversión
// real (mismo criterio que recomienda Google: "carga de página"/evento
// post-completado, no clic previo).
//
// La moneda va fija en CLP porque la acción de conversión `Registro` (id
// 7724783448) está definida en CLP del lado de Google, igual que la cuenta
// 2149932315. Antes se mandaba 'USD' cuando el usuario elegía la modalidad
// internacional: Google convertía ese 1.0 USD a CLP al tipo de cambio del día
// y el valor de conversión quedaba inconsistente entre registros idénticos.
// El valor 1.0 es un proxy de conteo, no el ticket real.
function trackRegistrationConversion(plan: string, email: string) {
    // Enhanced Conversions: se manda el email normalizado (minúsculas, sin
    // espacios) ANTES del evento. La etiqueta de Google lo hashea con SHA-256
    // en el cliente — nunca sale en claro. Requiere además tener activadas las
    // conversiones mejoradas en la UI de Google Ads para esta acción.
    const normalizedEmail = email.trim().toLowerCase()
    if (normalizedEmail) {
        window.gtag?.('set', 'user_data', { email: normalizedEmail })
    }

    window.gtag?.('event', 'conversion', {
        send_to: 'AW-18395838136/CU91CNiuu-McELjt6MNE',
        value: 1.0,
        currency: 'CLP',
        event_category: 'registro',
        event_label: plan,
    })

    // Evento equivalente en GA4. `vetlyGa4Ready` es false mientras no exista la
    // propiedad, así que esto no hace nada hasta que se pegue el Measurement ID.
    if (window.vetlyGa4Ready) {
        window.gtag?.('event', 'sign_up', { method: 'email', plan })
    }

    // Meta — mismo criterio de "medir el evento real, no el clic" que Google.
    // `eventID` queda listo para deduplicar contra la Conversions API server-
    // side cuando se implemente (Meta descarta el duplicado si el navegador y
    // el servidor mandan el mismo evento con el mismo id dentro de la ventana
    // de deduplicación). Hoy solo dispara el pixel del navegador.
    if (normalizedEmail) {
        // Re-inicializar con Advanced Matching: Meta hashea `em` con SHA-256
        // en el cliente antes de mandarlo, nunca en claro. Llamar init() una
        // segunda vez es seguro — solo actualiza los datos de matching, no
        // reinicia el pixel ni duplica el PageView ya disparado al cargar.
        window.fbq?.('init', '4447480202191241', { em: normalizedEmail })
    }
    const fbEventId = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `reg-${Date.now()}-${Math.random().toString(36).slice(2)}`
    window.fbq?.('track', 'CompleteRegistration', {
        value: 1.0,
        currency: 'CLP',
        content_name: plan,
        status: true,
    }, { eventID: fbEventId })
}

const ROLE_TRANSLATIONS: Record<string, string> = {
    'owner': 'Dueño',
    'admin': 'Administrador',
    'professional': 'Profesional',
    'receptionist': 'Recepcionista',
    'vet_assistant': 'Asistente Veterinario'
}

export default function Register() {
    const [searchParams] = useSearchParams()
    const isJoinMode = searchParams.get('mode') === 'join'
    const inviteEmail = searchParams.get('email')
    const joinClinicId = searchParams.get('clinic')
    const firstNameParam = searchParams.get('first_name')
    const inviteRole = searchParams.get('role')
    const refParam = searchParams.get('ref')
    const planParam = searchParams.get('plan')
    const initialPlan = planParam && (PLAN_ORDER as readonly string[]).includes(planParam) ? planParam : 'pro'

    const [step, setStep] = useState(1)
    const [email, setEmail] = useState(inviteEmail || '')
    const [password, setPassword] = useState('')
    const [fullName, setFullName] = useState(firstNameParam || '')
    const [clinicName, setClinicName] = useState('')
    const [selectedPlan, setSelectedPlan] = useState(initialPlan)
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)

    const [jobTitle, setJobTitle] = useState(ROLE_TRANSLATIONS[inviteRole as string] || inviteRole || '')
    const [paymentRegion, setPaymentRegion] = useState<'chile' | 'international'>('chile')
    const [referralCode, setReferralCode] = useState(refParam || '')
    const [turnstileToken, setTurnstileToken] = useState<string>('')
    const turnstileRef = useRef<HTMLDivElement>(null)
    const turnstileWidgetId = useRef<string | null>(null)

    // El ICP principal de Core es el veterinario independiente o a domicilio,
    // que no tiene "clínica" y hoy se ve obligado a inventarse un nombre.
    // `signup-handler` exige clinic_name no vacío, así que se envía el nombre
    // del profesional — editable después en Configuración.
    const [isIndependent, setIsIndependent] = useState(false)

    const { signUp } = useAuth()
    const navigate = useNavigate()

    const isCoreSelected = selectedPlan === 'core'
    const trialDays = isCoreSelected ? 30 : 7

    // Core es autoservicio: quien llega desde /core ya eligió plan y precio, así
    // que pasarlo por 3 pantallas sólo agrega puntos donde abandonar. Se colapsa
    // a un formulario único. El resto de los planes conserva el flujo por pasos
    // porque ahí sí hay una decisión de plan que tomar.
    //
    // Se declara ANTES del useEffect de Turnstile: ese efecto lo usa en su array
    // de dependencias, que se evalúa durante el render.
    const singleStep = isCoreSelected && !isJoinMode

    // Carga el script de Turnstile una sola vez y monta el widget en el
    // paso 3 (justo antes del submit real). Si no hay site key configurada,
    // no hace nada — el registro sigue funcionando igual que antes.
    useEffect(() => {
        // En el flujo de una pantalla el widget vive en el paso 1, que es donde
        // ocurre el submit real. Si esto no acompaña a `singleStep`, el guard de
        // handleSubmit pide un token que nunca se llega a generar.
        if (!TURNSTILE_SITE_KEY || isJoinMode) return
        if (step !== (singleStep ? 1 : 3)) return

        const mount = () => {
            if (!turnstileRef.current || !window.turnstile || turnstileWidgetId.current) return
            turnstileWidgetId.current = window.turnstile.render(turnstileRef.current, {
                sitekey: TURNSTILE_SITE_KEY,
                callback: (token: string) => setTurnstileToken(token),
                'expired-callback': () => setTurnstileToken(''),
            })
        }

        if (window.turnstile) {
            mount()
        } else {
            const script = document.createElement('script')
            script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
            script.async = true
            script.defer = true
            script.onload = mount
            document.head.appendChild(script)
        }

        return () => {
            if (turnstileWidgetId.current && window.turnstile) {
                window.turnstile.remove(turnstileWidgetId.current)
                turnstileWidgetId.current = null
            }
        }
    }, [step, isJoinMode, singleStep])

    // Core no tiene agente IA conversacional — el copy de "tu asistente" que
    // funciona para Starter/Pro/Enterprise le prometería algo que no tiene.
    // Solo se sabe con certeza en step 1 cuando el plan llega preseleccionado
    // por ?plan=core (ej. desde la landing de Core); si el usuario lo elige
    // recién en el paso 3, el banner del paso 1 ya no vuelve a mostrarse.
    const effectiveClinicName = isIndependent ? fullName.trim() : clinicName.trim()

    // Precios reales por región — antes había un array hardcodeado que ignoraba
    // el toggle Chile/Internacional y mostraba precios desactualizados (bug
    // preexistente encontrado en sesión 68, no relacionado a la migración a Paddle).
    //
    // El precio de lanzamiento sale de `launchPrice` en la definición de cada
    // plan, no de una resta acá. Antes era `source.price - 22` (dólares) y
    // estaba condicionado a la región internacional, así que Chile nunca podía
    // verlo por diseño: el chileno veía Core a $33.000 sin rebaja.
    const currencyPrefix = paymentRegion === 'international' ? 'US$' : '$'

    const plans = PLAN_ORDER.map((id) => {
        const source = paymentRegion === 'international' ? PADDLE_PLANS[id] : PLANS[id]
        const launchPrice = 'launchPrice' in source ? source.launchPrice : null
        return {
            id,
            name: source.name,
            price: source.price,
            discountedPrice: launchPrice ?? null,
            popular: 'popular' in source ? source.popular : false,
        }
    })

    const corePlan = plans.find((p) => p.id === 'core')

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        // Flujo de una sola pantalla (Core): se valida todo junto y se crea la
        // cuenta sin pasos intermedios.
        if (singleStep) {
            if (!fullName || !email || !password) {
                setError('Completa todos los campos')
                return
            }
            if (password.length < 6) {
                setError('La contraseña debe tener al menos 6 caracteres')
                return
            }
            if (!effectiveClinicName) {
                setError(isIndependent
                    ? 'Necesitamos tu nombre para identificar tu consulta'
                    : 'Ingresa el nombre de tu clínica')
                return
            }
            if (TURNSTILE_SITE_KEY && !turnstileToken) {
                setError('Completa la verificación de seguridad antes de continuar.')
                return
            }
            setError('')
            handleCreate()
            return
        }

        if (step === 1) {
            // Validate step 1
            if (!fullName || !email || !password) {
                setError('Completa todos los campos')
                return
            }
            if (isJoinMode && !jobTitle) {
                setError('Por favor indica tu cargo en la clínica (ej: Administrador, Asistente)')
                return
            }

            if (password.length < 6) {
                setError('La contraseña debe tener al menos 6 caracteres')
                return
            }

            // Check if invite exists if in join mode
            if (isJoinMode) {
                if (!email) {
                    setError('Por favor ingresa tu correo electrónico.')
                    return
                }
                setLoading(true)
                // Use new RPC that returns clinic details, first_name and role
                const { data, error: rpcError } = await (supabase as any).rpc('check_pending_invite_details', {
                    p_email: email,
                    p_clinic_id: joinClinicId || null
                })
                setLoading(false)

                if (rpcError) {
                    console.error('RPC Error:', rpcError)
                    setError('Ocurrió un error al verificar tu invitación. Intenta nuevamente.')
                    return
                }

                // The RPC returns { valid, clinic_name, first_name, role }
                const result: any = data && data.length > 0 ? data[0] : null;

                if (!result || !result.valid) {
                    setError('No encontramos una invitación pendiente para este correo.')
                    return
                }

                // Pre-fill from database if present (prioritize over URL params if they mismatch or are empty)
                if (result.first_name && !fullName) {
                    setFullName(result.first_name)
                }
                if (result.role && !jobTitle) {
                    setJobTitle(ROLE_TRANSLATIONS[result.role] || result.role)
                }

                // Confirm join with clinic name
                if (confirm(`Te estás uniendo a  "${result.clinic_name}". ¿Es correcto?`)) {
                    handleJoin()
                }
                return
            }

            setError('')
            setStep(2)
            return
        }

        if (step === 2) {
            // Validate step 2
            if (!clinicName) {
                setError('Ingresa el nombre de tu clínica')
                return
            }
            setError('')
            setStep(3)
            return
        }

        if (step === 3) {
            if (TURNSTILE_SITE_KEY && !turnstileToken) {
                setError('Completa la verificación de seguridad antes de continuar.')
                return
            }
            // Create account directly without card
            handleCreate()
            return
        }

        // Step 4 - Create account
        handleCreate()
    }

    const handleJoin = async () => {
        setError('')
        setLoading(true)

        try {
            // 1. Call specialized Edge Function to create/link user without email confirmation friction
            const { data: functionData, error: functionError } = await supabase.functions.invoke('join-handler', {
                body: { 
                    email, 
                    password, 
                    fullName, 
                    jobTitle, 
                    clinicId: joinClinicId 
                }
            })

            if (functionError || functionData?.error) {
                console.error('Join Error:', functionError || functionData?.error)
                setError(functionData?.error || 'No se pudo completar el registro. Intente nuevamente.')
                setLoading(false)
                return
            }

            // 2. Log in directly after successful creation (since it's auto-confirmed)
            const { error: signInError } = await supabase.auth.signInWithPassword({
                email,
                password,
            })

            if (signInError) {
                console.error('Sign In Error after Join:', signInError)
                toast.error('Registro exitoso, pero ocurrió un error al iniciar sesión. Por favor intente ingresar normalmente.')
                navigate('/login')
            } else {
                navigate('/app/dashboard?welcome=joined')
            }

        } catch (err: any) {
            console.error('Unexpected error during join:', err)
            setError('Ocurrió un error inesperado. Por favor intente más tarde.')
        } finally {
            setLoading(false)
        }
    }

    const handleCreate = async (cardToken?: string) => {
        setError('')
        setLoading(true)

        // Atribución capturada en la landing (gclid/wbraid/UTMs). Viaja al
        // backend junto al registro para poder cruzar después el clic pagado con
        // el cliente que efectivamente pagó (importación de conversiones
        // offline). Si no hay nada guardado va undefined y el backend lo ignora.
        const attribution = getAttribution()

        const { error }: any = await (signUp as any)(email, password, fullName, effectiveClinicName || clinicName, selectedPlan, cardToken, paymentRegion === 'international' ? 'paddle' : 'mercadopago', referralCode.trim() || undefined, turnstileToken || undefined, hasPaidAttribution(attribution) ? attribution : undefined)

        if (error) {
            setError(error.message || 'Error al crear la cuenta. Intenta con otro email.')
            setLoading(false)
            console.error('Registration Error:', error)
            return
        }

        // Cuenta creada de verdad — recién acá cuenta como conversión real.
        trackRegistrationConversion(selectedPlan, email)

        // Enviar correo de bienvenida
        try {
            await supabase.functions.invoke('send-welcome-email', {
                body: { email, name: fullName }
            });
        } catch (e) {
            console.error('Error enviando email de bienvenida:', e);
        }

        // Note: Payment redirects disabled for card-free onboarding

        // Core entra directo al dashboard (signup-handler ya lo activa con
        // activation_status='active') — el resto pasa por /pending-activation
        // para agendar la sesión de implementación.
        navigate(isCoreSelected ? '/app' : '/pending-activation')
    }

    return (
        <div className="min-h-screen bg-subtle-gradient flex">
            {/* Left Panel - Form */}
            <div className={`flex-1 flex items-center justify-center p-8 ${isJoinMode ? 'w-full' : ''}`}>
                <div className="w-full max-w-md">
                    {/* Logo */}
                    <div className="flex items-center gap-3 mb-8">
                        <div className="w-12 h-12 bg-hero-gradient rounded-soft flex items-center justify-center">
                            <Sparkles className="w-6 h-6 text-white" />
                        </div>
                        <span className="text-2xl font-semibold text-charcoal">Vetly</span>
                    </div>

                    {/* Progress Indicator — oculto en join y en el flujo de una pantalla */}
                    {!isJoinMode && !singleStep && (
                        <div className="flex items-center gap-2 mb-8">
                            {[1, 2, 3].map((s) => (
                                <div key={s} className="flex items-center">
                                    <div
                                        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${s < step
                                            ? 'bg-primary-500 text-white'
                                            : s === step
                                                ? 'bg-primary-500 text-white'
                                                : 'bg-silk-beige text-charcoal/40'
                                            }`}
                                    >
                                        {s < step ? <Check className="w-4 h-4" /> : s}
                                    </div>
                                    {s < 3 && (
                                        <div className={`w-12 h-0.5 mx-1 ${s < step ? 'bg-primary-500' : 'bg-silk-beige'}`} />
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Header — el título de venta ("Reserva tu Implementación
                        Estratégica") promete una reunión, que es lo contrario a
                        lo que compra alguien que llega desde /core buscando
                        autoservicio. Se vuelve plan-aware. */}
                    <h1 className="text-h2 text-charcoal mb-2">
                        {isJoinMode ? 'Únete a tu equipo' : (
                            singleStep ? 'Crea tu cuenta gratis' : (
                                step === 1 ? 'Reserva tu Implementación Estratégica' :
                                    step === 2 ? 'Sobre tu clínica' :
                                        'Elige tu plan'
                            )
                        )}
                    </h1>
                    <p className="text-charcoal/60 mb-6">
                        {isJoinMode ? 'Ingresa tus datos para aceptar la invitación' : (
                            singleStep ? 'Sin tarjeta de crédito. Empiezas a usar Vetly en 2 minutos.' : (
                                step === 1 ? 'Crea tu cuenta para agendar tu sesión de implementación estratégica gratuita.' :
                                    step === 2 ? 'Configura los datos básicos de tu negocio' :
                                        'Selecciona el plan que mejor se adapte a ti'
                            )
                        )}
                    </p>

                    {/* Los 30 días son la única ventaja que ningún competidor
                        iguala rápido (Veti 15, Sami 14, Wirevet 7, VetLink 0).
                        Antes vivían en gris de 12px dentro de un recuadro
                        secundario; acá son el segundo elemento más grande. */}
                    {singleStep && (
                        <div className="rounded-soft border-2 border-primary-500 bg-primary-50 p-5 mb-6">
                            <div className="flex items-center gap-4">
                                <div className="text-center leading-none shrink-0">
                                    <div className="text-5xl font-black text-primary-600 tracking-tight">30</div>
                                    <div className="text-[11px] font-bold uppercase tracking-widest text-primary-700 mt-1">días</div>
                                </div>
                                <div className="w-px self-stretch bg-primary-200" />
                                <div>
                                    <p className="font-bold text-charcoal leading-snug">
                                        Gratis, con todo el sistema desbloqueado
                                    </p>
                                    <p className="text-sm text-charcoal/70 mt-1 leading-relaxed">
                                        Citas, fichas médicas, finanzas, inventario y fidelización.
                                        Sin tarjeta de crédito y sin cobro automático al terminar.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Value Prop Banner — en el flujo único lo reemplaza el
                        bloque grande de 30 días de arriba; mostrar ambos repite
                        el mismo mensaje dos veces seguidas. */}
                    {!isJoinMode && step === 1 && !singleStep && (
                        <div className="bg-primary-50 border border-primary-100 rounded-soft p-4 mb-6">
                            <div className="flex items-start gap-3">
                                <div className="mt-0.5 bg-primary-500 p-1 rounded flex-shrink-0">
                                    <Star className="w-3.5 h-3.5 text-white" />
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-charcoal leading-snug">
                                        {isCoreSelected ? 'Empieza en 2 minutos' : 'La Regla de Éxito Vetly'}
                                    </p>
                                    <p className="text-xs text-charcoal/65 mt-1 leading-relaxed">
                                        {isCoreSelected
                                            ? 'Sin tarjeta de crédito. 30 días para probar todo el sistema: citas, fichas, finanzas, inventario y fidelización.'
                                            : 'Tus 7 días de prueba solo comienzan cuando el asistente ya entiende y atiende perfectamente a tu clínica.'}
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Region Selector (Only in creation mode) */}
                    {!isJoinMode && step === 3 && (
                        <div className="mb-6 flex p-1 bg-silk-beige rounded-soft">
                            <button
                                type="button"
                                onClick={() => setPaymentRegion('chile')}
                                className={`flex-1 py-2 text-sm font-medium rounded-soft transition-all ${paymentRegion === 'chile' ? 'bg-white shadow-sm text-charcoal' : 'text-charcoal/40'}`}
                            >
                                Chile (CLP)
                            </button>
                            <button
                                type="button"
                                onClick={() => setPaymentRegion('international')}
                                className={`flex-1 py-2 text-sm font-medium rounded-soft transition-all ${paymentRegion === 'international' ? 'bg-white shadow-sm text-charcoal' : 'text-charcoal/40'}`}
                            >
                                Internacional (USD)
                            </button>
                        </div>
                    )}

                    {/* Error Message */}
                    {error && (
                        <div className="bg-red-50 border border-red-200 text-red-600 rounded-soft p-4 mb-6">
                            {error}
                        </div>
                    )}

                    {/* Form */}
                    <form onSubmit={handleSubmit} className="space-y-5">
                        {/* Step 1: Personal Info */}
                        {(step === 1 || singleStep) && (
                            <>
                                <div>
                                    <label htmlFor="fullName" className="block text-sm font-medium text-charcoal mb-2">
                                        Nombre completo
                                    </label>
                                    <div className="relative">
                                        <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-charcoal/40" />
                                        <input
                                            id="fullName"
                                            type="text"
                                            value={fullName}
                                            onChange={(e) => setFullName(e.target.value)}
                                            className={`input-soft pl-12 w-full ${(isJoinMode && fullName) ? 'bg-stone-100 cursor-not-allowed opacity-80' : ''}`}
                                            placeholder="María García"
                                            required
                                            readOnly={isJoinMode && !!fullName}
                                        />
                                    </div>
                                </div>

                                {isJoinMode && (
                                    <div>
                                        <label htmlFor="jobTitle" className="block text-sm font-medium text-charcoal mb-2">
                                            Cargo / Rol
                                        </label>
                                        <div className="relative">
                                            <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-charcoal/40" />
                                            <input
                                                id="jobTitle"
                                                type="text"
                                                value={jobTitle}
                                                onChange={(e) => setJobTitle(e.target.value)}
                                                className={`input-soft pl-12 w-full ${(isJoinMode && jobTitle) ? 'bg-stone-100 cursor-not-allowed opacity-80' : ''}`}
                                                placeholder="Ej: Administrador"
                                                required
                                                readOnly={isJoinMode && !!jobTitle}
                                            />
                                        </div>
                                    </div>
                                )}

                                <div>
                                    <label htmlFor="email" className="block text-sm font-medium text-charcoal mb-2">
                                        Correo electrónico
                                    </label>
                                    <div className="relative">
                                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-charcoal/40" />
                                        <input
                                            id="email"
                                            type="email"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            className={`input-soft pl-12 w-full ${(isJoinMode && email) ? 'bg-stone-100 cursor-not-allowed opacity-80' : ''}`}
                                            placeholder="maria@clinica.com"
                                            required
                                            readOnly={isJoinMode && !!email}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label htmlFor="password" className="block text-sm font-medium text-charcoal mb-2">
                                        Contraseña
                                    </label>
                                    <div className="relative">
                                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-charcoal/40" />
                                        <input
                                            id="password"
                                            type="password"
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            className="input-soft pl-12 w-full"
                                            placeholder="Mínimo 6 caracteres"
                                            required
                                        />
                                    </div>
                                </div>

                                {singleStep && (
                                    <div>
                                        <label htmlFor="clinicName" className="block text-sm font-medium text-charcoal mb-2">
                                            Nombre de tu clínica
                                        </label>
                                        {!isIndependent && (
                                            <div className="relative">
                                                <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-charcoal/40" />
                                                <input
                                                    id="clinicName"
                                                    type="text"
                                                    value={clinicName}
                                                    onChange={(e) => setClinicName(e.target.value)}
                                                    className="input-soft pl-12 w-full"
                                                    placeholder="Clínica Veterinaria Los Robles"
                                                    required={!isIndependent}
                                                />
                                            </div>
                                        )}

                                        <label className="mt-3 flex items-start gap-3 cursor-pointer select-none">
                                            <input
                                                type="checkbox"
                                                checked={isIndependent}
                                                onChange={(e) => setIsIndependent(e.target.checked)}
                                                className="mt-0.5 w-4 h-4 accent-primary-500 shrink-0"
                                            />
                                            <span className="text-sm text-charcoal/80 leading-snug">
                                                Trabajo como profesional independiente
                                                <span className="block text-xs text-charcoal/50 mt-0.5">
                                                    {isIndependent
                                                        ? `Usaremos tu nombre${fullName.trim() ? ` (${fullName.trim()})` : ''} para identificar tu consulta. Puedes cambiarlo después en Configuración.`
                                                        : 'Márcala si atiendes a domicilio o por tu cuenta, sin un local con nombre propio.'}
                                                </span>
                                            </span>
                                        </label>
                                    </div>
                                )}

                                {!isJoinMode && (
                                    refParam ? (
                                        <div className="flex items-center gap-2 bg-primary-50 border border-primary-100 rounded-soft px-4 py-3 text-sm text-primary-700">
                                            <Star className="w-4 h-4 shrink-0" />
                                            <span>Referido por el código <strong>{refParam.toUpperCase()}</strong> ✓</span>
                                        </div>
                                    ) : (
                                        <div>
                                            <label htmlFor="referralCode" className="block text-sm font-medium text-charcoal mb-2">
                                                Código de referido (opcional)
                                            </label>
                                            <input
                                                id="referralCode"
                                                type="text"
                                                value={referralCode}
                                                onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                                                className="input-soft w-full"
                                                placeholder="Ej: AB12CD"
                                                maxLength={6}
                                            />
                                        </div>
                                    )
                                )}
                            </>
                        )}

                        {/* Step 2: Clinic Info */}
                        {step === 2 && !singleStep && (
                            <div>
                                <label htmlFor="clinicName" className="block text-sm font-medium text-charcoal mb-2">
                                    Nombre de tu clínica
                                </label>
                                <div className="relative">
                                    <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-charcoal/40" />
                                    <input
                                        id="clinicName"
                                        type="text"
                                        value={clinicName}
                                        onChange={(e) => setClinicName(e.target.value)}
                                        className="input-soft pl-12 w-full"
                                        placeholder="Clínica Veterinaria AnimalGrace"
                                        required
                                    />
                                </div>
                                <p className="text-sm text-charcoal/50 mt-2">
                                    Este nombre aparecerá en los mensajes de WhatsApp
                                </p>
                            </div>
                        )}

                        {/* Step 3: Plan Selection */}
                        {step === 3 && !singleStep && (
                            <div className="space-y-3">
                                {plans.map((plan) => (
                                    <label
                                        key={plan.id}
                                        className={`block p-4 rounded-soft border-2 cursor-pointer transition-all ${selectedPlan === plan.id
                                            ? 'border-primary-500 bg-primary-50'
                                            : 'border-silk-beige hover:border-primary-200'
                                            }`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <input
                                                    type="radio"
                                                    name="plan"
                                                    value={plan.id}
                                                    checked={selectedPlan === plan.id}
                                                    onChange={(e) => setSelectedPlan(e.target.value)}
                                                    className="sr-only"
                                                />
                                                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${selectedPlan === plan.id
                                                    ? 'border-primary-500 bg-primary-500'
                                                    : 'border-charcoal/30'
                                                    }`}>
                                                    {selectedPlan === plan.id && (
                                                        <Check className="w-3 h-3 text-white" />
                                                    )}
                                                </div>
                                                <div>
                                                    <span className="font-medium text-charcoal">{plan.name}</span>
                                                    {plan.popular && (
                                                        <span className="ml-2 text-xs bg-accent-500 text-charcoal px-2 py-0.5 rounded-full">
                                                            Popular
                                                        </span>
                                                    )}
                                                    {plan.discountedPrice !== null && (
                                                        <span className="ml-2 text-xs bg-primary-500 text-white px-2 py-0.5 rounded-full">
                                                            Lanzamiento
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <span className="font-semibold text-charcoal">
                                                {plan.discountedPrice !== null ? (
                                                    <>
                                                        <span className="text-sm text-charcoal/40 line-through mr-1">{currencyPrefix}{plan.price.toLocaleString('es-CL')}</span>
                                                        {currencyPrefix}{plan.discountedPrice.toLocaleString('es-CL')}<span className="text-sm text-charcoal/50">/mes</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        {currencyPrefix}{plan.price.toLocaleString('es-CL')}<span className="text-sm text-charcoal/50">/mes</span>
                                                    </>
                                                )}
                                            </span>
                                        </div>
                                    </label>
                                ))}
                                {TURNSTILE_SITE_KEY && (
                                    <div ref={turnstileRef} className="flex justify-center mt-4" />
                                )}
                                <p className="text-sm text-charcoal/50 text-center mt-4">
                                    Prueba gratis por {trialDays} días. Cancela cuando quieras.
                                </p>
                            </div>
                        )}

                        {/* Confirmación de plan + verificación, sólo en el flujo único.
                            No es un selector: quien llega desde /core ya eligió.
                            El toggle de región se mantiene porque define la
                            pasarela (MercadoPago vs Paddle) que recibe signUp. */}
                        {singleStep && (
                            <div className="space-y-4">
                                <div className="rounded-soft border border-silk-beige bg-white p-4">
                                    <div className="flex items-center justify-between gap-4">
                                        <div>
                                            <p className="text-xs font-bold uppercase tracking-widest text-primary-600">Plan Core</p>
                                            <p className="text-sm text-charcoal/60 mt-0.5">Después de los 30 días. Cancela cuando quieras.</p>
                                        </div>
                                        <div className="text-right shrink-0">
                                            {corePlan?.discountedPrice != null ? (
                                                <>
                                                    <span className="text-sm text-charcoal/40 line-through mr-1">
                                                        {currencyPrefix}{corePlan.price.toLocaleString('es-CL')}
                                                    </span>
                                                    <span className="font-bold text-charcoal">
                                                        {currencyPrefix}{corePlan.discountedPrice.toLocaleString('es-CL')}
                                                    </span>
                                                </>
                                            ) : (
                                                <span className="font-bold text-charcoal">
                                                    {currencyPrefix}{corePlan?.price.toLocaleString('es-CL')}
                                                </span>
                                            )}
                                            <span className="text-sm text-charcoal/50">/mes</span>
                                        </div>
                                    </div>

                                    <div className="mt-3 flex p-1 bg-silk-beige rounded-soft">
                                        <button
                                            type="button"
                                            onClick={() => setPaymentRegion('chile')}
                                            className={`flex-1 py-1.5 text-xs font-medium rounded-soft transition-all ${paymentRegion === 'chile' ? 'bg-white shadow-sm text-charcoal' : 'text-charcoal/40'}`}
                                        >
                                            Chile (CLP)
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setPaymentRegion('international')}
                                            className={`flex-1 py-1.5 text-xs font-medium rounded-soft transition-all ${paymentRegion === 'international' ? 'bg-white shadow-sm text-charcoal' : 'text-charcoal/40'}`}
                                        >
                                            Internacional (USD)
                                        </button>
                                    </div>
                                </div>

                                {TURNSTILE_SITE_KEY && (
                                    <div ref={turnstileRef} className="flex justify-center" />
                                )}
                            </div>
                        )}

                        {/* Step 4: Removed - Payment Info is no longer required at registration */}

                        <div className="mt-6 flex flex-col items-center gap-2">
                            <p className="text-sm text-charcoal/60">¿Tienes dudas con el registro?</p>
                            <a
                                href="https://wa.me/56993089185?text=Hola,%20tengo%20una%20duda%20con%20el%20registro%20en%20Vetly"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 text-primary-600 hover:text-primary-700 font-bold bg-primary-50 px-4 py-2 rounded-full border border-primary-100 transition-colors"
                            >
                                <MessageCircle className="w-4 h-4" />
                                Escríbenos por WhatsApp (+56 9 9308 9185)
                            </a>
                        </div>

                        {/* Navigation Buttons */}
                        <div className="flex gap-3 mt-8">
                            {step > 1 && !singleStep && (
                                <button
                                    type="button"
                                    onClick={() => setStep(step - 1)}
                                    className="btn-ghost flex-1 py-3"
                                    disabled={loading}
                                >
                                    Atrás
                                </button>
                            )}
                            {step <= 3 && (
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="btn-primary flex-1 py-3 flex items-center justify-center gap-2"
                                >
                                    {loading ? (
                                        <>
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                            Cargando...
                                        </>
                                    ) : singleStep ? (
                                        <>
                                            Empezar mis 30 días gratis
                                            <ArrowRight className="w-5 h-5" />
                                        </>
                                    ) : step < 3 || (isJoinMode && step < 1) ? (
                                        <>
                                            Continuar
                                            <ArrowRight className="w-5 h-5" />
                                        </>
                                    ) : (
                                        <>
                                            {isJoinMode ? 'Unirme al Equipo' : 'Comenzar Prueba Gratis'}
                                            <ArrowRight className="w-5 h-5" />
                                        </>
                                    )}
                                </button>
                            )}
                        </div>
                    </form>

                    <p className="mt-6 text-xs text-center text-charcoal/50">
                        Al registrarte en Vetly, aceptas nuestros{' '}
                        <Link to="/terms" target="_blank" className="underline hover:text-primary-600">Términos y Condiciones</Link>
                        {' '}y nuestra{' '}
                        <Link to="/privacy" target="_blank" className="underline hover:text-primary-600">Política de Privacidad</Link>.
                    </p>

                    {/* Login Link */}
                    <p className="mt-8 text-center text-charcoal/60">
                        ¿Ya tienes cuenta?{' '}
                        <Link to="/login" className="text-primary-600 font-medium hover:text-primary-700">
                            Inicia sesión
                        </Link>
                    </p>
                </div>
            </div>

            {/* Right Panel - Hero (Hidden in Join Mode) */}
            {!isJoinMode && (
                <div className="hidden lg:flex flex-1 bg-hero-gradient items-center justify-center p-12">
                    <div className="max-w-lg text-white">
                        {/* Main Value Proposition */}
                        <div className="mb-10">
                            <div className="inline-flex items-center gap-2 bg-white/15 rounded-full px-4 py-1.5 text-sm font-medium text-white/90 mb-6">
                                <Star className="w-3.5 h-3.5 text-yellow-300" />
                                {isCoreSelected ? 'Gestión completa para tu clínica' : 'Tu clínica con Infraestructura Operativa de Éxito'}
                            </div>
                            <h2 className="text-4xl font-bold mb-5 leading-tight" style={{ background: 'linear-gradient(135deg, #FFD700, #F5C842, #E8B830, #FFE066)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                                {isCoreSelected
                                    ? 'Citas, fichas médicas, finanzas e inventario en un solo lugar — sin planillas ni cuadernos.'
                                    : 'Implementamos hasta que tu asistente atienda pacientes al 100%, como lo haría tu recepcionista.'}
                            </h2>
                            <p className="text-white/75 text-lg leading-relaxed">
                                {isCoreSelected
                                    ? 'Deja de perseguir información en distintas planillas. Todo tu negocio ordenado, con recordatorios de WhatsApp listos para enviar en un clic.'
                                    : 'No te dejamos solo con una herramienta. Trabajamos contigo hasta que cada consulta, cada cita y cada respuesta funcione perfectamente.'}
                            </p>
                        </div>

                        {/* The Rule Card */}
                        <div className="bg-white/15 backdrop-blur-sm border border-white/20 rounded-softer p-5 mb-6">
                            <div className="flex items-start gap-3">
                                <div className="bg-yellow-400 text-charcoal rounded p-1 flex-shrink-0 mt-0.5">
                                    <ShieldCheck className="w-4 h-4" />
                                </div>
                                <div>
                                    <p className="font-bold text-white text-base mb-1">
                                        {isCoreSelected ? 'Sin tarjeta, sin compromiso' : 'La Regla de Éxito Vetly'}
                                    </p>
                                    <p className="text-white/80 text-sm leading-relaxed">
                                        {isCoreSelected
                                            ? '30 días para probar el sistema completo. Si no es para ti, cancelas en un clic desde Configuración.'
                                            : 'Tus 7 días de prueba solo comienzan cuando el asistente ya entiende y atiende perfectamente a tu clínica.'}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Por qué existe Vetly — historia real del fundador.
                            Reemplaza a un testimonio que atribuía una persona
                            inventada a una clínica real. */}
                        <div className="bg-white/10 backdrop-blur-sm rounded-softer p-5">
                            <div className="flex items-center gap-3 mb-3">
                                <img
                                    src="/fundador.webp"
                                    alt="Sebastián Barrera, fundador de Vetly"
                                    loading="lazy"
                                    className="w-11 h-11 rounded-full object-cover border-2 border-white/30 flex-shrink-0"
                                />
                                <div>
                                    <p className="font-medium text-sm">Sebastián Barrera</p>
                                    <p className="text-xs text-white/60">Fundador · ex-dueño de clínica móvil</p>
                                </div>
                            </div>
                            <p className="text-white/85 text-sm leading-relaxed">
                                "Antes de Vetly tuve Movilvets, una clínica veterinaria a domicilio.
                                Construí esto porque necesitaba la herramienta y no existía."
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
