import { useState, useMemo, useRef, useEffect } from 'react'
import {
    X, Download, FileText, CalendarRange, ChevronLeft, ChevronRight, Loader2,
    TrendingUp, TrendingDown, DollarSign, CreditCard,
} from 'lucide-react'
import {
    startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth,
    startOfYear, endOfYear, getDay, addDays, addMonths, subMonths,
    isSameDay, isBefore, isAfter,
    format as dateFnsFormat,
} from 'date-fns'
import { es as esLocale } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { financeService } from '@/services/financeService'
import { toast } from 'react-hot-toast'

interface ExportModalProps {
    clinicId: string
    clinicName: string
    currency: string
    timezone: string
    onClose: () => void
}

type FilterType = 'day' | 'week' | 'month' | 'year' | 'custom'

const STATUS_LABELS: Record<string, string> = {
    paid: 'Pagado', pending: 'Pendiente', partial: 'Parcial', refunded: 'Reembolsado',
}
const CATEGORY_EXPENSE: Record<string, string> = {
    rent: 'Alquiler', supplies: 'Insumos', payroll: 'Nómina',
    marketing: 'Marketing', utilities: 'Servicios Básicos', other: 'Otro',
}
const CATEGORY_INCOME: Record<string, string> = {
    service: 'Servicio', product: 'Producto', adjustment: 'Ajuste', other: 'Otro',
}

function fmt(n: number) { return n.toLocaleString('es-CL') }

function getRange(filterType: FilterType, customRange: { start: Date; end: Date } | null, tz: string) {
    const clinicNow = new Date(new Date().toLocaleString('en-US', { timeZone: tz }))
    if (filterType === 'custom' && customRange) {
        return { start: startOfDay(customRange.start), end: endOfDay(customRange.end) }
    }
    switch (filterType) {
        case 'day':   return { start: startOfDay(clinicNow), end: endOfDay(clinicNow) }
        case 'week':  return { start: startOfWeek(clinicNow, { locale: esLocale }), end: endOfWeek(clinicNow, { locale: esLocale }) }
        case 'month': return { start: startOfMonth(clinicNow), end: endOfMonth(clinicNow) }
        case 'year':  return { start: startOfYear(clinicNow), end: endOfYear(clinicNow) }
        default:      return { start: startOfMonth(clinicNow), end: endOfMonth(clinicNow) }
    }
}

function getPeriodLabel(filterType: FilterType, customRange: { start: Date; end: Date } | null) {
    if (filterType === 'custom' && customRange) {
        return `${dateFnsFormat(customRange.start, 'd MMM yyyy', { locale: esLocale })} – ${dateFnsFormat(customRange.end, 'd MMM yyyy', { locale: esLocale })}`
    }
    const now = new Date()
    switch (filterType) {
        case 'day':   return `Hoy, ${dateFnsFormat(now, "d 'de' MMMM yyyy", { locale: esLocale })}`
        case 'week':  return `Semana del ${dateFnsFormat(startOfWeek(now, { locale: esLocale }), 'd MMM', { locale: esLocale })} al ${dateFnsFormat(endOfWeek(now, { locale: esLocale }), 'd MMM yyyy', { locale: esLocale })}`
        case 'month': return dateFnsFormat(now, "MMMM yyyy", { locale: esLocale })
        case 'year':  return dateFnsFormat(now, 'yyyy')
        default:      return ''
    }
}

