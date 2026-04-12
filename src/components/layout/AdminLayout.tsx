import { Outlet, useNavigate, Link, useLocation } from 'react-router-dom'
import { ShieldAlert, LogOut, Users, Activity, Settings as SettingsIcon, Calendar, LayoutDashboard, MessageSquare } from 'lucide-react'
import { useAdminAuth } from '@/contexts/AdminAuthContext'

export default function AdminLayout() {
    const { signOutAdmin, adminUser } = useAdminAuth()
    const navigate = useNavigate()
    const location = useLocation()

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

    return (
        <div className="flex bg-gray-900 min-h-screen">
            {/* Sidebar */}
            <div className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col">
                <div className="h-16 flex items-center px-6 border-b border-gray-800">
                    <ShieldAlert className="w-6 h-6 text-primary-500 mr-3" />
                    <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary-400 to-primary-600">
                        Vetly AI HQ
                    </span>
                </div>

                <nav className="flex-1 px-4 py-6 space-y-1">
                    {navigation.map((item) => {
                        const isActive = location.pathname === item.href
                        const Icon = item.icon
                        return (
                            <Link
                                key={item.name}
                                to={item.href}
                                className={`flex items-center px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${isActive
                                    ? 'bg-primary-500/10 text-primary-400'
                                    : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                                    }`}
                            >
                                <Icon className={`mr-3 h-5 w-5 ${isActive ? 'text-primary-400' : 'text-gray-500'}`} />
                                {item.name}
                            </Link>
                        )
                    })}
                </nav>

                <div className="p-4 border-t border-gray-800">
                    <div className="flex items-center gap-3 px-3 py-2">
                        <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center text-gray-300 font-medium">
                            {adminUser?.email?.charAt(0).toUpperCase() || 'A'}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-white truncate">
                                Admin
                            </p>
                            <p className="text-xs text-gray-500 truncate">
                                {adminUser?.email}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={handleSignOut}
                        className="mt-4 w-full flex items-center justify-center px-4 py-2 border border-gray-700 rounded-lg shadow-sm text-sm font-medium text-gray-300 bg-gray-800 hover:bg-gray-700 hover:text-white transition-colors gap-2"
                    >
                        <LogOut className="w-4 h-4" />
                        Cerrar Sesión HQ
                    </button>
                </div>
            </div>

            {/* Main content */}
            <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">
                <main className="flex-1 overflow-y-auto w-full">
                    <Outlet />
                </main>
            </div>
        </div>
    )
}
