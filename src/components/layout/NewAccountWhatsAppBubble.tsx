import { useState, useEffect } from 'react'
import { MessageCircle, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'

const ANDRES_WHATSAPP_NUMBER = '56993089185'
// Ventana en la que se considera "cuenta nueva" — ajustable sin tocar el resto del componente.
const NEW_ACCOUNT_WINDOW_DAYS = 14

/**
 * Burbuja flotante de WhatsApp para cuentas recién creadas — invita a agendar
 * la reunión de implementación. Distinta de PostPaymentOnboardingBanner (que
 * dispara con el evento de PAGO): el plan Core no pasa por checkout, así que
 * necesita un gatillo propio basado en la antigüedad de la clínica.
 */
export default function NewAccountWhatsAppBubble({ clinicId }: { clinicId: string | null | undefined }) {
    const [clinicName, setClinicName] = useState<string | null>(null)
    const [isNew, setIsNew] = useState(false)
    const [dismissed, setDismissed] = useState(false)

    useEffect(() => {
        if (!clinicId) return
        setDismissed(localStorage.getItem(`vetly_wa_implementacion_dismissed_${clinicId}`) === '1')

        const load = async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data } = await (supabase as any)
                .from('clinic_settings')
                .select('clinic_name, created_at')
                .eq('id', clinicId)
                .single()
            if (!data) return
            setClinicName(data.clinic_name || null)
            if (data.created_at) {
                const ageDays = (Date.now() - new Date(data.created_at).getTime()) / (1000 * 60 * 60 * 24)
                setIsNew(ageDays <= NEW_ACCOUNT_WINDOW_DAYS)
            }
        }
        load()
    }, [clinicId])

    if (!clinicId || !isNew || dismissed) return null

    const handleDismiss = () => {
        localStorage.setItem(`vetly_wa_implementacion_dismissed_${clinicId}`, '1')
        setDismissed(true)
    }

    const message = `Hola! Soy de ${clinicName || 'mi clínica'}, acabo de crear mi cuenta en Vetly y quiero agendar mi reunión de implementación.`
    const waUrl = `https://wa.me/${ANDRES_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`

    return (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 animate-fade-in">
            <a
                href={waUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2.5 bg-[#25D366] hover:bg-[#20bd5a] text-white pl-4 pr-5 py-3.5 rounded-full shadow-lg shadow-black/15 hover:-translate-y-0.5 hover:shadow-xl transition-all"
            >
                <MessageCircle className="w-5 h-5 shrink-0" />
                <span className="text-sm font-bold whitespace-nowrap">Agenda tu reunión de implementación</span>
            </a>
            <button
                onClick={handleDismiss}
                aria-label="Cerrar"
                className="w-7 h-7 rounded-full bg-white border border-silk-beige shadow-md flex items-center justify-center text-charcoal/40 hover:text-charcoal/70 transition-colors shrink-0"
            >
                <X className="w-3.5 h-3.5" />
            </button>
        </div>
    )
}
