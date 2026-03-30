import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Sparkles, Lock, Loader2, CheckCircle2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'

export default function UpdatePassword() {
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
    const [errorMessage, setErrorMessage] = useState('')
    const navigate = useNavigate()

    useEffect(() => {
        // Check if we have a session (handled by Supabase auto-login from link)
        const checkSession = async () => {
            const { data: { session } } = await supabase.auth.getSession()
            if (!session) {
                // If no session, maybe token expired or invalid
                // But gives supabase client a moment to process the hash
                setTimeout(async () => {
                    const { data: { session: retrySession } } = await supabase.auth.getSession()
                    if (!retrySession) {
                        // Don't redirect immediately to allow debugging or maybe the hash is being processed?
                        // Actually, if we are here, we likely expect a session.
                        // But if strictly update-password, maybe we can just show form and if update fails it fails.
                    }
                }, 1000)
            }
        }
        checkSession()
    }, [])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        if (password !== confirmPassword) {
            setErrorMessage('Las contraseñas no coinciden')
            setStatus('error')
            return
        }

        if (password.length < 6) {
            setErrorMessage('La contraseña debe tener al menos 6 caracteres')
            setStatus('error')
            return
        }

        setStatus('loading')
        setErrorMessage('')

        try {
            const { error } = await supabase.auth.updateUser({ password })

            if (error) throw error

            setStatus('success')

            // Redirect to dashboard after 3 seconds
            setTimeout(() => {
                navigate('/dashboard')
            }, 3000)
        } catch (error) {
            console.error('Error updating password:', error)
            setStatus('error')
            setErrorMessage('Error al actualizar la contraseña. Es posible que el enlace haya expirado.')
        }
    }

    return (
        <div className="min-h-screen bg-subtle-gradient flex">
            {/* Left Panel - Form */}
            <div className="flex-1 flex items-center justify-center p-8">
                <div className="w-full max-w-md">
                    {/* Logo */}
                    <div className="flex items-center gap-3 mb-8">
                        <div className="w-12 h-12 bg-hero-gradient rounded-soft flex items-center justify-center">
                            <Sparkles className="w-6 h-6 text-white" />
                        </div>
                        <span className="text-2xl font-semibold text-charcoal">Vetly AI</span>
                    </div>

                    {/* Content */}
                    {status === 'success' ? (
                        <div className="animate-fade-in text-center">
                            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                                <CheckCircle2 className="w-8 h-8 text-green-600" />
                            </div>
                            <h1 className="text-h2 text-charcoal mb-4">
                                ¡Contraseña actualizada!
                            </h1>
                            <p className="text-charcoal/60 mb-8 max-w-sm mx-auto">
                                Tu contraseña ha sido modificada correctamente. Redirigiéndote al panel de control...
                            </p>
                            <Link
                                to="/dashboard"
                                className="btn-primary w-full py-3 flex items-center justify-center"
                            >
                                Ir al Dashboard
                            </Link>
                        </div>
                    ) : (
                        <div className="animate-fade-in">
                            {/* Header */}
                            <h1 className="text-h2 text-charcoal mb-2">
                                Nueva contraseña
                            </h1>
                            <p className="text-charcoal/60 mb-8">
                                Ingresa tu nueva contraseña para asegurar tu cuenta.
                            </p>

                            {/* Error Message */}
                            {status === 'error' && (
                                <div className="bg-red-50 border border-red-200 text-red-600 rounded-soft p-4 mb-6 text-sm">
                                    {errorMessage}
                                </div>
                            )}

                            {/* Form */}
                            <form onSubmit={handleSubmit} className="space-y-5">
                                {/* New Password */}
                                <div>
                                    <label htmlFor="password" className="block text-sm font-medium text-charcoal mb-2">
                                        Nueva contraseña
                                    </label>
                                    <div className="relative">
                                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-charcoal/40" />
                                        <input
                                            id="password"
                                            type="password"
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            className="input-soft pl-12 w-full"
                                            placeholder="••••••••"
                                            required
                                            disabled={status === 'loading'}
                                        />
                                    </div>
                                </div>

                                {/* Confirm Password */}
                                <div>
                                    <label htmlFor="confirmPassword" className="block text-sm font-medium text-charcoal mb-2">
                                        Confirmar contraseña
                                    </label>
                                    <div className="relative">
                                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-charcoal/40" />
                                        <input
                                            id="confirmPassword"
                                            type="password"
                                            value={confirmPassword}
                                            onChange={(e) => setConfirmPassword(e.target.value)}
                                            className="input-soft pl-12 w-full"
                                            placeholder="••••••••"
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
                                            Actualizando...
                                        </>
                                    ) : (
                                        'Actualizar contraseña'
                                    )}
                                </button>
                            </form>
                        </div>
                    )}
                </div>
            </div>

            {/* Right Panel - Hero */}
            <div className="hidden lg:flex flex-1 bg-hero-gradient items-center justify-center p-12">
                <div className="max-w-lg text-white">
                    <h2 className="text-3xl font-semibold mb-6">
                        Todo listo para continuar
                    </h2>
                    <p className="text-white/80 text-lg mb-8">
                        Recupera el acceso a todas las herramientas de gestión y automatización de tu clínica.
                    </p>
                </div>
            </div>
        </div>
    )
}
