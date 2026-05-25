import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import {
    AlarmClock, Save, Loader2, RefreshCw, Activity,
    CheckCircle2, AlertCircle, Phone,
    Settings2, Clock, Package, Infinity as InfinityIcon
} from 'lucide-react'
import { TemplateSelector } from '@/components/settings/TemplateSelector'
import { cn } from '@/lib/utils'

import toast from 'react-hot-toast'
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
    BarChart, Bar, Legend
} from 'recharts'
import { Link, useLocation } from 'react-router-dom'
import { redirectToLemonRemindersCheckout, redirectToLemonReminderPackCheckout, type ReminderPackId } from '@/lib/lemonsqueezy'

type TabType = 'appointments' | 'medical' | 'packs'
type DateRange = 'today' | 'week' | 'month' | 'all'

export default function Reminders() {
    const { profile } = useAuth()
    const location = useLocation()
    const [activeTab, setActiveTab] = useState<TabType>('appointments')
    const [planLoading, setPlanLoading] = useState<boolean>(true)
    const [medicalTab, setMedicalTab] = useState<'pending' | 'history'>('pending')
    const [dateRange, setDateRange] = useState<DateRange>('week')
    const [isLoading, setIsLoading] = useState(true)
    const [savingSettings, setSavingSettings] = useState(false)
    const [reminderQty, setReminderQty] = useState(10)
    const [checkoutLoading, setCheckoutLoading] = useState(false)
    const [packCheckoutLoading, setPackCheckoutLoading] = useState<string | null>(null)

    const [settings, setSettings] = useState<any>(null)
    const [appointmentLogs, setAppointmentLogs] = useState<any[]>([])
    const [medicalLogs, setMedicalLogs] = useState<any[]>([])
    const [reminderUsage, setReminderUsage] = useState<any>(null)

    // Detectar retorno de pago exitoso
    useEffect(() => {
        const params = new URLSearchParams(location.search)
        if (params.get('payment') === 'success') {
            toast.success('¡Pago procesado! Los recordatorios se acreditarán en instantes.')
            setActiveTab('packs')
        }
    }, [location.search])

    // Settings fetch — only re-runs when clinic changes
    useEffect(() => {
        if (!profile?.clinic_id) return
        const fetchSettings = async () => {
            const [{ data: clinicSettings }, { data: reminderData }, { data: subData }] = await Promise.all([
                supabase.from('clinic_settings').select('*').eq('id', profile.clinic_id).single(),
                supabase.from('reminder_settings').select('*').eq('clinic_id', profile.clinic_id).single(),
                (supabase as any).from('subscriptions')
                    .select('monthly_reminders_limit, monthly_reminders_used, reminders_pack_balance')
                    .eq('clinic_id', profile.clinic_id).maybeSingle(),
            ])
            setSettings({ ...(clinicSettings || {}), ...(reminderData || {}) })
            setReminderUsage(subData || null)
            setPlanLoading(false)
        }
        fetchSettings()
    }, [profile?.clinic_id])

    // Logs fetch — re-runs on tab/filter/clinic changes
    useEffect(() => {
        if (profile?.clinic_id) fetchLogs()
    }, [profile?.clinic_id, activeTab, dateRange, medicalTab])

    const getStartDate = (range: DateRange): Date | null => {
        if (range === 'all') return null
        const d = new Date()
        if (range === 'today') {
            d.setHours(0, 0, 0, 0)
        } else if (range === 'week') {
            d.setDate(d.getDate() - 7)
        } else if (range === 'month') {
            d.setMonth(d.getMonth() - 1)
        }
        return d
    }

    const fetchLogs = async () => {
        if (!profile?.clinic_id) return
        setIsLoading(true)
        try {
            const startDate = getStartDate(dateRange)

            if (activeTab === 'appointments') {
                let query = supabase
                    .from('reminder_logs')
                    .select('*, appointments(id, patient_name, tutor_name, status)')
                    .eq('clinic_id', profile.clinic_id)
                    .order('created_at', { ascending: false })

                if (startDate) {
                    query = query.gte('created_at', startDate.toISOString())
                } else {
                    query = query.limit(300)
                }

                const { data, error } = await query
                if (error) console.error('Error fetching reminder logs:', error)
                setAppointmentLogs(data || [])
            } else {
                const todayStr = new Date().toISOString().split('T')[0]

                let query = supabase
                    .from('reminders')
                    .select('*, patients(id, name, tutor_id, tutors(id, name, phone_number))')
                    .eq('clinic_id', profile.clinic_id)

                if (medicalTab === 'pending') {
                    // Próximos en cola: scheduled_date entre hoy y el límite hacia adelante según el filtro
                    query = query
                        .eq('status', 'pending')
                        .gte('scheduled_date', todayStr)
                        .order('scheduled_date', { ascending: true })
                    if (dateRange !== 'all') {
                        const end = new Date()
                        if (dateRange === 'week') end.setDate(end.getDate() + 7)
                        else if (dateRange === 'month') end.setDate(end.getDate() + 30)
                        query = query.lte('scheduled_date', end.toISOString().split('T')[0])
                    }
                } else {
                    // Historial: enviados/fallidos filtrados por el rango de fecha elegido
                    query = query
                        .in('status', ['sent', 'failed'])
                        .order('scheduled_date', { ascending: false })
                    if (startDate) {
                        query = query.gte('scheduled_date', startDate.toISOString().split('T')[0]).lte('scheduled_date', todayStr)
                    }
                }

                const { data, error } = await query.limit(300)
                if (error) console.error('Error fetching medical reminders:', error)
                setMedicalLogs(data || [])
            }
        } catch (error) {
            console.error('Error fetching reminders data:', error)
        } finally {
            setIsLoading(false)
        }
    }

    const handleSaveSettings = async () => {
        if (!profile?.clinic_id || !settings) return
        setSavingSettings(true)
        const toastId = toast.loading('Guardando configuración...')
        try {
            const { error: clinicError } = await (supabase as any)
                .from('clinic_settings')
                .update({
                    vaccine_reminder_template: settings.vaccine_reminder_template,
                    deworming_reminder_template: settings.deworming_reminder_template,
                    checkup_reminder_template: settings.checkup_reminder_template,
                    updated_at: new Date().toISOString()
                })
                .eq('id', profile.clinic_id)

            if (clinicError) throw clinicError

            const { error: reminderError } = await (supabase as any)
                .from('reminder_settings')
                .upsert({
                    clinic_id: profile.clinic_id,
                    reminder_24h_before: settings.reminder_24h_before ?? false,
                    template_24h: settings.template_24h,
                    reminder_2h_before: settings.reminder_2h_before ?? false,
                    template_2h: settings.template_2h,
                    request_confirmation: settings.request_confirmation ?? false,
                    template_confirmation: settings.template_confirmation,
                    preferred_hour: settings.preferred_hour || '09:00',
                    updated_at: new Date().toISOString()
                }, { onConflict: 'clinic_id' })

            if (reminderError) throw reminderError
            toast.success('Configuración guardada correctamente', { id: toastId })
        } catch (error: any) {
            toast.error(`Error: ${error.message}`, { id: toastId })
        } finally {
            setSavingSettings(false)
        }
    }

    const getChartData = () => {
        if (activeTab === 'appointments') {
            const groupedByDate = appointmentLogs.reduce((acc, log) => {
                const dateKey = new Date(log.created_at).toISOString().split('T')[0]
                if (!acc[dateKey]) acc[dateKey] = { dateKey, enviados: 0, fallidos: 0 }
                if (log.status === 'sent') acc[dateKey].enviados += 1
                else if (log.status === 'failed') acc[dateKey].fallidos += 1
                return acc
            }, {} as Record<string, any>)

            const area = Object.values(groupedByDate)
                .sort((a: any, b: any) => a.dateKey.localeCompare(b.dateKey))
                .map((item: any) => ({
                    date: new Date(item.dateKey + 'T12:00:00').toLocaleDateString('es-ES', { month: 'short', day: 'numeric' }),
                    enviados: item.enviados,
                    fallidos: item.fallidos
                }))

            return { area }
        } else {
            const groupedByType = medicalLogs.reduce((acc, log) => {
                const type = log.type === 'vaccine' ? 'Vacuna' : log.type === 'deworming' ? 'Desparasitación' : 'Control'
                if (!acc[type]) acc[type] = { type, count: 0 }
                acc[type].count += 1
                return acc
            }, {} as Record<string, any>)

            return { bar: Object.values(groupedByType) }
        }
    }

    const chartData = getChartData()
    const sent = appointmentLogs.filter((l: any) => l.status === 'sent').length
    const failed = appointmentLogs.filter((l: any) => l.status === 'failed').length

    const UNIT_PRICE_CLP = 150
    const UNIT_PRICE_USD = 0.15

    const REMINDER_PACKS = [
        { id: 'reminders_50' as ReminderPackId,        name: 'Pack Básico',    qty: 50,   unlimited: false, totalCLP: 5000,  totalUSD: 9.00,  unitCLP: 100, badge: null },
        { id: 'reminders_350' as ReminderPackId,       name: 'Pack Pro',       qty: 350,  unlimited: false, totalCLP: 15000, totalUSD: 19.00, unitCLP: 43,  badge: 'Más popular' },
        { id: 'reminders_unlimited' as ReminderPackId, name: 'Pack Ilimitado', qty: 9999, unlimited: true,  totalCLP: 25000, totalUSD: 29.00, unitCLP: null, badge: 'Mejor valor' },
    ]

    const handleBuyPack = async (packId: ReminderPackId) => {
        if (!profile?.clinic_id || !profile?.email) {
            toast.error('No se pudo obtener tu información de cuenta.')
            return
        }
        setPackCheckoutLoading(packId)
        try {
            await redirectToLemonReminderPackCheckout(profile.clinic_id, profile.email, packId)
        } catch (err: any) {
            toast.error(err.message || 'Error al iniciar el pago.')
            setPackCheckoutLoading(null)
        }
    }

    const handleBuyReminders = async () => {
        if (!profile?.clinic_id || !profile?.email) {
            toast.error('No se pudo obtener tu información de cuenta.')
            return
        }
        if (reminderQty < 10) {
            toast.error('El mínimo es 10 unidades.')
            return
        }
        setCheckoutLoading(true)
        try {
            await redirectToLemonRemindersCheckout(profile.clinic_id, profile.email, reminderQty)
        } catch (err: any) {
            toast.error(err.message || 'Error al iniciar el pago.')
            setCheckoutLoading(false)
        }
    }

    // Pool mensual de recordatorios (compartido entre citas y médicos)
    const rLimit = reminderUsage?.monthly_reminders_limit
    const rUsed = reminderUsage?.monthly_reminders_used ?? 0
    const rPack = reminderUsage?.reminders_pack_balance ?? 0
    const isUnlimited = rLimit === null || rLimit === undefined
    const effLimit: number | null = isUnlimited ? null : rLimit + rPack
    const atLimit = !isUnlimited && rUsed >= (effLimit as number)
    const poolPct = isUnlimited ? 0 : Math.min(100, Math.round((rUsed / Math.max(1, effLimit as number)) * 100))
    const poolColor = atLimit ? 'bg-red-500' : poolPct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'

    return (
        <div className="space-y-6 max-w-7xl mx-auto pb-20 animate-fade-in">
            {/* Banner */}
            <div className="bg-gradient-to-br from-primary-500 to-primary-700 rounded-2xl overflow-hidden shadow-soft-md">
                <div className="p-6 sm:p-8">
                    <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                            <p className="text-xs font-black uppercase tracking-widest text-primary-200 mb-2">Clínica</p>
                            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">Centro de Recordatorios</h1>
                            <p className="text-sm text-primary-100/80 font-light mt-1">Mensajes automáticos de citas y controles médicos.</p>
                        </div>
                        <div className="flex items-center gap-3">
                            {activeTab !== 'packs' && (
                                <button
                                    onClick={handleSaveSettings}
                                    disabled={savingSettings || !settings}
                                    className="flex items-center gap-2 bg-white text-primary-700 font-bold text-sm px-4 py-2.5 rounded-xl hover:bg-primary-50 transition-colors shadow-sm disabled:opacity-50"
                                >
                                    {savingSettings ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                    Guardar
                                </button>
                            )}
                            <div className="w-12 h-12 bg-white/15 rounded-2xl flex items-center justify-center shrink-0">
                                <AlarmClock className="w-6 h-6 text-white" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Controls */}
            <div className="bg-white p-2 rounded-xl border border-silk-beige shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
                <div className="flex items-center p-1 bg-ivory rounded-lg w-full sm:w-auto">
                    <button
                        onClick={() => setActiveTab('appointments')}
                        className={cn(
                            "flex-1 sm:flex-initial px-4 sm:px-6 py-2 rounded-md text-xs sm:text-sm font-bold uppercase tracking-widest transition-all text-center",
                            activeTab === 'appointments' ? "bg-white text-amber-700 shadow-sm border border-silk-beige" : "text-charcoal/40 hover:text-charcoal"
                        )}
                    >
                        Citas
                    </button>
                    <button
                        onClick={() => setActiveTab('medical')}
                        className={cn(
                            "flex-1 sm:flex-initial px-4 sm:px-6 py-2 rounded-md text-xs sm:text-sm font-bold uppercase tracking-widest transition-all text-center",
                            activeTab === 'medical' ? "bg-white text-amber-700 shadow-sm border border-silk-beige" : "text-charcoal/40 hover:text-charcoal"
                        )}
                    >
                        Médicos
                    </button>
                    {!planLoading && (
                        <button
                            onClick={() => setActiveTab('packs')}
                            className={cn(
                                "flex-1 sm:flex-initial px-4 sm:px-6 py-2 rounded-md text-xs sm:text-sm font-bold uppercase tracking-widest transition-all text-center",
                                activeTab === 'packs' ? "bg-white text-amber-700 shadow-sm border border-silk-beige" : "text-charcoal/40 hover:text-charcoal"
                            )}
                        >
                            Packs
                        </button>
                    )}
                </div>
                {activeTab !== 'packs' && (
                    <div className="flex items-center justify-between sm:justify-end gap-2 pr-0 sm:pr-2 w-full sm:w-auto">
                        <span className="text-xs font-bold text-charcoal/40 uppercase tracking-widest">Filtrar:</span>
                        <select
                            value={dateRange}
                            onChange={(e) => setDateRange(e.target.value as DateRange)}
                            className="text-sm bg-ivory border border-silk-beige rounded-lg px-3 py-1.5 font-medium text-charcoal focus:ring-primary-500 focus:border-primary-500 w-full sm:w-auto"
                        >
                            {(() => {
                                const forward = activeTab === 'medical' && medicalTab === 'pending'
                                const prefix = forward ? 'Próximos' : 'Últimos'
                                return (
                                    <>
                                        <option value="today">Hoy</option>
                                        <option value="week">{prefix} 7 días</option>
                                        <option value="month">{prefix} 30 días</option>
                                        <option value="all">Todos</option>
                                    </>
                                )
                            })()}
                        </select>
                    </div>
                )}
            </div>

            {/* Packs Tab Content */}
            {activeTab === 'packs' && (
                <div className="max-w-2xl mx-auto space-y-5">
                    {/* Balance actual */}
                    <div className="bg-white rounded-2xl border border-silk-beige shadow-sm overflow-hidden">
                        <div className="bg-gradient-to-br from-primary-500 to-primary-700 p-5 text-white">
                            <p className="text-xs font-black uppercase tracking-widest text-primary-200 mb-1">Add-ons</p>
                            <h3 className="text-lg font-extrabold tracking-tight text-white">Recordatorios adicionales</h3>
                            <p className="text-sm text-primary-100/80 font-light mt-1">Compra unidades extra para este mes.</p>
                        </div>
                        <div className="p-5 flex items-center justify-between">
                            <div>
                                <p className="text-xs font-bold uppercase tracking-widest text-charcoal/40 mb-1">Balance disponible</p>
                                <p className="text-3xl font-black text-charcoal">
                                    {reminderUsage?.reminders_pack_balance ?? 0}
                                    <span className="text-sm font-bold text-charcoal/40 ml-2">unidades</span>
                                </p>
                                <p className="text-xs text-charcoal/40 mt-1">Se reinician con la renovación mensual</p>
                            </div>
                            <div className="w-14 h-14 bg-primary-50 rounded-2xl flex items-center justify-center">
                                <Package className="w-7 h-7 text-primary-600" />
                            </div>
                        </div>
                    </div>

                    {/* Packs con descuento */}
                    <div>
                        <p className="text-xs font-black uppercase tracking-widest text-charcoal/40 mb-3 px-1">
                            Packs — precio por unidad más económico
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            {REMINDER_PACKS.map(pack => {
                                const isPopular = pack.badge === 'Más popular'
                                const isLoading = packCheckoutLoading === pack.id
                                const savingPct = pack.unitCLP ? Math.round((1 - pack.unitCLP / UNIT_PRICE_CLP) * 100) : null
                                return (
                                    <div
                                        key={pack.id}
                                        className={cn(
                                            "bg-white rounded-2xl border shadow-sm overflow-hidden flex flex-col relative",
                                            isPopular ? "border-primary-400 ring-1 ring-primary-400/30" : "border-silk-beige"
                                        )}
                                    >
                                        {pack.badge && (
                                            <div className="absolute top-3 right-3 z-10">
                                                <span className={cn(
                                                    "text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-full",
                                                    isPopular ? "bg-primary-500 text-white" : "bg-amber-100 text-amber-700"
                                                )}>
                                                    {pack.badge}
                                                </span>
                                            </div>
                                        )}
                                        <div className={cn(
                                            "p-4",
                                            isPopular ? "bg-gradient-to-br from-primary-500 to-primary-700" : "bg-ivory"
                                        )}>
                                            <p className={cn(
                                                "text-[10px] font-black uppercase tracking-widest mb-1",
                                                isPopular ? "text-primary-200" : "text-charcoal/40"
                                            )}>
                                                {pack.name}
                                            </p>
                                            <p className={cn(
                                                "text-4xl font-black",
                                                isPopular ? "text-white" : "text-charcoal"
                                            )}>
                                                {pack.unlimited ? '∞' : pack.qty}
                                                <span className={cn(
                                                    "text-sm font-bold ml-1",
                                                    isPopular ? "text-primary-200" : "text-charcoal/40"
                                                )}>
                                                    {pack.unlimited ? '' : 'u'}
                                                </span>
                                            </p>
                                            {pack.unlimited && (
                                                <p className={cn(
                                                    "text-xs font-semibold mt-0.5",
                                                    isPopular ? "text-primary-100" : "text-charcoal/50"
                                                )}>
                                                    Sin límite este mes
                                                </p>
                                            )}
                                        </div>
                                        <div className="p-4 flex flex-col gap-3 flex-1">
                                            <div>
                                                <p className="text-xl font-black text-charcoal">
                                                    ${pack.totalCLP.toLocaleString('es-CL')}
                                                    <span className="text-xs font-bold text-charcoal/40 ml-1">CLP</span>
                                                </p>
                                                <p className="text-xs text-charcoal/40">US${pack.totalUSD.toFixed(2)}</p>
                                            </div>
                                            {pack.unlimited ? (
                                                <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                                                    <p className="text-xs font-bold text-amber-700">Envíos ilimitados</p>
                                                    <p className="text-[10px] font-semibold text-amber-600">Sin corte por cupo este mes</p>
                                                </div>
                                            ) : (
                                                <div className={cn(
                                                    "rounded-xl px-3 py-2 border",
                                                    isPopular ? "bg-primary-50 border-primary-100" : "bg-emerald-50 border-emerald-100"
                                                )}>
                                                    <p className={cn(
                                                        "text-xs font-bold",
                                                        isPopular ? "text-primary-700" : "text-emerald-700"
                                                    )}>
                                                        ${pack.unitCLP}/u &nbsp;
                                                        <span className="line-through font-normal text-charcoal/30">${UNIT_PRICE_CLP}</span>
                                                    </p>
                                                    <p className={cn(
                                                        "text-[10px] font-semibold",
                                                        isPopular ? "text-primary-600" : "text-emerald-600"
                                                    )}>
                                                        {savingPct}% más barato por unidad
                                                    </p>
                                                </div>
                                            )}
                                            <button
                                                onClick={() => handleBuyPack(pack.id)}
                                                disabled={isLoading || !!packCheckoutLoading}
                                                className={cn(
                                                    "mt-auto w-full py-2.5 font-black text-xs uppercase tracking-widest rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5",
                                                    isPopular
                                                        ? "bg-primary-500 hover:bg-primary-600 text-white"
                                                        : "bg-ivory hover:bg-silk-beige text-charcoal border border-silk-beige"
                                                )}
                                            >
                                                {isLoading
                                                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Procesando...</>
                                                    : <>Comprar pack</>
                                                }
                                            </button>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>

                    {/* Divisor */}
                    <div className="flex items-center gap-4 py-1">
                        <div className="flex-1 h-px bg-silk-beige" />
                        <p className="text-xs font-bold text-charcoal/40 uppercase tracking-widest whitespace-nowrap">
                            ¿Necesitas otro número exacto? Compra por unidad
                        </p>
                        <div className="flex-1 h-px bg-silk-beige" />
                    </div>

                    {/* Selector por unidad */}
                    <div className="bg-white rounded-2xl border border-silk-beige shadow-sm p-5 space-y-4">
                        <div className="flex items-start justify-between">
                            <div>
                                <p className="text-sm font-bold text-charcoal">Precio por unidad</p>
                                <p className="text-xs text-charcoal/40 mt-0.5">Sin descuento · Mínimo 10 unidades</p>
                            </div>
                            <div className="text-right">
                                <p className="text-xl font-black text-charcoal">
                                    ${UNIT_PRICE_CLP} <span className="text-xs text-charcoal/40">CLP</span>
                                </p>
                                <p className="text-xs text-charcoal/40">US${UNIT_PRICE_USD.toFixed(2)}/u</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => setReminderQty(q => Math.max(10, q - 10))}
                                disabled={reminderQty <= 10}
                                className="w-10 h-10 rounded-xl border border-silk-beige bg-ivory flex items-center justify-center text-lg font-bold text-charcoal hover:bg-silk-beige disabled:opacity-30 transition-colors"
                            >
                                −
                            </button>
                            <input
                                type="number"
                                min={10}
                                step={10}
                                value={reminderQty}
                                onChange={(e) => setReminderQty(Math.max(10, parseInt(e.target.value) || 10))}
                                className="w-20 h-10 text-center text-lg font-black text-charcoal border border-silk-beige rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 bg-white"
                            />
                            <button
                                onClick={() => setReminderQty(q => q + 10)}
                                className="w-10 h-10 rounded-xl border border-silk-beige bg-ivory flex items-center justify-center text-lg font-bold text-charcoal hover:bg-silk-beige transition-colors"
                            >
                                +
                            </button>
                            <div className="ml-auto text-right">
                                <p className="text-lg font-black text-charcoal">
                                    ${(reminderQty * UNIT_PRICE_CLP).toLocaleString('es-CL')} <span className="text-xs text-charcoal/40">CLP</span>
                                </p>
                                <p className="text-xs text-charcoal/40">US${(reminderQty * UNIT_PRICE_USD).toFixed(2)}</p>
                            </div>
                        </div>

                        <button
                            onClick={handleBuyReminders}
                            disabled={checkoutLoading || !!packCheckoutLoading}
                            className="w-full py-3 bg-ivory hover:bg-silk-beige border border-silk-beige text-charcoal font-black text-xs uppercase tracking-widest rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {checkoutLoading
                                ? <><Loader2 className="w-4 h-4 animate-spin" /> Procesando...</>
                                : <><Package className="w-4 h-4" /> Comprar {reminderQty} recordatorios</>
                            }
                        </button>

                        <p className="text-xs text-charcoal/40 text-center leading-relaxed">
                            El pago se procesa en USD vía LemonSqueezy. Los recordatorios se acreditan inmediatamente y se reinician con tu próxima renovación mensual.
                        </p>
                    </div>
                </div>
            )}

            {activeTab !== 'packs' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Configuration Sidebar — right */}
                <div className="lg:col-span-1 space-y-6 lg:order-2">
                    <div className="bg-white rounded-xl border border-silk-beige shadow-sm p-6">
                        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-silk-beige">
                            <div className="p-2 bg-amber-50 rounded-lg">
                                <Settings2 className="w-5 h-5 text-amber-600" />
                            </div>
                            <div>
                                <h3 className="text-base font-bold text-charcoal">
                                    {activeTab === 'appointments' ? 'Configurar Citas' : 'Plantillas Médicas'}
                                </h3>
                                <p className="text-xs text-charcoal/40 uppercase tracking-widest font-semibold">Configuración</p>
                            </div>
                        </div>

                        {settings ? (
                            <div className="space-y-4">
                                {activeTab === 'appointments' ? (
                                    <>
                                        {/* 24h Reminder */}
                                        <div className="bg-ivory p-4 rounded-xl border border-silk-beige space-y-4">
                                            <div className="flex items-center justify-between">
                                                <p className="font-bold text-sm">24 Horas Antes</p>
                                                <label className="relative inline-flex items-center cursor-pointer">
                                                    <input type="checkbox" className="sr-only peer" checked={!!settings.reminder_24h_before} onChange={e => setSettings({ ...settings, reminder_24h_before: e.target.checked })} />
                                                    <div className="w-9 h-5 bg-silk-beige peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-500"></div>
                                                </label>
                                            </div>
                                            {settings.reminder_24h_before && (
                                                <TemplateSelector
                                                    label="Plantilla 24h"
                                                    value={settings.template_24h || ''}
                                                    onChange={v => setSettings({ ...settings, template_24h: v })}
                                                    labelClassName="text-charcoal/60 text-xs"
                                                />
                                            )}
                                        </div>

                                        {/* Preferred Hour */}
                                        <div className="bg-ivory p-4 rounded-xl border border-silk-beige">
                                            <div className="flex items-center gap-2 mb-3">
                                                <Clock className="w-4 h-4 text-primary-600" />
                                                <p className="font-bold text-sm">Hora de Envío</p>
                                            </div>
                                            <input
                                                type="time"
                                                value={settings.preferred_hour || '09:00'}
                                                onChange={e => setSettings({ ...settings, preferred_hour: e.target.value })}
                                                className="w-full bg-white border border-silk-beige rounded-lg px-3 py-2 text-charcoal text-sm font-medium focus:outline-none focus:border-primary-500"
                                            />
                                            <p className="text-[10px] text-charcoal/40 mt-2">A partir de esta hora el cron envía los recordatorios del día.</p>
                                        </div>

                                        {/* 2h Reminder */}
                                        <div className="bg-ivory p-4 rounded-xl border border-silk-beige space-y-4">
                                            <div className="flex items-center justify-between">
                                                <p className="font-bold text-sm">2 Horas Antes</p>
                                                <label className="relative inline-flex items-center cursor-pointer">
                                                    <input type="checkbox" className="sr-only peer" checked={!!settings.reminder_2h_before} onChange={e => setSettings({ ...settings, reminder_2h_before: e.target.checked })} />
                                                    <div className="w-9 h-5 bg-silk-beige peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-500"></div>
                                                </label>
                                            </div>
                                            {settings.reminder_2h_before && (
                                                <TemplateSelector
                                                    label="Plantilla 2h"
                                                    value={settings.template_2h || ''}
                                                    onChange={v => setSettings({ ...settings, template_2h: v })}
                                                    labelClassName="text-charcoal/60 text-xs"
                                                />
                                            )}
                                        </div>

                                        {/* Confirmation */}
                                        <div className="bg-ivory p-4 rounded-xl border border-silk-beige space-y-4">
                                            <div className="flex items-center justify-between">
                                                <p className="font-bold text-sm text-primary-700">Solicitar Confirmación</p>
                                                <label className="relative inline-flex items-center cursor-pointer">
                                                    <input type="checkbox" className="sr-only peer" checked={!!settings.request_confirmation} onChange={e => setSettings({ ...settings, request_confirmation: e.target.checked })} />
                                                    <div className="w-9 h-5 bg-silk-beige peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-500"></div>
                                                </label>
                                            </div>
                                            {settings.request_confirmation && (
                                                <TemplateSelector
                                                    label="Plantilla Confirmación"
                                                    value={settings.template_confirmation || ''}
                                                    onChange={v => setSettings({ ...settings, template_confirmation: v })}
                                                    labelClassName="text-charcoal/60 text-xs"
                                                />
                                            )}
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className="bg-ivory p-4 rounded-xl border border-silk-beige space-y-2">
                                            <TemplateSelector
                                                label="Vacunación"
                                                value={settings.vaccine_reminder_template || ''}
                                                onChange={v => setSettings({ ...settings, vaccine_reminder_template: v })}
                                                labelClassName="text-charcoal/60 text-xs font-bold uppercase tracking-wider"
                                            />
                                        </div>
                                        <div className="bg-ivory p-4 rounded-xl border border-silk-beige space-y-2">
                                            <TemplateSelector
                                                label="Desparasitación"
                                                value={settings.deworming_reminder_template || ''}
                                                onChange={v => setSettings({ ...settings, deworming_reminder_template: v })}
                                                labelClassName="text-charcoal/60 text-xs font-bold uppercase tracking-wider"
                                            />
                                        </div>
                                        <div className="bg-ivory p-4 rounded-xl border border-silk-beige space-y-2">
                                            <TemplateSelector
                                                label="Control Médico"
                                                value={settings.checkup_reminder_template || ''}
                                                onChange={v => setSettings({ ...settings, checkup_reminder_template: v })}
                                                labelClassName="text-charcoal/60 text-xs font-bold uppercase tracking-wider"
                                            />
                                        </div>
                                    </>
                                )}
                            </div>
                        ) : (
                            <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-charcoal/30" /></div>
                        )}
                    </div>
                </div>

                {/* Main Content — metrics left */}
                <div className="lg:col-span-2 space-y-6 lg:order-1">
                    {/* Pool mensual de recordatorios (citas + médicos comparten el mismo cupo) */}
                    <div className="bg-white p-5 rounded-soft border border-silk-beige shadow-sm">
                        <div className="flex items-center justify-between mb-3">
                            <h4 className="text-xs font-bold text-charcoal/50 uppercase tracking-widest">
                                Recordatorios este mes
                            </h4>
                            {planLoading ? (
                                <span className="text-xs text-charcoal/30">—</span>
                            ) : isUnlimited ? (
                                <span className="text-sm font-black text-primary-600 flex items-center gap-1">
                                    <InfinityIcon className="w-4 h-4" /> Ilimitado
                                </span>
                            ) : (
                                <span className={cn("text-sm font-black", atLimit ? "text-red-600" : "text-charcoal")}>
                                    {rUsed} / {effLimit}
                                </span>
                            )}
                        </div>
                        {!planLoading && !isUnlimited && (
                            <>
                                <div className="w-full h-2.5 bg-ivory rounded-full overflow-hidden">
                                    <div className={cn("h-full rounded-full transition-all", poolColor)} style={{ width: `${poolPct}%` }} />
                                </div>
                                <div className="flex items-center justify-between mt-2">
                                    <p className="text-[11px] text-charcoal/40">
                                        Cupo compartido entre citas y recordatorios médicos.
                                        {rPack > 0 && <span className="text-emerald-600 font-bold"> +{rPack} de packs</span>}
                                    </p>
                                    {!atLimit && <span className="text-[11px] font-bold text-charcoal/40">{poolPct}%</span>}
                                </div>
                                {atLimit && (
                                    <div className="mt-3 bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-3">
                                        <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                                        <div className="flex-1">
                                            <p className="text-sm font-bold text-red-700">Límite mensual alcanzado</p>
                                            <p className="text-xs text-red-600/80 mt-0.5">
                                                El envío automático de recordatorios está pausado. Compra un pack para seguir enviando este mes.
                                            </p>
                                            <button
                                                onClick={() => setActiveTab('packs')}
                                                className="mt-2 inline-flex items-center gap-1.5 bg-red-500 text-white text-xs font-black uppercase tracking-widest px-3 py-1.5 rounded-lg hover:bg-red-600 transition-colors"
                                            >
                                                <Package className="w-3.5 h-3.5" /> Ver packs
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Stat counters */}
                        <div className="bg-white p-5 rounded-soft border border-silk-beige shadow-sm h-64 flex flex-col">
                            <h4 className="text-xs font-bold text-charcoal/50 uppercase tracking-widest mb-4">
                                Resumen de Envíos
                            </h4>
                            <div className="flex-1 flex items-center justify-center">
                                {isLoading ? <Loader2 className="w-6 h-6 animate-spin text-primary-500" /> : (
                                    activeTab === 'appointments' ? (
                                        <div className="flex w-full items-center justify-around">
                                            <div className="flex flex-col items-center gap-1">
                                                <span className="text-4xl font-black text-emerald-500">{sent}</span>
                                                <span className="text-[10px] font-bold uppercase tracking-widest text-charcoal/40">Enviados</span>
                                            </div>
                                            <div className="flex flex-col items-center gap-1">
                                                <span className="text-4xl font-black text-red-500">{failed}</span>
                                                <span className="text-[10px] font-bold uppercase tracking-widest text-charcoal/40">Fallidos</span>
                                            </div>
                                        </div>
                                    ) : (
                                        (() => {
                                            const mSent = medicalLogs.filter((l: any) => l.status === 'sent').length
                                            const mFailed = medicalLogs.filter((l: any) => l.status === 'failed').length
                                            const mPending = medicalLogs.filter((l: any) => l.status === 'pending').length
                                            return (
                                                <div className="flex w-full items-center justify-around">
                                                    <div className="flex flex-col items-center gap-1">
                                                        <span className="text-4xl font-black text-emerald-500">{medicalTab === 'history' ? mSent : mPending}</span>
                                                        <span className="text-[10px] font-bold uppercase tracking-widest text-charcoal/40">{medicalTab === 'history' ? 'Enviados' : 'Pendientes'}</span>
                                                    </div>
                                                    {medicalTab === 'history' && (
                                                        <div className="flex flex-col items-center gap-1">
                                                            <span className="text-4xl font-black text-red-500">{mFailed}</span>
                                                            <span className="text-[10px] font-bold uppercase tracking-widest text-charcoal/40">Fallidos</span>
                                                        </div>
                                                    )}
                                                </div>
                                            )
                                        })()
                                    )
                                )}
                            </div>
                        </div>

                        {/* Chart */}
                        <div className="bg-white p-5 rounded-soft border border-silk-beige shadow-sm h-64 flex flex-col">
                            <h4 className="text-xs font-bold text-charcoal/50 uppercase tracking-widest mb-4">
                                {activeTab === 'appointments' ? 'Envíos por Día' : 'Por Categoría'}
                            </h4>
                            <div className="flex-1 flex items-center justify-center">
                                {isLoading ? <Loader2 className="w-6 h-6 animate-spin text-primary-500" /> : (
                                    activeTab === 'appointments' ? (
                                        !chartData.area || chartData.area.length === 0 ? (
                                            <p className="text-sm text-charcoal/40 font-medium">Sin datos en este periodo</p>
                                        ) : (
                                            <ResponsiveContainer width="100%" height="100%">
                                                <AreaChart data={chartData.area} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                                    <defs>
                                                        <linearGradient id="colorEnviados" x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                                                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                                        </linearGradient>
                                                        <linearGradient id="colorFallidos" x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.8} />
                                                            <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                                                        </linearGradient>
                                                    </defs>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                                                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#888' }} />
                                                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#888' }} />
                                                    <RechartsTooltip />
                                                    <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                                                    <Area type="monotone" dataKey="enviados" name="Enviados" stroke="#10b981" fillOpacity={1} fill="url(#colorEnviados)" />
                                                    <Area type="monotone" dataKey="fallidos" name="Fallidos" stroke="#ef4444" fillOpacity={1} fill="url(#colorFallidos)" />
                                                </AreaChart>
                                            </ResponsiveContainer>
                                        )
                                    ) : (
                                        !chartData.bar || chartData.bar.length === 0 ? (
                                            <p className="text-sm text-charcoal/40 font-medium">Sin datos en este periodo</p>
                                        ) : (
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={chartData.bar} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                                                    <XAxis dataKey="type" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#888' }} />
                                                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#888' }} />
                                                    <RechartsTooltip />
                                                    <Bar dataKey="count" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        )
                                    )
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Logs Table */}
                    <div className="bg-white rounded-soft border border-silk-beige shadow-sm overflow-hidden">
                        <div className="p-4 sm:p-5 border-b border-silk-beige flex flex-col sm:flex-row sm:items-center justify-between bg-ivory/50 gap-3">
                            <h3 className="font-bold text-charcoal flex items-center gap-2">
                                <Activity className="w-4 h-4 text-amber-600" />
                                Registro de Envíos
                            </h3>
                            <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
                                {activeTab === 'medical' && (
                                    <div className="flex items-center p-0.5 bg-white sm:bg-transparent rounded-lg sm:rounded-none w-full sm:w-auto border sm:border-0 border-silk-beige">
                                        <button
                                            onClick={() => setMedicalTab('pending')}
                                            className={cn(
                                                "flex-1 sm:flex-initial text-[10px] font-bold uppercase px-3 py-1.5 rounded-md transition-colors tracking-widest text-center",
                                                medicalTab === 'pending' ? "bg-amber-100 text-amber-700" : "text-charcoal/40 hover:bg-white"
                                            )}
                                        >
                                            Pendientes
                                        </button>
                                        <button
                                            onClick={() => setMedicalTab('history')}
                                            className={cn(
                                                "flex-1 sm:flex-initial text-[10px] font-bold uppercase px-3 py-1.5 rounded-md transition-colors tracking-widest text-center",
                                                medicalTab === 'history' ? "bg-emerald-100 text-emerald-700" : "text-charcoal/40 hover:bg-white"
                                            )}
                                        >
                                            Enviados/Fallidos
                                        </button>
                                    </div>
                                )}
                                <button onClick={fetchLogs} className="p-2 text-charcoal/40 hover:text-amber-600 transition-colors rounded-lg hover:bg-white border border-transparent sm:border-0">
                                    <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
                                </button>
                            </div>
                        </div>

                        <div className="overflow-x-auto min-h-[300px]">
                            {isLoading ? (
                                <div className="py-20 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary-500" /></div>
                            ) : (
                                (activeTab === 'appointments' ? appointmentLogs : medicalLogs).length === 0 ? (
                                    <div className="py-20 text-center">
                                        <div className="w-16 h-16 bg-silk-beige/30 rounded-full flex items-center justify-center mx-auto mb-4">
                                            <AlarmClock className="w-8 h-8 text-charcoal/20" />
                                        </div>
                                        <p className="text-charcoal/50 font-medium">Sin actividad en este periodo</p>
                                        <p className="text-charcoal/40 text-xs mt-1">Los recordatorios enviados aparecerán aquí.</p>
                                    </div>
                                ) : (
                                    <table className="w-full text-left">
                                        <thead>
                                            <tr className="border-b border-silk-beige text-[11px] uppercase tracking-wider text-charcoal/40 font-bold bg-white">
                                                <th className="px-4 sm:px-6 py-3 sm:py-4">Paciente / Destino</th>
                                                <th className="px-4 sm:px-6 py-3 sm:py-4">Tipo</th>
                                                <th className="px-4 sm:px-6 py-3 sm:py-4">Estado</th>
                                                <th className="px-4 sm:px-6 py-3 sm:py-4 text-right">Fecha</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-silk-beige/50 bg-white">
                                            {(activeTab === 'appointments' ? appointmentLogs : medicalLogs).map((log, i) => (
                                                <tr key={log.id || i} className="hover:bg-ivory/30 transition-colors">
                                                    <td className="px-4 sm:px-6 py-3 sm:py-4">
                                                        <div className="flex flex-col gap-0.5">
                                                            {activeTab === 'appointments' ? (
                                                                <>
                                                                    <span className="font-bold text-charcoal text-sm">{log.appointments?.patient_name || 'Paciente'}</span>
                                                                    {log.appointments?.tutor_name && (
                                                                        <span className="text-xs text-charcoal/40">Tutor: {log.appointments.tutor_name}</span>
                                                                    )}
                                                                    <span className="text-xs text-charcoal/50 flex items-center gap-1">
                                                                        <Phone className="w-3 h-3" />
                                                                        {log.phone_number || 'Sin número'}
                                                                    </span>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    {log.patients?.id ? (
                                                                        <Link to={`/app/patients/${log.patients.id}`} className="font-bold text-charcoal text-sm hover:text-amber-600 transition-colors hover:underline underline-offset-2">
                                                                            {log.patients.name || log.title || 'Paciente'}
                                                                        </Link>
                                                                    ) : (
                                                                        <span className="font-bold text-charcoal text-sm">{log.patients?.name || log.title || 'Paciente'}</span>
                                                                    )}
                                                                    {log.patients?.tutor_id ? (
                                                                        <Link to={`/app/tutors/${log.patients.tutor_id}`} className="text-xs text-charcoal/40 hover:text-amber-600 transition-colors">
                                                                            Tutor: {log.patients?.tutors?.name || '-'}
                                                                        </Link>
                                                                    ) : (
                                                                        <span className="text-xs text-charcoal/40">Tutor: {log.patients?.tutors?.name || '-'}</span>
                                                                    )}
                                                                    <span className="text-xs text-charcoal/50 flex items-center gap-1">
                                                                        <Phone className="w-3 h-3" />
                                                                        {log.phone_number || log.patients?.tutors?.phone_number || 'Sin número'}
                                                                    </span>
                                                                </>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 sm:px-6 py-3 sm:py-4">
                                                        <span className={cn(
                                                            "text-[10px] font-bold px-2.5 py-1 rounded-sm uppercase tracking-widest",
                                                            log.type === '24h' && "bg-amber-100 text-amber-700",
                                                            log.type === '2h' && "bg-blue-100 text-blue-700",
                                                            log.type === 'confirmation' && "bg-emerald-100 text-emerald-700",
                                                            log.type === 'vaccine' && "bg-purple-100 text-purple-700",
                                                            log.type === 'deworming' && "bg-orange-100 text-orange-700",
                                                            !['24h', '2h', 'confirmation', 'vaccine', 'deworming'].includes(log.type) && "bg-silk-beige/50 text-charcoal/60"
                                                        )}>
                                                            {log.type === 'vaccine' ? 'Vacuna' : log.type === 'deworming' ? 'Desparasitación' : log.type}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 sm:px-6 py-3 sm:py-4">
                                                        <div className="flex items-center gap-2">
                                                            {log.status === 'sent' ? (
                                                                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                                                            ) : log.status === 'pending' ? (
                                                                <Loader2 className="w-4 h-4 text-amber-500" />
                                                            ) : (
                                                                <AlertCircle className="w-4 h-4 text-red-500" />
                                                            )}
                                                            <span className={cn(
                                                                "text-xs font-bold uppercase tracking-wider",
                                                                log.status === 'sent' ? "text-emerald-700" : log.status === 'pending' ? "text-amber-700" : "text-red-700"
                                                            )}>
                                                                {log.status === 'sent' ? 'Enviado' : log.status === 'pending' ? 'Pendiente' : 'Fallido'}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 sm:px-6 py-3 sm:py-4 text-right">
                                                        <div className="flex flex-col items-end">
                                                            <span className="text-sm font-medium text-charcoal">
                                                                {new Date(activeTab === 'medical' && log.scheduled_date ? log.scheduled_date + 'T12:00:00' : (log.sent_at || log.created_at || log.scheduled_date)).toLocaleDateString('es-ES')}
                                                            </span>
                                                            <span className="text-[11px] text-charcoal/40 font-bold uppercase">
                                                                {activeTab === 'medical' && log.scheduled_date
                                                                    ? new Date(log.scheduled_date + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'short' })
                                                                    : new Date(log.sent_at || log.created_at || log.scheduled_date).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                                                            </span>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )
                            )}
                        </div>
                    </div>
                </div>
            </div>
            )}
        </div>
    )
}
