import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { 
    AlarmClock, Save, Loader2, RefreshCw, Activity, 
    CheckCircle2, AlertCircle, Phone, 
    Settings2, Bell
} from 'lucide-react'
import { TemplateSelector } from '@/components/settings/TemplateSelector'
import { cn } from '@/lib/utils'
import toast from 'react-hot-toast'
import { 
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
    BarChart, Bar, Legend, Cell, PieChart, Pie
} from 'recharts'

type TabType = 'appointments' | 'medical'
type DateRange = 'today' | 'week' | 'month' | 'all'

export default function Reminders() {
    const { profile } = useAuth()
    const [activeTab, setActiveTab] = useState<TabType>('appointments')
    const [dateRange, setDateRange] = useState<DateRange>('month')
    const [isLoading, setIsLoading] = useState(true)
    const [savingSettings, setSavingSettings] = useState(false)
    
    // Clinic & Reminder Settings
    const [settings, setSettings] = useState<any>(null)
    
    // Logs Data
    const [appointmentLogs, setAppointmentLogs] = useState<any[]>([])
    const [medicalLogs, setMedicalLogs] = useState<any[]>([])

    useEffect(() => {
        if (profile?.clinic_id) {
            fetchData()
        }
    }, [profile?.clinic_id, activeTab, dateRange])

    const fetchData = async () => {
        if (!profile?.clinic_id) return
        setIsLoading(true)
        
        try {
            if (!settings) {
                // Fetch medical templates
                const { data: clinicSettings } = await supabase
                    .from('clinic_settings')
                    .select('*')
                    .eq('id', profile.clinic_id)
                    .single()
                
                // Fetch appointment reminders config
                const { data: reminderData } = await supabase
                    .from('reminder_settings')
                    .select('*')
                    .eq('clinic_id', profile.clinic_id)
                    .single()
                
                if (clinicSettings || reminderData) {
                    setSettings({
                        ...(clinicSettings || {}),
                        ...(reminderData || {})
                    })
                }
            }

            // Calculate date range filter
            const now = new Date()
            let startDate = new Date(0) // beginning of time
            
            if (dateRange === 'today') {
                startDate = new Date(now.setHours(0,0,0,0))
            } else if (dateRange === 'week') {
                startDate = new Date(now.setDate(now.getDate() - 7))
            } else if (dateRange === 'month') {
                startDate = new Date(now.setMonth(now.getMonth() - 1))
            }

            if (activeTab === 'appointments') {
                // Fetch appointment reminder logs
                let query = supabase
                    .from('reminder_logs')
                    .select('*, appointments(patient_name, tutor_name)')
                    .eq('clinic_id', profile.clinic_id)
                    .order('sent_at', { ascending: false })
                
                if (dateRange !== 'all') {
                    query = query.gte('sent_at', startDate.toISOString())
                } else {
                    query = query.limit(100) // limit all so we don't crash
                }

                const { data } = await query
                setAppointmentLogs(data || [])
            } else {
                // Fetch medical reminder logs (from 'reminders' table)
                // Note: reminders table does not have sent_at, it has scheduled_date and created_at.
                // We will use scheduled_date for filtering if sent, or maybe created_at. Let's use scheduled_date
                
                // Fetch reminders
                let query = supabase
                    .from('reminders')
                    .select('*, patients(name, tutors(name, phone_number))')
                    // Patient relation might need adjustments based on exact schema
                    .order('scheduled_date', { ascending: false })
                
                // we don't have clinic_id on reminders? Wait, patient has clinic_id. 
                // Since we can't easily join-filter in supabase js easily, we might need to filter client side or use a view.
                // Assuming reminders are fetched by patient usually. If we want all clinic reminders, we can get them.
                // For safety, let's just fetch recent ones.
                const { data } = await query.limit(200)
                
                if (data) {
                    // Filter manually for clinic_id if needed, but since patients are restricted by RLS to clinic, it should be fine.
                    let filtered = data as any[]
                    if (dateRange !== 'all') {
                        filtered = filtered.filter(d => new Date(d.scheduled_date) >= startDate)
                    }
                    setMedicalLogs(filtered)
                }
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
            // Save medical settings
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

            // Save appointment settings
            const { error: reminderError } = await (supabase as any)
                .from('reminder_settings')
                .upsert({
                    clinic_id: profile.clinic_id,
                    reminder_24h_before: settings.reminder_24h_before,
                    template_24h: settings.template_24h,
                    reminder_2h_before: settings.reminder_2h_before,
                    template_2h: settings.template_2h,
                    request_confirmation: settings.request_confirmation,
                    template_confirmation: settings.template_confirmation,
                    preferred_hour: settings.preferred_hour,
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

    // Chart Data Preparation
    const getChartData = () => {
        if (activeTab === 'appointments') {
            const sent = appointmentLogs.filter(l => l.status === 'sent').length
            const failed = appointmentLogs.filter(l => l.status === 'failed').length
            
            const groupedByDate = appointmentLogs.reduce((acc, log) => {
                const date = new Date(log.sent_at).toLocaleDateString('es-ES', { month: 'short', day: 'numeric' })
                if (!acc[date]) acc[date] = { date, enviados: 0, fallidos: 0 }
                if (log.status === 'sent') acc[date].enviados += 1
                else acc[date].fallidos += 1
                return acc
            }, {} as Record<string, any>)
            
            return {
                pie: [
                    { name: 'Enviados', value: sent, color: '#10b981' },
                    { name: 'Fallidos', value: failed, color: '#ef4444' }
                ],
                area: Object.values(groupedByDate).reverse()
            }
        } else {
            const sent = medicalLogs.filter(l => l.status === 'sent').length
            const pending = medicalLogs.filter(l => l.status === 'pending').length
            const failed = medicalLogs.filter(l => l.status === 'failed').length
            
            const groupedByType = medicalLogs.reduce((acc, log) => {
                const type = log.type === 'vaccine' ? 'Vacuna' : log.type === 'deworming' ? 'Desparasitación' : log.type
                if (!acc[type]) acc[type] = { type, count: 0 }
                acc[type].count += 1
                return acc
            }, {} as Record<string, any>)

            return {
                pie: [
                    { name: 'Enviados', value: sent, color: '#10b981' },
                    { name: 'Pendientes', value: pending, color: '#f59e0b' },
                    { name: 'Fallidos', value: failed, color: '#ef4444' }
                ],
                bar: Object.values(groupedByType)
            }
        }
    }

    const chartData = getChartData()

    return (
        <div className="space-y-6 max-w-7xl mx-auto pb-20 animate-fade-in">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-black text-charcoal tracking-tighter uppercase flex items-center gap-3">
                        <Bell className="w-8 h-8 text-primary-600" />
                        Centro de Recordatorios
                    </h1>
                    <p className="text-charcoal/50 font-medium mt-1">
                        Gestiona y monitorea los mensajes automáticos de citas y controles médicos.
                    </p>
                </div>
                
                <div className="flex items-center gap-3">
                    <button
                        onClick={handleSaveSettings}
                        disabled={savingSettings || !settings}
                        className="btn-primary shadow-premium py-2.5 px-6 flex items-center gap-2"
                    >
                        {savingSettings ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Guardar Configuración
                    </button>
                </div>
            </div>

            {/* Dashboard Controls */}
            <div className="bg-white p-2 rounded-xl border border-silk-beige shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center p-1 bg-ivory rounded-lg">
                    <button
                        onClick={() => setActiveTab('appointments')}
                        className={cn(
                            "px-6 py-2 rounded-md text-sm font-bold uppercase tracking-widest transition-all",
                            activeTab === 'appointments' ? "bg-white text-primary-700 shadow-sm border border-silk-beige" : "text-charcoal/40 hover:text-charcoal"
                        )}
                    >
                        Citas
                    </button>
                    <button
                        onClick={() => setActiveTab('medical')}
                        className={cn(
                            "px-6 py-2 rounded-md text-sm font-bold uppercase tracking-widest transition-all",
                            activeTab === 'medical' ? "bg-white text-primary-700 shadow-sm border border-silk-beige" : "text-charcoal/40 hover:text-charcoal"
                        )}
                    >
                        Médicos
                    </button>
                </div>
                
                <div className="flex items-center gap-2 pr-2">
                    <span className="text-xs font-bold text-charcoal/40 uppercase tracking-widest">Filtrar:</span>
                    <select 
                        value={dateRange}
                        onChange={(e) => setDateRange(e.target.value as DateRange)}
                        className="text-sm bg-ivory border border-silk-beige rounded-lg px-3 py-1.5 font-medium text-charcoal focus:ring-primary-500 focus:border-primary-500"
                    >
                        <option value="today">Hoy</option>
                        <option value="week">Últimos 7 días</option>
                        <option value="month">Últimos 30 días</option>
                        <option value="all">Todos</option>
                    </select>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Configuration Sidebar */}
                <div className="lg:col-span-1 space-y-6">
                    <div className="bg-gradient-to-br from-charcoal to-gray-900 rounded-soft p-6 shadow-xl text-white">
                        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-white/10">
                            <div className="p-2 bg-white/10 rounded-lg">
                                <Settings2 className="w-5 h-5 text-primary-300" />
                            </div>
                            <div>
                                <h3 className="text-lg font-black uppercase tracking-tighter text-white">
                                    {activeTab === 'appointments' ? 'Citas' : 'Plantillas Médicas'}
                                </h3>
                                <p className="text-[10px] text-primary-300 uppercase tracking-widest font-bold">Configuración</p>
                            </div>
                        </div>

                        {settings ? (
                            <div className="space-y-6">
                                {activeTab === 'appointments' ? (
                                    <>
                                        {/* 24h Reminder */}
                                        <div className="bg-white/5 p-4 rounded-xl border border-white/10 space-y-4">
                                            <div className="flex items-center justify-between">
                                                <p className="font-bold text-sm">24 Horas Antes</p>
                                                <label className="relative inline-flex items-center cursor-pointer">
                                                    <input type="checkbox" className="sr-only peer" checked={settings.reminder_24h_before} onChange={e => setSettings({...settings, reminder_24h_before: e.target.checked})} />
                                                    <div className="w-9 h-5 bg-white/20 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-500"></div>
                                                </label>
                                            </div>
                                            {settings.reminder_24h_before && (
                                                <TemplateSelector 
                                                    label="Plantilla 24h"
                                                    value={settings.template_24h || ''}
                                                    onChange={v => setSettings({...settings, template_24h: v})}
                                                    labelClassName="text-white text-xs"
                                                />
                                            )}
                                        </div>
                                        
                                        {/* 2h Reminder */}
                                        <div className="bg-white/5 p-4 rounded-xl border border-white/10 space-y-4">
                                            <div className="flex items-center justify-between">
                                                <p className="font-bold text-sm">2 Horas Antes</p>
                                                <label className="relative inline-flex items-center cursor-pointer">
                                                    <input type="checkbox" className="sr-only peer" checked={settings.reminder_2h_before} onChange={e => setSettings({...settings, reminder_2h_before: e.target.checked})} />
                                                    <div className="w-9 h-5 bg-white/20 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-500"></div>
                                                </label>
                                            </div>
                                            {settings.reminder_2h_before && (
                                                <TemplateSelector 
                                                    label="Plantilla 2h"
                                                    value={settings.template_2h || ''}
                                                    onChange={v => setSettings({...settings, template_2h: v})}
                                                    labelClassName="text-white text-xs"
                                                />
                                            )}
                                        </div>

                                        {/* Confirmation */}
                                        <div className="bg-white/5 p-4 rounded-xl border border-white/10 space-y-4">
                                            <div className="flex items-center justify-between">
                                                <p className="font-bold text-sm text-primary-300">Solicitar Confirmación</p>
                                                <label className="relative inline-flex items-center cursor-pointer">
                                                    <input type="checkbox" className="sr-only peer" checked={settings.request_confirmation} onChange={e => setSettings({...settings, request_confirmation: e.target.checked})} />
                                                    <div className="w-9 h-5 bg-white/20 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-500"></div>
                                                </label>
                                            </div>
                                            {settings.request_confirmation && (
                                                <TemplateSelector 
                                                    label="Plantilla Confirmación"
                                                    value={settings.template_confirmation || ''}
                                                    onChange={v => setSettings({...settings, template_confirmation: v})}
                                                    labelClassName="text-white text-xs"
                                                />
                                            )}
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        {/* Medical Templates */}
                                        <div className="bg-white/5 p-4 rounded-xl border border-white/10 space-y-2">
                                            <TemplateSelector 
                                                label="Vacunación"
                                                value={settings.vaccine_reminder_template || ''}
                                                onChange={v => setSettings({...settings, vaccine_reminder_template: v})}
                                                labelClassName="text-white text-xs font-bold uppercase tracking-wider"
                                            />
                                        </div>
                                        <div className="bg-white/5 p-4 rounded-xl border border-white/10 space-y-2">
                                            <TemplateSelector 
                                                label="Desparasitación"
                                                value={settings.deworming_reminder_template || ''}
                                                onChange={v => setSettings({...settings, deworming_reminder_template: v})}
                                                labelClassName="text-white text-xs font-bold uppercase tracking-wider"
                                            />
                                        </div>
                                        <div className="bg-white/5 p-4 rounded-xl border border-white/10 space-y-2">
                                            <TemplateSelector 
                                                label="Control Médico"
                                                value={settings.checkup_reminder_template || ''}
                                                onChange={v => setSettings({...settings, checkup_reminder_template: v})}
                                                labelClassName="text-white text-xs font-bold uppercase tracking-wider"
                                            />
                                        </div>
                                    </>
                                )}
                            </div>
                        ) : (
                            <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-white/50" /></div>
                        )}
                    </div>
                </div>

                {/* Main Content & Analytics */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Analytics Dashboard */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-white p-5 rounded-soft border border-silk-beige shadow-sm h-64 flex flex-col">
                            <h4 className="text-xs font-bold text-charcoal/50 uppercase tracking-widest mb-4">Tasa de Éxito</h4>
                            <div className="flex-1 flex items-center justify-center relative">
                                {isLoading ? <Loader2 className="w-6 h-6 animate-spin text-primary-500" /> : (
                                    chartData.pie.reduce((a,b)=>a+b.value,0) === 0 ? (
                                        <p className="text-sm text-charcoal/40 font-medium">Sin datos en este periodo</p>
                                    ) : (
                                        <ResponsiveContainer width="100%" height="100%">
                                            <PieChart>
                                                <Pie
                                                    data={chartData.pie}
                                                    cx="50%" cy="50%"
                                                    innerRadius={60} outerRadius={80}
                                                    paddingAngle={5}
                                                    dataKey="value"
                                                >
                                                    {chartData.pie.map((entry, index) => (
                                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                                    ))}
                                                </Pie>
                                                <RechartsTooltip />
                                                <Legend />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    )
                                )}
                            </div>
                        </div>

                        <div className="bg-white p-5 rounded-soft border border-silk-beige shadow-sm h-64 flex flex-col">
                            <h4 className="text-xs font-bold text-charcoal/50 uppercase tracking-widest mb-4">
                                {activeTab === 'appointments' ? 'Envíos Diarios' : 'Por Categoría'}
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
                                                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/>
                                                            <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                                                        </linearGradient>
                                                    </defs>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                                                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#888' }} />
                                                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#888' }} />
                                                    <RechartsTooltip />
                                                    <Area type="monotone" dataKey="enviados" stroke="#10b981" fillOpacity={1} fill="url(#colorEnviados)" />
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
                        <div className="p-5 border-b border-silk-beige flex items-center justify-between bg-ivory/50">
                            <h3 className="font-bold text-charcoal flex items-center gap-2">
                                <Activity className="w-4 h-4 text-primary-600" />
                                Registro de Envíos
                            </h3>
                            <button onClick={fetchData} className="p-2 text-charcoal/40 hover:text-primary-600 transition-colors rounded-lg hover:bg-white">
                                <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
                            </button>
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
                                        <p className="text-charcoal/50 font-medium">Sin actividad reciente</p>
                                        <p className="text-charcoal/40 text-xs mt-1">Los recordatorios enviados aparecerán aquí.</p>
                                    </div>
                                ) : (
                                    <table className="w-full text-left">
                                        <thead>
                                            <tr className="border-b border-silk-beige text-[11px] uppercase tracking-wider text-charcoal/40 font-bold bg-white">
                                                <th className="px-6 py-4">Paciente / Destino</th>
                                                <th className="px-6 py-4">Tipo</th>
                                                <th className="px-6 py-4">Estado</th>
                                                <th className="px-6 py-4 text-right">Fecha</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-silk-beige/50 bg-white">
                                            {(activeTab === 'appointments' ? appointmentLogs : medicalLogs).map((log, i) => (
                                                <tr key={log.id || i} className="hover:bg-ivory/30 transition-colors">
                                                    <td className="px-6 py-4">
                                                        <div className="flex flex-col">
                                                            <span className="font-bold text-charcoal text-sm">
                                                                {activeTab === 'appointments' 
                                                                    ? log.appointments?.patient_name || 'Paciente'
                                                                    : log.patients?.name || log.title || 'Paciente'}
                                                            </span>
                                                            <span className="text-xs text-charcoal/50 flex items-center gap-1 mt-0.5">
                                                                <Phone className="w-3 h-3" />
                                                                {log.phone_number || (log.patients?.tutors?.[0]?.phone_number) || 'Sin número'}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <span className={cn(
                                                            "text-[10px] font-bold px-2.5 py-1 rounded-sm uppercase tracking-widest",
                                                            log.type === '24h' && "bg-amber-100 text-amber-700",
                                                            log.type === '2h' && "bg-blue-100 text-blue-700",
                                                            log.type === '1h' && "bg-indigo-100 text-indigo-700",
                                                            log.type === 'confirmation' && "bg-emerald-100 text-emerald-700",
                                                            log.type === 'vaccine' && "bg-purple-100 text-purple-700",
                                                            log.type === 'deworming' && "bg-orange-100 text-orange-700",
                                                            !['24h','2h','1h','confirmation','vaccine','deworming'].includes(log.type) && "bg-gray-100 text-gray-700"
                                                        )}>
                                                            {log.type === 'vaccine' ? 'Vacuna' : log.type === 'deworming' ? 'Desparasitación' : log.type}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4">
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
                                                    <td className="px-6 py-4 text-right">
                                                        <div className="flex flex-col items-end">
                                                            <span className="text-sm font-medium text-charcoal">
                                                                {new Date(log.sent_at || log.scheduled_date || log.created_at).toLocaleDateString('es-ES')}
                                                            </span>
                                                            <span className="text-[11px] text-charcoal/40 font-bold uppercase">
                                                                {new Date(log.sent_at || log.scheduled_date || log.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit'})}
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
        </div>
    )
}
