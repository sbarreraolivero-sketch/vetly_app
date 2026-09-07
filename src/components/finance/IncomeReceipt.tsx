/**
 * IncomeReceipt — comprobante de un ingreso manual de Finanzas.
 * Vista previa en modal + Imprimir/PDF (window.open + print) + enviar por WhatsApp
 * como link wa.me con el resumen pre-escrito (funciona en cualquier clínica, no
 * depende de la API de WhatsApp ni de plantillas aprobadas).
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Printer, MessageCircle, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

interface IncomeLike {
    id: string
    date: string
    description: string
    amount: number
    discount?: number | null
    loyalty_redeemed?: number | null
    payment_method?: string | null
    notes?: string | null
    tutor_id?: string | null
    tutor_name?: string | null
    services?: Array<{ name?: string; price?: number; quantity?: number; type?: string }> | null
}

interface IncomeReceiptProps {
    income: IncomeLike
    clinicId: string
    clinicName: string
    /** Símbolo de moneda ($, US$, etc.) */
    currency: string
    onClose: () => void
}

const PAYMENT_LABELS: Record<string, string> = {
    efectivo: 'Efectivo', cash: 'Efectivo',
    transferencia: 'Transferencia', transfer: 'Transferencia',
    tarjeta: 'Tarjeta de crédito', 'tarjeta credito': 'Tarjeta de crédito', 'tarjeta crédito': 'Tarjeta de crédito',
    debito: 'Tarjeta de débito', 'débito': 'Tarjeta de débito', 'tarjeta debito': 'Tarjeta de débito', 'tarjeta débito': 'Tarjeta de débito',
}

