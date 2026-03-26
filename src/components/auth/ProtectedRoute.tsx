import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { Loader2 } from 'lucide-react'

interface ProtectedRouteProps {
    children: React.ReactNode
    requireAuth?: boolean
    redirectTo?: string
}

export default function ProtectedRoute({
    children,
    requireAuth = true,
    redirectTo = '/login'
}: ProtectedRouteProps) {
    const { isAuthenticated, loading } = useAuth()
    const location = useLocation()

    // Show loading while checking auth
    if (loading) {
        return (
            <div className="min-h-screen bg-subtle-gradient flex items-center justify-center">
                <div className="text-center">
                    <Loader2 className="w-8 h-8 text-primary-500 animate-spin mx-auto mb-4" />
                    <p className="text-charcoal/60">Cargando...</p>
                </div>
            </div>
        )
    }

    // If auth is required and user is not authenticated, redirect to login
    if (requireAuth && !isAuthenticated) {
        return <Navigate to={redirectTo} state={{ from: location }} replace />
    }

    // If auth is NOT required (like login page) and user IS authenticated, redirect to dashboard
    if (!requireAuth && isAuthenticated) {
        return <Navigate to="/dashboard" replace />
    }

    return <>{children}</>
}
