import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
    Sparkles,
    ArrowRight,
    Users,
    MessageSquare,
    Calendar,
    BarChart3,
    Activity,
    Play,
    CheckCircle2,
    Check,
    Zap,
    Crown,
    Bot,
    Star,
    TrendingUp,
    Bell
} from 'lucide-react'
import { AIChatWidget } from '../components/AIChatWidget'

const features = [
    {
        icon: MessageSquare,
        title: 'Atención 24/7 por WhatsApp',
        description: 'No más dueños en visto. Responde al instante dudas de consultas y agenda citas médicas en piloto automático.',
    },
    {
        icon: Activity,
        title: 'Gestión de Salud Preventiva',
        description: 'Reconoce mascotas a punto de caducar sus vacunas y actívalas de nuevo sin esfuerzo de tu equipo.',
    },
    {
        icon: Calendar,
        title: 'Agenda Veterinaria Inteligente',
        description: 'Reduce el ausentismo controlando y recordando citas con IA. Más productividad para tus veterinarios y técnicos.',
    },
    {
        icon: BarChart3,
        title: 'Radiografía Médica y Financiera',
        description: 'Mide, proyecta y protege el flujo de caja de tu centro veterinario. Toma decisiones de crecimiento con datos reales.',
    },
]

const plans = [
    {
        id: 'essence',
        name: 'Plan Essence',
        tagline: 'Ideal para Veterinarios Independientes a Domicilio y Clinicas Pequeñas.',
        price: 99,
        period: '/mes',
        description: 'Lo necesario para gestionar los prospectos, pacientes y reservas con IA.',
        highlight: false,
        icon: Sparkles,
        features: [
            'Hasta 2 Usuarios',
            'Agente de IA especializado en rubro veterinario',
            'Integración con Google Maps (Reservas geolocalizadas)',
            'Hasta 50 citas automatizadas mensuales',
            'Hasta 1 agenda disponible',
            'Gestión de servicios',
            'Fichas clínicas + historial médico animal',
            'Dashboard con Métricas (Ranking, Conversión, etc.)',
            'Integración oficial de WhatsApp (Meta). Libre de bloqueos',
        ],
        cta: 'Agendar Implementación',
        gradient: 'from-gray-500 to-gray-700',
    },
    {
        id: 'radiance',
        name: 'Plan Radiance',
        tagline: 'Para clínicas en pleno crecimiento (Móviles o físicas).',
        price: 159,
        period: '/mes',
        description: 'La solución completa para captar, retener por salud y automatizar tu clínica veterinaria.',
        highlight: true,
        icon: Zap,
        features: [
            'Todo lo de Essence, más:',
            'Hasta 5 usuarios (Adm, Prof, Recepcionista)',
            '5 agendas independientes disponibles',
            'Recordatorios de vacunas/desparasitación IA',
            'Recordatorios confirmación (Hasta 50/mes)',
            'CRM de ventas para prospectos',
            'Campañas Marketing masivo (WhatsApp)',
            'Sistema Inteligente de Referidos con IA',
            'Módulo de Gestión Financiera',
            'Citas Ilimitadas',
            'Encuestas de satisfacción personalizadas',
        ],
        cta: 'Agendar Implementación',
        gradient: 'from-primary-500 to-primary-700',
        badge: 'Popular',
    },
    {
        id: 'prestige',
        name: 'Prestige',
        tagline: 'Top de línea para redes veterinarias',
        price: 299,
        period: '/mes',
        description: 'Infraestructura empresarial absoluta para controlar y escalar múltiples sedes.',
        highlight: false,
        icon: Crown,
        features: [
            'Todo lo de Radiance, más:',
            'Usuarios ilimitados',
            'Multi-sucursal / Multi-hospital',
            'IA personalizada (especialidades)',
            'Recordatorios confirmación ilimitados',
            'Benchmark entre sedes. Super Administrador',
        ],
        cta: 'Agendar Implementación',
        gradient: 'from-charcoal to-charcoal/90',
    },
]

type CurrencyCode = 'USD' | 'CLP' | 'COP' | 'MXN' | 'EUR';
const exchangeRates: Record<CurrencyCode, { rate: number, symbol: string, label: string }> = {
    USD: { rate: 1, symbol: 'US$', label: 'USD (Dólares)' },
    CLP: { rate: 939.4, symbol: '$', label: 'CLP (Pesos Chilenos)' },
    COP: { rate: 4200, symbol: '$', label: 'COP (Pesos Colombianos)' },
    MXN: { rate: 18, symbol: '$', label: 'MXN (Pesos Mexicanos)' },
    EUR: { rate: 0.92, symbol: '€', label: 'EUR (Euros)' },
};

