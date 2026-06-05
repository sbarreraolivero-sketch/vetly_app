
import { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { usePermissions } from '@/hooks/usePermissions'
import { type PageKey } from '@/lib/permissions'
import { useAuth } from '@/contexts/AuthContext'

interface PermissionGuardProps {
    children: ReactNode
    pageKey: PageKey
    fallbackPath?: string
}

export function PermissionGuard({ children, pageKey, fallbackPath = '/app/dashboard' }: PermissionGuardProps) {
    const { loading } = useAuth()
    const { canAccess, permissions } = usePermissions()

    if (loading) {
        return <div className="flex h-screen items-center justify-center"><LoadingSpinner /></div>
    }

    // permissions === null significa que aún está resolviendo (fail-open)
    if (permissions !== null && !canAccess(pageKey)) {
        return <Navigate to={fallbackPath} replace />
    }

    return <>{children}</>
}
