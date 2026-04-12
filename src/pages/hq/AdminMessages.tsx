import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, Send, Sparkles, MoreVertical, MessageSquare, RefreshCw, Bot, User, BellOff, ArrowLeft } from 'lucide-react'
import { cn, formatPhoneNumber, getInitials } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { ContactInfoSidebar } from '@/components/messages/ContactInfoSidebar'

const HQ_ID = '00000000-0000-0000-0000-000000000000'

interface Message {
    id: string
    phone_number: string
    direction: 'inbound' | 'outbound'
    content: string
    ai_generated: boolean
    ai_function_called: string | null
    created_at: string
}

interface Conversation {
    phone_number: string
    contact_name: string | null
    last_message: string
    last_message_at: string
    unread_count: number
    message_count: number
    requires_human: boolean
}

export default function AdminMessages() {
    const [conversations, setConversations] = useState<Conversation[]>([])
    const [selectedPhone, setSelectedPhone] = useState<string | null>(null)
    const [sidebarPhone, setSidebarPhone] = useState<string | null>(null)
    const [messages, setMessages] = useState<Message[]>([])
    const [searchQuery, setSearchQuery] = useState('')
    const [newMessage, setNewMessage] = useState('')
    const [loading, setLoading] = useState(true)
    const [loadingMessages, setLoadingMessages] = useState(false)
    const [sending, setSending] = useState(false)
    const [togglingAI, setTogglingAI] = useState(false)
    const [showSidebar, setShowSidebar] = useState(false)
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const chatRef = useRef<HTMLDivElement>(null)

    const selectedPhoneRef = useRef<string | null>(selectedPhone)
    useEffect(() => {
        selectedPhoneRef.current = selectedPhone
    }, [selectedPhone])

    const scrollToBottom = useCallback(() => {
        setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
        }, 100)
    }, [])

    const fetchConversations = useCallback(async () => {
        try {
            let { data: msgs, error } = await (supabase as any)
                .from('messages')
                .select('phone_number, content, direction, created_at, is_read')
                .eq('clinic_id', HQ_ID)
                .order('created_at', { ascending: false })

            if (error && error.message?.includes('is_read')) {
                const { data: fallbackMsgs, error: fallbackError } = await (supabase as any)
                    .from('messages')
                    .select('phone_number, content, direction, created_at')
                    .eq('clinic_id', HQ_ID)
                    .order('created_at', { ascending: false })
                
                if (fallbackError) throw fallbackError
                msgs = fallbackMsgs
            } else if (error) {
                console.error('Error fetching conversations:', error)
                return
            }
            if (!msgs || msgs.length === 0) { setConversations([]); setLoading(false); return }

            const phoneMap = new Map<string, { messages: typeof msgs, count: number }>()
            for (const m of msgs) {
                if (!phoneMap.has(m.phone_number)) {
                    phoneMap.set(m.phone_number, { messages: [], count: 0 })
                }
                const entry = phoneMap.get(m.phone_number)!
                entry.messages.push(m)
                entry.count++
            }

            const phones = Array.from(phoneMap.keys())
            const { data: prospects } = await (supabase as any)
                .from('crm_prospects')
                .select('phone, name, requires_human')
                .eq('clinic_id', HQ_ID)
                .in('phone', phones)

            const nameMap = new Map<string, string>()
            const humanMap = new Map<string, boolean>()
            prospects?.forEach((p: any) => {
                if (p.name && p.name !== 'Sin nombre') nameMap.set(p.phone, p.name)
                if (p.requires_human) humanMap.set(p.phone, true)
            })

            const convs: Conversation[] = Array.from(phoneMap.entries()).map(([phone, data]) => {
                const latest = data.messages[0]
                let unread = 0
                for (const m of data.messages) {
                    if (m.direction === 'inbound') {
                        if (m.is_read === false) unread++
                        else if (m.is_read === true) continue
                    } else {
                        break 
                    }
                }
                return {
                    phone_number: phone,
                    contact_name: nameMap.get(phone) || null,
                    last_message: latest.content,
                    last_message_at: latest.created_at,
                    unread_count: unread,
                    message_count: data.count,
                    requires_human: humanMap.get(phone) || false
                }
            })

            convs.sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime())
            setConversations(convs)

            if (!selectedPhoneRef.current && convs.length > 0 && window.innerWidth >= 768) {
                setSelectedPhone(convs[0].phone_number)
            }
        } catch (e) {
            console.error('Error:', e)
        } finally {
            setLoading(false)
        }
    }, [])

    const fetchMessages = useCallback(async () => {
        if (!selectedPhone) return
        setLoadingMessages(true)
        try {
            if (selectedPhone) {
                try {
                    await (supabase as any)
                        .from('messages')
                        .update({ is_read: true })
                        .eq('clinic_id', HQ_ID)
                        .eq('phone_number', selectedPhone)
                        .eq('direction', 'inbound')
                        .eq('is_read', false)
                } catch (err) {
                    console.warn('Could not update is_read:', err)
                }
            }

            const { data, error } = await (supabase as any)
                .from('messages')
                .select('*')
                .eq('clinic_id', HQ_ID)
                .eq('phone_number', selectedPhone)
                .order('created_at', { ascending: true })
                .limit(100)

            if (error) { console.error('Error fetching messages:', error); return }
            setMessages(data || [])
            scrollToBottom()
        } catch (e) {
            console.error('Error:', e)
        } finally {
            setLoadingMessages(false)
        }
    }, [selectedPhone, scrollToBottom])

    useEffect(() => {
        fetchConversations()
    }, [fetchConversations])

    useEffect(() => {
        if (selectedPhone) fetchMessages()
    }, [selectedPhone, fetchMessages])

    useEffect(() => {
        const channel = supabase
            .channel(`messages-hq`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'messages',
                filter: `clinic_id=eq.${HQ_ID}`,
            }, async (payload) => {
                const newMsg = payload.new as (Message & { is_read: boolean })
                
                if (newMsg.direction === 'inbound' && newMsg.phone_number === selectedPhoneRef.current) {
                    await (supabase as any)
                        .from('messages')
                        .update({ is_read: true })
                        .eq('id', newMsg.id)
                    newMsg.is_read = true
                }

                fetchConversations()

                if (newMsg.phone_number === selectedPhoneRef.current) {
                    setMessages(prev => {
                        if (prev.some(m => m.id === newMsg.id)) return prev;
                        return [...prev, newMsg];
                    })
                    scrollToBottom()
                }
            })
            .subscribe()

        return () => { supabase.removeChannel(channel) }
    }, [fetchConversations, scrollToBottom])

    const toggleAIStatus = async (conv: Conversation) => {
        if (togglingAI) return
        setTogglingAI(true)
        try {
            const newStatus = !conv.requires_human
            const { error: updateError } = await (supabase as any)
                .from('crm_prospects')
                .update({ requires_human: newStatus })
                .eq('clinic_id', HQ_ID)
                .eq('phone', conv.phone_number)

            if (updateError) throw updateError

            setConversations(prev => prev.map(c =>
                c.phone_number === conv.phone_number
                    ? { ...c, requires_human: newStatus }
                    : c
            ))
        } catch (e) {
            console.error('Error toggling AI status:', e)
            alert('Error al actualizar el estado de la IA.')
        } finally {
            setTogglingAI(false)
        }
    }

    const handleSend = async () => {
        if (!newMessage.trim() || !selectedPhone || sending) return
        setSending(true)
        try {
            const { data: clinic } = await (supabase as any)
                .from('clinic_settings')
                .select('ycloud_api_key, ycloud_phone_number')
                .eq('id', HQ_ID)
                .single()

            if (!clinic?.ycloud_api_key || !clinic?.ycloud_phone_number) {
                alert('No se encontró configuración de WhatsApp para Vetly HQ.')
                return
            }

            const res = await fetch('https://api.ycloud.com/v2/whatsapp/messages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-API-Key': clinic.ycloud_api_key },
                body: JSON.stringify({
                    from: clinic.ycloud_phone_number,
                    to: selectedPhone,
                    type: 'text',
                    text: { body: newMessage.trim() }
                })
            })

            if (!res.ok) throw new Error('Error al enviar mensaje')

            await (supabase as any).from('messages').insert({
                clinic_id: HQ_ID,
                phone_number: selectedPhone,
                direction: 'outbound',
                content: newMessage.trim(),
                ai_generated: false,
                campaign_id: null
            })

            setNewMessage('')
        } catch (e) {
            console.error('Send error:', e)
            alert('Error al enviar mensaje.')
        } finally {
            setSending(false)
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSend()
        }
    }

    const filteredConversations = conversations.filter(
        (conv) =>
            conv.contact_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            conv.phone_number.includes(searchQuery)
    )

    const selectedConversation = conversations.find(c => c.phone_number === selectedPhone)

    const formatTime = (date: string) => {
        const d = new Date(date)
        const now = new Date()
        const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24))
        if (diffDays === 0) return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
        if (diffDays === 1) return 'Ayer'
        return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
    }

    const groupedMessages = messages.reduce((acc, msg) => {
        const dateKey = new Date(msg.created_at).toLocaleDateString()
        if (!acc[dateKey]) acc[dateKey] = []
        acc[dateKey].push(msg)
        return acc
    }, {} as Record<string, Message[]>)

    if (!loading && conversations.length === 0) {
        return (
            <div className="h-full flex items-center justify-center p-8">
                <div className="text-center max-w-md bg-white p-12 rounded-2xl shadow-sm border border-gray-100">
                    <div className="w-20 h-20 bg-primary-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                        <MessageSquare className="w-10 h-10 text-primary-500" />
                    </div>
                    <h2 className="text-xl font-semibold text-charcoal mb-2">Sin conversaciones HQ</h2>
                    <p className="text-charcoal/50 text-sm">
                        Aquí verás los mensajes de prospectos interesados en Vetly.
                    </p>
                </div>
            </div>
        )
    }

    return (
        <div className="h-full flex flex-col md:flex-row gap-6 p-6 animate-fade-in bg-gray-50">
            {/* Conversations List */}
            <div className={cn(
                "w-full md:w-80 flex-shrink-0 bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col h-full overflow-hidden",
                selectedPhone ? "hidden md:flex" : "flex"
            )}>
                <div className="p-4 border-b border-gray-50 bg-gray-50/50">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="font-bold text-gray-800 text-lg">Mensajes HQ</h2>
                        <button
                            onClick={() => { setLoading(true); fetchConversations(); if (selectedPhone) fetchMessages(); }}
                            className="p-2 text-gray-400 hover:text-primary-500 hover:bg-white rounded-xl transition-all"
                        >
                            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
                        </button>
                    </div>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Buscar prospecto..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 bg-white border-transparent text-sm focus:ring-2 focus:ring-primary-500/20 rounded-xl transition-all"
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <RefreshCw className="w-5 h-5 text-primary-500 animate-spin" />
                        </div>
                    ) : (
                        filteredConversations.map((conversation) => (
                            <button
                                key={conversation.phone_number}
                                onClick={() => setSelectedPhone(conversation.phone_number)}
                                className={cn(
                                    'w-full p-4 flex items-start gap-4 text-left transition-all border-b border-gray-50',
                                    selectedPhone === conversation.phone_number ? 'bg-primary-50' : 'hover:bg-gray-50'
                                )}
                            >
                                <div className="relative flex-shrink-0">
                                    <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center">
                                        <span className="text-sm font-bold text-primary-700">
                                            {getInitials(conversation.contact_name || conversation.phone_number.slice(-4))}
                                        </span>
                                    </div>
                                    {conversation.unread_count > 0 && (
                                        <span className="absolute -top-1 -right-1 w-5 h-5 bg-primary-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-white">
                                            {conversation.unread_count}
                                        </span>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-2">
                                        <p className="font-semibold text-gray-800 truncate">
                                            {conversation.contact_name || formatPhoneNumber(conversation.phone_number)}
                                        </p>
                                        <span className="text-[10px] text-gray-400 font-medium">
                                            {formatTime(conversation.last_message_at)}
                                        </span>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1 truncate">
                                        {conversation.last_message}
                                    </p>
                                    <div className="flex items-center gap-2 mt-2">
                                        {conversation.requires_human && (
                                            <span className="px-2 py-0.5 bg-red-50 text-red-600 text-[10px] font-bold rounded-full border border-red-100 uppercase tracking-wider">
                                                Human
                                            </span>
                                        )}
                                        {!conversation.requires_human && (
                                            <span className="px-2 py-0.5 bg-green-50 text-green-600 text-[10px] font-bold rounded-full border border-green-100 uppercase tracking-wider">
                                                AI Active
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </button>
                        ))
                    )}
                </div>
            </div>

            {/* Chat Area */}
            <div className={cn(
                "flex-1 bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col h-full relative overflow-hidden",
                selectedPhone ? "flex" : "hidden md:flex"
            )}>
                {selectedConversation ? (
                    <>
                        <div className="p-4 border-b border-gray-50 flex items-center justify-between bg-white z-10">
                            <div className="flex items-center gap-4">
                                <button onClick={() => setSelectedPhone(null)} className="p-2 -ml-2 text-gray-400 hover:text-gray-600 md:hidden">
                                    <ArrowLeft className="w-5 h-5" />
                                </button>
                                <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
                                    <span className="text-sm font-bold text-primary-700">
                                        {getInitials(selectedConversation.contact_name || selectedConversation.phone_number.slice(-4))}
                                    </span>
                                </div>
                                <div>
                                    <p className="font-bold text-gray-800">
                                        {selectedConversation.contact_name || formatPhoneNumber(selectedConversation.phone_number)}
                                    </p>
                                    <p className="text-xs text-gray-400 font-medium">{formatPhoneNumber(selectedConversation.phone_number)}</p>
                                </div>
                            </div>
                            
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => toggleAIStatus(selectedConversation)}
                                    disabled={togglingAI}
                                    className={cn(
                                        "flex items-center gap-2 px-4 py-2 rounded-xl transition-all font-bold text-xs uppercase tracking-widest",
                                        selectedConversation.requires_human
                                            ? "bg-red-50 text-red-600 border border-red-100"
                                            : "bg-primary-50 text-primary-600 border border-primary-100"
                                    )}
                                >
                                    {selectedConversation.requires_human ? <BellOff className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
                                    {selectedConversation.requires_human ? "Pausar IA" : "IA Activa"}
                                </button>
                                <button onClick={() => { setSidebarPhone(selectedPhone); setShowSidebar(true); }} className="p-2 text-gray-400 hover:bg-gray-50 rounded-xl transition-all">
                                    <MoreVertical className="w-5 h-5" />
                                </button>
                            </div>
                        </div>

                        <div ref={chatRef} className="flex-1 overflow-y-auto p-6 space-y-6 bg-gray-50/30">
                            {loadingMessages ? (
                                <div className="flex items-center justify-center h-full">
                                    <RefreshCw className="w-6 h-6 text-primary-500 animate-spin" />
                                </div>
                            ) : messages.length === 0 ? (
                                <div className="flex items-center justify-center h-full text-gray-400 text-sm italic font-medium">
                                    No hay mensajes anteriores
                                </div>
                            ) : (
                                Object.entries(groupedMessages).map(([dateKey, dayMessages]) => (
                                    <div key={dateKey} className="space-y-6">
                                        <div className="flex justify-center">
                                            <span className="px-4 py-1.5 bg-white text-[10px] text-gray-400 font-bold rounded-full shadow-sm border border-gray-100 uppercase tracking-widest">
                                                {new Date(dayMessages[0].created_at).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}
                                            </span>
                                        </div>
                                        {dayMessages.map((message) => (
                                            <div key={message.id} className={cn('flex group', message.direction === 'outbound' ? 'justify-end' : 'justify-start')}>
                                                <div className={cn(
                                                    'max-w-[80%] rounded-2xl p-4 shadow-sm transition-all',
                                                    message.direction === 'outbound'
                                                        ? 'bg-primary-600 text-white rounded-tr-none'
                                                        : 'bg-white text-gray-800 rounded-tl-none border border-gray-100'
                                                )}>
                                                    <p className="text-sm leading-relaxed">{message.content}</p>
                                                    <div className={cn(
                                                        'text-[10px] mt-2 flex items-center gap-2 font-bold opacity-60 uppercase tracking-wider',
                                                        message.direction === 'outbound' ? 'text-white' : 'text-gray-400'
                                                    )}>
                                                        {new Date(message.created_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                                                        {message.direction === 'outbound' && (
                                                            <span className="flex items-center gap-1">
                                                                {message.ai_generated ? <Bot className="w-3 h-3" /> : <User className="w-3 h-3" />}
                                                                {message.ai_generated ? 'Agent' : 'Admin'}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ))
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        <div className="p-4 bg-white border-t border-gray-50">
                            <div className="flex items-end gap-3 bg-gray-50 p-2 rounded-2xl">
                                <textarea
                                    value={newMessage}
                                    onChange={(e) => setNewMessage(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder="Escribe un mensaje de respuesta..."
                                    rows={1}
                                    className="flex-1 px-4 py-3 bg-transparent border-none text-sm placeholder:text-gray-400 focus:ring-0 resize-none max-h-32"
                                />
                                <button
                                    onClick={handleSend}
                                    disabled={!newMessage.trim() || sending}
                                    className={cn(
                                        "p-3 rounded-xl transition-all shadow-sm",
                                        !newMessage.trim() || sending ? "bg-gray-200 text-gray-400" : "bg-primary-500 text-white hover:bg-primary-600 active:scale-95"
                                    )}
                                >
                                    {sending ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                                </button>
                            </div>
                            <p className="text-[10px] mt-3 text-center text-gray-400 font-bold uppercase tracking-widest">
                                {selectedConversation.requires_human ? "Control Manual Activo" : "La IA responderá automáticamente"}
                            </p>
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex items-center justify-center bg-gray-50/30">
                        <div className="text-center">
                            <div className="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center mx-auto mb-4 border border-gray-100">
                                <MessageSquare className="w-8 h-8 text-gray-300" />
                            </div>
                            <p className="text-sm font-bold text-gray-400 uppercase tracking-widest">Selecciona un prospecto</p>
                        </div>
                    </div>
                )}
            </div>

            {showSidebar && sidebarPhone && (
                <div className="fixed inset-0 z-50 md:relative md:inset-auto md:z-0 md:flex animate-fade-in">
                    <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm md:hidden" onClick={() => setShowSidebar(false)} />
                    <ContactInfoSidebar 
                        phoneNumber={sidebarPhone}
                        clinicId={HQ_ID}
                        onClose={() => setShowSidebar(false)}
                    />
                </div>
            )}
        </div>
    )
}
