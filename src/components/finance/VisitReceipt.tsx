import { useEffect, useRef, useState } from 'react'
import { X, Printer, MessageCircle, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { toast } from 'react-hot-toast'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

interface ReceiptItem {
    id: string
    item_type: string
    name: string
    quantity: number
    unit_price: number
    subtotal: number
}

interface VisitReceiptProps {
    transaction: {
        id: string
        patient_name?: string
        tutor_name?: string
        phone_number?: string
        appointment_date: string
        service?: string
        price?: number
        payment_status?: string
        payment_method?: string
    }
    items: ReceiptItem[]
    clinicName: string
    clinicId: string
    onLoadItems: () => Promise<void>
    onClose: () => void
}

const formatCLP = (n: number) =>
    new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n)

const PAYMENT_LABELS: Record<string, string> = {
    efectivo: 'Efectivo', transferencia: 'Transferencia',
    tarjeta: 'Tarjeta de crédito', debito: 'Tarjeta de débito',
}

const STATUS_LABELS: Record<string, string> = {
    paid: 'Pagado', pending: 'Pendiente', partial: 'Parcial', refunded: 'Reembolsado',
}

const VisitReceipt = ({ transaction: tx, items, clinicName, clinicId, onLoadItems, onClose }: VisitReceiptProps) => {
    const printRef = useRef<HTMLDivElement>(null)
    const [sending, setSending] = useState(false)

    const displayItems: ReceiptItem[] = items.length > 0
        ? items
        : tx.service
            ? [{ id: 'svc', item_type: 'service', name: tx.service, quantity: 1, unit_price: tx.price ?? 0, subtotal: tx.price ?? 0 }]
            : []

    const total = displayItems.reduce((sum, i) => sum + i.subtotal, 0) || (tx.price ?? 0)

    useEffect(() => {
        // Carga ítems en background — sin spinner para evitar estado colgado
        if (items.length === 0) onLoadItems().catch(() => {})
    }, [])

    const handlePrint = () => {
        const printContent = printRef.current?.innerHTML
        if (!printContent) return
        const win = window.open('', '_blank', 'width=600,height=800')
        if (!win) return
        win.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8"/>
                <title>Comprobante — ${clinicName}</title>
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; padding: 32px; max-width: 420px; margin: 0 auto; }
                    .header { text-align: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid #e5e0d8; }
                    .clinic-name { font-size: 20px; font-weight: 800; color: #0d9488; }
                    .receipt-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #888; margin-top: 4px; }
                    .info-block { margin-bottom: 16px; }
                    .label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #888; }
                    .value { font-size: 14px; color: #1a1a1a; margin-top: 2px; }
                    .items-table { width: 100%; border-collapse: collapse; margin: 16px 0; }
                    .items-table th { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #888; padding: 6px 0; border-bottom: 1px solid #e5e0d8; text-align: left; }
                    .items-table th:last-child, .items-table td:last-child { text-align: right; }
                    .items-table td { font-size: 13px; padding: 8px 0; border-bottom: 1px solid #f0ebe3; }
                    .badge { display: inline-block; font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px; margin-right: 6px; }
                    .badge-service { background: #e0f2fe; color: #0369a1; }
                    .badge-product { background: #ede9fe; color: #7c3aed; }
                    .total-row { display: flex; justify-content: space-between; padding: 12px 0; border-top: 2px solid #e5e0d8; margin-top: 4px; }
                    .total-label { font-size: 13px; font-weight: 700; }
                    .total-value { font-size: 20px; font-weight: 800; color: #0d9488; }
                    .footer { text-align: center; font-size: 11px; color: #aaa; margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e0d8; }
                    .status-paid { color: #059669; font-weight: 700; }
                    .status-pending { color: #d97706; font-weight: 700; }
                </style>
            </head>
            <body>
                <div class="header">
                    <div class="clinic-name">${clinicName}</div>
                    <div class="receipt-title">Comprobante de visita</div>
                </div>
                <div class="info-block">
                    <div class="label">Paciente</div>
                    <div class="value">${tx.patient_name ?? '—'}</div>
                </div>
                ${tx.tutor_name ? `<div class="info-block"><div class="label">Tutor</div><div class="value">${tx.tutor_name}</div></div>` : ''}
                <div class="info-block">
                    <div class="label">Fecha</div>
                    <div class="value">${format(new Date(tx.appointment_date), "d 'de' MMMM yyyy, HH:mm", { locale: es })}</div>
                </div>
                <table class="items-table">
                    <thead><tr><th>Descripción</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead>
                    <tbody>
                        ${displayItems.map(i => `
                            <tr>
                                <td><span class="badge ${i.item_type === 'service' ? 'badge-service' : 'badge-product'}">${i.item_type === 'service' ? 'Serv.' : 'Prod.'}</span>${i.name}</td>
                                <td>${i.quantity}</td>
                                <td>${formatCLP(i.unit_price)}</td>
                                <td><strong>${formatCLP(i.subtotal)}</strong></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                <div class="total-row">
                    <span class="total-label">Total</span>
                    <span class="total-value">${formatCLP(total)}</span>
                </div>
                ${tx.payment_method ? `<div style="margin-top:8px;font-size:12px;color:#666">Método de pago: <strong>${PAYMENT_LABELS[tx.payment_method] ?? tx.payment_method}</strong></div>` : ''}
                <div style="margin-top:4px;font-size:12px">Estado: <span class="${tx.payment_status === 'paid' ? 'status-paid' : 'status-pending'}">${STATUS_LABELS[tx.payment_status ?? 'pending']}</span></div>
                <div class="footer">¡Gracias por su confianza! 🐾</div>
            </body>
            </html>
        `)
        win.document.close()
        win.focus()
        win.print()
    }

    const handleSendWhatsApp = async () => {
        if (!tx.phone_number) {
            toast.error('Este tutor no tiene teléfono registrado')
            return
        }
        setSending(true)
        try {
            const { error } = await supabase.functions.invoke('send-visit-receipt', {
                body: {
                    appointment_id: tx.id,
                    clinic_id: clinicId,
                    phone_number: tx.phone_number,
                    items: displayItems,
                    total,
                    payment_method: tx.payment_method,
                    payment_status: tx.payment_status,
                }
            })
            if (error) throw error
            toast.success('Comprobante enviado por WhatsApp')
        } catch (e: any) {
            toast.error(e.message ?? 'Error al enviar por WhatsApp')
        } finally {
            setSending(false)
        }
    }

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">

                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-silk-beige shrink-0">
                    <h2 className="font-bold text-charcoal">Comprobante de visita</h2>
                    <button onClick={onClose} className="p-1.5 hover:bg-silk-beige rounded-lg">
                        <X className="w-5 h-5 text-charcoal/60" />
                    </button>
                </div>

                {/* Receipt preview */}
                <div ref={printRef} className="flex-1 overflow-y-auto p-6 space-y-5">
                    {/* Clinic header */}
                    <div className="text-center pb-4 border-b border-silk-beige">
                        <p className="text-lg font-extrabold text-primary-600">{clinicName}</p>
                        <p className="text-xs text-charcoal/40 uppercase tracking-widest mt-0.5">Comprobante de visita</p>
                    </div>

                    {/* Info */}
                    <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                            <p className="text-xs font-bold text-charcoal/40 uppercase tracking-wider">Paciente</p>
                            <p className="font-semibold text-charcoal mt-0.5">{tx.patient_name ?? '—'}</p>
                        </div>
                        {tx.tutor_name && (
                            <div>
                                <p className="text-xs font-bold text-charcoal/40 uppercase tracking-wider">Tutor</p>
                                <p className="font-semibold text-charcoal mt-0.5">{tx.tutor_name}</p>
                            </div>
                        )}
                        <div className="col-span-2">
                            <p className="text-xs font-bold text-charcoal/40 uppercase tracking-wider">Fecha</p>
                            <p className="font-semibold text-charcoal mt-0.5">
                                {format(new Date(tx.appointment_date), "d 'de' MMMM yyyy, HH:mm", { locale: es })}
                            </p>
                        </div>
                    </div>

                    {/* Items */}
                    <div>
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-silk-beige">
                                    <th className="text-left py-2 text-xs font-black uppercase tracking-wider text-charcoal/40">Descripción</th>
                                    <th className="text-center py-2 text-xs font-black uppercase tracking-wider text-charcoal/40">Cant.</th>
                                    <th className="text-right py-2 text-xs font-black uppercase tracking-wider text-charcoal/40">Subtotal</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-silk-beige/50">
                                {displayItems.map(item => (
                                    <tr key={item.id}>
                                        <td className="py-2.5">
                                            <div className="flex items-center gap-2">
                                                <span className={cn(
                                                    "text-[10px] px-1.5 py-0.5 rounded font-semibold",
                                                    item.item_type === 'service'
                                                        ? "bg-primary-100 text-primary-600"
                                                        : "bg-violet-100 text-violet-600"
                                                )}>
                                                    {item.item_type === 'service' ? 'Serv.' : 'Prod.'}
                                                </span>
                                                <span className="text-charcoal">{item.name}</span>
                                            </div>
                                            <p className="text-xs text-charcoal/40 ml-8">{formatCLP(item.unit_price)} × {item.quantity}</p>
                                        </td>
                                        <td className="py-2.5 text-center text-charcoal/60">{item.quantity}</td>
                                        <td className="py-2.5 text-right font-semibold text-charcoal">{formatCLP(item.subtotal)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        {/* Total */}
                        <div className="flex justify-between items-center pt-3 border-t border-silk-beige mt-1">
                            <span className="font-bold text-charcoal">Total</span>
                            <span className="text-2xl font-extrabold text-primary-600">{formatCLP(total)}</span>
                        </div>

                        {/* Payment info */}
                        <div className="mt-3 flex gap-3 text-sm">
                            {tx.payment_method && (
                                <span className="text-charcoal/60">
                                    Pago: <strong className="text-charcoal">{PAYMENT_LABELS[tx.payment_method] ?? tx.payment_method}</strong>
                                </span>
                            )}
                            <span className={cn(
                                "font-bold",
                                tx.payment_status === 'paid' ? "text-emerald-600" : "text-amber-600"
                            )}>
                                {STATUS_LABELS[tx.payment_status ?? 'pending']}
                            </span>
                        </div>
                    </div>

                    <div className="text-center text-xs text-charcoal/30 pt-3 border-t border-silk-beige">
                        ¡Gracias por su confianza! 🐾
                    </div>
                </div>

                {/* Actions */}
                <div className="flex gap-3 p-5 border-t border-silk-beige shrink-0">
                    <button
                        onClick={handlePrint}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 border border-silk-beige rounded-xl text-sm font-semibold text-charcoal hover:bg-ivory transition-colors"
                    >
                        <Printer className="w-4 h-4" /> Imprimir / PDF
                    </button>
                    <button
                        onClick={handleSendWhatsApp}
                        disabled={sending || !tx.phone_number}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
                    >
                        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
                        {sending ? 'Enviando...' : 'Enviar por WhatsApp'}
                    </button>
                </div>
            </div>
        </div>
    )
}

export default VisitReceipt
