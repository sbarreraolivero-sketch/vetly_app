import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { createClient } from '@supabase/supabase-js'
import { Loader2, Download, Scissors, MessageCircle } from 'lucide-react'

// Reporte público de una sesión de estética — sin sesión, mismo patrón que
// /receta/:token y /consentimiento/:token.
const publicClient = createClient(
    import.meta.env.VITE_SUPABASE_URL || '',
    import.meta.env.VITE_SUPABASE_ANON_KEY || '',
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
)

interface GroomingReport {
    session: {
        session_date: string
        services: Array<{ name?: string; price?: number; add_on?: boolean }>
        findings: string | null
        before_photos: string[]
        after_photos: string[]
        next_visit_date: string | null
        groomer_name: string | null
    }
    patient: { name: string | null; species: string | null; breed: string | null }
    clinic: {
        clinic_name: string | null
        clinic_address: string | null
        country: string | null
        contact_phone: string | null
        logo_url: string | null
        brand_color: string | null
        brand_color_secondary: string | null
        website_url: string | null
        instagram_url: string | null
        facebook_url: string | null
        tiktok_url: string | null
    }
}

const fmtDate = (iso: string | null): string => {
    if (!iso) return '—'
    const d = new Date(iso + (iso.length === 10 ? 'T12:00:00' : ''))
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })
}

