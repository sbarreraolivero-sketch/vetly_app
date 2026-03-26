import { Navigate, Outlet } from 'react-router-dom'
import { useAdminAuth } from '@/contexts/AdminAuthContext'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'

export function AdminProtectedRoute() {
    const { isAdmin, loading } = useAdminAuth()

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <LoadingSpinner />
            </div>
        )
    }

    if (!isAdmin) {
        // Not a super admin, send to public landing page or client login
        return <Navigate to="/hq/login" replace />
    }

    return <Outlet />
}
