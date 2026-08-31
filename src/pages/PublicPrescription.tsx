import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { createClient } from '@supabase/supabase-js'
import { Loader2, Download } from 'lucide-react'

// Página pública de la receta -- sin sesión, mismo patrón que /p/:code y
// /reservar/:slug (cliente propio sin persistencia, evita el conflicto de Web
// Locks si se abre en el mismo navegador que ya tiene el dashboard abierto).
const publicClient = createClient(
    import.meta.env.VITE_SUPABASE_URL || '',
    import.meta.env.VITE_SUPABASE_ANON_KEY || '',
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
)

interface Item {
    drug?: string; presentation?: string; dose?: string; route?: string
    frequency?: string; duration?: string; quantity?: string; instructions?: string
}

interface PrescriptionData {
    prescription: {
        issued_date: string
        diagnosis: string | null
        items: Item[]
        general_instructions: string | null
        patient_snapshot: Record<string, any>
        patient_weight: number | null
        tutor_name: string | null
        prescriber_name: string | null
        prescriber_license: string | null
        prescriber_title: string | null
        prescriber_signature_url: string | null
        folio: string | null
        short_id: string
    }
    clinic: {
        clinic_name: string | null
        clinic_address: string | null
        address_references: string | null
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

const ageFromDob = (dob: string | null | undefined): string => {
    if (!dob) return '—'
    const d = new Date(dob)
    if (Number.isNaN(d.getTime())) return '—'
    const now = new Date()
    let years = now.getFullYear() - d.getFullYear()
    let months = now.getMonth() - d.getMonth()
    if (now.getDate() < d.getDate()) months -= 1
    if (months < 0) { years -= 1; months += 12 }
    if (years > 0) return `${years} ${years === 1 ? 'año' : 'años'}${months > 0 ? ` ${months} m` : ''}`
    if (months > 0) return `${months} ${months === 1 ? 'mes' : 'meses'}`
    return 'Menos de 1 mes'
}

const fmtDate = (iso: string): string => {
    const d = new Date(iso + 'T12:00:00')
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })
}

const socialLabel = (url: string): string => {
    try {
        const u = new URL(url.startsWith('http') ? url : `https://${url}`)
        return u.hostname.replace(/^www\./, '') + (u.pathname !== '/' ? u.pathname : '')
    } catch { return url }
}

