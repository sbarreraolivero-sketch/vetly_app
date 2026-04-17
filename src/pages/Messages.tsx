import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, Phone, Send, Sparkles, MoreVertical, MessageSquare, RefreshCw, Bot, User, BellOff, ArrowLeft } from 'lucide-react'
import { cn, formatPhoneNumber, getInitials } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { ContactInfoSidebar } from '@/components/messages/ContactInfoSidebar'

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

export default function Messages() {
    const { profile } = useAuth()
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

    // Use a ref for selectedPhone to avoid dependency cycles in useEffect and useCallback
    const selectedPhoneRef = useRef<string | null>(selectedPhone)
    useEffect(() => {
        selectedPhoneRef.current = selectedPhone
    }, [selectedPhone])

    // Scroll to bottom of messages
    const scrollToBottom = useCallback(() => {
        setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
        }, 100)
    }, [])

    // Fetch conversations (grouped by phone_number)
    const fetchConversations = useCallback(async () => {
        if (!profile?.clinic_id) return
        try {
            // Get all messages grouped by phone number, get latest message per conversation
            // We use a try-catch pattern or a safer select to handle the missing is_read column
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let { data: msgs, error } = await (supabase as any)
                .from('messages')
                .select('phone_number, content, direction, created_at, is_read')
                .eq('clinic_id', profile.clinic_id)
                .order('created_at', { ascending: false })

            if (error && error.message?.includes('is_read')) {
                console.warn('is_read column missing, falling back to basic query')
                const { data: fallbackMsgs, error: fallbackError } = await (supabase as any)
                    .from('messages')
                    .select('phone_number, content, direction, created_at')
                    .eq('clinic_id', profile.clinic_id)
                    .order('created_at', { ascending: false })

                if (fallbackError) throw fallbackError
                msgs = fallbackMsgs
            } else if (error) {
                console.error('Error fetching conversations:', error)
                return
            }
            if (!msgs || msgs.length === 0) { setConversations([]); setLoading(false); return }

            // Group by phone number
            const phoneMap = new Map<string, { messages: typeof msgs, count: number }>()
            for (const m of msgs) {
                if (!phoneMap.has(m.phone_number)) {
                    phoneMap.set(m.phone_number, { messages: [], count: 0 })
                }
                const entry = phoneMap.get(m.phone_number)!
                entry.messages.push(m)
                entry.count++
            }

            // Fetch prospect names and requires_human flag for phones
            const phones = Array.from(phoneMap.keys())
            const nameMap = new Map<string, string>()
            const humanMap = new Map<string, boolean>()

            // Fetch tutors for names and requires_human flag
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: tutors } = await (supabase as any)
                .from('tutors')
                .select('phone_number, name, requires_human')
                .eq('clinic_id', profile.clinic_id)
                .in('phone_number', phones)

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tutors?.forEach((t: any) => {
                if (t.name) nameMap.set(t.phone_number, t.name)
                if (t.requires_human) humanMap.set(t.phone_number, true)
            })

            // Fetch fallback names from messages if tutor not found (historical context)
            const unnamedPhones = phones.filter(p => !nameMap.has(p))
            if (unnamedPhones.length > 0) {
                const { data: prospects } = await (supabase as any)
                    .from('crm_prospects')
                    .select('phone, name')
                    .eq('clinic_id', profile.clinic_id)
                    .in('phone', unnamedPhones)

                prospects?.forEach((p: any) => {
                    if (p.name && p.name !== 'Sin nombre') nameMap.set(p.phone, p.name)
                })
            }

            // Build conversations
            const convs: Conversation[] = Array.from(phoneMap.entries()).map(([phone, data]) => {
                const latest = data.messages[0]
                // Use the new is_read column if available, fallback to legacy grouping logic
                let unread = 0
                for (const m of data.messages) {
                    if (m.direction === 'inbound') {
                        // If it has is_read column, use it. Otherwise, use legacy "break on outbound"
                        if (m.is_read === false) unread++
                        else if (m.is_read === true) continue // Explicitly read
                        else {
                            // Legacy logic (for old messages without is_read)
                            // We already handled it by breaking on outbound
                        }
                    } else {
                        // For legacy, stop counting at first outbound
                        // For new messages, it doesn't matter much as they should be marked is_read=true on outbound anyway
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

            // Sort by last message time
            convs.sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime())
            setConversations(convs)

            // Auto-select first conversation if none selected (only on desktop)
            if (!selectedPhoneRef.current && convs.length > 0 && window.innerWidth >= 768) {
                setSelectedPhone(convs[0].phone_number)
            }
        } catch (e) {
            console.error('Error:', e)
        } finally {
            setLoading(false)
        }
    }, [profile?.clinic_id])

    // Fetch messages for selected conversation
    const fetchMessages = useCallback(async () => {
        if (!profile?.clinic_id || !selectedPhone) return
        setLoadingMessages(true)
        try {
            // Mark as read first if we have a selection
            if (selectedPhone) {
                try {
                    await (supabase as any)
                        .from('messages')
                        .update({ is_read: true })
                        .eq('clinic_id', profile.clinic_id)
                        .eq('phone_number', selectedPhone)
                        .eq('direction', 'inbound')
                        .eq('is_read', false)
                } catch (err) {
                    console.warn('Could not update is_read (column might be missing):', err)
                }
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data, error } = await (supabase as any)
                .from('messages')
                .select('*')
                .eq('clinic_id', profile.clinic_id)
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
    }, [profile?.clinic_id, selectedPhone, scrollToBottom])

    // Initial load
    useEffect(() => {
        fetchConversations()
    }, [fetchConversations])

    // Fetch messages when conversation changes
    useEffect(() => {
        if (selectedPhone) fetchMessages()
    }, [selectedPhone, fetchMessages])

    // Real-time subscription for new messages
    useEffect(() => {
        if (!profile?.clinic_id) return

        const channel = supabase
            .channel(`messages-${profile.clinic_id}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'messages',
                filter: `clinic_id=eq.${profile.clinic_id}`,
            }, async (payload) => {
                const newMsg = payload.new as (Message & { is_read: boolean })

                // If the message is inbound and belongs to the selected conversation, mark it as read immediately in DB
                if (newMsg.direction === 'inbound' && newMsg.phone_number === selectedPhoneRef.current) {
                    await (supabase as any)
                        .from('messages')
                        .update({ is_read: true })
                        .eq('id', newMsg.id)
                    newMsg.is_read = true
                }

                // Update conversations list (to refresh unread counts and last message)
                fetchConversations()

                // If the message belongs to the selected conversation, add it to the UI
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
    }, [profile?.clinic_id, fetchConversations, scrollToBottom])

    // Toggle AI (Requires Human flag)
    const toggleAIStatus = async (conv: Conversation) => {
        if (!profile?.clinic_id || togglingAI) return
        setTogglingAI(true)
        try {
            const newStatus = !conv.requires_human
            const searchPhone = conv.phone_number.startsWith("+") ? conv.phone_number : `+${conv.phone_number}`
            const searchPhoneNoPlus = conv.phone_number.startsWith("+") ? conv.phone_number.substring(1) : conv.phone_number

            // Update both tables to ensure the webhook catches it regardless of contact type
            const [tutorRes, prospectRes] = await Promise.all([
                (supabase as any)
                    .from('tutors')
                    .update({ requires_human: newStatus })
                    .eq('clinic_id', profile.clinic_id)
                    .or(`phone_number.eq.${searchPhone},phone_number.eq.${searchPhoneNoPlus}`),
                (supabase as any)
                    .from('crm_prospects')
                    .update({ requires_human: newStatus })
                    .eq('clinic_id', profile.clinic_id)
                    .or(`phone.eq.${searchPhone},phone.eq.${searchPhoneNoPlus}`)
            ])

            if (tutorRes.error && prospectRes.error) {
                console.error('Error updating both tables:', tutorRes.error, prospectRes.error)
                throw new Error('No se pudo actualizar el estado de la IA.')
            }

            // Update local state
            setConversations(prev => prev.map(c =>
                c.phone_number === conv.phone_number
                    ? { ...c, requires_human: newStatus }
                    : c
            ))

            // Optional: dismiss any notification about this
            if (!newStatus) { /* AI Reactivated */ }

        } catch (e) {
            console.error('Error toggling AI status:', e)
            alert('Error al actualizar el estado de la IA para este contacto.')
        } finally {
            setTogglingAI(false)
        }
    }

    // Send manual message via YCloud
    const handleSend = async () => {
        if (!newMessage.trim() || !selectedPhone || !profile?.clinic_id || sending) return
        setSending(true)
        try {
            // Get clinic settings for YCloud API key
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: clinic } = await (supabase as any)
                .from('clinic_settings')
                .select('ycloud_api_key, ycloud_phone_number')
                .eq('id', profile.clinic_id)
                .single()

            if (!clinic?.ycloud_api_key || !clinic?.ycloud_phone_number) {
                alert('Configura tu API Key de YCloud en Ajustes primero.')
                return
            }

            // Send via YCloud API
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

            // Save to database
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase as any).from('messages').insert({
                clinic_id: profile.clinic_id,
                phone_number: selectedPhone, // Kept original variable
                direction: 'outbound',
                content: newMessage.trim(), // Kept original variable
                ai_generated: false, // Manual message
                campaign_id: null // Explicitly null for manual messages
            })

            setNewMessage('')
            // The real-time subscription will pick up the new message
        } catch (e) {
            console.error('Send error:', e)
            alert('Error al enviar mensaje. Verifica tu configuración de YCloud.')
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

        if (diffDays === 0) {
            return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
        } else if (diffDays === 1) {
            return 'Ayer'
        } else {
            return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
        }
    }

    const formatMessageDate = (date: string) => {
        const d = new Date(date)
        const now = new Date()
        const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24))
        if (diffDays === 0) return 'Hoy'
        if (diffDays === 1) return 'Ayer'
        return d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })
    }

    // Group messages by date
    const groupedMessages = messages.reduce((acc, msg) => {
        const dateKey = new Date(msg.created_at).toLocaleDateString()
        if (!acc[dateKey]) acc[dateKey] = []
        acc[dateKey].push(msg)
        return acc
    }, {} as Record<string, Message[]>)

    // Empty state
    if (!loading && conversations.length === 0) {
        return (
            <div className="h-[calc(100vh-7rem)] flex items-center justify-center animate-fade-in">
                <div className="text-center max-w-md">
                    <div className="w-20 h-20 bg-primary-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                        <MessageSquare className="w-10 h-10 text-primary-500" />
                    </div>
                    <h2 className="text-xl font-semibold text-charcoal mb-2">Sin conversaciones</h2>
                    <p className="text-charcoal/50 text-sm">
                        Las conversaciones aparecerán aquí cuando los tutores envíen mensajes por WhatsApp.
                        Asegúrate de configurar tu número de YCloud en Ajustes.
                    </p>
                </div>
            </div>
        )
    }

    return (
        <div className="h-[calc(100vh-7rem)] flex flex-col md:flex-row gap-6 animate-fade-in">
            {/* Conversations List */}
            <div className={cn(
                "w-full md:w-80 flex-shrink-0 card-soft flex-col h-full",
                selectedPhone ? "hidden md:flex" : "flex"
            )}>
                {/* Search Header */}
                <div className="p-4 border-b border-silk-beige">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="font-semibold text-charcoal">Mensajes</h2>
                        <button
                            onClick={() => {
                                setLoading(true);
                                fetchConversations();
                                if (selectedPhone) fetchMessages();
                            }}
                            className="p-1.5 text-charcoal/40 hover:text-charcoal hover:bg-ivory rounded-soft transition-colors"
                            title="Actualizar"
                        >
                            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
                        </button>
                    </div>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal/40" />
                        <input
                            type="text"
                            placeholder="Buscar conversación..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 bg-ivory border border-silk-beige rounded-soft text-sm placeholder:text-charcoal/40 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                        />
                    </div>
                </div>

                {/* Conversations */}
                <div className="flex-1 overflow-y-auto scrollbar-soft">
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
                                    'w-full p-4 flex items-start gap-3 text-left transition-colors border-b border-silk-beige/50',
                                    selectedPhone === conversation.phone_number
                                        ? 'bg-primary-500/5'
                                        : 'hover:bg-ivory'
                                )}
                            >
                                <div className="relative flex-shrink-0">
                                    <div className="w-12 h-12 bg-silk-beige rounded-full flex items-center justify-center">
                                        <span className="text-sm font-medium text-charcoal">
                                            {getInitials(conversation.contact_name || conversation.phone_number.slice(-4))}
                                        </span>
                                    </div>
                                    {conversation.unread_count > 0 && (
                                        <span className="absolute -top-1 -right-1 w-5 h-5 bg-primary-500 text-white text-xs font-medium rounded-full flex items-center justify-center">
                                            {conversation.unread_count}
                                        </span>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-2">
                                        <p className="font-medium text-charcoal truncate">
                                            {conversation.contact_name || formatPhoneNumber(conversation.phone_number)}
                                        </p>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setSidebarPhone(conversation.phone_number);
                                                    setShowSidebar(true);
                                                }}
                                                className="p-1 text-charcoal/20 hover:text-charcoal hover:bg-silk-beige/50 rounded transition-colors"
                                            >
                                                <MoreVertical className="w-3.5 h-3.5" />
                                            </button>
                                            {conversation.requires_human && (
                                                <span title="Atención humana requerida" className="flex-shrink-0 flex">
                                                    <BellOff className="w-3.5 h-3.5 text-red-500" />
                                                </span>
                                            )}
                                            <span className="text-xs text-charcoal/40 flex-shrink-0">
                                                {formatTime(conversation.last_message_at)}
                                            </span>
                                        </div>
                                    </div>
                                    <p className="text-sm text-charcoal/50 mt-0.5 truncate">
                                        {conversation.last_message}
                                    </p>
                                </div>
                            </button>
                        ))
                    )}
                </div>
            </div>

            {/* Chat Area */}
            <div className={cn(
                "flex-1 card-soft flex-col h-full relative overflow-hidden",
                selectedPhone ? "flex" : "hidden md:flex"
            )}>
                {selectedConversation ? (
                    <>
                        {/* Chat Header */}
                        <div className="p-4 border-b border-silk-beige flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => setSelectedPhone(null)}
                                    className="p-1.5 -ml-1 text-charcoal/60 hover:text-charcoal md:hidden"
                                >
                                    <ArrowLeft className="w-6 h-6" />
                                </button>
                                <div className="w-10 h-10 bg-silk-beige rounded-full flex items-center justify-center">
                                    <span className="text-sm font-medium text-charcoal">
                                        {getInitials(selectedConversation.contact_name || selectedConversation.phone_number.slice(-4))}
                                    </span>
                                </div>
                                <div>
                                    <p className="font-medium text-charcoal">
                                        {selectedConversation.contact_name || formatPhoneNumber(selectedConversation.phone_number)}
                                    </p>
                                    <p className="text-sm text-charcoal/50 flex items-center gap-1">
                                        <Phone className="w-3 h-3" />
                                        {formatPhoneNumber(selectedConversation.phone_number)}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => toggleAIStatus(selectedConversation)}
                                    disabled={togglingAI}
                                    title={selectedConversation.requires_human ? "Reactivar IA" : "Silenciar IA (Tomar control manual)"}
                                    className={cn(
                                        "flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-colors cursor-pointer disabled:opacity-50",
                                        selectedConversation.requires_human
                                            ? "bg-red-50 text-red-600 hover:bg-red-100 border border-red-200"
                                            : "bg-accent-500/15 hover:bg-accent-500/20 text-accent-700 border border-accent-500/20 shadow-[inset_0_0_8px_rgba(200,169,106,0.1)]"
                                    )}
                                >
                                    {selectedConversation.requires_human ? (
                                        <>
                                            <BellOff className="w-4 h-4" />
                                            <span className="text-xs font-medium">IA Pausada</span>
                                        </>
                                    ) : (
                                        <>
                                            <Sparkles className="w-4 h-4" />
                                            <span className="text-xs font-medium">IA Activa</span>
                                        </>
                                    )}
                                </button>
                                <span className="text-xs text-charcoal/40">{selectedConversation.message_count} msgs</span>
                                <button
                                    onClick={() => {
                                        setSidebarPhone(selectedPhone)
                                        setShowSidebar(true)
                                    }}
                                    className="p-2 text-charcoal/50 hover:text-charcoal hover:bg-ivory rounded-soft transition-colors"
                                >
                                    <MoreVertical className="w-5 h-5" />
                                </button>
                            </div>
                        </div>

                        {/* Messages */}
                        <div ref={chatRef} className="flex-1 overflow-y-auto p-4 space-y-1 scrollbar-soft">
                            {loadingMessages ? (
                                <div className="flex items-center justify-center h-full">
                                    <RefreshCw className="w-5 h-5 text-primary-500 animate-spin" />
                                </div>
                            ) : messages.length === 0 ? (
                                <div className="flex items-center justify-center h-full text-charcoal/40 text-sm">
                                    No hay mensajes en esta conversación
                                </div>
                            ) : (
                                Object.entries(groupedMessages).map(([dateKey, dayMessages]) => (
                                    <div key={dateKey}>
                                        {/* Date separator */}
                                        <div className="flex items-center justify-center my-4">
                                            <span className="px-3 py-1 bg-ivory rounded-full text-xs text-charcoal/50 font-medium">
                                                {formatMessageDate(dayMessages[0].created_at)}
                                            </span>
                                        </div>
                                        {/* Messages for this date */}
                                        <div className="space-y-3">
                                            {dayMessages.map((message) => (
                                                <div
                                                    key={message.id}
                                                    className={cn(
                                                        'flex',
                                                        message.direction === 'outbound' ? 'justify-end' : 'justify-start'
                                                    )}
                                                >
                                                    {/* Inbound avatar */}
                                                    {message.direction === 'inbound' && (
                                                        <div className="w-7 h-7 bg-silk-beige rounded-full flex items-center justify-center mr-2 mt-1 flex-shrink-0">
                                                            <User className="w-3.5 h-3.5 text-charcoal/60" />
                                                        </div>
                                                    )}
                                                    <div
                                                        className={cn(
                                                            'max-w-[70%] rounded-softer px-4 py-3',
                                                            message.direction === 'outbound'
                                                                ? message.ai_generated
                                                                    ? 'bg-primary-500 text-white'
                                                                    : 'bg-primary-600 text-white'
                                                                : 'bg-white border border-silk-beige text-charcoal'
                                                        )}
                                                    >
                                                        <p className="text-sm whitespace-pre-line">{message.content}</p>
                                                        <p
                                                            className={cn(
                                                                'text-xs mt-2 flex items-center gap-1',
                                                                message.direction === 'outbound' ? 'text-white/60' : 'text-charcoal/40'
                                                            )}
                                                        >
                                                            {new Date(message.created_at).toLocaleTimeString('es-MX', {
                                                                hour: '2-digit',
                                                                minute: '2-digit',
                                                            })}
                                                            {message.direction === 'outbound' && message.ai_generated && (
                                                                <span className="inline-flex items-center gap-1 ml-1">
                                                                    <Bot className="w-3 h-3" /> IA
                                                                </span>
                                                            )}
                                                            {message.direction === 'outbound' && !message.ai_generated && (
                                                                <span className="inline-flex items-center gap-1 ml-1">
                                                                    <User className="w-3 h-3" /> Manual
                                                                </span>
                                                            )}
                                                            {message.ai_function_called && (
                                                                <span className="inline-flex items-center gap-1 ml-1 opacity-70">
                                                                    ⚡ {message.ai_function_called}
                                                                </span>
                                                            )}
                                                        </p>
                                                    </div>
                                                    {/* Outbound bot avatar */}
                                                    {message.direction === 'outbound' && message.ai_generated && (
                                                        <div className="w-7 h-7 bg-primary-500/20 rounded-full flex items-center justify-center ml-2 mt-1 flex-shrink-0">
                                                            <Bot className="w-3.5 h-3.5 text-primary-600" />
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Input Area */}
                        <div className="p-4 border-t border-silk-beige">
                            <div className="flex items-end gap-3">
                                <div className="flex-1 relative">
                                    <textarea
                                        value={newMessage}
                                        onChange={(e) => setNewMessage(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                        placeholder="Escribe un mensaje..."
                                        rows={1}
                                        className="w-full px-4 py-3 bg-ivory border border-silk-beige rounded-soft text-sm placeholder:text-charcoal/40 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 resize-none"
                                    />
                                </div>
                                <button
                                    onClick={handleSend}
                                    disabled={!newMessage.trim() || sending}
                                    className={cn(
                                        "btn-primary p-3",
                                        (!newMessage.trim() || sending) && "opacity-50 cursor-not-allowed"
                                    )}
                                >
                                    {sending ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                                </button>
                            </div>
                            <p className="text-xs mt-2 text-center">
                                {selectedConversation.requires_human ? (
                                    <span className="text-red-500 font-medium">La IA está pausada. Reactívala arriba si deseas que el bot vuelva a responderle al tutor automáticamente.</span>
                                ) : (
                                    <span className="text-charcoal/40">El asistente IA responderá automáticamente cuando no escribas manualmente</span>
                                )}
                            </p>
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex items-center justify-center text-charcoal/40">
                        <div className="text-center">
                            <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
                            <p className="text-sm">Selecciona una conversación</p>
                        </div>
                    </div>
                )}
            </div>

            {showSidebar && sidebarPhone && profile?.clinic_id && (
                <div className="fixed inset-0 z-50 md:relative md:inset-auto md:z-0 flex justify-end">
                    <div
                        className="absolute inset-0 bg-charcoal/20 backdrop-blur-sm md:hidden"
                        onClick={() => setShowSidebar(false)}
                    />
                    <div className="relative z-10 h-full">
                        <ContactInfoSidebar
                            phoneNumber={sidebarPhone}
                            clinicId={profile.clinic_id}
                            onClose={() => setShowSidebar(false)}
                        />
                    </div>
                </div>
            )}
        </div>
    )
}
