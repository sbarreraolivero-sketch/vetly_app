import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { 
    ArrowLeft, 
    Sparkles, 
    Zap, 
    History, 
    Download,
    Filter,
    Search
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { AITransactionHistory } from '@/components/dashboard/AITransactionHistory'
import { toast } from 'react-hot-toast'

export default function AICredits() {
    const { profile } = useAuth()
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
                const { data, error } = await supabase
                    .from('ai_credit_transactions')
                    .select('*')
                    .eq('clinic_id', profile.clinic_id)
                    .order('created_at', { ascending: false })

                if (error) throw error
                setTransactions(data || [])

                // Fetch current credits stats from clinic_settings
                const { data: settings, error: settingsError } = await supabase
                    .from('clinic_settings')
                    .select('ai_credits_monthly_limit, ai_credits_extra_balance, ai_credits_extra_4o, ai_credits_monthly_mini_used, created_at')
                    .eq('id', profile.clinic_id)
                    .single()

                if (settingsError) throw settingsError

                // Calculate next recharge date
                const createdAt = new Date(settings.created_at)
                const today = new Date()
                let nextRecharge = new Date(today.getFullYear(), today.getMonth(), createdAt.getDate())
                if (nextRecharge <= today) {
                    nextRecharge = new Date(today.getFullYear(), today.getMonth() + 1, createdAt.getDate())
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
        <div className="min-h-screen bg-ivory/30 pb-20">
            {/* Header */}
            <div className="bg-white border-b border-silk-beige sticky top-0 z-30">
                <div className="max-w-7xl mx-auto px-4 h-20 flex items-center justify-between">
                    <div className="flex items-center gap-6">
                        <button 
                            onClick={handleBack}
                            className="p-3 hover:bg-ivory rounded-2xl transition-all group"
                        >
                            <ArrowLeft className="w-5 h-5 text-charcoal/40 group-hover:text-primary-500 group-hover:-translate-x-1 transition-all" />
                        </button>
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-primary-500 rounded-2xl flex items-center justify-center shadow-lg shadow-primary-500/20">
                                <Sparkles className="w-6 h-6 text-white" />
                            </div>
                            <div>
                                <h1 className="text-xl font-black text-charcoal tracking-tight">Historial de Créditos IA</h1>
                                <p className="text-[10px] font-black text-charcoal/30 uppercase tracking-widest">Control y transparencia de consumo</p>
                            </div>
                        </div>
                    </div>

                    <div className="hidden md:flex items-center gap-4">
                        <button className="btn-secondary px-6 py-2.5 flex items-center gap-2 opacity-50 cursor-not-allowed">
                            <Download className="w-4 h-4" /> Exportar
                        </button>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 mt-10">
                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
                    <div className="card-soft p-6 bg-charcoal text-white border-0 shadow-xl relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-primary-500/10 rounded-full -mr-16 -mt-16 blur-2xl group-hover:scale-150 transition-transform duration-700" />
                        <p className="text-[10px] font-black text-primary-400 uppercase tracking-widest mb-1 relative z-10">Saldo Disponible</p>
                        <p className="text-4xl font-black tabular-nums relative z-10">{stats.totalCredits.toLocaleString()}</p>
                        <div className="flex items-center gap-2 mt-4 text-[11px] font-bold text-white/40 uppercase tracking-widest relative z-10">
                            <Zap className="w-3 h-3 text-primary-400" /> Créditos Vetly Global
                        </div>
                    </div>

                    <div className="card-soft p-6 bg-white border-silk-beige shadow-sm hover:shadow-md transition-all">
                        <p className="text-[10px] font-black text-charcoal/30 uppercase tracking-widest mb-1">Próxima Recarga</p>
                        <p className="text-2xl font-black text-charcoal">{stats.nextRecharge}</p>
                        <div className="flex items-center gap-2 mt-4 text-[11px] font-bold text-emerald-500 uppercase tracking-widest">
                            <History className="w-3 h-3" /> Renovación Automática
                        </div>
                    </div>

                    <div className="card-soft p-6 bg-white border-silk-beige shadow-sm hover:shadow-md transition-all">
                        <p className="text-[10px] font-black text-charcoal/30 uppercase tracking-widest mb-1">Consumo Actual</p>
                        <p className="text-2xl font-black text-charcoal">{stats.monthlyUsed.toLocaleString()}</p>
                        <div className="flex items-center gap-2 mt-4 text-[11px] font-bold text-amber-500 uppercase tracking-widest">
                            <Zap className="w-3 h-3" /> Ciclo de Facturación
                        </div>
                    </div>
                </div>

                {/* Filters & Actions */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                    <div className="flex items-center gap-3">
                        <div className="relative flex-1 md:w-64">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal/30" />
                            <input 
                                type="text" 
                                placeholder="Buscar transacciones..." 
                                className="w-full pl-10 pr-4 py-2.5 bg-white border border-silk-beige rounded-2xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all shadow-sm"
                            />
                        </div>
                        <button className="p-2.5 bg-white border border-silk-beige rounded-2xl hover:bg-ivory transition-all shadow-sm">
                            <Filter className="w-4 h-4 text-charcoal/40" />
                        </button>
                    </div>
                    
                    <p className="text-[10px] font-black text-charcoal/30 uppercase tracking-widest">
                        Mostrando {transactions.length} transacciones
                    </p>
                </div>

                {/* History Table */}
                <AITransactionHistory 
                    transactions={transactions} 
                    isLoading={isLoading} 
                />

                <div className="mt-8 p-6 bg-white/50 rounded-[2rem] border border-dashed border-silk-beige flex flex-col md:flex-row items-center justify-between gap-6">
                    <div className="flex items-center gap-4 text-left">
                        <div className="w-10 h-10 bg-silk-beige/20 rounded-xl flex items-center justify-center">
                            <Zap className="w-5 h-5 text-charcoal/20" />
                        </div>
                        <div>
                            <p className="text-sm font-black text-charcoal">¿Necesitas más créditos?</p>
                            <p className="text-xs font-medium text-charcoal/40 leading-tight">Puedes adquirir packs adicionales desde el panel de configuración de IA.</p>
                        </div>
                    </div>
                    <button 
                        onClick={handleBack}
                        className="btn-primary px-8 py-3 shadow-lg shadow-primary-500/10 active:scale-95 transition-all"
                    >
                        Adquirir Créditos
                    </button>
                </div>
            </div>
        </div>
    )
}