const esc = (s: string | null | undefined): string =>
    (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
             .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const fmtMethod = (m?: string | null) => (m ? (PAYMENT_LABELS[m.toLowerCase()] ?? m) : '—')

/** `income.date` es 'YYYY-MM-DD'. `new Date('2026-09-06')` lo interpreta como UTC
 *  medianoche → en zonas UTC-negativo se muestra el día anterior. Anclamos al
 *  mediodía local para evitar el corrimiento (mismo patrón que Finance.tsx). */
const parseLocalDay = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00`)

export function IncomeReceipt({ income, clinicId, clinicName, currency, onClose }: IncomeReceiptProps) {
    const [clinic, setClinic] = useState<{ name: string; address: string | null; phone: string | null }>({
        name: clinicName, address: null, phone: null,
    })
    const [tutorPhone, setTutorPhone] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            const [csRes, tutorRes] = await Promise.all([
                (supabase as any)
                    .from('clinic_settings')
                    .select('clinic_name, clinic_address, contact_phone, ycloud_phone_number')
                    .eq('id', clinicId)
                    .maybeSingle(),
                income.tutor_id
                    ? (supabase as any).from('tutors').select('phone_number').eq('id', income.tutor_id).maybeSingle()
                    : Promise.resolve({ data: null }),
            ])
            if (cancelled) return
            const cs = csRes?.data
            if (cs) {
                setClinic({
                    name: cs.clinic_name || clinicName,
                    address: cs.clinic_address || null,
                    phone: cs.contact_phone || cs.ycloud_phone_number || null,
                })
            }
            setTutorPhone((tutorRes?.data?.phone_number || '').replace(/\D/g, '') || null)
            setLoading(false)
        })()
        return () => { cancelled = true }
    }, [clinicId, income.tutor_id, clinicName])

    const fmt = (n: number) => `${currency}${(n ?? 0).toLocaleString('es-CL')}`

    // Ítems: usa services[] si tiene detalle; si no, una sola línea con la descripción.
    const items = (income.services && income.services.length > 0)
        ? income.services.map(s => ({
            name: s.name || 'Ítem',
            qty: s.quantity && s.quantity > 1 ? s.quantity : 1,
            subtotal: typeof s.price === 'number' ? s.price : 0,
            type: s.type,
        }))
        : [{ name: income.description || 'Ingreso', qty: 1, subtotal: income.amount, type: undefined as string | undefined }]

    const itemsTotal = items.reduce((s, i) => s + (i.subtotal || 0), 0)
    const discount = income.discount || 0
    const redeemed = income.loyalty_redeemed || 0
    const dateLabel = format(parseLocalDay(income.date), "d 'de' MMMM yyyy", { locale: es })

    const buildReceiptHtml = () => `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<title>Comprobante — ${esc(clinic.name)}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; color:#1a1a1a; padding:32px; max-width:440px; margin:0 auto; font-size:13px; }
  .header { text-align:center; margin-bottom:20px; padding-bottom:16px; border-bottom:2px solid #0d9488; }
  .clinic-name { font-size:20px; font-weight:800; color:#0d9488; }
  .clinic-meta { font-size:11px; color:#777; margin-top:4px; }
  .receipt-title { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.1em; color:#888; margin-top:8px; }
  .info-block { margin-bottom:12px; }
  .label { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; color:#888; }
  .value { font-size:14px; margin-top:2px; }
  table { width:100%; border-collapse:collapse; margin:14px 0; }
  th { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; color:#888; padding:6px 0; border-bottom:1px solid #e5e0d8; text-align:left; }
  th:last-child, td:last-child { text-align:right; }
  td { font-size:13px; padding:8px 0; border-bottom:1px solid #f0ebe3; }
  .badge { display:inline-block; font-size:9px; font-weight:600; padding:2px 5px; border-radius:4px; margin-right:5px; background:#e0f2fe; color:#0369a1; }
  .totals { margin-top:4px; }
  .totals .row { display:flex; justify-content:space-between; padding:3px 0; font-size:12px; color:#555; }
  .totals .discount { color:#059669; }
  .total-row { display:flex; justify-content:space-between; padding:12px 0; border-top:2px solid #e5e0d8; margin-top:6px; }
  .total-label { font-size:13px; font-weight:700; }
  .total-value { font-size:20px; font-weight:800; color:#0d9488; }
  .meta { margin-top:10px; font-size:12px; color:#666; }
  .notes { margin-top:12px; padding:10px 12px; background:#fffbeb; border:1px solid #fde68a; border-radius:8px; font-size:12px; color:#92400e; }
  .footer { text-align:center; font-size:11px; color:#aaa; margin-top:24px; padding-top:16px; border-top:1px solid #e5e0d8; }
  @media print { body { padding:16px; } @page { margin:12mm; } }
</style></head><body>
<div class="header">
  <div class="clinic-name">${esc(clinic.name)}</div>
  ${clinic.address || clinic.phone ? `<div class="clinic-meta">${[esc(clinic.address), esc(clinic.phone)].filter(Boolean).join(' · ')}</div>` : ''}
  <div class="receipt-title">Comprobante de ingreso</div>
</div>
${income.tutor_name ? `<div class="info-block"><div class="label">Tutor</div><div class="value">${esc(income.tutor_name)}</div></div>` : ''}
<div class="info-block"><div class="label">Fecha</div><div class="value">${esc(dateLabel)}</div></div>
<table>
  <thead><tr><th>Detalle</th><th>Cant.</th><th>Monto</th></tr></thead>
  <tbody>
    ${items.map(i => `<tr><td>${i.type ? `<span class="badge">${i.type === 'service' ? 'Serv.' : i.type === 'product' ? 'Prod.' : 'Ítem'}</span>` : ''}${esc(i.name)}</td><td>${i.qty}</td><td><strong>${fmt(i.subtotal)}</strong></td></tr>`).join('')}
  </tbody>
</table>
<div class="totals">
  ${(discount > 0 || redeemed > 0) ? `<div class="row"><span>Subtotal</span><span>${fmt(itemsTotal)}</span></div>` : ''}
  ${discount > 0 ? `<div class="row discount"><span>Descuento</span><span>− ${fmt(discount)}</span></div>` : ''}
  ${redeemed > 0 ? `<div class="row discount"><span>Canje fidelización</span><span>− ${fmt(redeemed)}</span></div>` : ''}
</div>
<div class="total-row"><span class="total-label">Total</span><span class="total-value">${fmt(income.amount)}</span></div>
${income.payment_method ? `<div class="meta">Método de pago: <strong>${esc(fmtMethod(income.payment_method))}</strong></div>` : ''}
${income.notes ? `<div class="notes"><strong>Notas:</strong> ${esc(income.notes)}</div>` : ''}
<div class="footer">¡Gracias por su confianza! 🐾<br/>Generado por Vetly · ${esc(new Date().toLocaleDateString('es-CL'))}</div>
<script>window.onload = () => window.print()</script>
</body></html>`

    const handlePrint = () => {
        const w = window.open('', '_blank', 'width=520,height=760')
        if (!w) return
        w.document.write(buildReceiptHtml())
        w.document.close()
    }

    const handleWhatsApp = () => {
        // Abrir la ventana ANTES de cualquier trabajo async para que no la bloquee el navegador.
        const lines = [
            `*${clinic.name}* — Comprobante de ingreso`,
            income.tutor_name ? `Tutor: ${income.tutor_name}` : '',
            `Fecha: ${dateLabel}`,
            '',
            ...items.map(i => `• ${i.name}${i.qty > 1 ? ` ×${i.qty}` : ''}: ${fmt(i.subtotal)}`),
            discount > 0 ? `Descuento: − ${fmt(discount)}` : '',
            redeemed > 0 ? `Canje fidelización: − ${fmt(redeemed)}` : '',
            `*Total: ${fmt(income.amount)}*`,
            income.payment_method ? `Pago: ${fmtMethod(income.payment_method)}` : '',
            '',
            '¡Gracias por su confianza! 🐾',
        ].filter(Boolean)
        const text = encodeURIComponent(lines.join('\n'))
        const url = tutorPhone
            ? `https://wa.me/${tutorPhone}?text=${text}`
            : `https://wa.me/?text=${text}`
        window.open(url, '_blank', 'noopener,noreferrer')
    }

    return createPortal(
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
                <div className="flex items-center justify-between px-5 py-4 border-b border-silk-beige shrink-0">
                    <h3 className="font-bold text-charcoal">Comprobante de ingreso</h3>
                    <button onClick={onClose} className="p-1.5 hover:bg-ivory rounded-lg text-charcoal/50">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="overflow-y-auto p-5 space-y-4 text-sm">
                    <div className="text-center pb-3 border-b border-silk-beige">
                        <p className="text-lg font-black text-primary-700">{clinic.name}</p>
                        {(clinic.address || clinic.phone) && (
                            <p className="text-xs text-charcoal/50 mt-0.5">
                                {[clinic.address, clinic.phone].filter(Boolean).join(' · ')}
                            </p>
                        )}
                    </div>

                    {income.tutor_name && (
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-charcoal/40">Tutor</p>
                            <p className="font-bold text-charcoal">{income.tutor_name}</p>
                        </div>
                    )}
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-charcoal/40">Fecha</p>
                        <p className="text-charcoal">{dateLabel}</p>
                    </div>

                    <div className="border-t border-silk-beige pt-3 space-y-2">
                        {items.map((i, idx) => (
                            <div key={idx} className="flex items-center justify-between gap-2">
                                <span className="text-charcoal/80 truncate">
                                    {i.name}{i.qty > 1 && <span className="text-charcoal/40"> ×{i.qty}</span>}
                                </span>
                                <span className="font-bold text-charcoal shrink-0">{fmt(i.subtotal)}</span>
                            </div>
                        ))}
                    </div>

                    {(discount > 0 || redeemed > 0) && (
                        <div className="space-y-1 text-xs text-charcoal/60 border-t border-silk-beige pt-3">
                            <div className="flex justify-between"><span>Subtotal</span><span>{fmt(itemsTotal)}</span></div>
                            {discount > 0 && <div className="flex justify-between text-emerald-600"><span>Descuento</span><span>− {fmt(discount)}</span></div>}
                            {redeemed > 0 && <div className="flex justify-between text-emerald-600"><span>Canje fidelización</span><span>− {fmt(redeemed)}</span></div>}
                        </div>
                    )}

                    <div className="flex items-center justify-between border-t-2 border-silk-beige pt-3">
                        <span className="font-bold text-charcoal">Total</span>
                        <span className="text-2xl font-black text-primary-700">{fmt(income.amount)}</span>
                    </div>

                    {income.payment_method && (
                        <p className="text-xs text-charcoal/60">Método de pago: <strong className="text-charcoal">{fmtMethod(income.payment_method)}</strong></p>
                    )}
                    {income.notes && (
                        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                            <strong>Notas:</strong> {income.notes}
                        </p>
                    )}
                </div>

                <div className="flex items-center gap-2 px-5 py-4 border-t border-silk-beige shrink-0">
                    <button
                        onClick={onClose}
                        className="px-3 py-2 text-sm font-medium text-charcoal/60 hover:bg-ivory rounded-xl transition-colors"
                    >
                        Cerrar
                    </button>
                    <div className="flex-1" />
                    <button
                        onClick={handlePrint}
                        className="flex items-center gap-1.5 px-3 py-2 text-sm font-bold bg-ivory hover:bg-silk-beige text-charcoal rounded-xl transition-colors whitespace-nowrap"
                    >
                        <Printer className="w-4 h-4" /> PDF
                    </button>
                    <button
                        onClick={handleWhatsApp}
                        disabled={loading}
                        className="flex items-center gap-1.5 px-3 py-2 text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition-colors disabled:opacity-50 whitespace-nowrap"
                        title={tutorPhone ? 'Abrir WhatsApp del tutor con el comprobante' : 'Sin teléfono del tutor — se abrirá WhatsApp para elegir contacto'}
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
                        WhatsApp
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    )
}