export default function PublicPrescription() {
    const { token } = useParams<{ token: string }>()
    const [searchParams] = useSearchParams()
    const [loading, setLoading] = useState(true)
    const [data, setData] = useState<PrescriptionData | null>(null)

    useEffect(() => {
        document.title = 'Receta médica'
        const meta = document.createElement('meta')
        meta.name = 'robots'
        meta.content = 'noindex'
        document.head.appendChild(meta)
        return () => { document.head.removeChild(meta) }
    }, [])

    useEffect(() => {
        if (!token) { setLoading(false); return }
        ;(async () => {
            const { data: res } = await (publicClient as any).rpc('get_prescription_public', { p_token: token })
            setData((res as PrescriptionData) || null)
            setLoading(false)
        })()
    }, [token])

    const brand = data?.clinic.brand_color || '#0d9488'
    const brandTo = data?.clinic.brand_color_secondary || `${brand}cc`
    const wantsPrint = searchParams.get('print') === '1'

    const logoUrl = data?.clinic.logo_url || ''
    const sigUrl = data?.prescription.prescriber_signature_url || ''

    // Auto-print para el acceso desde el dashboard. Espera a que carguen las
    // imágenes (logo + firma) para que salgan en el PDF; si no hay o tardan,
    // imprime igual con un tope de 2.5 s.
    useEffect(() => {
        if (!wantsPrint || loading || !data) return
        let done = false
        const go = () => { if (done) return; done = true; window.print() }
        const urls = [logoUrl, sigUrl].filter(Boolean)
        if (urls.length === 0) {
            const t = setTimeout(go, 400)
            return () => clearTimeout(t)
        }
        let pending = urls.length
        const one = () => { pending -= 1; if (pending <= 0) go() }
        urls.forEach(u => {
            const img = new Image()
            img.onload = one
            img.onerror = one
            img.src = u
        })
        const t = setTimeout(go, 2500)
        return () => clearTimeout(t)
    }, [wantsPrint, loading, data, logoUrl, sigUrl])

    const socials = useMemo(() => {
        if (!data) return [] as string[]
        return [
            data.clinic.website_url,
            data.clinic.instagram_url,
            data.clinic.facebook_url,
            data.clinic.tiktok_url,
        ].filter((s): s is string => !!s && s.trim().length > 0)
    }, [data])

    if (loading) {
        return (
            <div className="min-h-screen bg-ivory flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-charcoal/30" />
            </div>
        )
    }

    if (!data) {
        return (
            <div className="min-h-screen bg-ivory flex items-center justify-center px-6 text-center">
                <div>
                    <p className="text-2xl font-black text-charcoal mb-2">Receta no encontrada</p>
                    <p className="text-charcoal/60">Este enlace no existe o la receta fue eliminada.</p>
                </div>
            </div>
        )
    }

    const p = data.prescription
    const c = data.clinic
    const snap = p.patient_snapshot || {}
    const weight = p.patient_weight ?? snap.weight

    return (
        <div className="min-h-screen bg-ivory print:bg-white">
            <style>{`
                @media print {
                    .no-print { display: none !important; }
                    body { background: #fff; }
                    @page { margin: 12mm; }
                }
                .rx-color-adjust { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            `}</style>

            <div className="max-w-3xl mx-auto p-4 sm:p-8">
                <button
                    onClick={() => window.print()}
                    className="no-print mb-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-white text-sm"
                    style={{ background: `linear-gradient(135deg, ${brand}, ${brandTo})` }}
                >
                    <Download className="w-4 h-4" /> Descargar PDF
                </button>

                <div className="bg-white rounded-2xl border border-silk-beige shadow-sm overflow-hidden print:border-0 print:shadow-none print:rounded-none">
                    {/* Encabezado con gradiente de marca */}
                    <div
                        className="rx-color-adjust p-6 sm:p-8 text-white"
                        style={{ background: `linear-gradient(135deg, ${brand}, ${brandTo})` }}
                    >
                        <div className="flex items-center gap-4">
                            {logoUrl && <img id="clinic-logo" src={logoUrl} alt="" className="h-14 w-14 object-contain rounded-lg bg-white/95 p-1" />}
                            <div>
                                {/* text-white explícito: la regla base `h1 { text-charcoal }` de index.css
                                    gana sobre el text-white heredado del contenedor. Sombra para que
                                    resalte sobre cualquier tramo del gradiente de marca. */}
                                <h1
                                    className="text-xl sm:text-2xl font-black leading-tight text-white"
                                    style={{ textShadow: '0 1px 3px rgba(0,0,0,0.35)' }}
                                >
                                    {c.clinic_name || 'Clínica veterinaria'}
                                </h1>
                                <p className="text-white/90 text-xs sm:text-sm mt-1" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.25)' }}>
                                    {[c.clinic_address, c.address_references, c.country].filter(Boolean).join(' · ')}
                                </p>
                                {c.contact_phone && <p className="text-white/90 text-xs sm:text-sm" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.25)' }}>Tel: {c.contact_phone}</p>}
                            </div>
                        </div>
                    </div>

                    <div className="p-6 sm:p-8 space-y-6">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                            <h2 className="text-lg font-black uppercase tracking-widest" style={{ color: brand }}>Receta médica</h2>
                            <div className="text-right text-xs text-charcoal/50">
                                <p>Fecha: <span className="font-bold text-charcoal">{fmtDate(p.issued_date)}</span></p>
                                <p>N.º {p.folio || p.short_id}</p>
                            </div>
                        </div>

                        {/* Paciente / Tutor */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-xl bg-ivory/60 border border-silk-beige">
                            <div>
                                <p className="text-[10px] font-black text-charcoal/40 uppercase tracking-widest">Paciente</p>
                                <p className="text-sm font-bold text-charcoal">{snap.name || '—'}</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-black text-charcoal/40 uppercase tracking-widest">Especie / Raza</p>
                                <p className="text-sm font-bold text-charcoal">{[snap.species, snap.breed].filter(Boolean).join(' · ') || '—'}</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-black text-charcoal/40 uppercase tracking-widest">Edad / Peso</p>
                                <p className="text-sm font-bold text-charcoal">{ageFromDob(snap.dob)}{weight ? ` · ${weight} ${snap.weight_unit || 'kg'}` : ''}</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-black text-charcoal/40 uppercase tracking-widest">Tutor</p>
                                <p className="text-sm font-bold text-charcoal">{p.tutor_name || '—'}</p>
                            </div>
                            {snap.microchip_id && (
                                <div>
                                    <p className="text-[10px] font-black text-charcoal/40 uppercase tracking-widest">Microchip</p>
                                    <p className="text-sm font-bold text-charcoal">{snap.microchip_id}</p>
                                </div>
                            )}
                        </div>

                        {p.diagnosis && (
                            <div>
                                <p className="text-[10px] font-black text-charcoal/40 uppercase tracking-widest mb-1">Diagnóstico</p>
                                <p className="text-sm font-medium text-charcoal">{p.diagnosis}</p>
                            </div>
                        )}

                        {/* Medicamentos */}
                        <div>
                            <p className="text-[10px] font-black text-charcoal/40 uppercase tracking-widest mb-2">Prescripción</p>
                            <div className="rx-color-adjust rounded-xl border-2 divide-y" style={{ borderColor: brand }}>
                                {(p.items || []).map((it, i) => (
                                    <div key={i} className="p-4">
                                        <p className="font-black text-charcoal">
                                            {i + 1}. {it.drug}{it.presentation ? ` — ${it.presentation}` : ''}
                                        </p>
                                        <p className="text-sm text-charcoal/70 mt-1">
                                            {[
                                                it.dose && `Dosis: ${it.dose}`,
                                                it.route && `Vía: ${it.route}`,
                                                it.frequency && `Frecuencia: ${it.frequency}`,
                                                it.duration && `Duración: ${it.duration}`,
                                                it.quantity && `Cantidad: ${it.quantity}`,
                                            ].filter(Boolean).join('  ·  ')}
                                        </p>
                                        {it.instructions && (
                                            <p className="text-sm text-charcoal/60 italic mt-1">{it.instructions}</p>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {p.general_instructions && (
                            <div>
                                <p className="text-[10px] font-black text-charcoal/40 uppercase tracking-widest mb-1">Indicaciones generales</p>
                                <p className="text-sm text-charcoal/80 whitespace-pre-wrap">{p.general_instructions}</p>
                            </div>
                        )}

                        {/* Firma del prescriptor */}
                        <div className="pt-10 mt-4 border-t border-silk-beige flex flex-col items-end">
                            <div className="w-56 text-center">
                                {p.prescriber_signature_url && (
                                    <img
                                        src={p.prescriber_signature_url}
                                        alt="Firma"
                                        className="h-16 max-w-full object-contain mx-auto mb-1"
                                    />
                                )}
                                <div className="border-t border-charcoal/40 pt-2">
                                    <p className="text-sm font-bold text-charcoal">{p.prescriber_name || '—'}</p>
                                    {p.prescriber_title && <p className="text-xs text-charcoal/60">{p.prescriber_title}</p>}
                                    {p.prescriber_license && <p className="text-xs text-charcoal/60">Reg. N.º {p.prescriber_license}</p>}
                                </div>
                            </div>
                        </div>

                        {socials.length > 0 && (
                            <div className="pt-4 border-t border-silk-beige text-center">
                                <p className="text-[11px] text-charcoal/40">
                                    {socials.map(s => socialLabel(s)).join('  ·  ')}
                                </p>
                            </div>
                        )}

                        <p className="text-center text-[10px] text-charcoal/30">Documento generado por Vetly</p>
                    </div>
                </div>
            </div>
        </div>
    )
}