export default function Landing() {
    const [currency, setCurrency] = useState<CurrencyCode>('USD');

    return (
        <div className="min-h-screen bg-ivory font-sans selection:bg-primary-200 overflow-hidden">
            <style>{`
                @keyframes float-x {
                    0%, 100% { transform: translateX(0px); }
                    50% { transform: translateX(40px); }
                }
                @keyframes float-x-reverse {
                    0%, 100% { transform: translateX(0px); }
                    50% { transform: translateX(-40px); }
                }
                @keyframes float-y {
                    0%, 100% { transform: translateY(0px); }
                    50% { transform: translateY(-20px); }
                }
                @keyframes float-diagonal {
                    0%, 100% { transform: translate(0px, 0px) rotate(0deg); }
                    50% { transform: translate(20px, -20px) rotate(5deg); }
                }
                .animate-float-x { animation: float-x 12s ease-in-out infinite; }
                .animate-float-x-reverse { animation: float-x-reverse 15s ease-in-out infinite; }
                .animate-float-y { animation: float-y 8s ease-in-out infinite; }
                .animate-float-diagonal { animation: float-diagonal 10s ease-in-out infinite; }
                
                @keyframes chat-message {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .animate-chat-1 { animation: chat-message 0.6s ease-out forwards; animation-delay: 1s; opacity: 0; }
                .animate-chat-2 { animation: chat-message 0.6s ease-out forwards; animation-delay: 3.5s; opacity: 0; }
                .animate-chat-3 { animation: chat-message 0.6s ease-out forwards; animation-delay: 6s; opacity: 0; }
                .animate-chat-4 { animation: chat-message 0.6s ease-out forwards; animation-delay: 8.5s; opacity: 0; }
            `}</style>

            {/* Navigation */}
            <nav className="fixed top-0 left-0 right-0 bg-white/90 backdrop-blur-md border-b border-silk-beige z-50">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center justify-between h-16">
                        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-charcoal rounded-soft flex items-center justify-center shadow-lg">
                                <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-primary-300" />
                            </div>
                            <span className="text-lg sm:text-xl font-extrabold tracking-tight text-charcoal whitespace-nowrap">Vetly AI</span>
                        </div>

                        <div className="hidden md:flex items-center gap-8 text-sm font-bold">
                            <a href="#problema" className="text-charcoal/80 hover:text-primary-600 transition-colors">El Problema</a>
                            <a href="#modulos" className="text-charcoal/80 hover:text-primary-600 transition-colors">Módulos</a>
                            <a href="#pricing" className="text-charcoal/80 hover:text-primary-600 transition-colors">Planes</a>
                        </div>

                        <div className="flex flex-col-reverse sm:flex-row items-center gap-1 sm:gap-4">
                            <Link to="/login" className="text-[11px] sm:text-sm font-bold text-charcoal/60 hover:text-primary-600 transition-colors whitespace-nowrap">
                                Iniciar Sesión
                            </Link>
                            <Link to="/register" className="btn-primary px-4 py-2 sm:px-5 sm:py-2.5 text-[13px] sm:text-sm shadow-xl shadow-primary-500/20 hover:scale-105 transition-all text-center whitespace-nowrap">
                                <span className="hidden sm:inline">Agendar Implementación</span>
                                <span className="sm:hidden">Agendar Asesoría Gratis</span>
                            </Link>
                        </div>
                    </div>
                </div>
            </nav>

            {/* 1. Hero Section */}
            <section className="relative pt-32 pb-20 px-4 sm:px-6 lg:px-8 overflow-hidden">
                <div className="absolute inset-0 bg-hero-gradient opacity-[0.03]"></div>

                <div className="max-w-5xl mx-auto text-center relative z-10">
                    <div className="inline-flex items-center gap-2 bg-charcoal text-white px-5 py-2 rounded-full text-xs font-bold uppercase tracking-wider mb-8 shadow-2xl animate-float-y">
                        <Sparkles className="w-3.5 h-3.5 text-primary-300" />
                        Software 2.0 para Veterinarias y Hospitales
                    </div>

                    <h1 className="text-5xl sm:text-6xl md:text-7xl font-extrabold text-charcoal tracking-tight mb-8 leading-[1.1]">
                        <span>¿Cuánto dinero está <span className="text-transparent bg-clip-text bg-gradient-to-r from-yellow-500 to-amber-500">perdiendo</span> tu veterinaria cada mes sin saberlo?</span>
                    </h1>

                    <p className="text-xl sm:text-2xl text-charcoal/80 mb-10 max-w-3xl mx-auto leading-relaxed font-medium">
                        Vetly AI centraliza CRM, agenda, historias clínicas y ejecuta decisiones inteligentes automáticamente para <strong>evitar la pérdida de ingresos mensuales</strong> en tu centro veterinario.
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                        <Link to="/register" className="w-full sm:w-auto btn-primary px-6 py-3 sm:px-8 sm:py-4 text-base sm:text-lg font-bold flex items-center justify-center gap-2 shadow-2xl shadow-primary-500/30 hover:-translate-y-1 transition-all group text-center">
                            Agendar Implementación Gratis
                            <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5 group-hover:translate-x-1 transition-transform flex-shrink-0" />
                        </Link>
                        <button className="w-full sm:w-auto btn-ghost px-6 py-3 sm:px-8 sm:py-4 text-base sm:text-lg font-bold flex items-center justify-center gap-2 border-2 border-silk-beige bg-white hover:bg-gray-50 hover:shadow-lg transition-all text-charcoal/80">
                            <Play className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" />
                            Ver Cómo Funciona
                        </button>
                    </div>
                    <p className="mt-8 text-sm text-charcoal/60 font-bold tracking-wide">Instalación guiada • Soporte VIP • ROI Garantizado</p>
                </div>
            </section>

            {/* 2. El Problema Real (Ingresos invisibles) */}
            <section id="problema" className="py-24 px-4 sm:px-6 lg:px-8 bg-white border-y border-silk-beige">
                <div className="max-w-7xl mx-auto">
                    <div className="grid lg:grid-cols-2 gap-16 items-center">
                        <div className="space-y-6">
                            <h2 className="text-4xl font-extrabold tracking-tight text-charcoal">La cruel verdad sobre el rubro veterinario</h2>
                            <p className="text-xl text-charcoal/80 leading-relaxed font-medium">
                                Constantemente inviertes en equipo médico y farmacia, pero el dinero real se escapa en la operatividad diaria.
                            </p>
                            <ul className="space-y-5 mt-8">
                                {[
                                    'Mascotas con vacunas o desparasitaciones vencidas que no agendan su refuerzo.',
                                    'Box de atención vacíos e instrumental inactivo por cancelaciones de última hora.',
                                    'Tutores preocupados que se enfrían por no recibir respuesta en < 5 minutos.',
                                    'Planes de salud sugeridos que nunca tienen un seguimiento estructurado por falta de tiempo.'
                                ].map((item, i) => (
                                    <li key={i} className="flex items-start gap-4">
                                        <div className="mt-1 bg-red-100 p-1.5 rounded-full shadow-sm"><XIcon className="w-5 h-5 text-red-600" /></div>
                                        <span className="text-lg text-charcoal/90 font-medium leading-relaxed">{item}</span>
                                    </li>
                                ))}
                            </ul>
                            <div className="p-6 bg-red-50 border-2 border-red-200 rounded-xl mt-8 shadow-inner">
                                <p className="font-extrabold text-red-800 text-lg">
                                    El resultado: <span className="underline decoration-red-400 decoration-4 underline-offset-4">Ingresos invisibles que se pierden cada mes.</span>
                                </p>
                            </div>
                        </div>

                        {/* Interactive Abstract Visual */}
                        <div className="relative min-h-[480px] lg:h-[480px] bg-charcoal rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.3)] p-6 sm:p-8 overflow-hidden flex flex-col justify-between hover:scale-[1.02] transition-transform duration-500">
                            <div className="absolute top-0 right-0 w-64 h-64 bg-primary-500 rounded-full mix-blend-screen filter blur-[80px] opacity-30 animate-pulse"></div>
                            <div className="absolute bottom-0 left-0 w-64 h-64 bg-red-500 rounded-full mix-blend-screen filter blur-[80px] opacity-20 animate-pulse" style={{ animationDelay: '2s' }}></div>

                            <h3 className="text-xl sm:text-2xl font-bold text-white z-10 flex items-center gap-2 mb-6 lg:mb-0">
                                <TrendingUp className="text-red-400" /> Fuga Financiera Mensual
                            </h3>

                            <div className="space-y-4 sm:space-y-6 z-10">
                                <div className="bg-white/10 border border-white/20 rounded-xl p-5 backdrop-blur-md transform hover:translate-x-2 transition-transform shadow-lg">
                                    <div className="flex justify-between items-center text-sm font-bold text-white/90 mb-2">
                                        <span>Pacientes inactivos (Vacunas venci.)</span>
                                        <span className="text-red-300 bg-red-500/20 px-3 py-1 rounded-full border border-red-500/30">28 mascotas</span>
                                    </div>
                                    <div className="text-4xl font-extrabold text-white tracking-tight">-$4,200 <span className="text-lg font-medium text-white/60">USD/mes</span></div>
                                </div>

                                <div className="bg-white/10 border border-white/20 rounded-xl p-5 backdrop-blur-md transform hover:translate-x-2 transition-transform shadow-lg delay-100">
                                    <div className="flex justify-between items-center text-sm font-bold text-white/90 mb-2">
                                        <span>Horas muertas por No-Shows</span>
                                        <span className="text-red-300 bg-red-500/20 px-3 py-1 rounded-full border border-red-500/30">15 horas/mes</span>
                                    </div>
                                    <div className="text-4xl font-extrabold text-white tracking-tight">-$1,500 <span className="text-lg font-medium text-white/60">USD/mes</span></div>
                                </div>

                                <div className="pt-6 border-t border-white/20">
                                    <div className="flex justify-between items-center">
                                        <span className="text-white text-xl font-bold">Pérdida Total Estimada:</span>
                                        <span className="text-red-400 text-3xl font-extrabold drop-shadow-[0_0_15px_rgba(248,113,113,0.5)]">-$5,700 USD/mes</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* 3. Agente GPT-4o con WhatsApp Mockup y Contexto Estético */}
            <section className="py-24 px-4 sm:px-6 lg:px-8 bg-subtle-gradient overflow-hidden relative">
                {/* Decorative background elements */}
                <div className="absolute top-20 right-10 w-32 h-32 bg-primary-200/50 rounded-full blur-3xl"></div>
                <div className="absolute bottom-20 left-10 w-40 h-40 bg-accent-200/50 rounded-full blur-3xl"></div>

                <div className="max-w-7xl mx-auto relative z-10">
                    <div className="grid lg:grid-cols-2 gap-16 items-center mb-16">
                        <div className="order-2 lg:order-1">
                            <div className="inline-flex items-center gap-2 bg-white border border-primary-200 px-4 py-1.5 rounded-full text-xs font-bold text-primary-600 uppercase tracking-wider mb-6 shadow-sm">
                                <Bot className="w-4 h-4" /> Inteligencia Conversacional
                            </div>
                            <h2 className="text-4xl lg:text-5xl font-extrabold tracking-tight text-charcoal mb-6 leading-tight">
                                Nunca más pierdas un tutor por responder tarde.
                            </h2>
                            <p className="text-xl text-charcoal/80 mb-8 leading-relaxed font-medium">
                                En medicina veterinaria, <strong>la clínica que responde primero es la que agenda</strong>. Vetly integra un agente conversacional nativo impulsado por GPT-4o, entrenado con protocolos veterinarios para responder con amabilidad, vender consultas y manejar urgencias iniciales.
                            </p>

                            <div className="bg-white p-6 rounded-2xl shadow-lg border border-silk-beige mb-8 relative overflow-hidden group hover:border-primary-300 transition-colors">
                                <div className="absolute right-0 top-0 w-32 h-full bg-gradient-to-l from-primary-50 to-transparent opacity-50"></div>
                                <h3 className="font-bold text-charcoal text-lg mb-2 flex items-center gap-2">
                                    <Star className="w-5 h-5 text-primary-500 fill-primary-500" /> Especializado en Veterinaria
                                </h3>
                                <p className="text-charcoal/80 font-medium">Nuestro Bot entiende la diferencia entre una Octuple, Sextuple, Antirrábica y Desparasitación Interna. Conoce los síntomas de alerta y sabe cómo guiar al tutor hacia la consulta presencial.</p>
                            </div>

                            <div className="space-y-6">
                                {[
                                    { title: 'Velocidad Absoluta 24/7', text: 'Responde dudas de precios en 2 segundos, incluso de madrugada y fines de semana.' },
                                    { title: 'Agenda Directa en Tiempo Real', text: 'El agente revisa la disponibilidad y reserva las horas directamente en el calendario de tus doctores o cabinas.' },
                                    { title: 'Soporte Human-in-the-loop', text: 'Escala a tu equipo de recepción inmediatamente cuando detecta una duda médica compleja.' }
                                ].map((b, i) => (
                                    <div key={i} className="flex gap-4 items-start">
                                        <div className="mt-1 w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0 text-primary-600 shadow-sm"><CheckCircle2 className="w-5 h-5" /></div>
                                        <div>
                                            <h4 className="font-bold text-charcoal text-lg">{b.title}</h4>
                                            <p className="text-charcoal/70 mt-1 leading-relaxed font-medium">{b.text}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Mockup WhatsApp + Image Decoration */}
                        <div className="order-1 lg:order-2 relative flex justify-center lg:justify-end items-center">
                            <div className="bg-[#E5DDD5] rounded-[2.5rem] p-3 shadow-[0_25px_60px_rgba(0,0,0,0.2)] w-full max-w-md lg:max-w-lg border-[8px] border-white relative z-20 transform hover:scale-[1.02] transition-transform duration-500">
                                {/* Header WhatsApp */}
                                <div className="bg-[#075E54] absolute top-0 left-0 right-0 h-[5.5rem] flex items-center px-6 z-10 shadow-md rounded-t-[2rem]">
                                    <div className="w-14 h-14 bg-white border-2 border-[#128C7E] rounded-full flex items-center justify-center text-primary-600 mr-4 shadow-inner overflow-hidden">
                                        <img src="https://images.unsplash.com/photo-1576201836106-db1758fd1c97?auto=format&fit=crop&w=100&q=80" alt="Clinic Avatar" className="w-full h-full object-cover" />
                                    </div>
                                    <div>
                                        <p className="text-white font-bold leading-tight text-xl drop-shadow-sm">Veterinaria Animals</p>
                                        <p className="text-white/90 text-sm flex items-center gap-1.5 font-medium mt-0.5">
                                            <span className="relative flex h-2.5 w-2.5">
                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400"></span>
                                            </span>
                                            Escribiendo...
                                        </p>
                                    </div>
                                </div>

                                {/* Chat Flow */}
                                <div className="pt-28 pb-6 px-4 space-y-5 text-[16px] relative z-0 flex flex-col h-[520px] overflow-hidden rounded-b-[2rem] bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] bg-cover">
                                    <div className="bg-white rounded-2xl rounded-tl-none p-4 shadow-md max-w-[85%] border border-gray-100 animate-chat-1">
                                        <p className="text-charcoal leading-snug font-medium">¡Hola! Vi su publicación. Quiero saber el precio de la vacuna Octuple para mi perrito 🐶</p>
                                        <p className="text-[11px] text-gray-500 text-right mt-1.5 font-bold">10:02 AM</p>
                                    </div>
                                    <div className="bg-[#DCF8C6] rounded-2xl rounded-tr-none p-4 shadow-md max-w-[85%] ml-auto border border-green-100 animate-chat-2">
                                        <p className="text-charcoal leading-snug font-medium">¡Hola! Qué gusto saludarte 🐶. La vacuna Octuple tiene un valor de $20. Es fundamental para protegerlo contra enfermedades graves.</p>
                                        <p className="text-[11px] text-green-700 text-right mt-1.5 font-bold">10:02 AM ✓✓</p>
                                    </div>
                                    <div className="bg-[#DCF8C6] rounded-2xl rounded-tr-none p-4 shadow-md max-w-[85%] ml-auto border border-green-100 animate-chat-3">
                                        <p className="text-charcoal leading-snug font-medium">Para esta semana nos quedan cupos mañana jueves a las 11:00 AM o el viernes a las 4:30 PM. ¿Alguna te acomoda para agendar la visita? 📅</p>
                                        <p className="text-[11px] text-green-700 text-right mt-1.5 font-bold">10:02 AM ✓✓</p>
                                    </div>
                                    <div className="bg-white rounded-2xl rounded-tl-none p-4 shadow-md max-w-[85%] border border-gray-100 animate-chat-4">
                                        <p className="text-charcoal leading-snug font-medium">El viernes a las 4:30 me va perfecto, por favor resérvalo!</p>
                                        <p className="text-[11px] text-gray-500 text-right mt-1.5 font-bold">10:03 AM</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="text-center mt-12 relative z-20">
                        <Link to="/register" className="btn-primary px-6 py-3 sm:px-10 sm:py-5 text-base sm:text-xl font-bold shadow-2xl shadow-primary-500/30 hover:-translate-y-2 transition-transform inline-block">
                            Agendar Implementación Gratis
                        </Link>
                    </div>
                </div>
            </section>



            {/* 5. Cómo funciona */}
            <section className="py-24 px-4 sm:px-6 lg:px-8 bg-white border-b border-silk-beige">
                <div className="max-w-7xl mx-auto">
                    <div className="text-center mb-20">
                        <span className="text-primary-600 font-bold uppercase tracking-wider text-sm mb-2 block">Cero esfuerzo manual</span>
                        <h2 className="text-4xl md:text-5xl font-extrabold text-charcoal mb-6">La automatización en 4 pasos</h2>
                        <p className="text-xl text-charcoal/80 font-medium">Infraestructura simple de usar, tecnología predictiva por debajo.</p>
                    </div>

                    <div className="grid md:grid-cols-4 gap-8 relative">
                        {/* Connecting Line (Desktop) */}
                        <div className="hidden md:block absolute top-[28px] left-[10%] right-[10%] h-1 bg-gradient-to-r from-primary-200 via-primary-300 to-primary-200 z-0 rounded-full"></div>

                        {[
                            { step: '1', title: 'Agrupa', desc: 'Centralizamos todos los historiales médicos, fichas y agendamientos en un solo lugar.' },
                            { step: '2', title: 'Analiza', desc: 'La IA procesa tiempos muertos de box, frecuencias de vacunas y desparasitaciones pendientes.' },
                            { step: '3', title: 'Notifica', desc: 'Identifica mascotas con controles de salud próximos y genera avisos automáticos.' },
                            { step: '4', title: 'Fideliza', desc: 'Mejora la atención y el cumplimiento médico, asegurando que ninguna mascota pierda su control.' }
                        ].map((s, i) => (
                            <div key={i} className="relative z-10 flex flex-col items-center text-center group">
                                <div className="w-16 h-16 bg-white border-4 border-silk-beige rounded-full flex items-center justify-center font-extrabold text-2xl text-charcoal mb-6 shadow-lg group-hover:scale-110 group-hover:border-primary-400 group-hover:bg-primary-50 transition-all duration-300 relative">
                                    {s.step}
                                </div>
                                <h3 className="text-2xl font-extrabold text-charcoal mb-4 group-hover:text-primary-600 transition-colors">{s.title}</h3>
                                <p className="text-charcoal/80 font-medium leading-relaxed bg-gray-50 p-6 rounded-2xl border border-gray-100 shadow-sm flex-grow group-hover:shadow-md transition-shadow">{s.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* 6. Módulos - ECOSISTEMA CON FONDO DORADO GRADIENTE Y DINAMISMO */}
            <section id="modulos" className="relative py-32 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-yellow-50 via-yellow-100 to-amber-100 border-y border-yellow-200 overflow-hidden">
                {/* Floating animated background icons - Electric Blue Robots */}
                <div className="absolute top-20 left-10 text-blue-500/20 animate-float-diagonal">
                    <Bot className="w-32 h-32" />
                </div>
                <div className="absolute bottom-20 right-10 text-blue-600/10 animate-float-x-reverse">
                    <Bot className="w-40 h-40" />
                </div>
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-cyan-500/10 animate-float-x">
                    <Bot className="w-96 h-96" />
                </div>

                <div className="max-w-7xl mx-auto relative z-10">
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
                        <div className="lg:col-span-3 text-center mb-16">
                            <span className="inline-block px-4 py-1.5 bg-yellow-200 text-yellow-800 font-bold text-sm uppercase tracking-widest rounded-full mb-6 shadow-sm border border-yellow-300">
                                Todo en un solo lugar
                            </span>
                            <h2 className="text-5xl md:text-6xl font-extrabold text-charcoal tracking-tight drop-shadow-sm">
                                Ecosistema Completo
                            </h2>
                        </div>

                        {features.map((f, i) => (
                            <div key={i} className="bg-white/95 backdrop-blur-xl p-8 rounded-3xl shadow-xl hover:shadow-2xl border border-white hover:border-yellow-300 hover:-translate-y-3 transition-all duration-300 group flex flex-col">
                                <div className="w-14 h-14 bg-gradient-to-br from-yellow-100 to-amber-200 rounded-2xl flex items-center justify-center mb-6 shadow-md group-hover:scale-110 transition-transform">
                                    <f.icon className="w-7 h-7 text-yellow-700" />
                                </div>
                                <h4 className="font-extrabold text-xl text-charcoal mb-3">{f.title}</h4>
                                <p className="text-charcoal/90 font-medium leading-relaxed flex-grow">{f.description}</p>
                            </div>
                        ))}

                        {/* Add CRM + Campaigns */}
                        <div className="bg-white/95 backdrop-blur-xl p-8 rounded-3xl shadow-xl hover:shadow-2xl border border-white hover:border-yellow-300 hover:-translate-y-3 transition-all duration-300 group flex flex-col">
                            <div className="w-14 h-14 bg-gradient-to-br from-yellow-100 to-amber-200 rounded-2xl flex items-center justify-center mb-6 shadow-md group-hover:scale-110 transition-transform"><Users className="w-7 h-7 text-yellow-700" /></div>
                            <h4 className="font-extrabold text-xl text-charcoal mb-3">CRM de Tutores</h4>
                            <p className="text-charcoal/90 font-medium leading-relaxed flex-grow">Embudos visuales para organizar el viaje de tu paciente animal desde la primera vacuna hasta controles anuales.</p>
                        </div>
                        <div className="bg-white/95 backdrop-blur-xl p-8 rounded-3xl shadow-xl hover:shadow-2xl border border-white hover:border-yellow-300 hover:-translate-y-3 transition-all duration-300 group flex flex-col">
                            <div className="w-14 h-14 bg-gradient-to-br from-yellow-100 to-amber-200 rounded-2xl flex items-center justify-center mb-6 shadow-md group-hover:scale-110 transition-transform"><MessageSquare className="w-7 h-7 text-yellow-700" /></div>
                            <h4 className="font-extrabold text-xl text-charcoal mb-3">Campañas Preventivas</h4>
                            <p className="text-charcoal/90 font-medium leading-relaxed flex-grow">Plataforma nativa para disparos de salud (Ej. Mes de la rabia) aprobada por Meta vía WhatsApp Oficial.</p>
                        </div>
                    </div>
                </div>
            </section>

            {/* Recordatorios Automáticos Section */}
            <section className="relative py-24 bg-gradient-to-b from-blue-50/50 to-white overflow-hidden border-b border-silk-beige">
                <div className="absolute inset-0 bg-blue-500/5 [mask-image:radial-gradient(ellipse_at_center,white,transparent)]"></div>
                <div className="max-w-6xl mx-auto px-4 sm:px-6 relative z-10 flex flex-col md:flex-row items-center gap-16">
                    <div className="flex-1 text-center md:text-left">
                        <span className="inline-flex items-center gap-2 px-4 py-1.5 bg-blue-100 text-blue-700 font-bold text-sm uppercase tracking-widest rounded-full mb-6">
                            <Bell className="w-4 h-4" />
                            Alta Valoración
                        </span>
                        <h2 className="text-4xl md:text-5xl font-extrabold text-charcoal tracking-tight mb-6">
                            Recordatorios Médicos por IA
                        </h2>
                        <p className="text-xl text-charcoal/80 font-medium leading-relaxed mb-8">
                            Nuestros usuarios lo aman. El bot de WhatsApp confirma, reprograma y recuerda a tus tutores de sus citas médicas horas previas.
                            <strong> Elimina hasta el 90% de los no-shows</strong> (inasistencias) y libera a tu equipo de recepción de tareas repetitivas.
                        </p>
                        <ul className="space-y-4 text-left inline-block md:block font-bold text-charcoal/90">
                            <li className="flex items-center gap-3"><CheckCircle2 className="text-green-500 w-5 h-5 flex-shrink-0" /> Confirmación inmediata tras agendar</li>
                            <li className="flex items-center gap-3"><CheckCircle2 className="text-green-500 w-5 h-5 flex-shrink-0" /> Recordatorios programables 24h y 2h antes</li>
                            <li className="flex items-center gap-3"><CheckCircle2 className="text-green-500 w-5 h-5 flex-shrink-0" /> Sugerencia de nuevas horas en caso de re-agenda</li>
                        </ul>
                    </div>
                    <div className="flex-1 relative">
                        <div className="absolute inset-0 bg-blue-400/20 blur-3xl rounded-full animate-pulse"></div>
                        <div className="bg-white p-6 rounded-[2rem] shadow-2xl border-4 border-blue-50 relative z-10 transform md:rotate-2 hover:rotate-0 transition-all duration-500 max-w-sm mx-auto">
                            <div className="flex items-center gap-4 mb-4 pb-4 border-b border-gray-100">
                                <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center p-2"><Bell className="w-full h-full" /></div>
                                <div>
                                    <p className="font-extrabold text-gray-800">Vacuna Mañana</p>
                                    <p className="text-sm font-medium text-gray-500">Octuple Canina</p>
                                </div>
                            </div>
                            <div className="space-y-3">
                                <div className="bg-blue-50 text-blue-900 p-4 rounded-xl rounded-tl-none font-medium text-[15px] border border-blue-100">
                                    Hola! 🐾 Te recordamos que "Luna" tiene su vacuna mañana a las 15:30. Por favor responda SI para confirmar o NO para reagendar.
                                </div>
                                <div className="bg-green-500 text-white p-4 rounded-xl rounded-tr-none font-bold text-[15px] ml-auto w-max px-6">
                                    SI
                                </div>
                                <div className="bg-blue-50 text-blue-900 p-4 rounded-xl rounded-tl-none font-medium text-[15px] border border-blue-100">
                                    ¡Genial! Tu cita ha sido confirmada en el sistema ✅ ¡Te esperamos!
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Diferenciación rápida */}
            <section className="py-24 bg-white">
                <div className="max-w-5xl mx-auto px-4 text-center">
                    <h3 className="text-4xl font-extrabold text-charcoal mb-16 tracking-tight">El Nuevo Estándar Operativo Veterinario</h3>
                    <div className="flex flex-col md:flex-row gap-8 justify-center items-stretch relative">

                        <div className="p-10 bg-gray-50 rounded-[2.5rem] flex-1 border-2 border-gray-100 opacity-80 shadow-inner">
                            <p className="font-extrabold text-charcoal/50 uppercase text-sm mb-6 tracking-widest bg-gray-200 inline-block px-4 py-1.5 rounded-full">Software Tradicional</p>
                            <p className="text-2xl text-charcoal line-through decoration-gray-400 mb-6 font-bold">Solo guarda fichas e información estática.</p>
                            <p className="text-base text-charcoal/80 font-medium leading-relaxed">Requiere decenas de horas manuales, no analiza tu medicina preventiva, y todos los seguimientos críticos por WhatsApp los debes hacer tú a mano perdiendo cientos de tutores.</p>
                        </div>

                        <div className="text-charcoal/20 flex flex-col items-center justify-center absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10 bg-white p-4 rounded-full shadow-lg hidden md:flex">
                            <span className="font-black text-2xl text-charcoal/40">VS</span>
                        </div>

                        <div className="p-10 bg-charcoal text-white rounded-[2.5rem] flex-1 shadow-[0_20px_50px_rgba(0,0,0,0.4)] relative overflow-hidden transform md:scale-105 border border-primary-500/30">
                            <div className="absolute inset-0 bg-hero-gradient opacity-20"></div>
                            <p className="font-extrabold text-primary-300 uppercase text-sm mb-6 tracking-widest bg-white/10 inline-block px-4 py-1.5 rounded-full relative z-10 border border-white/20">Vetly AI (Software 2.0)</p>
                            <p className="text-2xl relative z-10 mb-6 font-extrabold leading-tight">Protege, acciona y maximiza la salud animal totalmente en automático.</p>
                            <p className="text-base text-white/90 relative z-10 font-medium leading-relaxed">Detecta oportunidades de salud donde a ti se te escapan, agenda sin tu intervención 24/7, y activa tutores de pacientes crónicos sin que tengas que mirar la pantalla.</p>
                        </div>
                    </div>
                </div>
            </section>

            {/* PRECIOS - Ahora integrados en la Landing */}
            <section id="pricing" className="py-32 px-4 sm:px-6 lg:px-8 bg-ivory border-t border-silk-beige relative">
                {/* Decoration */}
                <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-b from-white to-transparent"></div>

                <div className="max-w-7xl mx-auto relative z-10">
                    <div className="text-center mb-16">
                        <span className="text-primary-600 font-bold uppercase tracking-wider text-sm mb-3 block">Planes Transparentes</span>
                        <h2 className="text-4xl md:text-5xl font-extrabold text-charcoal mb-6">Invierte en Inteligencia Médica, NO en gastos operativos</h2>
                        <p className="text-xl text-charcoal/80 font-medium max-w-3xl mx-auto mb-10">Selecciona la capacidad del motor inteligente que se adapte al volumen actual de tu veterinaria u hospital.</p>

                        {/* Currency Selector */}
                        <div className="inline-flex items-center gap-3 bg-white px-5 py-2.5 rounded-2xl shadow-sm border-2 border-primary-100 hover:border-primary-300 transition-colors">
                            <label htmlFor="currency" className="text-sm font-bold text-charcoal">Moneda local:</label>
                            <select
                                id="currency"
                                value={currency}
                                onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                                className="bg-transparent text-primary-600 font-extrabold outline-none border-none focus:ring-0 cursor-pointer text-base"
                            >
                                {Object.entries(exchangeRates).map(([code, data]) => (
                                    <option key={code} value={code} className="font-medium text-charcoal">{data.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="grid md:grid-cols-3 gap-8 items-stretch pt-4">
                        {plans.map((plan) => (
                            <div
                                key={plan.id}
                                className={`relative rounded-[2.5rem] p-10 border-2 flex flex-col h-full bg-white transition-all duration-300 ${plan.highlight
                                    ? 'border-primary-400 shadow-[0_30px_60px_rgba(var(--color-primary-500),0.15)] transform md:-translate-y-6 md:scale-105 z-10'
                                    : 'border-silk-beige shadow-lg hover:shadow-xl hover:-translate-y-2'
                                    }`}
                            >
                                {plan.highlight && (
                                    <div className="absolute -top-5 left-1/2 transform -translate-x-1/2 bg-gradient-to-r from-primary-400 to-accent-500 text-white font-extrabold px-6 py-2 rounded-full uppercase tracking-widest shadow-lg border-2 border-white z-20 whitespace-nowrap">
                                        {plan.badge}
                                    </div>
                                )}

                                <div className="mb-6 h-12 flex items-center">
                                    <h3 className="text-3xl font-black text-charcoal">{plan.name}</h3>
                                </div>
                                <p className="text-base font-bold text-charcoal/70 mb-8 h-12 pr-4">{plan.tagline}</p>

                                <div className="mb-8 p-6 bg-ivory/50 rounded-2xl border border-silk-beige/50">
                                    <div className="flex items-baseline">
                                        <span className={`font-black text-charcoal ${currency === 'COP' || currency === 'CLP' ? 'text-4xl' : 'text-5xl'}`}>
                                            {exchangeRates[currency].symbol}{Math.round(plan.price * exchangeRates[currency].rate).toLocaleString('es-CL')}
                                        </span>
                                        <span className="text-charcoal/60 font-bold ml-1 text-lg">{plan.period}</span>
                                    </div>
                                </div>

                                <p className="text-base text-charcoal/90 font-medium mb-8 pb-8 border-b border-silk-beige border-dashed">{plan.description}</p>

                                <ul className="space-y-4 mb-12 flex-grow">
                                    {plan.features.map((feature, index) => (
                                        <li key={index} className="flex items-start gap-4">
                                            <div className={`mt-0.5 rounded-full p-1 flex-shrink-0 ${plan.highlight ? 'bg-primary-100 text-primary-600' : 'bg-gray-100 text-charcoal/60'}`}>
                                                <Check className="w-4 h-4" strokeWidth={4} />
                                            </div>
                                            <span className="text-base font-bold text-charcoal/90 leading-tight pt-0.5">{feature}</span>
                                        </li>
                                    ))}
                                </ul>

                                <Link
                                    to="/register"
                                    className={`w-full block text-center py-5 rounded-2xl font-black text-lg tracking-wide transition-all ${plan.highlight
                                        ? 'bg-charcoal text-white hover:bg-gradient-to-r hover:from-yellow-500 hover:to-amber-600 hover:text-white shadow-[0_10px_20px_rgba(0,0,0,0.2)] hover:shadow-[0_15px_30px_rgba(0,0,0,0.3)] hover:-translate-y-1'
                                        : 'bg-white border-2 border-silk-beige text-charcoal hover:text-white hover:border-transparent hover:bg-gradient-to-r hover:from-yellow-400 hover:to-amber-500 hover:-translate-y-1'
                                        }`}
                                >
                                    {plan.cta}
                                </Link>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* 10. CTA Final Futurista */}
            <section className="py-40 px-4 sm:px-6 lg:px-8 bg-[#0a0f18] relative overflow-hidden text-center text-white border-t border-primary-500/20">
                {/* Futuristic Background Elements */}
                <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10 mix-blend-overlay z-10"></div>

                {/* Grid Lines */}
                <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)]"></div>

                {/* Glowing Orbs */}
                <div className="absolute top-0 right-1/4 w-96 h-96 bg-primary-600/20 rounded-full blur-[120px] mix-blend-screen animate-pulse"></div>
                <div className="absolute bottom-0 left-1/4 w-[500px] h-[500px] bg-blue-600/20 rounded-full blur-[150px] mix-blend-screen" style={{ animation: 'pulse 6s cubic-bezier(0.4, 0, 0.6, 1) infinite' }}></div>

                {/* Scanning Laser Line (subtle) */}
                <div className="absolute left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-cyan-400/50 to-transparent top-1/2 -translate-y-1/2 animate-float-y blur-sm"></div>

                <div className="max-w-4xl mx-auto relative z-20">
                    <span className="inline-block p-4 bg-white/5 rounded-2xl mb-12 backdrop-blur-xl border border-white/10 shadow-[0_0_30px_rgba(255,255,255,0.1)] relative group">
                        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary-400/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                        <Crown className="w-10 h-10 text-primary-400 drop-shadow-[0_0_8px_rgba(var(--color-primary-500),0.5)] relative z-10" />
                    </span>

                    <h2 className="text-5xl md:text-7xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-white/70 mb-8 tracking-tight leading-tight">
                        Las veterinarias más rentables no operan por intuición.
                    </h2>
                    <h2 className="text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-primary-300 to-amber-400 mb-12 tracking-tight italic drop-shadow-[0_0_15px_rgba(var(--color-primary-500),0.3)]">
                        Operan con inteligencia.
                    </h2>

                    <p className="text-lg sm:text-2xl text-blue-100/70 mb-16 max-w-3xl mx-auto font-medium leading-relaxed">
                        La agenda está abierta. Reserva una sesión exploratoria de 30 minutos: analizaremos tu flujo actual y te mostraremos, con números reales, cuánto revenue podrías rescatar este mes.
                    </p>

                    <div className="flex flex-col sm:flex-row justify-center items-center gap-6 relative">
                        {/* Glow Behind Button */}
                        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-64 h-24 bg-primary-500/30 blur-[40px] rounded-full z-0"></div>

                        <Link to="/register" className="relative z-10 inline-flex items-center justify-center w-full sm:w-auto bg-white text-charcoal px-8 py-4 sm:px-12 sm:py-6 rounded-2xl font-black text-lg sm:text-xl shadow-[0_0_40px_rgba(255,255,255,0.2)] hover:shadow-[0_0_60px_rgba(255,255,255,0.4)] transition-all hover:-translate-y-2 hover:bg-gradient-to-r hover:from-white hover:to-primary-50 border border-white/50 text-center">
                            Agendar Implementación Gratuita
                        </Link>
                    </div>
                </div>
            </section>

            {/* Footer Minimalista */}
            <footer className="bg-[#111317] pt-20 pb-10 px-4 sm:px-6 lg:px-8 text-white relative z-20">
                <div className="max-w-7xl mx-auto">
                    <div className="flex flex-col lg:flex-row justify-between items-start gap-12 border-b border-white/10 pb-16 mb-10">
                        <div className="max-w-sm">
                            <div className="flex items-center gap-3 mb-8">
                                <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center border border-white/20">
                                    <Sparkles className="w-6 h-6 text-primary-400" />
                                </div>
                                <span className="font-extrabold text-3xl tracking-tight">Vetly AI</span>
                            </div>
                            <p className="text-white/60 text-base leading-relaxed font-medium mb-8">
                                Infraestructura inteligente 2.0 y medicina preventiva diseñada exclusivamente para escalar clínicas de la industria veterinaria sin sumar costos operativos.
                            </p>
                        </div>

                        <div className="flex flex-wrap gap-16 lg:justify-end flex-grow">
                            <div>
                                <h4 className="font-black mb-6 uppercase tracking-widest text-sm text-white/50">El Sistema</h4>
                                <ul className="space-y-4 text-base font-bold text-white/80">
                                    <li><a href="#retention" className="hover:text-primary-400 transition-colors">Health Retention Engine</a></li>
                                    <li><a href="#modulos" className="hover:text-primary-400 transition-colors">Agente AI Veterinario</a></li>
                                    <li><a href="#modulos" className="hover:text-primary-400 transition-colors">CRM de Tutores</a></li>
                                    <li><a href="#pricing" className="hover:text-primary-400 transition-colors">Planes y Precios</a></li>
                                </ul>
                            </div>
                            <div>
                                <h4 className="font-black mb-6 uppercase tracking-widest text-sm text-white/50">Vetly Inc.</h4>
                                <ul className="space-y-4 text-base font-bold text-white/80">
                                    <li><a href="#" className="hover:text-primary-400 transition-colors">Nuestra Visión</a></li>
                                    <li><a href="#" className="hover:text-primary-400 transition-colors">Casos de Éxito Reales</a></li>
                                    <li><a href="#" className="hover:text-primary-400 transition-colors">Soporte VIP Vets</a></li>
                                    <li><a href="#" className="hover:text-primary-400 transition-colors">Agendar Demo</a></li>
                                </ul>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col md:flex-row justify-between items-center gap-6 text-sm font-bold text-white/40">
                        <p>© 2026 Vetly Inc. Todos los derechos reservados. No publicamos tus datos.</p>
                        <div className="flex gap-8">
                            <a href="#" className="hover:text-white transition-colors">Políticas de Privacidad</a>
                            <a href="#" className="hover:text-white transition-colors">Términos de Servicio</a>
                        </div>
                    </div>
                </div>
            </footer>

            {/* AI Sales Agent Widget */}
            <AIChatWidget variant="sales" />
        </div>
    )
}

function XIcon(props: any) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
        </svg>
    )
}
