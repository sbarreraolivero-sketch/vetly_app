import { useState } from 'react'
import { toast } from 'react-hot-toast'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Sparkles, Mail, Lock, User, Building2, ArrowRight, Loader2, Check, ShieldCheck, MessageCircle, Star } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { initMercadoPago, CardPayment } from '@mercadopago/sdk-react'

// Initialize MercadoPago outside the component
const MP_PUBLIC_KEY = import.meta.env.VITE_MERCADOPAGO_PUBLIC_KEY || 'APP_USR-61b727c4-a571-46c2-833a-89e68836e5db'
initMercadoPago(MP_PUBLIC_KEY, { locale: 'es-CL' })

const plans = [
    { id: 'essence', name: 'Essence', price: 99, popular: false },
    { id: 'radiance', name: 'Radiance', price: 159, popular: true },
    { id: 'prestige', name: 'Prestige', price: 349, popular: false },
]

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

    const [step, setStep] = useState(1)
    const [email, setEmail] = useState(inviteEmail || '')
    const [password, setPassword] = useState('')
    const [fullName, setFullName] = useState(firstNameParam || '')
    const [clinicName, setClinicName] = useState('')
    const [selectedPlan, setSelectedPlan] = useState('radiance')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)

    const [jobTitle, setJobTitle] = useState(ROLE_TRANSLATIONS[inviteRole as string] || inviteRole || '')
    const [paymentRegion, setPaymentRegion] = useState<'chile' | 'international'>('chile')

    const { signUp } = useAuth()
    const navigate = useNavigate()

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

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
            // Move to payment step
            setStep(4)
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

        // IMPORT lemonsqueezy redirect
        const { redirectToLemonCheckout } = await import('@/lib/lemonsqueezy')

        const { error, data }: any = await (signUp as any)(email, password, fullName, clinicName, selectedPlan, cardToken, paymentRegion === 'international' ? 'lemonsqueezy' : 'mercadopago')

        if (error) {
            setError(error.message || 'Error al crear la cuenta. Intenta con otro email o revisa tu tarjeta.')
            setLoading(false)
            console.error('Registration Error:', error)
            return
        }

        // Enviar correo de bienvenida
        try {
            await supabase.functions.invoke('send-welcome-email', {
                body: { email, name: fullName }
            });
        } catch (e) {
            console.error('Error enviando email de bienvenida:', e);
        }

        // If LemonSqueezy, redirect to checkout
        if (paymentRegion === 'international') {
            try {
                const clinicId = data?.clinic_id
                if (clinicId) {
                    await redirectToLemonCheckout(clinicId, email, selectedPlan as any)
                    return // Redirecting...
                }
            } catch (err: any) {
                setError('Error al conectar con la pasarela de pago: ' + err.message)
                setLoading(false)
                return
            }
        }

        // Success - redirect to pending activation for scheduling
        navigate('/pending-activation')
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
                        <span className="text-2xl font-semibold text-charcoal">Vetly AI</span>
                    </div>

                    {/* Progress Indicator (Hidden in Join Mode) */}
                    {!isJoinMode && (
                        <div className="flex items-center gap-2 mb-8">
                            {[1, 2, 3, 4].map((s) => (
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
                                    {s < 4 && (
                                        <div className={`w-12 h-0.5 mx-1 ${s < step ? 'bg-primary-500' : 'bg-silk-beige'}`} />
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Header */}
                    <h1 className="text-h2 text-charcoal mb-2">
                        {isJoinMode ? 'Únete a tu equipo' : (
                            step === 1 ? 'Reserva tu Implementación Estratégica' :
                                step === 2 ? 'Sobre tu clínica' :
                                    'Elige tu plan'
                        )}
                    </h1>
                    <p className="text-charcoal/60 mb-6">
                        {isJoinMode ? 'Ingresa tus datos para aceptar la invitación' : (
                            step === 1 ? 'Crea tu cuenta para agendar tu sesión de implementación estratégica gratuita.' :
                                step === 2 ? 'Configura los datos básicos de tu negocio' :
                                    step === 3 ? 'Selecciona el plan que mejor se adapte a ti' :
                                        'Finaliza tu registro'
                        )}
                    </p>

                    {/* Value Prop Banner - Step 1 only */}
                    {!isJoinMode && step === 1 && (
                        <div className="bg-primary-50 border border-primary-100 rounded-soft p-4 mb-6">
                            <div className="flex items-start gap-3">
                                <div className="mt-0.5 bg-primary-500 p-1 rounded flex-shrink-0">
                                    <Star className="w-3.5 h-3.5 text-white" />
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-charcoal leading-snug">
                                        La Regla de Éxito Citenly
                                    </p>
                                    <p className="text-xs text-charcoal/65 mt-1 leading-relaxed">
                                        Tus 7 días de prueba solo comienzan cuando el asistente ya entiende y atiende perfectamente a tu clínica.
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
                        {step === 1 && (
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
                            </>
                        )}

                        {/* Step 2: Clinic Info */}
                        {step === 2 && (
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
                        {step === 3 && (
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
                                                </div>
                                            </div>
                                            <span className="font-semibold text-charcoal">
                                                ${plan.price}<span className="text-sm text-charcoal/50">/mes</span>
                                            </span>
                                        </div>
                                    </label>
                                ))}
                                <p className="text-sm text-charcoal/50 text-center mt-4">
                                    Prueba gratis por 7 días. Cancela cuando quieras.
                                </p>
                            </div>
                        )}

                        {/* Step 4: Payment Info */}
                        {step === 4 && !isJoinMode && (
                            <div className="space-y-4">
                                <div className="bg-primary-50 rounded-soft p-4 mb-6">
                                    <div className="flex items-start gap-3">
                                        <div className="mt-1 bg-white p-1 rounded">
                                            <ShieldCheck className="w-4 h-4 text-primary-600" />
                                        </div>
                                        <div>
                                            <p className="font-semibold text-charcoal text-sm">Prueba de 7 días sin costo</p>
                                            <p className="text-xs text-charcoal/70 mt-1">
                                                No se realizará ningún cargo hoy. Tu tarjeta es solo para garantizar tu sesión de activación estratégica. Cancela cuando quieras antes de los 7 días.
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {paymentRegion === 'chile' ? (
                                    <div className="border border-gray-200 rounded-soft p-4 bg-white min-h-[400px]">
                                        <CardPayment
                                            initialization={{
                                                amount: plans.find(p => p.id === selectedPlan)?.price || 159
                                            }}
                                            customization={{
                                                visual: {
                                                    style: {
                                                        theme: 'default'
                                                    },
                                                    texts: {
                                                        formSubmit: 'Comenzar Prueba Gratis'
                                                    }
                                                },
                                                paymentMethods: {
                                                    maxInstallments: 1
                                                }
                                            }}
                                            onSubmit={async (formData) => {
                                                await handleCreate(formData.token);
                                            }}
                                            onError={(error) => {
                                                console.error("Mercado Pago Error:", error);
                                                setError('Error al procesar la tarjeta. Revisa los datos ingresados.');
                                            }}
                                        />
                                    </div>
                                ) : (
                                    <div className="text-center p-8 border border-silk-beige rounded-soft bg-white shadow-soft">
                                        <div className="w-16 h-16 bg-primary-50 rounded-full flex items-center justify-center mx-auto mb-4">
                                            <Sparkles className="w-8 h-8 text-primary-500" />
                                        </div>
                                        <h3 className="text-lg font-semibold text-charcoal mb-2">Pago Internacional (USD)</h3>
                                        <p className="text-sm text-charcoal/60 mb-6">
                                            Serás redirigido a nuestra pasarela segura Lemon Squeezy para finalizar tu registro. 
                                            Tu prueba gratuita de 7 días comenzará de inmediato.
                                        </p>
                                        <button
                                            type="button"
                                            onClick={() => handleCreate()}
                                            disabled={loading}
                                            className="btn-primary w-full py-4 flex items-center justify-center gap-2"
                                        >
                                            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Confirmar y Pagar'}
                                            <ArrowRight className="w-5 h-5" />
                                        </button>
                                    </div>
                                )}

                                <div className="mt-6 flex flex-col items-center gap-2">
                                    <p className="text-sm text-charcoal/60">¿Tienes dudas con el registro o el pago?</p>
                                    <a
                                        href="https://wa.me/56996600259?text=Hola,%20tengo%20una%20duda%20con%20el%20registro%20en%20Vetly AI"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-2 text-primary-600 hover:text-primary-700 font-bold bg-primary-50 px-4 py-2 rounded-full border border-primary-100 transition-colors"
                                    >
                                        <MessageCircle className="w-4 h-4" />
                                        Escríbenos por WhatsApp (+56 9 9660 0259)
                                    </a>
                                </div>
                            </div>
                        )}

                        {/* Navigation Buttons */}
                        <div className="flex gap-3 mt-8">
                            {step > 1 && (
                                <button
                                    type="button"
                                    onClick={() => setStep(step - 1)}
                                    className="btn-ghost flex-1 py-3"
                                    disabled={loading}
                                >
                                    Atrás
                                </button>
                            )}
                            {step !== 4 && (
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
                                    ) : step < 3 || (isJoinMode && step < 1) ? (
                                        <>
                                            Continuar
                                            <ArrowRight className="w-5 h-5" />
                                        </>
                                    ) : step === 3 && !isJoinMode ? (
                                        <>
                                            Agregar Método de Pago
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
                        Al registrarte en Vetly AI, aceptas nuestros{' '}
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
                                Tu clínica con Infraestructura Operativa de Éxito
                            </div>
                            <h2 className="text-4xl font-bold mb-5 leading-tight" style={{ background: 'linear-gradient(135deg, #FFD700, #F5C842, #E8B830, #FFE066)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                                Implementamos hasta que tu asistente atienda pacientes al 100%, como lo haría tu recepcionista.
                            </h2>
                            <p className="text-white/75 text-lg leading-relaxed">
                                No te dejamos solo con una herramienta. Trabajamos contigo hasta que cada consulta, cada cita y cada respuesta funcione perfectamente.
                            </p>
                        </div>

                        {/* The Rule Card */}
                        <div className="bg-white/15 backdrop-blur-sm border border-white/20 rounded-softer p-5 mb-6">
                            <div className="flex items-start gap-3">
                                <div className="bg-yellow-400 text-charcoal rounded p-1 flex-shrink-0 mt-0.5">
                                    <ShieldCheck className="w-4 h-4" />
                                </div>
                                <div>
                                    <p className="font-bold text-white text-base mb-1">La Regla de Éxito Citenly</p>
                                    <p className="text-white/80 text-sm leading-relaxed">
                                        Tus 7 días de prueba solo comienzan cuando el asistente ya entiende y atiende perfectamente a tu clínica.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Testimonial */}
                        <div className="bg-white/10 backdrop-blur-sm rounded-softer p-5">
                            <p className="text-white/90 italic text-sm mb-4">
                                "Antes pasaba 3 horas diarias respondiendo mensajes.
                                Ahora mi asistente de Citenly lo hace todo mientras
                                yo me enfoco en mis pacientes."
                            </p>
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 bg-white/20 rounded-full flex-shrink-0" />
                                <div>
                                    <p className="font-medium text-sm">Dra. Carolina Méndez</p>
                                    <p className="text-xs text-white/60">Clínica Veterinaria AnimalGrace</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
