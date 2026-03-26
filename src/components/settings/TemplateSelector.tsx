import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'

interface Template {
    name: string
    status: 'APPROVED' | 'PENDING' | 'REJECTED'
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
        const fetchTemplates = async () => {
            if (!clinicId) return
            try {
                const { data, error } = await supabase.functions.invoke('get-ycloud-templates', {
                    body: { clinic_id: clinicId }
                })
                if (!error && data?.templates) {
                    setTemplates(data.templates.filter((t: any) => t.status === 'APPROVED'))
                }
            } catch (err) {
                console.error('Error fetching templates:', err)
            } finally {
                setIsLoading(false)
            }
        }
        if (clinicId) {
            fetchTemplates()
        }
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
