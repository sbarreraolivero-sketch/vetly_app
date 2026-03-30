import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Sparkles, Mail, Lock, ArrowRight, Loader2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

export default function Login() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)

    const { signIn } = useAuth()
    const navigate = useNavigate()

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')
        setLoading(true)

        const { error } = await signIn(email, password)

        if (error) {
            setError('Credenciales incorrectas. Verifica tu email y contraseña.')
            setLoading(false)
            return
        }

        navigate('/dashboard')
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

                    {/* Header */}
                    <h1 className="text-h2 text-charcoal mb-2">
                        Bienvenido de vuelta
                    </h1>
                    <p className="text-charcoal/60 mb-8">
                        Ingresa a tu cuenta para gestionar tu clínica
                    </p>

                    {/* Error Message */}
                    {error && (
                        <div className="bg-red-50 border border-red-200 text-red-600 rounded-soft p-4 mb-6">
                            {error}
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
                                />
                            </div>
                        </div>

                        {/* Password */}
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
                                    placeholder="••••••••"
                                    required
                                />
                            </div>
                        </div>

                        {/* Forgot Password */}
                        <div className="flex justify-end">
                            <Link to="/forgot-password" className="text-sm text-primary-600 hover:text-primary-700">
                                ¿Olvidaste tu contraseña?
                            </Link>
                        </div>

                        {/* Submit */}
                        <button
                            type="submit"
                            disabled={loading}
                            className="btn-primary w-full py-3 flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    Ingresando...
                                </>
                            ) : (
                                <>
                                    Ingresar
                                    <ArrowRight className="w-5 h-5" />
                                </>
                            )}
                        </button>
                    </form>

                    {/* Register Link */}
                    <p className="mt-8 text-center text-charcoal/60">
                        ¿No tienes cuenta?{' '}
                        <Link to="/register" className="text-primary-600 font-medium hover:text-primary-700">
                            Registra tu clínica
                        </Link>
                    </p>
                </div>
            </div>

            {/* Right Panel - Hero */}
            <div className="hidden lg:flex flex-1 bg-hero-gradient items-center justify-center p-12">
                <div className="max-w-lg text-white">
                    <h2 className="text-3xl font-semibold mb-4">
                        Tu asistente de IA trabajando 24/7
                    </h2>
                    <p className="text-white/80 text-lg mb-8">
                        Mientras tú descansas, tu asistente virtual está atendiendo consultas,
                        agendando citas y confirmando pacientes por WhatsApp.
                    </p>
                    <div className="space-y-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                                ✓
                            </div>
                            <span>Hasta 50% menos no-shows</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                                ✓
                            </div>
                            <span>Ahorra 20+ horas semanales</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                                ✓
                            </div>
                            <span>Respuestas en menos de 1 minuto</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
