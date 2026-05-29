import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { createClient } from '@supabase/supabase-js'

const publicClient = createClient(
    import.meta.env.VITE_SUPABASE_URL || '',
    import.meta.env.VITE_SUPABASE_ANON_KEY || '',
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
)

interface Vaccine { type: string; brand: string | null; application_date: string; next_dose_date: string | null }
interface Deworming { type: string; brand: string | null; application_date: string; next_dose_date: string | null }
interface MedicalEvent { event_date: string; event_type: string; diagnosis: string | null; procedure_notes: string | null; weight: number | null }
interface Patient {
    id: string; name: string; species: string | null; breed: string | null
    sex: string | null; dob: string | null; is_sterilized: boolean
    vaccines: Vaccine[]; dewormings: Deworming[]; medical_history: MedicalEvent[]
}
interface PortalData {
    tutor: { name: string; loyalty_points: number; referral_code: string; referral_count: number }
    clinic: { name: string; phone: string; loyalty_points_name: string | null; loyalty_currency_symbol: string | null; loyalty_enabled: boolean }
    patients: Patient[]
    appointments: { service: string; appointment_date: string; status: string; patient_name: string }[]
}

// ── Helpers ────────────────────────────────────────────────────────────────
const MONTHS = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
function fmt(d: string | null) {
    if (!d) return null
    const dt = new Date(d)
    return `${dt.getDate()} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`
}
function age(dob: string | null) {
    if (!dob) return null
    const m = (new Date().getFullYear() - new Date(dob).getFullYear()) * 12 + new Date().getMonth() - new Date(dob).getMonth()
    return m < 12 ? `${m}m` : `${Math.floor(m / 12)}a`
}
function daysUntil(d: string | null) {
    if (!d) return null
    return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000)
}
function dueBadge(dateStr: string | null) {
    const days = daysUntil(dateStr)
    if (days === null) return null
    if (days < 0) return { label: 'Vencida', cls: 'bg-red-50 text-red-600 border border-red-200' }
    if (days <= 30) return { label: `${days}d`, cls: 'bg-amber-50 text-amber-600 border border-amber-200' }
    return { label: fmt(dateStr)!, cls: 'bg-emerald-50 text-emerald-600 border border-emerald-200' }
}
function sexLabel(s: string | null) {
    return ['H','F','FN'].includes(s || '') ? 'Hembra' : s ? 'Macho' : null
}
function speciesIcon(s: string | null) {
    const v = (s || '').toLowerCase()
    if (v.includes('gato') || v.includes('felino')) return '🐱'
    if (v.includes('perro') || v.includes('canino')) return '🐶'
    return '🐾'
}
function statusStyle(s: string) {
    const m: Record<string, string> = {
        completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        confirmed: 'bg-sky-50 text-sky-700 border-sky-200',
        pending:   'bg-amber-50 text-amber-700 border-amber-200',
    }
    return m[s] || 'bg-gray-50 text-gray-600 border-gray-200'
}
function statusLabel(s: string) {
    const m: Record<string,string> = { completed:'Completada', confirmed:'Confirmada', pending:'Pendiente', no_show:'No asistió' }
    return m[s] || s
}

// ── Section header ──────────────────────────────────────────────────────────
function SectionTitle({ children }: { children: React.ReactNode }) {
    return <p className="text-[10px] font-black uppercase tracking-widest text-charcoal/30 mb-2">{children}</p>
}

