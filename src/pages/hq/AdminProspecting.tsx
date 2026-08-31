import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
    Search, Loader2, RefreshCw, Sparkles, Mail, MailOpen, Check, X,
    ChevronDown, ChevronUp, Pause, Play, Globe, MapPin, Phone, ArrowUpRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface ProspectingLead {
    id: string
    created_at: string
    name: string
    website: string | null
    email: string | null
    phone: string | null
    address: string | null
    country: string
    city: string
    prospect_type: string | null
    score: number
    problems: string[] | null
    has_https: boolean | null
    contact_status: 'sin_contactar' | 'en_revision' | 'listo_para_enviar' | 'email_enviado' | 'respondio' | 'descartado' | 'en_pipeline'
    email_subject: string | null
    email_body: string | null
    email_sent_at: string | null
    email_opened_at: string | null
    crm_prospect_id: string | null
    notes: string | null
}

interface ProspectingStats {
    total: number
    sin_contactar: number
    en_revision: number
    listo_para_enviar: number
    email_enviado: number
    respondio: number
    en_pipeline: number
    descartado: number
    con_apertura: number
}

interface CampaignConfig {
    started_at: string
    max_daily_cap: number
    is_paused: boolean
}

// Mismo bloque (tarjeta de presentación: foto + nombre + WhatsApp/email/web)
// que agrega cron-hq-prospecting-campaign al enviar de verdad
// (renderProspectingHtml/SIGNATURE_HTML) — se duplica acá solo para que el
// preview de revisión muestre exactamente lo que va a salir. Si se cambia
// uno, cambiar el otro.
const SIGNATURE_PREVIEW_HTML = `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:28px;border:1px solid #E4E4E7;border-radius:12px;">
  <tr>
    <td style="padding:16px;">
      <table role="presentation" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding-right:14px;vertical-align:middle;">
            <img src="https://vetly.pro/foto-sebastian-firma.png" width="56" height="56" alt="Sebastián Barrera" style="display:block;width:56px;height:56px;border-radius:50%;object-fit:cover;" />
          </td>
          <td style="vertical-align:middle;">
            <p style="margin:0 0 2px 0;font-size:15px;font-weight:bold;color:#18181b;font-family:Arial,sans-serif;">Sebastián Barrera</p>
            <p style="margin:0 0 8px 0;font-size:12px;color:#71717a;font-family:Arial,sans-serif;">Fundador · Vetly</p>
            <p style="margin:0;font-size:12px;color:#3f3f46;font-family:Arial,sans-serif;line-height:1.7;">
              <a href="https://wa.me/56993089185" style="color:#2563eb;text-decoration:none;">WhatsApp</a>
              &nbsp;·&nbsp;
              <a href="mailto:sebastian@mail.vetly.pro" style="color:#2563eb;text-decoration:none;">sebastian@mail.vetly.pro</a>
              &nbsp;·&nbsp;
              <a href="https://vetly.pro" style="color:#2563eb;text-decoration:none;">vetly.pro</a>
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
    sin_contactar: { label: 'Sin contactar', className: 'bg-gray-100 text-gray-600 border-gray-200' },
    en_revision: { label: 'En revisión', className: 'bg-amber-50 text-amber-700 border-amber-200' },
    listo_para_enviar: { label: 'Listo para enviar', className: 'bg-sky-50 text-sky-700 border-sky-200' },
    email_enviado: { label: 'Enviado', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    respondio: { label: 'Respondió', className: 'bg-violet-50 text-violet-700 border-violet-200' },
    en_pipeline: { label: 'En CRM', className: 'bg-primary-50 text-primary-700 border-primary-200' },
    descartado: { label: 'Descartado', className: 'bg-red-50 text-red-600 border-red-200' },
}

function currentWeek(startedAt: string): number {
    const weeks = Math.floor((Date.now() - new Date(startedAt).getTime()) / (7 * 24 * 60 * 60 * 1000))
    return Math.max(1, weeks + 1)
}

function dailyCapFor(startedAt: string, maxCap: number): number {
    const weeksElapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / (7 * 24 * 60 * 60 * 1000))
    return Math.min(5 * Math.pow(2, Math.max(0, weeksElapsed)), maxCap)
}

export default function AdminProspecting() {
    const [leads, setLeads] = useState<ProspectingLead[]>([])
    const [stats, setStats] = useState<ProspectingStats | null>(null)
    const [config, setConfig] = useState<CampaignConfig | null>(null)
    const [loading, setLoading] = useState(true)

    const [countryFilter, setCountryFilter] = useState('todos')
    const [statusFilter, setStatusFilter] = useState('todos')
    const [expandedId, setExpandedId] = useState<string | null>(null)

    const [discoverCountry, setDiscoverCountry] = useState('Chile')
    const [discoverCity, setDiscoverCity] = useState('')
    const [discoverNiche, setDiscoverNiche] = useState('veterinaria')
    const [discovering, setDiscovering] = useState(false)
    const [discoverResult, setDiscoverResult] = useState<string | null>(null)

    const [generatingId, setGeneratingId] = useState<string | null>(null)
    const [savingId, setSavingId] = useState<string | null>(null)
    const [editSubject, setEditSubject] = useState('')
    const [editBody, setEditBody] = useState('')
    const [togglingPause, setTogglingPause] = useState(false)

    const load = useCallback(async () => {
        setLoading(true)
        const [leadsRes, statsRes, configRes] = await Promise.all([
            (supabase as any).rpc('get_prospecting_leads'),
            (supabase as any).rpc('get_prospecting_stats'),
            (supabase as any).rpc('get_prospecting_campaign_config'),
        ])
        setLeads(leadsRes.data || [])
        setStats(statsRes.data?.[0] || null)
        setConfig(configRes.data || null)
        setLoading(false)
    }, [])

    useEffect(() => { load() }, [load])

    async function handleDiscover() {
        if (!discoverCity.trim()) { alert('Ingresa una ciudad'); return }
        setDiscovering(true)
        setDiscoverResult(null)
        try {
            const { data, error } = await supabase.functions.invoke('hq-discover-prospects', {
                body: { country: discoverCountry, city: discoverCity.trim(), niche: discoverNiche, limit: 15 },
            })
            if (error) throw error
            if (data?.places_available === false) {
                setDiscoverResult(`Places API no disponible (${data.reason}). Hace falta el método manual dirigido.`)
            } else {
                setDiscoverResult(
                    `${data.inserted} clínicas nuevas cargadas de ${data.found} encontradas` +
                    (data.skipped_existing ? ` · ${data.skipped_existing} ya existían` : '') +
                    (data.skipped_hospital ? ` · ${data.skipped_hospital} excluidas (hospital)` : '') +
                    (data.skipped_no_contact ? ` · ${data.skipped_no_contact} sin email` : '') +
                    (data.skipped_low_score ? ` · ${data.skipped_low_score} descartadas (score <40)` : '')
                )
            }
            load()
        } catch (err: any) {
            setDiscoverResult('Error: ' + (err.message || 'desconocido'))
        } finally {
            setDiscovering(false)
        }
    }

    async function handleGenerateEmail(id: string) {
        setGeneratingId(id)
        try {
            const { error } = await supabase.functions.invoke('hq-generate-prospect-email', { body: { prospect_id: id } })
            if (error) throw error
            load()
        } catch (err: any) {
            alert('Error generando correo: ' + (err.message || 'desconocido'))
        } finally {
            setGeneratingId(null)
        }
    }

    function startEditing(lead: ProspectingLead) {
        setExpandedId(lead.id)
        setEditSubject(lead.email_subject || '')
        setEditBody(lead.email_body || '')
    }

    async function handleSaveAndApprove(id: string, approve: boolean) {
        setSavingId(id)
        try {
            const { error } = await (supabase as any).rpc('update_prospecting_lead', {
                p_id: id,
                p_contact_status: approve ? 'listo_para_enviar' : null,
                p_email_subject: editSubject,
                p_email_body: editBody,
            })
            if (error) throw error
            setExpandedId(null)
            load()
        } catch (err: any) {
            alert('Error: ' + (err.message || 'desconocido'))
        } finally {
            setSavingId(null)
        }
    }

    async function handleDiscard(id: string) {
        if (!confirm('¿Descartar este prospecto? No se le enviará ningún correo.')) return
        await (supabase as any).rpc('update_prospecting_lead', { p_id: id, p_contact_status: 'descartado' })
        load()
    }

    async function handlePromote(id: string) {
        if (!confirm('¿Promover a CRM Prospectos? Aparecerá en /hq/crm como una conversación real.')) return
        const { error } = await (supabase as any).rpc('promote_prospecting_lead_to_crm', { p_id: id })
        if (error) { alert('Error: ' + error.message); return }
        load()
    }

    async function handleTogglePause() {
        if (!config) return
        const next = !config.is_paused
        if (next === false && !confirm(
            `¿Activar el envío automático?\n\nDesde ahora el cron diario mandará correos reales a los prospectos en "Listo para enviar" — cuota de hoy: ${dailyCapFor(config.started_at, config.max_daily_cap)}/día.`
        )) return
        setTogglingPause(true)
        try {
            const { data, error } = await (supabase as any).rpc('set_prospecting_campaign_paused', { p_paused: next })
            if (error) throw error
            setConfig(data)
        } catch (err: any) {
            alert('Error: ' + (err.message || 'desconocido'))
        } finally {
            setTogglingPause(false)
        }
    }

    const countries = ['todos', ...Array.from(new Set(leads.map(l => l.country)))]
    const visible = leads.filter(l => {
        if (countryFilter !== 'todos' && l.country !== countryFilter) return false
        if (statusFilter !== 'todos' && l.contact_status !== statusFilter) return false
        return true
    })

    if (loading) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-20">
                <Loader2 className="w-10 h-10 animate-spin text-primary-500 mb-4" />
                <p className="text-gray-500 font-bold tracking-tight">Cargando prospección...</p>
            </div>
        )
    }

    return (
        <div className="p-4 lg:p-8 space-y-6 max-w-6xl mx-auto">
            {/* Banner */}
            <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-[2rem] px-6 py-5 text-white shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-1/3 h-full bg-primary-500/10 blur-[80px] -z-0" />
                <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <span className="px-2.5 py-0.5 bg-primary-500/20 text-primary-400 text-[9px] font-black uppercase tracking-widest rounded-full border border-primary-500/30 mb-2 inline-block">HQ Exclusive</span>
                        <h1 className="text-2xl font-black tracking-tight text-white leading-none">Prospección</h1>
                        <p className="text-gray-400 font-medium text-xs mt-1">
                            Clínicas veterinarias descubiertas + campaña de correo con rampa progresiva
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        {config && (
                            <div className="text-right">
                                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Cuota de hoy</p>
                                <p className="text-lg font-black text-white leading-none">{dailyCapFor(config.started_at, config.max_daily_cap)}/día · sem. {currentWeek(config.started_at)}</p>
                            </div>
                        )}
                        <button
                            onClick={handleTogglePause}
                            disabled={togglingPause}
                            className={cn(
                                "flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                                config?.is_paused ? "bg-emerald-500 text-white hover:bg-emerald-600" : "bg-red-500/90 text-white hover:bg-red-600"
                            )}
                        >
                            {togglingPause ? <Loader2 className="w-4 h-4 animate-spin" /> : config?.is_paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                            {config?.is_paused ? 'Campaña pausada' : 'Campaña activa'}
                        </button>
                        <button onClick={load} className="p-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all text-white/60 hover:text-white">
                            <RefreshCw className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>

            {/* KPIs */}
            {stats && (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                    {[
                        { label: 'Total', value: stats.total },
                        { label: 'Sin contactar', value: stats.sin_contactar },
                        { label: 'En revisión', value: stats.en_revision },
                        { label: 'Listos', value: stats.listo_para_enviar },
                        { label: 'Enviados', value: stats.email_enviado },
                        { label: 'Abiertos', value: stats.con_apertura },
                        { label: 'En CRM', value: stats.en_pipeline },
                    ].map(kpi => (
                        <div key={kpi.label} className="bg-white rounded-2xl border border-gray-100 p-4 text-center shadow-sm">
                            <p className="text-2xl font-black text-gray-900 leading-none">{kpi.value}</p>
                            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mt-1">{kpi.label}</p>
                        </div>
                    ))}
                </div>
            )}

            {/* Buscar más */}
            <div className="bg-white rounded-[2rem] border border-gray-100 p-6 shadow-sm space-y-4">
                <h3 className="text-sm font-black text-gray-900 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-primary-500" /> Buscar más clínicas
                </h3>
                <div className="flex flex-col sm:flex-row gap-3">
                    <input value={discoverCountry} onChange={e => setDiscoverCountry(e.target.value)} placeholder="País"
                        className="flex-1 bg-gray-50 rounded-xl px-4 py-3 text-sm font-bold outline-none border-none focus:ring-2 focus:ring-primary-500/20" />
                    <input value={discoverCity} onChange={e => setDiscoverCity(e.target.value)} placeholder="Ciudad (ej. Puerto Montt)"
                        className="flex-1 bg-gray-50 rounded-xl px-4 py-3 text-sm font-bold outline-none border-none focus:ring-2 focus:ring-primary-500/20" />
                    <input value={discoverNiche} onChange={e => setDiscoverNiche(e.target.value)} placeholder="Rubro"
                        className="flex-1 bg-gray-50 rounded-xl px-4 py-3 text-sm font-bold outline-none border-none focus:ring-2 focus:ring-primary-500/20" />
                    <button onClick={handleDiscover} disabled={discovering}
                        className="bg-gray-900 text-white px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-primary-600 transition-all disabled:bg-gray-300 flex items-center gap-2 justify-center">
                        {discovering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                        Buscar
                    </button>
                </div>
                {discoverResult && <p className="text-xs font-bold text-gray-600">{discoverResult}</p>}
                <p className="text-[10px] text-gray-400">
                    Recuerda la regla de cobertura por ciudad: agota los prospectos de una ciudad antes de buscar en la siguiente del mismo país — el cron manda siempre el más antiguo primero, así que una ciudad nueva se suma a la cola, no la salta.
                </p>
            </div>

            {/* Filtros */}
            <div className="flex flex-wrap gap-3">
                <select value={countryFilter} onChange={e => setCountryFilter(e.target.value)}
                    className="px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-[10px] font-black uppercase tracking-widest outline-none cursor-pointer">
                    {countries.map(c => <option key={c} value={c}>{c === 'todos' ? 'Todos los países' : c}</option>)}
                </select>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                    className="px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-[10px] font-black uppercase tracking-widest outline-none cursor-pointer">
                    <option value="todos">Todos los estados</option>
                    {Object.entries(STATUS_LABEL).map(([key, v]) => <option key={key} value={key}>{v.label}</option>)}
                </select>
            </div>

            {/* Lista de leads */}
            <div className="space-y-3">
                {visible.length === 0 && (
                    <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center text-gray-400 font-bold text-sm">
                        Sin prospectos {statusFilter !== 'todos' || countryFilter !== 'todos' ? 'con estos filtros' : 'todavía — busca la primera ciudad arriba'}
                    </div>
                )}
                {visible.map(lead => {
                    const isExpanded = expandedId === lead.id
                    const status = STATUS_LABEL[lead.contact_status]
                    return (
                        <div key={lead.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                            <div className="p-5 flex items-start justify-between gap-4">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                                        <h4 className="text-sm font-black text-gray-900 truncate">{lead.name}</h4>
                                        <span className={cn("px-2 py-0.5 rounded-full text-[9px] font-black border uppercase tracking-wide", status.className)}>{status.label}</span>
                                        <span className={cn(
                                            "px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wide",
                                            lead.score >= 70 ? "bg-emerald-50 text-emerald-700" : lead.score >= 40 ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-500"
                                        )}>Score {lead.score}</span>
                                        {lead.email_opened_at && <span className="flex items-center gap-1 text-[9px] font-black text-violet-600"><MailOpen className="w-3 h-3" /> Abierto</span>}
                                    </div>
                                    <div className="flex items-center gap-3 text-[11px] text-gray-500 font-medium flex-wrap">
                                        <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {lead.city}, {lead.country}</span>
                                        {lead.prospect_type && <span>{lead.prospect_type}</span>}
                                        {lead.website && <a href={lead.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-sky-600 hover:underline"><Globe className="w-3 h-3" /> Web</a>}
                                        {lead.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {lead.phone}</span>}
                                    </div>
                                    {lead.problems && lead.problems.length > 0 && (
                                        <ul className="mt-2 space-y-0.5">
                                            {lead.problems.map((p, i) => (
                                                <li key={i} className="text-[11px] text-violet-700 flex items-start gap-1.5">
                                                    <span className="text-violet-300 mt-0.5">•</span> {p}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    {lead.contact_status === 'sin_contactar' && (
                                        <button onClick={() => handleGenerateEmail(lead.id)} disabled={generatingId === lead.id}
                                            className="flex items-center gap-1.5 bg-gray-900 text-white px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-wide hover:bg-primary-600 disabled:bg-gray-300">
                                            {generatingId === lead.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                                            Generar correo
                                        </button>
                                    )}
                                    {(lead.contact_status === 'en_revision' || lead.contact_status === 'listo_para_enviar') && (
                                        <button onClick={() => isExpanded ? setExpandedId(null) : startEditing(lead)}
                                            className="flex items-center gap-1.5 bg-sky-50 text-sky-700 px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-wide hover:bg-sky-100">
                                            <Mail className="w-3.5 h-3.5" /> Revisar
                                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                        </button>
                                    )}
                                    {lead.contact_status === 'email_enviado' && (
                                        <button onClick={() => handlePromote(lead.id)}
                                            className="flex items-center gap-1.5 bg-primary-50 text-primary-700 px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-wide hover:bg-primary-100">
                                            <ArrowUpRight className="w-3.5 h-3.5" /> Promover a CRM
                                        </button>
                                    )}
                                    {lead.contact_status !== 'descartado' && lead.contact_status !== 'en_pipeline' && (
                                        <button onClick={() => handleDiscard(lead.id)} className="p-2 text-gray-300 hover:text-red-500 transition-colors">
                                            <X className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>
                            </div>

                            {isExpanded && (
                                <div className="border-t border-gray-100 p-5 bg-gray-50 space-y-3">
                                    <input value={editSubject} onChange={e => setEditSubject(e.target.value)} placeholder="Asunto"
                                        className="w-full bg-white rounded-xl px-4 py-3 text-sm font-bold outline-none border border-gray-200 focus:ring-2 focus:ring-primary-500/20" />
                                    <textarea value={editBody} onChange={e => setEditBody(e.target.value)} rows={10} placeholder="Cuerpo (HTML)"
                                        className="w-full bg-white rounded-xl px-4 py-3 text-xs font-mono outline-none border border-gray-200 focus:ring-2 focus:ring-primary-500/20" />
                                    <div dangerouslySetInnerHTML={{ __html: editBody + SIGNATURE_PREVIEW_HTML }} className="bg-white rounded-xl p-4 border border-gray-200 text-sm" />
                                    <div className="flex items-center gap-3 justify-end">
                                        <button onClick={() => setExpandedId(null)} className="px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-600">
                                            Cancelar
                                        </button>
                                        <button onClick={() => handleSaveAndApprove(lead.id, false)} disabled={savingId === lead.id}
                                            className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-gray-200 disabled:opacity-50">
                                            Guardar borrador
                                        </button>
                                        <button onClick={() => handleSaveAndApprove(lead.id, true)} disabled={savingId === lead.id}
                                            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-600 disabled:opacity-50">
                                            {savingId === lead.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                            Aprobar y encolar
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
