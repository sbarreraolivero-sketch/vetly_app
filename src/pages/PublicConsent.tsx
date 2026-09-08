import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { createClient } from '@supabase/supabase-js'
import { Loader2, Download, Check, PenLine } from 'lucide-react'
import { SignaturePad } from '@/components/settings/SignaturePad'

// Página pública del consentimiento — sin sesión, mismo patrón que
// /receta/:token y /reservar/:slug (cliente propio sin persistencia, evita el
// conflicto de Web Locks si se abre en el mismo navegador que ya tiene el
// dashboard abierto). El texto ya viene con los placeholders resueltos al
// emitir; acá solo se renderiza y se captura la firma.
const publicClient = createClient(
    import.meta.env.VITE_SUPABASE_URL || '',
    import.meta.env.VITE_SUPABASE_ANON_KEY || '',
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
)

interface CheckboxDef { key: string; label: string; required?: boolean }

interface ConsentData {
    consent: {
        template_key: string
        template_title: string
        template_body: string
        checkboxes: CheckboxDef[]
        checkbox_responses: Record<string, boolean>
        patient_snapshot: Record<string, any>
        tutor_name: string | null
        status: 'pending' | 'signed' | 'declined'
        required_signature_mode: 'one_click' | 'typed' | 'drawn'
        signed_at: string | null
        signer_name: string | null
        signer_relationship: string | null
        acceptance_method: string | null
        signature_url: string | null
        short_id: string
        issued_at: string
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

const fmtDateTime = (iso: string | null): string => {
    if (!iso) return '—'
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '—'
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' }) +
        ' · ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}

const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result))
        r.onerror = reject
        r.readAsDataURL(blob)
    })

