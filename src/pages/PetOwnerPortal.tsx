import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { createClient } from '@supabase/supabase-js'

// Cliente sin sesión para páginas públicas — evita conflicto de Web Locks con el dashboard
const publicClient = createClient(
    import.meta.env.VITE_SUPABASE_URL || '',
    import.meta.env.VITE_SUPABASE_ANON_KEY || '',
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
)

interface PortalData {
    tutor: {
        name: string
        loyalty_points: number
        referral_code: string
        referral_count: number
    }
    clinic: {
        name: string
        phone: string
        loyalty_points_name: string | null
        loyalty_currency_symbol: string | null
        loyalty_enabled: boolean
    }
    patients: {
        id: string
        name: string
        species: string | null
        breed: string | null
        sex: string | null
        dob: string | null
        is_sterilized: boolean
        next_vaccine: string | null
        last_vaccine_date: string | null
        next_deworming: string | null
    }[]
    appointments: {
        service: string
        appointment_date: string
        status: string
        patient_name: string
    }[]
}

function petAge(dob: string | null): string {
    if (!dob) return ''
    const birth = new Date(dob)
    const now = new Date()
    const months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth())
    if (months < 12) return `${months} mes${months !== 1 ? 'es' : ''}`
    const years = Math.floor(months / 12)
    return `${years} año${years !== 1 ? 's' : ''}`
}

function formatSex(sex: string | null): string {
    if (!sex) return ''
    return ['H', 'F', 'FN'].includes(sex) ? 'Hembra' : 'Macho'
}

function speciesEmoji(species: string | null): string {
    const s = (species || '').toLowerCase()
    if (s.includes('felino') || s.includes('gato')) return '🐱'
    if (s.includes('canino') || s.includes('perro')) return '🐶'
    return '🐾'
}

function statusColor(status: string) {
    if (status === 'completed') return 'bg-emerald-100 text-emerald-700'
    if (status === 'confirmed') return 'bg-sky-100 text-sky-700'
    if (status === 'pending') return 'bg-amber-100 text-amber-700'
    return 'bg-gray-100 text-gray-600'
}

function statusLabel(status: string) {
    const map: Record<string, string> = {
        completed: 'Completada', confirmed: 'Confirmada',
        pending: 'Pendiente', cancelled: 'Cancelada', no_show: 'No asistió',
    }
    return map[status] || status
}

