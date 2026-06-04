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
    MessageSquare,
    AlertCircle,
    X,
    Loader2,
    User,
    Webhook,
    Globe,
    Info,
    ToggleLeft,
    ToggleRight,
    Send,
    Tag,
    Users,
    ArrowLeft,
    Instagram,
    Facebook,
    Music,
    History,
    RefreshCw,
    Calendar,
    Cpu,
    Phone,
    ShieldAlert,
    Settings2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { PLANS, type PlanId, normalizePlanId, redirectToCheckout, CREDIT_PACKS, redirectToCreditsCheckout } from '@/lib/mercadopago'
import { LS_PLANS, type LSPlanId, LS_CREDIT_PACKS, redirectToLemonCheckout, redirectToLemonCreditsCheckout } from '@/lib/lemonsqueezy'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { TagManager } from '@/components/settings/TagManager'
import Team from './settings/Team'
import MyProfile from './settings/MyProfile'
import { TemplateSelector } from '@/components/settings/TemplateSelector'
import { toast } from 'react-hot-toast'

// Get the Supabase URL for webhook display
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''

const tabs = [
    { id: 'profile', label: 'Mi Perfil', icon: User },
    { id: 'clinic', label: 'Clínica', icon: Building2 },
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
    const [showMobileList, setShowMobileList] = useState(true)

    // Service modal state
    const [showServiceModal, setShowServiceModal] = useState(false)
    const [newServiceName, setNewServiceName] = useState('')
    const [newServiceDuration, setNewServiceDuration] = useState<string>('30')
    const [newServicePrice, setNewServicePrice] = useState<string>('')

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

    // Integration settings
    const [yCloudApiKey, setYCloudApiKey] = useState('')
    const [yCloudPhoneNumber, setYCloudPhoneNumber] = useState('')
    const [yCloudWebhookSecret, setYCloudWebhookSecret] = useState('')
    const [aiCreditsMonthlyLimit, setAiCreditsMonthlyLimit] = useState(500)
    const [aiCreditsExtraBalance, setAiCreditsExtraBalance] = useState(0)
    const [aiCreditsExtra4o, setAiCreditsExtra4o] = useState(0)
    const [aiMessagesUsed, setAiMessagesUsed] = useState(0)
    const [aiMessagesUsedStandard, setAiMessagesUsedStandard] = useState(0)
    const [aiMessagesUsedPro, setAiMessagesUsedPro] = useState(0)
    const [aiMessagesUsedLegacy4o, setAiMessagesUsedLegacy4o] = useState(0)
    const [aiAutoRespond, setAiAutoRespond] = useState(true)
    const [aiActiveModel, setAiActiveModel] = useState<'hybrid' | 'mini' | 'pro'>('hybrid')
    const [selectedAiModel, setSelectedAiModel] = useState<'mini' | '4o'>('mini') // For purchase, keep legacy values for payment backend
    const [paymentRegion, setPaymentRegion] = useState<'chile' | 'international'>('chile')
    const [isSavingIntegrations, setIsSavingIntegrations] = useState(false)
    const [copiedWebhook, setCopiedWebhook] = useState(false)

    const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')

    // Webhook state
    interface WebhookConfig {
        id?: string
        name: string
        url: string
        events: string[]
        is_active: boolean
        secret: string
        last_triggered_at?: string | null
        last_status_code?: number | null
    }
    const [webhooks, setWebhooks] = useState<WebhookConfig[]>([])
    const [showWebhookModal, setShowWebhookModal] = useState(false)
    const [editingWebhook, setEditingWebhook] = useState<WebhookConfig | null>(null)
    const [webhookForm, setWebhookForm] = useState<WebhookConfig>({
        name: '',
        url: '',
        events: [],
        is_active: true,
        secret: '',
    })
    const [savingWebhook, setSavingWebhook] = useState(false)
    const [testingWebhook, setTestingWebhook] = useState<string | null>(null)

    const WEBHOOK_EVENTS = [
        { value: 'appointment.created', label: 'Nueva cita creada' },
        { value: 'appointment.confirmed', label: 'Cita confirmada' },
        { value: 'appointment.cancelled', label: 'Cita cancelada' },
        { value: 'appointment.rescheduled', label: 'Cita reagendada' },
        { value: 'message.received', label: 'Mensaje recibido' },
        { value: 'message.sent', label: 'Mensaje enviado' },
        { value: 'patient.created', label: 'Nuevo paciente' },
        { value: 'patient.updated', label: 'Paciente actualizado' },
    ]

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

    // AI settings state
    const [savingModel, setSavingModel] = useState(false)

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

    // AI usage state - consolidated at top of component

    // Payment return message state
    const [paymentMessage, setPaymentMessage] = useState<{ type: 'success' | 'error' | 'pending'; text: string } | null>(null)

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
        } else if (tabParam && ['profile', 'clinic', 'team', 'schedule', 'integrations', 'subscription', 'notifications', 'reminders', 'ai', 'tags'].includes(tabParam)) {
            setActiveTab(tabParam)
            if (window.innerWidth < 768) setShowMobileList(false)
        }
    }, [searchParams])

    // Load existing settings
    useEffect(() => {
        const fetchSettings = async () => {
            if (!clinicId) return
            setLoadingSettings(true)

            const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
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
                    { data: webhooksData },
                    { data: poolData },
                ] = await Promise.all([
                    safe((supabase as any).from('notification_preferences').select('*').eq('clinic_id', clinicId).single()),
                    safe((supabase as any).from('clinic_settings').select('*').eq('id', clinicId).single()),
                    safe((supabase as any).from('subscriptions').select('*').eq('clinic_id', clinicId).single()),
                    safe((supabase as any).from('clinic_services').select('id, name, duration, price, ai_description').eq('clinic_id', clinicId)),
                    safe((supabase as any).rpc('get_clinic_professionals', { p_clinic_id: clinicId })),
                    safe((supabase as any).from('webhooks').select('*').eq('clinic_id', clinicId).order('created_at', { ascending: true })),
                    safe((supabase as any).rpc('get_credit_pool_clinic_ids', { p_clinic_id: clinicId })),
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
                    setYCloudApiKey(clinicData.ycloud_api_key || '')
                    setYCloudPhoneNumber(clinicData.ycloud_phone_number || '')
                    setYCloudWebhookSecret(clinicData.ycloud_webhook_secret || '')
                    setAiCreditsMonthlyLimit(clinicData.ai_credits_monthly_limit || 500)
                    setAiCreditsExtraBalance(clinicData.ai_credits_extra_balance || 0)
                    setAiCreditsExtra4o(clinicData.ai_credits_extra_4o || 0)
                    setAiActiveModel(clinicData.ai_active_model || 'hybrid')
                    setAiAutoRespond(clinicData.ai_auto_respond !== false)
                    setBusinessModel(clinicData.business_model || 'physical')
                    setPaymentRegion(clinicData.payment_provider === 'lemonsqueezy' ? 'international' : 'chile')
                    if (clinicData.working_hours) setWorkingHours(clinicData.working_hours)
                }

                // --- Procesar servicios ---
                if (servicesError) console.error('Error fetching services:', servicesError)
                if (servicesData) {
                    setServices(servicesData.map((s: any) => ({
                        id: s.id,
                        name: s.name,
                        duration: s.duration,
                        price: s.price,
                        aiDescription: s.ai_description
                    })))
                }

                // --- Procesar profesionales ---
                if (profError) console.error('Error fetching professionals:', profError)
                if (profData) setClinicProfessionals(profData)

                // --- Procesar webhooks ---
                if (webhooksData) setWebhooks(webhooksData)

                // Pool de créditos IA
                let poolClinicIds = [clinicId]
                if (poolData && poolData.length > 0) {
                    poolClinicIds = poolData.map((r: any) => r)
                }

                // Wave 2: queries condicionales + 4 conteos IA en paralelo
                const needsParent = !!(clinicData?.parent_clinic_id)
                const needsPlanFallback = !!(subData && (!subData.plan_id || subData.plan_id === ''))

                const [
                    { count: countStandard, error: errStd },
                    { count: countPro, error: errPro },
                    { count: countLegacy, error: errLeg },
                    { count: countMini, error: errMini },
                    { data: parentData },
                    { data: planFallbackData },
                ] = await Promise.all([
                    safe((supabase as any).from('messages').select('*', { count: 'exact', head: true }).in('clinic_id', poolClinicIds).eq('ai_generated', true).eq('ai_model', '4o_standard').gte('created_at', startOfMonth)),
                    safe((supabase as any).from('messages').select('*', { count: 'exact', head: true }).in('clinic_id', poolClinicIds).eq('ai_generated', true).eq('ai_model', '4o_pro').gte('created_at', startOfMonth)),
                    safe((supabase as any).from('messages').select('*', { count: 'exact', head: true }).in('clinic_id', poolClinicIds).eq('ai_generated', true).eq('ai_model', '4o').gte('created_at', startOfMonth)),
                    safe((supabase as any).from('messages').select('*', { count: 'exact', head: true }).in('clinic_id', poolClinicIds).eq('ai_generated', true).or('ai_model.eq.mini,ai_model.is.null').gte('created_at', startOfMonth)),
                    needsParent
                        ? safe((supabase as any).from('clinic_settings').select('ai_credits_monthly_limit, ai_credits_extra_balance, ai_credits_extra_4o').eq('id', clinicData.parent_clinic_id).single())
                        : Promise.resolve({ data: null }),
                    needsPlanFallback
                        ? safe((supabase as any).from('clinic_settings').select('subscription_plan').eq('id', clinicId).single())
                        : Promise.resolve({ data: null }),
                ])

                // --- Procesar conteos IA ---
                if (errStd) console.error('Count Standard error:', errStd)
                setAiMessagesUsedStandard(countStandard || 0)
                if (errPro) console.error('Count Pro error:', errPro)
                setAiMessagesUsedPro(countPro || 0)
                if (errLeg) console.error('Count Legacy error:', errLeg)
                setAiMessagesUsedLegacy4o(countLegacy || 0)
                if (errMini) console.error('Count Mini error:', errMini)
                setAiMessagesUsed(countMini || 0)

                // --- Procesar parent clinic (sucursal) ---
                if (parentData) {
                    setAiCreditsMonthlyLimit(parentData.ai_credits_monthly_limit || 500)
                    setAiCreditsExtraBalance(parentData.ai_credits_extra_balance || 0)
                    setAiCreditsExtra4o(parentData.ai_credits_extra_4o || 0)
                }

                // --- Procesar suscripción ---
                if (subData) {
                    let planName = subData.plan_id
                    if (!planName || planName === '') {
                        planName = normalizePlanId(planFallbackData?.subscription_plan || 'starter')
                    }
                    setSubscription({
                        plan: planName,
                        status: subData.status,
                        trialEndsAt: subData.trial_ends_at,
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


    // Webhook URL for YCloud
    const webhookUrl = `${SUPABASE_URL}/functions/v1/ycloud-whatsapp-webhook`

    const copyWebhookUrl = async () => {
        await navigator.clipboard.writeText(webhookUrl)
        setCopiedWebhook(true)
        setTimeout(() => setCopiedWebhook(false), 2000)
    }

    const handleBuyCredits = async (packId: string) => {
        if (!clinicId || !user?.email) return
        try {
            if (paymentRegion === 'international') {
                await redirectToLemonCreditsCheckout(clinicId, user.email, packId, selectedAiModel)
            } else {
                await redirectToCreditsCheckout(clinicId, user.email, packId, selectedAiModel)
            }
        } catch (error: any) {
            console.error('Error buying credits:', error)
            alert(error.message || 'Error al procesar el pago. Por favor intenta de nuevo.')
        }
    }

    const saveIntegrations = async () => {
        if (!clinicId) return
        setIsSavingIntegrations(true)
        setSaveStatus('idle')
        try {
            // Use update (not upsert) since the clinic row already exists
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const updatePayload: Record<string, any> = {
                updated_at: new Date().toISOString(),
            }
            // Only include fields that have values to avoid overwriting with null
            if (yCloudApiKey !== undefined) updatePayload.ycloud_api_key = yCloudApiKey || null
            if (yCloudPhoneNumber !== undefined) updatePayload.ycloud_phone_number = yCloudPhoneNumber || null
            if (yCloudWebhookSecret !== undefined) updatePayload.ycloud_webhook_secret = yCloudWebhookSecret || null
            if (aiActiveModel) updatePayload.ai_active_model = aiActiveModel

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error } = await (supabase as any)
                .from('clinic_settings')
                .update(updatePayload)
                .eq('id', clinicId)

            if (error) {
                console.error('Supabase integration save error:', error)
                throw error
            }
            setSaveStatus('success')
            toast.success('Integraciones guardadas correctamente')
            setTimeout(() => setSaveStatus('idle'), 3000)
        } catch (error: any) {
            console.error('Error saving integrations:', error)
            toast.error('Error al guardar: ' + (error?.message || 'Intenta nuevamente'))
            setSaveStatus('error')
            setTimeout(() => setSaveStatus('idle'), 3000)
        } finally {
            setIsSavingIntegrations(false)
        }
    }

    // Webhook CRUD
    const openWebhookModal = (webhook?: WebhookConfig) => {
        if (webhook) {
            setEditingWebhook(webhook)
            setWebhookForm({ ...webhook })
        } else {
            setEditingWebhook(null)
            setWebhookForm({ name: '', url: '', events: [], is_active: true, secret: '' })
        }
        setShowWebhookModal(true)
    }

    const closeWebhookModal = () => {
        setShowWebhookModal(false)
        setEditingWebhook(null)
        setWebhookForm({ name: '', url: '', events: [], is_active: true, secret: '' })
    }

    const handleSaveWebhook = async () => {
        if (!clinicId || !webhookForm.url.trim() || !webhookForm.name.trim()) return
        setSavingWebhook(true)
        try {
            if (editingWebhook?.id) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { error } = await (supabase as any)
                    .from('webhooks')
                    .update({
                        name: webhookForm.name.trim(),
                        url: webhookForm.url.trim(),
                        events: webhookForm.events,
                        is_active: webhookForm.is_active,
                        secret: webhookForm.secret || null,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', editingWebhook.id)
                if (error) throw error
            } else {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { error } = await (supabase as any)
                    .from('webhooks')
                    .insert({
                        clinic_id: clinicId,
                        name: webhookForm.name.trim(),
                        url: webhookForm.url.trim(),
                        events: webhookForm.events,
                        is_active: webhookForm.is_active,
                        secret: webhookForm.secret || null,
                    })
                if (error) throw error
            }
            closeWebhookModal()
            // Refresh webhooks
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data } = await (supabase as any)
                .from('webhooks')
                .select('*')
                .eq('clinic_id', clinicId)
                .order('created_at', { ascending: true })
            if (data) setWebhooks(data)
        } catch (error) {
            console.error('Error saving webhook:', error)
            alert('Error al guardar el webhook.')
        } finally {
            setSavingWebhook(false)
        }
    }

    const handleDeleteWebhook = async (id: string) => {
        if (!clinicId) return
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error } = await (supabase as any).from('webhooks').delete().eq('id', id)
            if (error) throw error
            setWebhooks(prev => prev.filter(w => w.id !== id))
        } catch (error) {
            console.error('Error deleting webhook:', error)
        }
    }

    const handleToggleWebhook = async (id: string, currentActive: boolean) => {
        if (!clinicId) return
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error } = await (supabase as any)
                .from('webhooks')
                .update({ is_active: !currentActive, updated_at: new Date().toISOString() })
                .eq('id', id)
            if (error) throw error
            setWebhooks(prev => prev.map(w => w.id === id ? { ...w, is_active: !currentActive } : w))
        } catch (error) {
            console.error('Error toggling webhook:', error)
        }
    }

    const handleTestWebhook = async (webhook: WebhookConfig) => {
        if (!webhook.id) return
        setTestingWebhook(webhook.id)
        try {
            const response = await fetch(webhook.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(webhook.secret ? { 'X-Webhook-Secret': webhook.secret } : {}),
                },
                mode: 'no-cors',
                body: JSON.stringify({
                    event: 'test.ping',
                    timestamp: new Date().toISOString(),
                    data: { message: 'Test webhook from Vetly AI' },
                }),
            })
            // With no-cors we can't read status, so we just mark it as sent
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase as any)
                .from('webhooks')
                .update({ last_triggered_at: new Date().toISOString(), last_status_code: response.status || 0 })
                .eq('id', webhook.id)
            setWebhooks(prev => prev.map(w => w.id === webhook.id
                ? { ...w, last_triggered_at: new Date().toISOString(), last_status_code: response.status || 0 }
                : w
            ))
            alert('✅ Webhook de prueba enviado correctamente.')
        } catch (error) {
            console.error('Error testing webhook:', error)
            alert('⚠️ No se pudo verificar la respuesta del webhook (puede ser un problema de CORS). El webhook podría haber sido recibido igualmente.')
        } finally {
            setTestingWebhook(null)
        }
    }

    const toggleWebhookEvent = (event: string) => {
        setWebhookForm(prev => ({
            ...prev,
            events: prev.events.includes(event)
                ? prev.events.filter(e => e !== event)
                : [...prev.events, event]
        }))
    }

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


    const handleSaveAI = async () => {
        if (!clinicId) {
            toast.error('No se encontró el ID de la clínica')
            return
        }
        setSavingModel(true)
        
        const payload = { 
            id: clinicId,
            ai_active_model: aiActiveModel, 
            ai_auto_respond: aiAutoRespond,
            updated_at: new Date().toISOString() 
        }
        
        console.log('--- AI PERISTENCE DEBUG ---')
        console.log('Clinic ID:', clinicId)
        console.log('Payload:', payload)

        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data, error, status } = await (supabase as any)
                .from('clinic_settings')
                .upsert(payload, { onConflict: 'id' })
                .select()

            if (error) {
                console.error('Supabase Error:', error)
                toast.error(`Error de Base de Datos (${error.code}): ${error.message}`)
                return
            }

            console.log('Response Status:', status)
            console.log('Updated Data:', data)

            if (!data || data.length === 0) {
                console.warn('Upsert successful but no rows returned. Possible RLS issue.')
                toast.error('No se pudo actualizar. Verifica tus permisos de administrador.')
                return
            }

            toast.success('Configuración de IA guardada exitosamente')
            if (aiActiveModel === 'pro') setSelectedAiModel('4o')
            else setSelectedAiModel('mini')
            
        } catch (err: any) {
            console.error('Unexpected Error:', err)
            toast.error('Ocurrió un error inesperado: ' + err.message)
        } finally {
            setSavingModel(false)
        }
    }

    const handlePlanSelection = async (planId: PlanId) => {
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

        try {
            if (paymentRegion === 'international') {
                await redirectToLemonCheckout(clinicId, user.email, planId as LSPlanId)
            } else {
                await redirectToCheckout({
                    clinicId: clinicId,
                    planId: planId as "core" | "starter" | "pro" | "enterprise",
                    email: user.email,
                })
            }
        } catch (error) {
            console.error('Checkout error:', error)
            alert('Error al iniciar el proceso de pago. Por favor intenta más tarde.')
        }
    }

    const [serviceSaved, setServiceSaved] = useState(false) // Success state
    const [editingServiceId, setEditingServiceId] = useState<string | null>(null)

    const handleEditService = async (service: any) => {
        setEditingServiceId(service.id)
        setNewServiceName(service.name)
        setNewServiceDuration(service.duration.toString())
        setNewServicePrice(service.price.toString())
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
                price: parseFloat(newServicePrice) || 0
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

                setServices(services.map(s => s.id === editingServiceId ? {
                    id: editingServiceId,
                    name: serviceData.name,
                    duration: serviceData.duration,
                    price: serviceData.price
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
                    ai_description: data.ai_description
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
            setNewServiceName('')
            setNewServiceDuration('30')
            setNewServicePrice('')

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
                                            <div className="flex-1">
                                                <p className="font-medium text-charcoal">{service.name}</p>
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
                                                    setNewServiceName('');
                                                    setNewServiceDuration('30');
                                                    setNewServicePrice('');
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
                                                    setNewServiceName(''); // Reset form
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
                                    {(() => {
                                        const isTrial = subscription?.status === 'trial'
                                        const isActive = subscription?.manuallyActive || subscription?.status === 'active'
                                        return (
                                            <div className={cn(
                                                "px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider",
                                                isTrial ? 'bg-amber-100 text-amber-700' :
                                                    isActive ? 'bg-emerald-100 text-emerald-700' :
                                                        'bg-charcoal/10 text-charcoal/60'
                                            )}>
                                                {isTrial ? 'En Prueba' : isActive ? 'Plan Activo' : 'Inactivo'}
                                            </div>
                                        )
                                    })()}
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
                                                    {PLANS[normalizePlanId(subscription?.plan || 'starter')]?.tagline || 'Prueba gratuita — 7 días de acceso total'}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            {(() => {
                                                const np = normalizePlanId(subscription?.plan || '')
                                                const clpPrice = PLANS[np as PlanId]?.price
                                                const usdPrice = LS_PLANS[np as LSPlanId]?.price
                                                return (
                                                    <div>
                                                        {clpPrice ? <p className="text-2xl font-black text-charcoal">${clpPrice.toLocaleString()} <span className="text-xs font-bold text-charcoal/40">CLP/mes</span></p> : null}
                                                        {usdPrice ? <p className="text-sm font-semibold text-charcoal/50 mt-0.5">US${usdPrice} <span className="text-xs">USD/mes</span></p> : null}
                                                        {!clpPrice && !usdPrice && <p className="text-2xl font-black text-charcoal">$0 <span className="text-xs font-bold text-charcoal/40">CLP/mes</span></p>}
                                                    </div>
                                                )
                                            })()}
                                            {subscription?.trialEndsAt && (
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
                                    {subscription?.status === 'trial' && (
                                        <button
                                            onClick={() => document.getElementById('compare-plans')?.scrollIntoView({ behavior: 'smooth' })}
                                            className="btn-primary"
                                        >
                                            Activar Plan Premium
                                        </button>
                                    )}
                                    <a
                                        href="https://www.mercadopago.com.mx/subscriptions"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="btn-ghost"
                                    >
                                        Gestionar en Mercado Pago
                                    </a>
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
                                            Cancelar suscripci\u00f3n
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
                                                    await (supabase as any).from('clinic_settings').update({ payment_provider: 'lemonsqueezy' }).eq('id', clinicId);
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

                                <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-5">
                                    {(Object.keys(PLANS) as PlanId[]).map((planId) => {
                                        const mpPlan = PLANS[planId]
                                        const lsPlan = LS_PLANS[planId as LSPlanId]
                                        const normalizedCurrent = normalizePlanId(subscription?.plan || '')
                                        const isCurrentPlan = planId === normalizedCurrent
                                        const isPro = planId === 'pro'

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
                                                            <>
                                                                <div className="flex items-baseline gap-1 flex-wrap">
                                                                    <span className="text-3xl font-black text-charcoal">US${lsPlan?.price ?? 0}</span>
                                                                    <span className="text-xs font-bold text-charcoal/40 uppercase">USD/mes</span>
                                                                </div>
                                                                <p className="text-xs font-semibold text-charcoal/40 mt-0.5">${mpPlan.price.toLocaleString()} CLP/mes</p>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <div className="flex items-baseline gap-1 flex-wrap">
                                                                    <span className="text-3xl font-black text-charcoal">${mpPlan.price.toLocaleString()}</span>
                                                                    <span className="text-xs font-bold text-charcoal/40 uppercase">CLP/mes</span>
                                                                </div>
                                                                {lsPlan && (
                                                                    <p className="text-xs font-semibold text-charcoal/40 mt-0.5">US${lsPlan.price} USD/mes</p>
                                                                )}
                                                            </>
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
                                                    onClick={() => handlePlanSelection(planId)}
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
                                                    {isCurrentPlan ? 'Plan Actual' : 'Seleccionar Plan'}
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
                                        <p className="text-sm text-charcoal/50">Bloquea días específicos (feriados o vacaciones) para que la IA no agende citas.</p>
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

                    {/* Integrations Settings */}
                    {activeTab === 'integrations' && (
                        <div className="space-y-6">
                            {/* YCloud */}
                            <div className="card-soft p-4 sm:p-6">
                                <div className="flex items-center gap-4 mb-6">
                                    <div className="w-12 h-12 bg-emerald-100 rounded-soft flex items-center justify-center">
                                        <MessageSquare className="w-6 h-6 text-emerald-600" />
                                    </div>
                                    <div>
                                        <h2 className="text-lg font-semibold text-charcoal">YCloud WhatsApp API</h2>
                                        <p className="text-sm text-charcoal/50">Conecta tu número de WhatsApp Business</p>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-charcoal mb-2">API Key</label>
                                        <input
                                            type="password"
                                            placeholder="yc_xxxxxxxxxxxxxxxxxxxxxx"
                                            value={yCloudApiKey}
                                            onChange={(e) => setYCloudApiKey(e.target.value)}
                                            className="input-soft"
                                        />
                                        <p className="text-xs text-charcoal/40 mt-1">
                                            Obtén tu API Key desde <a href="https://www.ycloud.com" target="_blank" rel="noopener noreferrer" className="text-primary-500 hover:underline">ycloud.com</a>
                                        </p>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-charcoal mb-2">Número de WhatsApp</label>
                                        <input
                                            type="text"
                                            placeholder="+521234567890"
                                            value={yCloudPhoneNumber}
                                            onChange={(e) => setYCloudPhoneNumber(e.target.value)}
                                            className="input-soft"
                                        />
                                        <p className="text-xs text-charcoal/40 mt-1">
                                            El número de WhatsApp Business registrado en YCloud (con código de país)
                                        </p>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-charcoal mb-2">Webhook Secret</label>
                                        <input
                                            type="password"
                                            placeholder="whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                                            value={yCloudWebhookSecret}
                                            onChange={(e) => setYCloudWebhookSecret(e.target.value)}
                                            className="input-soft"
                                        />
                                        <p className="text-xs text-charcoal/40 mt-1">
                                            Secret de firma HMAC-SHA256. Encuéntralo en YCloud → Developer → Webhooks → tu webhook → Signing Secret.
                                        </p>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-charcoal mb-2">Webhook URL</label>
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                value={webhookUrl}
                                                disabled
                                                className="input-soft bg-ivory text-charcoal/60 font-mono text-sm"
                                            />
                                            <button
                                                onClick={copyWebhookUrl}
                                                className="btn-ghost text-primary-500 flex items-center gap-1"
                                            >
                                                {copiedWebhook ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                                {copiedWebhook ? 'Copiado' : 'Copiar'}
                                            </button>
                                        </div>
                                        <p className="text-xs text-charcoal/40 mt-1">
                                            Configura esta URL como webhook en tu panel de YCloud (Developer → Webhooks)
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Webhooks / n8n */}
                            <div className="card-soft p-4 sm:p-6">
                                <div className="flex items-center justify-between mb-6">
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 bg-orange-100 rounded-soft flex items-center justify-center">
                                            <Webhook className="w-6 h-6 text-orange-600" />
                                        </div>
                                        <div>
                                            <h2 className="text-lg font-semibold text-charcoal">Webhooks</h2>
                                            <p className="text-sm text-charcoal/50">Conecta con n8n, Make, Zapier y otras automatizaciones</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => openWebhookModal()}
                                        className="btn-primary flex items-center gap-2 text-sm"
                                    >
                                        <Plus className="w-4 h-4" />
                                        Añadir Webhook
                                    </button>
                                </div>

                                {webhooks.length === 0 ? (
                                    <div className="text-center py-8 border-2 border-dashed border-silk-beige rounded-soft">
                                        <Globe className="w-10 h-10 text-charcoal/20 mx-auto mb-3" />
                                        <p className="text-charcoal/50 text-sm mb-1">No hay webhooks configurados</p>
                                        <p className="text-charcoal/40 text-xs">Añade un webhook para enviar eventos a herramientas externas como n8n</p>
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {webhooks.map((wh) => (
                                            <div
                                                key={wh.id}
                                                className={cn(
                                                    'border rounded-soft p-4 transition-all',
                                                    wh.is_active
                                                        ? 'border-silk-beige bg-white hover:shadow-sm'
                                                        : 'border-silk-beige bg-ivory/50 opacity-60'
                                                )}
                                            >
                                                <div className="flex items-center justify-between mb-2">
                                                    <div className="flex items-center gap-3">
                                                        <div className={cn(
                                                            'w-2.5 h-2.5 rounded-full',
                                                            wh.is_active ? 'bg-emerald-400' : 'bg-charcoal/20'
                                                        )} />
                                                        <h3 className="font-medium text-charcoal text-sm">{wh.name}</h3>
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <button
                                                            onClick={() => handleTestWebhook(wh)}
                                                            disabled={!wh.is_active || testingWebhook === wh.id}
                                                            className="p-1.5 rounded-soft hover:bg-blue-50 transition-colors disabled:opacity-50"
                                                            title="Enviar prueba"
                                                        >
                                                            {testingWebhook === wh.id ? (
                                                                <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                                                            ) : (
                                                                <Send className="w-4 h-4 text-blue-500" />
                                                            )}
                                                        </button>
                                                        <button
                                                            onClick={() => handleToggleWebhook(wh.id!, wh.is_active)}
                                                            className="p-1.5 rounded-soft hover:bg-ivory transition-colors"
                                                            title={wh.is_active ? 'Desactivar' : 'Activar'}
                                                        >
                                                            {wh.is_active ? (
                                                                <ToggleRight className="w-5 h-5 text-emerald-500" />
                                                            ) : (
                                                                <ToggleLeft className="w-5 h-5 text-charcoal/30" />
                                                            )}
                                                        </button>
                                                        <button
                                                            onClick={() => openWebhookModal(wh)}
                                                            className="p-1.5 rounded-soft hover:bg-ivory transition-colors"
                                                            title="Editar"
                                                        >
                                                            <ChevronRight className="w-4 h-4 text-charcoal/50" />
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteWebhook(wh.id!)}
                                                            className="p-1.5 rounded-soft hover:bg-red-50 transition-colors"
                                                            title="Eliminar"
                                                        >
                                                            <Trash2 className="w-4 h-4 text-red-400" />
                                                        </button>
                                                    </div>
                                                </div>
                                                <p className="text-xs text-charcoal/40 font-mono truncate mb-2 pl-5">{wh.url}</p>
                                                <div className="flex items-center gap-2 flex-wrap pl-5">
                                                    {wh.events.length > 0 ? wh.events.map(ev => (
                                                        <span key={ev} className="text-xs bg-orange-50 text-orange-600 px-2 py-0.5 rounded-full border border-orange-200">
                                                            {ev}
                                                        </span>
                                                    )) : (
                                                        <span className="text-xs text-charcoal/30">Sin eventos seleccionados</span>
                                                    )}
                                                    {wh.last_triggered_at && (
                                                        <span className="text-xs text-charcoal/30 ml-auto">
                                                            Último envío: {new Date(wh.last_triggered_at).toLocaleString()}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div className="mt-4 p-3 bg-amber-50/80 rounded-soft border border-amber-200/50">
                                    <p className="text-xs text-amber-700">
                                        <strong>💡 Tip:</strong> En n8n, usa el nodo "Webhook" y pega la URL generada por n8n aquí. Selecciona los eventos que deseas recibir y n8n procesará la información automáticamente.
                                    </p>
                                </div>
                            </div>

                            {/* Webhook Create/Edit Modal */}
                            {showWebhookModal && (
                                <div className="fixed inset-0 bg-charcoal/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                                    <div className="bg-white rounded-soft shadow-premium-lg w-full max-w-lg animate-scale-in">
                                        <div className="flex items-center justify-between p-6 border-b border-silk-beige">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 bg-orange-50 rounded-full flex items-center justify-center">
                                                    <Webhook className="w-5 h-5 text-orange-500" />
                                                </div>
                                                <h2 className="text-lg font-bold text-charcoal">
                                                    {editingWebhook ? 'Editar Webhook' : 'Nuevo Webhook'}
                                                </h2>
                                            </div>
                                            <button onClick={closeWebhookModal} className="p-2 hover:bg-ivory rounded-soft transition-colors">
                                                <X className="w-5 h-5 text-charcoal/50" />
                                            </button>
                                        </div>

                                        <div className="p-6 space-y-5">
                                            <div>
                                                <label className="block text-sm font-medium text-charcoal mb-2">Nombre</label>
                                                <input
                                                    type="text"
                                                    value={webhookForm.name}
                                                    onChange={(e) => setWebhookForm(prev => ({ ...prev, name: e.target.value }))}
                                                    placeholder="Ej: n8n - Notificaciones"
                                                    className="input-soft w-full"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-charcoal mb-2">URL del Webhook</label>
                                                <input
                                                    type="url"
                                                    value={webhookForm.url}
                                                    onChange={(e) => setWebhookForm(prev => ({ ...prev, url: e.target.value }))}
                                                    placeholder="https://tu-n8n-instance.com/webhook/..."
                                                    className="input-soft w-full font-mono text-sm"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-charcoal mb-2">Secret (opcional)</label>
                                                <input
                                                    type="password"
                                                    value={webhookForm.secret}
                                                    onChange={(e) => setWebhookForm(prev => ({ ...prev, secret: e.target.value }))}
                                                    placeholder="Tu clave secreta para verificar webhooks"
                                                    className="input-soft w-full"
                                                />
                                                <p className="text-xs text-charcoal/40 mt-1">Se envía como header <code className="bg-ivory px-1 rounded text-xs">X-Webhook-Secret</code></p>
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-charcoal mb-2">Eventos a escuchar</label>
                                                <div className="grid grid-cols-2 gap-2">
                                                    {WEBHOOK_EVENTS.map(ev => (
                                                        <label
                                                            key={ev.value}
                                                            className={cn(
                                                                'flex items-center gap-2 p-2.5 rounded-soft border cursor-pointer transition-all text-sm',
                                                                webhookForm.events.includes(ev.value)
                                                                    ? 'bg-orange-50 border-orange-300 text-orange-700'
                                                                    : 'bg-white border-silk-beige text-charcoal/60 hover:bg-ivory'
                                                            )}
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={webhookForm.events.includes(ev.value)}
                                                                onChange={() => toggleWebhookEvent(ev.value)}
                                                                className="sr-only"
                                                            />
                                                            <div className={cn(
                                                                'w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0',
                                                                webhookForm.events.includes(ev.value)
                                                                    ? 'bg-orange-500 border-orange-500'
                                                                    : 'border-silk-beige'
                                                            )}>
                                                                {webhookForm.events.includes(ev.value) && (
                                                                    <Check className="w-3 h-3 text-white" />
                                                                )}
                                                            </div>
                                                            {ev.label}
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex justify-end gap-3 p-6 border-t border-silk-beige">
                                            <button onClick={closeWebhookModal} className="btn-ghost">Cancelar</button>
                                            <button
                                                onClick={handleSaveWebhook}
                                                disabled={savingWebhook || !webhookForm.name.trim() || !webhookForm.url.trim()}
                                                className="btn-primary flex items-center gap-2"
                                            >
                                                {savingWebhook ? (
                                                    <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</>
                                                ) : (
                                                    <><Save className="w-4 h-4" /> {editingWebhook ? 'Guardar' : 'Crear Webhook'}</>
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                            <div className="flex items-center gap-4 flex-wrap">
                                <button
                                    onClick={saveIntegrations}
                                    disabled={isSavingIntegrations}
                                    className="btn-primary flex items-center gap-2"
                                >
                                    <Save className="w-4 h-4" />
                                    {isSavingIntegrations ? 'Guardando...' : 'Guardar Integraciones'}
                                </button>

                                {saveStatus === 'success' && (
                                    <div className="flex items-center gap-2 text-emerald-600 text-sm animate-fade-in bg-emerald-50 px-4 py-2 rounded-soft">
                                        <CheckCircle2 className="w-4 h-4" />
                                        Integraciones guardadas correctamente
                                    </div>
                                )}

                                {saveStatus === 'error' && (
                                    <div className="flex items-center gap-2 text-red-600 text-sm animate-fade-in bg-red-50 px-4 py-2 rounded-soft">
                                        <AlertCircle className="w-4 h-4" />
                                        Error al guardar. Intenta nuevamente.
                                    </div>
                                )}
                            </div>
                        </div>
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





                    {activeTab === 'ai' && (
                        <div className="space-y-6 animate-fade-in">
                            {/* Vetly Hybrid Intelligence Header */}
                            <div className="card-soft p-8 bg-gradient-to-br from-white to-silk-beige/30 border-2 border-primary-500/10 shadow-premium-lg relative overflow-hidden">
                                <div className="absolute top-0 right-0 w-64 h-64 bg-primary-500/5 rounded-full -mr-32 -mt-32 blur-3xl" />
                                
                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8 relative z-10">
                                    <div className="flex items-center gap-5">
                                        <div className="w-16 h-16 bg-charcoal rounded-2xl flex items-center justify-center shadow-xl border-4 border-white transform rotate-3">
                                            <Sparkles className="w-8 h-8 text-primary-400" />
                                        </div>
                                        <div>
                                            <h2 className="text-2xl font-black text-charcoal tracking-tight">Vetly Hybrid Intelligence</h2>
                                            <p className="text-sm font-bold text-charcoal/40 uppercase tracking-widest mt-1">Motor de ruteo inteligente de modelos AI</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4 bg-white/80 backdrop-blur-md px-6 py-4 rounded-3xl border border-silk-beige shadow-sm">
                                        <div className="text-right">
                                            <p className="text-[10px] font-black text-charcoal/40 uppercase tracking-widest">Estado del Motor</p>
                                            <p className={cn("text-sm font-black uppercase", aiAutoRespond ? "text-emerald-500" : "text-amber-500")}>
                                                {aiAutoRespond ? 'En Línea • Activo' : 'Desconectado'}
                                            </p>
                                        </div>
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input
                                                type="checkbox"
                                                className="sr-only peer"
                                                checked={aiAutoRespond}
                                                onChange={(e) => setAiAutoRespond(e.target.checked)}
                                            />
                                            <div className="w-14 h-7 bg-charcoal/10 rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-primary-500 after:content-[''] after:absolute after:top-1 after:left-[4px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all shadow-inner"></div>
                                        </label>
                                    </div>
                                </div>

                                {/* Strategy Selection Cards */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative z-10">
                                    {/* Saving Strategy */}
                                    <button
                                        onClick={() => setAiActiveModel('mini')}
                                        className={cn(
                                            "flex flex-col p-6 rounded-[2rem] border-2 transition-all duration-500 text-left group",
                                            aiActiveModel === 'mini' 
                                            ? "bg-white border-primary-500 shadow-premium ring-4 ring-primary-500/10" 
                                            : "bg-white/40 border-silk-beige hover:border-primary-300 hover:bg-white"
                                        )}
                                    >
                                        <div className={cn(
                                            "w-12 h-12 rounded-2xl mb-4 flex items-center justify-center transition-all duration-500 shadow-sm",
                                            aiActiveModel === 'mini' ? "bg-emerald-500 text-white rotate-6" : "bg-silk-beige text-charcoal/40"
                                        )}>
                                            <Zap className="w-6 h-6" />
                                        </div>
                                        <h3 className="text-lg font-black text-charcoal mb-1">Ahorro Máximo</h3>
                                        <p className="text-xs font-bold text-charcoal/40 uppercase tracking-widest mb-4">Eficiencia N1 — GPT-4o Mini</p>
                                        <p className="text-sm font-medium text-charcoal/60 leading-relaxed font-bold">Ideal para saludos y agendamientos rápidos usando Flash Mini.</p>
                                        <div className={cn(
                                            "mt-6 py-2 px-4 rounded-full text-[10px] font-black uppercase tracking-widest text-center transition-all",
                                            aiActiveModel === 'mini' ? "bg-emerald-100 text-emerald-700" : "bg-silk-beige/50 text-charcoal/30"
                                        )}>
                                            {aiActiveModel === 'mini' ? '✓ Seleccionado' : 'Activar Estrategia'}
                                        </div>
                                    </button>

                                    {/* Hybrid Strategy (Recomended) */}
                                    <button
                                        onClick={() => setAiActiveModel('hybrid')}
                                        className={cn(
                                            "flex flex-col p-6 rounded-[2.5rem] border-2 transition-all duration-500 text-left relative group",
                                            aiActiveModel === 'hybrid' 
                                            ? "bg-white border-primary-500 shadow-premium-lg ring-8 ring-primary-500/5 scale-105 z-10" 
                                            : "bg-white/40 border-silk-beige hover:border-primary-300 hover:bg-white"
                                        )}
                                    >
                                        {aiActiveModel === 'hybrid' && (
                                            <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-primary-600 text-white text-[9px] font-black px-4 py-1.5 rounded-full shadow-lg uppercase tracking-widest whitespace-nowrap animate-bounce-subtle">
                                                Recomendado
                                            </div>
                                        )}
                                        <div className={cn(
                                            "w-14 h-14 rounded-2xl mb-4 flex items-center justify-center transition-all duration-500 shadow-xl",
                                            aiActiveModel === 'hybrid' ? "bg-primary-500 text-white rotate-12 scale-110" : "bg-silk-beige text-charcoal/40"
                                        )}>
                                            <RefreshCw className={cn("w-7 h-7", aiActiveModel === 'hybrid' && "animate-spin-slow")} />
                                        </div>
                                        <h3 className="text-xl font-black text-charcoal mb-1 text-primary-600">Híbrido Automático</h3>
                                        <p className="text-xs font-black text-primary-400 uppercase tracking-widest mb-4">IA Router (N1/N2/N3)</p>
                                        <p className="text-sm font-medium text-charcoal/70 leading-relaxed font-bold">El sistema elige el mejor modelo según la complejidad del mensaje.</p>
                                        <div className={cn(
                                            "mt-6 py-3 px-4 rounded-full text-[10px] font-black uppercase tracking-widest text-center transition-all",
                                            aiActiveModel === 'hybrid' ? "bg-primary-500 text-white shadow-lg" : "bg-silk-beige/50 text-charcoal/30"
                                        )}>
                                            {aiActiveModel === 'hybrid' ? 'Motor Inteligente Activo' : 'Activar IA Router'}
                                        </div>
                                    </button>

                                    {/* Power Strategy */}
                                    <button
                                        onClick={() => setAiActiveModel('pro')}
                                        className={cn(
                                            "flex flex-col p-6 rounded-[2rem] border-2 transition-all duration-500 text-left group",
                                            aiActiveModel === 'pro' 
                                            ? "bg-white border-charcoal shadow-premium ring-4 ring-charcoal/10" 
                                            : "bg-white/40 border-silk-beige hover:border-primary-300 hover:bg-white"
                                        )}
                                    >
                                        <div className={cn(
                                            "w-12 h-12 rounded-2xl mb-4 flex items-center justify-center transition-all duration-500 shadow-sm",
                                            aiActiveModel === 'pro' ? "bg-charcoal text-white -rotate-6" : "bg-silk-beige text-charcoal/40"
                                        )}>
                                            <Cpu className="w-6 h-6" />
                                        </div>
                                        <h3 className="text-lg font-black text-charcoal mb-1">Máximo Poder</h3>
                                        <p className="text-xs font-bold text-charcoal/40 uppercase tracking-widest mb-4">Sovereign Pro (N3) — GPT-4o</p>
                                        <p className="text-sm font-medium text-charcoal/60 leading-relaxed font-bold">Uso exclusivo de inteligencia GPT-4o para casos clínicos complejos.</p>
                                        <div className={cn(
                                            "mt-6 py-2 px-4 rounded-full text-[10px] font-black uppercase tracking-widest text-center transition-all",
                                            aiActiveModel === 'pro' ? "bg-charcoal text-white shadow-lg" : "bg-silk-beige/50 text-charcoal/30"
                                        )}>
                                            {aiActiveModel === 'pro' ? '✓ Modo Pro Activo' : 'Activar Modo Pro'}
                                        </div>
                                    </button>
                                </div>

                                <div className="mt-8 pt-6 border-t border-silk-beige/50 flex flex-col md:flex-row items-center justify-between gap-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                                        <p className="text-sm font-bold text-charcoal/60">Sincronización en tiempo real habilitada con YCloud</p>
                                    </div>
                                    <button
                                        onClick={handleSaveAI}
                                        disabled={savingModel}
                                        className="btn-primary px-10 py-4 shadow-xl hover:shadow-2xl transition-all flex items-center gap-3 active:scale-95"
                                    >
                                        {savingModel ? (
                                            <><Loader2 className="w-5 h-5 animate-spin" /> Guardando...</>
                                        ) : (
                                            <><Save className="w-5 h-5" /> Confirmar Configuración</>
                                        )}
                                    </button>
                                </div>
                            </div>

                            {/* Vetly Credits Dashboard */}
                            <div className="card-soft p-8 border-t-8 border-t-charcoal bg-white shadow-premium">
                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-8 mb-10">
                                    <div className="flex items-center gap-5">
                                        <div className="w-16 h-16 bg-hero-gradient rounded-[1.5rem] flex items-center justify-center shadow-2xl relative">
                                            <Zap className="w-9 h-9 text-white" />
                                            <div className="absolute -top-2 -right-2 bg-emerald-500 text-white text-[9px] font-black px-2 py-0.5 rounded-full border-2 border-white shadow-sm">LIVE</div>
                                        </div>
                                        <div>
                                            <h2 className="text-2xl font-black text-charcoal tracking-tight">Vetly Credits</h2>
                                            <p className="text-sm font-bold text-charcoal/30 uppercase tracking-widest mt-1">Créditos Unificados de Inteligencia</p>
                                        </div>
                                    </div>
                                    <div className="bg-charcoal text-white p-6 rounded-[2rem] shadow-2xl min-w-[240px] text-center transform hover:scale-105 transition-transform duration-500">
                                        <p className="text-xs font-black uppercase tracking-widest text-primary-400 mb-1">Total Disponibles</p>
                                        <p className="text-4xl font-black tabular-nums">{(aiCreditsMonthlyLimit + aiCreditsExtraBalance + aiCreditsExtra4o).toLocaleString()}</p>
                                        <p className="text-[10px] font-bold text-white/40 mt-1 uppercase">Créditos Vetly Global</p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
                                    {/* Plan Credits */}
                                    <div className="bg-silk-beige/20 p-6 rounded-[2rem] border border-silk-beige/50 relative group overflow-hidden">
                                        <div className="flex items-center justify-between mb-4">
                                            <p className="text-xs font-black text-charcoal/40 uppercase tracking-widest">Plan Base</p>
                                            <div className="p-2 bg-white rounded-xl shadow-sm"><CreditCard className="w-4 h-4 text-charcoal/40" /></div>
                                        </div>
                                        <p className="text-3xl font-black text-charcoal">{aiCreditsMonthlyLimit.toLocaleString()}</p>
                                        <p className="text-xs font-bold text-charcoal/40 mt-1 uppercase">Recarga Mensual</p>
                                        <div className="absolute bottom-0 left-0 h-1 bg-primary-500 transition-all duration-1000 w-full" />
                                    </div>

                                    {/* Extra Credits */}
                                    <div className="bg-emerald-50/30 p-6 rounded-[2rem] border border-emerald-100 relative group overflow-hidden">
                                        <div className="flex items-center justify-between mb-4">
                                            <p className="text-xs font-black text-emerald-600/60 uppercase tracking-widest">Cargas Extra</p>
                                            <div className="p-2 bg-white rounded-xl shadow-sm"><Plus className="w-4 h-4 text-emerald-500" /></div>
                                        </div>
                                        <p className="text-3xl font-black text-emerald-600">{(aiCreditsExtraBalance + aiCreditsExtra4o).toLocaleString()}</p>
                                        <p className="text-xs font-bold text-emerald-400 mt-1 uppercase">Saldo Acumulado</p>
                                        <div className="absolute bottom-0 left-0 h-1 bg-emerald-500 transition-all duration-1000 w-full" />
                                    </div>

                                    {/* Monthly Consumption */}
                                    <div className="bg-red-50/20 p-6 rounded-[2rem] border border-red-100 relative group overflow-hidden">
                                        <div className="flex items-center justify-between mb-4">
                                            <p className="text-xs font-black text-red-600/60 uppercase tracking-widest">Consumo Mes</p>
                                            <div className="p-2 bg-white rounded-xl shadow-sm"><Zap className="w-4 h-4 text-red-500" /></div>
                                        </div>
                                        <p className="text-3xl font-black text-red-600">
                                            {(
                                                aiMessagesUsed +
                                                (aiMessagesUsedStandard * 15) +
                                                (aiMessagesUsedPro * 15) +
                                                (aiMessagesUsedLegacy4o * 15)
                                            ).toLocaleString()}
                                        </p>
                                        <p className="text-xs font-bold text-red-400 mt-1 uppercase">Créditos Usados</p>
                                        <div className="absolute bottom-0 left-0 h-1 bg-red-400 transition-all duration-1000" style={{ width: `${Math.min(100, (((aiMessagesUsed + (aiMessagesUsedStandard * 15) + (aiMessagesUsedPro * 15) + (aiMessagesUsedLegacy4o * 15))) / (aiCreditsMonthlyLimit + aiCreditsExtraBalance + aiCreditsExtra4o || 1)) * 100)}%` }} />
                                    </div>
                                </div>

                                <div className="mt-8 mb-6 group cursor-pointer" onClick={() => navigate('/app/ai-credits')}>
                                    <div className="relative overflow-hidden rounded-[2rem] bg-white p-6 border border-silk-beige shadow-sm hover:shadow-md hover:border-primary-200 transition-all duration-300">
                                        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                                            <div className="flex items-center gap-5">
                                                <div className="w-14 h-14 bg-primary-50 rounded-2xl flex items-center justify-center border border-primary-100 group-hover:bg-primary-500 group-hover:scale-110 transition-all duration-500">
                                                    <History className="w-7 h-7 text-primary-500 group-hover:text-white transition-colors" />
                                                </div>
                                                <div className="text-left">
                                                    <h3 className="text-lg font-black text-charcoal tracking-tight">Historial de Transacciones IA</h3>
                                                    <p className="text-[10px] font-black text-charcoal/30 uppercase tracking-widest mt-0.5">
                                                        Consulta recargas, consumos y bonos extra
                                                    </p>
                                                </div>
                                            </div>
                                            
                                            <div className="flex items-center gap-4">
                                                <span className="text-[10px] font-black text-primary-500 uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">Ver registro completo</span>
                                                <div className="w-10 h-10 bg-ivory rounded-xl flex items-center justify-center border border-silk-beige group-hover:border-primary-300 transition-all">
                                                    <ChevronRight className="w-5 h-5 text-charcoal/40 group-hover:text-primary-500 transition-colors" />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Custom Cost Table */}
                                <div className="bg-ivory/50 rounded-[2.5rem] border border-silk-beige p-8">
                                    <div className="flex items-center gap-3 mb-6">
                                        <Info className="w-5 h-5 text-charcoal/30" />
                                        <h3 className="text-sm font-black text-charcoal uppercase tracking-widest">Tabla de Costos Híbridos</h3>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                                        <div className="flex items-start gap-4">
                                            <div className="w-10 h-10 rounded-2xl bg-emerald-100 flex items-center justify-center text-emerald-700 font-black shadow-inner">1x</div>
                                            <div>
                                                <p className="text-sm font-black text-charcoal">N1: Flash Mini — GPT-4o Mini</p>
                                                <p className="text-xs text-charcoal/40 leading-relaxed font-bold mt-1">Inteligencia Lite optimizada para velocidad y costo mínimo.</p>
                                            </div>
                                        </div>
                                        <div className="flex items-start gap-4">
                                            <div className="w-10 h-10 rounded-2xl bg-blue-100 flex items-center justify-center text-blue-700 font-black shadow-inner">8x</div>
                                            <div>
                                                <p className="text-sm font-black text-charcoal">N2: Standard — GPT-4o</p>
                                                <p className="text-xs text-charcoal/40 leading-relaxed font-bold mt-1">Razonamiento intermedio para ventas y logística avanzada.</p>
                                            </div>
                                        </div>
                                        <div className="flex items-start gap-4">
                                            <div className="w-10 h-10 rounded-2xl bg-charcoal text-white flex items-center justify-center font-black shadow-xl">60x</div>
                                            <div>
                                                <p className="text-sm font-black text-charcoal">N3: Sovereign Pro — GPT-4o</p>
                                                <p className="text-xs text-charcoal/40 leading-relaxed font-bold mt-1">Inteligencia clínica y quirúrgica extrema de última generación.</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Credit Packs */}
                            <div id="ai-credits-packs" className="card-soft p-8 bg-white border-2 border-primary-500/5 shadow-premium-lg">
                                <div className="flex items-center gap-5 mb-8">
                                    <div className="w-14 h-14 bg-emerald-500 rounded-2xl flex items-center justify-center shadow-lg transform -rotate-3">
                                        <Plus className="w-8 h-8 text-white" />
                                    </div>
                                    <div>
                                        <h2 className="text-xl font-black text-charcoal tracking-tight">Recarga de Créditos IA</h2>
                                        <p className="text-xs font-bold text-charcoal/40 uppercase tracking-widest mt-1">Saldo que nunca vence • Activación inmediata</p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    {(() => {
                                        const mpPacks = { ...CREDIT_PACKS };
                                        const lsPacks = { ...LS_CREDIT_PACKS };
                                        const currentPacks = paymentRegion === 'international' ? lsPacks : mpPacks;
                                        const currencySymbol = paymentRegion === 'international' ? 'US$' : '$';
                                        const currencyCode = paymentRegion === 'international' ? 'USD' : 'CLP';

                                        return Object.keys(currentPacks).map((packId) => {
                                            const pack = (currentPacks as any)[packId]

                                            return (
                                                <div key={packId} className="p-8 bg-white border border-silk-beige rounded-[2.5rem] hover:shadow-2xl hover:border-primary-500 transition-all duration-500 flex flex-col group relative overflow-hidden">
                                                    {packId === 'heavy' && (
                                                        <div className="absolute top-0 right-0 bg-primary-500 text-white text-[9px] font-black px-4 py-1.5 rounded-bl-2xl shadow-md uppercase tracking-widest">Sugerido</div>
                                                    )}
                                                    <div className="mb-6">
                                                        <h3 className="text-xl font-black text-charcoal group-hover:text-primary-600 transition-colors uppercase tracking-tighter">{pack.name}</h3>
                                                        <div className="flex items-baseline gap-2 mt-2">
                                                            <span className="text-3xl font-black text-primary-600">
                                                                {currencySymbol}{pack.price.toLocaleString()}
                                                            </span>
                                                            <span className="text-xs font-black text-charcoal/30 uppercase">{currencyCode}</span>
                                                        </div>
                                                    </div>
                                                    <div className="space-y-4 mb-8 flex-grow">
                                                        <div className="bg-silk-beige/20 p-4 rounded-2xl border border-silk-beige/30">
                                                            <p className="text-sm font-black text-charcoal flex items-center gap-2">
                                                                <Zap className="w-4 h-4 text-primary-500" />
                                                                {pack.credits.toLocaleString()} Créditos
                                                            </p>
                                                        </div>
                                                        <ul className="space-y-2.5">
                                                            <li className="flex items-center gap-3 text-xs font-bold text-charcoal/50">
                                                                <Check className="w-4 h-4 text-emerald-500" />
                                                                Uso Universal (N1/N2/N3)
                                                            </li>
                                                            <li className="flex items-center gap-3 text-xs font-bold text-charcoal/50">
                                                                <Check className="w-4 h-4 text-emerald-500" />
                                                                Sin fecha de vencimiento
                                                            </li>
                                                        </ul>
                                                    </div>
                                                    <button
                                                        onClick={() => handleBuyCredits(packId)}
                                                        className="w-full py-4 bg-charcoal text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-primary-600 shadow-lg hover:shadow-primary-500/20 transition-all active:scale-95"
                                                    >
                                                        Comprar Pack
                                                    </button>
                                                </div>
                                            )
                                        })
                                    })()}
                                </div>
                                <div className="mt-8 p-4 bg-charcoal/5 rounded-2xl border border-dashed border-silk-beige">
                                    <p className="text-[11px] text-charcoal/40 font-bold italic text-center leading-relaxed">
                                        * Los créditos de recarga actúan como un monedero virtual. Se consumen únicamente si agotas los créditos gratuitos de tu plan mensual y permanecen activos para siempre.
                                    </p>
                                </div>
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
