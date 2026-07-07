/**
 * CajaReport — genera y abre un informe imprimible (PDF) del día de caja.
 * Usa window.open() + window.print(), igual que VisitReceipt.
 */

interface IncomeEntry {
    id: string
    description: string
    amount: number
    discount?: number
    payment_method?: string | null
    tutor_name?: string | null
}

interface ExpenseEntry {
    id: string
    description: string
    amount: number
    category: string
    payment_method?: string | null
    receipt_url?: string | null
}

interface CajaReportData {
    clinicName: string
    date: string             // 'YYYY-MM-DD'
    dateLabel: string        // 'Lunes 4 Jun 2026'
    currency: string
    openingBalance: number
    incomes: IncomeEntry[]
    expenses: ExpenseEntry[]
    notes?: string | null
    closedAt?: string | null  // ISO timestamp
    closedBy?: string | null
}

function esc(s: string | null | undefined): string {
    return (s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

const PAYMENT_LABELS: Record<string, string> = {
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
}

const EXP_CATEGORY_LABELS: Record<string, string> = {
    supplies: 'Insumos',
    rent: 'Alquiler',
    payroll: 'Personal',
    marketing: 'Marketing',
    utilities: 'Servicios Básicos',
    other: 'Otro',
}

function fmtMethod(m?: string | null) {
    if (!m) return '—'
    return PAYMENT_LABELS[m.toLowerCase()] ?? m
}

function fmtCategory(c: string) {
    return EXP_CATEGORY_LABELS[c] ?? c
}

export function printCajaReport(data: CajaReportData) {
    const {
        clinicName, dateLabel, currency, openingBalance,
        incomes, expenses, notes, closedAt,
    } = data

    const fmt = (n: number) => `${currency}${n.toLocaleString('es-CL')}`

    const totalCobrado = incomes.reduce((s, i) => s + (i.amount ?? 0), 0)
    const totalGastos = expenses.reduce((s, e) => s + (e.amount ?? 0), 0)
    const saldoFinal = openingBalance + totalCobrado - totalGastos

    // Desglose por método (cobrado)
    const byMethod: Record<string, number> = {}
    for (const i of incomes) {
        const k = (i.payment_method ?? 'Sin especificar').toLowerCase()
        byMethod[k] = (byMethod[k] ?? 0) + (i.amount ?? 0)
    }

    const closedAtLabel = closedAt
        ? new Date(closedAt).toLocaleString('es-CL', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })
        : null

    const incRows = incomes.map(inc => `
        <tr>
            <td>${esc(inc.description) || '—'}</td>
            <td>${esc(inc.tutor_name) || 'Sin tutor vinculado'}${inc.discount ? ` · Desc. ${fmt(inc.discount)}` : ''}</td>
            <td>${esc(fmtMethod(inc.payment_method))}</td>
            <td class="amount">${fmt(inc.amount ?? 0)}</td>
        </tr>`).join('')

    const expRows = expenses.map(exp => `
        <tr>
            <td>${esc(exp.description) || '—'}</td>
            <td>${esc(fmtCategory(exp.category))}</td>
            <td>${esc(fmtMethod(exp.payment_method))}</td>
            <td class="amount neg">${fmt(exp.amount ?? 0)}${exp.receipt_url ? ' 📎' : ''}</td>
        </tr>`).join('')

    const methodRows = Object.entries(byMethod)
        .map(([method, amount]) => `
        <tr>
            <td>${esc(fmtMethod(method))}</td>
            <td class="amount">${fmt(amount)}</td>
        </tr>`).join('')

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Informe de Caja — ${esc(dateLabel)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; font-size: 13px; padding: 32px; max-width: 700px; margin: 0 auto; }
  h1 { font-size: 20px; font-weight: 800; }
  h2 { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; padding-top: 18px; color: #555; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; border-bottom: 2px solid #0d9488; padding-bottom: 16px; }
  .header-right { text-align: right; font-size: 11px; color: #777; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
  th { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #888; padding: 4px 8px; border-bottom: 1px solid #e5e7eb; text-align: left; }
  td { padding: 6px 8px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  td.amount { text-align: right; font-weight: 700; white-space: nowrap; }
  td.neg { color: #e11d48; }
  td.pending { color: #d97706; }
  .section-cobrado h2 { color: #059669; }
  .section-gastos h2 { color: #e11d48; }
  .section-pendiente h2 { color: #d97706; }
  .summary-box { margin-top: 20px; border: 2px solid #0d9488; border-radius: 10px; overflow: hidden; }
  .summary-box table td { padding: 8px 14px; border-bottom: 1px solid #f3f4f6; font-size: 13px; }
  .summary-box table td:last-child { text-align: right; font-weight: 700; }
  .summary-total { background: #0d9488; color: white; }
  .summary-total td { font-size: 15px !important; font-weight: 800 !important; }
  .method-table td:last-child { text-align: right; font-weight: 600; }
  .notes { margin-top: 18px; padding: 10px 14px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; font-size: 12px; color: #92400e; }
  .footer { margin-top: 28px; padding-top: 12px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 11px; color: #9ca3af; }
  @media print {
    body { padding: 16px; }
    @page { margin: 12mm; }
  }
</style>
</head>
<body>
<div class="header">
  <div>
    <h1>${esc(clinicName)}</h1>
    <p style="color:#666;font-size:13px;margin-top:4px;">Informe de Caja · ${esc(dateLabel)}</p>
  </div>
  <div class="header-right">
    ${closedAtLabel ? `<p>Cerrada: ${closedAtLabel}</p>` : '<p style="color:#d97706;font-weight:600">Caja abierta</p>'}
    <p style="margin-top:4px;">Saldo inicial: <strong>${fmt(openingBalance)}</strong></p>
  </div>
</div>

<!-- COBRADO -->
<div class="section-cobrado">
  <h2>✅ Cobrado · ${fmt(totalCobrado)}</h2>
  ${incomes.length > 0 ? `
  <table>
    <thead><tr><th>Detalle</th><th>Tutor</th><th>Método</th><th style="text-align:right">Monto</th></tr></thead>
    <tbody>${incRows}</tbody>
  </table>` : '<p style="color:#9ca3af;font-size:12px;padding:8px 0">Sin cobros registrados</p>'}
</div>

<!-- GASTOS -->
${expenses.length > 0 ? `
<div class="section-gastos">
  <h2>💸 Gastos del día · ${fmt(totalGastos)}</h2>
  <table>
    <thead><tr><th>Descripción</th><th>Categoría</th><th>Método</th><th style="text-align:right">Monto</th></tr></thead>
    <tbody>${expRows}</tbody>
  </table>
  <p style="font-size:10px;color:#9ca3af;margin-top:4px">📎 = boleta adjunta en el sistema</p>
</div>` : ''}

<!-- DESGLOSE POR MÉTODO -->
${Object.keys(byMethod).length > 0 ? `
<h2>💳 Desglose por método de pago</h2>
<table class="method-table">
  <thead><tr><th>Método</th><th style="text-align:right">Total</th></tr></thead>
  <tbody>${methodRows}</tbody>
</table>` : ''}

<!-- RESUMEN FINANCIERO -->
<div class="summary-box">
  <table>
    <tr><td>Saldo inicial</td><td>${fmt(openingBalance)}</td></tr>
    <tr><td>+ Cobrado</td><td>${fmt(totalCobrado)}</td></tr>
    ${totalGastos > 0 ? `<tr><td>− Gastos del día</td><td style="color:#e11d48">− ${fmt(totalGastos)}</td></tr>` : ''}
    <tr class="summary-total"><td>Saldo final de caja</td><td>${fmt(saldoFinal)}</td></tr>
  </table>
</div>

${notes ? `<div class="notes"><strong>Notas:</strong> ${esc(notes)}</div>` : ''}

<div class="footer">
  Generado por Vetly · ${new Date().toLocaleString('es-CL')}
</div>

<script>window.onload = () => window.print()</script>
</body>
</html>`

    const w = window.open('', '_blank')
    if (w) {
        w.document.write(html)
        w.document.close()
    }
}
