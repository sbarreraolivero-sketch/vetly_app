import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogIn, Loader2, ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'

// Direct API call that bypasses the buggy AbortController in supabase-js
async function checkIsAdmin(userId: string, accessToken: string): Promise<boolean> {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

    try {
        const response = await fetch(
            `${supabaseUrl}/rest/v1/platform_admins?id=eq.${userId}&select=id,role`,
            {
                headers: {
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
            }
        )

        if (!response.ok) return false
        const data = await response.json()
        return Array.isArray(data) && data.length > 0
    } catch (err) {
        console.error('Direct admin check failed:', err)
        return false
    }
}

export default function AdminLogin() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const navigate = useNavigate()

    // On mount, check if there's already an admin session
    useEffect(() => {
        let cancelled = false

        supabase.auth.getSession()
            .then(async ({ data: { session } }) => {
                if (cancelled || !session?.user || !session.access_token) return
                const isAdmin = await checkIsAdmin(session.user.id, session.access_token)
                if (isAdmin && !cancelled) {
                    navigate('/hq/dashboard', { replace: true })
                }
            })
            .catch(() => { })

        return () => { cancelled = true }
    }, [navigate])

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')
        setLoading(true)

        try {
            // Sign in
            const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
                email: email.trim(),
                password,
            })

            if (authError) throw authError
            if (!authData?.user || !authData?.session?.access_token) {
                throw new Error('No se pudo autenticar.')
            }

            // Use DIRECT fetch to verify admin status (bypasses AbortController bug)
            const isAdmin = await checkIsAdmin(authData.user.id, authData.session.access_token)

            if (!isAdmin) {
                await supabase.auth.signOut().catch(() => { })
                throw new Error('Acceso denegado. Esta cuenta no tiene privilegios de HQ.')
            }

            // Success
            navigate('/hq/dashboard', { replace: true })

        } catch (err: any) {
            console.error('Login error:', err)
            if (err.message?.includes('abort') || err.message?.includes('signal')) {
                setError('Error de conexión. Por favor intenta nuevamente.')
            } else {
                setError(err.message || 'Error al iniciar sesión.')
            }
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen bg-gray-900 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
            <div className="sm:mx-auto sm:w-full sm:max-w-md">
                <div className="flex justify-center">
                    <div className="w-16 h-16 bg-primary-600 rounded-2xl flex items-center justify-center shadow-lg shadow-primary-500/30">
                        <ShieldCheck className="w-8 h-8 text-white" />
                    </div>
                </div>
                <h2 className="mt-6 text-center text-3xl font-extrabold text-white">
                    Vetly AI HQ
                </h2>
                <p className="mt-2 text-center text-sm text-gray-400">
                    Panel de Administración Global
                </p>
            </div>

            <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                <div className="bg-gray-800 py-8 px-4 shadow-xl sm:rounded-2xl sm:px-10 border border-gray-700">
                    <form className="space-y-6" onSubmit={handleLogin}>
                        {error && (
                            <div className="bg-red-500/10 border border-red-500/50 text-red-500 p-4 rounded-xl text-sm text-center">
                                {error}
                            </div>
                        )}

                        <div>
                            <label className="block text-sm font-medium text-gray-300">
                                Email de Equipo
                            </label>
                            <div className="mt-1">
                                <input
                                    id="hq-email"
                                    type="email"
                                    required
                                    autoComplete="off"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="appearance-none block w-full px-3 py-3 border border-gray-600 bg-gray-900 rounded-xl placeholder-gray-500 text-white focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                                    placeholder="nombre@Vetly AI.com"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-300">
                                Contraseña Segura
                            </label>
                            <div className="mt-1">
                                <input
                                    id="hq-password"
                                    type="password"
                                    required
                                    autoComplete="off"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="appearance-none block w-full px-3 py-3 border border-gray-600 bg-gray-900 rounded-xl placeholder-gray-500 text-white focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                            {loading ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                                <span className="flex items-center gap-2">
                                    <LogIn className="w-5 h-5" />
                                    Acceder al HQ
                                </span>
                            )}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    )
}