export default function PublicConsent() {
    const { token } = useParams<{ token: string }>()
    const [searchParams] = useSearchParams()
    const [loading, setLoading] = useState(true)
    const [data, setData] = useState<ConsentData | null>(null)

    const [signerName, setSignerName] = useState('')
    const [relationship, setRelationship] = useState('tutor')
    const [readAck, setReadAck] = useState(false)
    const [checks, setChecks] = useState<Record<string, boolean>>({})
    const [drawnBlob, setDrawnBlob] = useState<Blob | null>(null)
    // 'accept' = aceptar con casilla · 'draw' = dibujar la firma. Dibujar
    // siempre está disponible (es un método más fuerte que 'typed'/'one_click',
    // que sign-consent acepta). Solo se fuerza cuando la plantilla exige 'drawn'.
    const [sigMode, setSigMode] = useState<'accept' | 'draw'>('accept')
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        document.title = 'Consentimiento'
        const meta = document.createElement('meta')
        meta.name = 'robots'
        meta.content = 'noindex'
        document.head.appendChild(meta)
        return () => { document.head.removeChild(meta) }
    }, [])

    const load = async () => {
        if (!token) { setLoading(false); return }
        const { data: res } = await (publicClient as any).rpc('get_consent_public', { p_token: token })
        setData((res as ConsentData) || null)
        setLoading(false)
    }
    useEffect(() => { load() }, [token])

    useEffect(() => {
        if (data?.consent && signerName === '' && data.consent.tutor_name) {
            setSignerName(data.consent.tutor_name)
        }
        if (data?.consent?.required_signature_mode === 'drawn') setSigMode('draw')
    }, [data])

    const brand = data?.clinic.brand_color || '#0d9488'
    const brandTo = data?.clinic.brand_color_secondary || `${brand}cc`
    const wantsPrint = searchParams.get('print') === '1'
    const logoUrl = data?.clinic.logo_url || ''
    const sigUrl = data?.consent.signature_url || ''

    useEffect(() => {
        if (!wantsPrint || loading || !data || data.consent.status !== 'signed') return
        let done = false
        const go = () => { if (done) return; done = true; window.print() }
        const urls = [logoUrl, sigUrl].filter(Boolean)
        if (urls.length === 0) { const t = setTimeout(go, 400); return () => clearTimeout(t) }
        let pending = urls.length
        const one = () => { pending -= 1; if (pending <= 0) go() }
        urls.forEach(u => { const img = new Image(); img.onload = one; img.onerror = one; img.src = u })
        const t = setTimeout(go, 2500)
        return () => clearTimeout(t)
    }, [wantsPrint, loading, data, logoUrl, sigUrl])

    const socials = useMemo(() => {
        if (!data) return [] as string[]
        return [data.clinic.website_url, data.clinic.instagram_url, data.clinic.facebook_url, data.clinic.tiktok_url]
            .filter((s): s is string => !!s && s.trim().length > 0)
    }, [data])

    const handleSign = async (method: 'one_click' | 'typed' | 'drawn') => {
        if (!data || !token) return
        setError(null)
        if (!signerName.trim()) { setError('Escribe tu nombre completo.'); return }
        if (method !== 'drawn' && !readAck) { setError('Marca la casilla para confirmar que leíste el documento.'); return }
        if (method === 'drawn' && !drawnBlob) { setError('Dibuja tu firma y toca "Usar esta firma".'); return }
        for (const c of data.consent.checkboxes || []) {
            if (c.required && !checks[c.key]) { setError(`Debes marcar: "${c.label}"`); return }
        }

        setSubmitting(true)
        try {
            const bodyPayload: Record<string, unknown> = {
                token,
                acceptance_method: method,
                signer_name: signerName.trim(),
                signer_relationship: relationship,
                checkbox_responses: checks,
            }
            if (method === 'drawn' && drawnBlob) {
                bodyPayload.signature_png_base64 = await blobToBase64(drawnBlob)
            }
            const { data: res, error: fnErr } = await publicClient.functions.invoke('sign-consent', { body: bodyPayload })
            if (fnErr) throw new Error('No se pudo enviar la firma. Revisa tu conexión e intenta de nuevo.')
            if (res && (res as any).success === false) throw new Error((res as any).error || 'No se pudo firmar.')
            await load()
        } catch (e: any) {
            setError(e.message || 'No se pudo firmar.')
        } finally {
            setSubmitting(false)
        }
    }

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
                    <p className="text-2xl font-black text-charcoal mb-2">Consentimiento no encontrado</p>
                    <p className="text-charcoal/60">Este enlace no existe o el consentimiento fue eliminado.</p>
                </div>
            </div>
        )
    }

    const co = data.consent
    const c = data.clinic
    const snap = co.patient_snapshot || {}
    const mode = co.required_signature_mode
    const signed = co.status === 'signed'

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
                {signed && (
                    <button
                        onClick={() => window.print()}
                        className="no-print mb-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-white text-sm"
                        style={{ background: `linear-gradient(135deg, ${brand}, ${brandTo})` }}
                    >
                        <Download className="w-4 h-4" /> Descargar PDF
                    </button>
                )}

                <div className="bg-white rounded-2xl border border-silk-beige shadow-sm overflow-hidden print:border-0 print:shadow-none print:rounded-none">
                    <div className="rx-color-adjust p-6 sm:p-8 text-white" style={{ background: `linear-gradient(135deg, ${brand}, ${brandTo})` }}>
                        <div className="flex items-center gap-4">
                            {logoUrl && <img src={logoUrl} alt="" className="h-14 w-14 object-contain rounded-lg bg-white/95 p-1" />}
                            <div>
                                <h1 className="text-xl sm:text-2xl font-black leading-tight text-white" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.35)' }}>
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
                            <h2 className="text-lg font-black uppercase tracking-widest" style={{ color: brand }}>{co.template_title}</h2>
                            <div className="text-right text-xs text-charcoal/50">
                                <p>N.º {co.short_id}</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 p-4 rounded-xl bg-ivory/60 border border-silk-beige">
                            <div>
                                <p className="text-[10px] font-black text-charcoal/40 uppercase tracking-widest">Paciente</p>
                                <p className="text-sm font-bold text-charcoal">{snap.name || '—'}</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-black text-charcoal/40 uppercase tracking-widest">Especie / Raza</p>
                                <p className="text-sm font-bold text-charcoal">{[snap.species, snap.breed].filter(Boolean).join(' · ') || '—'}</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-black text-charcoal/40 uppercase tracking-widest">Tutor</p>
                                <p className="text-sm font-bold text-charcoal">{co.tutor_name || '—'}</p>
                            </div>
                        </div>

                        <div className="text-sm text-charcoal/85 whitespace-pre-wrap leading-relaxed">{co.template_body}</div>

                        {signed ? (
                            <>
                                <div className="pt-8 mt-4 border-t border-silk-beige flex flex-col items-end">
                                    <div className="w-64 text-center">
                                        {co.signature_url && (
                                            <img src={co.signature_url} alt="Firma" className="h-16 max-w-full object-contain mx-auto mb-1" />
                                        )}
                                        <div className="border-t border-charcoal/40 pt-2">
                                            <p className="text-sm font-bold text-charcoal">{co.signer_name || '—'}</p>
                                            <p className="text-xs text-charcoal/60">
                                                {co.signer_relationship === 'tutor' ? 'Tutor/a responsable'
                                                    : co.signer_relationship === 'familiar' ? 'Familiar'
                                                    : 'Persona autorizada'}
                                            </p>
                                            <p className="text-xs text-charcoal/60">Firmado el {fmtDateTime(co.signed_at)}</p>
                                        </div>
                                    </div>
                                </div>
                                {(co.checkboxes || []).length > 0 && (
                                    <div className="text-xs text-charcoal/60 space-y-1">
                                        {co.checkboxes.map(cb => (
                                            <p key={cb.key} className="flex items-center gap-1.5">
                                                <Check className={`w-3.5 h-3.5 ${co.checkbox_responses?.[cb.key] ? 'text-emerald-600' : 'text-charcoal/20'}`} />
                                                {cb.label}: <strong>{co.checkbox_responses?.[cb.key] ? 'Sí' : 'No'}</strong>
                                            </p>
                                        ))}
                                    </div>
                                )}
                                <div className="rx-color-adjust text-center py-3 rounded-xl bg-emerald-50 border border-emerald-200 no-print">
                                    <p className="text-sm font-bold text-emerald-700 flex items-center justify-center gap-2">
                                        <Check className="w-4 h-4" /> Consentimiento firmado. Gracias.
                                    </p>
                                </div>
                            </>
                        ) : (
                            <div className="no-print space-y-4 pt-4 border-t border-silk-beige">
                                <p className="text-xs font-black text-charcoal/40 uppercase tracking-widest">Firma</p>

                                {(data.consent.checkboxes || []).map(cb => (
                                    <label key={cb.key} className="flex items-start gap-2 text-sm text-charcoal/80">
                                        <input
                                            type="checkbox"
                                            className="mt-1"
                                            checked={!!checks[cb.key]}
                                            onChange={e => setChecks(s => ({ ...s, [cb.key]: e.target.checked }))}
                                        />
                                        <span>{cb.label}{cb.required && <span className="text-red-500"> *</span>}</span>
                                    </label>
                                ))}

                                <div className="grid sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-xs font-bold text-charcoal/60">Tu nombre completo</label>
                                        <input
                                            value={signerName}
                                            onChange={e => setSignerName(e.target.value)}
                                            className="input-soft w-full mt-1"
                                            placeholder="Nombre y apellido"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-charcoal/60">Soy</label>
                                        <select value={relationship} onChange={e => setRelationship(e.target.value)} className="input-soft w-full mt-1">
                                            <option value="tutor">Tutor/a responsable</option>
                                            <option value="familiar">Familiar</option>
                                            <option value="otro">Persona autorizada</option>
                                        </select>
                                    </div>
                                </div>

                                {/* Elegir método — dibujar siempre disponible; solo se fuerza si la plantilla exige firma dibujada */}
                                {mode !== 'drawn' && (
                                    <div className="flex text-xs rounded-lg border border-silk-beige overflow-hidden w-full">
                                        <button type="button" onClick={() => setSigMode('accept')}
                                            className={`flex-1 px-3 py-2 font-bold ${sigMode === 'accept' ? 'bg-primary-500 text-white' : 'bg-white text-charcoal/50'}`}>
                                            Aceptar
                                        </button>
                                        <button type="button" onClick={() => setSigMode('draw')}
                                            className={`flex-1 px-3 py-2 font-bold ${sigMode === 'draw' ? 'bg-primary-500 text-white' : 'bg-white text-charcoal/50'}`}>
                                            Dibujar mi firma
                                        </button>
                                    </div>
                                )}

                                {sigMode === 'draw' ? (
                                    <div>
                                        <label className="text-xs font-bold text-charcoal/60 mb-1 block">Dibuja tu firma y toca "Usar esta firma"</label>
                                        <SignaturePad onSave={(blob) => setDrawnBlob(blob)} />
                                        {drawnBlob && <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Firma lista</p>}
                                    </div>
                                ) : (
                                    <label className="flex items-start gap-2 text-sm text-charcoal/80">
                                        <input type="checkbox" className="mt-1" checked={readAck} onChange={e => setReadAck(e.target.checked)} />
                                        <span>He leído y acepto este consentimiento en representación de la mascota. <span className="text-red-500">*</span></span>
                                    </label>
                                )}

                                {error && <p className="text-sm text-red-600">{error}</p>}

                                <button
                                    onClick={() => handleSign(sigMode === 'draw' ? 'drawn' : (mode === 'typed' ? 'typed' : 'one_click'))}
                                    disabled={submitting}
                                    className="w-full py-3 rounded-xl font-bold text-white flex items-center justify-center gap-2 disabled:opacity-50"
                                    style={{ background: `linear-gradient(135deg, ${brand}, ${brandTo})` }}
                                >
                                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <PenLine className="w-4 h-4" />}
                                    {submitting ? 'Firmando…' : 'Firmar y aceptar'}
                                </button>
                                <p className="text-[11px] text-charcoal/40 text-center">
                                    Al firmar se registra la fecha, la hora y el dispositivo desde el que aceptas, como respaldo del consentimiento.
                                </p>
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
