import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { Loader2 } from 'lucide-react'

// Layouts
const DashboardLayout = lazy(() => import('./components/layout/DashboardLayout'))
const AdminLayout = lazy(() => import('./components/layout/AdminLayout'))

// Pages
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Messages = lazy(() => import('./pages/Messages'))
const Appointments = lazy(() => import('./pages/Appointments'))
const Tutors = lazy(() => import('./pages/Tutors'))
const Patients = lazy(() => import('./pages/Patients'))
const PatientProfile = lazy(() => import('./pages/PatientProfile'))
const Settings = lazy(() => import('./pages/Settings'))
const KnowledgeBase = lazy(() => import('./pages/KnowledgeBase'))
const CRM = lazy(() => import('./pages/CRM'))
const Campaigns = lazy(() => import('./pages/Campaigns'))
const Finance = lazy(() => import('./pages/Finance'))
// const RetentionEngine = lazy(() => import('./pages/RetentionEngine'))
const Templates = lazy(() => import('./pages/Templates'))
const Loyalty = lazy(() => import('./pages/Loyalty'))
const Pricing = lazy(() => import('./pages/Pricing'))
const Login = lazy(() => import('./pages/Login'))
const Register = lazy(() => import('./pages/Register'))
const Landing = lazy(() => import('./pages/Landing'))
const Terms = lazy(() => import('./pages/Terms'))
const Privacy = lazy(() => import('./pages/Privacy'))
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'))
const UpdatePassword = lazy(() => import('./pages/UpdatePassword'))
const PendingActivation = lazy(() => import('./pages/PendingActivation').then(m => ({ default: m.PendingActivation })))

// HQ Pages
const AdminDashboard = lazy(() => import('./pages/hq/AdminDashboard'))
const AdminClinics = lazy(() => import('./pages/hq/AdminClinics'))
const AdminSettings = lazy(() => import('./pages/hq/AdminSettings'))
const AdminLogin = lazy(() => import('./pages/hq/AdminLogin'))
const AdminCalendar = lazy(() => import('./pages/hq/AdminCalendar'))

// Contexts & Guards
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { AdminAuthProvider } from './contexts/AdminAuthContext'
import ProtectedRoute from './components/auth/ProtectedRoute'
import { SubscriptionGuard } from './components/auth/SubscriptionGuard'
import { AdminProtectedRoute } from './components/auth/AdminProtectedRoute'
import { RoleGuard } from './components/auth/RoleGuard'

// Loading component
const PageLoader = () => (
    <div className="flex h-screen w-full items-center justify-center bg-ivory">
        <Loader2 className="w-10 h-10 animate-spin text-primary-500" />
    </div>
)

// HQ routes use ONLY AdminAuthProvider (no AuthProvider interference)
function HQRoutes() {
    return (
        <AdminAuthProvider>
            <Suspense fallback={<PageLoader />}>
                <Routes>
                    <Route path="login" element={<AdminLogin />} />
                    <Route element={<AdminProtectedRoute />}>
                        <Route element={<AdminLayout />}>
                            <Route index element={<Navigate to="dashboard" replace />} />
                            <Route path="dashboard" element={<AdminDashboard />} />
                            <Route path="calendar" element={<AdminCalendar />} />
                            <Route path="clinics" element={<AdminClinics />} />
                            <Route path="settings" element={<AdminSettings />} />
                        </Route>
                    </Route>
                </Routes>
            </Suspense>
        </AdminAuthProvider>
    )
}

