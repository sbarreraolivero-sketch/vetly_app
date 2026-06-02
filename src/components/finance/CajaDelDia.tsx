import { useState } from 'react'
import {
    ChevronDown,
    ChevronUp,
    Lock,
    Unlock,
    Plus,
    Clock,
    CheckCircle2,
    Banknote,
    CreditCard,
    ArrowRightLeft,
    X,
    Pencil,
    Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CashRegister } from '@/services/financeService'

interface Transaction {
    id: string
    appointment_date: string
    patient_name: string
    service: string
    price: number
    payment_status: 'pending' | 'paid' | 'partial' | 'refunded'
    payment_method?: string | null
    tutor_name?: string | null
}

interface IncomeEntry {
    id: string
    date: string
    description: string
    amount: number
    discount?: number
    payment_method?: string | null
    category: string
}

interface CajaDelDiaProps {
    date: string                       // 'YYYY-MM-DD'
    dateLabel: string                  // 'Lunes 1 Jun 2026'
    transactions: Transaction[]
    incomes: IncomeEntry[]
    cashRegister?: CashRegister | null
    currency: string
    onCloseCaja: (date: string) => void
    onAddIncome: (date: string) => void
    onEditIncome?: (incomeId: string) => void
    onDeleteIncome?: (incomeId: string, description: string) => void
    onMarkPaid?: (txId: string) => void
    onDeleteTransaction?: (txId: string) => void
    isClosing?: boolean
}

const PAYMENT_ICONS: Record<string, React.ReactNode> = {
    efectivo: <Banknote className="w-3.5 h-3.5" />,
    cash: <Banknote className="w-3.5 h-3.5" />,
    transferencia: <ArrowRightLeft className="w-3.5 h-3.5" />,
    transfer: <ArrowRightLeft className="w-3.5 h-3.5" />,
    tarjeta: <CreditCard className="w-3.5 h-3.5" />,
    'tarjeta credito': <CreditCard className="w-3.5 h-3.5" />,
    'tarjeta crédito': <CreditCard className="w-3.5 h-3.5" />,
    debito: <CreditCard className="w-3.5 h-3.5" />,
    débito: <CreditCard className="w-3.5 h-3.5" />,
}

function paymentIcon(method?: string | null) {
    const key = (method ?? '').toLowerCase()
    return PAYMENT_ICONS[key] ?? null
}

function paymentLabel(method?: string | null) {
    if (!method) return null
    const map: Record<string, string> = {
        efectivo: 'Efectivo',
        cash: 'Efectivo',
        transferencia: 'Transferencia',
        transfer: 'Transferencia',
        tarjeta: 'Tarjeta',
        'tarjeta credito': 'Tarjeta',
        'tarjeta crédito': 'Tarjeta',
        debito: 'Débito',
        débito: 'Débito',
        'tarjeta debito': 'Débito',
        'tarjeta débito': 'Débito',
    }
    return map[method.toLowerCase()] ?? method
}

