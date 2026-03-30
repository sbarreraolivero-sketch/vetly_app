import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, Mail, ArrowLeft, Loader2, CheckCircle2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'

export default function ForgotPassword() {
    const [email, setEmail] = useState('')
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
    const [errorMessage, setErrorMessage] = useState('')

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setStatus('loading')
        setErrorMessage('')

        try {
            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: `${window.location.origin}/update-password`,
            })

            if (error) throw error

            setStatus('success')
        } catch (error) {
            console.error('Error resetting password:', error)
            setStatus('error')
            setErrorMessage('No pudimos enviar el correo. Por favor verifica que el email sea correcto e intenta de nuevo.')
        }
    }

    return (
        <div className="min-h-screen bg-subtle-gradient flex">
            {/* Left Panel - Form */}
            <div className="flex-1 flex items-center justify-center p-8">
                <div className="w-full max-w-md">
                    {/* Logo */}
                    <Link to="/login" className="flex items-center gap-3 mb-8 group">
                        <div className="w-12 h-12 bg-hero-gradient rounded-soft flex items-center justify-center transition-transform group-hover:scale-105">
                            <Sparkles className="w-6 h-6 text-white" />
                        </div>
                        <span className="text-2xl font-semibold text-charcoal">Vetly AI</span>
                    </Link>

                    {/* Content */}
                    {status === 'success' ? (
                        <div className="animate-fade-in text-center">
                            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                                <CheckCircle2 className="w-8 h-8 text-green-600" />
                            </div>
                            <h1 className="text-h2 text-charcoal mb-4">
                                ¡Correo enviado!
                            </h1>
                            <p className="text-charcoal/60 mb-8 max-w-sm mx-auto">
                                Hemos enviado un enlace de recuperación a <strong>{email}</strong>.
                                Revisa tu bandeja de entrada (y spam) para restablecer tu contraseña.
                            </p>
                            <Link
                                to="/login"
                                className="btn-secondary w-full py-3 flex items-center justify-center"
                            >
                                <ArrowLeft className="w-4 h-4 mr-2" />
                                Volver al inicio de sesión
                            </Link>
                            <button
                                onClick={() => setStatus('idle')}
                                className="mt-4 text-sm text-primary-600 hover:text-primary-700 font-medium"
                            >
                                Intentar con otro correo
                            </button>
                        </div>
                    ) : (
                        <div className="animate-fade-in">
                            {/* Header */}
                            <h1 className="text-h2 text-charcoal mb-2">
                                Recuperar contraseña
                            </h1>
                            <p className="text-charcoal/60 mb-8">
                                Ingresa tu correo electrónico y te enviaremos las instrucciones para restablecer tu contraseña.
                            </p>

                            {/* Error Message */}
                            {status === 'error' && (
                                <div className="bg-red-50 border border-red-200 text-red-600 rounded-soft p-4 mb-6 text-sm">
                                    {errorMessage}
                                </div>
                            )}

                            {/* Form */}
                            <form onSubmit={handleSubmit} className="space-y-5">
                                {/* Email */}
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
                                            className="input-soft pl-12 w-full"
                                            placeholder="tu@clinica.com"
                                            required
                                            disabled={status === 'loading'}
                                        />
                                    </div>
                                </div>

                                {/* Submit */}
                                <button
                                    type="submit"
                                    disabled={status === 'loading'}
                                    className="btn-primary w-full py-3 flex items-center justify-center gap-2"
                                >
                                    {status === 'loading' ? (
                                        <>
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                            Enviando...
                                        </>
                                    ) : (
                                        'Enviar enlace de recuperación'
                                    )}
                                </button>
                            </form>

                            {/* Back Link */}
                            <div className="mt-8 text-center">
                                <Link to="/login" className="text-charcoal/60 hover:text-charcoal flex items-center justify-center gap-2 text-sm transition-colors">
                                    <ArrowLeft className="w-4 h-4" />
                                    Volver al inicio de sesión
                                </Link>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Right Panel - Hero */}
            <div className="hidden lg:flex flex-1 bg-hero-gradient items-center justify-center p-12">
                <div className="max-w-lg text-white">
                    <h2 className="text-3xl font-semibold mb-6">
                        Acceso seguro a tu clínica
                    </h2>
                    <p className="text-white/80 text-lg mb-8">
                        Protegemos los datos de tus pacientes y tu negocio con los más altos estándares de seguridad.
                    </p>
                    <div className="p-6 bg-white/10 backdrop-blur-sm rounded-soft border border-white/20">
                        <p className="text-white/90 italic">
                            "La seguridad no es un juego, es la base de la confianza con tus pacientes."
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
}