function formatDate(dateStr: string | null): string {
    if (!dateStr) return 'Sin registro'
    const d = new Date(dateStr)
    const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`
}

function vaccineColor(dateStr: string | null): string {
    if (!dateStr) return 'text-charcoal/40'
    const d = new Date(dateStr)
    const daysLeft = Math.ceil((d.getTime() - Date.now()) / 86400000)
    if (daysLeft < 0) return 'text-red-600 font-bold'
    if (daysLeft <= 30) return 'text-amber-600 font-semibold'
    return 'text-emerald-600'
}

export default function PetOwnerPortal() {
    const { code } = useParams<{ code: string }>()
    const [data, setData] = useState<PortalData | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)

    useEffect(() => {
        if (!code) {
            setLoading(false)
            return
        }
        const upper = code.toUpperCase()
        ;(publicClient as any).rpc('get_pet_owner_portal', { p_code: upper })
            .then(({ data: res, error: rpcError }: any) => {
                if (rpcError) {
                    console.error('[Portal] RPC error:', rpcError)
                    setError(rpcError.message)
                } else {
                    setData(res ?? null)
                }
                setLoading(false)
            })
            .catch((e: any) => {
                console.error('[Portal] Catch:', e)
                setError(e?.message || 'Error desconocido')
                setLoading(false)
            })
    }, [code])

    const handleCopyCode = () => {
        if (!data) return
        navigator.clipboard.writeText(`${window.location.origin}/r/${data.tutor.referral_code}`)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    const handleWhatsApp = () => {
        if (!data?.clinic?.phone) return
        window.open(`https://wa.me/${data.clinic.phone.replace(/\D/g, '')}`, '_blank')
    }

    if (loading) return (
        <div className="flex h-screen items-center justify-center bg-ivory">
            <div className="w-10 h-10 rounded-full border-4 border-primary-500 border-t-transparent animate-spin" />
        </div>
    )

    if (!data) return (
        <div className="flex h-screen flex-col items-center justify-center bg-ivory gap-3 px-6 text-center">
            <span className="text-5xl">🐾</span>
            <p className="text-xl font-black text-charcoal">Portal no encontrado</p>
            <p className="text-sm text-charcoal/50">El enlace puede haber expirado o ser incorrecto.</p>
            {error && <p className="text-xs text-red-400 font-mono">{error}</p>}
        </div>
    )

    const { tutor, clinic, patients, appointments } = data
    const ptsName = clinic.loyalty_points_name || 'Puntos'
    const ptsSym = clinic.loyalty_currency_symbol || 'pts'

    return (
        <div className="min-h-screen bg-gradient-to-b from-primary-600 to-primary-800 pb-16">
            {/* Header */}
            <div className="px-5 pt-10 pb-6 text-white">
                <p className="text-xs font-black uppercase tracking-widest text-primary-200 mb-1">{clinic.name}</p>
                <h1 className="text-2xl font-black">Hola, {tutor.name.split(' ')[0]} 👋</h1>
                <p className="text-sm text-primary-200 mt-0.5">Este es el portal de tus mascotas</p>
            </div>

            <div className="px-4 space-y-4">
                {/* Loyalty card */}
                {clinic.loyalty_enabled && (
                    <div className="bg-white rounded-2xl p-5 shadow-sm">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs font-black uppercase tracking-widest text-charcoal/40 mb-0.5">{ptsName}</p>
                                <p className="text-3xl font-black text-charcoal">
                                    {tutor.loyalty_points || 0}
                                    <span className="text-sm font-bold text-primary-500 ml-1">{ptsSym}</span>
                                </p>
                            </div>
                            <div className="text-right">
                                <p className="text-xs text-charcoal/40 mb-0.5">Amigos referidos</p>
                                <p className="text-2xl font-black text-charcoal">{tutor.referral_count || 0}</p>
                            </div>
                        </div>
                        <div className="mt-4 pt-4 border-t border-silk-beige">
                            <p className="text-xs text-charcoal/40 mb-2">Comparte tu enlace y gana {ptsName}:</p>
                            <button
                                onClick={handleCopyCode}
                                className="w-full flex items-center justify-between bg-primary-50 rounded-xl px-4 py-2.5 active:scale-95 transition-transform"
                            >
                                <span className="font-mono text-sm font-bold text-primary-700 truncate">
                                    vetly.pro/r/{tutor.referral_code}
                                </span>
                                <span className="text-xs font-black text-primary-500 ml-2 flex-shrink-0">
                                    {copied ? '¡Copiado! ✓' : 'Copiar'}
                                </span>
                            </button>
                        </div>
                    </div>
                )}

                {/* Pets */}
                <div>
                    <p className="text-xs font-black uppercase tracking-widest text-primary-200 mb-3 px-1">
                        Mis mascotas ({patients.length})
                    </p>
                    <div className="space-y-3">
                        {patients.length === 0 && (
                            <div className="bg-white rounded-2xl p-5 text-center text-charcoal/40 text-sm">
                                Aún no hay mascotas registradas
                            </div>
                        )}
                        {patients.map(pet => (
                            <div key={pet.id} className="bg-white rounded-2xl overflow-hidden shadow-sm">
                                <div className="flex items-center gap-3 p-4">
                                    <div className="w-12 h-12 rounded-full bg-primary-50 flex items-center justify-center text-2xl flex-shrink-0">
                                        {speciesEmoji(pet.species)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-black text-charcoal text-base leading-tight">{pet.name}</p>
                                        <p className="text-xs text-charcoal/50 truncate">
                                            {[pet.species, pet.breed].filter(Boolean).join(' · ')}
                                        </p>
                                    </div>
                                    <div className="text-right flex-shrink-0">
                                        {pet.dob && <p className="text-sm font-bold text-charcoal">{petAge(pet.dob)}</p>}
                                        <p className="text-xs text-charcoal/40">
                                            {[formatSex(pet.sex), pet.is_sterilized ? 'Esterilizado/a' : null].filter(Boolean).join(' · ')}
                                        </p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 divide-x divide-silk-beige border-t border-silk-beige">
                                    <div className="px-4 py-3">
                                        <p className="text-xs font-black uppercase tracking-wide text-charcoal/30 mb-0.5">Próx. Vacuna</p>
                                        <p className={`text-xs ${vaccineColor(pet.next_vaccine)}`}>
                                            {formatDate(pet.next_vaccine)}
                                        </p>
                                    </div>
                                    <div className="px-4 py-3">
                                        <p className="text-xs font-black uppercase tracking-wide text-charcoal/30 mb-0.5">Próx. Desparasitación</p>
                                        <p className={`text-xs ${vaccineColor(pet.next_deworming)}`}>
                                            {formatDate(pet.next_deworming)}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Recent appointments */}
                {appointments.length > 0 && (
                    <div>
                        <p className="text-xs font-black uppercase tracking-widest text-primary-200 mb-3 px-1">
                            Mis citas recientes
                        </p>
                        <div className="bg-white rounded-2xl overflow-hidden shadow-sm divide-y divide-silk-beige">
                            {appointments.map((appt, i) => {
                                const d = new Date(appt.appointment_date)
                                const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
                                return (
                                    <div key={i} className="flex items-center gap-3 px-4 py-3">
                                        <div className="w-10 h-10 rounded-xl bg-primary-50 flex flex-col items-center justify-center flex-shrink-0">
                                            <span className="text-xs font-black text-primary-600 leading-none">{d.getDate()}</span>
                                            <span className="text-[10px] text-primary-400 uppercase leading-none">{months[d.getMonth()]}</span>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-bold text-charcoal truncate">{appt.service}</p>
                                            <p className="text-xs text-charcoal/40">{appt.patient_name}</p>
                                        </div>
                                        <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-full flex-shrink-0 ${statusColor(appt.status)}`}>
                                            {statusLabel(appt.status)}
                                        </span>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )}

                {/* CTA */}
                <button
                    onClick={handleWhatsApp}
                    className="w-full bg-white text-primary-700 font-black text-sm rounded-2xl py-4 shadow-sm active:scale-95 transition-transform"
                >
                    💬 Agendar una cita por WhatsApp
                </button>

                <p className="text-center text-[10px] text-primary-300 pb-2">
                    Powered by <span className="font-black">Vetly</span>
                </p>
            </div>
        </div>
    )
}
