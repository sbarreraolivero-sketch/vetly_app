import { Link } from 'react-router-dom';
import { ArrowLeft, Sparkles } from 'lucide-react';

export default function Privacy() {
    return (
        <div className="min-h-screen bg-silk-beige font-outfit text-charcoal flex flex-col items-center py-12 px-4 sm:px-6 lg:px-8">
            <div className="w-full max-w-4xl bg-white rounded-3xl shadow-soft p-8 md:p-12 border border-primary-100">

                {/* Header */}
                <div className="flex items-center gap-3 mb-8 pb-8 border-b border-primary-100">
                    <div className="w-12 h-12 bg-hero-gradient rounded-soft flex items-center justify-center">
                        <Sparkles className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary-600 to-primary-800">Vetly AI</h1>
                        <p className="text-gray-500 font-medium">Políticas de Privacidad</p>
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
                        En <strong>Vetly AI</strong>, valoramos su confianza y estamos comprometidos con la protección y el manejo responsable de sus datos personales. Esta Política de Privacidad describe cómo recopilamos, utilizamos y protegemos su información.
                    </p>

                    <h2 className="text-xl font-bold text-gray-900 mt-8 mb-4">1. Información que recopilamos</h2>
                    <ul className="list-disc pl-6 space-y-2 mb-6">
                        <li><strong>Información de la Cuenta:</strong> Nombre, correo electrónico, número de teléfono y nombre de la clínica para configurar su cuenta.</li>
                        <li><strong>Información de Pago:</strong> Procesamos pagos a través de Mercado Pago. Nosotros no almacenamos los datos completos de su tarjeta de crédito.</li>
                        <li><strong>Datos de Pacientes:</strong> En su calidad de usuario ("Clínica"), usted puede subir o conectar datos de sus pacientes (nombres, teléfonos, historial de citas). Actuamos como <em>Procesador de Datos</em> respecto a esta información.</li>
                        <li><strong>Datos de Interacción:</strong> Mensajes y logs generados por el Asistente de IA para entrenamiento y mejora del servicio continuo.</li>
                    </ul>

                    <h2 className="text-xl font-bold text-gray-900 mt-8 mb-4">2. Uso de la Información</h2>
                    <p className="mb-6">Utilizamos la información recopilada para:</p>
                    <ul className="list-disc pl-6 space-y-2 mb-6">
                        <li>Proveer, mantener y mejorar la plataforma Vetly AI y sus Agentes de IA.</li>
                        <li>Procesar transacciones y enviar avisos relacionados (confirmaciones, facturas).</li>
                        <li>Brindar soporte técnico y atención al cliente.</li>
                        <li>Garantizar la seguridad, prevenir fraudes y resolver problemas técnicos.</li>
                    </ul>

                    <h2 className="text-xl font-bold text-gray-900 mt-8 mb-4">3. Inteligencia Artificial y Datos de Pacientes</h2>
                    <p className="mb-6">
                        Las conversaciones generadas entre nuestra Inteligencia Artificial y los pacientes finales son procesadas utilizando proveedores de modelos de lenguaje (Ej. OpenAI). Los datos se utilizan estrictamente para proveer las respuestas durante el chat. No vendemos ni compartimos la lista de pacientes de su clínica con terceros para fines comerciales o publicitarios externos.
                    </p>

                    <h2 className="text-xl font-bold text-gray-900 mt-8 mb-4">4. Seguridad de los Datos</h2>
                    <p className="mb-6">
                        Implementamos medidas de seguridad técnicas y organizativas líderes en la industria (encriptación en tránsito y en reposo mediante nuestra infraestructura en la nube) para mantener su información a salvo de accesos no autorizados, alteraciones o destrucción.
                    </p>

                    <h2 className="text-xl font-bold text-gray-900 mt-8 mb-4">5. Retención y Eliminación</h2>
                    <p className="mb-6">
                        Conservaremos su información mientras su cuenta permanezca activa o según sea necesario para cumplir con obligaciones legales, resolver disputas y hacer cumplir nuestros acuerdos. Usted puede solicitar la eliminación de su cuenta y sus datos vinculados escribiendo a nuestro equipo de soporte.
                    </p>

                    <h2 className="text-xl font-bold text-gray-900 mt-8 mb-4">6. Contacto</h2>
                    <p className="mb-6">
                        Si tiene preguntas sobre esta Política de Privacidad o el manejo de sus datos, por favor contáctenos a: <strong>contacto@Vetly AI.com</strong>
                    </p>
                </div>

                {/* Footer */}
                <div className="mt-12 pt-8 border-t border-gray-100 flex justify-between items-center text-sm text-gray-500">
                    <p>© {new Date().getFullYear()} Vetly AI. Todos los derechos reservados.</p>
                    <Link to="/terms" className="hover:text-primary-600 transition-colors">Ver Términos y Condiciones</Link>
                </div>

            </div>
        </div>
    );
}
