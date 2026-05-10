import React from 'react'
import { 
    Calendar, 
    ArrowUpCircle, 
    ArrowDownCircle, 
    Zap, 
    Clock, 
    CheckCircle2, 
    AlertCircle 
} from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { cn } from '@/lib/utils'

interface Transaction {
    id: string
    created_at: string
    type: 'monthly_refill' | 'purchase' | 'consumption' | 'adjustment'
    amount: number
    description: string
    balance_after: number
}

interface AITransactionHistoryProps {
    transactions: Transaction[]
    isLoading: boolean
}

const typeConfig = {
    monthly_refill: {
        label: 'Recarga Mensual',
        icon: Zap,
        color: 'text-primary-500',
        bg: 'bg-primary-50',
    },
    purchase: {
        label: 'Compra Extra',
        icon: ArrowUpCircle,
        color: 'text-emerald-500',
        bg: 'bg-emerald-50',
    },
    consumption: {
        label: 'Consumo IA',
        icon: ArrowDownCircle,
        color: 'text-amber-500',
        bg: 'bg-amber-50',
    },
    adjustment: {
        label: 'Ajuste',
        icon: AlertCircle,
        color: 'text-slate-500',
        bg: 'bg-slate-50',
    }
}

export const AITransactionHistory: React.FC<AITransactionHistoryProps> = ({ transactions, isLoading }) => {
    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
                <div className="w-12 h-12 border-4 border-primary-100 border-t-primary-500 rounded-full animate-spin" />
                <p className="text-sm font-bold text-charcoal/40 uppercase tracking-widest">Cargando transacciones...</p>
            </div>
        )
    }

    if (transactions.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-center px-4">
                <div className="w-16 h-16 bg-silk-beige/30 rounded-3xl flex items-center justify-center mb-4">
                    <Clock className="w-8 h-8 text-charcoal/20" />
                </div>
                <h3 className="text-lg font-black text-charcoal mb-1">Sin movimientos aún</h3>
                <p className="text-sm font-bold text-charcoal/40 max-w-xs">Tus recargas y consumos de IA aparecerán aquí una vez que comiences a usar el sistema.</p>
            </div>
        )
    }

    return (
        <div className="overflow-x-auto rounded-[2rem] border border-silk-beige shadow-sm bg-white">
            <table className="w-full text-left border-collapse">
                <thead>
                    <tr className="bg-silk-beige/20 border-b border-silk-beige">
                        <th className="px-6 py-5 text-[10px] font-black text-charcoal/40 uppercase tracking-widest">Fecha</th>
                        <th className="px-6 py-5 text-[10px] font-black text-charcoal/40 uppercase tracking-widest">Concepto</th>
                        <th className="px-6 py-5 text-[10px] font-black text-charcoal/40 uppercase tracking-widest">Descripción</th>
                        <th className="px-6 py-5 text-[10px] font-black text-charcoal/40 uppercase tracking-widest text-center">Cantidad</th>
                        <th className="px-6 py-5 text-[10px] font-black text-charcoal/40 uppercase tracking-widest text-right">Saldo Final</th>
                        <th className="px-6 py-5 text-[10px] font-black text-charcoal/40 uppercase tracking-widest text-center">Estado</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-silk-beige/50">
                    {transactions.map((tx) => {
                        const config = typeConfig[tx.type] || typeConfig.adjustment
                        const Icon = config.icon

                        return (
                            <tr key={tx.id} className="hover:bg-ivory/30 transition-colors group">
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-white rounded-xl shadow-sm border border-silk-beige group-hover:scale-110 transition-transform">
                                            <Calendar className="w-4 h-4 text-charcoal/40" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-black text-charcoal">
                                                {format(new Date(tx.created_at), 'dd MMM, yyyy', { locale: es })}
                                            </p>
                                            <p className="text-[10px] font-bold text-charcoal/30 uppercase">
                                                {format(new Date(tx.created_at), 'HH:mm')}
                                            </p>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <div className={cn("inline-flex items-center gap-2 px-3 py-1.5 rounded-full", config.bg)}>
                                        <Icon className={cn("w-3 h-3", config.color)} />
                                        <span className={cn("text-[10px] font-black uppercase tracking-wider", config.color)}>
                                            {config.label}
                                        </span>
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <p className="text-sm font-medium text-charcoal/60 leading-tight">
                                        {tx.description}
                                    </p>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-center">
                                    <p className={cn(
                                        "text-sm font-black tabular-nums",
                                        tx.amount > 0 ? "text-emerald-500" : "text-amber-500"
                                    )}>
                                        {tx.amount > 0 ? '+' : ''}{tx.amount.toLocaleString()}
                                    </p>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-right">
                                    <p className="text-sm font-black text-charcoal tabular-nums">
                                        {tx.balance_after?.toLocaleString() || '---'}
                                    </p>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-center">
                                    <div className="flex items-center justify-center">
                                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shadow-sm rounded-full" />
                                    </div>
                                </td>
                            </tr>
                        )
                    })}
                </tbody>
            </table>
        </div>
    )
}
