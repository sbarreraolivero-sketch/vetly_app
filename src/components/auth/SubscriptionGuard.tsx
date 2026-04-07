
import { useEffect, ReactNode } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'

interface SubscriptionGuardProps {
    children: ReactNode
    fallback?: ReactNode
}

export function SubscriptionGuard({ children, fallback }: SubscriptionGuardProps) {
    const { user, subscription, loading } = useAuth()
    const navigate = useNavigate()
    const location = useLocation()

    useEffect(() => {
        if (!loading) {
            // Bypass for known owner emails - ALWAYS ALLOW ACCESS
            const ownerEmails = ['claubarreraolivero@gmail.com', 'sebabarreraolivero@gmail.com', 'sebabarrera@gmail.com']
            if (user?.email && ownerEmails.includes(user.email.toLowerCase().trim())) {
                return;
            }

            // PERMISSIVE LOGIC: We only block if we are ABSOLUTELY SURE it's expired/canceled
            // Valid statuses for full access
            const validStatuses = ['active', 'converted', 'freemium', 'trial', 'trialing', 'on_hold']
            const currentStatus = (subscription?.status as string || '').toLowerCase()
            
            const isActive = validStatuses.includes(currentStatus)
            const trialExpired = currentStatus === 'trial' && subscription?.trial_ends_at && new Date(subscription.trial_ends_at) < new Date()

            // Do NOT block if status is null or not found (default to free/limited access instead of total block)
            const isBlocked = subscription !== null && (!isActive || trialExpired)

            if (isBlocked && location.pathname !== '/app/settings') {
                // If it's blocked, we only force redirect if they are not in settings already
                navigate('/app/settings?tab=subscription', {
                    state: {
                        from: location.pathname,
                        message: 'Tu suscripción requiere atención. Por favor revisa los detalles de tu plan.'
                    }
                })
            }
        }
    }, [subscription, loading, navigate, location, fallback, user?.email])

    if (loading) {
        return <div className="flex h-screen items-center justify-center"><LoadingSpinner /></div>
    }

    // Apply bypass for rendering as well
    const ownerEmails = ['claubarreraolivero@gmail.com', 'sebabarreraolivero@gmail.com', 'sebabarrera@gmail.com']
    const isOwner = user?.email && ownerEmails.includes(user.email.toLowerCase().trim())

    if (isOwner) {
        return <>{children}</>
    }

    // Determine current status for blocking decision
    const validStatuses = ['active', 'converted', 'freemium', 'trial', 'trialing', 'on_hold']
    const currentStatus = (subscription?.status as string || '').toLowerCase()
    const isActive = validStatuses.includes(currentStatus)
    const trialExpired = (currentStatus === 'trial' || currentStatus === 'trialing') && subscription?.trial_ends_at ? new Date(subscription.trial_ends_at) < new Date() : false

    const isBlocked = subscription !== null && (!isActive || trialExpired)

    if (isBlocked) {
        if (fallback) return <>{fallback}</>
        if (location.pathname === '/app/settings') return <>{children}</> // allow settings route
        return null // Will redirect in useEffect
    }

    return <>{children}</>
}
