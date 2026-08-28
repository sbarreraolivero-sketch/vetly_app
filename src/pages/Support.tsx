import { MessageCircle, PlayCircle, Mail } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

const SUPPORT_WA = '56993089185'

// Los tutoriales en video llegan durante los primeros días por correo. Cuando
// exista la biblioteca de videos, esta lista se reemplaza por enlaces reales.
const TUTORIALES_PROXIMOS = [
    'Enlazar un servicio con su producto de inventario (que el stock baje solo)',
    'Crear tu link de reservas online con tu logo y color',
    'Conectar tu WhatsApp para los recordatorios automáticos',
    'Crear las plantillas de los recordatorios automáticos',
]

export default function Support() {
    const { profile } = useAuth()
    const clinicName = (profile as any)?.clinic_name || ''

    const waUrl = `https://wa.me/${SUPPORT_WA}?text=${encodeURIComponent(
        `Hola! ${clinicName ? `Soy de ${clinicName}. ` : ''}Necesito ayuda con Vetly.`,
    )}`

    return (
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-charcoal">Soporte</h1>
                <p className="text-sm text-charcoal/60 mt-1">
                    Estamos para ayudarte a dejar tu clínica configurada. Sin costo.
                </p>
            </div>

            {/* WhatsApp — canal principal */}
            <div className="bg-white rounded-2xl border border-silk-beige p-6 sm:p-8">
                <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
                        <MessageCircle className="w-6 h-6 text-emerald-600" />
                    </div>
                    <div className="flex-1">
                        <h2 className="text-lg font-bold text-charcoal">Escríbenos por WhatsApp</h2>
                        <p className="text-sm text-charcoal/60 mt-1 leading-relaxed">
                            Es la forma más rápida. Te respondemos en horario hábil y te acompañamos
                            paso a paso en lo que necesites configurar: perfil, clínica, servicios,
                            inventario, finanzas o fidelización.
                        </p>
                        <a
                            href={waUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 mt-4 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm px-5 py-3 rounded-xl transition-colors"
                        >
                            <MessageCircle className="w-4 h-4" />
                            Abrir WhatsApp de Soporte
                        </a>
                    </div>
                </div>
            </div>

            {/* Tutoriales en video */}
            <div className="bg-white rounded-2xl border border-silk-beige p-6 sm:p-8">
                <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-primary-50 flex items-center justify-center shrink-0">
                        <PlayCircle className="w-6 h-6 text-primary-600" />
                    </div>
                    <div className="flex-1">
                        <h2 className="text-lg font-bold text-charcoal">Tutoriales en video</h2>
                        <p className="text-sm text-charcoal/60 mt-1 leading-relaxed">
                            Estamos preparando videos cortos para la configuración más técnica. Te
                            van a llegar por correo durante tus primeros días. Estos son los que vienen:
                        </p>
                        <ul className="mt-4 space-y-2">
                            {TUTORIALES_PROXIMOS.map((t) => (
                                <li key={t} className="flex items-start gap-2.5 text-sm text-charcoal/80">
                                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary-400 shrink-0" />
                                    {t}
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            </div>

            {/* Correo */}
            <div className="bg-white rounded-2xl border border-silk-beige p-6 sm:p-8">
                <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-silk-beige/40 flex items-center justify-center shrink-0">
                        <Mail className="w-6 h-6 text-charcoal/50" />
                    </div>
                    <div className="flex-1">
                        <h2 className="text-lg font-bold text-charcoal">Por correo</h2>
                        <p className="text-sm text-charcoal/60 mt-1 leading-relaxed">
                            Si prefieres escribir con calma, mándanos un correo a{' '}
                            <a href="mailto:hola@vetly.pro" className="text-primary-600 font-medium">
                                hola@vetly.pro
                            </a>{' '}
                            y te respondemos ahí.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
}
