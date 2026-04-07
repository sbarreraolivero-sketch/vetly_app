import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
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
    AlarmClock,
    User,
    Webhook,
    Globe,
    Bot,
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
    ExternalLink,
    RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { PLANS, type PlanId, redirectToCheckout, CREDIT_PACKS, CREDIT_PACKS_4O, redirectToCreditsCheckout } from '@/lib/mercadopago'
import { LS_PLANS, type LSPlanId, LS_CREDIT_PACKS, LS_CREDIT_PACKS_4O, redirectToLemonCheckout, redirectToLemonCreditsCheckout } from '@/lib/lemonsqueezy'
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
    { id: 'integrations', label: 'Integraciones', icon: Key },
    { id: 'ai', label: 'Inteligencia Artificial', icon: Sparkles },
    { id: 'tags', label: 'Etiquetas', icon: Tag },
    { id: 'notifications', label: 'Notificaciones', icon: Bell },
    { id: 'reminders', label: 'Recordatorios', icon: AlarmClock },
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
    const [searchParams] = useSearchParams()

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
    const [services, setServices] = useState<any[]>([])
    const [workingHours, setWorkingHours] = useState<any>(mockWorkingHours)
    const [businessModel, setBusinessModel] = useState<'physical' | 'mobile' | 'hybrid'>('physical')
    const [showMobileList, setShowMobileList] = useState(true)

    // Service modal state
    const [showServiceModal, setShowServiceModal] = useState(false)
    const [newServiceName, setNewServiceName] = useState('')
    const [newServiceDuration, setNewServiceDuration] = useState<string>('30')
    const [newServicePrice, setNewServicePrice] = useState<string>('')

    // Upselling state for new service
    const [newUpsellEnabled, setNewUpsellEnabled] = useState(false)
    const [newUpsellDays, setNewUpsellDays] = useState<string>('7')
    const [newUpsellMessage, setNewUpsellMessage] = useState('')

    // Professional assignment state for service modal
    const [clinicProfessionals, setClinicProfessionals] = useState<any[]>([])
    const [assignedProfessionals, setAssignedProfessionals] = useState<Record<string, boolean>>({})
    const [primaryProfessional, setPrimaryProfessional] = useState<string>('')

    // Currency and templates
    const [currency, setCurrency] = useState('CLP')
    const [timezone, setTimezone] = useState('America/Santiago')
    const [templateSurvey, setTemplateSurvey] = useState('')
    const [templateReactivation, setTemplateReactivation] = useState('')
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
    const [openaiModel] = useState('gpt-4o-mini')
    const [aiCreditsMonthlyLimit, setAiCreditsMonthlyLimit] = useState(500)
    const [aiCreditsExtraBalance, setAiCreditsExtraBalance] = useState(0)
    const [aiCreditsExtra4o, setAiCreditsExtra4o] = useState(0)
    const [aiMessagesUsed, setAiMessagesUsed] = useState(0)
    const [aiMessagesUsed4o, setAiMessagesUsed4o] = useState(0)
    const [aiAutoRespond, setAiAutoRespond] = useState(true)
    const [aiActiveModel, setAiActiveModel] = useState<'mini' | '4o'>('mini')
    const [selectedAiModel, setSelectedAiModel] = useState<'mini' | '4o'>('mini') // For the purchase cards selector
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

    // Reminder settings state
    const [reminderSettings, setReminderSettings] = useState({
        reminder_24h_before: true,
        reminder_2h_before: true,
        reminder_1h_before: false,
        request_confirmation: true,
        confirmation_days_before: 1,
        preferred_hour: '09:00',
        template_24h: '',
        template_2h: '',
        template_1h: '',
        template_confirmation: '',
        template_followup: '',
        followup_enabled: false,
        followup_days_after: 7,
    })
    const [savingReminders, setSavingReminders] = useState(false)
    const [remindersSaved, setRemindersSaved] = useState(false)
    const [reminderLogs, setReminderLogs] = useState<any[]>([])
    const [isLoadingLogs, setIsLoadingLogs] = useState(false)

    // Clinic settings state
    const [savingClinic, setSavingClinic] = useState(false)
    const [clinicSaved, setClinicSaved] = useState(false)

    // Schedule settings state
    const [savingSchedule, setSavingSchedule] = useState(false)
    const [scheduleSaved, setScheduleSaved] = useState(false)

    // AI settings state
    const [savingAI, setSavingAI] = useState(false)
    const [aiSaved, setAiSaved] = useState(false)

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
    } | null>(null)

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
            if (!profile?.clinic_id) return

            try {
                // Fetch notification preferences
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { data: notifData, error: notifError } = await (supabase as any)
                    .from('notification_preferences')
                    .select('*')
                    .eq('clinic_id', profile.clinic_id)
                    .single()

                if (notifError && notifError.code !== 'PGRST116') {
                    throw notifError
                }

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

                // Fetch reminder settings
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { data: reminderData, error: reminderError } = await (supabase as any)
                    .from('reminder_settings')
                    .select('*')
                    .eq('clinic_id', profile.clinic_id)
                    .single()

                if (reminderError && reminderError.code !== 'PGRST116') {
                    throw reminderError
                }

                if (reminderData) {
                    setReminderSettings({
                        reminder_24h_before: reminderData.reminder_24h_before,
                        reminder_2h_before: reminderData.reminder_2h_before,
                        reminder_1h_before: reminderData.reminder_1h_before,
                        request_confirmation: reminderData.request_confirmation,
                        confirmation_days_before: reminderData.confirmation_days_before,
                        preferred_hour: reminderData.preferred_hour,
                        template_24h: reminderData.template_24h || '',
                        template_2h: reminderData.template_2h || '',
                        template_1h: reminderData.template_1h || '',
                        template_confirmation: reminderData.template_confirmation || '',
                        template_followup: reminderData.template_followup || '',
                        followup_enabled: reminderData.followup_enabled,
                        followup_days_after: reminderData.followup_days_after,
                    })
                }

                // Fetch clinic settings with auto-creation for stability (Citenly pattern)
                const { data, error } = await (supabase as any)
                    .from('clinic_settings')
                    .select('*')
                    .eq('id', profile.clinic_id)
                    .single()

                if (error && error.code !== 'PGRST116') {
                    throw error
                }

                if (data) {
                    setClinicName(data.clinic_name || '')
                    setClinicAddress(data.clinic_address || '')
                    setAddressReferences(data.address_references || '')
                    setGoogleMapsUrl(data.google_maps_url || '')
                    setInstagramUrl(data.instagram_url || '')
                    setFacebookUrl(data.facebook_url || '')
                    setTiktokUrl(data.tiktok_url || '')
                    setWebsiteUrl(data.website_url || '')
                    setCurrency(data.currency || 'CLP')
                    setTimezone(data.timezone || 'America/Santiago')
                    setTemplateSurvey(data.template_survey || '')
                    setTemplateReactivation(data.template_reactivation || '')

                    setYCloudApiKey(data.ycloud_api_key || '')
                    setYCloudPhoneNumber(data.ycloud_phone_number || '')

                    setAiCreditsMonthlyLimit(data.ai_credits_monthly_limit || 500)
                    setAiCreditsExtraBalance(data.ai_credits_extra_balance || 0)
                    setAiCreditsExtra4o(data.ai_credits_extra_4o || 0)
                    setAiActiveModel(data.ai_active_model || 'mini')

                    setAiAutoRespond(data.ai_auto_respond !== false) 
                    setBusinessModel(data.business_model || 'physical')
                    setPaymentRegion(data.payment_provider === 'lemonsqueezy' ? 'international' : 'chile')
                    if (data.working_hours) setWorkingHours(data.working_hours)
                }

                // Fetch subscription data
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { data: subData } = await (supabase as any)
                    .from('subscriptions')
                    .select('*')
                    .eq('clinic_id', profile.clinic_id)
                    .single()

                if (subData) {
                    setSubscription({
                        plan: subData.plan,
                        status: subData.status,
                        trialEndsAt: subData.trial_ends_at,
                        monthlyLimit: subData.monthly_appointments_limit,
                        monthlyUsed: subData.monthly_appointments_used || 0
                    })
                }
            } catch (error) {
                console.error('Error loading settings:', error)
            }

            try {
                // Fetch AI messages count for current month
                const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
                const { error: countError } = await (supabase as any)
                    .from('messages')
                    .select('*', { count: 'exact', head: true })
                    .eq('clinic_id', profile.clinic_id)
                    .eq('ai_generated', true)
                    .gte('created_at', startOfMonth)

                if (countError) {
                    console.error('Error fetching AI message count:', countError)
                } else {
                    // Fetch split counts
                    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()

                    // GPT-4o Messages
                    const { count: count4o } = await (supabase as any)
                        .from('messages')
                        .select('*', { count: 'exact', head: true })
                        .eq('clinic_id', profile.clinic_id)
                        .eq('ai_generated', true)
                        .eq('ai_model', '4o')
                        .gte('created_at', startOfMonth)
                    setAiMessagesUsed4o(count4o || 0)

                    // GPT-4o-mini Messages (including legacy null model)
                    const { count: countMini } = await (supabase as any)
                        .from('messages')
                        .select('*', { count: 'exact', head: true })
                        .eq('clinic_id', profile.clinic_id)
                        .eq('ai_generated', true)
                        .or('ai_model.eq.mini,ai_model.is.null')
                        .gte('created_at', startOfMonth)
                    setAiMessagesUsed(countMini || 0)
                }
            } catch (error) {
                console.error('Error counting AI messages:', error)
            }

            try {
                // Fetch services
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { data: servicesData, error: servicesError } = await (supabase as any).rpc('get_clinic_services_secure', {
                    p_clinic_id: profile.clinic_id
                })

                if (servicesError) {
                    console.error('Error fetching services:', servicesError)
                }

                if (servicesData) {
                    setServices(servicesData.map((s: any) => ({
                        id: s.id,
                        name: s.name,
                        duration: s.duration,
                        price: s.price,
                        upselling: {
                            enabled: s.upselling_enabled,
                            daysAfter: s.upselling_days_after || 0,
                            message: s.upselling_message || ''
                        },
                        ai_description: s.ai_description
                    })))
                } else {
                    console.warn('servicesData was empty or null')
                }
            } catch (error) {
                console.error('Error loading services:', error)
            }

            try {
                // Fetch clinic professionals for service assignment
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { data: profData, error: profError } = await (supabase as any).rpc('get_clinic_professionals', {
                    p_clinic_id: profile.clinic_id
                })

                if (profError) {
                    console.error('Error fetching professionals:', profError)
                }

                if (profData) {
                    setClinicProfessionals(profData)
                }
            } catch (error) {
                console.error('Error loading professionals:', error)
            }

            // Fetch webhooks
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { data: webhooksData } = await (supabase as any)
                    .from('webhooks')
                    .select('*')
                    .eq('clinic_id', profile.clinic_id)
                    .order('created_at', { ascending: true })

                if (webhooksData) {
                    setWebhooks(webhooksData)
                }
            } catch (error) {
                console.error('Error loading webhooks:', error)
            }
        }

        fetchSettings()
    }, [profile?.clinic_id])

    // Load reminder logs
    useEffect(() => {
        const fetchReminderLogs = async () => {
            if (!profile?.clinic_id || activeTab !== 'reminders') return

            setIsLoadingLogs(true)
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { data, error } = await (supabase as any)
                    .from('reminder_logs')
                    .select('*, appointments(patient_name)')
                    .eq('clinic_id', profile.clinic_id)
                    .order('sent_at', { ascending: false })
                    .limit(20)

                if (error) throw error
                setReminderLogs(data || [])
            } catch (error) {
                console.error('Error fetching reminder logs:', error)
            } finally {
                setIsLoadingLogs(false)
            }
        }

        fetchReminderLogs()
    }, [activeTab, profile?.clinic_id])

    // Webhook URL for YCloud
    const webhookUrl = `${SUPABASE_URL}/functions/v1/ycloud-whatsapp-webhook`

    const copyWebhookUrl = async () => {
        await navigator.clipboard.writeText(webhookUrl)
        setCopiedWebhook(true)
        setTimeout(() => setCopiedWebhook(false), 2000)
    }

    const handleBuyCredits = async (packId: string) => {
        if (!profile?.clinic_id || !user?.email) return
        try {
            if (paymentRegion === 'international') {
                await redirectToLemonCreditsCheckout(profile.clinic_id, user.email, packId, selectedAiModel)
            } else {
                await redirectToCreditsCheckout(profile.clinic_id, user.email, packId, selectedAiModel)
            }
        } catch (error: any) {
            console.error('Error buying credits:', error)
            alert(error.message || 'Error al procesar el pago. Por favor intenta de nuevo.')
        }
    }

    const saveIntegrations = async () => {
        if (!profile?.clinic_id) return
        setIsSavingIntegrations(true)
        setSaveStatus('idle')
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error } = await (supabase as any)
                .from('clinic_settings')
                .update({
                    ycloud_api_key: yCloudApiKey || null,
                    ycloud_phone_number: yCloudPhoneNumber || null,
                    openai_model: openaiModel,
                })
                .eq('id', profile.clinic_id)

            if (error) throw error
            setSaveStatus('success')
            setTimeout(() => setSaveStatus('idle'), 3000)
        } catch (error) {
            console.error('Error saving integrations:', error)
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
        if (!profile?.clinic_id || !webhookForm.url.trim() || !webhookForm.name.trim()) return
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
                        clinic_id: profile.clinic_id,
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
                .eq('clinic_id', profile.clinic_id)
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
        if (!profile?.clinic_id) return
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
        if (!profile?.clinic_id) return
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
                    data: { message: 'Test webhook from Citenly AI' },
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
        if (!profile?.clinic_id) return

        setSavingNotifications(true)
        setNotificationsSaved(false)

        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error } = await (supabase as any)
                .from('notification_preferences')
                .upsert({
                    clinic_id: profile.clinic_id,
                    ...notifPrefs,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'clinic_id' })

            if (error) throw error

            setNotificationsSaved(true)
            setTimeout(() => setNotificationsSaved(false), 3000)
        } catch (error) {
            console.error('Error saving notification preferences:', error)
        } finally {
            setSavingNotifications(false)
        }
    }

    const handleSaveReminders = async () => {
        if (!profile?.clinic_id) return

        setSavingReminders(true)
        setRemindersSaved(false)

        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error } = await (supabase as any)
                .from('reminder_settings')
                .upsert({
                    clinic_id: profile.clinic_id,
                    ...reminderSettings,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'clinic_id' })

            if (error) throw error

            setRemindersSaved(true)
            setTimeout(() => setRemindersSaved(false), 3000)
        } catch (error) {
            console.error('Error saving reminder settings:', error)
        } finally {
            setSavingReminders(false)
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

        if (!profile?.clinic_id) {
            setSavingClinic(false)
            return
        }

        try {
            console.log('--- AUDITORÍA DE GUARDADO ---')
            console.log('ID Clínica:', profile.clinic_id)
            console.log('Payload:', {
                clinic_name: clinicName,
                business_model: businessModel,
                clinic_address: clinicAddress
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
                    currency: currency,
                    timezone: timezone,
                    business_model: businessModel,
                    template_survey: templateSurvey,
                    template_reactivation: templateReactivation,
                    updated_at: new Date().toISOString()
                })
                .eq('id', profile.clinic_id)
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
        if (!profile?.clinic_id) return
        setSavingSchedule(true)
        setScheduleSaved(false)

        try {
            const { error } = await (supabase as any)
                .from('clinic_settings')
                .update({
                    working_hours: workingHours,
                    updated_at: new Date().toISOString()
                })
                .eq('id', profile.clinic_id);


            if (error) throw error;

            setScheduleSaved(true)
            setTimeout(() => setScheduleSaved(false), 3000)
        } catch (error) {
            console.error('Error saving schedule:', error)
            alert('Error al guardar los horarios')
        } finally {
            setSavingSchedule(false)
        }
    }

    const handleSaveAI = async () => {
        setSavingAI(true)
        setAiSaved(false)

        if (!profile?.clinic_id) {
            setSavingAI(false)
            return
        }

        try {
            const { error } = await (supabase as any)
                .from('clinic_settings')
                .update({
                    ai_auto_respond: aiAutoRespond,
                    ai_active_model: aiActiveModel,
                    updated_at: new Date().toISOString()
                })
                .eq('id', profile.clinic_id);


            if (error) throw error;

            setAiSaved(true)
            setTimeout(() => setAiSaved(false), 3000)
        } catch (error) {
            console.error('Error saving AI settings:', error)
            alert('Error al guardar la configuración de IA')
        } finally {
            setSavingAI(false)
        }
    }

    const handlePlanSelection = async (planId: PlanId) => {
        console.log('handlePlanSelection called with:', planId)
        console.log('Profile:', profile)
        console.log('User:', user)

        // Validate clinic ID
        if (!profile?.clinic_id) {
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
                await redirectToLemonCheckout(profile.clinic_id, user.email, planId as LSPlanId)
            } else {
                await redirectToCheckout({
                    clinicId: profile.clinic_id,
                    planId: planId as "essence" | "radiance" | "prestige",
                    email: user.email,
                })
            }
        } catch (error) {
            console.error('Checkout error:', error)
            alert('Error al iniciar el proceso de pago. Por favor intenta más tarde.')
        }
    }

    const [newServiceAiDescription, setNewServiceAiDescription] = useState('')
    const [serviceSaved, setServiceSaved] = useState(false) // Success state
    const [editingServiceId, setEditingServiceId] = useState<string | null>(null)

    const handleEditService = async (service: any) => {
        setEditingServiceId(service.id)
        setNewServiceName(service.name)
        setNewServiceDuration(service.duration.toString())
        setNewServicePrice(service.price.toString())
        setNewUpsellEnabled(service.upselling?.enabled || false)
        setNewUpsellDays(service.upselling?.daysAfter?.toString() || '7')
        setNewUpsellMessage(service.upselling?.message || '')
        setNewServiceAiDescription(service.ai_description || '')
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
        if (!newServiceName.trim() || !profile?.clinic_id) return

        try {
            const serviceData = {
                clinic_id: profile.clinic_id,
                name: newServiceName.trim(),
                duration: parseInt(newServiceDuration) || 0,
                price: parseFloat(newServicePrice) || 0,
                upselling_enabled: newUpsellEnabled,
                upselling_days_after: parseInt(newUpsellDays) || 0,
                upselling_message: newUpsellMessage,
                ai_description: newServiceAiDescription
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
                    price: serviceData.price,
                    upselling: {
                        enabled: serviceData.upselling_enabled,
                        daysAfter: serviceData.upselling_days_after,
                        message: serviceData.upselling_message
                    },
                    ai_description: serviceData.ai_description
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
                    upselling: {
                        enabled: data.upselling_enabled,
                        daysAfter: data.upselling_days_after || 0,
                        message: data.upselling_message || ''
                    },
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
            setNewServiceAiDescription('') // Clear AI field
            setNewUpsellEnabled(false)
            setNewUpsellDays('7')
            setNewUpsellMessage('')
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
        <div className="animate-fade-in relative min-h-[calc(100vh-7rem)] bg-gradient-to-br from-accent-200 to-accent-100 p-4 md:p-8 rounded-[2rem] shadow-soft-xl border border-white/60">
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
                    "flex-1",
                    showMobileList && "hidden md:block" // hide content on mobile if showing list
                )}>
                    {/* Profile Settings */}
                    {activeTab === 'profile' && (
                        <div className="space-y-6 animate-fade-in pb-20 md:pb-0">
                            <MyProfile />

                            <div className="card-soft p-6 space-y-4 max-w-3xl w-full">
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
                            <div className="card-soft p-6">
                                <h2 className="text-lg font-semibold text-charcoal mb-6">Información de la Clínica</h2>

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

                                {/* Clinic Templates */}
                                <div className="mt-8 space-y-6">
                                    <h3 className="text-sm font-semibold text-charcoal mb-4">💬 Plantillas de la Clínica</h3>

                                    <TemplateSelector
                                        label="Plantilla: Encuesta de Satisfacción"
                                        description="Se envía automáticamente horas después de que finaliza la cita."
                                        value={templateSurvey}
                                        onChange={setTemplateSurvey}
                                    />

                                    <TemplateSelector
                                        label="Plantilla: Reactivación de Pacientes"
                                        description="Se envía a pacientes que no han visitado en meses para ofrecer un nuevo servicio y recuperar la relación."
                                        value={templateReactivation}
                                        onChange={setTemplateReactivation}
                                    />
                                </div>

                                <div className="mt-6 pt-6 border-t border-silk-beige flex items-center gap-4">
                                    <button
                                        onClick={handleSaveClinic}
                                        disabled={savingClinic}
                                        className="btn-primary flex items-center gap-2"
                                    >
                                        {savingClinic ? (
                                            <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</>
                                        ) : (
                                            <><Save className="w-4 h-4" /> Guardar Cambios</>
                                        )}
                                    </button>
                                    {clinicSaved && (
                                        <div className="flex items-center gap-2 text-emerald-600 text-sm animate-fade-in bg-emerald-50 px-4 py-2 rounded-soft">
                                            <CheckCircle2 className="w-4 h-4" />
                                            ¡Cambios guardados!
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Services */}
                            <div className="card-soft p-6">
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
                                                {service.upselling?.enabled && (
                                                    <p className="text-xs text-primary-500 mt-1 flex items-center gap-1">
                                                        <Zap className="w-3 h-3" />
                                                        Upselling: {service.upselling.daysAfter} días después
                                                    </p>
                                                )}
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
                                                    setNewUpsellEnabled(false);
                                                    setNewUpsellDays('7');
                                                    setNewUpsellMessage('');
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

                                        {/* Upselling Section */}
                                        <div className="border-t border-silk-beige pt-4 mt-4">
                                            <div className="flex items-center justify-between mb-4">
                                                <div>
                                                    <p className="text-sm font-medium text-charcoal flex items-center gap-2">
                                                        <Zap className="w-4 h-4 text-primary-500" />
                                                        Upselling Automático
                                                    </p>
                                                    <p className="text-xs text-charcoal/50">Mensaje de seguimiento post-tratamiento</p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => setNewUpsellEnabled(!newUpsellEnabled)}
                                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${newUpsellEnabled ? 'bg-primary-500' : 'bg-charcoal/20'}`}
                                                >
                                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${newUpsellEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                                                </button>
                                            </div>

                                            {newUpsellEnabled && (
                                                <div className="space-y-3 animate-fade-in">
                                                    <div>
                                                        <label className="block text-sm font-medium text-charcoal mb-2">Días después del tratamiento</label>
                                                        <input
                                                            type="number"
                                                            min="1"
                                                            max="365"
                                                            value={newUpsellDays}
                                                            onChange={(e) => setNewUpsellDays(e.target.value)}
                                                            className="input-soft"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-sm font-medium text-charcoal mb-2">Mensaje de seguimiento</label>
                                                        <textarea
                                                            placeholder="Ej: ¿Te gustaría agendar la próxima desparasitación? Los mejores resultados se obtienen con tratamientos periódicos."
                                                            value={newUpsellMessage}
                                                            onChange={(e) => setNewUpsellMessage(e.target.value)}
                                                            rows={3}
                                                            className="input-soft resize-none"
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {/* AI Information Section */}
                                        <div className="border-t border-silk-beige pt-4 mt-4">
                                            <div className="flex items-center gap-2 mb-2">
                                                <div className="w-6 h-6 rounded-full bg-emerald-50 flex items-center justify-center">
                                                    <Zap className="w-3.5 h-3.5 text-emerald-600" />
                                                </div>
                                                <p className="text-sm font-semibold text-charcoal">Información para la IA</p>
                                            </div>
                                            <p className="text-xs text-charcoal/50 mb-3">Detalla inclusiones, dosis, ayunos o datos que el asistente deba saber de este servicio.</p>
                                            <textarea
                                                placeholder="Ej: Incluye la vacuna + visita médica. Se recomiendan 3 dosis con 21 días de diferencia. No requiere ayuno."
                                                value={newServiceAiDescription}
                                                onChange={(e) => setNewServiceAiDescription(e.target.value)}
                                                rows={3}
                                                className="input-soft resize-none text-sm bg-emerald-50/30 border-emerald-100 focus:border-emerald-300"
                                            />
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
                                                                    isAssigned ? "bg-primary-50 border border-primary-200" : "bg-gray-50 border border-transparent hover:border-gray-200"
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

                            <div className="card-soft p-6">
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
                                        subscription?.status === 'trial' ? 'bg-amber-100 text-amber-700' :
                                            subscription?.status === 'active' ? 'bg-emerald-100 text-emerald-700' :
                                                'bg-charcoal/10 text-charcoal/60'
                                    )}>
                                        {subscription?.status === 'trial' ? 'En Prueba' :
                                            subscription?.status === 'active' ? 'Plan Activo' : 'Inactivo'}
                                    </div>
                                </div>

                                <div className="bg-ivory border border-silk-beige rounded-soft p-6 mb-8">
                                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                                        <div>
                                            <p className="text-xs font-bold text-charcoal/40 uppercase tracking-widest mb-1">Plan Actual</p>
                                            <h3 className="text-3xl font-black text-charcoal capitalize tracking-tight">
                                                Plan {subscription?.plan || 'Essence (Trial)'}
                                            </h3>
                                            <div className="flex items-center gap-2 mt-2">
                                                <Sparkles className="w-4 h-4 text-primary-500" />
                                                <p className="text-sm font-medium text-charcoal/70">
                                                    {subscription?.plan === 'essence' ? 'Control Esencial y Automatización' :
                                                        subscription?.plan === 'radiance' ? 'Escalamiento Profesional y Retención' :
                                                            subscription?.plan === 'prestige' ? 'Potencia Empresarial Multi-Sede' :
                                                                'Prueba gratuita - 7 días de acceso total'}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-3xl font-black text-charcoal">
                                                {paymentRegion === 'international' ? 'US$' : '$'}
                                                {subscription?.plan && subscription.plan !== 'trial'
                                                    ? (paymentRegion === 'international'
                                                        ? LS_PLANS[subscription.plan as LSPlanId]?.price
                                                        : PLANS[subscription.plan as PlanId]?.price)
                                                    : '0'}
                                                <span className="text-sm font-medium text-charcoal/40 ml-1">
                                                    {paymentRegion === 'international' ? 'USD' : 'CLP'} / mes
                                                </span>
                                            </p>
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
                                                if (profile?.clinic_id) {
                                                    await (supabase as any).from('clinic_settings').update({ payment_provider: 'mercadopago' }).eq('id', profile.clinic_id);
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
                                                if (profile?.clinic_id) {
                                                    await (supabase as any).from('clinic_settings').update({ payment_provider: 'lemonsqueezy' }).eq('id', profile.clinic_id);
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

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    {(Object.keys(PLANS) as PlanId[]).map((planId) => {
                                        const mpPlan = PLANS[planId]
                                        const lsPlan = LS_PLANS[planId as LSPlanId]
                                        const plan = paymentRegion === 'international' ? lsPlan : mpPlan
                                        const price = plan.price
                                        const currencySymbol = paymentRegion === 'international' ? 'US$' : '$'
                                        const currencyCode = paymentRegion === 'international' ? 'USD' : 'CLP'
                                        const isCurrentPlan = planId === subscription?.plan
                                        const isRadiance = planId === 'radiance'

                                        return (
                                            <div
                                                key={planId}
                                                className={cn(
                                                    "relative flex flex-col p-6 rounded-soft border-2 transition-all duration-300",
                                                    isCurrentPlan ? "border-primary-500 bg-primary-500/5 ring-4 ring-primary-500/10" : "border-silk-beige bg-white hover:border-primary-300 hover:shadow-xl",
                                                    isRadiance && !isCurrentPlan && "md:scale-105 shadow-premium-lg border-primary-500 z-10"
                                                )}
                                            >
                                                {isRadiance && (
                                                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-hero-gradient text-white text-[10px] font-black px-4 py-1 rounded-full shadow-lg uppercase tracking-widest whitespace-nowrap">
                                                        Más Popular
                                                    </div>
                                                )}

                                                <div className="mb-6">
                                                    <h3 className="text-xl font-black text-charcoal uppercase tracking-tighter">{plan.name}</h3>
                                                    <p className="text-xs font-bold text-charcoal/40 mt-1 h-8 leading-tight">{plan.tagline}</p>
                                                    <div className="mt-4 flex items-baseline gap-1 border-b border-silk-beige pb-4">
                                                        <span className="text-4xl font-black text-charcoal">
                                                            {currencySymbol}{price.toLocaleString()}
                                                        </span>
                                                        <span className="text-sm font-bold text-charcoal/30 uppercase">{currencyCode}/mes</span>
                                                    </div>
                                                </div>

                                                <ul className="space-y-3 mb-8 flex-grow">
                                                    {plan.features.map((feature, idx) => (
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
                                                            : isRadiance
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
                        <div className="card-soft p-6">
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
                                                                        }))
                                                                    }}
                                                                    className="sr-only peer"
                                                                />
                                                                <div className="w-8 h-4 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-primary-500"></div>
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
                    )}

                    {/* Integrations Settings */}
                    {activeTab === 'integrations' && (
                        <div className="space-y-6">
                            {/* YCloud */}
                            <div className="card-soft p-6">
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
                            <div className="card-soft p-6">
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
                                                        : 'border-gray-200 bg-gray-50/50 opacity-60'
                                                )}
                                            >
                                                <div className="flex items-center justify-between mb-2">
                                                    <div className="flex items-center gap-3">
                                                        <div className={cn(
                                                            'w-2.5 h-2.5 rounded-full',
                                                            wh.is_active ? 'bg-emerald-400' : 'bg-gray-300'
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
                                                                <ToggleLeft className="w-5 h-5 text-gray-400" />
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
                                                                    : 'border-gray-300'
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
                        <div className="card-soft p-6">
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

                    {/* Reminders Settings */}
                    {activeTab === 'reminders' && (
                        <div className="card-soft p-6">
                            <div className="flex items-center gap-4 mb-2">
                                <div className="w-12 h-12 bg-gradient-to-br from-amber-400 to-orange-500 rounded-soft flex items-center justify-center">
                                    <AlarmClock className="w-6 h-6 text-white" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-semibold text-charcoal">Configuración de Recordatorios</h2>
                                    <p className="text-sm text-charcoal/50">Personaliza cuándo y cómo enviar recordatorios</p>
                                </div>
                            </div>

                            {remindersSaved && (
                                <div className="my-6 p-4 bg-emerald-50 border border-emerald-200 rounded-soft flex items-center gap-3">
                                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                                    <p className="text-sm text-emerald-700 font-medium">¡Configuración de recordatorios guardada!</p>
                                </div>
                            )}

                            {/* Timing Section */}
                            <div className="mt-6">
                                <h3 className="text-sm font-semibold text-charcoal mb-4">⏰ Tiempo de recordatorios</h3>
                                <div className="space-y-3">
                                    <div className="bg-white rounded-soft overflow-hidden shadow-soft-md border border-silk-beige">
                                        <div className="flex items-center justify-between p-5 bg-ivory/50">
                                            <div>
                                                <p className="font-semibold text-charcoal">24 horas antes</p>
                                                <p className="text-sm text-charcoal/60">Enviar recordatorio un día antes</p>
                                            </div>
                                            <label className="relative inline-flex items-center cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={reminderSettings.reminder_24h_before}
                                                    onChange={(e) => setReminderSettings({ ...reminderSettings, reminder_24h_before: e.target.checked })}
                                                    className="sr-only peer"
                                                />
                                                <div className="w-11 h-6 bg-silk-beige rounded-full peer peer-checked:bg-primary-500 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
                                            </label>
                                        </div>
                                        {reminderSettings.reminder_24h_before && (
                                            <div className="px-4 pb-4 border-t border-charcoal/5 pt-3">
                                                <TemplateSelector
                                                    label="Plantilla: Recordatorio 24h"
                                                    description="Se enviará este mensaje a tus pacientes 24 horas antes de la cita."
                                                    value={reminderSettings.template_24h}
                                                    onChange={(val) => setReminderSettings({ ...reminderSettings, template_24h: val })}
                                                />
                                            </div>
                                        )}
                                    </div>

                                    <div className="bg-white rounded-soft overflow-hidden shadow-soft-md border border-silk-beige">
                                        <div className="flex items-center justify-between p-5 bg-ivory/50">
                                            <div>
                                                <p className="font-semibold text-charcoal">2 horas antes</p>
                                                <p className="text-sm text-charcoal/60">Recordatorio cercano a la cita</p>
                                            </div>
                                            <label className="relative inline-flex items-center cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={reminderSettings.reminder_2h_before}
                                                    onChange={(e) => setReminderSettings({ ...reminderSettings, reminder_2h_before: e.target.checked })}
                                                    className="sr-only peer"
                                                />
                                                <div className="w-11 h-6 bg-silk-beige rounded-full peer peer-checked:bg-primary-500 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
                                            </label>
                                        </div>
                                        {reminderSettings.reminder_2h_before && (
                                            <div className="px-4 pb-4 border-t border-charcoal/5 pt-3">
                                                <TemplateSelector
                                                    label="Plantilla: Recordatorio 2h"
                                                    description="Se enviará este mensaje a tus pacientes 2 horas antes de la cita."
                                                    value={reminderSettings.template_2h}
                                                    onChange={(val) => setReminderSettings({ ...reminderSettings, template_2h: val })}
                                                />
                                            </div>
                                        )}
                                    </div>

                                    <div className="bg-white rounded-soft overflow-hidden shadow-soft-md border border-silk-beige">
                                        <div className="flex items-center justify-between p-5 bg-ivory/50">
                                            <div>
                                                <p className="font-semibold text-charcoal">1 hora antes</p>
                                                <p className="text-sm text-charcoal/60">Último recordatorio antes de la cita</p>
                                            </div>
                                            <label className="relative inline-flex items-center cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={reminderSettings.reminder_1h_before}
                                                    onChange={(e) => setReminderSettings({ ...reminderSettings, reminder_1h_before: e.target.checked })}
                                                    className="sr-only peer"
                                                />
                                                <div className="w-11 h-6 bg-silk-beige rounded-full peer peer-checked:bg-primary-500 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
                                            </label>
                                        </div>
                                        {reminderSettings.reminder_1h_before && (
                                            <div className="px-4 pb-4 border-t border-charcoal/5 pt-3">
                                                <TemplateSelector
                                                    label="Plantilla: Recordatorio 1h"
                                                    description="Se enviará este mensaje a tus pacientes 1 hora antes de la cita."
                                                    value={reminderSettings.template_1h}
                                                    onChange={(val) => setReminderSettings({ ...reminderSettings, template_1h: val })}
                                                />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Preferred Hour */}
                            <div className="mt-6">
                                <h3 className="text-sm font-semibold text-charcoal mb-4">🕐 Hora preferida de envío</h3>
                                <div className="flex items-center justify-between p-5 bg-white rounded-soft shadow-soft-md border border-silk-beige">
                                    <div>
                                        <p className="font-semibold text-charcoal">Hora de recordatorios</p>
                                        <p className="text-sm text-charcoal/60">Para recordatorios de 24h, enviar a esta hora</p>
                                    </div>
                                    <input
                                        type="time"
                                        value={reminderSettings.preferred_hour}
                                        onChange={(e) => setReminderSettings({ ...reminderSettings, preferred_hour: e.target.value })}
                                        className="px-3 py-2 bg-ivory text-charcoal border border-silk-beige rounded-soft text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
                                    />
                                </div>
                            </div>

                            {/* Confirmation Section */}
                            <div className="mt-6">
                                <h3 className="text-sm font-semibold text-charcoal mb-4">✅ Solicitar confirmación</h3>
                                <div className="space-y-3">
                                    <div className="bg-white rounded-soft overflow-hidden shadow-soft-md border border-silk-beige">
                                        <div className="flex items-center justify-between p-5 bg-ivory/50">
                                            <div>
                                                <p className="font-semibold text-charcoal">Pedir confirmación</p>
                                                <p className="text-sm text-charcoal/60">Solicitar al paciente que confirme su asistencia</p>
                                            </div>
                                            <label className="relative inline-flex items-center cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={reminderSettings.request_confirmation}
                                                    onChange={(e) => setReminderSettings({ ...reminderSettings, request_confirmation: e.target.checked })}
                                                    className="sr-only peer"
                                                />
                                                <div className="w-11 h-6 bg-silk-beige rounded-full peer peer-checked:bg-primary-500 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
                                            </label>
                                        </div>
                                        {reminderSettings.request_confirmation && (
                                            <div className="px-4 pb-4 border-t border-charcoal/5 pt-3">
                                                <TemplateSelector
                                                    label="Plantilla: Confirmación Requerida"
                                                    description="Se utiliza cuando requieres que el paciente confirme expresamente. Incluye mensaje y botones."
                                                    value={reminderSettings.template_confirmation}
                                                    onChange={(val) => setReminderSettings({ ...reminderSettings, template_confirmation: val })}
                                                />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>


                            {/* Follow-up Section */}
                            <div className="mt-6">
                                <h3 className="text-sm font-semibold text-charcoal mb-4">📅 Seguimiento post-cita</h3>
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between p-5 bg-white rounded-soft shadow-soft-md border border-silk-beige">
                                        <div>
                                            <p className="font-semibold text-charcoal">Recordatorio de seguimiento</p>
                                            <p className="text-sm text-charcoal/60">Enviar mensaje después de la cita para reagendar</p>
                                        </div>
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={reminderSettings.followup_enabled}
                                                onChange={(e) => setReminderSettings({ ...reminderSettings, followup_enabled: e.target.checked })}
                                                className="sr-only peer"
                                            />
                                            <div className="w-11 h-6 bg-silk-beige rounded-full peer peer-checked:bg-primary-500 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
                                        </label>
                                    </div>

                                    {reminderSettings.followup_enabled && (
                                        <>
                                            <div className="flex items-center justify-between p-5 bg-white rounded-soft shadow-soft-md border border-silk-beige">
                                                <div>
                                                    <p className="font-semibold text-charcoal">Días después de la cita</p>
                                                    <p className="text-sm text-charcoal/60">Cuántos días esperar antes de enviar</p>
                                                </div>
                                                <select
                                                    value={reminderSettings.followup_days_after}
                                                    onChange={(e) => setReminderSettings({ ...reminderSettings, followup_days_after: parseInt(e.target.value) })}
                                                    className="px-3 py-2 bg-ivory text-charcoal border border-silk-beige rounded-soft text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
                                                >
                                                    <option value={3}>3 días</option>
                                                    <option value={7}>7 días</option>
                                                    <option value={14}>14 días</option>
                                                    <option value={30}>30 días</option>
                                                </select>
                                            </div>

                                            <div className="mt-4">
                                                <TemplateSelector
                                                    label="Plantilla de Seguimiento"
                                                    value={reminderSettings.template_followup}
                                                    onChange={(val) => setReminderSettings({ ...reminderSettings, template_followup: val })}
                                                />
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>

                            <div className="mt-6 pt-6 border-t border-silk-beige">
                                <button
                                    onClick={handleSaveReminders}
                                    disabled={savingReminders}
                                    className="btn-primary flex items-center gap-2"
                                >
                                    {savingReminders ? (
                                        <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</>
                                    ) : (
                                        <><Save className="w-4 h-4" /> Guardar Recordatorios</>
                                    )}
                                </button>
                            </div>

                            {/* Visual Record / History Section */}
                            <div className="mt-12">
                                <div className="flex items-center justify-between mb-6">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 bg-indigo-50 rounded-full flex items-center justify-center">
                                            <History className="w-5 h-5 text-indigo-600" />
                                        </div>
                                        <div>
                                            <h3 className="text-lg font-bold text-charcoal">Registro de Envíos</h3>
                                            <p className="text-sm text-charcoal/50">Historial reciente de recordatorios enviados</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => {
                                            // Trigger reload
                                            setActiveTab('profile');
                                            setTimeout(() => setActiveTab('reminders'), 10);
                                        }}
                                        className="btn-ghost text-charcoal/50 hover:bg-ivory flex items-center gap-2 text-sm"
                                    >
                                        <RefreshCw className={cn("w-4 h-4", isLoadingLogs && "animate-spin")} />
                                        Sincronizar
                                    </button>
                                </div>

                                <div className="bg-white rounded-soft shadow-soft-md border border-silk-beige overflow-hidden">
                                    {isLoadingLogs ? (
                                        <div className="py-12 flex flex-col items-center justify-center gap-3">
                                            <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
                                            <p className="text-sm text-charcoal/40">Cargando historial...</p>
                                        </div>
                                    ) : reminderLogs.length === 0 ? (
                                        <div className="py-12 text-center">
                                            <div className="w-16 h-16 bg-silk-beige/30 rounded-full flex items-center justify-center mx-auto mb-4">
                                                <AlarmClock className="w-8 h-8 text-charcoal/20" />
                                            </div>
                                            <p className="text-charcoal/50 font-medium">Sin actividad reciente</p>
                                            <p className="text-charcoal/40 text-xs mt-1">Los recordatorios enviados aparecerán aquí.</p>
                                        </div>
                                    ) : (
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-left border-collapse">
                                                <thead>
                                                    <tr className="bg-ivory/50 border-b border-silk-beige text-[11px] uppercase tracking-wider text-charcoal/40 font-bold">
                                                        <th className="px-6 py-4">Paciente</th>
                                                        <th className="px-6 py-4">Tipo</th>
                                                        <th className="px-6 py-4">Estado</th>
                                                        <th className="px-6 py-4">Fecha/Hora</th>
                                                        <th className="px-6 py-4 text-right">Detalle</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-silk-beige/50">
                                                    {reminderLogs.map((log) => (
                                                        <tr key={log.id} className="hover:bg-ivory/30 transition-colors">
                                                            <td className="px-6 py-4">
                                                                <p className="font-semibold text-charcoal text-sm">
                                                                    {log.appointments?.patient_name || 'Paciente'}
                                                                </p>
                                                            </td>
                                                            <td className="px-6 py-4">
                                                                <span className={cn(
                                                                    "text-xs font-bold font-bold px-2 py-0.5 rounded-full font-bold uppercase",
                                                                    log.type === '24h' && "bg-amber-100 text-amber-700",
                                                                    log.type === '2h' && "bg-blue-100 text-blue-700",
                                                                    log.type === '1h' && "bg-indigo-100 text-indigo-700",
                                                                    log.type === 'confirmation' && "bg-emerald-100 text-emerald-700"
                                                                )}>
                                                                    {log.type}
                                                                </span>
                                                            </td>
                                                            <td className="px-6 py-4">
                                                                <div className="flex items-center gap-2">
                                                                    {log.status === 'sent' ? (
                                                                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                                                                    ) : (
                                                                        <AlertCircle className="w-4 h-4 text-red-500" />
                                                                    )}
                                                                    <span className={cn(
                                                                        "text-xs font-medium",
                                                                        log.status === 'sent' ? "text-emerald-700" : "text-red-700"
                                                                    )}>
                                                                        {log.status === 'sent' ? 'Enviado' : 'Fallido'}
                                                                    </span>
                                                                </div>
                                                            </td>
                                                            <td className="px-6 py-4">
                                                                <p className="text-xs text-charcoal/60">
                                                                    {new Date(log.sent_at).toLocaleString()}
                                                                </p>
                                                            </td>
                                                            <td className="px-6 py-4 text-right">
                                                                {log.error_message && (
                                                                    <div className="group relative inline-block">
                                                                        <AlertCircle className="w-4 h-4 text-red-400 cursor-help" />
                                                                        <div className="absolute bottom-full right-0 mb-2 w-48 p-2 bg-charcoal text-white text-xs font-bold font-bold rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                                                                            {log.error_message}
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                                <div className="mt-4 flex items-center justify-between text-[11px] text-charcoal/40 bg-ivory/20 p-3 rounded-soft border border-dashed border-silk-beige">
                                    <p><strong>Nota:</strong> Los logs muestran los últimos 20 intentos de envío. Si un recordatorio falla, verifica tu saldo en YCloud o la configuración del número.</p>
                                    <a href="https://www.ycloud.com" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-primary-500 font-bold">
                                        Ir a YCloud Console <ExternalLink className="w-3 h-3" />
                                    </a>
                                </div>
                            </div>
                        </div>
                    )}



                    {/* AI Settings */}
                    {activeTab === 'ai' && (
                        <div className="space-y-6">
                            {/* Header + Auto-Respond */}
                            <div className="card-soft p-6">
                                <div className="flex items-center gap-4 mb-6">
                                    <div className="w-12 h-12 bg-violet-100 rounded-soft flex items-center justify-center">
                                        <Sparkles className="w-6 h-6 text-violet-600" />
                                    </div>
                                    <div>
                                        <h2 className="text-lg font-semibold text-charcoal">Configuración de IA</h2>
                                        <p className="text-sm text-charcoal/50">Gestiona tu asistente de inteligencia artificial</p>
                                    </div>
                                </div>

                                <div className="bg-white p-4 rounded-soft border border-silk-beige flex items-center justify-between">
                                    <div>
                                        <h3 className="text-sm font-semibold text-charcoal">Atención Automática IA</h3>
                                        <p className="text-xs text-charcoal/60 mt-1">
                                            Si está desactivado, la IA no responderá mensajes en WhatsApp real. El Simulador seguirá funcionando para pruebas.
                                        </p>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input
                                            type="checkbox"
                                            className="sr-only peer"
                                            checked={aiAutoRespond}
                                            onChange={(e) => setAiAutoRespond(e.target.checked)}
                                        />
                                        <div className="w-11 h-6 bg-charcoal/10 rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-emerald-500 after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-charcoal/10 after:border after:rounded-full after:h-5 after:w-5 after:transition-all"></div>
                                    </label>
                                </div>

                                <div className="pt-4 flex items-center gap-4">
                                    <button
                                        onClick={handleSaveAI}
                                        disabled={savingAI}
                                        className="btn-primary flex items-center gap-2"
                                    >
                                        {savingAI ? (
                                            <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</>
                                        ) : (
                                            <><Save className="w-4 h-4" /> Guardar</>
                                        )}
                                    </button>
                                    {aiSaved && (
                                        <div className="flex items-center gap-2 text-emerald-600 text-sm animate-fade-in bg-emerald-50 px-4 py-2 rounded-soft">
                                            <CheckCircle2 className="w-4 h-4" />
                                            ¡Guardado!
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* AI Model Switcher (Active Response Mode) */}
                            <div className="card-soft p-6 mb-6">
                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                    <div className="flex items-center gap-4">
                                        <div className={cn(
                                            "w-12 h-12 rounded-soft flex items-center justify-center transition-colors",
                                            aiActiveModel === '4o' ? "bg-violet-100" : "bg-emerald-100"
                                        )}>
                                            <Bot className={cn("w-6 h-6", aiActiveModel === '4o' ? "text-violet-600" : "text-emerald-600")} />
                                        </div>
                                        <div>
                                            <h3 className="text-lg font-bold text-charcoal flex items-center gap-2">
                                                Motor de Respuesta Activo
                                                {aiActiveModel === '4o' && (
                                                    <span className="bg-violet-100 text-violet-700 text-xs font-bold uppercase px-2 py-0.5 rounded-full font-bold animate-pulse-subtle">
                                                        Premium
                                                    </span>
                                                )}
                                            </h3>
                                            <p className="text-sm font-medium text-charcoal/70">Define qué modelo usará la IA para atender a tus pacientes actualmente</p>
                                        </div>
                                    </div>
                                    <div className="flex flex-col sm:flex-row items-center gap-4">
                                        <div className="flex bg-charcoal/5 p-1 rounded-soft">
                                            <button
                                                onClick={() => setAiActiveModel('mini')}
                                                className={cn(
                                                    "px-4 py-2 text-xs font-bold rounded-soft transition-all",
                                                    aiActiveModel === 'mini' ? "bg-white text-emerald-600 shadow-sm" : "text-charcoal/40 hover:text-charcoal/60"
                                                )}
                                            >
                                                GPT-4o-mini
                                            </button>
                                            <button
                                                onClick={() => setAiActiveModel('4o')}
                                                className={cn(
                                                    "px-4 py-2 text-xs font-bold rounded-soft transition-all",
                                                    aiActiveModel === '4o' ? "bg-white text-violet-600 shadow-sm" : "text-charcoal/40 hover:text-charcoal/60"
                                                )}
                                            >
                                                GPT-4o (Premium)
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                <div className="mt-4 p-3 bg-blue-50/50 rounded-soft border border-blue-100/50 flex items-start gap-2">
                                    <Info className="w-4 h-4 text-blue-500 mt-0.5" />
                                    <p className="text-xs text-blue-700 leading-relaxed">
                                        <span className="font-bold">Sugerencia:</span> {
                                            aiActiveModel === '4o'
                                                ? "GPT-4o ofrece mayor razonamiento y mejor atención para casos complejos, ideal para ventas y cierres."
                                                : "GPT-4o-mini es rápido y económico, ideal para responder dudas generales y agendamientos simples."
                                        }
                                    </p>
                                </div>
                                <div className="mt-4 flex items-center gap-4">
                                    <button
                                        onClick={handleSaveAI}
                                        disabled={savingAI}
                                        className="btn-primary flex items-center gap-2"
                                    >
                                        {savingAI ? (
                                            <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</>
                                        ) : (
                                            <><Save className="w-4 h-4" /> Guardar</>
                                        )}
                                    </button>
                                    {aiSaved && (
                                        <div className="flex items-center gap-2 text-emerald-600 text-sm animate-fade-in bg-emerald-50 px-4 py-2 rounded-soft border border-emerald-100">
                                            <CheckCircle2 className="w-4 h-4" />
                                            ¡Cambio de modelo guardado!
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* AI Credits Usage */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                {/* MINI DASHBOARD */}
                                <div className="card-soft p-6 border-l-4 border-l-emerald-500">
                                    <div className="flex items-center gap-3 mb-6">
                                        <div className="w-10 h-10 bg-emerald-100 rounded-soft flex items-center justify-center">
                                            <Sparkles className="w-5 h-5 text-emerald-600" />
                                        </div>
                                        <div>
                                            <h2 className="text-md font-bold text-charcoal">Dashboard GPT-4o-mini</h2>
                                            <p className="text-xs font-bold text-charcoal/50 uppercase tracking-wider font-bold">Consumo Mensual Incluido</p>
                                        </div>
                                    </div>

                                    <div className="space-y-6">
                                        <div className="grid grid-cols-3 gap-2">
                                            <div className="p-3 bg-white rounded-soft border border-silk-beige shadow-sm">
                                                <p className="text-xs font-bold text-charcoal/60 uppercase font-bold mb-1">Plan</p>
                                                <p className="text-lg font-bold text-charcoal">{aiCreditsMonthlyLimit}</p>
                                            </div>
                                            <div className="p-3 bg-white rounded-soft border border-silk-beige shadow-sm">
                                                <p className="text-xs font-bold text-charcoal/60 uppercase font-bold mb-1">Extra</p>
                                                <p className="text-lg font-bold text-charcoal">{aiCreditsExtraBalance}</p>
                                            </div>
                                            <div className={cn(
                                                "p-3 rounded-soft border shadow-sm",
                                                aiMessagesUsed > (aiCreditsMonthlyLimit + aiCreditsExtraBalance) ? "bg-rose-50 border-rose-100" : "bg-emerald-50 border-emerald-100"
                                            )}>
                                                <p className={cn("text-xs font-bold uppercase font-bold mb-1", aiMessagesUsed > (aiCreditsMonthlyLimit + aiCreditsExtraBalance) ? "text-rose-700" : "text-emerald-700")}>Uso</p>
                                                <p className={cn("text-lg font-bold", aiMessagesUsed > (aiCreditsMonthlyLimit + aiCreditsExtraBalance) ? "text-rose-800" : "text-emerald-800")}>{aiMessagesUsed}</p>
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <div className="flex justify-between items-end">
                                                <p className="text-[11px] font-medium text-charcoal/60 uppercase">Estado de Créditos</p>
                                                <p className="text-[11px] font-bold text-charcoal">
                                                    {Math.round((aiMessagesUsed / (aiCreditsMonthlyLimit + aiCreditsExtraBalance)) * 100)}%
                                                </p>
                                            </div>
                                            <div className="h-1.5 bg-charcoal/5 rounded-full overflow-hidden">
                                                <div
                                                    className={cn(
                                                        "h-full transition-all duration-500",
                                                        (aiMessagesUsed / (aiCreditsMonthlyLimit + aiCreditsExtraBalance)) > 0.9 ? "bg-rose-500" : "bg-emerald-500"
                                                    )}
                                                    style={{ width: `${Math.min(100, (aiMessagesUsed / (aiCreditsMonthlyLimit + aiCreditsExtraBalance)) * 100)}%` }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* GPT-4o DASHBOARD */}
                                <div className="card-soft p-6 border-l-4 border-l-violet-500">
                                    <div className="flex items-center gap-3 mb-6">
                                        <div className="w-10 h-10 bg-violet-100 rounded-soft flex items-center justify-center">
                                            <Zap className="w-5 h-5 text-violet-600" />
                                        </div>
                                        <div>
                                            <h2 className="text-md font-bold text-charcoal">Dashboard GPT-4o</h2>
                                            <p className="text-xs font-bold text-charcoal/50 uppercase tracking-wider font-bold">Consumo Premium</p>
                                        </div>
                                    </div>

                                    <div className="space-y-6">
                                        <div className="grid grid-cols-2 gap-2">
                                            <div className="p-3 bg-white rounded-soft border border-silk-beige shadow-sm">
                                                <p className="text-xs font-bold text-charcoal/60 uppercase font-bold mb-1">Saldo Disponible</p>
                                                <p className="text-lg font-bold text-charcoal">{aiCreditsExtra4o}</p>
                                            </div>
                                            <div className={cn(
                                                "p-3 rounded-soft border shadow-sm",
                                                aiMessagesUsed4o >= aiCreditsExtra4o && aiCreditsExtra4o > 0 ? "bg-rose-50 border-rose-100" : "bg-violet-50 border-violet-100"
                                            )}>
                                                <p className={cn("text-xs font-bold uppercase font-bold mb-1", aiMessagesUsed4o >= aiCreditsExtra4o && aiCreditsExtra4o > 0 ? "text-rose-700" : "text-violet-700")}>Consumido</p>
                                                <p className={cn("text-lg font-bold", aiMessagesUsed4o >= aiCreditsExtra4o && aiCreditsExtra4o > 0 ? "text-rose-800" : "text-violet-800")}>{aiMessagesUsed4o}</p>
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <div className="flex justify-between items-end">
                                                <p className="text-[11px] font-medium text-charcoal/60 uppercase">Estado de Créditos Premium</p>
                                                <p className="text-[11px] font-bold text-charcoal">
                                                    {aiCreditsExtra4o > 0 ? Math.round((aiMessagesUsed4o / aiCreditsExtra4o) * 100) : 0}%
                                                </p>
                                            </div>
                                            <div className="h-1.5 bg-charcoal/5 rounded-full overflow-hidden">
                                                <div
                                                    className={cn(
                                                        "h-full transition-all duration-500",
                                                        aiCreditsExtra4o > 0 && (aiMessagesUsed4o / aiCreditsExtra4o) > 0.9 ? "bg-rose-500" : "bg-violet-500"
                                                    )}
                                                    style={{ width: `${aiCreditsExtra4o > 0 ? Math.min(100, (aiMessagesUsed4o / aiCreditsExtra4o) * 100) : 0}%` }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Credit Packs with Model Switch */}
                            <div id="ai-credits-packs" className="card-soft p-6">
                                <div className="flex items-center justify-between mb-6">
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 bg-gradient-to-br from-violet-500 to-purple-600 rounded-soft flex items-center justify-center shadow-md">
                                            <CreditCard className="w-6 h-6 text-white" />
                                        </div>
                                        <div>
                                            <h2 className="text-lg font-semibold text-charcoal">Recarga de Créditos IA</h2>
                                            <p className="text-sm text-charcoal/50">Selecciona el modelo y el pack que prefieras</p>
                                        </div>
                                    </div>
                                </div>

                                {/* Model Selector */}
                                <div className="mb-6 p-4 bg-ivory rounded-soft border border-silk-beige">
                                    <p className="text-xs font-semibold text-charcoal/60 uppercase tracking-wider mb-3">Modelo de IA</p>
                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={() => setSelectedAiModel('mini')}
                                            className={cn(
                                                "flex-1 py-3 px-4 rounded-soft text-sm font-semibold transition-all border-2",
                                                selectedAiModel === 'mini'
                                                    ? "bg-emerald-50 border-emerald-500 text-emerald-700 shadow-sm"
                                                    : "bg-white border-silk-beige text-charcoal/60 hover:border-charcoal/20"
                                            )}
                                        >
                                            <div className="text-center">
                                                <p className="font-bold">GPT-4o-mini</p>
                                                <p className="text-xs mt-0.5 font-normal opacity-70">Económico · Rápido</p>
                                            </div>
                                        </button>
                                        <button
                                            onClick={() => setSelectedAiModel('4o')}
                                            className={cn(
                                                "flex-1 py-3 px-4 rounded-soft text-sm font-semibold transition-all border-2",
                                                selectedAiModel === '4o'
                                                    ? "bg-violet-50 border-violet-500 text-violet-700 shadow-sm"
                                                    : "bg-white border-silk-beige text-charcoal/60 hover:border-charcoal/20"
                                            )}
                                        >
                                            <div className="text-center">
                                                <p className="font-bold">GPT-4o</p>
                                                <p className="text-xs mt-0.5 font-normal opacity-70">Premium · Mayor calidad</p>
                                            </div>
                                        </button>
                                    </div>
                                    <p className="text-sm text-charcoal/70 mt-3">
                                        {selectedAiModel === 'mini'
                                            ? '💡 Ideal para atención general. Respuestas rápidas y económicas.'
                                            : '⚡ Atención premium con respuestas más detalladas, contextuales y personalizadas. Ideal para clínicas que priorizan la calidad de atención.'}
                                    </p>
                                </div>

                                {/* Pack Cards */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    {(() => {
                                        const mpPacks = selectedAiModel === '4o' ? { ...CREDIT_PACKS_4O } : { ...CREDIT_PACKS };
                                        const lsPacks = selectedAiModel === '4o' ? { ...LS_CREDIT_PACKS_4O } : { ...LS_CREDIT_PACKS };
                                        const currentPacks = paymentRegion === 'international' ? lsPacks : mpPacks;
                                        const currencySymbol = paymentRegion === 'international' ? 'US$' : '$';
                                        const currencyCode = paymentRegion === 'international' ? 'USD' : 'CLP';

                                        return Object.keys(currentPacks).map((packId) => {
                                            const pack = (currentPacks as any)[packId]

                                            return (
                                                <div key={packId} className={cn(
                                                    "p-6 bg-white border rounded-soft hover:shadow-md transition-all flex flex-col",
                                                    selectedAiModel === '4o'
                                                        ? "border-violet-200 hover:border-violet-400"
                                                        : "border-silk-beige hover:border-primary-300"
                                                )}>
                                                    <div className="mb-4">
                                                        <h3 className="text-lg font-bold text-charcoal">{pack.name}</h3>
                                                        <div className="flex items-baseline gap-1 mt-1">
                                                            <span className={cn(
                                                                "text-2xl font-bold",
                                                                selectedAiModel === '4o' ? "text-violet-600" : "text-primary-600"
                                                            )}>
                                                                {currencySymbol}{pack.price.toLocaleString()}
                                                            </span>
                                                            <span className="text-xs text-charcoal/60 font-medium">{currencyCode}</span>
                                                        </div>
                                                    </div>
                                                    <ul className="mb-6 space-y-2 flex-grow">
                                                        <li className="flex items-center gap-2 text-sm text-charcoal/70">
                                                            <Check className="w-4 h-4 text-emerald-500" />
                                                            {pack.credits} mensajes de IA
                                                        </li>
                                                        <li className="flex items-center gap-2 text-sm text-charcoal/70">
                                                            <Check className="w-4 h-4 text-emerald-500" />
                                                            Modelo {selectedAiModel === '4o' ? 'GPT-4o (Premium)' : 'GPT-4o-mini'}
                                                        </li>
                                                        <li className="flex items-center gap-2 text-sm text-charcoal/70">
                                                            <Check className="w-4 h-4 text-emerald-500" />
                                                            Sin fecha de vencimiento
                                                        </li>
                                                        <li className="flex items-center gap-2 text-sm text-charcoal/70">
                                                            <Check className="w-4 h-4 text-emerald-500" />
                                                            Activación instantánea
                                                        </li>
                                                    </ul>
                                                    <button
                                                        onClick={() => handleBuyCredits(packId)}
                                                        className={cn(
                                                            "w-full py-2 text-white rounded-soft font-semibold text-sm transition-colors flex items-center justify-center gap-2",
                                                            selectedAiModel === '4o'
                                                                ? "bg-violet-600 hover:bg-violet-700"
                                                                : "bg-primary-600 hover:bg-primary-700"
                                                        )}
                                                    >
                                                        <CreditCard className="w-4 h-4" />
                                                        Comprar Pack
                                                    </button>
                                                </div>
                                            )
                                        })
                                    })()}
                                </div>
                                <p className="mt-6 text-sm text-charcoal/60 italic text-center">
                                    * Los créditos extra se consumen solo después de agotar el cupo mensual de tu plan.
                                </p>
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
        </div >
    )
}