// ── Pill ────────────────────────────────────────────────────────────────────
function Pill({ label, cls }: { label: string; cls: string }) {
    return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cls}`}>{label}</span>
}

export default function PetOwnerPortal() {
    const { code } = useParams<{ code: string }>()
    const [data, setData] = useState<PortalData | null>(null)
    const [loading, setLoading] = useState(true)
    const [copied, setCopied] = useState(false)
    const [openPet, setOpenPet] = useState<string | null>(null)

    useEffect(() => {
        if (!code) { setLoading(false); return }
        ;(publicClient as any).rpc('get_pet_owner_portal', { p_code: code.toUpperCase() })
            .then(({ data: res, error: e }: any) => {
                if (e) console.error('[Portal]', e)
                setData(res ?? null)
                setLoading(false)
                if (res?.patients?.[0]) setOpenPet(res.patients[0].id)
            })
            .catch((e: any) => { console.error('[Portal]', e); setLoading(false) })
    }, [code])

    const copyLink = () => {
        if (!data) return
        navigator.clipboard.writeText(`${window.location.origin}/r/${data.tutor.referral_code}`)
        setCopied(true); setTimeout(() => setCopied(false), 2000)
    }

    if (loading) return (
        <div className="flex h-screen items-center justify-center bg-white">
            <div className="w-8 h-8 rounded-full border-4 border-primary-500 border-t-transparent animate-spin" />
        </div>
    )
    if (!data) return (
        <div className="flex h-screen flex-col items-center justify-center bg-white gap-3 px-6 text-center">
            <span className="text-4xl">🐾</span>
            <p className="text-lg font-black text-charcoal">Portal no encontrado</p>
            <p className="text-sm text-charcoal/40">El enlace puede ser incorrecto o haber expirado.</p>
        </div>
    )

    const { tutor, clinic, patients, appointments } = data
    const sym = clinic.loyalty_currency_symbol || 'pts'

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Top bar */}
            <div className="bg-primary-600 px-4 py-5">
                <p className="text-[10px] font-black uppercase tracking-widest text-primary-200">{clinic.name}</p>
                <div className="flex items-center gap-3 mt-2">
                    <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white font-black text-sm flex-shrink-0">
                        {tutor.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <h1 className="text-white font-black text-lg leading-tight">Hola, {tutor.name.split(' ')[0]} 👋</h1>
                        <p className="text-primary-200 text-xs">Portal de salud de tus mascotas</p>
                    </div>
                </div>
            </div>

            <div className="max-w-lg mx-auto px-4 py-4 space-y-4">

                {/* Puntos + referido */}
                {clinic.loyalty_enabled && (
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                        <div className="flex divide-x divide-gray-100">
                            <div className="flex-1 px-4 py-4 text-center">
                                <p className="text-[10px] font-black uppercase tracking-widest text-charcoal/30">Saldo</p>
                                <p className="text-2xl font-black text-charcoal mt-0.5">{tutor.loyalty_points || 0}<span className="text-xs font-bold text-primary-500 ml-1">{sym}</span></p>
                            </div>
                            <div className="flex-1 px-4 py-4 text-center">
                                <p className="text-[10px] font-black uppercase tracking-widest text-charcoal/30">Referidos</p>
                                <p className="text-2xl font-black text-charcoal mt-0.5">{tutor.referral_count || 0}</p>
                            </div>
                        </div>
                        <div className="border-t border-gray-100 px-4 py-3">
                            <p className="text-[10px] text-charcoal/40 mb-1.5">Tu enlace de referido:</p>
                            <button onClick={copyLink} className="w-full flex items-center justify-between bg-gray-50 border border-gray-100 rounded-xl px-3 py-2 active:scale-[.98] transition-transform">
                                <span className="font-mono text-xs font-bold text-primary-600 truncate">vetly.pro/r/{tutor.referral_code}</span>
                                <span className="text-[10px] font-black text-primary-500 ml-2 flex-shrink-0">{copied ? '✓ Copiado' : 'Copiar'}</span>
                            </button>
                        </div>
                    </div>
                )}

                {/* Mascotas */}
                {patients.map(pet => (
                    <div key={pet.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                        {/* Header de mascota */}
                        <button
                            className="w-full flex items-center gap-3 px-4 py-4 text-left"
                            onClick={() => setOpenPet(openPet === pet.id ? null : pet.id)}
                        >
                            <div className="w-11 h-11 rounded-full bg-primary-50 flex items-center justify-center text-xl flex-shrink-0">
                                {speciesIcon(pet.species)}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="font-black text-charcoal text-base">{pet.name}</p>
                                <p className="text-xs text-charcoal/40 truncate">
                                    {[pet.species, pet.breed].filter(Boolean).join(' · ')}
                                    {pet.dob && ` · ${age(pet.dob)}`}
                                </p>
                            </div>
                            <div className="flex flex-col items-end gap-1 flex-shrink-0">
                                {pet.is_sterilized && (
                                    <span className="text-[9px] font-black uppercase tracking-wide bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded-full border border-emerald-100">
                                        Esterilizado/a
                                    </span>
                                )}
                                <span className="text-charcoal/30 text-sm">{openPet === pet.id ? '▲' : '▼'}</span>
                            </div>
                        </button>

                        {openPet === pet.id && (
                            <div className="border-t border-gray-100">

                                {/* Datos básicos */}
                                <div className="grid grid-cols-3 divide-x divide-gray-100 border-b border-gray-100">
                                    {[
                                        { label: 'Especie', value: pet.species },
                                        { label: 'Sexo', value: sexLabel(pet.sex) },
                                        { label: 'Nacimiento', value: fmt(pet.dob) },
                                    ].map(({ label, value }) => (
                                        <div key={label} className="px-3 py-3 text-center">
                                            <p className="text-[9px] font-black uppercase tracking-wide text-charcoal/30">{label}</p>
                                            <p className="text-xs font-bold text-charcoal mt-0.5">{value || '—'}</p>
                                        </div>
                                    ))}
                                </div>

                                <div className="px-4 py-4 space-y-5">

                                    {/* Vacunas */}
                                    <div>
                                        <SectionTitle>💉 Vacunas</SectionTitle>
                                        {pet.vaccines.length === 0
                                            ? <p className="text-xs text-charcoal/40">Sin registros</p>
                                            : <div className="space-y-2">
                                                {pet.vaccines.map((v, i) => {
                                                    const badge = dueBadge(v.next_dose_date)
                                                    return (
                                                        <div key={i} className="flex items-center justify-between gap-2 bg-gray-50 rounded-xl px-3 py-2.5">
                                                            <div className="min-w-0">
                                                                <p className="text-xs font-bold text-charcoal truncate">{v.type}</p>
                                                                <p className="text-[10px] text-charcoal/40">
                                                                    Aplicada: {fmt(v.application_date)}
                                                                    {v.brand ? ` · ${v.brand}` : ''}
                                                                </p>
                                                            </div>
                                                            {badge && (
                                                                <div className="flex-shrink-0 text-right">
                                                                    <p className="text-[9px] text-charcoal/30 mb-0.5">Próx. dosis</p>
                                                                    <Pill label={badge.label} cls={badge.cls} />
                                                                </div>
                                                            )}
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        }
                                    </div>

                                    {/* Desparasitaciones */}
                                    <div>
                                        <SectionTitle>🐛 Desparasitaciones</SectionTitle>
                                        {pet.dewormings.length === 0
                                            ? <p className="text-xs text-charcoal/40">Sin registros</p>
                                            : <div className="space-y-2">
                                                {pet.dewormings.map((d, i) => {
                                                    const badge = dueBadge(d.next_dose_date)
                                                    return (
                                                        <div key={i} className="flex items-center justify-between gap-2 bg-gray-50 rounded-xl px-3 py-2.5">
                                                            <div className="min-w-0">
                                                                <p className="text-xs font-bold text-charcoal">{d.type}</p>
                                                                <p className="text-[10px] text-charcoal/40">
                                                                    Aplicada: {fmt(d.application_date)}
                                                                    {d.brand ? ` · ${d.brand}` : ''}
                                                                </p>
                                                            </div>
                                                            {badge && (
                                                                <div className="flex-shrink-0 text-right">
                                                                    <p className="text-[9px] text-charcoal/30 mb-0.5">Próx. dosis</p>
                                                                    <Pill label={badge.label} cls={badge.cls} />
                                                                </div>
                                                            )}
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        }
                                    </div>

                                    {/* Historial médico */}
                                    {pet.medical_history.length > 0 && (
                                        <div>
                                            <SectionTitle>📋 Historial médico</SectionTitle>
                                            <div className="space-y-2">
                                                {pet.medical_history.map((ev, i) => (
                                                    <div key={i} className="bg-gray-50 rounded-xl px-3 py-2.5">
                                                        <div className="flex items-center justify-between gap-2">
                                                            <p className="text-xs font-bold text-charcoal">{ev.event_type}</p>
                                                            <div className="flex items-center gap-2">
                                                                {ev.weight && <span className="text-[10px] text-charcoal/40">{ev.weight} kg</span>}
                                                                <span className="text-[10px] text-charcoal/40">{fmt(ev.event_date)}</span>
                                                            </div>
                                                        </div>
                                                        {(ev.diagnosis || ev.procedure_notes) && (
                                                            <p className="text-[10px] text-charcoal/50 mt-0.5 line-clamp-2">
                                                                {ev.diagnosis || ev.procedure_notes}
                                                            </p>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                ))}

                {/* Citas */}
                {appointments.length > 0 && (
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                        <div className="px-4 pt-4 pb-2">
                            <SectionTitle>📅 Citas recientes</SectionTitle>
                        </div>
                        <div className="divide-y divide-gray-50">
                            {appointments.map((a, i) => {
                                const d = new Date(a.appointment_date)
                                return (
                                    <div key={i} className="flex items-center gap-3 px-4 py-3">
                                        <div className="w-9 h-9 rounded-xl bg-primary-50 flex flex-col items-center justify-center flex-shrink-0">
                                            <span className="text-xs font-black text-primary-600 leading-none">{d.getDate()}</span>
                                            <span className="text-[9px] text-primary-400 uppercase">{MONTHS[d.getMonth()]}</span>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-bold text-charcoal truncate">{a.service}</p>
                                            <p className="text-[10px] text-charcoal/40">{a.patient_name}</p>
                                        </div>
                                        <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-full border flex-shrink-0 ${statusStyle(a.status)}`}>
                                            {statusLabel(a.status)}
                                        </span>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )}

                {/* CTA */}
                <button
                    onClick={() => data.clinic.phone && window.open(`https://wa.me/${data.clinic.phone.replace(/\D/g,'')}`, '_blank')}
                    className="w-full bg-primary-600 hover:bg-primary-700 text-white font-black text-sm rounded-2xl py-4 active:scale-[.98] transition-all shadow-sm"
                >
                    💬 Agendar una cita por WhatsApp
                </button>

                <p className="text-center text-[10px] text-charcoal/20 pb-2">
                    Powered by <span className="font-black text-primary-400">Vetly</span>
                </p>
            </div>
        </div>
    )
}
