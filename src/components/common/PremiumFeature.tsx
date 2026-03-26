
import { ReactNode } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { Link } from 'react-router-dom'

interface PremiumFeatureProps {
    children: ReactNode
    fallback?: ReactNode
    requiredPlan?: 'radiance' | 'prestige'
    showLock?: boolean
}

export function PremiumFeature({ children, fallback, requiredPlan = 'radiance', showLock = false }: PremiumFeatureProps) {
    const { subscription } = useAuth()

    const plans = ['essence', 'radiance', 'prestige']
    const currentPlan = subscription?.plan || 'essence'

    // Check if current plan meets requirement
    // Simple hierarchy check: prestige > radiance > essence
    const meetsRequirement = () => {
        if (!subscription) return false
        if (subscription.status !== 'active' && subscription.status !== 'trial') return false

        // If trial, assume access to everything (or prestige level)
        if (subscription.status === 'trial') return true

        const currentIndex = plans.indexOf(currentPlan)
        const requiredIndex = plans.indexOf(requiredPlan)

        return currentIndex >= requiredIndex
    }

    if (meetsRequirement()) {
        return <>{children}</>
    }

    if (showLock) {
        return (
            <div className="relative group">
                <div className="opacity-50 pointer-events-none filter blur-[1px] select-none">
                    {children}
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                    <Link to="/settings?tab=subscription" className="bg-gray-900/80 text-white px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 hover:bg-gray-900 transition-colors">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                        Premium
                    </Link>
                </div>
            </div>
        )
    }

    return <>{fallback}</>
}