// Main app routes use AuthProvider for clinic users
function MainRoutes() {
    return (
        <AuthProvider>
            <AuthWrapper>
                <Suspense fallback={<PageLoader />}>
                    <Routes>
                        {/* Public Routes */}
                        <Route path="/" element={<Landing />} />
                        <Route path="/terminos" element={<Terms />} />
                        <Route path="/terms" element={<Navigate to="/terminos" replace />} />
                        <Route path="/privacidad" element={<Privacy />} />
                        <Route path="/privacy" element={<Navigate to="/privacidad" replace />} />
                        <Route path="/pricing" element={<Pricing />} />
                        <Route path="/forgot-password" element={<ForgotPassword />} />
                        <Route path="/update-password" element={<UpdatePassword />} />
                        <Route
                            path="/login"
                            element={
                                <ProtectedRoute requireAuth={false}>
                                    <Login />
                                </ProtectedRoute>
                            }
                        />
                        <Route
                            path="/register"
                            element={
                                <ProtectedRoute requireAuth={false}>
                                    <Register />
                                </ProtectedRoute>
                            }
                        />

                        {/* Pending Activation Route */}
                        <Route
                            path="/pending-activation"
                            element={
                                <ProtectedRoute requireAuth={true}>
                                    <PendingActivation />
                                </ProtectedRoute>
                            }
                        />

                        {/* Protected Routes */}
                        <Route
                            path="/app"
                            element={
                                <ProtectedRoute>
                                    <DashboardLayout />
                                </ProtectedRoute>
                            }
                        >
                            <Route index element={<Navigate to="/app/dashboard" replace />} />
                            <Route path="dashboard" element={
                                <SubscriptionGuard>
                                    <Dashboard />
                                </SubscriptionGuard>
                            } />
                            <Route path="messages" element={
                                <SubscriptionGuard>
                                    <Messages />
                                </SubscriptionGuard>
                            } />
                            <Route path="appointments" element={
                                <SubscriptionGuard>
                                    <Appointments />
                                </SubscriptionGuard>
                            } />
                            {/* Domain Tutors & Patients */}
                            <Route path="tutors" element={
                                <SubscriptionGuard>
                                    <Tutors />
                                </SubscriptionGuard>
                            } />
                            <Route path="patients" element={
                                <SubscriptionGuard>
                                    <Patients />
                                </SubscriptionGuard>
                            } />
                            <Route path="patients/:id" element={
                                <SubscriptionGuard>
                                    <PatientProfile />
                                </SubscriptionGuard>
                            } />

                            <Route path="knowledge-base" element={
                                <SubscriptionGuard>
                                    <KnowledgeBase />
                                </SubscriptionGuard>
                            } />
                            <Route path="crm" element={
                                <SubscriptionGuard>
                                    <RoleGuard allowedRoles={['owner']}>
                                        <CRM />
                                    </RoleGuard>
                                </SubscriptionGuard>
                            } />
                            <Route path="campaigns" element={
                                <SubscriptionGuard>
                                    <RoleGuard allowedRoles={['owner']}>
                                        <Campaigns />
                                    </RoleGuard>
                                </SubscriptionGuard>
                            } />
                            <Route path="finance" element={
                                <SubscriptionGuard>
                                    <RoleGuard allowedRoles={['owner']}>
                                        <Finance />
                                    </RoleGuard>
                                </SubscriptionGuard>
                            } />
                            <Route path="templates" element={
                                <SubscriptionGuard>
                                    <RoleGuard allowedRoles={['owner', 'admin']}>
                                        <Templates />
                                    </RoleGuard>
                                </SubscriptionGuard>
                            } />
                            <Route path="loyalty" element={
                                <SubscriptionGuard>
                                    <RoleGuard allowedRoles={['owner', 'admin']}>
                                        <Loyalty />
                                    </RoleGuard>
                                </SubscriptionGuard>
                            } />
                            <Route path="settings" element={<Settings />} />
                        </Route>

                        {/* Legacy redirects */}
                        <Route path="/dashboard" element={<Navigate to="/app/dashboard" replace />} />
                        <Route path="/messages" element={<Navigate to="/app/messages" replace />} />
                        <Route path="/appointments" element={<Navigate to="/app/appointments" replace />} />
                        <Route path="/tutors" element={<Navigate to="/app/tutors" replace />} />
                        <Route path="/patients" element={<Navigate to="/app/tutors" replace />} />
                        <Route path="/settings" element={<Navigate to="/app/settings" replace />} />

                        {/* Catch all */}
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                </Suspense>
            </AuthWrapper>
        </AuthProvider>
    )
}

// Add AuthWrapper at the top of App.tsx or inside MainRoutes

function AuthWrapper({ children }: { children: React.ReactNode }) {
    const { user, profile } = useAuth()
    const location = useLocation()
    const navigate = useNavigate()

    useEffect(() => {
        const ownerEmails = ['claubarreraolivero@gmail.com', 'sebabarreraolivero@gmail.com', 'sebabarrera@gmail.com']
        const userEmail = user?.email?.toLowerCase().trim()
        
        if (userEmail && ownerEmails.includes(userEmail)) {
            if (location.pathname === '/pending-activation') {
                console.log('✅ Global AuthWrapper: Owner bypass redirecting to /app');
                navigate('/app', { replace: true })
            }
        }
    }, [user, profile, location.pathname, navigate])

    return <>{children}</>
}

function App() {
    return (
        <BrowserRouter>
            <Routes>
                {/* HQ routes — completely isolated from AuthProvider */}
                <Route path="/hq/*" element={<HQRoutes />} />

                {/* Everything else — uses AuthProvider */}
                <Route path="/*" element={<MainRoutes />} />
            </Routes>
            <Toaster position="top-right" />
        </BrowserRouter>
    )
}

export default App
