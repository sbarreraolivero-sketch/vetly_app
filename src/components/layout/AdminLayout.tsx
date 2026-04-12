import { useState } from 'react'
import { Outlet, useNavigate, Link, useLocation } from 'react-router-dom'
import { ShieldAlert, LogOut, Users, Activity, Settings as SettingsIcon, Calendar, LayoutDashboard, MessageSquare, Menu, X } from 'lucide-react'
import { useAdminAuth } from '@/contexts/AdminAuthContext'
import { cn } from '@/lib/utils'

export default function AdminLayout() {
    const { signOutAdmin, adminUser } = useAdminAuth()
    const navigate = useNavigate()
    const location = useLocation()
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

    const handleSignOut = async () => {
        await signOutAdmin()
        navigate('/hq/login', { replace: true })
    }

    const navigation = [
        { name: 'Activaciones', href: '/hq/dashboard', icon: Activity },
        { name: 'CRM Prospectos', href: '/hq/crm', icon: LayoutDashboard },
        { name: 'Mensajes', href: '/hq/messages', icon: MessageSquare },
        { name: 'Calendario', href: '/hq/calendar', icon: Calendar },
        { name: 'Clínicas', href: '/hq/clinics', icon: Users },
        { name: 'Configuración', href: '/hq/settings', icon: SettingsIcon },
    ]

    const toggleMobileMenu = () => setIsMobileMenuOpen(!isMobileMenuOpen)

    return (
        <div className="flex bg-gray-900 min-h-screen relative overflow-hidden">
            {/* Mobile Header */}
            <div className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-4 z-50">
                <div className="flex items-center">
                    <ShieldAlert className="w-6 h-6 text-primary-500 mr-2" />
                    <span className="text-lg font-bold text-white tracking-tight">Vetly HQ</span>
                </div>
                <button
                    onClick={toggleMobileMenu}
                    className="p-2 text-gray-400 hover:text-white transition-all bg-gray-800/50 rounded-xl"
                >
                    {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
                </button>
            </div>

            {/* Overlay */}
            {isMobileMenuOpen && (
                <div
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden transition-opacity duration-300 animate-in fade-in"
                    onClick={() => setIsMobileMenuOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside className={cn(
                "fixed inset-y-0 left-0 w-72 bg-gray-900 border-r border-gray-800 flex flex-col z-50 transform transition-all duration-300 ease-in-out lg:relative lg:translate-x-0 lg:z-0",
                isMobileMenuOpen ? "translate-x-0 !shadow-2xl shadow-black/50" : "-translate-x-full"
            )}>
                <div className="h-16 flex items-center px-6 border-b border-gray-800 shrink-0">
                    <ShieldAlert className="w-6 h-6 text-primary-500 mr-3" />
                    <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary-400 to-primary-600 tracking-tight">
                        Vetly AI HQ
                    </span>
                </div>

                <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
                    {navigation.map((item) => {
                        const isActive = location.pathname === item.href
                        const Icon = item.icon
                        return (
                            <Link
                                key={item.name}
                                to={item.href}
                                onClick={() => setIsMobileMenuOpen(false)}
                                className={cn(
                                    "flex items-center px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 group",
                                    isActive
                                        ? 'bg-primary-500/10 text-primary-400 shadow-[inset_0_0_20px_rgba(var(--primary-rgb),0.05)]'
                                        : 'text-gray-400 hover:bg-gray-800/50 hover:text-white'
                                )}
                            >
                                <Icon className={cn("mr-3 h-5 w-5 transition-colors", isActive ? 'text-primary-400' : 'text-gray-500 group-hover:text-gray-300')} />
                                {item.name}
                            </Link>
                        )
                    })}
                </nav>

                <div className="p-4 border-t border-gray-800 bg-gray-900/50 backdrop-blur-md space-y-4">
                    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gray-800/40 border border-gray-700/50">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-primary-500/20">
                            {adminUser?.email?.charAt(0).toUpperCase() || 'A'}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-white truncate">
                                Admin Platform
                            </p>
                            <p className="text-[10px] text-gray-500 truncate font-bold uppercase tracking-widest opacity-80">
                                {adminUser?.email}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={handleSignOut}
                        className="w-full flex items-center justify-center px-4 py-3 border border-gray-700/50 rounded-xl text-[10px] font-black text-gray-300 bg-gray-800/50 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 transition-all duration-300 gap-2 uppercase tracking-[0.2em]"
                    >
                        <LogOut className="w-3.5 h-3.5" />
                        Cerrar Sesión
                    </button>
                </div>
            </aside>

            {/* Main content */}
            <div className="flex-1 flex flex-col h-screen overflow-hidden bg-[#F8FAFC]">
                <main className={cn(
                    "flex-1 overflow-y-auto w-full pt-16 lg:pt-0",
                    "scrollbar-thin scrollbar-thumb-gray-200 scrollbar-track-transparent"
                )}>
                    <div className="max-w-7xl mx-auto min-h-full">
                        <Outlet />
                    </div>
                </main>
            </div>
        </div>
    )
}
