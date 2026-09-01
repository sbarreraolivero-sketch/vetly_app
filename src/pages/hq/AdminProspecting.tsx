import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
    Search, Loader2, RefreshCw, Sparkles, Mail, MailOpen, Check, X,
    ChevronDown, ChevronUp, Pause, Play, Globe, MapPin, Phone, ArrowUpRight, AlertCircle,
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
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:32px;width:100%;max-width:540px;border-radius:18px;overflow:hidden;border:1px solid #e4e4e7;">
  <tr>
    <td width="180" valign="top" style="background-color:#0d9488;background-image:linear-gradient(160deg,#0d9488,#0ea5e9);padding:30px 18px;text-align:center;">
      <img src="https://vetly.pro/foto-sebastian-firma.png" width="88" height="88" alt="Sebastián Barrera"
           style="display:block;width:88px;height:88px;margin:0 auto 14px auto;border-radius:50%;object-fit:cover;border:3px solid rgba(255,255,255,0.55);" />
      <p style="margin:0 0 4px 0;font-size:16px;font-weight:800;color:#ffffff;font-family:Arial,sans-serif;letter-spacing:-0.2px;">Sebastián Barrera</p>
      <p style="margin:0;font-size:11px;font-weight:700;color:#d1fae5;font-family:Arial,sans-serif;text-transform:uppercase;letter-spacing:0.6px;">Fundador · Vetly</p>
    </td>
    <td valign="top" style="background-color:#ffffff;padding:18px 20px 20px 20px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
        <tr>
          <td align="right" style="padding-bottom:4px;">
            <img src="https://vetly.pro/logo.png" width="38" height="38" alt="Vetly" style="display:inline-block;width:38px;height:38px;border-radius:50%;" />
          </td>
        </tr>
      </table>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
        <tr>
          <td width="30" style="padding:5px 0;vertical-align:middle;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="26" height="26" style="border-radius:50%;background-color:#0d9488;background-image:linear-gradient(135deg,#0d9488,#0ea5e9);">
              <tr><td align="center" valign="middle"><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE1IiBoZWlnaHQ9IjE1IiBmaWxsPSIjZmZmZmZmIj48cGF0aCBkPSJNMTcuNDcyIDE0LjM4MmMtLjI5Ny0uMTQ5LTEuNzU4LS44NjctMi4wMy0uOTY3LS4yNzMtLjA5OS0uNDcxLS4xNDgtLjY3LjE1LS4xOTcuMjk3LS43NjcuOTY2LS45NCAxLjE2NC0uMTczLjE5OS0uMzQ3LjIyMy0uNjQ0LjA3NS0uMjk3LS4xNS0xLjI1NS0uNDYzLTIuMzktMS40NzUtLjg4My0uNzg4LTEuNDgtMS43NjEtMS42NTMtMi4wNTktLjE3My0uMjk3LS4wMTgtLjQ1OC4xMy0uNjA2LjEzNC0uMTMzLjI5OC0uMzQ3LjQ0Ni0uNTIuMTQ5LS4xNzQuMTk4LS4yOTguMjk4LS40OTcuMDk5LS4xOTguMDUtLjM3MS0uMDI1LS41Mi0uMDc1LS4xNDktLjY2OS0xLjYxMi0uOTE2LTIuMjA3LS4yNDItLjU3OS0uNDg3LS41LS42NjktLjUxLS4xNzMtLjAwOC0uMzcxLS4wMS0uNTctLjAxLS4xOTggMC0uNTIuMDc0LS43OTIuMzcyLS4yNzIuMjk3LTEuMDQgMS4wMTYtMS4wNCAyLjQ3OSAwIDEuNDYyIDEuMDY1IDIuODc1IDEuMjEzIDMuMDc0LjE0OS4xOTggMi4wOTYgMy4yIDUuMDc3IDQuNDg3LjcwOS4zMDYgMS4yNjIuNDg5IDEuNjk0LjYyNS43MTIuMjI3IDEuMzYuMTk1IDEuODcxLjExOC41NzEtLjA4NSAxLjc1OC0uNzE5IDIuMDA2LTEuNDEzLjI0OC0uNjk0LjI0OC0xLjI4OS4xNzMtMS40MTMtLjA3NC0uMTI0LS4yNzItLjE5OC0uNTctLjM0N20tNS40MjEgNy40MDNoLS4wMDRhOS44NyA5Ljg3IDAgMDEtNS4wMzEtMS4zNzhsLS4zNjEtLjIxNC0zLjc0MS45ODIuOTk4LTMuNjQ4LS4yMzUtLjM3NGE5Ljg2IDkuODYgMCAwMS0xLjUxLTUuMjZjLjAwMS01LjQ1IDQuNDM2LTkuODg0IDkuODg4LTkuODg0IDIuNjQgMCA1LjEyMiAxLjAzIDYuOTg4IDIuODk4YTkuODI1IDkuODI1IDAgMDEyLjg5MyA2Ljk5NGMtLjAwMyA1LjQ1LTQuNDM3IDkuODg0LTkuODg1IDkuODg0bTguNDEzLTE4LjI5N0ExMS44MTUgMTEuODE1IDAgMDAxMi4wNSAwQzUuNDk1IDAgLjE2IDUuMzM1LjE1NyAxMS44OTJjMCAyLjA5Ni41NDcgNC4xNDIgMS41ODggNS45NDVMLjA1NyAyNGw2LjMwNS0xLjY1NGExMS44ODIgMTEuODgyIDAgMDA1LjY4MyAxLjQ0OGguMDA1YzYuNTU0IDAgMTEuODktNS4zMzUgMTEuODkzLTExLjg5M2ExMS44MjEgMTEuODIxIDAgMDAtMy40OC04LjQxM1oiLz48L3N2Zz4=" width="15" height="15" alt="WhatsApp" style="display:block;" /></td></tr>
            </table>
          </td>
          <td style="padding:5px 0 5px 10px;vertical-align:middle;">
            <a href="https://wa.me/56993089185" style="font-size:13px;color:#27272a;font-family:Arial,sans-serif;text-decoration:none;">+56 9 9308 9185</a>
          </td>
        </tr>
        <tr>
          <td width="30" style="padding:5px 0;vertical-align:middle;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="26" height="26" style="border-radius:50%;background-color:#0d9488;background-image:linear-gradient(135deg,#0d9488,#0ea5e9);">
              <tr><td align="center" valign="middle"><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE1IiBoZWlnaHQ9IjE1IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cmVjdCB4PSIyIiB5PSI0IiB3aWR0aD0iMjAiIGhlaWdodD0iMTYiIHJ4PSIyIi8+PHBhdGggZD0ibTIyIDYtMTAgN0wyIDYiLz48L3N2Zz4=" width="15" height="15" alt="Correo" style="display:block;" /></td></tr>
            </table>
          </td>
          <td style="padding:5px 0 5px 10px;vertical-align:middle;">
            <a href="mailto:sebastian@mail.vetly.pro" style="font-size:13px;color:#27272a;font-family:Arial,sans-serif;text-decoration:none;">sebastian@mail.vetly.pro</a>
          </td>
        </tr>
        <tr>
          <td width="30" style="padding:5px 0;vertical-align:middle;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="26" height="26" style="border-radius:50%;background-color:#0d9488;background-image:linear-gradient(135deg,#0d9488,#0ea5e9);">
              <tr><td align="center" valign="middle"><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE1IiBoZWlnaHQ9IjE1IiBmaWxsPSIjZmZmZmZmIj48cGF0aCBkPSJNNy4wMzAxLjA4NGMtMS4yNzY4LjA2MDItMi4xNDg3LjI2NC0yLjkxMS41NjM0LS43ODg4LjMwNzUtMS40NTc1LjcyLTIuMTIyOCAxLjM4NzctLjY2NTIuNjY3Ny0xLjA3NSAxLjMzNjgtMS4zODAyIDIuMTI3LS4yOTU0Ljc2MzgtLjQ5NTYgMS42MzY1LS41NTIgMi45MTQtLjA1NjQgMS4yNzc1LS4wNjg5IDEuNjg4Mi0uMDYyNiA0Ljk0Ny4wMDYyIDMuMjU4Ni4wMjA2IDMuNjY3MS4wODI1IDQuOTQ3My4wNjEgMS4yNzY1LjI2NCAyLjE0ODIuNTYzNSAyLjkxMDcuMzA4Ljc4ODkuNzIgMS40NTczIDEuMzg4IDIuMTIyOC42Njc5LjY2NTUgMS4zMzY1IDEuMDc0MyAyLjEyODUgMS4zOC43NjMyLjI5NSAxLjYzNjEuNDk2MSAyLjkxMzQuNTUyIDEuMjc3My4wNTYgMS42ODg0LjA2OSA0Ljk0NjIuMDYyNyAzLjI1NzgtLjAwNjIgMy42NjgtLjAyMDcgNC45NDc4LS4wODE0IDEuMjgtLjA2MDcgMi4xNDctLjI2NTIgMi45MDk4LS41NjMzLjc4ODktLjMwODYgMS40NTc4LS43MiAyLjEyMjgtMS4zODgxLjY2NS0uNjY4MiAxLjA3NDUtMS4zMzc4IDEuMzc5NS0yLjEyODQuMjk1Ny0uNzYzMi40OTY2LTEuNjM2LjU1Mi0yLjkxMjQuMDU2LTEuMjgwOS4wNjkyLTEuNjg5OC4wNjMtNC45NDgtLjAwNjMtMy4yNTgzLS4wMjEtMy42NjY4LS4wODE3LTQuOTQ2NS0uMDYwNy0xLjI3OTctLjI2NC0yLjE0ODctLjU2MzMtMi45MTE3LS4zMDg0LS43ODg5LS43Mi0xLjQ1NjgtMS4zODc2LTIuMTIyOEMyMS4yOTgyIDEuMzMgMjAuNjI4LjkyMDggMTkuODM3OC42MTY1IDE5LjA3NC4zMjEgMTguMjAxNy4xMTk3IDE2LjkyNDQuMDY0NSAxNS42NDcxLjAwOTMgMTUuMjM2LS4wMDUgMTEuOTc3LjAwMTQgOC43MTguMDA3NiA4LjMxLjAyMTUgNy4wMzAxLjA4MzltLjE0MDIgMjEuNjkzMmMtMS4xNy0uMDUwOS0xLjgwNTMtLjI0NTMtMi4yMjg3LS40MDgtLjU2MDYtLjIxNi0uOTYtLjQ3NzEtMS4zODE5LS44OTUtLjQyMi0uNDE3OC0uNjgxMS0uODE4Ni0uOS0xLjM3OC0uMTY0NC0uNDIzNC0uMzYyNC0xLjA1OC0uNDE3MS0yLjIyOC0uMDU5NS0xLjI2NDUtLjA3Mi0xLjY0NDItLjA3OS00Ljg0OC0uMDA3LTMuMjAzNy4wMDUzLTMuNTgzLjA2MDctNC44NDguMDUtMS4xNjkuMjQ1Ni0xLjgwNS40MDgtMi4yMjgyLjIxNi0uNTYxMy40NzYyLS45Ni44OTUtMS4zODE2LjQxODgtLjQyMTcuODE4NC0uNjgxNCAxLjM3ODMtLjkwMDMuNDIzLS4xNjUxIDEuMDU3NS0uMzYxNCAyLjIyNy0uNDE3MSAxLjI2NTUtLjA2IDEuNjQ0Ny0uMDcyIDQuODQ4LS4wNzkgMy4yMDMzLS4wMDcgMy41ODM1LjAwNSA0Ljg0OTUuMDYwOCAxLjE2OS4wNTA4IDEuODA1My4yNDQ1IDIuMjI4LjQwOC41NjA4LjIxNi45Ni40NzU0IDEuMzgxNi44OTUuNDIxNy40MTk0LjY4MTYuODE3Ni45MDA1IDEuMzc4Ny4xNjUzLjQyMTcuMzYxNyAxLjA1Ni40MTY5IDIuMjI2My4wNjAyIDEuMjY1NS4wNzM5IDEuNjQ1LjA3OTYgNC44NDguMDA1OCAzLjIwMy0uMDA1NSAzLjU4MzQtLjA2MSA0Ljg0OC0uMDUxIDEuMTctLjI0NSAxLjgwNTUtLjQwOCAyLjIyOTQtLjIxNi41NjA0LS40NzYzLjk2LS44OTU0IDEuMzgxNC0uNDE5LjQyMTUtLjgxODEuNjgxMS0xLjM3ODMuOS0uNDIyNC4xNjQ5LTEuMDU3Ny4zNjE3LTIuMjI2Mi40MTc0LTEuMjY1Ni4wNTk1LTEuNjQ0OC4wNzItNC44NDkzLjA3OS0zLjIwNDUuMDA3LTMuNTgyNS0uMDA2LTQuODQ4LS4wNjA4TTE2Ljk1MyA1LjU4NjRBMS40NCAxLjQ0IDAgMSAwIDE4LjM5IDQuMTQ0YTEuNDQgMS40NCAwIDAgMC0xLjQzNyAxLjQ0MjRNNS44Mzg1IDEyLjAxMmMuMDA2NyAzLjQwMzIgMi43NzA2IDYuMTU1NyA2LjE3MyA2LjE0OTMgMy40MDI2LS4wMDY1IDYuMTU3LTIuNzcwMSA2LjE1MDYtNi4xNzMzLS4wMDY1LTMuNDAzMi0yLjc3MS02LjE1NjUtNi4xNzQtNi4xNDk4LTMuNDAzLjAwNjctNi4xNTYgMi43NzEtNi4xNDk2IDYuMTczOE04IDEyLjAwNzdhNCA0IDAgMSAxIDQuMDA4IDMuOTkyMUEzLjk5OTYgMy45OTk2IDAgMCAxIDggMTIuMDA3NyIvPjwvc3ZnPg==" width="15" height="15" alt="Instagram" style="display:block;" /></td></tr>
            </table>
          </td>
          <td style="padding:5px 0 5px 10px;vertical-align:middle;">
            <a href="https://instagram.com/vetly.pro" style="font-size:13px;color:#27272a;font-family:Arial,sans-serif;text-decoration:none;">@vetly.pro</a>
          </td>
        </tr>
        <tr>
          <td width="30" style="padding:5px 0;vertical-align:middle;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="26" height="26" style="border-radius:50%;background-color:#0d9488;background-image:linear-gradient(135deg,#0d9488,#0ea5e9);">
              <tr><td align="center" valign="middle"><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE1IiBoZWlnaHQ9IjE1IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIxMCIvPjxsaW5lIHgxPSIyIiB5MT0iMTIiIHgyPSIyMiIgeTI9IjEyIi8+PHBhdGggZD0iTTEyIDJhMTUuMyAxNS4zIDAgMCAxIDQgMTAgMTUuMyAxNS4zIDAgMCAxLTQgMTAgMTUuMyAxNS4zIDAgMCAxLTQtMTAgMTUuMyAxNS4zIDAgMCAxIDQtMTB6Ii8+PC9zdmc+" width="15" height="15" alt="Web" style="display:block;" /></td></tr>
            </table>
          </td>
          <td style="padding:5px 0 5px 10px;vertical-align:middle;">
            <a href="https://vetly.pro" style="font-size:13px;color:#27272a;font-family:Arial,sans-serif;text-decoration:none;">vetly.pro</a>
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
    const [loadError, setLoadError] = useState<string | null>(null)

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
        // Si alguna de las 3 falla (ej. una carrera de Web Locks entre pestañas),
        // NUNCA pisamos el estado ya cargado con vacío/null — eso hacía que la
        // lista pareciera "sin prospectos" y, peor, que el badge de la campaña
        // (config === null) se mostrara como "Campaña activa" en rojo aunque el
        // dato real en la DB fuera is_paused=true. Mostramos un error explícito
        // con reintento en vez de fallar en silencio hacia el estado más
        // alarmante posible.
        const firstError = leadsRes.error || statsRes.error || configRes.error
        setLoadError(firstError ? (firstError.message || 'No se pudo cargar la información. Intenta de nuevo.') : null)
        if (!leadsRes.error) setLeads(leadsRes.data || [])
        if (!statsRes.error) setStats(statsRes.data?.[0] || null)
        if (!configRes.error) setConfig(configRes.data || null)
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
                            disabled={togglingPause || !config}
                            title={!config ? 'No se pudo confirmar el estado real de la campaña — recarga antes de asumir nada' : undefined}
                            className={cn(
                                "flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                                !config
                                    ? "bg-white/10 text-white/50 cursor-not-allowed"
                                    : config.is_paused ? "bg-emerald-500 text-white hover:bg-emerald-600" : "bg-red-500/90 text-white hover:bg-red-600"
                            )}
                        >
                            {togglingPause
                                ? <Loader2 className="w-4 h-4 animate-spin" />
                                : !config ? <AlertCircle className="w-4 h-4" /> : config.is_paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                            {!config ? 'Estado no confirmado' : config.is_paused ? 'Campaña pausada' : 'Campaña activa'}
                        </button>
                        <button onClick={load} className="p-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all text-white/60 hover:text-white">
                            <RefreshCw className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>

            {loadError && (
                <div className="bg-red-50 border border-red-100 p-4 rounded-2xl flex items-center gap-3">
                    <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
                    <div className="min-w-0 flex-1">
                        <p className="text-xs font-black text-red-700 uppercase leading-none mb-1">No se pudo cargar la información</p>
                        <p className="text-[11px] text-red-600 font-bold leading-tight">{loadError} — lo que ves abajo puede estar incompleto o desactualizado, no asumas que la campaña está pausada o activa hasta recargar.</p>
                    </div>
                    <button onClick={load} className="p-2 bg-red-100 text-red-700 rounded-lg shrink-0"><RefreshCw className="w-3.5 h-3.5" /></button>
                </div>
            )}

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
                        {loadError
                            ? 'No se pudo confirmar si hay prospectos — la carga falló, recarga antes de asumir que la lista está vacía.'
                            : `Sin prospectos ${statusFilter !== 'todos' || countryFilter !== 'todos' ? 'con estos filtros' : 'todavía — busca la primera ciudad arriba'}`}
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