export function CajaDelDia({
    date,
    dateLabel,
    transactions,
    incomes,
    cashRegister,
    currency,
    onCloseCaja,
    onAddIncome,
    onEditIncome,
    onDeleteIncome,
    onMarkPaid,
    onDeleteTransaction,
    isClosing = false,
}: CajaDelDiaProps) {
    const [expanded, setExpanded] = useState(false)

    const isClosed = cashRegister?.status === 'closed'
    const isToday = date === new Date().toISOString().split('T')[0]

    // Separar cobrado vs pendiente
    const cobradas = transactions.filter(t => t.payment_status === 'paid' || t.payment_status === 'partial')
    const pendientes = transactions.filter(t => t.payment_status === 'pending')

    const totalCobradoTx = cobradas.reduce((s, t) => s + (t.price ?? 0), 0)
    // inc.amount ya es el monto neto (después del descuento) — no restar discount de nuevo
    const totalIngresos = incomes.reduce((s, i) => s + (i.amount ?? 0), 0)
    const totalCobrado = totalCobradoTx + totalIngresos
    const totalPendiente = pendientes.reduce((s, t) => s + (t.price ?? 0), 0)

    // Desglose por método de pago (solo cobrado)
    const byMethod: Record<string, number> = {}
    for (const t of cobradas) {
        const k = (t.payment_method ?? 'otro').toLowerCase()
        byMethod[k] = (byMethod[k] ?? 0) + (t.price ?? 0)
    }
    for (const i of incomes) {
        const k = (i.payment_method ?? 'otro').toLowerCase()
        byMethod[k] = (byMethod[k] ?? 0) + (i.amount ?? 0)
    }

    const fmt = (n: number) => `${currency}${n.toLocaleString('es-CL')}`

    return (
        <div className={cn(
            'border rounded-xl overflow-hidden transition-all',
            isClosed ? 'border-charcoal/10 bg-white' : 'border-primary-200 bg-primary-50/30',
        )}>
            {/* Header colapsable */}
            <button
                onClick={() => setExpanded(v => !v)}
                className="w-full text-left"
            >
                <div className="px-5 py-4 flex items-center gap-4">
                    {/* Fecha + estado */}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2.5 flex-wrap">
                            <span className="font-bold text-charcoal text-sm">
                                {isToday ? '🗓 Hoy — ' : ''}{dateLabel}
                            </span>
                            {isClosed ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest bg-charcoal/8 text-charcoal/50 px-2 py-0.5 rounded-full">
                                    <Lock className="w-2.5 h-2.5" /> Cerrada
                                </span>
                            ) : isToday ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                                    <Unlock className="w-2.5 h-2.5" /> Abierta
                                </span>
                            ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                                    <Unlock className="w-2.5 h-2.5" /> Sin cerrar
                                </span>
                            )}
                        </div>
                        {/* Desglose por método */}
                        {Object.keys(byMethod).length > 0 && (
                            <div className="flex gap-3 mt-1.5 flex-wrap">
                                {Object.entries(byMethod).map(([method, amount]) => (
                                    <span key={method} className="inline-flex items-center gap-1 text-[11px] text-charcoal/50 font-medium">
                                        {paymentIcon(method)}
                                        {paymentLabel(method)}: {fmt(amount)}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Totales */}
                    <div className="text-right shrink-0">
                        <p className="text-base font-extrabold text-charcoal">{fmt(totalCobrado)}</p>
                        {totalPendiente > 0 && (
                            <p className="text-xs font-medium text-amber-600 mt-0.5">
                                {fmt(totalPendiente)} pendiente
                            </p>
                        )}
                    </div>

                    {/* Chevron */}
                    <div className="shrink-0 text-charcoal/30">
                        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                </div>
            </button>

            {/* Contenido expandido */}
            {expanded && (
                <div className="border-t border-charcoal/8">

                    {/* SECCIÓN COBRADO */}
                    <div className="px-5 pt-4 pb-2">
                        <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700 mb-2 flex items-center gap-1.5">
                            <CheckCircle2 className="w-3 h-3" />
                            Cobrado · {fmt(totalCobrado)}
                        </p>

                        {cobradas.length === 0 && incomes.length === 0 && (
                            <p className="text-xs text-charcoal/40 italic py-1">Sin cobros registrados</p>
                        )}

                        {/* Transacciones cobradas (desde appointments) */}
                        {cobradas.map(tx => (
                            <div key={tx.id} className="flex items-center gap-3 py-2 border-b border-silk-beige last:border-0">
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold text-charcoal truncate">{tx.service}</p>
                                    <p className="text-[11px] text-charcoal/50 truncate">{tx.patient_name}{tx.tutor_name ? ` · ${tx.tutor_name}` : ''}</p>
                                </div>
                                {tx.payment_method && (
                                    <span className="inline-flex items-center gap-1 text-[10px] text-charcoal/40 font-medium shrink-0">
                                        {paymentIcon(tx.payment_method)}
                                        {paymentLabel(tx.payment_method)}
                                    </span>
                                )}
                                <span className="text-xs font-bold text-charcoal shrink-0">{fmt(tx.price)}</span>
                            </div>
                        ))}

                        {/* Ingresos manuales */}
                        {incomes.map(inc => (
                            <div key={inc.id} className="flex items-center gap-3 py-2 border-b border-silk-beige last:border-0 group">
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold text-charcoal truncate">{inc.description}</p>
                                    <p className="text-[11px] text-charcoal/50">
                                        Ingreso manual
                                        {inc.discount ? ` · Desc. ${fmt(inc.discount)}` : ''}
                                    </p>
                                </div>
                                {inc.payment_method && (
                                    <span className="inline-flex items-center gap-1 text-[10px] text-charcoal/40 font-medium shrink-0">
                                        {paymentIcon(inc.payment_method)}
                                        {paymentLabel(inc.payment_method)}
                                    </span>
                                )}
                                <span className="text-xs font-bold text-charcoal shrink-0">
                                    {fmt(inc.amount ?? 0)}
                                </span>
                                {!isClosed && (onEditIncome || onDeleteIncome) && (
                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                        {onEditIncome && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onEditIncome(inc.id) }}
                                                className="p-1 text-charcoal/40 hover:text-primary-600 transition-colors rounded"
                                                title="Editar ingreso"
                                            >
                                                <Pencil className="w-3 h-3" />
                                            </button>
                                        )}
                                        {onDeleteIncome && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onDeleteIncome(inc.id, inc.description) }}
                                                className="p-1 text-charcoal/40 hover:text-red-500 transition-colors rounded"
                                                title="Eliminar ingreso"
                                            >
                                                <Trash2 className="w-3 h-3" />
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* SECCIÓN PENDIENTE */}
                    {pendientes.length > 0 && (
                        <div className="px-5 pt-2 pb-3 bg-amber-50/60">
                            <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 mb-2 flex items-center gap-1.5">
                                <Clock className="w-3 h-3" />
                                Pendiente de cobro · {fmt(totalPendiente)}
                            </p>
                            {pendientes.map(tx => (
                                <div key={tx.id} className="flex items-center gap-3 py-2 border-b border-amber-100 last:border-0 group">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs font-semibold text-charcoal truncate">{tx.service}</p>
                                        <p className="text-[11px] text-charcoal/50 truncate">{tx.patient_name}{tx.tutor_name ? ` · ${tx.tutor_name}` : ''}</p>
                                    </div>
                                    <span className="text-xs font-bold text-amber-700 shrink-0">{fmt(tx.price)}</span>
                                    {!isClosed && (onMarkPaid || onDeleteTransaction) && (
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                            {onMarkPaid && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); onMarkPaid(tx.id) }}
                                                    className="p-1 text-charcoal/40 hover:text-emerald-600 transition-colors rounded"
                                                    title="Registrar pago"
                                                >
                                                    <CheckCircle2 className="w-3 h-3" />
                                                </button>
                                            )}
                                            {onDeleteTransaction && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); onDeleteTransaction(tx.id) }}
                                                    className="p-1 text-charcoal/40 hover:text-red-500 transition-colors rounded"
                                                    title="Eliminar transacción"
                                                >
                                                    <Trash2 className="w-3 h-3" />
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Acciones */}
                    <div className="px-5 py-3 flex items-center gap-2 border-t border-charcoal/8 bg-white/60">
                        {!isClosed && (
                            <button
                                onClick={() => onAddIncome(date)}
                                className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-700 hover:text-primary-800 transition-colors"
                            >
                                <Plus className="w-3.5 h-3.5" />
                                Agregar ingreso
                            </button>
                        )}
                        <div className="flex-1" />
                        {!isClosed && (
                            <button
                                onClick={() => onCloseCaja(date)}
                                disabled={isClosing}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-charcoal text-white text-xs font-bold rounded-lg hover:bg-charcoal/80 transition-colors disabled:opacity-50"
                            >
                                <Lock className="w-3 h-3" />
                                {isClosing ? 'Cerrando...' : 'Cerrar caja'}
                            </button>
                        )}
                        {isClosed && cashRegister?.closed_at && (
                            <span className="text-[10px] text-charcoal/40 font-medium">
                                Cerrada {new Date(cashRegister.closed_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

// Modal de cierre de caja con informe del día
interface CloseCajaModalProps {
    date: string
    dateLabel: string
    totalCobrado: number
    totalPendiente: number
    byMethod?: Record<string, number>
    citasAtendidas?: number
    pendingList?: { name: string; amount: number }[]
    currency: string
    onConfirm: (notes: string) => void
    onCancel: () => void
    loading: boolean
}

const METHOD_LABELS: Record<string, string> = {
    efectivo: 'Efectivo',
    cash: 'Efectivo',
    transferencia: 'Transferencia',
    transfer: 'Transferencia',
    tarjeta: 'Tarjeta crédito',
    'tarjeta credito': 'Tarjeta crédito',
    'tarjeta crédito': 'Tarjeta crédito',
    debito: 'Tarjeta débito',
    débito: 'Tarjeta débito',
    'tarjeta debito': 'Tarjeta débito',
    'tarjeta débito': 'Tarjeta débito',
    otro: 'Otro',
}

export function CloseCajaModal({
    dateLabel,
    totalCobrado,
    totalPendiente,
    byMethod = {},
    citasAtendidas = 0,
    pendingList = [],
    currency,
    onConfirm,
    onCancel,
    loading,
}: CloseCajaModalProps) {
    const [notes, setNotes] = useState('')
    const fmt = (n: number) => `${currency}${n.toLocaleString('es-CL')}`

    return (
        <div className="fixed inset-0 bg-charcoal/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-[90vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-silk-beige shrink-0">
                    <div>
                        <h3 className="font-bold text-charcoal">Informe del día</h3>
                        <p className="text-xs text-charcoal/50 mt-0.5 capitalize">{dateLabel}</p>
                    </div>
                    <button onClick={onCancel} className="text-charcoal/40 hover:text-charcoal">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                    {/* Total del día */}
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600 mb-1">Total cobrado</p>
                        <p className="text-3xl font-extrabold text-emerald-700">{fmt(totalCobrado)}</p>
                        {citasAtendidas > 0 && (
                            <p className="text-xs text-emerald-600/70 mt-1">{citasAtendidas} {citasAtendidas === 1 ? 'registro' : 'registros'} en el día</p>
                        )}
                    </div>

                    {/* Desglose por método de pago */}
                    {Object.keys(byMethod).length > 0 && (
                        <div className="space-y-1">
                            <p className="text-[10px] font-black uppercase tracking-widest text-charcoal/40 mb-2">Desglose por método</p>
                            {Object.entries(byMethod).map(([method, amount]) => (
                                <div key={method} className="flex justify-between items-center py-1.5 border-b border-silk-beige last:border-0">
                                    <span className="text-sm text-charcoal/70 flex items-center gap-1.5">
                                        {paymentIcon(method)}
                                        {METHOD_LABELS[method.toLowerCase()] ?? method}
                                    </span>
                                    <span className="text-sm font-bold text-charcoal">{fmt(amount)}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Pendientes */}
                    {totalPendiente > 0 && (
                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
                            <p className="text-[10px] font-black uppercase tracking-widest text-amber-600 flex items-center gap-1">
                                <Clock className="w-3 h-3" /> Pendiente de cobro · {fmt(totalPendiente)}
                            </p>
                            {pendingList.map((item, i) => (
                                <div key={i} className="flex justify-between text-xs">
                                    <span className="text-charcoal/60 truncate pr-2">{item.name}</span>
                                    <span className="text-amber-700 font-semibold shrink-0">{fmt(item.amount)}</span>
                                </div>
                            ))}
                            <p className="text-[11px] text-amber-600/80">Podés cerrar y cobrarlos después desde Citas.</p>
                        </div>
                    )}

                    {/* Notas opcionales */}
                    <div>
                        <label className="block text-xs font-semibold text-charcoal mb-1.5">
                            Notas (opcional)
                        </label>
                        <textarea
                            rows={2}
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            placeholder="Ej: Faltaron $500 en efectivo, se aclaró con Claudia"
                            className="input-soft w-full text-sm resize-none"
                        />
                    </div>
                </div>

                <div className="flex gap-3 p-5 pt-0 shrink-0">
                    <button onClick={onCancel} className="flex-1 btn-secondary py-2 text-sm">
                        Cancelar
                    </button>
                    <button
                        onClick={() => onConfirm(notes)}
                        disabled={loading}
                        className="flex-1 bg-charcoal text-white font-semibold py-2 rounded-lg text-sm hover:bg-charcoal/80 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        <Lock className="w-3.5 h-3.5" />
                        {loading ? 'Cerrando...' : 'Cerrar caja'}
                    </button>
                </div>
            </div>
        </div>
    )
}
