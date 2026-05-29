import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

export default function ReferralRedirect() {
    const { code } = useParams<{ code: string }>()
    const [error, setError] = useState(false)

    useEffect(() => {
        if (!code) { setError(true); return }

        ;(supabase as any).rpc('get_referral_link_data', { p_code: code.toUpperCase() })
            .then(({ data, error: rpcError }: any) => {
                if (rpcError || !data || data.length === 0) {
                    setError(true)
                    return
                }
                const { clinic_phone, tutor_name } = data[0]
                const phone = (clinic_phone || '').replace(/\D/g, '')
                const msg = tutor_name
                    ? `Hola! Me contacto de parte de ${tutor_name} 🐾 Mi código de referido es *${code.toUpperCase()}*. ¡Quiero agendar una cita!`
                    : `Hola! Tengo un código de referido: *${code.toUpperCase()}*. ¡Quiero agendar una cita!`
                const waUrl = phone
                    ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`
                    : `https://wa.me/?text=${encodeURIComponent(msg)}`
                window.location.href = waUrl
            })
    }, [code])

    if (error) {
        return (
            <div className="flex h-screen flex-col items-center justify-center bg-ivory gap-4 px-6 text-center">
                <p className="text-2xl font-black text-charcoal">Enlace inválido</p>
                <p className="text-charcoal/60">El código de referido no existe o expiró.</p>
            </div>
        )
    }

    return (
        <div className="flex h-screen flex-col items-center justify-center bg-ivory gap-4">
            <div className="w-10 h-10 rounded-full border-4 border-primary-500 border-t-transparent animate-spin" />
            <p className="text-charcoal/60 text-sm font-medium">Abriendo WhatsApp…</p>
        </div>
    )
}
