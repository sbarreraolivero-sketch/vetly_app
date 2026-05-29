import { useState, useEffect } from 'react'
import { Outlet, NavLink, Link, useLocation, useNavigate } from 'react-router-dom'
import {
    LayoutDashboard,
    MessageSquare,
    Calendar,
    Settings,
    Sparkles,
    Bell,
    User,
    Users,
    LogOut,
    ChevronDown,
    CalendarPlus,
    CalendarCheck,
    CalendarX,
    Clock,
    Star,
    BookOpen,
    Megaphone,
    DollarSign,
    Menu,
    X,
    FileText,
    BellOff,
    Heart,
    Target,
    Plug,
    SlidersHorizontal,
    Package,
} from 'lucide-react'
import { AIChatWidget } from '../AIChatWidget'
import { cn, getInitials } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import BranchSwitcher from './BranchSwitcher'
import { usePermissions } from '@/hooks/usePermissions'
import type { PageKey } from '@/lib/permissions'

interface Notification {
    id: string
    type: string
    title: string
    message: string
    is_read: boolean
    created_at: string
}

const navigationSections = [
    {
        label: 'Principal',
        accent: { label: 'text-sky-400/70', active: 'bg-sky-500/[0.18]', dot: 'bg-sky-400', icon: 'text-sky-300' },
        items: [
            { name: 'Dashboard', href: '/app/dashboard', icon: LayoutDashboard, pageKey: 'dashboard' as PageKey },
            { name: 'Mensajes', href: '/app/messages', icon: MessageSquare, pageKey: 'messages' as PageKey },
            { name: 'Plantillas', href: '/app/templates', icon: FileText, pageKey: 'templates' as PageKey },
        ]
    },
    {
        label: 'Clínica',
        accent: { label: 'text-primary-400/70', active: 'bg-primary-500/[0.18]', dot: 'bg-primary-400', icon: 'text-primary-300' },
        items: [
            { name: 'Tutores', href: '/app/tutors', icon: Users, pageKey: 'tutors' as PageKey },
            { name: 'Pacientes', href: '/app/patients', icon: Heart, pageKey: 'patients' as PageKey },
            { name: 'CRM', href: '/app/crm', icon: Target, pageKey: 'crm' as PageKey },
            { name: 'Citas Médicas', href: '/app/appointments', icon: Calendar, pageKey: 'appointments' as PageKey },
            { name: 'Recordatorios', href: '/app/reminders', icon: Clock, pageKey: 'reminders' as PageKey },
            { name: 'Finanzas', href: '/app/finance', icon: DollarSign, pageKey: 'finance' as PageKey },
            { name: 'Inventario', href: '/app/inventory', icon: Package, pageKey: 'inventory' as PageKey },
        ]
    },
    {
        label: 'Marketing',
        accent: { label: 'text-violet-400/70', active: 'bg-violet-500/[0.18]', dot: 'bg-violet-400', icon: 'text-violet-300' },
        items: [
            { name: 'Campañas', href: '/app/campaigns', icon: Megaphone, pageKey: 'campaigns' as PageKey },
            { name: 'Fidelización', href: '/app/loyalty', icon: Star, pageKey: 'loyalty' as PageKey },
        ]
    },
    {
        label: 'Agente IA',
        accent: { label: 'text-sky-400/70', active: 'bg-sky-500/[0.18]', dot: 'bg-sky-400', icon: 'text-sky-300' },
        items: [
            { name: 'Conocimiento', href: '/app/knowledge-base', icon: BookOpen, pageKey: 'knowledge_base' as PageKey },
            { name: 'Integraciones', href: '/app/integrations', icon: Plug, pageKey: 'integrations' as PageKey },
            { name: 'Ajustes IA', href: '/app/ai-settings', icon: SlidersHorizontal, pageKey: 'ai_settings' as PageKey },
        ]
    },
    {
        label: 'Configuración',
        accent: { label: 'text-amber-400/70', active: 'bg-amber-500/[0.18]', dot: 'bg-amber-400', icon: 'text-amber-300' },
        items: [
            { name: 'Configuración', href: '/app/settings', icon: Settings, pageKey: 'settings' as PageKey },
        ]
    },
]

// Flat list for header title lookup
const navigation = navigationSections.flatMap(s => s.items)