export function ExportModal({ clinicId, clinicName, currency, timezone, onClose }: ExportModalProps) {
    const [filterType, setFilterType] = useState<FilterType>('month')
    const [customRange, setCustomRange] = useState<{ start: Date; end: Date } | null>(null)
    const [showCal, setShowCal] = useState(false)
    const [format, setFormat] = useState<'csv' | 'json'>('csv')
    const [stats, setStats] = useState<any>(null)
    const [loadingStats, setLoadingStats] = useState(false)
    const [downloading, setDownloading] = useState(false)
    const calRef = useRef<HTMLDivElement>(null)

    // Cerrar calendario al hacer clic fuera
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (calRef.current && !calRef.current.contains(e.target as Node)) setShowCal(false)
        }
        if (showCal) document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [showCal])

    // Fetch stats preview cuando cambia el filtro
    useEffect(() => {
        if (filterType === 'custom' && !customRange) return
        const { start, end } = getRange(filterType, customRange, timezone)
        setLoadingStats(true)
        setStats(null)
        financeService.getStats(clinicId, start, end)
            .then(s => setStats(s))
            .catch(() => setStats(null))
            .finally(() => setLoadingStats(false))
    }, [filterType, customRange, clinicId, timezone])

    // ── Mini calendario ──────────────────────────────────────────────────
    function MiniCalendar() {
        const [calMonth, setCalMonth] = useState(() => customRange?.start ?? new Date())
        const [selecting, setSelecting] = useState<Date | null>(customRange?.start ?? null)
        const [hovered, setHovered] = useState<Date | null>(null)

        const days = useMemo(() => {
            const first = startOfMonth(calMonth)
            const pad = (getDay(first) + 6) % 7
            const grid: (Date | null)[] = Array(pad).fill(null)
            let d = new Date(first)
            const last = endOfMonth(calMonth)
            while (d <= last) { grid.push(new Date(d)); d = addDays(d, 1) }
            while (grid.length % 7 !== 0) grid.push(null)
            return grid
        }, [calMonth])

        const rangeEnd = selecting ? (hovered ?? null) : null
        const inRange = (d: Date) => {
            if (!selecting || !rangeEnd) return false
            const [a, b] = isBefore(selecting, rangeEnd) ? [selecting, rangeEnd] : [rangeEnd, selecting]
            return !isBefore(d, a) && !isAfter(d, b)
        }
        const isStart = (d: Date) => !!selecting && isSameDay(d, selecting)
        const isEnd = (d: Date) => !!rangeEnd && isSameDay(d, rangeEnd)
        const isToday = (d: Date) => isSameDay(d, new Date())

        const handleDay = (d: Date) => {
            if (!selecting) {
                setSelecting(d)
            } else {
                const [s, e] = isBefore(d, selecting) ? [d, selecting] : [selecting, d]
                setCustomRange({ start: s, end: e })
                setFilterType('custom')
                setShowCal(false)
            }
        }

        return (
            <div className="p-3 w-72">
                <div className="flex items-center justify-between mb-3">
                    <button onClick={() => setCalMonth(m => subMonths(m, 1))} className="p-1 hover:bg-silk-beige rounded-lg">
                        <ChevronLeft className="w-4 h-4 text-charcoal/60" />
                    </button>
                    <span className="text-sm font-bold text-charcoal capitalize">
                        {dateFnsFormat(calMonth, 'MMMM yyyy', { locale: esLocale })}
                    </span>
                    <button onClick={() => setCalMonth(m => addMonths(m, 1))} className="p-1 hover:bg-silk-beige rounded-lg">
                        <ChevronRight className="w-4 h-4 text-charcoal/60" />
                    </button>
                </div>
                <div className="grid grid-cols-7 mb-1">
                    {['L','M','M','J','V','S','D'].map((w, i) => (
                        <div key={i} className="text-center text-[10px] font-bold text-charcoal/30 py-1">{w}</div>
                    ))}
                </div>
                <div className="grid grid-cols-7">
                    {days.map((d, i) => {
                        if (!d) return <div key={i} />
                        const start = isStart(d); const end = isEnd(d); const range = inRange(d); const today = isToday(d)
                        return (
                            <button key={i}
                                onMouseEnter={() => selecting && setHovered(d)}
                                onMouseLeave={() => setHovered(null)}
                                onClick={() => handleDay(d)}
                                className={cn(
                                    'relative h-8 text-xs font-medium transition-colors',
                                    start || end ? 'bg-primary-500 text-white rounded-lg z-10' : '',
                                    range && !start && !end ? 'bg-primary-100 text-primary-700' : '',
                                    !start && !end && !range ? 'hover:bg-silk-beige text-charcoal rounded-lg' : '',
                                    today && !start && !end ? 'font-extrabold' : '',
                                )}
                            >
                                {today && !start && !end && (
                                    <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-primary-400 rounded-full" />
                                )}
                                {d.getDate()}
                            </button>
                        )
                    })}
                </div>
                <p className="text-center text-[10px] text-charcoal/30 mt-3">
                    {selecting ? 'Selecciona la fecha de fin' : 'Selecciona la fecha de inicio'}
                </p>
            </div>
        )
    }

    // ── Generar y descargar ──────────────────────────────────────────────
    const handleDownload = async () => {
        if (filterType === 'custom' && !customRange) return
        setDownloading(true)
        try {
            const { start, end } = getRange(filterType, customRange, timezone)
            const periodLabel = getPeriodLabel(filterType, customRange)
            const dateStamp = dateFnsFormat(new Date(), 'yyyy-MM-dd')

            const [statsData, expensesData, incomesData, txData] = await Promise.all([
                financeService.getStats(clinicId, start, end),
                financeService.getExpenses(clinicId, start, end),
                financeService.getIncomes(clinicId, start, end),
                financeService.getTransactions(clinicId, start, end),
            ])

            if (format === 'json') {
                const data = {
                    reporte: { clinica: clinicName, periodo: periodLabel, generado: new Date().toLocaleString('es-CL') },
                    resumen: {
                        ingresos: statsData?.total_income ?? 0,
                        gastos: statsData?.total_expenses ?? 0,
                        ganancia_neta: statsData?.net_profit ?? 0,
                        por_cobrar: statsData?.pending_payments ?? 0,
                        total_citas: statsData?.appointments_count ?? 0,
                    },
                    transacciones: (txData || []).map((tx: any) => ({
                        fecha: new Date(tx.appointment_date).toLocaleDateString('es-CL'),
                        paciente: tx.patient_name,
                        servicio: tx.service || '-',
                        monto: tx.price ?? 0,
                        estado: STATUS_LABELS[tx.payment_status] ?? tx.payment_status,
                        metodo_pago: tx.payment_method || 'N/A',
                    })),
                    gastos: (expensesData || []).map((exp: any) => ({
                        fecha: exp.date,
                        descripcion: exp.description,
                        categoria: CATEGORY_EXPENSE[exp.category] ?? exp.category,
                        metodo_pago: exp.payment_method || 'N/A',
                        monto: exp.amount,
                    })),
                    ingresos_manuales: (incomesData || []).map((inc: any) => ({
                        fecha: inc.date,
                        descripcion: inc.description,
                        categoria: CATEGORY_INCOME[inc.category] ?? inc.category,
                        metodo_pago: inc.payment_method || 'N/A',
                        monto: inc.amount,
                    })),
                }
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
                downloadBlob(blob, `reporte_finanzas_${dateStamp}.json`)
            } else {
                const sep = ','; const lines: string[] = []
                lines.push(`REPORTE FINANCIERO — ${clinicName}`)
                lines.push(`Período: ${periodLabel}`)
                lines.push(`Generado: ${new Date().toLocaleString('es-CL')}`)
                lines.push('')

                lines.push('RESUMEN')
                lines.push(`Ingresos${sep}${currency}${fmt(statsData?.total_income ?? 0)}`)
                lines.push(`Gastos${sep}${currency}${fmt(statsData?.total_expenses ?? 0)}`)
                lines.push(`Ganancia Neta${sep}${currency}${fmt(statsData?.net_profit ?? 0)}`)
                lines.push(`Por Cobrar${sep}${currency}${fmt(statsData?.pending_payments ?? 0)}`)
                lines.push(`Total Citas${sep}${statsData?.appointments_count ?? 0}`)
                lines.push('')

                lines.push('TRANSACCIONES')
                lines.push(`Fecha${sep}Paciente${sep}Servicio${sep}Monto${sep}Estado${sep}Método de Pago`)
                if ((txData || []).length > 0) {
                    (txData as any[]).forEach(tx => lines.push([
                        new Date(tx.appointment_date).toLocaleDateString('es-CL'),
                        `"${(tx.patient_name || '').replace(/"/g, '""')}"`,
                        `"${(tx.service || '-').replace(/"/g, '""')}"`,
                        `${currency}${fmt(tx.price ?? 0)}`,
                        STATUS_LABELS[tx.payment_status] ?? tx.payment_status,
                        tx.payment_method || 'N/A',
                    ].join(sep)))
                } else lines.push('Sin transacciones en este período')
                lines.push('')

                lines.push('GASTOS')
                lines.push(`Fecha${sep}Descripción${sep}Categoría${sep}Método de Pago${sep}Monto`)
                if ((expensesData || []).length > 0) {
                    (expensesData as any[]).forEach(exp => lines.push([
                        exp.date,
                        `"${exp.description.replace(/"/g, '""')}"`,
                        CATEGORY_EXPENSE[exp.category] ?? exp.category,
                        exp.payment_method || 'N/A',
                        `${currency}${fmt(exp.amount)}`,
                    ].join(sep)))
                } else lines.push('Sin gastos en este período')
                lines.push('')

                lines.push('INGRESOS MANUALES')
                lines.push(`Fecha${sep}Descripción${sep}Categoría${sep}Método de Pago${sep}Monto`)
                if ((incomesData || []).length > 0) {
                    (incomesData as any[]).forEach(inc => lines.push([
                        inc.date,
                        `"${inc.description.replace(/"/g, '""')}"`,
                        CATEGORY_INCOME[inc.category] ?? inc.category,
                        inc.payment_method || 'N/A',
                        `${currency}${fmt(inc.amount)}`,
                    ].join(sep)))
                } else lines.push('Sin ingresos manuales en este período')

                const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
                downloadBlob(blob, `reporte_finanzas_${dateStamp}.csv`)
            }

            toast.success('Reporte descargado correctamente')
            onClose()
        } catch (err) {
            console.error('Export error:', err)
            toast.error('Error al generar el reporte')
        } finally {
            setDownloading(false)
        }
    }

    function downloadBlob(blob: Blob, filename: string) {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = filename
        document.body.appendChild(a); a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(url), 100)
    }

    const periodLabel = getPeriodLabel(filterType, customRange)
    const canExport = !(filterType === 'custom' && !customRange)

    return (
        <div className="fixed inset-0 bg-charcoal/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-silk-beige shrink-0">
                    <div>
                        <h3 className="font-bold text-charcoal">Exportar reporte financiero</h3>
                        <p className="text-xs text-charcoal/50 mt-0.5">{clinicName}</p>
                    </div>
                    <button onClick={onClose} className="text-charcoal/40 hover:text-charcoal">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Selector de período — fuera del scroll para que el calendario no quede recortado */}
                <div className="px-5 py-4 border-b border-silk-beige shrink-0">
                    <p className="text-xs font-bold text-charcoal/50 uppercase tracking-wider mb-2">Período</p>
                    <div className="flex gap-1 flex-wrap">
                        {([
                            { id: 'day', label: 'Hoy' },
                            { id: 'week', label: 'Semana' },
                            { id: 'month', label: 'Este mes' },
                            { id: 'year', label: 'Este año' },
                        ] as const).map(r => (
                            <button key={r.id}
                                onClick={() => { setFilterType(r.id); setCustomRange(null) }}
                                className={cn(
                                    'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                                    filterType === r.id
                                        ? 'bg-primary-500 text-white shadow-sm'
                                        : 'bg-silk-beige text-charcoal/60 hover:text-charcoal'
                                )}
                            >
                                {r.label}
                            </button>
                        ))}
                        {/* Rango personalizado */}
                        <div className="relative" ref={calRef}>
                            <button
                                onClick={() => setShowCal(v => !v)}
                                className={cn(
                                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all',
                                    filterType === 'custom'
                                        ? 'bg-primary-500 text-white border-primary-500'
                                        : 'bg-white border-silk-beige text-charcoal/60 hover:text-charcoal'
                                )}
                            >
                                <CalendarRange className="w-3.5 h-3.5" />
                                {filterType === 'custom' && customRange
                                    ? `${dateFnsFormat(customRange.start, 'd MMM', { locale: esLocale })} – ${dateFnsFormat(customRange.end, 'd MMM', { locale: esLocale })}`
                                    : 'Rango'}
                                {filterType === 'custom' && customRange && (
                                    <span onClick={e => { e.stopPropagation(); setFilterType('month'); setCustomRange(null) }}>
                                        <X className="w-3 h-3" />
                                    </span>
                                )}
                            </button>
                            {showCal && (
                                <div className="absolute left-0 top-full mt-2 bg-white border border-silk-beige rounded-2xl shadow-xl z-[60]">
                                    <MiniCalendar />
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-4">

                    {/* Preview de estadísticas */}
                    <div className="bg-ivory rounded-xl border border-silk-beige p-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-charcoal/40 mb-3 capitalize">{periodLabel}</p>
                        {loadingStats ? (
                            <div className="flex items-center gap-2 text-charcoal/40 text-sm">
                                <Loader2 className="w-4 h-4 animate-spin" /> Calculando...
                            </div>
                        ) : stats ? (
                            <div className="grid grid-cols-2 gap-3">
                                <div className="flex items-center gap-2">
                                    <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                                        <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-charcoal/50">Ingresos</p>
                                        <p className="text-sm font-bold text-charcoal">{currency}{fmt(stats.total_income ?? 0)}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-7 h-7 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                                        <TrendingDown className="w-3.5 h-3.5 text-red-500" />
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-charcoal/50">Gastos</p>
                                        <p className="text-sm font-bold text-charcoal">{currency}{fmt(stats.total_expenses ?? 0)}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
                                        <DollarSign className="w-3.5 h-3.5 text-primary-600" />
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-charcoal/50">Ganancia neta</p>
                                        <p className={cn('text-sm font-bold', (stats.net_profit ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-500')}>
                                            {currency}{fmt(stats.net_profit ?? 0)}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                                        <CreditCard className="w-3.5 h-3.5 text-amber-600" />
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-charcoal/50">Por cobrar</p>
                                        <p className="text-sm font-bold text-charcoal">{currency}{fmt(stats.pending_payments ?? 0)}</p>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <p className="text-sm text-charcoal/40">Sin datos para este período</p>
                        )}
                    </div>

                    {/* Selector de formato */}
                    <div>
                        <p className="text-xs font-bold text-charcoal/50 uppercase tracking-wider mb-2">Formato de archivo</p>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                onClick={() => setFormat('csv')}
                                className={cn(
                                    'flex items-center gap-3 p-3 rounded-xl border text-left transition-all',
                                    format === 'csv'
                                        ? 'border-primary-400 bg-primary-50'
                                        : 'border-silk-beige hover:border-primary-200'
                                )}
                            >
                                <FileText className={cn('w-5 h-5 shrink-0', format === 'csv' ? 'text-primary-600' : 'text-emerald-500')} />
                                <div>
                                    <p className="text-xs font-bold text-charcoal">CSV</p>
                                    <p className="text-[10px] text-charcoal/50">Compatible con Excel</p>
                                </div>
                            </button>
                            <button
                                onClick={() => setFormat('json')}
                                className={cn(
                                    'flex items-center gap-3 p-3 rounded-xl border text-left transition-all',
                                    format === 'json'
                                        ? 'border-primary-400 bg-primary-50'
                                        : 'border-silk-beige hover:border-primary-200'
                                )}
                            >
                                <FileText className={cn('w-5 h-5 shrink-0', format === 'json' ? 'text-primary-600' : 'text-amber-500')} />
                                <div>
                                    <p className="text-xs font-bold text-charcoal">JSON</p>
                                    <p className="text-[10px] text-charcoal/50">Para análisis de datos</p>
                                </div>
                            </button>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex gap-3 p-5 pt-0 shrink-0">
                    <button onClick={onClose} className="flex-1 btn-secondary py-2 text-sm">
                        Cancelar
                    </button>
                    <button
                        onClick={handleDownload}
                        disabled={!canExport || downloading}
                        className="flex-1 bg-emerald-600 text-white font-semibold py-2 rounded-lg text-sm hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {downloading
                            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generando...</>
                            : <><Download className="w-3.5 h-3.5" /> Descargar {format.toUpperCase()}</>
                        }
                    </button>
                </div>
            </div>
        </div>
    )
}
