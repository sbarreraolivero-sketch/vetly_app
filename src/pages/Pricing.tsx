import { useState } from 'react'
import { Check, Sparkles, Zap, Crown, ArrowRight, LayoutDashboard, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

// Precio y features deben coincidir con PADDLE_PLANS (src/lib/paddle.ts) /
// PLANS (src/lib/mercadopago.ts) — la fuente real de precios/features.
// Este array se mantiene aparte porque trae metadata solo de esta página
// (icon, gradient, highlight, badge) que no pertenece a esos módulos.
const plans = [
    {
        id: 'enterprise',
        name: 'Enterprise',
        tagline: 'Para redes veterinarias y multi-sucursal.',
        price: 349,
        annualTotal: 3350,
        period: '/mes',
        description: 'Infraestructura completa para escalar múltiples sedes con un solo sistema.',
        highlight: false,
        icon: Crown,
        features: [
            'Usuarios y agendas ilimitados',
            'Todo lo de Pro',
            '30.000 créditos IA/mes · ~1.350 conversaciones',
            'Recordatorios ilimitados',
            'Hasta 3 sucursales',
            'IA personalizada por especialidad',
            'Super Administrador',
            'Soporte 24/7 dedicado',
        ],
        upsells: [
            'Mensajería masiva de marketing segmentada',
        ],
        limitations: [],
        cta: 'Contactar Ventas',
        gradient: 'from-zinc-700 to-zinc-900',
    },
    {
        id: 'pro',
        name: 'Pro',
        tagline: 'Para clínicas en pleno crecimiento, móviles o físicas.',
        price: 169,
        annualTotal: 1622,
        period: '/mes',
        description: 'IA completa, recordatorios, campañas y citas ilimitadas.',
        highlight: true,
        icon: Zap,
        features: [
            '10 usuarios · 5 agendas',
            'Todo lo de Starter',
            '20.000 créditos IA/mes · ~900 conversaciones',
            'Citas con IA ilimitadas',
            'Automatización de recordatorios vía WhatsApp',
            'Encuestas de satisfacción',
            'Soporte prioritario',
        ],
        upsells: [
            'Mensajería masiva de marketing segmentada',
        ],
        limitations: [],
        cta: 'Elegir Pro',
        gradient: 'from-primary-500 to-primary-700',
        badge: 'Popular',
    },
    {
        id: 'starter',
        name: 'Starter',
        tagline: 'Ideal para veterinarios independientes a domicilio.',
        price: 89,
        annualTotal: 854,
        period: '/mes',
        description: 'Agrega el agente IA que atiende y agenda por WhatsApp, 24/7.',
        highlight: false,
        icon: Sparkles,
        features: [
            '5 usuarios · 3 agendas',
            'Todo lo de Core',
            'Agente IA WhatsApp (Lía)',
            '5.000 créditos IA/mes · ~200 conversaciones',
            '100 citas con IA/mes',
            '100 recordatorios automáticos/mes',
            'Logística móvil (Goldi)',
            '¿Más de 100 citas/mes? → Plan Pro',
        ],
        limitations: [],
        cta: 'Comenzar con Starter',
        gradient: 'from-primary-500 to-primary-700',
    },
    {
        id: 'core',
        name: 'Core',
        tagline: 'Gestión completa, sin IA conversacional.',
        price: 39,
        // Precio de lanzamiento. Debe coincidir con `launchPrice` de
        // PADDLE_PLANS.core / PLANS.core y con lo que muestran /core y la home:
        // un precio distinto al del destino es motivo de desaprobación del
        // anuncio en Google Ads.
        launchPrice: 17,
        annualTotal: null,
        period: '/mes',
        description: 'Todo lo que necesitas para administrar tu clínica. Sin el agente de WhatsApp.',
        highlight: false,
        icon: LayoutDashboard,
        features: [
            '10 usuarios · 1 agenda',
            'Dashboard + métricas',
            'Calendario de citas (manual)',
            'Fichas médicas e historial',
            'Módulo de finanzas',
            'Módulo de inventario',
            'Fidelización y referidos',
            'Recordatorios por WhatsApp sin límite (envío manual)',
            '25 recordatorios automáticos/mes',
        ],
        upsells: [
            'Mensajería masiva de marketing segmentada',
        ],
        limitations: [],
        cta: 'Comenzar con Core',
        gradient: 'from-zinc-500 to-zinc-700',
    },
];

const faqs = [
    {
        question: '¿Puedo cambiar de plan en cualquier momento?',
        answer: 'Sí, puedes subir o bajar de plan cuando quieras. Los cambios se aplican en tu próximo ciclo de facturación.',
    },
    {
        question: '¿Qué incluyen los upsells del plan Core?',
        answer: 'El plan Core incluye funciones de gestión sin el agente IA de WhatsApp. Puedes agregar packs de recordatorios (50, 200 o ilimitados/mes) o activar el cobro por consumo de mensajes de plantilla de WhatsApp.',
    },
    {
        question: '¿Qué son los créditos de IA y qué pasa si los supero?',
        answer: 'Cada mensaje que responde el agente consume créditos según el modelo usado. Los créditos de tu plan se recargan cada ciclo mensual (Starter 5.000 ≈ 200 conversaciones, Pro 20.000 ≈ 900, Enterprise 30.000 ≈ 1.350). Si los agotas, puedes comprar un pack adicional desde US$9 sin interrumpir el servicio, o subir de plan.',
    },
    {
        question: '¿Hay costos aparte de la suscripción?',
        answer: 'La suscripción cubre el sistema completo y el procesamiento del agente de IA. El envío de cada mensaje por WhatsApp lo factura Meta directamente a tu clínica según tu país (aproximadamente entre US$0.001 y US$0.03 por mensaje) — en la mayoría de los mercados es un costo menor. Te guiamos en la configuración de tu cuenta de WhatsApp Business con Meta.',
    },
    {
        question: '¿Necesito tener WhatsApp Business?',
        answer: 'Para usar el agente IA (planes Starter, Pro y Enterprise), sí necesitas una cuenta de WhatsApp Business conectada a Meta. El plan Core funciona sin ella. Te guiamos en todo el proceso de configuración.',
    },
    {
        question: '¿Ofrecen descuento por pago anual?',
        answer: 'Sí, al pagar anualmente obtienes 2 meses gratis y bonificamos la tarifa de implementación de $150 USD.',
    },
]

export default function Pricing() {
    const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly')

    const getPrice = (basePrice: number) => {
        if (billingPeriod === 'annual') {
            return Math.round(basePrice * 0.8) // 20% off
        }
        return basePrice
    }

    return (
        <div className="min-h-screen bg-subtle-gradient">
            {/* Header */}
            <header className="bg-white/80 backdrop-blur-md border-b border-silk-beige sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-hero-gradient rounded-soft flex items-center justify-center">
                            <Sparkles className="w-5 h-5 text-white" />
                        </div>
                        <span className="text-xl font-semibold text-charcoal">Vetly AI</span>
                    </div>
                    <nav className="hidden md:flex items-center gap-8">
                        <a href="#features" className="text-charcoal/60 hover:text-charcoal transition-colors">Características</a>
                        <a href="#pricing" className="text-charcoal/60 hover:text-charcoal transition-colors">Precios</a>
                        <a href="#faq" className="text-charcoal/60 hover:text-charcoal transition-colors">FAQ</a>
                    </nav>
                    <div className="flex items-center gap-3">
                        <a href="/login" className="btn-ghost">Iniciar Sesión</a>
                        <a href="#pricing" className="btn-primary">Comenzar Gratis</a>
                    </div>
                </div>
            </header>

            {/* Hero Section */}
            <section className="py-20 px-6">
                <div className="max-w-4xl mx-auto text-center">
                    <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary-500/10 text-primary-600 rounded-full text-sm font-medium mb-6">
                        <Sparkles className="w-4 h-4" />
                        Potenciado por Inteligencia Artificial
                    </div>
                    <h1 className="text-display text-charcoal mb-6">
                        Tu asistente virtual para
                        <span className="text-gradient-hero"> clínicas veterinarias</span>
                    </h1>
                    <p className="text-xl text-charcoal/60 mb-8 max-w-2xl mx-auto">
                        Automatiza la gestión de citas por WhatsApp con un asistente de IA que entiende
                        a tus pacientes y representa la elegancia de tu marca.
                    </p>
                    <div className="flex items-center justify-center gap-4">
                        <a href="#pricing" className="btn-premium flex items-center gap-2 text-lg px-8 py-4">
                            Ver Planes
                            <ArrowRight className="w-5 h-5" />
                        </a>
                        <a href="#demo" className="btn-ghost text-lg px-8 py-4">
                            Ver Demo
                        </a>
                    </div>
                </div>
            </section>

            {/* Pricing Section */}
            <section id="pricing" className="py-20 px-6">
                <div className="max-w-7xl mx-auto">
                    <div className="text-center mb-12">
                        <h2 className="text-h2 text-charcoal mb-4">
                            Planes diseñados para tu crecimiento
                        </h2>
                        <p className="text-lg text-charcoal/60 mb-8">
                            Sin compromisos. Cancela cuando quieras.
                        </p>

                        {/* Billing Toggle */}
                        <div className="inline-flex items-center bg-white rounded-full p-1 shadow-soft">
                            <button
                                onClick={() => setBillingPeriod('monthly')}
                                className={cn(
                                    'px-6 py-2 rounded-full text-sm font-medium transition-all',
                                    billingPeriod === 'monthly'
                                        ? 'bg-primary-500 text-white'
                                        : 'text-charcoal/60 hover:text-charcoal'
                                )}
                            >
                                Mensual
                            </button>
                            <button
                                onClick={() => setBillingPeriod('annual')}
                                className={cn(
                                    'px-6 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2',
                                    billingPeriod === 'annual'
                                        ? 'bg-primary-500 text-white'
                                        : 'text-charcoal/60 hover:text-charcoal'
                                )}
                            >
                                Anual
                                <span className="bg-accent-500 text-charcoal text-xs px-2 py-0.5 rounded-full font-semibold">
                                    2 meses gratis
                                </span>
                            </button>
                        </div>
                    </div>

                    {/* Plans Grid */}
                    <div className="grid md:grid-cols-4 gap-6 max-w-6xl mx-auto">
                        {plans.map((plan) => (
                            <div
                                key={plan.id}
                                className={cn(
                                    'relative rounded-softer p-8 transition-all duration-300',
                                    plan.highlight
                                        ? 'bg-white shadow-soft-xl ring-2 ring-accent-500 scale-105'
                                        : 'bg-white shadow-soft hover:shadow-soft-lg hover:-translate-y-1'
                                )}
                            >
                                {plan.badge && (
                                    <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                                        <span className="bg-premium-gradient text-charcoal text-sm font-semibold px-4 py-1.5 rounded-full shadow-glow-gold">
                                            {plan.badge}
                                        </span>
                                    </div>
                                )}

                                {/* Plan Header */}
                                <div className="text-center mb-6">
                                    <div className={cn(
                                        'w-14 h-14 rounded-softer mx-auto mb-4 flex items-center justify-center bg-gradient-to-br',
                                        plan.gradient
                                    )}>
                                        <plan.icon className="w-7 h-7 text-white" />
                                    </div>
                                    <h3 className="text-h3 text-charcoal">{plan.name}</h3>
                                    <p className="text-sm text-charcoal/50 mt-1">{plan.tagline}</p>
                                </div>

                                {/* Price */}
                                <div className="text-center mb-6">
                                    <div className="flex items-baseline justify-center gap-1.5">
                                        {'launchPrice' in plan && plan.launchPrice ? (
                                            <>
                                                <span className="text-xl text-charcoal/40 line-through">
                                                    ${getPrice(plan.price)}
                                                </span>
                                                <span className="text-4xl font-bold text-charcoal">
                                                    ${getPrice(plan.launchPrice)}
                                                </span>
                                            </>
                                        ) : (
                                            <span className="text-4xl font-bold text-charcoal">
                                                ${getPrice(plan.price)}
                                            </span>
                                        )}
                                        <span className="text-charcoal/50">{plan.period}</span>
                                    </div>
                                    {'launchPrice' in plan && plan.launchPrice && (
                                        <p className="text-xs text-primary-600 font-semibold mt-1">
                                            Precio de lanzamiento · 30 días gratis
                                        </p>
                                    )}
                                    {billingPeriod === 'annual' && plan.annualTotal && (
                                        <p className="text-sm text-primary-600 mt-1 font-medium">
                                            ${plan.annualTotal}/año · 2 meses gratis
                                        </p>
                                    )}
                                    {billingPeriod === 'annual' && !plan.annualTotal && (
                                        <p className="text-sm text-charcoal/40 mt-1">
                                            Sin descuento anual
                                        </p>
                                    )}
                                </div>

                                {/* Description */}
                                <p className="text-sm text-charcoal/60 text-center mb-6">
                                    {plan.description}
                                </p>

                                {/* CTA */}
                                <button
                                    className={cn(
                                        'w-full py-3 rounded-soft font-medium transition-all',
                                        plan.highlight
                                            ? 'bg-premium-gradient text-charcoal hover:shadow-glow-gold'
                                            : 'bg-primary-500 text-white hover:bg-primary-600'
                                    )}
                                >
                                    {plan.cta}
                                </button>

                                {/* Features */}
                                <ul className="mt-8 space-y-3">
                                    {plan.features.map((feature, index) => (
                                        <li key={index} className="flex items-start gap-3">
                                            <Check className="w-5 h-5 text-primary-500 flex-shrink-0 mt-0.5" />
                                            <span className="text-sm text-charcoal/70">{feature}</span>
                                        </li>
                                    ))}
                                </ul>

                                {'upsells' in plan && plan.upsells && plan.upsells.length > 0 && (
                                    <div className="mt-6 pt-5 border-t border-silk-beige">
                                        <p className="text-xs font-semibold text-charcoal/50 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                                            <Plus className="w-3 h-3" />
                                            Add-ons disponibles
                                        </p>
                                        <ul className="space-y-2">
                                            {plan.upsells.map((upsell, index) => (
                                                <li key={index} className="text-xs text-charcoal/60 flex items-start gap-2">
                                                    <span className="text-primary-500 mt-0.5">+</span>
                                                    {upsell}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {plan.limitations.length > 0 && (
                                    <div className="mt-4 pt-4 border-t border-silk-beige">
                                        {plan.limitations.map((limitation, index) => (
                                            <p key={index} className="text-sm text-charcoal/40 italic">
                                                * {limitation}
                                            </p>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Setup Fee Notice */}
                    <div className="mt-12 text-center">
                        <p className="text-charcoal/50 text-sm">
                            Tarifa de implementación única: <span className="font-medium text-charcoal">$150 USD</span>
                            <span className="text-primary-600"> (bonificada con pago anual)</span>
                        </p>
                    </div>
                </div>
            </section>

            {/* FAQ Section */}
            <section id="faq" className="py-20 px-6 bg-white">
                <div className="max-w-3xl mx-auto">
                    <h2 className="text-h2 text-charcoal text-center mb-12">
                        Preguntas Frecuentes
                    </h2>

                    <div className="space-y-4">
                        {faqs.map((faq, index) => (
                            <div
                                key={index}
                                className="p-6 bg-ivory rounded-soft"
                            >
                                <h3 className="font-semibold text-charcoal mb-2">
                                    {faq.question}
                                </h3>
                                <p className="text-charcoal/60">
                                    {faq.answer}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* CTA Section */}
            <section className="py-20 px-6">
                <div className="max-w-4xl mx-auto">
                    <div className="bg-hero-gradient rounded-softest p-12 text-center text-white">
                        <h2 className="text-3xl font-semibold mb-4">
                            Tu próxima cita se agenda sola.
                        </h2>
                        <p className="text-white/80 mb-8 max-w-xl mx-auto">
                            14 días gratis. Sin tarjeta. En menos de una hora tu clínica está automatizada.
                        </p>
                        <div className="flex items-center justify-center gap-4">
                            <a href="#pricing" className="bg-white text-primary-600 font-medium px-8 py-4 rounded-soft hover:shadow-soft-lg transition-all">
                                Comenzar Prueba Gratis
                            </a>
                            <a href="#demo" className="border-2 border-white/30 text-white font-medium px-8 py-4 rounded-soft hover:bg-white/10 transition-all">
                                Agendar Demo
                            </a>
                        </div>
                    </div>
                </div>
            </section>

            {/* Footer */}
            <footer className="bg-charcoal text-white/60 py-12 px-6">
                <div className="max-w-7xl mx-auto">
                    <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-white/10 rounded-soft flex items-center justify-center">
                                <Sparkles className="w-5 h-5 text-accent-500" />
                            </div>
                            <span className="text-lg font-semibold text-white">Vetly AI</span>
                        </div>
                        <div className="flex items-center gap-6 text-sm">
                            <a href="#" className="hover:text-white transition-colors">Términos</a>
                            <a href="#" className="hover:text-white transition-colors">Privacidad</a>
                            <a href="#" className="hover:text-white transition-colors">Contacto</a>
                        </div>
                        <p className="text-sm">
                            © 2024 Vetly AI. Todos los derechos reservados.
                        </p>
                    </div>
                </div>
            </footer>
        </div>
    )
}
