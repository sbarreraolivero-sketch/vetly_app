import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import {
    Building2,
    Clock,
    Key,
    Bell,
    Sparkles,
    Save,
    Plus,
    Trash2,
    ChevronRight,
    CreditCard,
    CheckCircle2,
    Zap,
    Copy,
    Check,
    AlertCircle,
    X,
    Loader2,
    User,
    Globe,
    ToggleLeft,
    ToggleRight,
    Tag,
    Users,
    ArrowLeft,
    Instagram,
    Facebook,
    Music,
    History,
    RefreshCw,
    Calendar,
    Phone,
    ShieldAlert,
    Settings2,
    Package,
    CalendarClock,
    Link2,
    Image as ImageIcon,
    Palette,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { PlanGate } from '@/components/common/PlanGate'
import { usePlan } from '@/hooks/usePlan'
import { PLANS, type PlanId, normalizePlanId, redirectToCheckout } from '@/lib/mercadopago'
import { PADDLE_PLANS, type PaddlePlanId, type BillingPeriod, planSupportsAnnual, openPaddleSubscriptionCheckout, onPaddleCheckoutEvent } from '@/lib/paddle'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { TagManager } from '@/components/settings/TagManager'
import PostPaymentOnboardingBanner from '@/components/settings/PostPaymentOnboardingBanner'
import Team from './settings/Team'
import MyProfile from './settings/MyProfile'
import { TemplateSelector } from '@/components/settings/TemplateSelector'
import { toast } from 'react-hot-toast'

const tabs = [
    { id: 'profile', label: 'Mi Perfil', icon: User },
    { id: 'clinic', label: 'Clínica', icon: Building2 },
    { id: 'branding', label: 'Diseño de marca', icon: Palette },
    { id: 'team', label: 'Equipo', icon: Users },
    { id: 'subscription', label: 'Plan', icon: CreditCard },
    { id: 'schedule', label: 'Horarios', icon: Clock },
    { id: 'tags', label: 'Etiquetas', icon: Tag },
    { id: 'notifications', label: 'Notificaciones', icon: Bell },
]

// Mock services data
// Services state is now managed via DB

// Mock working hours
const mockWorkingHours = {
    monday: { open: '09:00', close: '18:00' },
    tuesday: { open: '09:00', close: '18:00' },
    wednesday: { open: '09:00', close: '18:00' },
    thursday: { open: '09:00', close: '18:00' },
    friday: { open: '09:00', close: '18:00' },
    saturday: { open: '09:00', close: '14:00' },
    sunday: null,
}

const dayNames: Record<string, string> = {
    monday: 'Lunes',
    tuesday: 'Martes',
    wednesday: 'Miércoles',
    thursday: 'Jueves',
    friday: 'Viernes',
    saturday: 'Sábado',
    sunday: 'Domingo',
}

const dayOrder = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export default function Settings() {
    const { user, profile, member, refreshClinics } = useAuth()
    const { meetsPlan } = usePlan()
    // Usar la sucursal activa seleccionada (member.clinic_id) en lugar de la clínica raíz del perfil
    const clinicId = member?.clinic_id || profile?.clinic_id
    const [searchParams] = useSearchParams()
    const navigate = useNavigate()

    const availableTabs = tabs.filter(tab => {
        if (!member || member.role === 'owner' || member.role === 'admin') return true

        // Allowed tabs for non-owners
        const allowedTabs = ['profile', 'schedule', 'team', 'notifications']
        return allowedTabs.includes(tab.id)
    })

    const [activeTab, setActiveTab] = useState('profile') // Default to profile for non-owners safety
    const [clinicName, setClinicName] = useState('')
    const [clinicAddress, setClinicAddress] = useState('')
    const [addressReferences, setAddressReferences] = useState('')
    const [googleMapsUrl, setGoogleMapsUrl] = useState('')
    const [instagramUrl, setInstagramUrl] = useState('')
    const [facebookUrl, setFacebookUrl] = useState('')
    const [tiktokUrl, setTiktokUrl] = useState('')
    const [websiteUrl, setWebsiteUrl] = useState('')
    const [contactPhone, setContactPhone] = useState('')
    const [services, setServices] = useState<any[]>([])
    const [workingHours, setWorkingHours] = useState<any>(mockWorkingHours)
    const [businessModel, setBusinessModel] = useState<'physical' | 'mobile' | 'hybrid'>('physical')
    const [schedulingMode, setSchedulingMode] = useState<'ai_autonomous' | 'coordinator_approval'>('ai_autonomous')
    const [coordinatorPhone, setCoordinatorPhone] = useState('')
    // "Logística Pro" = el cálculo automático de tramos/recargo por tiempo de viaje
    // (panel en Conocimiento). Vive dentro de logistics_config.is_active — se
    // conserva el resto del JSON (locations, routing_mode, etc.) tal cual al guardar.
    const [logisticsProEnabled, setLogisticsProEnabled] = useState(false)
    const [logisticsConfigRaw, setLogisticsConfigRaw] = useState<Record<string, any>>({})
    const [showMobileList, setShowMobileList] = useState(true)

    // Diseño de marca (tab "branding", antes "Reservas Online"). El logo y los
    // dos colores alimentan tanto la página pública vetly.pro/reservar/:slug
    // como los documentos descargables (recetas). El toggle/slug de la página
    // de reservas conviven en el mismo tab pero en su propia card.
    // Nota: el prefijo `booking_` de las columnas es histórico.
    const [publicBookingEnabled, setPublicBookingEnabled] = useState(false)
    const [publicBookingSlug, setPublicBookingSlug] = useState('')
    const [bookingLogoUrl, setBookingLogoUrl] = useState('')
    const [bookingBrandColor, setBookingBrandColor] = useState('#0d9488')
    const [bookingBrandColorSecondary, setBookingBrandColorSecondary] = useState('')
    const [savingBooking, setSavingBooking] = useState(false)
    const [uploadingLogo, setUploadingLogo] = useState(false)
    const [bookingLinkCopied, setBookingLinkCopied] = useState(false)

    // Service modal state
    const [showServiceModal, setShowServiceModal] = useState(false)
    const [newServiceName, setNewServiceName] = useState('')
    const [newServiceDuration, setNewServiceDuration] = useState<string>('30')
    const [newServicePrice, setNewServicePrice] = useState<string>('')
    // Producto del inventario que consume este servicio (ej. el servicio
    // "Vacuna Antirrábica" descuenta 1 unidad del producto "Vacuna antirrábica").
    const [newServiceLinkedProductId, setNewServiceLinkedProductId] = useState<string>('')
    const [newServiceLinkedProductQty, setNewServiceLinkedProductQty] = useState<string>('1')
    const [newServicePublicBookable, setNewServicePublicBookable] = useState(false)
    const [inventoryProducts, setInventoryProducts] = useState<any[]>([])

    // Professional assignment state for service modal
    const [clinicProfessionals, setClinicProfessionals] = useState<any[]>([])
    const [assignedProfessionals, setAssignedProfessionals] = useState<Record<string, boolean>>({})
    const [primaryProfessional, setPrimaryProfessional] = useState<string>('')

    // Currency and templates
    const [currency, setCurrency] = useState('CLP')
    const [timezone, setTimezone] = useState('America/Santiago')
    const [templateSurvey, setTemplateSurvey] = useState('')
    // IVA
    const [ivaEnabled, setIvaEnabled] = useState(false)
    const [ivaRate, setIvaRate] = useState(19)

    const currencySymbols: Record<string, string> = {
        'MXN': '$',
        'USD': '$',
        'EUR': '€',
        'GBP': '£',
        'CLP': '$',
        'ARS': '$',
        'COP': '$',
        'PEN': 'S/',
        'BRL': 'R$',
    }

    // Default USD/internacional: casi todos los signups son de fuera de Chile
    // (Animalgrace es hoy la única clínica chilena real). Se corrige a 'chile'
    // más abajo solo para quien ya tiene una suscripción real cobrada en CLP.
    const [paymentRegion, setPaymentRegion] = useState<'chile' | 'international'>('international')
    // Proveedor real de facturación (distinto de paymentRegion, que es solo el toggle
    // de moneda para explorar precios — no cambia hasta que el usuario efectivamente
    // paga con el otro proveedor). Usado para decidir si mostrar "Gestionar en Mercado Pago".
    const [currentPaymentProvider, setCurrentPaymentProvider] = useState<string | null>(null)

    // Notification preferences state
    const [notifPrefs, setNotifPrefs] = useState({
        new_appointment: true,
        confirmed: true,
        cancelled: true,
        pending_reminder: true,
        new_message: true,
        survey_response: true,
        ai_handoff: true
    })
    const [savingNotifications, setSavingNotifications] = useState(false)
    const [notificationsSaved, setNotificationsSaved] = useState(false)

    // Clinic settings state
    const [loadingSettings, setLoadingSettings] = useState(false)
    const [savingClinic, setSavingClinic] = useState(false)
    const [clinicSaved, setClinicSaved] = useState(false)

    // Schedule settings state
    const [savingSchedule, setSavingSchedule] = useState(false)
    const [scheduleSaved, setScheduleSaved] = useState(false)

    // Blocked dates state
    const [blockedDates, setBlockedDates] = useState<any[]>([])
    const [loadingBlockedDates, setLoadingBlockedDates] = useState(false)
    const [newBlockedDate, setNewBlockedDate] = useState('')
    const [newBlockedReason, setNewBlockedReason] = useState('')
    const [isAddingBlockedDate, setIsAddingBlockedDate] = useState(false)

    // Profile settings state
    const [newPassword, setNewPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [savingPassword, setSavingPassword] = useState(false)
    const [passwordSaved, setPasswordSaved] = useState(false)
    const [passwordError, setPasswordError] = useState('')

    // Subscription state
    const [subscription, setSubscription] = useState<{
        plan: string
        status: string
        trialEndsAt: string | null
        monthlyLimit: number
        monthlyUsed: number
        manuallyActive: boolean
    } | null>(null)
    const [cancellingSubscription, setCancellingSubscription] = useState(false)

    // Suscripción real y pagada -- nunca depende del texto exacto de
    // `subscriptions.status`, que en DB puede quedar como 'trialing' (lo que
    // pone el trigger de creación de la clínica, nunca 'trial') hasta que un
    // webhook de pago real lo cambia a 'active'. manuallyActive cubre las
    // cuentas que pagan por transferencia (Animalgrace) y nunca pasan por MP/Paddle.
    const isPaidActive = !!subscription?.manuallyActive || subscription?.status === 'active'
    const trialEndsAtDate = subscription?.trialEndsAt ? new Date(subscription.trialEndsAt) : null
    const isInTrialWindow = !!trialEndsAtDate && trialEndsAtDate.getTime() > Date.now()
    const subscriptionStatusLabel = isPaidActive ? 'Activo' : isInTrialWindow ? 'Suscrito' : 'Inactivo'

    // AI usage state - consolidated at top of component

    // Payment return message state
    const [paymentMessage, setPaymentMessage] = useState<{ type: 'success' | 'error' | 'pending'; text: string } | null>(null)
    // Plan recién adquirido en la primera conversión trial→pago (dispara el banner de onboarding)
    const [onboardingPromptPlan, setOnboardingPromptPlan] = useState<PlanId | null>(null)

    // CTA de onboarding: solo si este pago fue la primera conversión trial→pago real.
    // Lee el flag de sessionStorage (seteado antes de abrir el checkout) y lo consume una
    // sola vez. Se llama tanto desde el retorno con ?payment=success (MercadoPago, redirect)
    // como desde el evento checkout.completed de Paddle (overlay, sin redirect ni URL param).
    const checkPendingOnboardingPrompt = (clinicIdForUpdate: string | null | undefined): boolean => {
        try {
            const raw = sessionStorage.getItem('vetly_pending_onboarding_prompt')
            if (raw) {
                const pending = JSON.parse(raw)
                setOnboardingPromptPlan(pending.planId as PlanId)
                sessionStorage.removeItem('vetly_pending_onboarding_prompt')

                if (clinicIdForUpdate) {
                    // Fire-and-forget: nunca debe romper el flujo de pago si falla
                    ;(supabase as any)
                        .from('subscriptions')
                        .update({ onboarding_call_prompted_at: new Date().toISOString() })
                        .eq('clinic_id', clinicIdForUpdate)
                        .is('onboarding_call_prompted_at', null)
                        .then(({ error }: any) => {
                            if (error) console.error('No se pudo marcar onboarding_call_prompted_at:', error)
                        })
                }
                return true
            }
        } catch (e) {
            console.error('Error leyendo onboarding prompt flag:', e)
        }
        return false
    }

    // Retorno de checkout de Paddle (overlay, sin redirect ni ?payment=success en la URL).
    // Se dispara desde el eventCallback de checkout.completed en handleSubscribe.
    const handlePaddleSubscriptionSuccess = (clinicIdForUpdate: string | null | undefined) => {
        setActiveTab('subscription')
        setPaymentMessage({
            type: 'success',
            text: '¡Pago procesado exitosamente! Tu suscripción ha sido activada. Los cambios pueden demorar unos segundos en reflejarse.'
        })
        checkPendingOnboardingPrompt(clinicIdForUpdate)
    }

    // Read tab from URL params (for deep linking) + handle payment returns
    useEffect(() => {
        const tabParam = searchParams.get('tab')
        const paymentParam = searchParams.get('payment')

        if (paymentParam) {
            // User returned from MercadoPago checkout
            setActiveTab('subscription')
            switch (paymentParam) {
                case 'success':
                    setPaymentMessage({
                        type: 'success',
                        text: '¡Pago procesado exitosamente! Tu suscripción ha sido activada. Los cambios pueden demorar unos segundos en reflejarse.'
                    })
                    checkPendingOnboardingPrompt(clinicId)
                    break
                case 'failure':
                    setPaymentMessage({
                        type: 'error',
                        text: 'El pago fue rechazado. Por favor intenta con otro método de pago o contacta a tu banco.'
                    })
                    break
                case 'pending':
                    setPaymentMessage({
                        type: 'pending',
                        text: 'Tu pago está siendo procesado. Te notificaremos cuando se confirme. Esto puede demorar hasta 48 horas.'
                    })
                    break
            }
            // Clean URL params after reading
            const newUrl = window.location.pathname
            window.history.replaceState({}, '', newUrl)
        } else if (tabParam === 'ai') {
            // `?tab=ai` renderiza una versión antigua de los ajustes de IA que
            // quedó huérfana: no aparece en el menú y duplica /app/ai-settings,
            // que además sí tiene candado de plan. Se redirige a la buena, así
            // un usuario Core ve la pantalla de upgrade y no un motor de IA que
            // no puede usar.
            navigate('/app/ai-settings', { replace: true })
        } else if (tabParam === 'integrations') {
            // Mismo criterio que `?tab=ai`: el tab embebido acá era una copia
            // duplicada (y peor — sin el flujo de Embedded Signup de Meta) de
            // lo que ya hace bien /app/integrations.
            navigate('/app/integrations', { replace: true })
        } else if (tabParam === 'reminders') {
            // Estaba en la whitelist pero no tiene bloque de render — cualquier
            // link viejo a esta URL mostraba una pantalla en blanco.
            navigate('/app/reminders', { replace: true })
        } else if (tabParam && ['profile', 'clinic', 'branding', 'team', 'schedule', 'subscription', 'notifications', 'tags'].includes(tabParam)) {
            setActiveTab(tabParam)
            if (window.innerWidth < 768) setShowMobileList(false)
        }
    }, [searchParams, navigate])

    // Load existing settings
    useEffect(() => {
        const fetchSettings = async () => {
            if (!clinicId) return
            setLoadingSettings(true)

            // Los query builders de Supabase son thenables sin .catch(); Promise.resolve los normaliza
            const safe = (p: any) => Promise.resolve(p).then((r: any) => r, () => ({ data: null, error: null }))

            try {
                // Wave 1: todas las queries independientes en paralelo (~9 round trips → 1)
                const [
                    { data: notifData, error: notifError },
                    { data: clinicData, error: clinicError },
                    { data: subData },
                    { data: servicesData, error: servicesError },
                    { data: profData, error: profError },
                    { data: productsData },
                ] = await Promise.all([
                    safe((supabase as any).from('notification_preferences').select('*').eq('clinic_id', clinicId).single()),
                    safe((supabase as any).from('clinic_settings').select('*').eq('id', clinicId).single()),
                    safe((supabase as any).from('subscriptions').select('*').eq('clinic_id', clinicId).single()),
                    safe((supabase as any).from('clinic_services').select('id, name, duration, price, ai_description, linked_product_id, linked_product_qty, is_public_bookable').eq('clinic_id', clinicId)),
                    safe((supabase as any).rpc('get_clinic_professionals', { p_clinic_id: clinicId })),
                    safe((supabase as any).from('inventory_products').select('id, name, unit, stock_quantity').eq('clinic_id', clinicId).eq('is_active', true).order('name')),
                ])

                // Blocked dates tiene su propio loading state — corre en background
                fetchBlockedDates()

                // --- Procesar notificaciones ---
                if (notifError && notifError.code !== 'PGRST116') throw notifError
                if (notifData) {
                    setNotifPrefs({
                        new_appointment: notifData.new_appointment,
                        confirmed: notifData.confirmed,
                        cancelled: notifData.cancelled,
                        pending_reminder: notifData.pending_reminder,
                        new_message: notifData.new_message,
                        survey_response: notifData.survey_response,
                        ai_handoff: notifData.ai_handoff !== undefined ? notifData.ai_handoff : true
                    })
                }

                // --- Procesar clinic_settings ---
                if (clinicError && clinicError.code !== 'PGRST116') throw clinicError
                if (clinicData) {
                    setClinicName(clinicData.clinic_name || '')
                    setClinicAddress(clinicData.clinic_address || '')
                    setAddressReferences(clinicData.address_references || '')
                    setGoogleMapsUrl(clinicData.google_maps_url || '')
                    setInstagramUrl(clinicData.instagram_url || '')
                    setFacebookUrl(clinicData.facebook_url || '')
                    setTiktokUrl(clinicData.tiktok_url || '')
                    setWebsiteUrl(clinicData.website_url || '')
                    setContactPhone(clinicData.contact_phone || '')
                    setCurrency(clinicData.currency || 'CLP')
                    setTimezone(clinicData.timezone || 'America/Santiago')
                    setTemplateSurvey(clinicData.template_survey || '')
                    setIvaEnabled(clinicData.iva_enabled ?? false)
                    setIvaRate(clinicData.iva_rate ?? 19)
                    setBusinessModel(clinicData.business_model || 'physical')
                    setSchedulingMode(clinicData.scheduling_mode === 'coordinator_approval' ? 'coordinator_approval' : 'ai_autonomous')
                    setCoordinatorPhone(clinicData.coordinator_phone || '')
                    setLogisticsConfigRaw(clinicData.logistics_config || {})
                    setLogisticsProEnabled(clinicData.logistics_config?.is_active === true)
                    // El toggle de moneda solo respeta 'chile' cuando hay una
                    // suscripción REAL ya PAGADA en CLP (o es una cuenta
                    // manually_active como Animalgrace). Ojo: `mercadopago_
                    // subscription_id` se escribe apenas se CREA la preferencia
                    // de pago, no cuando se completa -- un intento de checkout
                    // sin terminar (o rechazado) ya deja ese campo con un valor
                    // no-nulo, así que no sirve como señal de "ya pagó". Sin
                    // esto, `payment_provider` es solo un artefacto del default
                    // que Register.tsx haya tenido en el momento del signup,
                    // no una elección real de moneda -- por eso todo trial sin
                    // pagar cae siempre a USD, sin importar ese campo.
                    {
                        const hasRealSubscription = !!subData?.manually_active || subData?.status === 'active'
                        const isChileanPayer = clinicData.payment_provider === 'mercadopago' || clinicData.payment_provider === 'lemonsqueezy'
                        setPaymentRegion(hasRealSubscription && isChileanPayer ? 'chile' : 'international')
                    }
                    setCurrentPaymentProvider(clinicData.payment_provider || null)
                    if (clinicData.working_hours) setWorkingHours(clinicData.working_hours)
                    setPublicBookingEnabled(clinicData.public_booking_enabled ?? false)
                    setPublicBookingSlug(clinicData.public_booking_slug || '')
                    setBookingLogoUrl(clinicData.booking_logo_url || '')
                    setBookingBrandColor(clinicData.booking_brand_color || '#0d9488')
                    setBookingBrandColorSecondary(clinicData.booking_brand_color_secondary || '')
                }

                // --- Procesar servicios ---
                if (servicesError) console.error('Error fetching services:', servicesError)
                if (servicesData) {
                    setServices(servicesData.map((s: any) => ({
                        id: s.id,
                        name: s.name,
                        duration: s.duration,
                        price: s.price,
                        aiDescription: s.ai_description,
                        linkedProductId: s.linked_product_id,
                        linkedProductQty: s.linked_product_qty,
                        publicBookable: s.is_public_bookable,
                    })))
                }

                // --- Procesar profesionales ---
                if (profError) console.error('Error fetching professionals:', profError)
                if (profData) setClinicProfessionals(profData)

                // --- Productos de inventario (para vincular a servicios) ---
                if (productsData) setInventoryProducts(productsData)

                // El plan a veces llega vacío en subData.plan_id recién creada la
                // cuenta (antes del primer sync del webhook de pago) — se resuelve
                // aparte, no vale la pena un Promise.all de un solo elemento.
                const needsPlanFallback = !!(subData && (!subData.plan_id || subData.plan_id === ''))
                const { data: planFallbackData } = needsPlanFallback
                    ? await safe((supabase as any).from('clinic_settings').select('subscription_plan').eq('id', clinicId).single())
                    : { data: null }

                // --- Procesar suscripción ---
                if (subData) {
                    let planName = subData.plan_id
                    if (!planName || planName === '') {
                        planName = normalizePlanId(planFallbackData?.subscription_plan || 'starter')
                    }
                    setSubscription({
                        plan: planName,
                        status: subData.status,
                        // subscriptions.trial_ends_at no existe como columna — el trial real
                        // se rastrea en clinic_settings.trial_end_date (bug preexistente
                        // encontrado en sesión 68: el countdown nunca se mostraba porque
                        // siempre leía undefined de una columna inexistente).
                        trialEndsAt: clinicData?.trial_end_date || null,
                        monthlyLimit: subData.monthly_appointments_limit,
                        monthlyUsed: subData.monthly_appointments_used || 0,
                        manuallyActive: subData.manually_active ?? false
                    })
                }
            } catch (error) {
                console.error('Error loading settings:', error)
            } finally {
                setLoadingSettings(false)
            }
        }

        fetchSettings()
    }, [clinicId])


    const handleSaveNotifications = async () => {
        if (!clinicId) return

        setSavingNotifications(true)
        setNotificationsSaved(false)

        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error } = await (supabase as any)
                .from('notification_preferences')
                .upsert({
                    clinic_id: clinicId,
                    ...notifPrefs,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'clinic_id' })

            if (error) throw error

            setNotificationsSaved(true)
            toast.success('Preferencias de notificación guardadas')
            setTimeout(() => setNotificationsSaved(false), 3000)
        } catch (error) {
            console.error('Error saving notification preferences:', error)
        } finally {
            setSavingNotifications(false)
        }
    }

    const handleUpdatePassword = async () => {
        if (!newPassword || !confirmPassword) {
            setPasswordError('Por favor ingresa y confirma tu nueva contraseña')
            return
        }

        if (newPassword !== confirmPassword) {
            setPasswordError('Las contraseñas no coinciden')
            return
        }

        if (newPassword.length < 6) {
            setPasswordError('La contraseña debe tener al menos 6 caracteres')
            return
        }

        setSavingPassword(true)
        setPasswordError('')

        try {
            const { error } = await supabase.auth.updateUser({
                password: newPassword
            })

            if (error) throw error

            setPasswordSaved(true)
            setNewPassword('')
            setConfirmPassword('')
            setTimeout(() => setPasswordSaved(false), 3000)
        } catch (error) {
            console.error('Error updating password:', error)
            setPasswordError('Error al actualizar la contraseña. Inténtalo de nuevo.')
        } finally {
            setSavingPassword(false)
        }
    }

    const handleSaveClinic = async () => {
        setSavingClinic(true)
        setClinicSaved(false)

        if (!clinicId) {
            setSavingClinic(false)
            return
        }

        try {
            console.log('UPDATING CLINIC SETTINGS:', {
                id: clinicId,
                clinic_name: clinicName,
                clinic_address: clinicAddress,
                address_references: addressReferences,
                google_maps_url: googleMapsUrl,
                instagram_url: instagramUrl,
                facebook_url: facebookUrl,
                tiktok_url: tiktokUrl,
                website_url: websiteUrl,
                currency,
                timezone,
                business_model: businessModel,
                template_survey: templateSurvey,

                updated_at: new Date().toISOString()
            })

            const { data, error } = await (supabase as any)
                .from('clinic_settings')
                .update({
                    clinic_name: clinicName,
                    clinic_address: clinicAddress,
                    address_references: addressReferences,
                    google_maps_url: googleMapsUrl,
                    instagram_url: instagramUrl,
                    facebook_url: facebookUrl,
                    tiktok_url: tiktokUrl,
                    website_url: websiteUrl,
                    contact_phone: contactPhone,
                    currency,
                    timezone,
                    business_model: businessModel,
                    // Una clínica de local fijo no coordina rutas: el modo vuelve al default.
                    scheduling_mode: businessModel === 'physical' ? 'ai_autonomous' : schedulingMode,
                    coordinator_phone: coordinatorPhone.trim() || null,
                    // Preserva locations/routing_mode/etc. ya configurados; solo cambia el switch.
                    // Un local fijo no puede tener Logística Pro activa.
                    logistics_config: {
                        ...logisticsConfigRaw,
                        is_active: businessModel === 'physical' ? false : logisticsProEnabled,
                    },
                    template_survey: templateSurvey,
                    iva_enabled: ivaEnabled,
                    iva_rate: ivaRate,

                    updated_at: new Date().toISOString()
                })
                .eq('id', clinicId)
                .select();

            if (error) {
                console.error('ERROR SUPABASE:', error)
                throw error
            }

            console.log('RESULTADO EXITOSO:', data)

            // Refrescar contexto global
            if (refreshClinics) {
                await refreshClinics()
            }

            setClinicSaved(true)
            setTimeout(() => setClinicSaved(false), 3000)
            toast.success('Configuración guardada correctamente')
        } catch (error: any) {
            console.error('ERROR AL GUARDAR:', error)
            toast.error('Error al guardar: ' + (error.message || 'Error desconocido'))
        } finally {
            setSavingClinic(false)
        }
    }

    const slugify = (text: string) =>
        text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toLowerCase().trim()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/[\s_-]+/g, '-')
            .replace(/^-+|-+$/g, '')

    const handleSaveBooking = async () => {
        if (!clinicId) return
        // Con las reservas apagadas NO se deriva slug del nombre de la clínica:
        // dos clínicas homónimas colisionaban en el UNIQUE de public_booking_slug
        // al guardar solo el branding (error 23505).
        const cleanSlug = slugify(publicBookingSlug || (publicBookingEnabled ? clinicName : ''))
        if (publicBookingEnabled && !cleanSlug) {
            toast.error('Elige un nombre para tu enlace antes de activar la página.')
            return
        }
        setSavingBooking(true)
        try {
            const { error } = await (supabase as any)
                .from('clinic_settings')
                .update({
                    public_booking_enabled: publicBookingEnabled,
                    public_booking_slug: cleanSlug || null,
                    booking_logo_url: bookingLogoUrl || null,
                    booking_brand_color: bookingBrandColor,
                    booking_brand_color_secondary: bookingBrandColorSecondary || null,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', clinicId)

            if (error) {
                // Violación de unicidad del slug -- otra clínica ya lo usa.
                if (error.code === '23505') {
                    toast.error('Ese enlace ya está en uso por otra clínica. Elige otro nombre.')
                    return
                }
                throw error
            }
            setPublicBookingSlug(cleanSlug)
            toast.success('Diseño de marca guardado correctamente')
        } catch (error: any) {
            toast.error('Error al guardar: ' + (error.message || 'Error desconocido'))
        } finally {
            setSavingBooking(false)
        }
    }

    const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file || !clinicId) return
        if (file.size > 2 * 1024 * 1024) {
            toast.error('El logo debe pesar menos de 2MB.')
            return
        }
        setUploadingLogo(true)
        try {
            const ext = file.name.split('.').pop() || 'png'
            const path = `${clinicId}/logo.${ext}`
            const { error: uploadError } = await supabase.storage
                .from('clinic-branding')
                .upload(path, file, { upsert: true })
            if (uploadError) throw uploadError

            const { data: { publicUrl } } = supabase.storage.from('clinic-branding').getPublicUrl(path)
            // Cache-bust: el mismo path puede quedar cacheado en el navegador
            // tras reemplazar el logo.
            setBookingLogoUrl(`${publicUrl}?t=${Date.now()}`)
            toast.success('Logo subido. No olvides guardar los cambios.')
        } catch (error: any) {
            toast.error('Error al subir el logo: ' + (error.message || 'Error desconocido'))
        } finally {
            setUploadingLogo(false)
            e.target.value = ''
        }
    }

    const bookingUrl = publicBookingSlug ? `https://www.vetly.pro/reservar/${slugify(publicBookingSlug)}` : ''
    const copyBookingUrl = () => {
        if (!bookingUrl) return
        navigator.clipboard.writeText(bookingUrl)
        setBookingLinkCopied(true)
        setTimeout(() => setBookingLinkCopied(false), 2000)
    }

    const handleSaveSchedule = async () => {
        if (!clinicId) return
        setSavingSchedule(true)
        setScheduleSaved(false)

        try {
            const { error } = await (supabase as any)
                .from('clinic_settings')
                .update({
                    working_hours: workingHours,
                    updated_at: new Date().toISOString()
                })
                .eq('id', clinicId);


            if (error) throw error;

            setScheduleSaved(true)
            toast.success('Horarios guardados correctamente')
            setTimeout(() => setScheduleSaved(false), 3000)
        } catch (error: any) {
            console.error('Error saving schedule:', error)
            toast.error('Error al guardar horarios: ' + (error.message || 'Intente nuevamente'))
        } finally {
            setSavingSchedule(false)
        }
    }

    const fetchBlockedDates = async () => {
        if (!clinicId) return
        setLoadingBlockedDates(true)
        try {
            const { data, error } = await (supabase as any)
                .from('clinic_blocked_dates')
                .select('*')
                .eq('clinic_id', clinicId)
                .gte('blocked_date', new Date().toISOString().split('T')[0])
                .order('blocked_date', { ascending: true })

            if (error) throw error
            setBlockedDates(data || [])
        } catch (error) {
            console.error('Error fetching blocked dates:', error)
        } finally {
            setLoadingBlockedDates(false)
        }
    }

    const handleAddBlockedDate = async () => {
        if (!clinicId || !newBlockedDate) return
        setIsAddingBlockedDate(true)
        try {
            const { error } = await (supabase as any)
                .from('clinic_blocked_dates')
                .insert({
                    clinic_id: clinicId,
                    blocked_date: newBlockedDate,
                    reason: newBlockedReason
                })

            if (error) throw error
            toast.success('Día bloqueado correctamente')
            setNewBlockedDate('')
            setNewBlockedReason('')
            fetchBlockedDates()
        } catch (error: any) {
            console.error('Error adding blocked date:', error)
            toast.error('Error al bloquear día: ' + (error.message || 'Intente nuevamente'))
        } finally {
            setIsAddingBlockedDate(false)
        }
    }

    const handleDeleteBlockedDate = async (id: string) => {
        try {
            const { error } = await (supabase as any)
                .from('clinic_blocked_dates')
                .delete()
                .eq('id', id)

            if (error) throw error
            toast.success('Bloqueo eliminado')
            fetchBlockedDates()
        } catch (error) {
            console.error('Error deleting blocked date:', error)
            toast.error('Error al eliminar bloqueo')
        }
    }

    const handlePlanSelection = async (planId: PlanId, period: BillingPeriod = 'month') => {
        console.log('handlePlanSelection called with:', planId)
        console.log('Profile:', profile)
        console.log('User:', user)

        // Validate clinic ID
        if (!clinicId) {
            console.error('Missing clinic_id')
            alert('Error: No se encontró la información de la clínica. Por favor recarga la página.')
            return
        }

        // Validate user email
        if (!user?.email) {
            console.error('Missing email')
            alert('Error: No se encontró el email del usuario. Por favor recarga la página.')
            return
        }

        // Primera conversión real (trial → plan pago): guardar flag para mostrar
        // el CTA de onboarding al volver del checkout. sessionStorage sobrevive
        // el round-trip fuera del SPA sin persistir entre sesiones futuras.
        // `subscription.plan` nunca es literalmente 'trial' (es el plan_id
        // elegido, ej. 'core') -- lo que distingue una primera conversión real
        // es que hoy todavía no hay una suscripción paga.
        const isFirstConversion = !isPaidActive
        if (isFirstConversion) {
            sessionStorage.setItem('vetly_pending_onboarding_prompt', JSON.stringify({ planId, clinicName }))
        }

        try {
            if (paymentRegion === 'international') {
                onPaddleCheckoutEvent((event) => {
                    if (event.name === 'checkout.completed') handlePaddleSubscriptionSuccess(clinicId)
                })
                await openPaddleSubscriptionCheckout(clinicId, user.email, planId as PaddlePlanId, period)
            } else {
                if (period === 'year') {
                    alert('El pago anual está disponible por ahora solo en la modalidad internacional (USD).')
                    return
                }
                await redirectToCheckout({
                    clinicId: clinicId,
                    planId: planId as "core" | "starter" | "pro" | "enterprise",
                    email: user.email,
                })
            }
        } catch (error) {
            console.error('Checkout error:', error)
            if (isFirstConversion) {
                sessionStorage.removeItem('vetly_pending_onboarding_prompt')
            }
            alert('Error al iniciar el proceso de pago. Por favor intenta más tarde.')
        }
    }

    // Periodo de facturación elegido en el grid de planes. El anual hoy solo
    // existe para Core (ver PADDLE_PLANS.core.priceIdAnnual).
    const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>('month')

    const [serviceSaved, setServiceSaved] = useState(false) // Success state
    const [editingServiceId, setEditingServiceId] = useState<string | null>(null)

    // Los cuatro puntos que cerraban el modal limpiaban campos distintos (el botón
    // "Cancelar" solo borraba el nombre), así que quedaban valores del servicio
    // anterior al abrirlo de nuevo. Un único helper para todos.
    const resetServiceForm = () => {
        setNewServiceName('')
        setNewServiceDuration('30')
        setNewServicePrice('')
        setNewServiceLinkedProductId('')
        setNewServiceLinkedProductQty('1')
        setNewServicePublicBookable(false)
    }

    const handleEditService = async (service: any) => {
        setEditingServiceId(service.id)
        setNewServiceName(service.name)
        setNewServiceDuration(service.duration.toString())
        setNewServicePrice(service.price.toString())
        setNewServiceLinkedProductId(service.linkedProductId ?? '')
        setNewServiceLinkedProductQty(String(service.linkedProductQty ?? 1))
        setNewServicePublicBookable(!!service.publicBookable)
        setShowServiceModal(true)

        // Load assigned professionals for this service
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data } = await (supabase as any)
                .from('service_professionals')
                .select('member_id, is_primary')
                .eq('service_id', service.id)
            if (data) {
                const assigned: Record<string, boolean> = {}
                let primary = ''
                data.forEach((sp: any) => {
                    const profId = sp.member_id || sp.id
                    if (profId) {
                        assigned[profId] = true
                        if (sp.is_primary) primary = profId
                    }
                })
                setAssignedProfessionals(assigned)
                setPrimaryProfessional(primary)
            }
        } catch (err) {
            console.error('Error loading service professionals:', err)
        }
    }

    const handleSaveService = async () => {
        if (!newServiceName.trim() || !clinicId) return

        try {
            const serviceData = {
                clinic_id: clinicId,
                name: newServiceName.trim(),
                duration: parseInt(newServiceDuration) || 0,
                price: parseFloat(newServicePrice) || 0,
                linked_product_id: newServiceLinkedProductId || null,
                linked_product_qty: Math.max(1, parseInt(newServiceLinkedProductQty) || 1),
                is_public_bookable: newServicePublicBookable,
            }

            let savedServiceId = editingServiceId

            if (editingServiceId) {
                // Update existing service
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { error } = await (supabase as any)
                    .from("clinic_services")
                    .update(serviceData)
                    .eq('id', editingServiceId)

                if (error) throw error

                // Se conserva el resto de la fila (ej. aiDescription) — antes se perdía
                // al reemplazar el objeto completo con solo los campos del formulario.
                setServices(services.map(s => s.id === editingServiceId ? {
                    ...s,
                    name: serviceData.name,
                    duration: serviceData.duration,
                    price: serviceData.price,
                    linkedProductId: serviceData.linked_product_id,
                    linkedProductQty: serviceData.linked_product_qty,
                    publicBookable: serviceData.is_public_bookable,
                } : s))
            } else {
                // Insert new service
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { data, error } = await (supabase as any)
                    .from("clinic_services")
                    .insert(serviceData)
                    .select()
                    .single()

                if (error) throw error

                savedServiceId = data.id

                setServices([...services, {
                    id: data.id,
                    name: data.name,
                    duration: data.duration,
                    price: data.price,
                    aiDescription: data.ai_description,
                    linkedProductId: data.linked_product_id,
                    linkedProductQty: data.linked_product_qty,
                    publicBookable: data.is_public_bookable,
                }])
            }

            // Save professional assignments before resetting state
            if (savedServiceId) {
                try {
                    // Delete existing assignments
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    await (supabase as any)
                        .from('service_professionals')
                        .delete()
                        .eq('service_id', savedServiceId)

                    // Insert new assignments
                    const assignments = Object.entries(assignedProfessionals)
                        .filter(([, isAssigned]) => isAssigned)
                        .map(([memberId]) => ({
                            service_id: savedServiceId,
                            member_id: memberId,
                            is_primary: memberId === primaryProfessional
                        }))

                    if (assignments.length > 0) {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const { error: insertError } = await (supabase as any)
                            .from('service_professionals')
                            .insert(assignments)
                        
                        if (insertError) {
                            console.error('Error in service_professionals insert:', insertError);
                        }
                    }
                } catch (err) {
                    console.error('Critical Professional Saving Error:', err)
                }
            }

            // Reset form
            resetServiceForm()

            setAssignedProfessionals({})
            setPrimaryProfessional('')
            setEditingServiceId(null)
            
            // Show success message
            setServiceSaved(true)
            setTimeout(() => setServiceSaved(false), 3000)
            
            setShowServiceModal(false)

        } catch (error: any) {
            console.error('Error detallado de guardado:', error)
            const errorMessage = error.message || error.details || 'Error desconocido';
            alert('Error al guardar el servicio: ' + errorMessage)
        }
    }

    const handleDeleteService = async (id: string) => {
        if (!confirm('¿Estás seguro de eliminar este servicio?')) return

        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error } = await (supabase as any)
                .from("clinic_services")
                .delete()
                .eq('id', id)

            if (error) throw error

            setServices(services.filter(s => s.id !== id))
        } catch (error) {
            console.error('Error deleting service:', error)
            alert('Error al eliminar el servicio')
        }
    }

    return (
        <div className="animate-fade-in relative min-h-[calc(100vh-7rem)] p-0 space-y-6">
            {/* Banner */}
            <div className="bg-gradient-to-br from-amber-500 to-amber-700 rounded-2xl overflow-hidden shadow-soft-md">
                <div className="p-6 sm:p-8">
                    <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                            <p className="text-xs font-black uppercase tracking-widest text-amber-200 mb-2">Configuración</p>
                            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">Ajustes de la Clínica</h1>
                            <p className="text-sm text-amber-100/80 font-light mt-1">Configura tu clínica, horarios, integraciones y suscripción.</p>
                        </div>
                        <div className="w-12 h-12 bg-white/15 rounded-2xl flex items-center justify-center shrink-0">
                            <Settings2 className="w-6 h-6 text-white" />
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex flex-col md:flex-row gap-6 md:gap-8">

                {/* Mobile Content Header (Back Button) */}
                {!showMobileList && (
                    <div className="md:hidden flex items-center gap-3 p-4 bg-white rounded-soft shadow-premium">
                        <button
                            onClick={() => setShowMobileList(true)}
                            className="p-1.5 -ml-1 text-charcoal/60 hover:text-charcoal hover:bg-ivory rounded-full transition-colors"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </button>
                        <h2 className="font-semibold text-charcoal">
                            {availableTabs.find(t => t.id === activeTab)?.label}
                        </h2>
                    </div>
                )}

                {/* Sidebar Navigation */}
                <div className={cn(
                    "w-full md:w-64 flex-shrink-0",
                    !showMobileList && "hidden md:block" // hide on mobile if viewing content
                )}>
                    <div className="card-soft p-2">
                        {availableTabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => {
                                    setActiveTab(tab.id)
                                    if (window.innerWidth < 768) setShowMobileList(false)
                                }}
                                className={cn(
                                    'w-full flex items-center gap-3 px-4 py-3 rounded-soft text-left transition-colors',
                                    activeTab === tab.id && !showMobileList
                                        ? 'bg-primary-500/10 text-primary-600 font-medium'
                                        : 'text-charcoal/60 hover:bg-silk-beige/50 hover:text-charcoal'
                                )}
                            >
                                <tab.icon className="w-5 h-5" />
                                {tab.label}
                                <ChevronRight
                                    className={cn(
                                        'w-4 h-4 ml-auto transition-transform',
                                        activeTab === tab.id && !showMobileList && 'rotate-90 hidden md:block'
                                    )}
                                />
                            </button>
                        ))}
                    </div>
                </div>

                {/* Content */}
                <div className={cn(
                    "flex-1 min-w-0 w-full overflow-hidden",
                    showMobileList && "hidden md:block" // hide content on mobile if showing list
                )}>
                    {/* Profile Settings */}
                    {activeTab === 'profile' && (
                        <div className="space-y-6 animate-fade-in pb-20 md:pb-0">
                            <MyProfile />

                            <div className="card-soft p-4 sm:p-6 space-y-4 max-w-3xl w-full">
                                <h3 className="font-medium text-charcoal">Seguridad</h3>
                                <div className="space-y-4 w-full">
                                    <div className="w-full">
                                        <label className="block text-sm font-medium text-charcoal mb-2">Nueva Contraseña</label>
                                        <input
                                            type="password"
                                            value={newPassword}
                                            onChange={(e) => setNewPassword(e.target.value)}
                                            className="input-soft w-full max-w-md"
                                            placeholder="Ingresa tu nueva contraseña"
                                        />
                                    </div>
                                    <div className="w-full">
                                        <label className="block text-sm font-medium text-charcoal mb-2">Confirmar Contraseña</label>
                                        <input
                                            type="password"
                                            value={confirmPassword}
                                            onChange={(e) => setConfirmPassword(e.target.value)}
                                            className="input-soft w-full max-w-md"
                                            placeholder="Repite tu nueva contraseña"
                                        />
                                    </div>

                                    {passwordError && (
                                        <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 p-3 rounded-soft">
                                            <AlertCircle className="w-4 h-4" />
                                            {passwordError}
                                        </div>
                                    )}

                                    <div className="flex items-center gap-4 pt-2">
                                        <button
                                            onClick={handleUpdatePassword}
                                            disabled={savingPassword || !newPassword}
                                            className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {savingPassword ? (
                                                <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</>
                                            ) : (
                                                <><Key className="w-4 h-4" /> Actualizar Contraseña</>
                                            )}
                                        </button>
                                        {passwordSaved && (
                                            <div className="flex items-center gap-2 text-emerald-600 text-sm animate-fade-in bg-emerald-50 px-4 py-2 rounded-soft">
                                                <CheckCircle2 className="w-4 h-4" />
                                                ¡Contraseña actualizada!
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Clinic Settings */}
                    {activeTab === 'clinic' && (
                        <div className="space-y-6">
                            <div className="card-soft p-4 sm:p-6">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                                    <h2 className="text-lg font-semibold text-charcoal">Información de la Clínica</h2>
                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={handleSaveClinic}
                                            disabled={savingClinic || loadingSettings}
                                            className="btn-primary flex items-center gap-2 shadow-sm w-full sm:w-auto justify-center"
                                        >
                                            {loadingSettings ? (
                                                <><Loader2 className="w-4 h-4 animate-spin" /> Cargando...</>
                                            ) : savingClinic ? (
                                                <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</>
                                            ) : (
                                                <><Save className="w-4 h-4" /> Guardar Cambios</>
                                            )}
                                        </button>
                                        {clinicSaved && (
                                            <div className="flex items-center gap-2 text-emerald-600 text-sm animate-fade-in bg-emerald-50 px-4 py-2 rounded-soft border border-emerald-100">
                                                <CheckCircle2 className="w-4 h-4" />
                                                ¡Guardado!
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Todo este bloque (Modelo de Atención, Modo de Agendamiento, Logística
                                    Pro) solo sirve al agente IA conversacional — Core no lo tiene, y
                                    dejarlo visible solo agrega ruido y sugiere una función que no existe
                                    en su plan. Se oculta por completo (no candado): el usuario de Core
                                    no puede comprar esto por separado. Los valores de DB quedan en sus
                                    defaults seguros (business_model='physical', scheduling_mode=
                                    'ai_autonomous') y reaparecen listos para configurar si la clínica
                                    hace upgrade. */}
                                {meetsPlan('starter') && (
                                <>
                                <div className="bg-silk-beige/20 p-4 rounded-soft border border-silk-beige/30 mb-8">
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className="w-10 h-10 bg-primary-500/10 rounded-full flex items-center justify-center">
                                            {businessModel === 'physical' ? <Building2 className="w-5 h-5 text-primary-600" /> : businessModel === 'mobile' ? <Zap className="w-5 h-5 text-primary-600" /> : <RefreshCw className="w-5 h-5 text-primary-600" />}
                                        </div>
                                        <div>
                                            <h3 className="text-sm font-bold text-charcoal leading-none mb-1">Modelo de Atención</h3>
                                            <p className="text-xs text-charcoal/50">Define cómo opera tu clínica para optimizar al asistente IA</p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                        <button
                                            onClick={() => setBusinessModel('physical')}
                                            className={cn(
                                                "flex flex-col items-center gap-2 p-3 rounded-soft border transition-all",
                                                businessModel === 'physical'
                                                    ? "bg-white border-primary-500 shadow-sm ring-1 ring-primary-500"
                                                    : "bg-white/40 border-silk-beige hover:border-primary-200"
                                            )}
                                        >
                                            <div className={cn("w-8 h-8 rounded-full flex items-center justify-center", businessModel === 'physical' ? "bg-primary-500 text-white" : "bg-silk-beige/40 text-charcoal/40")}>
                                                <Building2 className="w-4 h-4" />
                                            </div>
                                            <div className="text-center">
                                                <p className={cn("text-[11px] font-bold", businessModel === 'physical' ? "text-primary-700" : "text-charcoal")}>Físico</p>
                                                <p className="text-[9px] text-charcoal/40">Local Fijo</p>
                                            </div>
                                        </button>

                                        <button
                                            onClick={() => setBusinessModel('mobile')}
                                            className={cn(
                                                "flex flex-col items-center gap-2 p-3 rounded-soft border transition-all",
                                                businessModel === 'mobile'
                                                    ? "bg-white border-primary-500 shadow-sm ring-1 ring-primary-500"
                                                    : "bg-white/40 border-silk-beige hover:border-primary-200"
                                            )}
                                        >
                                            <div className={cn("w-8 h-8 rounded-full flex items-center justify-center", businessModel === 'mobile' ? "bg-primary-500 text-white" : "bg-silk-beige/40 text-charcoal/40")}>
                                                <Zap className="w-4 h-4" />
                                            </div>
                                            <div className="text-center">
                                                <p className={cn("text-[11px] font-bold", businessModel === 'mobile' ? "text-primary-700" : "text-charcoal")}>Móvil</p>
                                                <p className="text-[9px] text-charcoal/40">A Domicilio</p>
                                            </div>
                                        </button>

                                        <button
                                            onClick={() => setBusinessModel('hybrid')}
                                            className={cn(
                                                "flex flex-col items-center gap-2 p-3 rounded-soft border transition-all",
                                                businessModel === 'hybrid'
                                                    ? "bg-white border-primary-500 shadow-sm ring-1 ring-primary-500"
                                                    : "bg-white/40 border-silk-beige hover:border-primary-200"
                                            )}
                                        >
                                            <div className={cn("w-8 h-8 rounded-full flex items-center justify-center", businessModel === 'hybrid' ? "bg-primary-500 text-white" : "bg-silk-beige/40 text-charcoal/40")}>
                                                <RefreshCw className="w-4 h-4" />
                                            </div>
                                            <div className="text-center">
                                                <p className={cn("text-[11px] font-bold", businessModel === 'hybrid' ? "text-primary-700" : "text-charcoal")}>Híbrido</p>
                                                <p className="text-[9px] text-charcoal/40">Ambos</p>
                                            </div>
                                        </button>
                                    </div>
                                </div>

                                {/* Solo tiene sentido con atención a domicilio: en un local fijo
                                    no hay ruta que coordinar. */}
                                {businessModel !== 'physical' && (
                                    <div className="bg-silk-beige/20 p-4 rounded-soft border border-silk-beige/30 mb-8">
                                        <div className="flex items-center gap-3 mb-4">
                                            <div className="w-10 h-10 bg-primary-500/10 rounded-full flex items-center justify-center">
                                                <CalendarClock className="w-5 h-5 text-primary-600" />
                                            </div>
                                            <div>
                                                <h3 className="text-sm font-bold text-charcoal leading-none mb-1">Modo de Agendamiento</h3>
                                                <p className="text-xs text-charcoal/50">Define quién decide el horario que se le ofrece al cliente</p>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            <button
                                                onClick={() => setSchedulingMode('ai_autonomous')}
                                                className={cn(
                                                    "flex items-start gap-3 p-3 rounded-soft border text-left transition-all",
                                                    schedulingMode === 'ai_autonomous'
                                                        ? "bg-white border-primary-500 shadow-sm ring-1 ring-primary-500"
                                                        : "bg-white/40 border-silk-beige hover:border-primary-200"
                                                )}
                                            >
                                                <div className={cn("w-8 h-8 rounded-full flex items-center justify-center shrink-0", schedulingMode === 'ai_autonomous' ? "bg-primary-500 text-white" : "bg-silk-beige/40 text-charcoal/40")}>
                                                    <Zap className="w-4 h-4" />
                                                </div>
                                                <div>
                                                    <p className={cn("text-[11px] font-bold", schedulingMode === 'ai_autonomous' ? "text-primary-700" : "text-charcoal")}>La IA agenda directamente</p>
                                                    <p className="text-[10px] text-charcoal/50 mt-0.5">Ofrece los horarios libres de la agenda y cierra la cita sola.</p>
                                                </div>
                                            </button>

                                            <button
                                                onClick={() => setSchedulingMode('coordinator_approval')}
                                                className={cn(
                                                    "flex items-start gap-3 p-3 rounded-soft border text-left transition-all",
                                                    schedulingMode === 'coordinator_approval'
                                                        ? "bg-white border-primary-500 shadow-sm ring-1 ring-primary-500"
                                                        : "bg-white/40 border-silk-beige hover:border-primary-200"
                                                )}
                                            >
                                                <div className={cn("w-8 h-8 rounded-full flex items-center justify-center shrink-0", schedulingMode === 'coordinator_approval' ? "bg-primary-500 text-white" : "bg-silk-beige/40 text-charcoal/40")}>
                                                    <CalendarClock className="w-4 h-4" />
                                                </div>
                                                <div>
                                                    <p className={cn("text-[11px] font-bold", schedulingMode === 'coordinator_approval' ? "text-primary-700" : "text-charcoal")}>Requiere aprobación de coordinación</p>
                                                    <p className="text-[10px] text-charcoal/50 mt-0.5">La IA reúne los datos y la disponibilidad; tú decides los horarios según la ruta del día.</p>
                                                </div>
                                            </button>
                                        </div>

                                        {schedulingMode === 'coordinator_approval' && (
                                            <div className="mt-4">
                                                <label className="block text-xs font-bold text-charcoal mb-1.5">
                                                    WhatsApp de quien coordina la ruta
                                                </label>
                                                <input
                                                    type="tel"
                                                    value={coordinatorPhone}
                                                    onChange={(e) => setCoordinatorPhone(e.target.value)}
                                                    placeholder="+56 9 1234 5678"
                                                    className="w-full px-3 py-2 rounded-soft border border-silk-beige bg-white text-sm text-charcoal focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                                                />
                                                <p className="text-[10px] text-charcoal/40 mt-1.5">
                                                    Recibirá un WhatsApp cada vez que un cliente quede esperando horarios.
                                                    Las solicitudes se revisan en Citas Médicas. Si lo dejas vacío, solo llegará
                                                    la notificación dentro de la plataforma.
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Cálculo automático de tramos por tiempo de viaje (Google Maps).
                                    Opt-in explícito: por defecto apagado, se edita en Conocimiento
                                    → Logística Pro, que solo aparece si este switch está activo. */}
                                {businessModel !== 'physical' && (
                                    <div className="bg-silk-beige/20 p-4 rounded-soft border border-silk-beige/30 mb-8">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 bg-primary-500/10 rounded-full flex items-center justify-center">
                                                    <Sparkles className="w-5 h-5 text-primary-600" />
                                                </div>
                                                <div>
                                                    <h3 className="text-sm font-bold text-charcoal leading-none mb-1">Logística Pro</h3>
                                                    <p className="text-xs text-charcoal/50 max-w-md">
                                                        Calcula el recargo de traslado exacto vía Google Maps según sedes y tramos
                                                        de tiempo. Actívalo solo si quieres configurar esas sedes en Conocimiento.
                                                    </p>
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => setLogisticsProEnabled(v => !v)}
                                                className="shrink-0"
                                                aria-label="Activar Logística Pro"
                                            >
                                                {logisticsProEnabled ? (
                                                    <ToggleRight className="w-9 h-9 text-primary-600" />
                                                ) : (
                                                    <ToggleLeft className="w-9 h-9 text-charcoal/30" />
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                )}
                                </>
                                )}

                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-charcoal mb-2">
                                            Nombre de la Clínica
                                        </label>
                                        <input
                                            type="text"
                                            value={clinicName}
                                            onChange={(e) => setClinicName(e.target.value)}
                                            className="input-soft"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-charcoal mb-2">
                                            Dirección del Establecimiento
                                        </label>
                                        <input
                                            type="text"
                                            placeholder="Ej: Av. Principal 123, Col. Centro, Ciudad"
                                            value={clinicAddress}
                                            onChange={(e) => setClinicAddress(e.target.value)}
                                            className="input-soft"
                                        />
                                        <p className="text-xs text-charcoal/40 mt-1">
                                            Esta dirección será utilizada por el asistente IA para informar a los clientes
                                        </p>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-charcoal mb-2">
                                            Referencias de la Dirección
                                        </label>
                                        <input
                                            type="text"
                                            placeholder="Ej: A un costado de la farmacia, frente al parque..."
                                            value={addressReferences}
                                            onChange={(e) => setAddressReferences(e.target.value)}
                                            className="input-soft"
                                        />
                                        <p className="text-xs text-charcoal/40 mt-1">
                                            Ayuda a tus clientes a llegar más fácilmente
                                        </p>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-charcoal mb-2">
                                            Enlace de Google Maps
                                        </label>
                                        <input
                                            type="url"
                                            placeholder="https://goo.gl/maps/..."
                                            value={googleMapsUrl}
                                            onChange={(e) => setGoogleMapsUrl(e.target.value)}
                                            className="input-soft"
                                        />
                                        <p className="text-xs text-charcoal/40 mt-1">
                                            El enlace directo para que abran el mapa en su celular
                                        </p>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                                        <div>
                                            <label className="flex items-center gap-2 text-sm font-medium text-charcoal mb-2">
                                                <Instagram className="w-4 h-4 text-pink-600" />
                                                Instagram
                                            </label>
                                            <input
                                                type="url"
                                                placeholder="https://instagram.com/..."
                                                value={instagramUrl}
                                                onChange={(e) => setInstagramUrl(e.target.value)}
                                                className="input-soft"
                                            />
                                        </div>
                                        <div>
                                            <label className="flex items-center gap-2 text-sm font-medium text-charcoal mb-2">
                                                <Facebook className="w-4 h-4 text-blue-600" />
                                                Facebook
                                            </label>
                                            <input
                                                type="url"
                                                placeholder="https://facebook.com/..."
                                                value={facebookUrl}
                                                onChange={(e) => setFacebookUrl(e.target.value)}
                                                className="input-soft"
                                            />
                                        </div>
                                        <div>
                                            <label className="flex items-center gap-2 text-sm font-medium text-charcoal mb-2">
                                                <Music className="w-4 h-4 text-charcoal/60" />
                                                TikTok
                                            </label>
                                            <input
                                                type="url"
                                                placeholder="https://tiktok.com/@..."
                                                value={tiktokUrl}
                                                onChange={(e) => setTiktokUrl(e.target.value)}
                                                className="input-soft"
                                            />
                                        </div>
                                        <div>
                                            <label className="flex items-center gap-2 text-sm font-medium text-charcoal mb-2">
                                                <Globe className="w-4 h-4 text-charcoal/60" />
                                                Sitio Web
                                            </label>
                                            <input
                                                type="url"
                                                placeholder="https://www.tuclinica.com"
                                                value={websiteUrl}
                                                onChange={(e) => setWebsiteUrl(e.target.value)}
                                                className="input-soft"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="flex items-center gap-2 text-sm font-medium text-charcoal mb-2">
                                            <Phone className="w-4 h-4 text-primary-600" />
                                            Número de Contacto
                                        </label>
                                        <input
                                            type="tel"
                                            placeholder="Ej: +56912345678"
                                            value={contactPhone}
                                            onChange={(e) => setContactPhone(e.target.value)}
                                            className="input-soft"
                                        />
                                        <p className="text-xs text-charcoal/40 mt-1">
                                            Si la IA necesita derivar a una llamada o alguien pide hablar con un humano, entregará este número
                                        </p>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-charcoal mb-2">
                                            Zona Horaria
                                        </label>
                                        <select
                                            value={timezone}
                                            onChange={(e) => setTimezone(e.target.value)}
                                            className="input-soft"
                                        >
                                            <optgroup label="🌎 América">
                                                <option value="America/New_York">Nueva York (GMT-5)</option>
                                                <option value="America/Chicago">Chicago (GMT-6)</option>
                                                <option value="America/Denver">Denver (GMT-7)</option>
                                                <option value="America/Los_Angeles">Los Ángeles (GMT-8)</option>
                                                <option value="America/Mexico_City">Ciudad de México (GMT-6)</option>
                                                <option value="America/Tijuana">Tijuana (GMT-8)</option>
                                                <option value="America/Cancun">Cancún (GMT-5)</option>
                                                <option value="America/Bogota">Bogotá (GMT-5)</option>
                                                <option value="America/Lima">Lima (GMT-5)</option>
                                                <option value="America/Santiago">Santiago de Chile (GMT-3)</option>
                                                <option value="America/Buenos_Aires">Buenos Aires (GMT-3)</option>
                                                <option value="America/Sao_Paulo">São Paulo (GMT-3)</option>
                                                <option value="America/Caracas">Caracas (GMT-4)</option>
                                            </optgroup>
                                            <optgroup label="🌍 Europa">
                                                <option value="Europe/London">Londres (GMT+0)</option>
                                                <option value="Europe/Paris">París (GMT+1)</option>
                                                <option value="Europe/Madrid">Madrid (GMT+1)</option>
                                                <option value="Europe/Berlin">Berlín (GMT+1)</option>
                                                <option value="Europe/Rome">Roma (GMT+1)</option>
                                                <option value="Europe/Amsterdam">Ámsterdam (GMT+1)</option>
                                                <option value="Europe/Moscow">Moscú (GMT+3)</option>
                                            </optgroup>
                                            <optgroup label="🌏 Asia">
                                                <option value="Asia/Dubai">Dubái (GMT+4)</option>
                                                <option value="Asia/Kolkata">India (GMT+5:30)</option>
                                                <option value="Asia/Bangkok">Bangkok (GMT+7)</option>
                                                <option value="Asia/Singapore">Singapur (GMT+8)</option>
                                                <option value="Asia/Hong_Kong">Hong Kong (GMT+8)</option>
                                                <option value="Asia/Shanghai">Shanghái (GMT+8)</option>
                                                <option value="Asia/Tokyo">Tokio (GMT+9)</option>
                                                <option value="Asia/Seoul">Seúl (GMT+9)</option>
                                            </optgroup>
                                            <optgroup label="🌍 África">
                                                <option value="Africa/Johannesburg">Johannesburgo (GMT+2)</option>
                                                <option value="Africa/Cairo">El Cairo (GMT+2)</option>
                                                <option value="Africa/Lagos">Lagos (GMT+1)</option>
                                            </optgroup>
                                            <optgroup label="🌏 Oceanía">
                                                <option value="Australia/Sydney">Sídney (GMT+11)</option>
                                                <option value="Australia/Melbourne">Melbourne (GMT+11)</option>
                                                <option value="Pacific/Auckland">Auckland (GMT+13)</option>
                                            </optgroup>
                                        </select>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-charcoal mb-2">
                                            Moneda
                                        </label>
                                        <select
                                            value={currency}
                                            onChange={(e) => setCurrency(e.target.value)}
                                            className="input-soft"
                                        >
                                            <optgroup label="🌎 América">
                                                <option value="USD">🇺🇸 USD - Dólar estadounidense</option>
                                                <option value="MXN">🇲🇽 MXN - Peso mexicano</option>
                                                <option value="CLP">🇨🇱 CLP - Peso chileno</option>
                                                <option value="ARS">🇦🇷 ARS - Peso argentino</option>
                                                <option value="COP">🇨🇴 COP - Peso colombiano</option>
                                                <option value="PEN">🇵🇪 PEN - Sol peruano</option>
                                                <option value="BRL">🇧🇷 BRL - Real brasileño</option>
                                            </optgroup>
                                            <optgroup label="🌍 Europa">
                                                <option value="EUR">🇪🇺 EUR - Euro</option>
                                                <option value="GBP">🇬🇧 GBP - Libra esterlina</option>
                                            </optgroup>
                                        </select>
                                    </div>
                                </div>

                                    {/* IVA / Impuestos */}
                                    <div className="mt-2 border border-silk-beige rounded-xl p-4 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="text-sm font-semibold text-charcoal">Incluir IVA en ventas</p>
                                                <p className="text-xs text-charcoal/50 mt-0.5">
                                                    Muestra el desglose IVA incluido en comprobantes y cierres de visita
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => setIvaEnabled(v => !v)}
                                                className={`relative w-12 h-6 rounded-full transition-colors ${ivaEnabled ? 'bg-primary-500' : 'bg-charcoal/20'}`}
                                            >
                                                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${ivaEnabled ? 'translate-x-6' : 'translate-x-0.5'}`} />
                                            </button>
                                        </div>
                                        {ivaEnabled && (
                                            <div className="flex items-center gap-3 pt-1">
                                                <label className="text-sm text-charcoal/70 shrink-0">Tasa de IVA (%)</label>
                                                <input
                                                    type="number" min="0" max="100" step="0.1"
                                                    className="input-soft w-28 text-right"
                                                    value={ivaRate}
                                                    onChange={e => setIvaRate(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                                                />
                                                <span className="text-xs text-charcoal/40">Chile 19% · México 16% · Argentina 21%</span>
                                            </div>
                                        )}
                                    </div>

                                {/* Clinic Templates */}
                                <div className="mt-8 space-y-6">
                                    <h3 className="text-sm font-semibold text-charcoal mb-4">💬 Plantillas de la Clínica</h3>

                                    <TemplateSelector
                                        label="Plantilla: Encuesta de Satisfacción"
                                        description="Se envía automáticamente horas después de que finaliza la cita."
                                        value={templateSurvey}
                                        onChange={setTemplateSurvey}
                                    />

                                </div>

                            </div>

                            {/* Services */}
                            <div className="card-soft p-4 sm:p-6">
                                <div className="flex items-center justify-between mb-6">
                                    <h2 className="text-lg font-semibold text-charcoal">Servicios</h2>
                                    {serviceSaved && (
                                        <div className="flex items-center gap-2 text-emerald-600 text-sm animate-fade-in bg-emerald-50 px-4 py-2 rounded-soft border border-emerald-100">
                                            <CheckCircle2 className="w-4 h-4" />
                                            ¡Servicio guardado exitosamente!
                                        </div>
                                    )}
                                    <button
                                        onClick={() => {
                                            setAssignedProfessionals({})
                                            setPrimaryProfessional('')
                                            setEditingServiceId(null)
                                            resetServiceForm()
                                            setShowServiceModal(true)
                                        }}
                                        className="btn-ghost flex items-center gap-2 text-primary-500"
                                    >
                                        <Plus className="w-4 h-4" />
                                        Agregar Servicio
                                    </button>
                                </div>

                                <div className="space-y-3">
                                    {services.map((service) => (
                                        <div
                                            key={service.id}
                                            className="flex items-center gap-4 p-4 bg-ivory rounded-soft"
                                        >
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <p className="font-medium text-charcoal">{service.name}</p>
                                                    {service.linkedProductId && (
                                                        <span
                                                            className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full"
                                                            title="Al venderse descuenta stock del inventario"
                                                        >
                                                            <Package className="w-2.5 h-2.5" />
                                                            Descuenta stock
                                                        </span>
                                                    )}
                                                    {service.publicBookable && (
                                                        <span
                                                            className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full"
                                                            title="Los clientes pueden reservarlo desde tu página online"
                                                        >
                                                            <Link2 className="w-2.5 h-2.5" />
                                                            Reservable online
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-sm text-charcoal/50">
                                                    {service.duration} minutos · {currencySymbols[currency]}{service.price.toLocaleString()} {currency}
                                                </p>
                                            </div>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => handleEditService(service)}
                                                    className="p-2 text-charcoal/40 hover:text-primary-500 hover:bg-primary-50 rounded-soft transition-colors"
                                                    title="Editar servicio"
                                                >
                                                    <CreditCard className="w-4 h-4" /> {/* Using generic icon, maybe Edit/Pencil is better but relying on import */}
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteService(service.id)}
                                                    className="p-2 text-charcoal/40 hover:text-red-500 hover:bg-red-50 rounded-soft transition-colors"
                                                    title="Eliminar servicio"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                    {services.length === 0 && (
                                        <p className="text-center text-charcoal/50 py-8">No hay servicios configurados. Agrega tu primer servicio.</p>
                                    )}
                                </div>
                            </div>

                            {/* Add/Edit Service Modal */}
                            {showServiceModal && (
                                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fade-in">
                                    <div className="bg-white rounded-soft p-6 w-full max-w-md shadow-xl">
                                        <div className="flex items-center justify-between mb-6">
                                            <h3 className="text-lg font-semibold text-charcoal">{editingServiceId ? 'Editar Servicio' : 'Nuevo Servicio'}</h3>
                                            <button
                                                onClick={() => {
                                                    setShowServiceModal(false);
                                                    setEditingServiceId(null);
                                                    resetServiceForm();
                                                }}
                                                className="p-2 hover:bg-silk-beige rounded-soft transition-colors"
                                            >
                                                <X className="w-5 h-5 text-charcoal/60" />
                                            </button>
                                        </div>

                                        <div className="space-y-4">
                                            <div>
                                                <label className="block text-sm font-medium text-charcoal mb-2">Nombre del Servicio</label>
                                                <input
                                                    type="text"
                                                    placeholder="Ej: Consulta Veterinaria General"
                                                    value={newServiceName}
                                                    onChange={(e) => setNewServiceName(e.target.value)}
                                                    className="input-soft"
                                                />
                                            </div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-sm font-medium text-charcoal mb-2">Duración (min)</label>
                                                    <input
                                                        type="number"
                                                        min="5"
                                                        step="5"
                                                        value={newServiceDuration}
                                                        onChange={(e) => setNewServiceDuration(e.target.value)}
                                                        className="input-soft"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-medium text-charcoal mb-2">Precio ({currency})</label>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        value={newServicePrice}
                                                        onChange={(e) => setNewServicePrice(e.target.value)}
                                                        className="input-soft"
                                                        placeholder="0"
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Descuento de stock — el servicio es el concepto que se cobra,
                                            el producto vinculado es lo que se consume del inventario. */}
                                        {inventoryProducts.length > 0 && (
                                            <div className="border-t border-silk-beige pt-4 mt-4">
                                                <p className="text-sm font-medium text-charcoal flex items-center gap-2 mb-1">
                                                    <Package className="w-4 h-4 text-violet-500" />
                                                    Descuenta stock del inventario
                                                </p>
                                                <p className="text-xs text-charcoal/50 mb-3">
                                                    Opcional. Si este servicio consume un producto (ej. una vacuna), al venderlo
                                                    se descuenta solo del inventario. El ingreso se sigue contando como servicio.
                                                </p>
                                                <div className="grid grid-cols-3 gap-3">
                                                    <div className="col-span-2">
                                                        <select
                                                            value={newServiceLinkedProductId}
                                                            onChange={(e) => setNewServiceLinkedProductId(e.target.value)}
                                                            className="input-soft"
                                                        >
                                                            <option value="">Sin producto vinculado</option>
                                                            {inventoryProducts.map((p: any) => (
                                                                <option key={p.id} value={p.id}>
                                                                    {p.name} ({p.stock_quantity} en stock)
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <input
                                                            type="number"
                                                            min="1"
                                                            step="1"
                                                            value={newServiceLinkedProductQty}
                                                            onChange={(e) => setNewServiceLinkedProductQty(e.target.value)}
                                                            disabled={!newServiceLinkedProductId}
                                                            className="input-soft disabled:opacity-40"
                                                            placeholder="1"
                                                            title="Unidades que consume cada venta"
                                                        />
                                                    </div>
                                                </div>
                                                {newServiceLinkedProductId && (
                                                    <p className="text-xs text-violet-600 mt-2">
                                                        Cada venta descontará {Math.max(1, parseInt(newServiceLinkedProductQty) || 1)} unidad
                                                        {Math.max(1, parseInt(newServiceLinkedProductQty) || 1) === 1 ? '' : 'es'} del inventario.
                                                    </p>
                                                )}
                                            </div>
                                        )}

                                        {/* Reservable en la página pública */}
                                        <div className="border-t border-silk-beige pt-4 mt-4">
                                            <label className="flex items-center gap-3 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={newServicePublicBookable}
                                                    onChange={(e) => setNewServicePublicBookable(e.target.checked)}
                                                    className="accent-primary-500 w-4 h-4"
                                                />
                                                <span className="text-sm font-medium text-charcoal flex items-center gap-2">
                                                    <Link2 className="w-4 h-4 text-primary-500" />
                                                    Reservable en tu página online
                                                </span>
                                            </label>
                                            <p className="text-xs text-charcoal/50 mt-1 ml-7">
                                                Aparece en {publicBookingSlug ? `vetly.pro/reservar/${publicBookingSlug}` : 'tu página de reservas (configúrala en la pestaña "Reservas Online")'} para que los clientes agenden solos.
                                            </p>
                                        </div>

                                        {/* Professional Assignment Section */}
                                        {clinicProfessionals.length > 0 && (
                                            <div className="border-t border-silk-beige pt-4 mt-4">
                                                <p className="text-sm font-medium text-charcoal flex items-center gap-2 mb-3">
                                                    <Users className="w-4 h-4 text-primary-500" />
                                                    Profesionales Asignados
                                                </p>
                                                <p className="text-xs text-charcoal/50 mb-3">Selecciona quién realiza este servicio. Marca ⭐ al profesional principal.</p>
                                                <div className="space-y-2">
                                                    {clinicProfessionals.map((prof: any) => {
                                                        const pId = prof.member_id || prof.id
                                                        const isAssigned = assignedProfessionals[pId] || false
                                                        const isPrimary = primaryProfessional === pId
                                                        return (
                                                            <div
                                                                key={prof.member_id}
                                                                className={cn(
                                                                    "flex items-center gap-3 p-2.5 rounded-lg transition-colors cursor-pointer",
                                                                    isAssigned ? "bg-primary-50 border border-primary-200" : "bg-ivory border border-transparent hover:border-silk-beige"
                                                                )}
                                                                onClick={() => {
                                                                    setAssignedProfessionals(prev => ({
                                                                        ...prev,
                                                                        [pId]: !prev[pId]
                                                                    }))
                                                                    // Clear primary if unassigning
                                                                    if (isAssigned && isPrimary) {
                                                                        setPrimaryProfessional('')
                                                                    }
                                                                }}
                                                            >
                                                                <input
                                                                    type="checkbox"
                                                                    checked={isAssigned}
                                                                    readOnly
                                                                    className="accent-primary-500 w-4 h-4 pointer-events-none"
                                                                />
                                                                <div
                                                                    className="w-3 h-3 rounded-full flex-shrink-0"
                                                                    style={{ backgroundColor: prof.color || '#8B5CF6' }}
                                                                />
                                                                <span className={cn("text-sm flex-1", isAssigned ? "text-charcoal font-medium" : "text-charcoal/60")}>
                                                                    {prof.first_name || ''} {prof.last_name || ''}
                                                                    {prof.job_title ? ` · ${prof.job_title}` : ''}
                                                                </span>
                                                                {isAssigned && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation()
                                                                            setPrimaryProfessional(isPrimary ? '' : pId)
                                                                        }}
                                                                        className={cn(
                                                                            "text-sm transition-colors",
                                                                            isPrimary ? "text-amber-500" : "text-charcoal/20 hover:text-amber-400"
                                                                        )}
                                                                        title={isPrimary ? 'Profesional principal' : 'Marcar como principal'}
                                                                    >
                                                                        ⭐
                                                                    </button>
                                                                )}
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            </div>
                                        )}

                                        <div className="flex gap-3 mt-6">
                                            <button
                                                onClick={() => {
                                                    setShowServiceModal(false);
                                                    setEditingServiceId(null);
                                                    resetServiceForm();
                                                }}
                                                className="btn-ghost flex-1"
                                            >
                                                Cancelar
                                            </button>
                                            <button
                                                onClick={handleSaveService}
                                                disabled={!newServiceName.trim()}
                                                className="btn-primary flex-1"
                                            >
                                                {editingServiceId ? 'Guardar Cambios' : 'Agregar'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Diseño de marca (logo + colores) y Página de Reservas Online */}
                    {activeTab === 'branding' && (
                        <div className="space-y-6">
                            {/* Card 1 — Diseño de marca: siempre visible */}
                            <div className="card-soft p-4 sm:p-6">
                                <div className="mb-4">
                                    <h2 className="text-lg font-semibold text-charcoal flex items-center gap-2">
                                        <Palette className="w-5 h-5 text-primary-500" />
                                        Diseño de marca
                                    </h2>
                                    <p className="text-sm text-charcoal/50 mt-1">
                                        Se usa en tu página de reservas online y en los documentos que descargues (recetas, informes).
                                    </p>
                                </div>

                                <div className="space-y-5">
                                    <div>
                                        <label className="block text-sm font-medium text-charcoal mb-2 flex items-center gap-2">
                                            <ImageIcon className="w-4 h-4 text-charcoal/40" /> Logo
                                        </label>
                                        <div className="flex items-center gap-4">
                                            {bookingLogoUrl && (
                                                <img src={bookingLogoUrl} alt="Logo" className="h-12 w-12 object-contain rounded-lg border border-silk-beige bg-ivory" />
                                            )}
                                            <label className="btn-ghost cursor-pointer flex items-center gap-2 text-sm">
                                                {uploadingLogo ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
                                                {bookingLogoUrl ? 'Cambiar logo' : 'Subir logo'}
                                                <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={handleLogoUpload} disabled={uploadingLogo} className="hidden" />
                                            </label>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                                        <div>
                                            <label className="block text-sm font-medium text-charcoal mb-2 flex items-center gap-2">
                                                <Palette className="w-4 h-4 text-charcoal/40" /> Color principal
                                            </label>
                                            <div className="flex items-center gap-3">
                                                <input
                                                    type="color"
                                                    value={bookingBrandColor}
                                                    onChange={(e) => setBookingBrandColor(e.target.value)}
                                                    className="w-12 h-10 rounded-lg border border-silk-beige cursor-pointer"
                                                />
                                                <input
                                                    type="text"
                                                    value={bookingBrandColor}
                                                    onChange={(e) => setBookingBrandColor(e.target.value)}
                                                    className="input-soft w-28 font-mono text-sm"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-charcoal mb-2 flex items-center gap-2">
                                                <Palette className="w-4 h-4 text-charcoal/40" /> Color secundario <span className="text-charcoal/40 font-normal">(opcional)</span>
                                            </label>
                                            <div className="flex items-center gap-3">
                                                <input
                                                    type="color"
                                                    value={bookingBrandColorSecondary || bookingBrandColor}
                                                    onChange={(e) => setBookingBrandColorSecondary(e.target.value)}
                                                    className="w-12 h-10 rounded-lg border border-silk-beige cursor-pointer"
                                                />
                                                <input
                                                    type="text"
                                                    value={bookingBrandColorSecondary}
                                                    onChange={(e) => setBookingBrandColorSecondary(e.target.value)}
                                                    placeholder="Sin definir"
                                                    className="input-soft w-28 font-mono text-sm"
                                                />
                                                {bookingBrandColorSecondary && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setBookingBrandColorSecondary('')}
                                                        className="text-xs font-bold text-charcoal/40 hover:text-red-500"
                                                    >
                                                        Quitar
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        <p className="text-xs font-medium text-charcoal/40 uppercase tracking-widest mb-2">Vista previa</p>
                                        <div
                                            className="h-20 rounded-xl flex items-center justify-center"
                                            style={{ background: `linear-gradient(135deg, ${bookingBrandColor}, ${bookingBrandColorSecondary || bookingBrandColor})` }}
                                        >
                                            {bookingLogoUrl
                                                ? <img src={bookingLogoUrl} alt="Logo" className="h-12 object-contain" />
                                                : <span className="text-white font-black tracking-tight" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.35)' }}>{clinicName || 'Tu clínica'}</span>}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Card 2 — Página de reservas online */}
                            <div className="card-soft p-4 sm:p-6">
                                <div className="flex items-center justify-between mb-2">
                                    <div>
                                        <h2 className="text-lg font-semibold text-charcoal flex items-center gap-2">
                                            <Link2 className="w-5 h-5 text-primary-500" />
                                            Página de reservas online
                                        </h2>
                                        <p className="text-sm text-charcoal/50 mt-1">
                                            Un enlace propio para que tus clientes agenden sus citas directamente, sin necesidad de un agente de IA.
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => setPublicBookingEnabled(!publicBookingEnabled)}
                                        className={cn(
                                            "relative w-12 h-6 rounded-full transition-colors shrink-0 ml-4",
                                            publicBookingEnabled ? "bg-primary-500" : "bg-charcoal/20"
                                        )}
                                    >
                                        <span className={cn(
                                            "absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform",
                                            publicBookingEnabled && "translate-x-6"
                                        )} />
                                    </button>
                                </div>

                                {publicBookingEnabled && (
                                    <div className="mt-6 space-y-5 border-t border-silk-beige pt-5">
                                        <div>
                                            <label className="block text-sm font-medium text-charcoal mb-2">Tu enlace</label>
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm text-charcoal/40 shrink-0">vetly.pro/reservar/</span>
                                                <input
                                                    type="text"
                                                    value={publicBookingSlug}
                                                    onChange={(e) => setPublicBookingSlug(e.target.value)}
                                                    placeholder={slugify(clinicName) || 'mi-clinica'}
                                                    className="input-soft flex-1"
                                                />
                                            </div>
                                            {bookingUrl && (
                                                <div className="flex items-center gap-2 mt-2">
                                                    <a href={bookingUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary-600 hover:underline truncate">{bookingUrl}</a>
                                                    <button onClick={copyBookingUrl} className="text-xs font-bold text-charcoal/50 hover:text-primary-600 flex items-center gap-1 shrink-0">
                                                        {bookingLinkCopied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                                                        {bookingLinkCopied ? 'Copiado' : 'Copiar'}
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
                                            Marca qué servicios son reservables desde la pestaña <strong>Clínica → Servicios</strong> (checkbox "Reservable en tu página online" al editar cada uno).
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="flex justify-end">
                                <button onClick={handleSaveBooking} disabled={savingBooking} className="btn-primary flex items-center gap-2">
                                    {savingBooking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                    Guardar
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Subscription Settings */}
                    {activeTab === 'subscription' && (
                        <div className="space-y-6">
                            {/* Payment Return Message */}
                            {paymentMessage && (
                                <div className={`p-4 rounded-soft flex items-center gap-3 animate-fade-in ${paymentMessage.type === 'success' ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' :
                                    paymentMessage.type === 'error' ? 'bg-red-50 border border-red-200 text-red-800' :
                                        'bg-amber-50 border border-amber-200 text-amber-800'
                                    }`}>
                                    {paymentMessage.type === 'success' ? <CheckCircle2 className="w-5 h-5 flex-shrink-0" /> :
                                        paymentMessage.type === 'error' ? <CreditCard className="w-5 h-5 flex-shrink-0" /> :
                                            <Clock className="w-5 h-5 flex-shrink-0" />}
                                    <p className="text-sm font-bold">{paymentMessage.text}</p>
                                    <button onClick={() => setPaymentMessage(null)} className="ml-auto p-1 hover:opacity-70">✕</button>
                                </div>
                            )}

                            {/* Post-payment onboarding CTA — solo en la primera conversión trial→pago */}
                            {onboardingPromptPlan && (
                                <PostPaymentOnboardingBanner
                                    clinicName={clinicName || 'tu clínica'}
                                    planName={
                                        paymentRegion === 'international'
                                            ? PADDLE_PLANS[onboardingPromptPlan as PaddlePlanId]?.name || onboardingPromptPlan
                                            : PLANS[onboardingPromptPlan as PlanId]?.name || onboardingPromptPlan
                                    }
                                    onDismiss={() => setOnboardingPromptPlan(null)}
                                />
                            )}

                            {/* Expired Trial Banner */}
                            {searchParams.get('expired') === '1' && (
                                <div className="p-5 rounded-soft bg-red-50 border-2 border-red-300 flex items-start gap-4">
                                    <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                                        <ShieldAlert className="w-5 h-5 text-red-600" />
                                    </div>
                                    <div>
                                        <p className="font-black text-red-800 text-base">Tu período de prueba ha vencido</p>
                                        <p className="text-sm text-red-700 mt-1">Tu acceso está temporalmente restringido. Para continuar usando Vetly, activa un plan de pago a continuación. Todos tus datos siguen guardados.</p>
                                    </div>
                                </div>
                            )}

                            <div className="card-soft p-4 sm:p-6">
                                <div className="flex items-center justify-between mb-6">
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 bg-primary-100 rounded-soft flex items-center justify-center">
                                            <CreditCard className="w-6 h-6 text-primary-600" />
                                        </div>
                                        <div>
                                            <h2 className="text-lg font-bold text-charcoal">Tu Suscripción</h2>
                                            <p className="text-sm text-charcoal/50">Gestiona tu plan y facturación</p>
                                        </div>
                                    </div>
                                    <div className={cn(
                                        "px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider",
                                        isPaidActive ? 'bg-emerald-100 text-emerald-700' :
                                            isInTrialWindow ? 'bg-amber-100 text-amber-700' :
                                                'bg-charcoal/10 text-charcoal/60'
                                    )}>
                                        {subscriptionStatusLabel}
                                    </div>
                                </div>

                                <div className="bg-ivory border border-silk-beige rounded-soft p-6 mb-8">
                                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                                        <div>
                                            <p className="text-xs font-bold text-charcoal/40 uppercase tracking-widest mb-1">Plan Actual</p>
                                            <h3 className="text-3xl font-black text-charcoal capitalize tracking-tight">
                                                {PLANS[normalizePlanId(subscription?.plan || 'starter')]?.name || 'Plan Trial'}
                                            </h3>
                                            <div className="flex items-center gap-2 mt-2">
                                                <Sparkles className="w-4 h-4 text-primary-500" />
                                                <p className="text-sm font-medium text-charcoal/70">
                                                    {/* El trial da acceso al plan contratado, no a todo (ver resolveEffectivePlan). */}
                                                    {PLANS[normalizePlanId(subscription?.plan || 'starter')]?.tagline || 'Periodo de prueba de tu plan'}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            {(() => {
                                                const np = normalizePlanId(subscription?.plan || '')
                                                const mpPlanInfo = PLANS[np as PlanId]
                                                const paddlePlanInfo = PADDLE_PLANS[np as PaddlePlanId]
                                                const clpLaunch = mpPlanInfo && 'launchPrice' in mpPlanInfo ? mpPlanInfo.launchPrice : null
                                                const usdLaunch = paddlePlanInfo && 'launchPrice' in paddlePlanInfo ? paddlePlanInfo.launchPrice : null
                                                const clpPrice = clpLaunch ?? mpPlanInfo?.price
                                                const usdPrice = usdLaunch ?? paddlePlanInfo?.price
                                                // El número grande sigue el toggle de moneda (paymentRegion), igual
                                                // que el grid de abajo -- antes siempre mostraba CLP como
                                                // protagonista aunque el toggle dijera "Internacional (USD)".
                                                const showUsdFirst = paymentRegion === 'international' && usdPrice != null
                                                const primaryBlock = showUsdFirst ? (
                                                    <p className="text-2xl font-black text-charcoal">
                                                        {usdLaunch != null && <span className="text-sm font-semibold text-charcoal/40 line-through mr-1.5">US${paddlePlanInfo!.price}</span>}
                                                        US${usdPrice} <span className="text-xs font-bold text-charcoal/40">USD/mes</span>
                                                    </p>
                                                ) : clpPrice != null ? (
                                                    <p className="text-2xl font-black text-charcoal">
                                                        {clpLaunch != null && <span className="text-sm font-semibold text-charcoal/40 line-through mr-1.5">${mpPlanInfo!.price.toLocaleString()}</span>}
                                                        ${clpPrice.toLocaleString()} <span className="text-xs font-bold text-charcoal/40">CLP/mes</span>
                                                    </p>
                                                ) : null
                                                const secondaryBlock = showUsdFirst
                                                    ? (clpPrice != null ? (
                                                        <p className="text-sm font-semibold text-charcoal/50 mt-0.5">
                                                            {clpLaunch != null && <span className="line-through mr-1">${mpPlanInfo!.price.toLocaleString()}</span>}
                                                            ${clpPrice.toLocaleString()} <span className="text-xs">CLP/mes</span>
                                                        </p>
                                                    ) : null)
                                                    : (usdPrice != null ? (
                                                        <p className="text-sm font-semibold text-charcoal/50 mt-0.5">
                                                            {usdLaunch != null && <span className="line-through mr-1">US${paddlePlanInfo!.price}</span>}
                                                            US${usdPrice} <span className="text-xs">USD/mes</span>
                                                        </p>
                                                    ) : null)
                                                return (
                                                    <div>
                                                        {primaryBlock}
                                                        {secondaryBlock}
                                                        {(clpLaunch != null || usdLaunch != null) && (
                                                            <span className="inline-block mt-1 bg-primary-500 text-white text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full">
                                                                Precio de lanzamiento
                                                            </span>
                                                        )}
                                                        {!clpPrice && !usdPrice && <p className="text-2xl font-black text-charcoal">$0 <span className="text-xs font-bold text-charcoal/40">CLP/mes</span></p>}
                                                    </div>
                                                )
                                            })()}
                                            {isInTrialWindow && subscription?.trialEndsAt && (
                                                <div className="mt-2 flex items-center justify-end gap-2 text-amber-600">
                                                    <Clock className="w-4 h-4" />
                                                    <p className="text-xs font-bold">
                                                        Termina en {Math.max(0, Math.ceil((new Date(subscription.trialEndsAt).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)))} días
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex flex-wrap gap-4">
                                    {!isPaidActive && (
                                        <button
                                            onClick={() => handlePlanSelection(normalizePlanId(subscription?.plan || 'starter'))}
                                            className="btn-primary"
                                        >
                                            {isInTrialWindow ? 'Suscribirme ahora' : 'Reactivar suscripción'}
                                        </button>
                                    )}
                                    {isPaidActive && currentPaymentProvider === 'mercadopago' && (
                                        <a
                                            href="https://www.mercadopago.com.mx/subscriptions"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="btn-ghost"
                                        >
                                            Gestionar en Mercado Pago
                                        </a>
                                    )}
                                    {subscription?.status === 'active' && (
                                        <button
                                            onClick={async () => {
                                                if (!confirm('\u00bfEst\u00e1s seguro de que deseas cancelar tu suscripci\u00f3n? Perder\u00e1s acceso a todas las funcionalidades al final del per\u00edodo actual.')) return
                                                setCancellingSubscription(true)
                                                try {
                                                    const { error: cancelError } = await (supabase as any)
                                                        .from('subscriptions')
                                                        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
                                                        .eq('clinic_id', clinicId)
                                                    if (cancelError) throw cancelError
                                                    setSubscription(prev => prev ? { ...prev, status: 'cancelled' } : null)
                                                    toast.success('Suscripci\u00f3n cancelada. Tendr\u00e1s acceso hasta el fin del per\u00edodo actual.')
                                                } catch (err: any) {
                                                    toast.error('Error al cancelar: ' + (err.message || 'Error desconocido'))
                                                } finally {
                                                    setCancellingSubscription(false)
                                                }
                                            }}
                                            disabled={cancellingSubscription}
                                            className="text-xs font-bold text-red-500 hover:text-red-700 hover:bg-red-50 px-4 py-2.5 rounded-soft border border-red-200 transition-all flex items-center gap-2"
                                        >
                                            {cancellingSubscription ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                                            Cancelar suscripción
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Plan Cards */}
                            <div id="compare-plans" className="space-y-4">
                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-2">
                                    <div className="flex flex-col">
                                        <h2 className="text-xl font-black text-charcoal tracking-tight">Compara nuestros planes</h2>
                                        <div className="bg-primary-500/10 text-primary-600 w-fit px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider mt-1">
                                            Garantía de Satisfacción
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-3 bg-silk-beige p-1.5 rounded-soft border border-silk-beige shadow-sm">
                                        <button
                                            onClick={async () => {
                                                setPaymentRegion('chile');
                                                if (clinicId) {
                                                    await (supabase as any).from('clinic_settings').update({ payment_provider: 'mercadopago' }).eq('id', clinicId);
                                                }
                                            }}
                                            className={cn(
                                                "px-4 py-2 rounded-soft text-xs font-bold transition-all flex items-center gap-2",
                                                paymentRegion === 'chile'
                                                    ? "bg-white text-charcoal shadow-sm"
                                                    : "text-charcoal/40 hover:text-charcoal/60"
                                            )}
                                        >
                                            🇨🇱 Chile (CLP)
                                        </button>
                                        <button
                                            onClick={async () => {
                                                setPaymentRegion('international');
                                                if (clinicId) {
                                                    await (supabase as any).from('clinic_settings').update({ payment_provider: 'paddle' }).eq('id', clinicId);
                                                }
                                            }}
                                            className={cn(
                                                "px-4 py-2 rounded-soft text-xs font-bold transition-all flex items-center gap-2",
                                                paymentRegion === 'international'
                                                    ? "bg-white text-charcoal shadow-sm"
                                                    : "text-charcoal/40 hover:text-charcoal/60"
                                            )}
                                        >
                                            🌎 Internacional (USD)
                                        </button>
                                    </div>
                                </div>

                                {/* Mensual / Anual — el anual solo existe en Paddle (USD) */}
                                {paymentRegion === 'international' && (
                                    <div className="flex items-center justify-center mb-5">
                                        <div className="inline-flex items-center p-1 bg-ivory rounded-xl border border-silk-beige">
                                            <button
                                                onClick={() => setBillingPeriod('month')}
                                                className={cn(
                                                    "px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all",
                                                    billingPeriod === 'month' ? "bg-white text-charcoal shadow-sm border border-silk-beige" : "text-charcoal/40 hover:text-charcoal"
                                                )}
                                            >
                                                Mensual
                                            </button>
                                            <button
                                                onClick={() => setBillingPeriod('year')}
                                                className={cn(
                                                    "px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all flex items-center gap-2",
                                                    billingPeriod === 'year' ? "bg-white text-charcoal shadow-sm border border-silk-beige" : "text-charcoal/40 hover:text-charcoal"
                                                )}
                                            >
                                                Anual
                                                <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 normal-case tracking-normal">
                                                    2 meses gratis
                                                </span>
                                            </button>
                                        </div>
                                    </div>
                                )}

                                <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-5">
                                    {(Object.keys(PLANS) as PlanId[]).map((planId) => {
                                        const mpPlan = PLANS[planId]
                                        const paddlePlan = PADDLE_PLANS[planId as PaddlePlanId]
                                        const normalizedCurrent = normalizePlanId(subscription?.plan || '')
                                        const isOwnPlan = planId === normalizedCurrent
                                        // "Plan Actual" (deshabilitado) solo cuando ya se está pagando de
                                        // verdad -- si no, es el propio plan de un trial sin pagar, y el
                                        // botón debe seguir habilitado para poder suscribirse.
                                        const isCurrentPlan = isOwnPlan && isPaidActive
                                        const isOwnUnpaidPlan = isOwnPlan && !isPaidActive
                                        const isPro = planId === 'pro'
                                        const mpLaunch = 'launchPrice' in mpPlan ? mpPlan.launchPrice : null
                                        const paddleLaunch = paddlePlan && 'launchPrice' in paddlePlan ? paddlePlan.launchPrice : null
                                        const paddleLaunchAnnual = paddlePlan && 'launchAnnualTotal' in paddlePlan ? paddlePlan.launchAnnualTotal : null
                                        // Solo Core tiene precio anual creado en Paddle por ahora.
                                        const supportsAnnual = !!paddlePlan && planSupportsAnnual(planId as PaddlePlanId)

                                        return (
                                            <div
                                                key={planId}
                                                className={cn(
                                                    "relative flex flex-col p-5 rounded-soft border-2 transition-all duration-300",
                                                    isCurrentPlan ? "border-primary-500 bg-primary-500/5 ring-4 ring-primary-500/10" : "border-silk-beige bg-white hover:border-primary-300 hover:shadow-xl",
                                                    isPro && !isCurrentPlan && "shadow-premium-lg border-primary-500 z-10"
                                                )}
                                            >
                                                {isPro && (
                                                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-hero-gradient text-white text-[10px] font-black px-4 py-1 rounded-full shadow-lg uppercase tracking-widest whitespace-nowrap">
                                                        Más Popular
                                                    </div>
                                                )}

                                                <div className="mb-5">
                                                    <h3 className="text-xl font-black text-charcoal uppercase tracking-tighter">{mpPlan.name}</h3>
                                                    <p className="text-xs font-bold text-charcoal/40 mt-1 leading-tight min-h-[2.5rem]">{mpPlan.tagline}</p>
                                                    <div className="mt-3 border-b border-silk-beige pb-3">
                                                        {paymentRegion === 'international' ? (
                                                            billingPeriod === 'year' && supportsAnnual ? (
                                                                <>
                                                                    <div className="flex items-baseline gap-1 flex-wrap">
                                                                        {paddleLaunchAnnual != null && <span className="text-sm font-semibold text-charcoal/40 line-through">US${paddlePlan?.annualTotal ?? 0}</span>}
                                                                        <span className="text-3xl font-black text-charcoal">US${paddleLaunchAnnual ?? paddlePlan?.annualTotal ?? 0}</span>
                                                                        <span className="text-xs font-bold text-charcoal/40 uppercase">USD/año</span>
                                                                    </div>
                                                                    <p className="text-xs font-semibold text-emerald-600 mt-0.5">
                                                                        Equivale a US${Math.round((paddleLaunchAnnual ?? paddlePlan?.annualTotal ?? 0) / 12)}/mes · 2 meses gratis
                                                                    </p>
                                                                </>
                                                            ) : (
                                                            <>
                                                                <div className="flex items-baseline gap-1 flex-wrap">
                                                                    {paddleLaunch != null && <span className="text-sm font-semibold text-charcoal/40 line-through">US${paddlePlan?.price ?? 0}</span>}
                                                                    <span className="text-3xl font-black text-charcoal">US${paddleLaunch ?? paddlePlan?.price ?? 0}</span>
                                                                    <span className="text-xs font-bold text-charcoal/40 uppercase">USD/mes</span>
                                                                </div>
                                                                {billingPeriod === 'year' ? (
                                                                    <p className="text-xs font-semibold text-charcoal/40 mt-0.5">Este plan solo se factura mensualmente</p>
                                                                ) : (
                                                                    <p className="text-xs font-semibold text-charcoal/40 mt-0.5">${(mpLaunch ?? mpPlan.price).toLocaleString()} CLP/mes</p>
                                                                )}
                                                            </>
                                                            )
                                                        ) : (
                                                            <>
                                                                <div className="flex items-baseline gap-1 flex-wrap">
                                                                    {mpLaunch != null && <span className="text-sm font-semibold text-charcoal/40 line-through">${mpPlan.price.toLocaleString()}</span>}
                                                                    <span className="text-3xl font-black text-charcoal">${(mpLaunch ?? mpPlan.price).toLocaleString()}</span>
                                                                    <span className="text-xs font-bold text-charcoal/40 uppercase">CLP/mes</span>
                                                                </div>
                                                                {paddlePlan && (
                                                                    <p className="text-xs font-semibold text-charcoal/40 mt-0.5">US${paddleLaunch ?? paddlePlan.price} USD/mes</p>
                                                                )}
                                                            </>
                                                        )}
                                                        {(mpLaunch != null || paddleLaunch != null) && (
                                                            <span className="inline-block mt-1.5 bg-primary-500 text-white text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full">
                                                                Lanzamiento
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>

                                                <ul className="space-y-3 mb-8 flex-grow">
                                                    {mpPlan.features.map((feature, idx) => (
                                                        <li key={idx} className="flex items-start gap-3">
                                                            <div className="mt-1 w-4 h-4 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                                                                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                                            </div>
                                                            <span className="text-sm font-medium text-charcoal/70 leading-snug">{feature}</span>
                                                        </li>
                                                    ))}
                                                </ul>

                                                <button
                                                    onClick={() => handlePlanSelection(planId, billingPeriod === 'year' && supportsAnnual ? 'year' : 'month')}
                                                    disabled={isCurrentPlan}
                                                    className={cn(
                                                        "w-full py-3 rounded-soft font-black text-sm uppercase tracking-widest transition-all",
                                                        isCurrentPlan
                                                            ? "bg-charcoal/10 text-charcoal/40 cursor-not-allowed"
                                                            : isPro
                                                                ? "bg-hero-gradient text-white shadow-lg hover:shadow-xl hover:scale-[1.02]"
                                                                : "bg-charcoal text-white hover:bg-primary-500"
                                                    )}
                                                >
                                                    {isCurrentPlan ? 'Plan Actual' : isOwnUnpaidPlan ? 'Suscribirme ahora' : 'Seleccionar Plan'}
                                                </button>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Team Settings */}
                    {activeTab === 'team' && (
                        <Team />
                    )}

                    {/* Schedule Settings */}
                    {activeTab === 'schedule' && (
                        <>
                            <div className="card-soft p-4 sm:p-6">
                                <h2 className="text-lg font-semibold text-charcoal mb-6">Horarios de Atención</h2>

                                <div className="space-y-3">
                                    {dayOrder.map((day) => {
                                        const hours = workingHours[day];
                                        return (
                                            <div
                                                key={day}
                                                className="flex flex-wrap items-center gap-2 sm:gap-4 p-4 bg-ivory rounded-soft"
                                            >
                                                <div className="w-24 sm:w-28 flex-shrink-0">
                                                    <p className="font-medium text-charcoal">{dayNames[day]}</p>
                                                </div>

                                                <label className="flex items-center gap-2 mr-2">
                                                    <input
                                                        type="checkbox"
                                                        checked={hours !== null}
                                                        onChange={(e) => {
                                                            const checked = e.target.checked;
                                                            setWorkingHours((prev: any) => ({
                                                                ...prev,
                                                                [day]: checked ? { open: '09:00', close: '18:00' } : null
                                                            }))
                                                        }}
                                                        className="w-4 h-4 rounded border-silk-beige text-primary-500 focus:ring-primary-500"
                                                    />
                                                    <span className="text-sm text-charcoal/60">Abierto</span>
                                                </label>

                                                {hours ? (
                                                    <div className="flex flex-col gap-3 flex-1 min-w-[280px]">
                                                        <div className="flex items-center gap-2">
                                                            <input
                                                                type="time"
                                                                value={(hours as any).open}
                                                                onChange={(e) => {
                                                                    const val = e.target.value;
                                                                    setWorkingHours((prev: any) => ({
                                                                        ...prev,
                                                                        [day]: { ...prev[day], open: val }
                                                                    }))
                                                                }}
                                                                className="px-2 sm:px-3 py-2 bg-white border border-silk-beige rounded-soft text-sm flex-1"
                                                            />
                                                            <span className="text-charcoal/40">a</span>
                                                            <input
                                                                type="time"
                                                                value={(hours as any).close}
                                                                onChange={(e) => {
                                                                    const val = e.target.value;
                                                                    setWorkingHours((prev: any) => ({
                                                                        ...prev,
                                                                        [day]: { ...prev[day], close: val }
                                                                    }))
                                                                }}
                                                                className="px-2 sm:px-3 py-2 bg-white border border-silk-beige rounded-soft text-sm flex-1"
                                                            />
                                                        </div>

                                                        {/* Colación UI */}
                                                        <div className="flex flex-wrap items-center gap-4 pl-4 border-l-2 border-silk-beige/30 ml-1">
                                                            <label className="flex items-center gap-2 cursor-pointer">
                                                                <div className="relative inline-flex items-center">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={(hours as any).lunch_break?.enabled || false}
                                                                        onChange={(e) => {
                                                                            const checked = e.target.checked;
                                                                            setWorkingHours((prev: any) => ({
                                                                                ...prev,
                                                                                [day]: {
                                                                                    ...prev[day],
                                                                                    lunch_break: {
                                                                                        ...(prev[day].lunch_break || { start: '14:00', end: '15:00' }),
                                                                                        enabled: checked
                                                                                    }
                                                                                }
                                                                            }
                                                                            ))
                                                                        }}
                                                                        className="sr-only peer"
                                                                    />
                                                                    <div className="w-8 h-4 bg-silk-beige peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-primary-500"></div>
                                                                </div>
                                                                <span className="text-xs font-medium text-charcoal/50">Colación</span>
                                                            </label>

                                                            {(hours as any).lunch_break?.enabled && (
                                                                <div className="flex items-center gap-2 animate-fade-in">
                                                                    <input
                                                                        type="time"
                                                                        value={(hours as any).lunch_break.start}
                                                                        onChange={(e) => {
                                                                            const val = e.target.value;
                                                                            setWorkingHours((prev: any) => ({
                                                                                ...prev,
                                                                                [day]: {
                                                                                    ...prev[day],
                                                                                    lunch_break: { ...prev[day].lunch_break, start: val }
                                                                                }
                                                                            }))
                                                                        }}
                                                                        className="px-2 py-1 bg-white border border-silk-beige rounded-soft text-xs w-24"
                                                                    />
                                                                    <span className="text-charcoal/40 text-xs font-bold font-bold">a</span>
                                                                    <input
                                                                        type="time"
                                                                        value={(hours as any).lunch_break.end}
                                                                        onChange={(e) => {
                                                                            const val = e.target.value;
                                                                            setWorkingHours((prev: any) => ({
                                                                                ...prev,
                                                                                [day]: {
                                                                                    ...prev[day],
                                                                                    lunch_break: { ...prev[day].lunch_break, end: val }
                                                                                }
                                                                            }))
                                                                        }}
                                                                        className="px-2 py-1 bg-white border border-silk-beige rounded-soft text-xs w-24"
                                                                    />
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <span className="text-sm text-charcoal/40 ml-2">Cerrado</span>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>

                                <div className="mt-6 pt-6 border-t border-silk-beige flex items-center gap-4">
                                    <button
                                        onClick={handleSaveSchedule}
                                        disabled={savingSchedule}
                                        className="btn-primary flex items-center gap-2"
                                    >
                                        {savingSchedule ? (
                                            <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</>
                                        ) : (
                                            <><Save className="w-4 h-4" /> Guardar Horarios</>
                                        )}
                                    </button>
                                    {scheduleSaved && (
                                        <div className="flex items-center gap-2 text-emerald-600 text-sm animate-fade-in bg-emerald-50 px-4 py-2 rounded-soft">
                                            <CheckCircle2 className="w-4 h-4" />
                                            ¡Horarios guardados!
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Blocked Dates Section */}
                            <div className="card-soft p-4 sm:p-6 mt-6">
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="w-10 h-10 bg-amber-50 rounded-full flex items-center justify-center">
                                        <Calendar className="w-5 h-5 text-amber-500" />
                                    </div>
                                    <div>
                                        <h2 className="text-lg font-bold text-charcoal">Días de Cierre Especial</h2>
                                        <p className="text-sm text-charcoal/50">Bloquea días específicos (feriados o vacaciones) para que nadie pueda agendar una cita.</p>
                                    </div>
                                </div>

                                <div className="bg-ivory border border-silk-beige rounded-soft p-4 mb-6">
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div>
                                            <label className="block text-xs font-bold text-charcoal/40 uppercase tracking-widest mb-2">Fecha</label>
                                            <input
                                                type="date"
                                                value={newBlockedDate}
                                                min={new Date().toISOString().split('T')[0]}
                                                onChange={(e) => setNewBlockedDate(e.target.value)}
                                                className="input-soft w-full"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-charcoal/40 uppercase tracking-widest mb-2">Motivo (Opcional)</label>
                                            <input
                                                type="text"
                                                value={newBlockedReason}
                                                onChange={(e) => setNewBlockedReason(e.target.value)}
                                                placeholder="Ej: Feriado Nacional"
                                                className="input-soft w-full"
                                            />
                                        </div>
                                        <div className="flex items-end">
                                            <button
                                                onClick={handleAddBlockedDate}
                                                disabled={isAddingBlockedDate || !newBlockedDate}
                                                className={cn(
                                                    "w-full py-2.5 flex items-center justify-center gap-2 rounded-soft font-bold transition-all",
                                                    !newBlockedDate ? "bg-charcoal/10 text-charcoal/30 cursor-not-allowed" : "bg-primary-500 text-white hover:bg-primary-600 shadow-md hover:shadow-lg"
                                                )}
                                            >
                                                {isAddingBlockedDate ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                                                Bloquear Día
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <h3 className="text-sm font-bold text-charcoal flex items-center gap-2">
                                        <History className="w-4 h-4 text-charcoal/40" />
                                        Días Bloqueados Próximos
                                    </h3>

                                    {loadingBlockedDates ? (
                                        <div className="py-8 text-center">
                                            <Loader2 className="w-8 h-8 text-primary-500 animate-spin mx-auto" />
                                        </div>
                                    ) : blockedDates.length === 0 ? (
                                        <div className="py-12 bg-ivory/50 rounded-soft border-2 border-dashed border-silk-beige flex flex-col items-center justify-center text-center">
                                            <Calendar className="w-12 h-12 text-charcoal/10 mb-2" />
                                            <p className="text-charcoal/40 text-sm italic">No hay días bloqueados próximamente.</p>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                            {blockedDates.map((item) => (
                                                <div key={item.id} className="flex items-center justify-between p-4 bg-white border border-silk-beige rounded-soft hover:shadow-sm transition-all group">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-10 h-10 bg-red-50 rounded-soft flex flex-col items-center justify-center border border-red-100 flex-shrink-0">
                                                            <span className="text-[10px] font-black text-red-400 uppercase leading-none">
                                                                {new Date(item.blocked_date + 'T12:00:00Z').toLocaleString('es-ES', { month: 'short' })}
                                                            </span>
                                                            <span className="text-lg font-black text-red-600 leading-none mt-1">
                                                                {new Date(item.blocked_date + 'T12:00:00Z').getDate()}
                                                            </span>
                                                        </div>
                                                        <div className="overflow-hidden">
                                                            <p className="text-sm font-bold text-charcoal capitalize truncate">
                                                                {new Date(item.blocked_date + 'T12:00:00Z').toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                                                            </p>
                                                            {item.reason && <p className="text-xs text-charcoal/50 italic truncate">{item.reason}</p>}
                                                        </div>
                                                    </div>
                                                    <button
                                                        onClick={() => handleDeleteBlockedDate(item.id)}
                                                        className="p-2 text-charcoal/20 hover:text-red-500 hover:bg-red-50 rounded-soft transition-all flex-shrink-0"
                                                        title="Eliminar bloqueo"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </>
                    )}

                    {/* Notifications Settings */}
                    {activeTab === 'notifications' && (
                        <div className="card-soft p-4 sm:p-6">
                            <h2 className="text-lg font-semibold text-charcoal mb-2">Configuración de Notificaciones</h2>
                            <p className="text-sm text-charcoal/50 mb-6">Elige qué notificaciones recibir en tu panel</p>

                            {notificationsSaved && (
                                <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-soft flex items-center gap-3">
                                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                                    <p className="text-sm text-emerald-700 font-medium">¡Preferencias de notificaciones guardadas exitosamente!</p>
                                </div>
                            )}

                            <div className="space-y-4">
                                <div className="flex items-center justify-between p-4 bg-ivory rounded-soft">
                                    <div>
                                        <p className="font-medium text-charcoal">🆕 Nuevas Citas</p>
                                        <p className="text-sm text-charcoal/50">Cuando se agenda una nueva cita</p>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={notifPrefs.new_appointment}
                                            onChange={(e) => setNotifPrefs({ ...notifPrefs, new_appointment: e.target.checked })}
                                            className="sr-only peer"
                                        />
                                        <div className="w-11 h-6 bg-silk-beige rounded-full peer peer-checked:bg-primary-500 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
                                    </label>
                                </div>

                                <div className="flex items-center justify-between p-4 bg-ivory rounded-soft">
                                    <div>
                                        <p className="font-medium text-charcoal">✅ Citas Confirmadas</p>
                                        <p className="text-sm text-charcoal/50">Cuando un paciente confirma su cita</p>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={notifPrefs.confirmed}
                                            onChange={(e) => setNotifPrefs({ ...notifPrefs, confirmed: e.target.checked })}
                                            className="sr-only peer"
                                        />
                                        <div className="w-11 h-6 bg-silk-beige rounded-full peer peer-checked:bg-primary-500 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
                                    </label>
                                </div>

                                <div className="flex items-center justify-between p-4 bg-ivory rounded-soft">
                                    <div>
                                        <p className="font-medium text-charcoal">❌ Citas Canceladas</p>
                                        <p className="text-sm text-charcoal/50">Cuando se cancela una cita</p>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={notifPrefs.cancelled}
                                            onChange={(e) => setNotifPrefs({ ...notifPrefs, cancelled: e.target.checked })}
                                            className="sr-only peer"
                                        />
                                        <div className="w-11 h-6 bg-silk-beige rounded-full peer peer-checked:bg-primary-500 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
                                    </label>
                                </div>

                                <div className="flex items-center justify-between p-4 bg-ivory rounded-soft">
                                    <div>
                                        <p className="font-medium text-charcoal">⏰ Recordatorios Pendientes</p>
                                        <p className="text-sm text-charcoal/50">Citas que necesitan confirmación</p>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={notifPrefs.pending_reminder}
                                            onChange={(e) => setNotifPrefs({ ...notifPrefs, pending_reminder: e.target.checked })}
                                            className="sr-only peer"
                                        />
                                        <div className="w-11 h-6 bg-silk-beige rounded-full peer peer-checked:bg-primary-500 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
                                    </label>
                                </div>

                                <div className="flex items-center justify-between p-4 bg-ivory rounded-soft">
                                    <div>
                                        <p className="font-medium text-charcoal">💬 Nuevos Mensajes</p>
                                        <p className="text-sm text-charcoal/50">Mensajes que requieren atención</p>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={notifPrefs.new_message}
                                            onChange={(e) => setNotifPrefs({ ...notifPrefs, new_message: e.target.checked })}
                                            className="sr-only peer"
                                        />
                                        <div className="w-11 h-6 bg-silk-beige rounded-full peer peer-checked:bg-primary-500 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
                                    </label>
                                </div>

                                <div className="flex items-center justify-between p-4 bg-ivory rounded-soft">
                                    <div>
                                        <p className="font-medium text-charcoal">⭐ Encuestas Respondidas</p>
                                        <p className="text-sm text-charcoal/50">Cuando un paciente responde una encuesta</p>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={notifPrefs.survey_response}
                                            onChange={(e) => setNotifPrefs({ ...notifPrefs, survey_response: e.target.checked })}
                                            className="sr-only peer"
                                        />
                                        <div className="w-11 h-6 bg-silk-beige rounded-full peer peer-checked:bg-primary-500 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
                                    </label>
                                </div>

                                {/* Exclusiva del agente IA (herramienta escalate_to_human) — Core no
                                    tiene agente conversacional, así que este aviso nunca se dispararía. */}
                                <PlanGate requiredPlan="starter" label="Desde Starter">
                                <div className="flex items-center justify-between p-4 bg-ivory rounded-soft border border-orange-200">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <p className="font-medium text-charcoal">🤖 Derivación a Humano</p>
                                            <span className="bg-orange-100 text-orange-700 text-xs px-2 py-0.5 rounded-full font-medium">IA Agent</span>
                                        </div>
                                        <p className="text-sm text-charcoal/50">Cuando el Asistente de IA requiere de un humano para continuar el chat</p>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={notifPrefs.ai_handoff}
                                            onChange={(e) => setNotifPrefs({ ...notifPrefs, ai_handoff: e.target.checked })}
                                            className="sr-only peer"
                                        />
                                        <div className="w-11 h-6 bg-silk-beige rounded-full peer peer-checked:bg-primary-500 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
                                    </label>
                                </div>
                                </PlanGate>
                            </div>

                            <div className="mt-6 pt-6 border-t border-silk-beige">
                                <button
                                    onClick={handleSaveNotifications}
                                    disabled={savingNotifications}
                                    className="btn-primary flex items-center gap-2"
                                >
                                    {savingNotifications ? (
                                        <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</>
                                    ) : (
                                        <><Save className="w-4 h-4" /> Guardar Notificaciones</>
                                    )}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Tags Settings */}
                    {activeTab === 'tags' && (
                        <div className="space-y-6 animate-fade-in">
                            <div>
                                <h2 className="text-lg font-semibold text-charcoal mb-1">Etiquetas de Pacientes</h2>
                                <p className="text-sm text-charcoal/50">Personaliza las etiquetas para organizar a tus pacientes.</p>
                            </div>
                            <TagManager />
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
