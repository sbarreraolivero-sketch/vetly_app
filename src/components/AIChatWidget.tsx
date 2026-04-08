import { useState, useEffect, useRef } from 'react';
import { Send, ChevronDown, Sparkles, Zap, Bot, LifeBuoy, Eraser } from 'lucide-react';
import { supabase } from '@/lib/supabase';


interface Message {
    id: string;
    sender: 'ai' | 'user';
    text: string;
    timestamp: string;
    toolsUsed?: number;
    tab?: 'sales' | 'support' | 'simulator';
}

type TabMode = 'sales' | 'support' | 'simulator';

interface AIChatWidgetProps {
    variant?: 'sales' | 'simulator';
    clinicId?: string;
}

export function AIChatWidget({ variant = 'sales', clinicId }: AIChatWidgetProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<TabMode>(variant === 'simulator' ? 'simulator' : 'sales');

    // Message histories
    const [salesMessages, setSalesMessages] = useState<Message[]>([]);
    const [supportMessages, setSupportMessages] = useState<Message[]>([]);
    const [simulatorMessages, setSimulatorMessages] = useState<Message[]>([]);

    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [showBadge, setShowBadge] = useState(true);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const currentMessages = activeTab === 'sales' ? salesMessages : activeTab === 'simulator' ? simulatorMessages : supportMessages;
    const setMessages = activeTab === 'sales' ? setSalesMessages : activeTab === 'simulator' ? setSimulatorMessages : setSupportMessages;

    const formatTime = () => {
        return new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
    };

    // Initial messages
    useEffect(() => {
        if (isOpen) {
            if (activeTab === 'sales' && salesMessages.length === 0) {
                setSalesMessages([
                    {
                        id: 'init-sales',
                        sender: 'ai',
                        text: '¡Hola! ✨ Soy asesor de Vetly AI.\n\nEstoy aquí para ayudarte a transformar la rentabilidad de tu clínica veterinaria con nuestra Infraestructura Inteligente. ¿Tienes alguna duda sobre nuestras funciones o quieres agendar una asesoría de implementación?',
                        timestamp: formatTime()
                    }
                ]);
            } else if (activeTab === 'simulator' && simulatorMessages.length === 0) {
                setSimulatorMessages([
                    {
                        id: 'init-sim',
                        sender: 'ai',
                        text: '¡Hola! 🤖 Soy tu agente de atención en modo prueba.\n\nPuedes simular una conversación conmigo para ver cómo responderé a tus pacientes reales por WhatsApp. ¡Hazme una pregunta o intenta agendar!',
                        timestamp: formatTime()
                    }
                ]);
            } else if (activeTab === 'support' && supportMessages.length === 0) {
                setSupportMessages([
                    {
                        id: 'init-sup',
                        sender: 'ai',
                        text: '¡Hola! 🦋 Soy el asistente de soporte de Vetly AI.\n\n¿Tienes dudas sobre cómo usar la plataforma, configurar tu bot o gestionar tus finanzas? Estoy aquí para ayudarte.',
                        timestamp: formatTime()
                    }
                ]);
            }
            setShowBadge(false);
            setTimeout(() => inputRef.current?.focus(), 300);
        }
    }, [isOpen, activeTab]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [currentMessages, isTyping]);

    const handleSend = async (text: string) => {
        if (!text.trim() || isTyping) return;

        const userMsg: Message = {
            id: Date.now().toString(),
            sender: 'user',
            text: text.trim(),
            timestamp: formatTime(),
            tab: activeTab
        };

        const updatedMessages = [...currentMessages, userMsg];
        setMessages(updatedMessages);
        setInput('');
        setIsTyping(true);

        try {
            const endpoint = activeTab === 'simulator' ? 'ai-simulator' : 'chat-agent';

            let body: any = {
                variant: activeTab,
                messages: updatedMessages.map(m => ({
                    sender: m.sender,
                    text: m.text
                }))
            };

            // Custom body for simulator
            if (activeTab === 'simulator') {
                body = {
                    clinic_id: clinicId,
                    message: text.trim(),
                    conversation_history: updatedMessages.slice(0, -1).map(m => ({
                        sender: m.sender,
                        text: m.text
                    }))
                };
            }

            const { data, error } = await supabase.functions.invoke(endpoint, {
                body
            });

            if (error) throw error;

            const aiMsg: Message = {
                id: (Date.now() + 1).toString(),
                sender: 'ai',
                text: data?.reply || 'No pude generar una respuesta.',
                timestamp: formatTime(),
                toolsUsed: data?.tools_used || 0,
                tab: activeTab
            };

            setMessages(prev => [...prev, aiMsg]);
        } catch (err) {
            console.error(`Error en ${activeTab}:`, err);
            setMessages(prev => [
                ...prev,
                {
                    id: (Date.now() + 1).toString(),
                    sender: 'ai',
                    text: activeTab === 'sales'
                        ? '⚠️ Error de conexión. Verifica tu configuración de OpenAI.'
                        : '⚠️ No pude conectar con el soporte. Intenta más tarde.',
                    timestamp: formatTime()
                }
            ]);
        } finally {
            setIsTyping(false);
        }
    };

    const handleClearChat = () => {
        if (activeTab === 'sales') {
            setSalesMessages([{
                id: Date.now().toString(),
                sender: 'ai',
                text: '🔄 Chat de ventas reiniciado. ¿Cómo puedo ayudarte a escalar tu clínica?',
                timestamp: formatTime()
            }]);
        } else if (activeTab === 'simulator') {
            setSimulatorMessages([{
                id: Date.now().toString(),
                sender: 'ai',
                text: '🔄 Simulador reiniciado. Listo para otra prueba.',
                timestamp: formatTime()
            }]);
        } else {
            setSupportMessages([{
                id: Date.now().toString(),
                sender: 'ai',
                text: '🔄 Chat de soporte reiniciado. ¿En qué puedo ayudarte con Vetly AI?',
                timestamp: formatTime()
            }]);
        }
    };

    return (
        <div className="fixed bottom-6 right-6 z-50">
            {/* Chat Window */}
            {isOpen && (
                <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-[360px] sm:w-[400px] flex flex-col overflow-hidden mb-4 max-h-[620px]"
                    style={{ animation: 'slideUp 0.3s ease-out' }}
                >
                    {/* Header with Tabs */}
                    <div className="bg-white border-b border-gray-100 flex flex-col">
                        {/* Title Bar */}
                        <div className="bg-gradient-to-r from-gray-900 to-gray-800 px-4 py-3 flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 bg-primary-500 rounded-full flex items-center justify-center shadow-md">
                                    {activeTab === 'support' ? <Sparkles className="w-4 h-4 text-white" /> : <Bot className="w-4 h-4 text-white" />}
                                </div>
                                <h3 className="font-semibold text-white text-sm">Asistente Vetly AI</h3>
                            </div>
                            <div className="flex items-center gap-1">
                                <button onClick={handleClearChat} className="p-1.5 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors">
                                    <Eraser className="w-4 h-4" />
                                </button>
                                <button onClick={() => setIsOpen(false)} className="p-1.5 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors">
                                    <ChevronDown className="w-5 h-5" />
                                </button>
                            </div>
                        </div>

                        {/* Tab Selector */}
                        <div className="flex p-1 bg-gray-50/50 mx-2 my-2 rounded-xl border border-gray-100">
                            {variant === 'sales' ? (
                                <button
                                    onClick={() => setActiveTab('sales')}
                                    className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${activeTab === 'sales'
                                        ? 'bg-white text-primary-600 shadow-sm border border-gray-100'
                                        : 'text-gray-500 hover:text-gray-700'
                                        }`}
                                >
                                    <Sparkles className="w-3.5 h-3.5" />
                                    Ventas Vetly AI
                                </button>
                            ) : (
                                <button
                                    onClick={() => setActiveTab('simulator')}
                                    className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${activeTab === 'simulator'
                                        ? 'bg-white text-primary-600 shadow-sm border border-gray-100'
                                        : 'text-gray-500 hover:text-gray-700'
                                        }`}
                                >
                                    <Bot className="w-3.5 h-3.5" />
                                    Simulador Chat
                                </button>
                            )}
                            <button
                                onClick={() => setActiveTab('support')}
                                className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${activeTab === 'support'
                                    ? 'bg-white text-primary-600 shadow-sm border border-gray-100'
                                    : 'text-gray-500 hover:text-gray-700'
                                    }`}
                            >
                                <Zap className="w-3.5 h-3.5" />
                                Soporte Vetly AI
                            </button>
                        </div>
                    </div>

                    {/* Mode Specific Info */}
                    <div className={`${activeTab === 'support' ? 'bg-primary-50 border-primary-100 text-primary-700' : 'bg-primary-50 border-primary-100 text-primary-700'} border-b px-4 py-2 flex items-center gap-2 transition-colors`}>
                        {activeTab === 'support' ? <LifeBuoy className="w-3.5 h-3.5 shrink-0" /> : <Bot className="w-3.5 h-3.5 shrink-0" />}
                        <p className="text-xs font-bold sm:text-[11px] leading-tight font-medium">
                            {activeTab === 'sales'
                                ? 'Pregúntame cómo Vetly AI puede ayudar a tu clínica a crecer.'
                                : activeTab === 'simulator'
                                    ? 'Modo Prueba: Aquí puedes hablar con tu bot de atención configurado.'
                                    : '¿Necesitas ayuda con Vetly AI? Pregúntame lo que sea sobre el uso de la app.'
                            }
                        </p>
                    </div>

                    {/* Messages Body */}
                    <div className="flex-1 p-4 overflow-y-auto bg-[#f8fafc] flex flex-col gap-3 min-h-[350px] max-h-[350px]"
                        style={activeTab === 'sales' ? { backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'400\' height=\'400\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'%23d1d5db\' opacity=\'0.15\'%3E%3Ccircle cx=\'50\' cy=\'50\' r=\'1\'/%3E%3Ccircle cx=\'150\' cy=\'100\' r=\'1\'/%3E%3Ccircle cx=\'250\' cy=\'50\' r=\'1\'/%3E%3Ccircle cx=\'350\' cy=\'100\' r=\'1\'/%3E%3Ccircle cx=\'100\' cy=\'150\' r=\'1\'/%3E%3Ccircle cx=\'200\' cy=\'200\' r=\'1\'/%3E%3Ccircle cx=\'300\' cy=\'150\' r=\'1\'/%3E%3C/g%3E%3C/svg%3E")' } : {}}
                    >
                        {currentMessages.map((msg) => (
                            <div key={msg.id} className={`flex flex-col max-w-[85%] ${msg.sender === 'user' ? 'self-end' : 'self-start'}`}>
                                <div className={`px-3 py-2 text-[13px] leading-relaxed shadow-sm ${msg.sender === 'user'
                                    ? 'bg-primary-600 text-white rounded-2xl rounded-tr-sm'
                                    : 'bg-white text-gray-800 rounded-2xl rounded-tl-sm border border-gray-100'
                                    }`}>
                                    <div className="whitespace-pre-wrap">{msg.text}</div>
                                    <div className={`flex items-center justify-end gap-1 mt-1 ${msg.sender === 'user' ? 'text-white/60' : 'text-gray-400'}`}>
                                        <span className="text-[9px]">{msg.timestamp}</span>
                                    </div>
                                </div>
                                {msg.sender === 'ai' && Number(msg.toolsUsed) > 0 ? (
                                    <div className="flex items-center gap-1.5 mt-1 ml-2 text-xs font-bold text-gray-500 font-medium">
                                        <Zap className="w-3 h-3 text-amber-500 fill-amber-500" />
                                        <span>IA usó {msg.toolsUsed} {msg.toolsUsed === 1 ? 'herramienta' : 'herramientas'}</span>
                                    </div>
                                ) : null}
                            </div>
                        ))}

                        {isTyping && (
                            <div className="self-start max-w-[85%]">
                                <div className="bg-white px-4 py-3 rounded-2xl rounded-tl-sm shadow-sm border border-gray-100 flex gap-1.5">
                                    <div className="w-1.5 h-1.5 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                                    <div className="w-1.5 h-1.5 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                                    <div className="w-1.5 h-1.5 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input Area */}
                    <div className="p-4 bg-white border-t border-gray-100">
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                handleSend(input);
                            }}
                            className="flex items-center gap-2 group"
                        >
                            <input
                                ref={inputRef}
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                placeholder={activeTab === 'sales' ? "Consulta sobre Vetly AI..." : activeTab === 'simulator' ? "Prueba tu agente aquí..." : "Consulta sobre soporte..."}
                                disabled={isTyping}
                                className="flex-1 bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-100 focus:bg-white transition-all disabled:opacity-50"
                            />
                            <button
                                type="submit"
                                disabled={!input.trim() || isTyping}
                                className="w-10 h-10 flex items-center justify-center rounded-xl bg-primary-600 hover:bg-primary-700 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-primary-200"
                            >
                                <Send className="w-4 h-4" />
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* Floating Trigger Button */}
            {!isOpen && (
                <button
                    onClick={() => setIsOpen(true)}
                    className="group relative w-16 h-16 rounded-3xl shadow-2xl flex items-center justify-center bg-gradient-to-tr from-primary-600 to-primary-500 hover:from-primary-700 hover:to-primary-600 text-white transition-all hover:scale-105 active:scale-95 shadow-primary-300"
                >
                    <div className="absolute inset-0 rounded-3xl bg-primary-400 opacity-20 animate-pulse group-hover:scale-110 transition-transform"></div>
                    <Bot className="w-7 h-7 relative z-10 transition-transform group-hover:rotate-12" />

                    {showBadge && (
                        <span className="absolute -top-1 -right-1 flex h-4 w-4">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-4 w-4 bg-amber-500 border-2 border-white"></span>
                        </span>
                    )}

                    <span className="absolute right-full mr-4 bg-gray-900 text-white text-[11px] font-bold px-3 py-1.5 rounded-xl whitespace-nowrap opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0 pointer-events-none shadow-xl">
                        ¿Hablamos? IA & Soporte
                    </span>
                </button>
            )}

            <style>{`
                @keyframes slideUp {
                    from { opacity: 0; transform: translateY(20px) scale(0.95); }
                    to { opacity: 1; transform: translateY(0) scale(1); }
                }
            `}</style>
        </div>
    );
}