export default function PublicGroomingReport() {
    const { token } = useParams<{ token: string }>()
    const [searchParams] = useSearchParams()
    const [loading, setLoading] = useState(true)
    const [data, setData] = useState<GroomingReport | null>(null)

    useEffect(() => {
        document.title = 'Reporte de estética'
        const meta = document.createElement('meta')
        meta.name = 'robots'
        meta.content = 'noindex'
        document.head.appendChild(meta)
        return () => { document.head.removeChild(meta) }
    }, [])

    useEffect(() => {
        if (!token) { setLoading(false); return }
        ;(async () => {
            const { data: res } = await (publicClient as any).rpc('get_grooming_report_public', { p_token: token })
            setData((res as GroomingReport) || null)
            setLoading(false)
        })()
    }, [token])

    const brand = data?.clinic.brand_color || '#0d9488'
    const brandTo = data?.clinic.brand_color_secondary || `${brand}cc`
    const wantsPrint = searchParams.get('print') === '1'

    useEffect(() => {
        if (!wantsPrint || loading || !data) return
        const t = setTimeout(() => window.print(), 1200)
        return () => clearTimeout(t)
    }, [wantsPrint, loading, data])

    const socials = useMemo(() => {
        if (!data) return [] as string[]
        return [data.clinic.website_url, data.clinic.instagram_url, data.clinic.facebook_url, data.clinic.tiktok_url]
            .filter((s): s is string => !!s && s.trim().length > 0)
    }, [data])

    if (loading) {
        return <div className="min-h-screen bg-ivory flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-charcoal/30" /></div>
    }
    if (!data) {
        return (
            <div className="min-h-screen bg-ivory flex items-center justify-center px-6 text-center">
                <div>
                    <p className="text-2xl font-black text-charcoal mb-2">Reporte no encontrado</p>
                    <p className="text-charcoal/60">Este enlace no existe o el reporte fue eliminado.</p>
                </div>
            </div>
        )
    }

    const s = data.session
    const c = data.clinic
    const logoUrl = c.logo_url || ''
    const phone = String(c.contact_phone || '').replace(/\D/g, '')

    return (
        <div className="min-h-screen bg-ivory print:bg-white">
            <style>{`
                @media print { .no-print { display: none !important; } body { background: #fff; } @page { margin: 12mm; } }
                .rx-color-adjust { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            `}</style>

            <div className="max-w-3xl mx-auto p-4 sm:p-8">
                <div className="no-print mb-4 flex gap-2">
                    <button onClick={() => window.print()} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-white text-sm" style={{ background: `linear-gradient(135deg, ${brand}, ${brandTo})` }}>
                        <Download className="w-4 h-4" /> Descargar PDF
                    </button>
                    {phone && (
                        <a href={`https://wa.me/${phone}`} target="_blank" rel="noopener" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 text-sm">
                            <MessageCircle className="w-4 h-4" /> Agendar próxima visita
                        </a>
                    )}
                </div>

                <div className="bg-white rounded-2xl border border-silk-beige shadow-sm overflow-hidden print:border-0 print:shadow-none print:rounded-none">
                    <div className="rx-color-adjust p-6 sm:p-8 text-white" style={{ background: `linear-gradient(135deg, ${brand}, ${brandTo})` }}>
                        <div className="flex items-center gap-4">
                            {logoUrl && <img src={logoUrl} alt="" className="h-14 w-14 object-contain rounded-lg bg-white/95 p-1" />}
                            <div>
                                <h1 className="text-xl sm:text-2xl font-black leading-tight text-white" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.35)' }}>{c.clinic_name || 'Clínica veterinaria'}</h1>
                                <p className="text-white/90 text-xs sm:text-sm mt-1" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.25)' }}>{[c.clinic_address, c.country].filter(Boolean).join(' · ')}</p>
                            </div>
                        </div>
                    </div>

                    <div className="p-6 sm:p-8 space-y-6">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                            <h2 className="text-lg font-black uppercase tracking-widest flex items-center gap-2" style={{ color: brand }}>
                                <Scissors className="w-5 h-5" /> Reporte de estética
                            </h2>
                            <p className="text-xs text-charcoal/50">{fmtDate(s.session_date)}</p>
                        </div>

                        <div className="p-4 rounded-xl bg-ivory/60 border border-silk-beige">
                            <p className="text-sm font-bold text-charcoal">{data.patient.name || 'Mascota'}</p>
                            <p className="text-xs text-charcoal/60">{[data.patient.species, data.patient.breed].filter(Boolean).join(' · ')}</p>
                            {s.groomer_name && <p className="text-xs text-charcoal/60 mt-1">Peluquero/a: {s.groomer_name}</p>}
                        </div>

                        {(s.before_photos?.length > 0 || s.after_photos?.length > 0) && (
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <p className="text-[10px] font-black text-charcoal/40 uppercase tracking-widest mb-2">Antes</p>
                                    <div className="grid gap-2">
                                        {(s.before_photos || []).map((u, i) => <img key={i} src={u} alt="" className="w-full rounded-xl border border-silk-beige object-cover" />)}
                                    </div>
                                </div>
                                <div>
                                    <p className="text-[10px] font-black text-charcoal/40 uppercase tracking-widest mb-2">Después</p>
                                    <div className="grid gap-2">
                                        {(s.after_photos || []).map((u, i) => <img key={i} src={u} alt="" className="w-full rounded-xl border border-silk-beige object-cover" />)}
                                    </div>
                                </div>
                            </div>
                        )}

                        {(s.services || []).length > 0 && (
                            <div>
                                <p className="text-[10px] font-black text-charcoal/40 uppercase tracking-widest mb-2">Servicios realizados</p>
                                <ul className="text-sm text-charcoal/80 space-y-1">
                                    {s.services.map((sv, i) => <li key={i}>• {sv.name}{sv.add_on ? ' (adicional)' : ''}</li>)}
                                </ul>
                            </div>
                        )}

                        {s.findings && (
                            <div>
                                <p className="text-[10px] font-black text-charcoal/40 uppercase tracking-widest mb-1">Observaciones</p>
                                <p className="text-sm text-charcoal/80 whitespace-pre-wrap">{s.findings}</p>
                            </div>
                        )}

                        {s.next_visit_date && (
                            <div className="rx-color-adjust p-4 rounded-xl bg-emerald-50 border border-emerald-200">
                                <p className="text-sm font-bold text-emerald-800">Próxima visita sugerida: {fmtDate(s.next_visit_date)}</p>
                            </div>
                        )}

                        {socials.length > 0 && (
                            <div className="pt-4 border-t border-silk-beige text-center">
                                <p className="text-[11px] text-charcoal/40">{socials.join('  ·  ')}</p>
                            </div>
                        )}
                        <p className="text-center text-[10px] text-charcoal/30">Documento generado por Vetly</p>
                    </div>
                </div>
            </div>
        </div>
    )
}
