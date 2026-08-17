import { MessageCircle, X } from 'lucide-react'

const ANDRES_WHATSAPP_NUMBER = '56993089185'

interface PostPaymentOnboardingBannerProps {
    clinicName: string
    planName: string
    onDismiss: () => void
}

export default function PostPaymentOnboardingBanner({ clinicName, planName, onDismiss }: PostPaymentOnboardingBannerProps) {
    const message = `Hola Andrés, soy de ${clinicName} y acabo de suscribirme al plan ${planName} de Vetly. Quiero agendar mi llamada de bienvenida.`
    const waUrl = `https://wa.me/${ANDRES_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`

    return (
        <div className="bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-2xl overflow-hidden shadow-soft-md text-white animate-fade-in">
            <div className="p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center gap-5">
                <div className="w-12 h-12 bg-white/15 rounded-2xl flex items-center justify-center shrink-0">
                    <MessageCircle className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-xs font-black uppercase tracking-widest text-emerald-100 mb-1">¡Bienvenido a Vetly {planName}!</p>
                    <h3 className="text-lg font-extrabold tracking-tight">Agenda tu llamada de bienvenida</h3>
                    <p className="text-sm text-emerald-50/90 font-light mt-1">
                        Andrés, nuestro especialista, te ayuda a dejar todo configurado en 15 minutos: agenda, WhatsApp y equipo.
                    </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <a
                        href={waUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={onDismiss}
                        className="bg-white text-emerald-700 font-bold text-sm px-5 py-2.5 rounded-soft hover:bg-emerald-50 transition-all whitespace-nowrap"
                    >
                        Agendar mi llamada
                    </a>
                    <button
                        onClick={onDismiss}
                        aria-label="Descartar"
                        className="p-2 hover:bg-white/10 rounded-soft transition-all"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    )
}
