
import { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'

interface RoleGuardProps {
    children: ReactNode
    allowedRoles: ('owner' | 'admin' | 'professional' | 'receptionist' | 'vet_assistant')[]
    fallbackPath?: string
}

export function RoleGuard({ children, allowedRoles, fallbackPath = '/app/dashboard' }: RoleGuardProps) {
    const { member, profile, loading } = useAuth()

    if (loading) {
        return <div className="flex h-screen items-center justify-center"><LoadingSpinner /></div>
    }

    const memberRole = member?.role
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const profileRole = (profile as any)?.role

    if (!allowedRoles.includes(memberRole as any) && !allowedRoles.includes(profileRole as any)) {
        return <Navigate to={fallbackPath} replace />
    }

    return <>{children}</>
}
