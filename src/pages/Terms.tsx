import { Link } from 'react-router-dom';
import { ArrowLeft, Sparkles } from 'lucide-react';

export default function Terms() {
    return (
        <div className="min-h-screen bg-silk-beige font-outfit text-charcoal flex flex-col items-center py-12 px-4 sm:px-6 lg:px-8">
            <div className="w-full max-w-4xl bg-white rounded-3xl shadow-soft p-8 md:p-12 border border-primary-100">

                {/* Header */}
                <div className="flex items-center gap-3 mb-8 pb-8 border-b border-primary-100">
                    <div className="w-12 h-12 bg-hero-gradient rounded-soft flex items-center justify-center">
                        <Sparkles className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary-600 to-primary-800">Vetly AI AI</h1>
                        <p className="text-gray-500 font-medium">Términos y Condiciones de Servicio</p>
                    </div>
                    <div className="ml-auto">
                        <Link to="/" className="flex items-center gap-2 text-primary-600 hover:text-primary-800 font-semibold transition-colors">
                            <ArrowLeft className="w-4 h-4" /> Volver al Inicio
                        </Link>
                    </div>
                </div>

                {/* Content */}
                <div className="prose prose-primary max-w-none text-gray-700">
                    <p className="text-sm text-gray-500 mb-6">Última actualización: Marzo 2026</p>

                    <p className="text-lg leading-relaxed mb-6">
                        Bienvenido a <strong>Vetly AI AI</strong>. Al registrarse, acceder y utilizar nuestra plataforma de Inteligencia Artificial para la gestión y automatización de procesos clínicos, usted ("El Cliente" o "La Clínica") acepta los siguientes Términos y Condiciones.
                    </p>

                    <h2 className="text-xl font-bold text-gray-900 mt-8 mb-4">1. Uso del Servicio y Licencia</h2>
                    <ul className="list-disc pl-6 space-y-2 mb-6">
                        <li><strong>Descripción:</strong> Vetly AI AI proporciona herramientas SaaS (Software as a Service) incluyendo agendamiento, CRM, Finanzas y un Agente Inteligente operando vías WhatsApp.</li>
                        <li><strong>Licencia:</strong> Le otorgamos una licencia no exclusiva, intransferible y revocable para utilizar el Servicio conforme a su plan de suscripción.</li>
                        <li><strong>Uso Responsable:</strong> Usted es responsable de la exactitud de los datos que provee y del uso adecuado que sus agentes y recepcionistas den a las comunicaciones automatizadas con los pacientes.</li>
                    </ul>

                    <h2 className="text-xl font-bold text-gray-900 mt-8 mb-4">2. Pagos, Pruebas y Suscripciones</h2>
                    <ul className="list-disc pl-6 space-y-2 mb-6">
                        <li><strong>Prueba Gratuita (Free Trial):</strong> Al registrarse, puede gozar de un período de prueba de 7 días con acceso parcial o total según nuestro plan promocional. La tarjeta ingresada garantiza la viabilidad de la cuenta, y no será cobrada hasta la expiración de dicho plazo.</li>
                        <li><strong>Facturación Automática:</strong> Las suscripciones (Premium, Prestige, etc.) se renuevan automáticamente de forma mensual o anual según su selección.</li>
                        <li><strong>Cancelaciones:</strong> Podrá cancelar en cualquier momento a través del panel de configuración, cesando cargos futuros. No se realizan reembolsos de períodos ya pagados y en curso.</li>
                    </ul>

                    <h2 className="text-xl font-bold text-gray-900 mt-8 mb-4">3. Provisión de Servicios Externos</h2>
                    <p className="mb-6">
                        Nuestros servicios automatizados de mensajería dependen de proveedores de telecomunicaciones como Ycloud y Meta (WhatsApp Cloud API). Vetly AI AI no es responsable de bloqueos, interrupciones al servicio de Meta, suspensiones de número por envío indebido de spam o fallas exclusivas ajenas a nuestra infraestructura.
                    </p>

                    <h2 className="text-xl font-bold text-gray-900 mt-8 mb-4">4. Privacidad, Confidencialidad y Propiedad Intelectual</h2>
                    <p className="mb-6">
                        Toda la información del paciente se procesa conforme a normativas de protección de datos vigentes y a nuestra <strong>Política de Privacidad</strong> conjunta. Los derechos de nuestro código, logotipos, diseño "Soft Luxury" y manual de marca pertenecen exclusivamente a Vetly AI AI.
                    </p>

                    <h2 className="text-xl font-bold text-gray-900 mt-8 mb-4">5. Limitación de Responsabilidad</h2>
                    <p className="mb-6">
                        En ningún caso Vetly AI, sus directores, empleados o proveedores serán responsables de ningún daño indirecto, incidental o pérdida de ganancias derivados de la interrupción del servicio o consejos erróneos transmitidos por el modelo de Lenguaje de Inteligencia Artificial ("Alucinaciones IA"). El cliente es responsable de auditar los resultados entregados en la bandeja de entrada y establecer directrices en los paneles correspondientes.
                    </p>

                    <h2 className="text-xl font-bold text-gray-900 mt-8 mb-4">6. Jurisdicción y Modificaciones</h2>
                    <p className="mb-6">
                        Nos reservamos el derecho de modificar estos Términos en cualquier momento mediante notificación previa en su Dashboard o correo electrónico. Las controversias se solucionarán por las leyes competentes en el lugar de operación fiscal de Vetly AI, o mediadores acordados por ambas partes.
                    </p>
                </div>

                {/* Footer */}
                <div className="mt-12 pt-8 border-t border-gray-100 flex justify-between items-center text-sm text-gray-500">
                    <p>© {new Date().getFullYear()} Vetly AI AI. Todos los derechos reservados.</p>
                    <Link to="/privacy" className="hover:text-primary-600 transition-colors">Volver a Política de Privacidad</Link>
                </div>

            </div>
        </div>
    );
}
