import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Calendar, ShieldCheck, Sparkles, LogOut } from 'lucide-react';
import { HQBookingForm } from '../components/HQBookingForm';

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
export function PendingActivation() {
    const { user, profile, signOut } = useAuth();

    // Redirect if doesn't meet criteria
    if (!user) {
        return <Navigate to="/login" replace />;
    }

    const [activationStatus, setActivationStatus] = useState<string | null>(null);

    useEffect(() => {
        const checkStatus = async () => {
            if (profile?.clinic_id) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { data } = await (supabase as any)
                    .from('clinic_settings')
                    .select('activation_status')
                    .eq('id', profile.clinic_id)
                    .single()

                if (data) {
                    setActivationStatus(data.activation_status)
                }
            }
        }
        checkStatus();
    }, [profile?.clinic_id])

    // If already active, send to app
    if (activationStatus === 'active') {
        return <Navigate to="/app" replace />;
    }

    const handleLogout = async () => {
        await signOut();
        // Use window.location to force a full reload and clear any cached states
        window.location.href = '/login';
    };

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            {/* Header */}
            <header className="bg-white border-b border-gray-200 py-4 px-6 flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-charcoal rounded-lg flex items-center justify-center">
                        <Sparkles className="w-4 h-4 text-primary-400" />
                    </div>
                    <span className="font-extrabold text-xl tracking-tight text-charcoal">Vetly AI</span>
                </div>
                <button
                    onClick={handleLogout}
                    className="text-gray-500 hover:text-gray-800 text-sm font-medium flex items-center gap-2"
                >
                    <LogOut className="w-4 h-4" />
                    Cerrar sesión
                </button>
            </header>

            {/* Main Content */}
            <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-12 flex flex-col lg:flex-row gap-12 items-start">

                {/* Info Column */}
                <div className="flex-1 space-y-8">
                    <div>
                        <div className="inline-flex items-center gap-2 bg-amber-100 text-amber-800 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider mb-6">
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                            </span>
                            Activación Pendiente
                        </div>
                        <h1 className="text-4xl font-black text-charcoal mb-4 leading-tight">
                            Estás a un paso de activar tu Infraestructura Inteligente.
                        </h1>
                        <p className="text-gray-600 text-lg">
                            Tu prueba gratuita de 7 días no comienza hoy. Primero, necesitamos realizar tu <b>Sesión de Activación Estratégica</b> para garantizar que Vetly AI genere resultados desde el día uno.
                        </p>
                    </div>

                    <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm space-y-6">
                        <h3 className="font-bold text-gray-900 border-b border-gray-100 pb-3">¿Qué haremos en esta sesión de 30-45 minutos aprox?</h3>
                        <ul className="space-y-4">
                            <li className="flex gap-4 items-start">
                                <div className="w-8 h-8 rounded-full bg-primary-50 text-primary-600 flex items-center justify-center shrink-0">
                                    <ShieldCheck className="w-4 h-4" />
                                </div>
                                <div>
                                    <h4 className="font-bold text-charcoal">Conexión de tu Base de Datos</h4>
                                    <p className="text-sm text-gray-500 mt-1">Sincronizaremos tus pacientes iniciales para que la IA comience a detectar ingresos en riesgo.</p>
                                </div>
                            </li>
                            <li className="flex gap-4 items-start">
                                <div className="w-8 h-8 rounded-full bg-primary-50 text-primary-600 flex items-center justify-center shrink-0">
                                    <Sparkles className="w-4 h-4" />
                                </div>
                                <div>
                                    <h4 className="font-bold text-charcoal">Configuración de IA</h4>
                                    <p className="text-sm text-gray-500 mt-1">Ajustaremos el tono de tu Agente de Ventas y los protocolos de retención a tu marca real.</p>
                                </div>
                            </li>
                            <li className="flex gap-4 items-start">
                                <div className="w-8 h-8 rounded-full bg-primary-50 text-primary-600 flex items-center justify-center shrink-0">
                                    <Calendar className="w-4 h-4" />
                                </div>
                                <div>
                                    <h4 className="font-bold text-charcoal">Desbloqueo e Inicio de Prueba</h4>
                                    <p className="text-sm text-gray-500 mt-1">Al terminar la llamada, activaremos tu acceso y comenzarán a correr tus 7 días gratuitos.</p>
                                </div>
                            </li>
                        </ul>
                    </div>

                    <div className="pt-8">
                        <p className="text-sm text-gray-500 mb-4 italic">
                            ¿Tienes prisa? También puedes configurar todo tú mismo ahora mismo:
                        </p>
                        <button
                            onClick={async () => {
                                if (profile?.clinic_id) {
                                    const { error } = await (supabase as any)
                                        .from('clinic_settings')
                                        .update({ activation_status: 'active' })
                                        .eq('id', profile.clinic_id);
                                    
                                    if (!error) {
                                        window.location.href = '/app';
                                    }
                                }
                            }}
                            className="inline-flex items-center gap-2 bg-white border-2 border-charcoal text-charcoal px-6 py-3 rounded-xl font-bold hover:bg-gray-50 transition-all shadow-sm"
                        >
                            Saltar y entrar al Dashboard →
                        </button>
                    </div>
                </div>

                {/* Calendly Column */}
                <div className="flex-1 w-full bg-white rounded-3xl shadow-xl overflow-hidden border border-gray-100 min-h-[600px] flex flex-col relative">
                    <div className="p-6 bg-gradient-to-r from-charcoal to-gray-900 text-white text-center">
                        <h2 className="font-bold text-xl text-gradient-premium">Agenda tu Activación</h2>
                        <p className="text-sm text-gray-300 mt-1">Selecciona el horario que mejor te acomode.</p>
                    </div>
                    <div className="flex-1 bg-white relative">
                        <HQBookingForm />
                    </div>
                </div>

            </main>
        </div>
    );
}
