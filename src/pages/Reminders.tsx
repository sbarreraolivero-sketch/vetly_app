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
import { Link } from 'react-router-dom'

type TabType = 'appointments' | 'medical' | 'packs'
type DateRange = 'today' | 'week' | 'month' | 'all'

export default function Reminders() {
    const { profile } = useAuth()
    const [activeTab, setActiveTab] = useState<TabType>('appointments')
    const [planLoading, setPlanLoading] = useState<boolean>(true)
    const [medicalTab, setMedicalTab] = useState<'pending' | 'history'>('pending')
    const [dateRange, setDateRange] = useState<DateRange>('week')
    const [isLoading, setIsLoading] = useState(true)
    const [savingSettings, setSavingSettings] = useState(false)

    const [settings, setSettings] = useState<any>(null)
    const [appointmentLogs, setAppointmentLogs] = useState<any[]>([])
    const [medicalLogs, setMedicalLogs] = useState<any[]>([])

    // Settings fetch — only re-runs when clinic changes
    useEffect(() => {
        if (!profile?.clinic_id) return
        const fetchSettings = async () => {
            const [{ data: clinicSettings }, { data: reminderData }] = await Promise.all([
                supabase.from('clinic_settings').select('*').eq('id', profile.clinic_id).single(),
                supabase.from('reminder_settings').select('*').eq('clinic_id', profile.clinic_id).single(),
            ])
            setSettings({ ...(clinicSettings || {}), ...(reminderData || {}) })
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
                    // Próximos en cola: solo pending con scheduled_date >= hoy, orden ascendente (más cercano primero)
                    query = query
                        .eq('status', 'pending')
                        .gte('scheduled_date', todayStr)
                        .order('scheduled_date', { ascending: true })
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
    const PACKS = [
        { name: 'Pack Básico', count: 50, priceCLP: 5000, priceUSD: 5, desc: 'Ideal para meses con mayor actividad' },
        { name: 'Pack Pro', count: 200, priceCLP: 15000, priceUSD: 15, desc: 'Para clínicas con alto volumen de citas', popular: true },
        { name: 'Pack Ilimitado', count: -1, priceCLP: 25000, priceUSD: 25, desc: 'Sin límite durante el mes actual' },
    ]

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
                            <option value="today">Hoy</option>
                            <option value="week">Últimos 7 días</option>
                            <option value="month">Últimos 30 días</option>
                            <option value="all">Todos</option>
                        </select>
                    </div>
                )}
            </div>

            {/* Packs Tab Content */}
            {activeTab === 'packs' && (
                <div className="bg-white rounded-soft border border-silk-beige shadow-sm overflow-hidden">
                    <div className="bg-gradient-to-br from-primary-500 to-primary-700 p-5 sm:p-6 text-white">
                        <p className="text-xs font-black uppercase tracking-widest text-primary-200 mb-1">Add-ons</p>
                        <h3 className="text-lg sm:text-xl font-extrabold tracking-tight text-white">Packs de Recordatorios</h3>
                        <p className="text-sm text-primary-100 font-light mt-1">Amplía la capacidad mensual de recordatorios de tu plan.</p>
                    </div>
                    <div className="p-5 sm:p-8">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 items-stretch">
                            {PACKS.map((pack) => (
                                <div key={pack.name} className={cn(
                                    "relative rounded-2xl border p-6 flex flex-col gap-4",
                                    pack.popular ? "border-primary-300 bg-primary-50 shadow-sm" : "border-silk-beige bg-ivory"
                                )}>
                                    {pack.popular && (
                                        <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary-500 text-white text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full shadow-sm whitespace-nowrap">
                                            Más popular
                                        </span>
                                    )}
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <p className="font-black text-charcoal text-base">{pack.name}</p>
                                            <p className="text-xs text-charcoal/50 mt-1 leading-snug">{pack.desc}</p>
                                        </div>
                                        <div className={cn(
                                            "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                                            pack.popular ? "bg-primary-100" : "bg-white border border-silk-beige"
                                        )}>
                                            <Package className={cn("w-5 h-5", pack.popular ? "text-primary-600" : "text-charcoal/40")} />
                                        </div>
                                    </div>
                                    <div className="py-4 border-y border-silk-beige">
                                        <p className="text-4xl font-black text-charcoal flex items-baseline gap-1">
                                            {pack.count === -1 ? <InfinityIcon className="w-9 h-9" /> : pack.count}
                                            <span className="text-xs font-bold text-charcoal/40">recordatorios</span>
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xl font-black text-charcoal">${pack.priceCLP.toLocaleString()} <span className="text-xs font-bold text-charcoal/40">CLP</span></p>
                                        <p className="text-xs text-charcoal/40 mt-0.5">US${pack.priceUSD} USD</p>
                                    </div>
                                    <Link
                                        to="/app/settings?tab=subscription"
                                        className={cn(
                                            "mt-auto text-center py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all",
                                            pack.popular
                                                ? "bg-primary-500 text-white hover:bg-primary-600"
                                                : "bg-accent-500 text-white hover:bg-accent-600"
                                        )}
                                    >
                                        Agregar Pack
                                    </Link>
                                </div>
                            ))}
                        </div>
                        <p className="text-xs text-charcoal/40 text-center mt-6">Los packs son de un solo uso y se aplican al mes en curso. Gestiónalos desde Configuración → Plan.</p>
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
                                                                {new Date(log.sent_at || log.created_at || log.scheduled_date).toLocaleDateString('es-ES')}
                                                            </span>
                                                            <span className="text-[11px] text-charcoal/40 font-bold uppercase">
                                                                {new Date(log.sent_at || log.created_at || log.scheduled_date).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
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
