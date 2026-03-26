import { ReactNode } from 'react'

export function Badge({ children, className = '' }: { children: ReactNode, className?: string }) {
    return (
        <span className={`inline-flex items-center gap-2 bg-primary-500/10 text-primary-600 px-4 py-2 rounded-full text-sm font-medium ${className}`}>
            {children}
        </span>
    )
}

export function SectionHeader({ title, subtitle, badge }: { title: string, subtitle?: string, badge?: ReactNode }) {
    return (
        <div className="text-center max-w-3xl mx-auto mb-16">
            {badge && <div className="mb-6 flex justify-center">{badge}</div>}
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-charcoal mb-6">
                {title}
            </h2>
            {subtitle && (
                <p className="text-xl text-charcoal/60 leading-relaxed">
                    {subtitle}
                </p>
            )}
        </div>
    )
}