const getNotificationIcon = (type: string) => {
    switch (type) {
        case 'new_appointment':
            return <CalendarPlus className="w-4 h-4 text-blue-500" />
        case 'confirmed':
            return <CalendarCheck className="w-4 h-4 text-emerald-500" />
        case 'cancelled':
            return <CalendarX className="w-4 h-4 text-red-500" />
        case 'pending_reminder':
            return <Clock className="w-4 h-4 text-amber-500" />
        case 'new_message':
            return <MessageSquare className="w-4 h-4 text-primary-500" />
        case 'survey_response':
            return <Star className="w-4 h-4 text-yellow-500" />
        case 'human_handoff':
            return <BellOff className="w-4 h-4 text-red-500" />
        default:
            return <Bell className="w-4 h-4 text-charcoal/50" />
    }
}

export default function DashboardLayout() {
    const location = useLocation()
    const navigate = useNavigate()
    const { user, profile, member, signOut } = useAuth()

    const { canAccess } = usePermissions()

    const [showUserMenu, setShowUserMenu] = useState(false)
    const [showNotifications, setShowNotifications] = useState(false)
    const [notifications, setNotifications] = useState<Notification[]>([])
    const [notificationsLimit, setNotificationsLimit] = useState(10)
    const [loadingMore, setLoadingMore] = useState(false)
    const [hasMore, setHasMore] = useState(true)

    // Check activation status and redirect
    useEffect(() => {
        const checkActivation = async () => {
            // Bypass for known owner emails - ALWAYS ALLOW ACCESS
            const ownerEmails = ['claubarreraolivero@gmail.com', 'sebabarreraolivero@gmail.com', 'sebabarrera@gmail.com']
            if (user?.email && ownerEmails.includes(user.email.toLowerCase().trim())) {
                console.log('✅ DashboardLayout: Nuclear owner bypass active for:', user.email);
                return;
            }

            if (profile?.clinic_id) {
                console.log('DashboardLayout checkActivation for clinic:', profile.clinic_id);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { data } = await (supabase as any)
                    .from('clinic_settings')
                    .select('activation_status')
                    .eq('id', profile.clinic_id)
                    .single()

                if (data?.activation_status === 'pending_activation') {
                    console.warn('DashboardLayout: Redirecting to pending-activation due to clinic status:', data.activation_status);
                    navigate('/pending-activation', { replace: true })
                    return
                }

                // Check if trial has expired without conversion
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { data: subData } = await (supabase as any)
                    .from('subscriptions')
                    .select('status, trial_ends_at')
                    .eq('clinic_id', profile.clinic_id)
                    .single()

                if (subData) {
                    const trialExpired = subData.trial_ends_at && new Date(subData.trial_ends_at) < new Date()
                    const notActive = subData.status !== 'active'
                    if (trialExpired && notActive && location.pathname !== '/app/settings') {
                        console.warn('DashboardLayout: Trial expired, redirecting to settings/plan')
                        navigate('/app/settings?tab=subscription&expired=1', { replace: true })
                    }
                }
            }
        }
        checkActivation();
    }, [user?.email, profile?.clinic_id, navigate])

    // Fetch notifications
    useEffect(() => {
        const fetchNotifications = async () => {
            if (!profile?.clinic_id) return

            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { data, error } = await (supabase as any)
                    .from('notifications')
                    .select('*')
                    .eq('clinic_id', profile.clinic_id)
                    .order('created_at', { ascending: false })
                    .limit(notificationsLimit)

                if (error) throw error
                setNotifications(data || [])
                
                // If we got exactly the limit, there's likely more to load
                setHasMore((data?.length || 0) === notificationsLimit)
            } catch (error) {
                console.error('Error fetching notifications:', error)
            }
        }

        fetchNotifications()

        // Refresh notifications every 30 seconds
        const interval = setInterval(fetchNotifications, 30000)
        return () => clearInterval(interval)
    }, [profile?.clinic_id, notificationsLimit])

    const handleLoadMore = async (e: React.MouseEvent) => {
        e.stopPropagation()
        setLoadingMore(true)
        // Artificial delay for smooth feel
        await new Promise(resolve => setTimeout(resolve, 500))
        setNotificationsLimit(prev => prev + 10)
        setLoadingMore(false)
    }

    const unreadCount = notifications.filter(n => !n.is_read).length

    const markAsRead = async (notificationId: string) => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase as any)
                .from('notifications')
                .update({ is_read: true })
                .eq('id', notificationId)

            setNotifications(prev =>
                prev.map(n => n.id === notificationId ? { ...n, is_read: true } : n)
            )
        } catch (error) {
            console.error('Error marking notification as read:', error)
        }
    }

    const markAllAsRead = async () => {
        const unreadIds = notifications.filter(n => !n.is_read).map(n => n.id)
        if (unreadIds.length === 0) return

        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase as any)
                .from('notifications')
                .update({ is_read: true })
                .in('id', unreadIds)

            setNotifications(prev =>
                prev.map(n => unreadIds.includes(n.id) ? { ...n, is_read: true } : n)
            )
        } catch (error) {
            console.error('Error marking all as read:', error)
        }
    }

    // Handle closing notifications - mark all as read
    useEffect(() => {
        if (!showNotifications && notifications.some(n => !n.is_read)) {
            markAllAsRead()
        }
    }, [showNotifications])

    const handleNotificationClick = (notification: Notification) => {
        markAsRead(notification.id)
        setShowNotifications(false)

        // Route mapping
        switch (notification.type) {
            case 'new_appointment':
            case 'confirmed':
            case 'cancelled':
            case 'pending_reminder':
                navigate('/app/appointments')
                break
            case 'new_message':
            case 'human_handoff':
                navigate('/app/messages')
                break
            case 'survey_response':
                navigate('/app/dashboard')
                break
            default:
                // Fallback to dashboard or stay on current page
                break
        }
    }

    const formatFullDate = (dateString: string) => {
        const date = new Date(dateString)
        return date.toLocaleString('es-CL', {
            weekday: 'long',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        })
    }

    const formatTimeAgo = (dateString: string) => {
        const date = new Date(dateString)
        const now = new Date()
        const diffMs = now.getTime() - date.getTime()
        const diffMins = Math.floor(diffMs / 60000)
        const diffHours = Math.floor(diffMs / 3600000)
        const diffDays = Math.floor(diffMs / 86400000)

        if (diffMins < 1) return 'Ahora'
        if (diffMins < 60) return `${diffMins}m`
        if (diffHours < 24) return `${diffHours}h`
        return `${diffDays}d`
    }

    const handleSignOut = async () => {
        try {
            await signOut()
        } catch (error) {
            console.error('Sign out error:', error)
        } finally {
            navigate('/login')
        }
    }

    // For demo purposes, show placeholder if not authenticated
    const userName = profile?.full_name || 'Usuario Demo'
    // const clinicName = 'Clínica Demo' // Will come from clinic_settings later
    const userRole = member?.job_title || (
        (profile as any)?.role === 'owner' ? 'Dueño' :
            (profile as any)?.role === 'admin' ? 'Administrador' :
                (profile as any)?.role === 'professional' ? 'Profesional' :
                    (profile as any)?.role === 'receptionist' ? 'Recepción' :
                        'Staff'
    )

    const [showMobileMenu, setShowMobileMenu] = useState(false)
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)

    return (
        <div className="flex h-screen bg-ivory overflow-hidden">
            {/* Mobile Sidebar Overlay */}
            {showMobileMenu && (
                <div
                    className="fixed inset-0 bg-charcoal/50 z-40 md:hidden"
                    onClick={() => setShowMobileMenu(false)}
                />
            )}

            <aside className={cn(
                "fixed inset-y-0 left-0 z-50 bg-[#111827] flex flex-col transition-all duration-300 ease-in-out md:relative md:translate-x-0 hidden md:flex",
                isSidebarCollapsed ? "w-[68px]" : "w-[216px]"
            )}>
                {/* Logo */}
                <div
                    className="h-14 flex items-center gap-3 px-4 border-b border-white/[0.06] cursor-pointer hover:bg-white/[0.03] transition-colors shrink-0"
                    onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                >
                    <div className="w-8 h-8 shrink-0 rounded-lg bg-gradient-to-br from-primary-500 to-sky-400 flex items-center justify-center">
                        <Sparkles className="w-4 h-4 text-white" />
                    </div>
                    <div className={cn("transition-all duration-200 overflow-hidden", isSidebarCollapsed ? "w-0 opacity-0" : "opacity-100")}>
                        <p className="text-[15px] font-bold text-white leading-tight tracking-tight">Vetly</p>
                        <p className="text-[10px] text-white/35 font-medium tracking-widest uppercase leading-none">Veterinary AI</p>
                    </div>
                </div>

                {/* Navigation */}
                <nav className="flex-1 py-3 overflow-y-auto scrollbar-soft">
                    {navigationSections.map((section) => {
                        const visibleItems = section.items.filter(item => canAccess(item.pageKey))

                        if (visibleItems.length === 0) return null

                        return (
                            <div key={section.label} className="mb-1">
                                {!isSidebarCollapsed && (
                                    <p className={cn("px-4 pt-4 pb-1 text-[10px] font-bold uppercase tracking-[0.1em]", section.accent.label)}>
                                        {section.label}
                                    </p>
                                )}
                                {visibleItems.map((item) => {
                                    const [itemPath, itemQuery] = item.href.split('?')
                                    const isActive = itemQuery
                                        ? location.pathname === itemPath && location.search === `?${itemQuery}`
                                        : location.pathname === item.href
                                    return (
                                        <NavLink
                                            key={item.name}
                                            to={item.href}
                                            title={isSidebarCollapsed ? item.name : undefined}
                                            className={cn(
                                                'relative flex items-center gap-3 mx-2 px-3 py-[9px] rounded-lg text-[13px] font-medium transition-all duration-150',
                                                isActive
                                                    ? cn(section.accent.active, 'text-white')
                                                    : 'text-white/50 hover:bg-white/[0.05] hover:text-white/85',
                                                isSidebarCollapsed && 'justify-center px-0 mx-1'
                                            )}
                                        >
                                            {isActive && (
                                                <span className={cn("absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full", section.accent.dot)} />
                                            )}
                                            <item.icon className={cn(
                                                "shrink-0 w-[18px] h-[18px]",
                                                isActive ? section.accent.icon : "text-white/40"
                                            )} />
                                            <span className={cn("transition-all duration-200 overflow-hidden whitespace-nowrap", isSidebarCollapsed ? "w-0 opacity-0" : "opacity-100")}>
                                                {item.name}
                                            </span>
                                        </NavLink>
                                    )
                                })}
                            </div>
                        )
                    })}
                </nav>

                {/* Footer - AI Status */}
                <div className="p-3 border-t border-white/[0.06] shrink-0">
                    <div className={cn(
                        "flex items-center gap-3 rounded-xl bg-primary-500/[0.12] border border-primary-500/25 transition-all duration-200",
                        isSidebarCollapsed ? "p-2 justify-center" : "px-3 py-3"
                    )}>
                        <div className="shrink-0 w-2 h-2 bg-primary-400 rounded-full animate-pulse-soft" />
                        <div className={cn("min-w-0 overflow-hidden transition-all duration-200", isSidebarCollapsed ? "w-0 opacity-0" : "opacity-100")}>
                            <p className="text-[13px] font-semibold text-white leading-tight">IA Activa</p>
                            <p className="text-[11px] text-white/40">Respondiendo 24/7</p>
                        </div>
                    </div>
                </div>
            </aside>

            {/* Mobile Sidebar */}
            <aside className={cn(
                "fixed inset-y-0 left-0 z-50 w-[216px] bg-[#111827] flex flex-col transition-transform duration-300 ease-in-out md:hidden",
                showMobileMenu ? "translate-x-0" : "-translate-x-full"
            )}>
                <div className="h-14 flex items-center justify-between px-4 border-b border-white/[0.06] shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-sky-400 flex items-center justify-center">
                            <Sparkles className="w-4 h-4 text-white" />
                        </div>
                        <div>
                            <p className="text-[15px] font-bold text-white leading-tight">Vetly</p>
                            <p className="text-[10px] text-white/35 uppercase tracking-widest">Veterinary AI</p>
                        </div>
                    </div>
                    <button onClick={() => setShowMobileMenu(false)} className="p-1.5 text-white/40 hover:text-white">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <nav className="flex-1 py-3 overflow-y-auto scrollbar-soft">
                    {navigationSections.map((section) => {
                        const visibleItems = section.items.filter(item => canAccess(item.pageKey))
                        if (visibleItems.length === 0) return null
                        return (
                            <div key={section.label} className="mb-1">
                                <p className={cn("px-4 pt-4 pb-1 text-[10px] font-bold uppercase tracking-[0.1em]", section.accent.label)}>{section.label}</p>
                                {visibleItems.map((item) => {
                                    const [itemPath, itemQuery] = item.href.split('?')
                                    const isActive = itemQuery
                                        ? location.pathname === itemPath && location.search === `?${itemQuery}`
                                        : location.pathname === item.href
                                    return (
                                        <NavLink key={item.name} to={item.href} onClick={() => setShowMobileMenu(false)}
                                            className={cn(
                                                'relative flex items-center gap-3 mx-2 px-3 py-[9px] rounded-lg text-[13px] font-medium transition-all duration-150',
                                                isActive ? cn(section.accent.active, 'text-white') : 'text-white/50 hover:bg-white/[0.05] hover:text-white/85'
                                            )}>
                                            {isActive && <span className={cn("absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full", section.accent.dot)} />}
                                            <item.icon className={cn("shrink-0 w-[18px] h-[18px]", isActive ? section.accent.icon : "text-white/40")} />
                                            <span>{item.name}</span>
                                        </NavLink>
                                    )
                                })}
                            </div>
                        )
                    })}
                </nav>
                <div className="p-3 border-t border-white/[0.06] shrink-0">
                    <div className="flex items-center gap-3 rounded-xl bg-primary-500/[0.12] border border-primary-500/25 px-3 py-3">
                        <div className="w-2 h-2 bg-primary-400 rounded-full animate-pulse-soft shrink-0" />
                        <div>
                            <p className="text-[13px] font-semibold text-white">IA Activa</p>
                            <p className="text-[11px] text-white/40">Respondiendo 24/7</p>
                        </div>
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <div className="flex-1 flex flex-col w-full min-w-0">
                {/* Header */}
                <header className="h-14 border-b border-silk-beige flex items-center justify-between px-4 md:px-6 bg-white shrink-0">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setShowMobileMenu(true)}
                            className="p-2 -ml-2 text-charcoal/60 hover:text-charcoal hover:bg-silk-beige/50 rounded-lg md:hidden"
                        >
                            <Menu className="w-5 h-5" />
                        </button>
                        <h2 className="text-[15px] font-bold text-charcoal tracking-tight truncate">
                            {navigation.find((n) => n.href === location.pathname)?.name || 'Dashboard'}
                        </h2>
                    </div>

                    <div className="flex items-center gap-4">
                        {/* Notifications */}
                        <div className="relative">
                            <button
                                onClick={() => setShowNotifications(!showNotifications)}
                                className="relative p-2 text-charcoal/60 hover:text-charcoal hover:bg-silk-beige/50 rounded-soft transition-colors"
                            >
                                <Bell className="w-5 h-5" />
                                {unreadCount > 0 && (
                                    <span className="absolute top-1 right-1 w-4 h-4 bg-primary-500 rounded-full text-xs font-bold text-white flex items-center justify-center">
                                        {unreadCount > 9 ? '9+' : unreadCount}
                                    </span>
                                )}
                            </button>

                            {showNotifications && (
                                <div className="fixed top-16 left-4 right-4 sm:absolute sm:top-auto sm:left-auto sm:right-0 sm:mt-2 sm:w-96 bg-white rounded-soft shadow-soft-lg border border-silk-beige z-[100]">
                                    <div className="px-4 py-3 border-b border-silk-beige flex items-center justify-between">
                                        <h3 className="font-medium text-charcoal">Notificaciones</h3>
                                        <span className="text-xs text-charcoal/50">{unreadCount} nuevas</span>
                                    </div>
                                    <div className="max-h-80 overflow-auto">
                                        {notifications.length === 0 ? (
                                            <div className="py-8 text-center">
                                                <Bell className="w-10 h-10 text-charcoal/20 mx-auto mb-3" />
                                                <p className="text-sm text-charcoal/50">No tienes notificaciones</p>
                                                <p className="text-xs text-charcoal/40 mt-1">Las notificaciones aparecerán aquí</p>
                                            </div>
                                        ) : (
                                            <div className="divide-y divide-silk-beige">
                                                {notifications.map((notification) => (
                                                    <div
                                                        key={notification.id}
                                                        className={cn(
                                                            "px-4 py-3 hover:bg-ivory/50 cursor-pointer transition-colors",
                                                            !notification.is_read && "bg-primary-50/30"
                                                        )}
                                                        onClick={() => handleNotificationClick(notification)}
                                                    >
                                                        <div className="flex items-start gap-3">
                                                            <div className="mt-0.5">
                                                                {getNotificationIcon(notification.type)}
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <p className={cn(
                                                                    "text-sm text-charcoal",
                                                                    !notification.is_read && "font-medium"
                                                                )}>
                                                                    {notification.title}
                                                                </p>
                                                                <p className="text-xs text-charcoal/50 mt-0.5 truncate">
                                                                    {notification.message}
                                                                </p>
                                                                <p className="text-xs text-charcoal/40 mt-1">
                                                                    {formatFullDate(notification.created_at)} • Hace {formatTimeAgo(notification.created_at)}
                                                                </p>
                                                            </div>
                                                            {!notification.is_read && (
                                                                <div className="w-2 h-2 bg-primary-500 rounded-full mt-1.5" />
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}

                                                {hasMore && (
                                                    <button
                                                        onClick={handleLoadMore}
                                                        disabled={loadingMore}
                                                        className="w-full py-3 px-4 text-xs font-bold text-primary-600 hover:bg-ivory/50 transition-colors border-t border-silk-beige flex items-center justify-center gap-2"
                                                    >
                                                        {loadingMore ? (
                                                            <>
                                                                <div className="w-3 h-3 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
                                                                Cargando más...
                                                            </>
                                                        ) : (
                                                            'Ver más notificaciones pasadas'
                                                        )}
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    <div className="px-4 py-2 border-t border-silk-beige">
                                        <button
                                            onClick={() => {
                                                setShowNotifications(false)
                                                navigate('/app/settings?tab=notifications')
                                            }}
                                            className="text-xs text-primary-600 hover:underline"
                                        >
                                            Configurar notificaciones
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* User Menu */}
                        <div className="relative z-50 flex items-center gap-4">
                            {/* Branch Switcher (Desktop) */}
                            <div className="hidden md:block w-56">
                                <BranchSwitcher />
                            </div>

                            <button
                                onClick={() => setShowUserMenu(!showUserMenu)}
                                className="flex items-center gap-3 pl-4 border-l border-silk-beige hover:bg-silk-beige/30 rounded-soft p-2 transition-colors"
                            >
                                <div className="text-right hidden md:block">
                                    <p className="text-sm font-medium text-charcoal">{userName}</p>
                                    <p className="text-xs text-charcoal/50">{userRole}</p>
                                </div>
                                <div className="w-10 h-10 bg-primary-500 rounded-full flex items-center justify-center text-white font-medium">
                                    {getInitials(userName)}
                                </div>
                                <ChevronDown className={cn(
                                    "w-4 h-4 text-charcoal/40 transition-transform",
                                    showUserMenu && "rotate-180"
                                )} />
                            </button>

                            {/* Dropdown Menu */}
                            {showUserMenu && (
                                <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-soft shadow-soft-lg border border-silk-beige py-1 z-50">
                                    <div className="px-4 py-3 border-b border-silk-beige md:hidden">
                                        <p className="text-sm font-medium text-charcoal">{userName}</p>
                                        <p className="text-xs text-charcoal/50">{profile?.email}</p>
                                    </div>

                                    {/* Mobile Branch Switcher */}
                                    <div className="md:hidden px-2 py-2 border-b border-silk-beige">
                                        <BranchSwitcher />
                                    </div>

                                    <Link
                                        to="/app/settings?tab=profile"
                                        onClick={() => setShowUserMenu(false)}
                                        className="w-full flex items-center gap-3 px-4 py-2 text-sm text-charcoal/70 hover:bg-silk-beige/50 transition-colors"
                                    >
                                        <User className="w-4 h-4" />
                                        Mi Perfil
                                    </Link>
                                    <Link
                                        to="/app/settings"
                                        onClick={() => setShowUserMenu(false)}
                                        className="w-full flex items-center gap-3 px-4 py-2 text-sm text-charcoal/70 hover:bg-silk-beige/50 transition-colors"
                                    >
                                        <Settings className="w-4 h-4" />
                                        Configuración
                                    </Link>
                                    <div className="border-t border-silk-beige mt-1 pt-1">
                                        <button
                                            onClick={handleSignOut}
                                            className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                                        >
                                            <LogOut className="w-4 h-4" />
                                            Cerrar Sesión
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </header>

                {/* Page Content */}
                <main className="flex-1 overflow-auto p-3 sm:p-6 scrollbar-soft">
                    <Outlet />
                </main>
            </div>

            {/* Click outside to close menus */}
            {(showUserMenu || showNotifications) && (
                <div
                    className="fixed inset-0 z-40 bg-transparent"
                    onClick={() => {
                        setShowUserMenu(false)
                        setShowNotifications(false)
                    }}
                />
            )}

            {/* AI Support Agent Widget */}
            <AIChatWidget variant="simulator" clinicId={profile?.clinic_id} />
        </div>
    )
}

