import { useState } from 'react'
import { Check, Sparkles, Zap, Crown, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

const plans = [
    {
        id: 'essence',
        name: 'Essence',
        tagline: 'Para clínicas que buscan orden y visibilidad.',
        price: 79,
        period: '/mes',
        description: 'Todo lo necesario para organizar tu atención y automatizar el agendamiento.',
        highlight: false,
        icon: Sparkles,
        features: [
            'Hasta 2 usuarios',
            '1 Agente IA (Soft Luxury)',
            'Hasta 50 citas mensuales',
            'Dashboard básico',
            'Integración WhatsApp',
            'Revenue Retention Engine (Diagnóstico)',
            'Dashboard de ingresos en riesgo',
            'Alertas manuales'
        ],
        limitations: [],
        cta: 'Comenzar con Essence',
        gradient: 'from-gray-500 to-gray-700',
    },
    {
        id: 'radiance',
        name: 'Radiance',
        tagline: 'Para clínicas en crecimiento.',
        price: 159,
        period: '/mes',
        description: 'La solución completa para captar, retener y gestionar financieramente tu centro.',
        highlight: true,
        icon: Zap,
        features: [
            'Todo lo de Essence, más:',
            'Hasta 5 usuarios',
            'CRM Gestión de prospectos',
            'Campañas WhatsApp masivas',
            'Módulo de Finanzas',
            'Gestión de servicios + upselling',
            'Citas ilimitadas',
            'IA avanzada + historial clínico',
            'Analítica de conversaciones',
            'Revenue Engine Totalmente Autónomo (o supervisado)',
            'Métrica de ingresos recuperados'
        ],
        limitations: [],
        cta: 'Elegir Radiance',
        gradient: 'from-primary-500 to-primary-700',
        badge: 'Popular',
    },
    {
        id: 'prestige',
        name: 'Prestige',
        tagline: 'Para clínicas consolidadas y expansión.',
        price: 299,
        period: '/mes',
        description: 'Infraestructura empresarial para controlar y escalar sedes automáticamente.',
        highlight: false,
        icon: Crown,
        features: [
            'Todo lo de Radiance, más:',
            'Usuarios ilimitados',
            'Multi-sucursal',
            'IA personalizada (manual de ventas)',
            'Reportes ejecutivos avanzados',
            'Concierge Onboarding',
            'Revenue Engine totalmente autónomo',
            'Ajuste dinámico por tratamiento',
            'Proyección LTV',
            'Benchmark entre sedes'
        ],
        limitations: [],
        cta: 'Contactar Ventas',
        gradient: 'from-charcoal to-charcoal/90',
    },
]

const faqs = [
    {
        question: '¿Puedo cambiar de plan en cualquier momento?',
        answer: 'Sí, puedes subir o bajar de plan cuando quieras. Los cambios se aplican en tu próximo ciclo de facturación.',
    },
    {
        question: '¿Qué pasa si supero las 50 citas en el plan Essence?',
        answer: 'Te notificaremos cuando te acerques al límite y podrás comprar un "Refill de Energía" por $29 USD o subir al plan Radiance.',
    },
    {
        question: '¿Necesito tener WhatsApp Business?',
        answer: 'Sí, necesitas una cuenta de WhatsApp Business API. Te guiamos en todo el proceso de configuración con YCloud.',
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
            return Math.round(basePrice * 10 / 12) // 2 meses gratis
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
                        <span className="text-xl font-semibold text-charcoal">Vetly AI AI</span>
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
                        <span className="text-gradient-hero"> clínicas estéticas</span>
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
                                <span className="bg-accent-500 text-charcoal text-xs px-2 py-0.5 rounded-full">
                                    -17%
                                </span>
                            </button>
                        </div>
                    </div>

                    {/* Plans Grid */}
                    <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
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
                                    <div className="flex items-baseline justify-center gap-1">
                                        <span className="text-4xl font-bold text-charcoal">
                                            ${getPrice(plan.price)}
                                        </span>
                                        <span className="text-charcoal/50">{plan.period}</span>
                                    </div>
                                    {billingPeriod === 'annual' && (
                                        <p className="text-sm text-primary-600 mt-1">
                                            2 meses gratis + Setup bonificado
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
                            ¿Lista para transformar tu clínica?
                        </h2>
                        <p className="text-white/80 mb-8 max-w-xl mx-auto">
                            Únete a las clínicas que ya están ahorrando 20+ horas semanales
                            con su asistente de IA.
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
                            <span className="text-lg font-semibold text-white">Vetly AI AI</span>
                        </div>
                        <div className="flex items-center gap-6 text-sm">
                            <a href="#" className="hover:text-white transition-colors">Términos</a>
                            <a href="#" className="hover:text-white transition-colors">Privacidad</a>
                            <a href="#" className="hover:text-white transition-colors">Contacto</a>
                        </div>
                        <p className="text-sm">
                            © 2024 Vetly AI AI. Todos los derechos reservados.
                        </p>
                    </div>
                </div>
            </footer>
        </div>
    )
}
