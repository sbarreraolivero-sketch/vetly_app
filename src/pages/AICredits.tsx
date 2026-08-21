import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { 
    History, 
    Filter,
    ChevronRight,
    Calendar,
    Plus
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { usePlan } from '@/hooks/usePlan'
import { CREDIT_PACKS, redirectToCreditsCheckout } from '@/lib/mercadopago'
import { openPaddleCreditsCheckout } from '@/lib/paddle'
import { AITransactionHistory } from '@/components/dashboard/AITransactionHistory'
import { toast } from 'react-hot-toast'

export default function AICredits() {
    const { profile, user } = useAuth()
    const { planId } = usePlan()

    // Core no tiene agente conversacional: sus créditos se van sólo en el
    // análisis de facturas del inventario. Por eso se le ofrece un único pack
    // chico, no los tres pensados para clínicas con el agente activo.
    const esCore = planId === 'core'
    const packFacturas = CREDIT_PACKS['pack_facturas']
    const [comprando, setComprando] = useState(false)

    const comprarPack = async () => {
        if (!profile?.clinic_id || !user?.email || comprando) return
        setComprando(true)
        try {
            // Chile paga por MercadoPago; el resto por Paddle. Si el pack aún no
            // existe en Paddle, `openPaddleCreditsCheckout` lanza con un mensaje
            // claro en vez de abrir un overlay roto.
            const esChile = (profile as { country?: string } | null)?.country !== 'international'
            if (esChile) {
                await redirectToCreditsCheckout(profile.clinic_id, user.email, 'pack_facturas', 'mini')
            } else {
                await openPaddleCreditsCheckout(profile.clinic_id, user.email, 'pack_facturas', 'mini')
            }
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'No pudimos abrir el pago. Intenta de nuevo.')
        } finally {
            setComprando(false)
        }
    }
    const navigate = useNavigate()
    const [transactions, setTransactions] = useState<any[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [stats, setStats] = useState({
        totalCredits: 0,
        monthlyUsed: 0,
        nextRecharge: ''
    })

    useEffect(() => {
        const fetchData = async () => {
            if (!profile?.clinic_id) return

            setIsLoading(true)
            try {
                // Fetch transactions
                const { data, error } = await (supabase as any)
                    .from('ai_credit_transactions')
                    .select('*')
                    .eq('clinic_id', profile.clinic_id)
                    .order('created_at', { ascending: false })

                if (error) throw error
                setTransactions(data || [])

                // Fetch current credits stats from clinic_settings
                const { data: settingsData, error: settingsError } = await (supabase as any)
                    .from('clinic_settings')
                    .select('ai_credits_monthly_limit, ai_credits_extra_balance, ai_credits_extra_4o, ai_credits_monthly_mini_used, created_at')
                    .eq('id', profile.clinic_id)
                    .single()

                if (settingsError) throw settingsError
                
                const settings = settingsData as any

                // Calculate next recharge date — clamp to last day of month to avoid overflow (e.g. Jan-31 → Feb-28)
                const createdDay = new Date(settings.created_at).getDate()
                const today = new Date()
                const clampToMonth = (y: number, m: number, d: number) => {
                    const lastDay = new Date(y, m + 1, 0).getDate()
                    return new Date(y, m, Math.min(d, lastDay))
                }
                let nextRecharge = clampToMonth(today.getFullYear(), today.getMonth(), createdDay)
                if (nextRecharge <= today) {
                    nextRecharge = clampToMonth(today.getFullYear(), today.getMonth() + 1, createdDay)
                }

                setStats({
                    totalCredits: (settings.ai_credits_monthly_limit || 0) + (settings.ai_credits_extra_balance || 0) + (settings.ai_credits_extra_4o || 0),
                    monthlyUsed: settings.ai_credits_monthly_mini_used || 0,
                    nextRecharge: nextRecharge.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })
                })

            } catch (error: any) {
                console.error('Error fetching credit data:', error)
                toast.error('Error al cargar el historial: ' + error.message)
            } finally {
                setIsLoading(false)
            }
        }

        fetchData()
    }, [profile?.clinic_id])

    const handleBack = () => {
        navigate('/app/settings?tab=ai')
    }

    return (
        <div className="min-h-screen bg-ivory/20 pb-20 pt-10">
            <div className="max-w-6xl mx-auto px-6">
                {/* Back Link - Citenly Style */}
                <button 
                    onClick={handleBack}
                    className="flex items-center gap-2 text-[11px] font-black text-charcoal/40 hover:text-primary-500 transition-colors uppercase tracking-[0.2em] mb-8 group"
                >
                    <ChevronRight className="w-3 h-3 rotate-180 group-hover:-translate-x-1 transition-transform" />
                    Volver a Configuración
                </button>

                {/* Page Header - Citenly Style but Vetly Blue */}
                <div className="flex items-start gap-6 mb-12">
                    <div className="w-20 h-20 bg-primary-600 rounded-[2rem] flex items-center justify-center shadow-2xl shadow-primary-500/30 shrink-0">
                        <History className="w-10 h-10 text-white" />
                    </div>
                    <div className="pt-2">
                        <h1 className="text-3xl font-black text-charcoal tracking-tight">Historial de Créditos IA</h1>
                        <p className="text-sm font-bold text-charcoal/40 uppercase tracking-widest mt-1">
                            Control detallado de recargas mensuales y consumos por mensaje.
                        </p>
                    </div>
                </div>

                {/* Compra de créditos — visible para Core, que no puede entrar a
                    Ajustes IA (bloqueado desde Starter) y por lo tanto no tenía
                    ninguna vía para comprar. */}
                {esCore && (
                    <div id="comprar" className="card-soft bg-white border-2 border-primary-500 shadow-premium-lg p-8 mb-8">
                        <div className="flex flex-col md:flex-row md:items-center gap-6">
                            <div className="flex-1">
                                <p className="text-[11px] font-black text-primary-600 uppercase tracking-[0.2em] mb-2">Análisis de facturas</p>
                                <h2 className="text-2xl font-black text-charcoal tracking-tight mb-2">{packFacturas.name}</h2>
                                <p className="text-sm text-charcoal/60 leading-relaxed max-w-md">
                                    Sube la factura de tu proveedor y los productos se cargan solos al
                                    inventario. Cada archivo consume 20 créditos — este pack alcanza para
                                    unas <strong className="text-charcoal">30 facturas</strong>.
                                </p>
                                <p className="text-xs text-charcoal/45 mt-3">
                                    Pago único · <strong className="text-charcoal/70">los créditos no vencen</strong> · sin suscripción
                                </p>
                            </div>
                            <div className="shrink-0 text-center md:text-right">
                                <p className="text-4xl font-black text-charcoal tracking-tight">
                                    ${packFacturas.price.toLocaleString('es-CL')}
                                </p>
                                <p className="text-xs text-charcoal/40 mb-4">{packFacturas.credits} créditos</p>
                                <button
                                    onClick={comprarPack}
                                    disabled={comprando}
                                    className="btn-primary px-8 py-3 w-full md:w-auto disabled:opacity-60"
                                >
                                    {comprando ? 'Abriendo pago…' : 'Comprar pack'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Main Card Wrapper */}
                <div className="card-soft bg-white border border-silk-beige shadow-premium-lg overflow-hidden">
                    {/* Inner Header */}
                    <div className="px-8 py-6 border-b border-silk-beige bg-ivory/10 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-primary-50 rounded-2xl flex items-center justify-center border border-primary-100">
                                <History className="w-5 h-5 text-primary-500" />
                            </div>
                            <div>
                                <h2 className="text-xs font-black text-charcoal uppercase tracking-widest">Historial de Transacciones</h2>
                                <p className="text-[10px] font-bold text-charcoal/30 uppercase tracking-widest mt-0.5">Transparencia total en el consumo de tu IA</p>
                            </div>
                        </div>
                        
                        <div className="flex items-center gap-3">
                             <div className="text-right mr-4 hidden md:block">
                                <p className="text-[10px] font-black text-charcoal/30 uppercase tracking-widest">Saldo Total</p>
                                <p className="text-lg font-black text-primary-600 tabular-nums">{stats.totalCredits.toLocaleString()}</p>
                            </div>
                            <button className="p-2.5 bg-white border border-silk-beige rounded-xl hover:bg-ivory transition-all shadow-sm">
                                <Filter className="w-4 h-4 text-charcoal/40" />
                            </button>
                        </div>
                    </div>

                    {/* Table Area */}
                    <div className="p-0">
                        <AITransactionHistory 
                            transactions={transactions} 
                            isLoading={isLoading} 
                        />
                    </div>

                    {/* Inner Footer - Citenly Style */}
                    <div className="px-8 py-5 border-t border-silk-beige bg-ivory/5 flex items-center justify-between">
                        <p className="text-[10px] font-black text-charcoal/30 italic uppercase tracking-widest">
                            * Los créditos remanentes se suman automáticamente al inicio de cada ciclo mensual.
                        </p>
                        <div className="flex items-center gap-2 text-charcoal/40">
                            <Calendar className="w-4 h-4" />
                            <span className="text-[10px] font-black uppercase tracking-widest">Siguiente Recarga: {stats.nextRecharge}</span>
                        </div>
                    </div>
                </div>

                {/* Upsell section below main card */}
                <div className="mt-10 flex items-center justify-center">
                    <button 
                        onClick={handleBack}
                        className="group flex items-center gap-4 bg-white/50 hover:bg-white p-2 pr-8 rounded-full border border-silk-beige transition-all shadow-sm hover:shadow-md"
                    >
                        <div className="w-10 h-10 bg-primary-500 rounded-full flex items-center justify-center text-white">
                            <Plus className="w-5 h-5" />
                        </div>
                        <span className="text-xs font-black text-charcoal uppercase tracking-widest">Adquirir más Créditos IA</span>
                    </button>
                </div>
            </div>
        </div>
    )
}
