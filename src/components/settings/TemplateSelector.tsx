import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'

interface Template {
    name: string
    status: 'APPROVED' | 'PENDING' | 'REJECTED'
}

// Cache a nivel de módulo: varias instancias de TemplateSelector (24h, 2h, vacuna,
// desparasitación, control) comparten un solo request a YCloud por clínica.
const templatesCache = new Map<string, Template[]>()
const inFlight = new Map<string, Promise<Template[]>>()

async function fetchClinicTemplates(clinicId: string): Promise<Template[]> {
    if (templatesCache.has(clinicId)) return templatesCache.get(clinicId)!
    if (inFlight.has(clinicId)) return inFlight.get(clinicId)!

    const promise = (async () => {
        const { data, error } = await supabase.functions.invoke('ycloud-templates', {
            body: { action: 'list', clinic_id: clinicId }
        })
        if (error) throw error
        if (data?.isError || data?.error) throw new Error(data.error || 'API Error')
        const list: Template[] = (data?.templates || []).filter((t: any) =>
            t.status === 'APPROVED' ||
            t.status?.toUpperCase?.()?.startsWith?.('ACTIVE') ||
            t.status?.toLowerCase?.() === 'approved'
        )
        templatesCache.set(clinicId, list)
        return list
    })()

    inFlight.set(clinicId, promise)
    try {
        return await promise
    } finally {
        inFlight.delete(clinicId)
    }
}

interface TemplateSelectorProps {
    value: string
    onChange: (value: string) => void
    label: string
    description?: string
    placeholder?: string
    labelClassName?: string
}

export function TemplateSelector({ 
    value, 
    onChange, 
    label, 
    description, 
    placeholder = 'Seleccionar plantilla...',
    labelClassName = 'text-charcoal'
}: TemplateSelectorProps) {
    const [templates, setTemplates] = useState<Template[]>([])
    const [isLoading, setIsLoading] = useState(true)

    const { profile } = useAuth()
    const clinicId = profile?.clinic_id

    useEffect(() => {
        let isMounted = true
        if (!clinicId) return

        // Cache instantáneo si ya se cargaron las plantillas de esta clínica
        if (templatesCache.has(clinicId)) {
            setTemplates(templatesCache.get(clinicId)!)
            setIsLoading(false)
            return
        }

        const timeout = setTimeout(() => {
            if (isMounted) setIsLoading(false)
        }, 5000)

        fetchClinicTemplates(clinicId)
            .then((list) => { if (isMounted) setTemplates(list) })
            .catch((err) => console.error('Error fetching templates:', err))
            .finally(() => {
                clearTimeout(timeout)
                if (isMounted) setIsLoading(false)
            })

        return () => { isMounted = false }
    }, [clinicId])

    return (
        <div className="space-y-2">
            <label className={cn("block text-xs font-bold uppercase tracking-widest", labelClassName)}>{label}</label>
            {description && <p className="text-xs text-charcoal/50 leading-relaxed">{description}</p>}
            <select
                value={value || ''}
                onChange={(e) => onChange(e.target.value)}
                disabled={isLoading}
                className="w-full px-4 py-2 bg-white border border-charcoal/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 text-charcoal disabled:opacity-50"
            >
                <option value="">{isLoading ? 'Cargando plantillas...' : placeholder}</option>
                {templates.map((tpl) => (
                    <option key={tpl.name} value={tpl.name}>
                        {tpl.name}
                    </option>
                ))}
            </select>
        </div>
    )
}
