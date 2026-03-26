
import { useState, useEffect, useCallback } from 'react'
import { Calendar, Check, X, Loader2, ExternalLink, AlertCircle } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'

export function CalendarSettings() {
    const { connectGoogleCalendar, session } = useAuth()
    const [connecting, setConnecting] = useState(false)
    const [isConnected, setIsConnected] = useState(false)
    const [hasStoredToken, setHasStoredToken] = useState(false)

    // Check for stored tokens in database
    const checkStoredTokens = useCallback(async () => {
        if (!session?.user?.id) return

        try {
            const { data, error } = await supabase
                .from('google_calendar_tokens')
                .select('id, expires_at')
                .eq('user_id', session.user.id)
                .single()

            if (data && !error) {
                setHasStoredToken(true)
                setIsConnected(true)
            } else {
                // Check if Google is in linked identities (connected but no stored token)
                const googleIdentity = session?.user?.identities?.find(
                    (identity) => identity.provider === 'google'
                )
                setIsConnected(!!googleIdentity)
                setHasStoredToken(false)
            }
        } catch (err) {
            console.error('Error checking stored tokens:', err)
        }
    }, [session])

    useEffect(() => {
        checkStoredTokens()
    }, [checkStoredTokens])

    const handleConnect = async () => {
        console.log('Handle Connect clicked')
        setConnecting(true)
        try {
            const { error } = await connectGoogleCalendar()
            if (error) {
                console.error('Error in handleConnect:', error)
                alert(`Error al conectar: ${error.message}`)
            }
        } catch (error) {
            console.error('Exception connecting to Google Calendar:', error)
            alert('Error inesperado al conectar')
        } finally {
            setConnecting(false)
        }
    }

    const handleDisconnect = async () => {
        // Find the Google identity to unlink
        const googleIdentity = session?.user?.identities?.find(
            (identity) => identity.provider === 'google'
        )

        // Also delete stored tokens
        if (session?.user?.id) {
            await supabase
                .from('google_calendar_tokens')
                .delete()
                .eq('user_id', session.user.id)
        }

        if (googleIdentity) {
            const { error } = await supabase.auth.unlinkIdentity(googleIdentity)
            if (error) {
                console.error('Error unlinking Google identity:', error)
                alert(`Error al desconectar: ${error.message}`)
            } else {
                setIsConnected(false)
                setHasStoredToken(false)
                alert('Google Calendar desconectado correctamente.')
            }
        } else {
            setIsConnected(false)
            setHasStoredToken(false)
            alert('Google Calendar desconectado correctamente.')
        }
    }

    return (
        <div>
            <div className="flex items-start justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center text-blue-600">
                        <Calendar className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="font-semibold text-charcoal">Google Calendar</h3>
                        <p className="text-sm text-charcoal/60">Sincroniza tus citas automáticamente</p>
                    </div>
                </div>
                {isConnected ? (
                    <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium border border-emerald-100">
                        <Check className="w-3 h-3" />
                        Conectado
                    </span>
                ) : (
                    <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-charcoal/5 text-charcoal/60 text-xs font-medium border border-charcoal/10">
                        Not Conectado
                    </span>
                )}
            </div>

            <div className="space-y-4">
                <div className="text-sm text-charcoal/70">
                    <p>Al conectar tu cuenta de Google Calendar podrás:</p>
                    <ul className="list-disc pl-5 mt-2 space-y-1">
                        <li>Ver tus eventos de Google junto con tus citas.</li>
                        <li>Evitar conflictos de horarios.</li>
                        <li>Sincronización en tiempo real (lectura).</li>
                    </ul>
                </div>

                {isConnected ? (
                    <div className="space-y-3">
                        {!hasStoredToken && (
                            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-soft text-sm text-amber-800">
                                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                <p>
                                    Tu cuenta está vinculada, pero para ver los eventos del calendario necesitas
                                    <button
                                        onClick={handleConnect}
                                        className="font-medium underline hover:no-underline ml-1"
                                    >
                                        reconectar
                                    </button>
                                    . Por seguridad, el acceso expira al cerrar sesión.
                                </p>
                            </div>
                        )}
                        <div className="flex gap-3">
                            <button
                                onClick={handleDisconnect}
                                className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-soft transition-colors flex items-center gap-2"
                            >
                                <X className="w-4 h-4" />
                                Desconectar
                            </button>
                            <a
                                href="https://calendar.google.com"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-4 py-2 text-sm font-medium text-charcoal/70 hover:bg-silk-beige rounded-soft transition-colors flex items-center gap-2"
                            >
                                <ExternalLink className="w-4 h-4" />
                                Abrir Google Calendar
                            </a>
                        </div>
                    </div>
                ) : (
                    <button
                        onClick={handleConnect}
                        disabled={connecting}
                        className="w-full sm:w-auto px-6 py-2.5 bg-white border border-charcoal/20 hover:bg-gray-50 text-charcoal font-medium rounded-soft transition-all duration-200 flex items-center justify-center gap-3 shadow-sm"
                    >
                        {connecting ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                            <img src="https://www.svgrepo.com/show/475656/google-color.svg" alt="Google" className="w-5 h-5" />
                        )}
                        Conectar con Google
                    </button>
                )}
            </div>

            {/* Debug Section - Hidden by default, useful for troubleshooting */}
            <details className="mt-8 p-4 bg-gray-100 rounded text-xs font-mono">
                <summary className="cursor-pointer font-bold text-gray-500">Debug Session Info</summary>
                <div className="mt-2 space-y-2 overflow-auto max-h-60">
                    <div>
                        <strong>User ID:</strong> {session?.user?.id}
                    </div>
                    <div>
                        <strong>Email Confirmed At:</strong> {session?.user?.email_confirmed_at || 'Unconfirmed'}
                    </div>
                    <div>
                        <strong>Provider Token:</strong> {session?.provider_token ? `Present (${session.provider_token.substring(0, 10)}...)` : 'Missing'}
                    </div>
                    <div>
                        <strong>Refresh Token:</strong> {session?.provider_refresh_token ? 'Present' : 'Missing'}
                    </div>
                    <div>
                        <strong>Current URL:</strong> <div className="break-all">{window.location.href}</div>
                    </div>
                    <div>
                        <strong>Identities:</strong>
                        <pre>{JSON.stringify(session?.user?.identities, null, 2)}</pre>
                    </div>
                    <div>
                        <strong>Has Stored Token (DB):</strong> {hasStoredToken ? 'Yes' : 'No'}
                    </div>
                    <div>
                        <button
                            onClick={() => {
                                console.log('Manual token check triggered');
                                if (session?.provider_token) {
                                    alert('Intentando guardar token manualmente...');
                                    supabase.functions.invoke('store-google-tokens', {
                                        body: {
                                            access_token: session.provider_token,
                                            refresh_token: session.provider_refresh_token || null,
                                            expires_in: 3600,
                                        },
                                    }).then(res => alert('Resultado: ' + JSON.stringify(res)));
                                } else {
                                    alert('No hay provider_token en la sesión para guardar.');
                                }
                            }}
                            className="mt-2 px-2 py-1 bg-gray-300 rounded hover:bg-gray-400"
                        >
                            Forzar Guardado de Token
                        </button>
                    </div>
                </div>
            </details >
        </div >
    )
}
