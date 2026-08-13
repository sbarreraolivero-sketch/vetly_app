
import { useState, useEffect, useRef, useMemo } from 'react'
import {
    DollarSign,
    TrendingUp,
    TrendingDown,
    CreditCard,
    Plus,
    Download,
    X,
    ChevronLeft,
    ChevronRight,
    Trash2,
    Pencil,
    Calendar,
    CalendarRange,
    Lightbulb,
} from 'lucide-react'
import {
    startOfDay, endOfDay,
    startOfMonth, endOfMonth, startOfWeek,
    getDay, addDays, addMonths, subMonths,
    isSameDay, isBefore, isAfter,
    differenceInCalendarDays,
    format as dateFnsFormat,
} from 'date-fns'
import { es as esLocale } from 'date-fns/locale'
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid,
    Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { useAuth } from '@/contexts/AuthContext'
import { usePermissions } from '@/hooks/usePermissions'
import { useClinicTimezone } from '@/hooks/useClinicTimezone'
import { supabase } from '@/lib/supabase'
import { financeService, type FinanceStats, type Expense, type Income, type CashRegister } from '@/services/financeService'
import { inventoryService } from '@/services/inventoryService'
import { CajaDelDia, CloseCajaModal } from '@/components/finance/CajaDelDia'
import { CajaExpenseModal } from '@/components/finance/CajaExpenseModal'
import { printCajaReport } from '@/components/finance/CajaReport'
import { ExportModal } from '@/components/finance/ExportModal'
import { cn } from '@/lib/utils'
import { toast } from 'react-hot-toast'
import { GuideBox } from '@/components/ui/GuideBox'
import { NewIncomeForm } from '@/components/finance/NewIncomeForm'

const CATEGORY_LABELS_EXPENSE: Record<string, string> = {
    rent: 'Alquiler',
    supplies: 'Insumos',
    payroll: 'Nómina',
    marketing: 'Marketing',
    utilities: 'Servicios Básicos',
    other: 'Otro',
}


const translateCategoryExpense = (cat: string) => CATEGORY_LABELS_EXPENSE[cat] ?? cat

const CATEGORY_LABELS_INCOME: Record<string, string> = {
    service: 'Servicio',
    product: 'Producto',
    adjustment: 'Ajuste',
    other: 'Otro',
}

const translateCategoryIncome = (cat: string) => CATEGORY_LABELS_INCOME[cat] ?? cat

const PAYMENT_METHOD_LABELS: Record<string, string> = {
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

const translatePaymentMethod = (m?: string | null) => (m ? (PAYMENT_METHOD_LABELS[m.toLowerCase()] ?? m) : '—')

// Monedas sin subunidad en circulación: mostrarles centavos es incorrecto.
const CURRENCIES_WITHOUT_DECIMALS = new Set(['CLP', 'COP', 'PYG', 'JPY', 'KRW', 'ISK', 'VND'])

const CURRENCY_LOCALES: Record<string, string> = {
    CLP: 'es-CL', ARS: 'es-AR', COP: 'es-CO', PEN: 'es-PE',
    MXN: 'es-MX', UYU: 'es-UY', PYG: 'es-PY', BOB: 'es-BO',
    USD: 'en-US', EUR: 'es-ES', BRL: 'pt-BR',
}

const CURRENCY_SYMBOLS: Record<string, string> = {
    CLP: '$', ARS: '$', COP: '$', MXN: '$', UYU: '$', USD: '$',
    PEN: 'S/', PYG: '₲', BOB: 'Bs', EUR: '€', BRL: 'R$',
}

// Serie de ingresos y de gastos del gráfico. Verde/rojo — la convención obvia —
// está descartada a propósito: es la peor combinación para daltonismo
// (deuteranopía, ~6% de los hombres). Este par sí separa bien: el teal es el
// primary de la marca y el naranja se lee igual como "salida de dinero".
const CHART_INCOME_COLOR  = '#0d9488'
const CHART_EXPENSE_COLOR = '#ea580c'

// Tipos de ítem dentro de un ingreso. 'custom' = ítem libre escrito a mano,
// sin catálogo — no se puede clasificar como servicio ni producto.
const ITEM_TYPE_LABELS: Record<string, string> = {
    service: 'Servicios',
    product: 'Productos',
    custom:  'Ítems libres',
}

const ITEM_TYPE_STYLES: Record<string, string> = {
    service: 'bg-primary-100 text-primary-600',
    product: 'bg-violet-100 text-violet-600',
    custom:  'bg-amber-100 text-amber-700',
}

// parseLocalDate now comes from useClinicTimezone hook

// ── Component ────────────────────────────────────────────────────────
const Finance = () => {
    const { profile, member, user } = useAuth()
    const { can, isOwner } = usePermissions()
    const clinicId = member?.clinic_id || profile?.clinic_id
    const [clinicName, setClinicName] = useState<string>((member as any)?.clinic_name || (profile as any)?.clinic_name || 'Clínica')
    // Moneda real de la clínica; CLP como fallback razonable para este mercado.
    const [currency, setCurrency] = useState<string>('CLP')

    // Timezone-aware date utilities from clinic settings
    const {
        timezone,
        formatInTz,
        getDateRange,
    } = useClinicTimezone()

    const [stats, setStats] = useState<FinanceStats | null>(null)
    const [expenses, setExpenses] = useState<Expense[]>([])
    const [incomes, setIncomes] = useState<Income[]>([])
    const [loading, setLoading] = useState(true)
    const [itemMetrics, setItemMetrics] = useState<any>(null)
    const [activeTab, setActiveTab] = useState<'dashboard' | 'cajas' | 'expenses' | 'incomes' | 'analysis'>('dashboard')
    const [cashRegisters, setCashRegisters] = useState<CashRegister[]>([])
    const [cajaToClose, setCajaToClose] = useState<string | null>(null)  // date 'YYYY-MM-DD'
    const [closingCaja, setClosingCaja] = useState(false)
    const [reopeningCaja, setReopeningCaja] = useState<string | null>(null)  // date en proceso de reapertura
    const [showExpenseModal, setShowExpenseModal] = useState(false)
    const [showIncomeModal, setShowIncomeModal] = useState(false)
    const [filterType, setFilterType] = useState<'day' | 'week' | 'month' | 'year' | 'custom'>('month')
    const [customRange, setCustomRange] = useState<{ start: Date; end: Date } | null>(null)
    const [showDatePicker, setShowDatePicker] = useState(false)
    const datePickerRef = useRef<HTMLDivElement>(null)

    // ── Close date picker on click-outside ──
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (datePickerRef.current && !datePickerRef.current.contains(e.target as Node)) {
                setShowDatePicker(false)
            }
        }
        if (showDatePicker) document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [showDatePicker])

    const getFilterLabel = () => {
        if (filterType === 'custom' && customRange) {
            return `${dateFnsFormat(customRange.start, 'd MMM', { locale: esLocale })} – ${dateFnsFormat(customRange.end, 'd MMM', { locale: esLocale })}`
        }
        switch (filterType) {
            case 'day': return 'Hoy'
            case 'week': return 'Semana'
            case 'month': return 'Mes'
            case 'year': return 'Año'
            default: return 'Período'
        }
    }

    // ── Data loading ──
    useEffect(() => {
        if (filterType === 'custom' && !customRange) return
        loadData()
    }, [clinicId, filterType, customRange, timezone])

    const loadData = async () => {
        if (!clinicId) return
        setLoading(true)
        try {
            let start: Date, end: Date
            if (filterType === 'custom' && customRange) {
                start = startOfDay(customRange.start)
                end   = endOfDay(customRange.end)
            } else {
                const range = getDateRange(filterType as 'day' | 'week' | 'month' | 'year')
                start = range.start
                end   = range.end
            }

            // allSettled: que un fallo en una query no tumbe a las demás. Con Promise.all,
            // un solo rechazo dejaba toda la UI sin actualizar (datos viejos hasta refrescar).
            const [statsR, expR, incR, metR, crR, csR] = await Promise.allSettled([
                financeService.getStats(clinicId, start, end),
                financeService.getExpenses(clinicId, start, end),
                financeService.getIncomes(clinicId, start, end),
                financeService.getItemMetrics(clinicId, start, end),
                financeService.getCashRegisters(clinicId, start, end),
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                Promise.resolve((supabase as any).from('clinic_settings').select('clinic_name, currency').eq('id', clinicId).single()).then((r: any) => r),
            ])

            if (statsR.status === 'fulfilled') setStats(statsR.value)
            if (expR.status === 'fulfilled') setExpenses(expR.value)
            if (incR.status === 'fulfilled') setIncomes(incR.value)
            setItemMetrics(metR.status === 'fulfilled' ? metR.value : null)
            if (crR.status === 'fulfilled') setCashRegisters(crR.value)
            const cs = csR.status === 'fulfilled' ? (csR.value as any) : null
            if (cs?.data?.clinic_name) setClinicName(cs.data.clinic_name)
            if (cs?.data?.currency) setCurrency(cs.data.currency)

            const failed = [statsR, expR, incR, metR, crR].filter(r => r.status === 'rejected')
            if (failed.length > 0) {
                console.error('Finance: carga parcial con errores', failed.map(f => (f as PromiseRejectedResult).reason))
            }
        } catch (error) {
            console.error('Error loading finance data:', error)
        } finally {
            setLoading(false)
        }
    }

    const [editingIncome, setEditingIncome] = useState<any | null>(null)
    const [incomeDefaultDate, setIncomeDefaultDate] = useState<string | undefined>(undefined)
    const [showExportModal, setShowExportModal] = useState(false)
    const [showCajaExpenseModal, setShowCajaExpenseModal] = useState(false)
    const [expenseDefaultDate, setExpenseDefaultDate] = useState<string | undefined>(undefined)
    const [editingExpense, setEditingExpense] = useState<Expense | null>(null)

    // Métricas de venta del período. `sale_metrics` es la clave nueva (calculada
    // sobre `incomes`); `appt_metrics` es el alias de compatibilidad que emite el
    // RPC para no romper un frontend viejo cacheado durante el deploy.
    const saleMetrics = itemMetrics?.sale_metrics
        ?? (itemMetrics?.appt_metrics
            ? {
                avg_ticket:          itemMetrics.appt_metrics.avg_ticket,
                total_sales:         itemMetrics.appt_metrics.total_appts,
                sales_with_products: itemMetrics.appt_metrics.appts_with_products,
            }
            : null)

    // Serie temporal Ingresos vs Gastos. Se agrupa en el cliente sobre los datos
    // que ya cargó loadData() — sin queries extra. La granularidad se ajusta para
    // que el gráfico nunca pase de ~14 barras por serie y siga siendo legible.
    const chartData = useMemo(() => {
        let start: Date, end: Date
        if (filterType === 'custom' && customRange) {
            start = startOfDay(customRange.start)
            end   = endOfDay(customRange.end)
        } else {
            const r = getDateRange(filterType as 'day' | 'week' | 'month' | 'year')
            start = r.start
            end   = r.end
        }

        const totalDays = differenceInCalendarDays(end, start) + 1
        const grain: 'day' | 'week' | 'month' =
            totalDays <= 14 ? 'day' : totalDays <= 92 ? 'week' : 'month'

        const bucketStart = (d: Date) =>
            grain === 'month' ? startOfMonth(d)
          : grain === 'week'  ? startOfWeek(d, { weekStartsOn: 1 })
          :                     startOfDay(d)

        const keyOf   = (d: Date) => dateFnsFormat(bucketStart(d), 'yyyy-MM-dd')
        const labelOf = (d: Date) =>
            grain === 'month' ? dateFnsFormat(bucketStart(d), 'MMM', { locale: esLocale })
          : grain === 'week'  ? dateFnsFormat(bucketStart(d), 'd MMM', { locale: esLocale })
          :                     dateFnsFormat(bucketStart(d), 'd MMM', { locale: esLocale })

        // Buckets pre-creados en orden: un período sin movimiento debe verse como
        // cero, no desaparecer del eje.
        const buckets = new Map<string, { label: string; ingresos: number; gastos: number }>()
        let cursor = bucketStart(start)
        while (cursor <= end) {
            buckets.set(keyOf(cursor), { label: labelOf(cursor), ingresos: 0, gastos: 0 })
            cursor = grain === 'month' ? addMonths(cursor, 1)
                   : grain === 'week'  ? addDays(cursor, 7)
                   :                     addDays(cursor, 1)
        }

        // Mediodía local para que el parseo no corra el día por zona horaria.
        const bump = (dateStr: string, field: 'ingresos' | 'gastos', amount: number) => {
            if (!dateStr) return
            const b = buckets.get(keyOf(new Date(`${dateStr}T12:00:00`)))
            if (b) b[field] += Number(amount) || 0
        }
        incomes.forEach(i => bump(i.date, 'ingresos', i.amount))
        expenses.forEach(e => bump(e.date, 'gastos', e.amount))

        return Array.from(buckets.values())
    }, [incomes, expenses, filterType, customRange, timezone])

    const hasChartData = chartData.some(d => d.ingresos > 0 || d.gastos > 0)

    // Eje Y compacto: los montos completos en CLP son ilegibles como etiqueta.
    const formatAxisAmount = (n: number) =>
        Math.abs(n) >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
      : Math.abs(n) >= 1_000     ? `${Math.round(n / 1_000)}K`
      :                            String(n)

    // ── Currency formatter ──
    // Estaba fijo en pesos mexicanos, así que a una clínica chilena le mostraba
    // "284,312.50" (formato MX con centavos) donde el CLP no usa decimales.
    // Se toma la moneda real de la clínica y se omiten los decimales en las
    // monedas que no los usan.
    const currencySymbol = CURRENCY_SYMBOLS[currency] ?? '$'

    const formatCurrency = (amount: number) => {
        const noDecimals = CURRENCIES_WITHOUT_DECIMALS.has(currency)
        return new Intl.NumberFormat(CURRENCY_LOCALES[currency] ?? 'es-CL', {
            style: 'currency',
            currency,
            maximumFractionDigits: noDecimals ? 0 : 2,
        }).format(amount)
    }

    // ── Export handlers ──

    // ── Expense handlers ──
    const handleAddExpense = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!clinicId) {
            toast.error('No se pudo identificar la clínica')
            return
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const form = e.target as any
        const description = form.description.value
        const amount = parseFloat(form.amount.value)
        const category = form.category.value
        const date = form.date.value

        try {
            await financeService.addExpense({
                clinic_id: clinicId,
                description,
                amount,
                category,
                date
            })
            toast.success('Gasto registrado exitosamente')
            setShowExpenseModal(false)
            loadData()
        } catch (error) {
            console.error('Error adding expense:', error)
            toast.error('Error al registrar el gasto')
        }
    }

    const handleDeleteExpense = async (expenseId: string, description: string) => {
        if (!confirm(`¿Estás seguro de que deseas eliminar el gasto "${description}"?`)) return

        try {
            await financeService.deleteExpense(expenseId, clinicId ?? undefined)
            toast.success('Gasto eliminado')
            loadData()
        } catch (error) {
            console.error('Error deleting expense:', error)
            toast.error('Error al eliminar el gasto')
        }
    }

    const handleUpdateExpense = async (expenseData: {
        id?: string; description: string; amount: number; category: string
        payment_method: string | null; receipt_url: string | null; date: string
    }) => {
        if (!editingExpense?.id) return
        try {
            await financeService.updateExpense(editingExpense.id, {
                description:    expenseData.description,
                amount:         expenseData.amount,
                category:       expenseData.category as Expense['category'],
                date:           expenseData.date,
                payment_method: expenseData.payment_method,
                receipt_url:    expenseData.receipt_url,
            }, clinicId ?? undefined)
            toast.success('Gasto actualizado')
            setEditingExpense(null)
            loadData()
        } catch (error) {
            console.error('Error updating expense:', error)
            toast.error('Error al actualizar el gasto')
        }
    }

    // ── Income handlers ──
    // Los productos de un ingreso manual (incomeData.services, type='product') nunca
    // descontaban stock — se registraba el ingreso pero el inventario no se enteraba.
    // Esta función crea/reconcilia los movimientos de inventario correspondientes.
    // Nunca debe bloquear el guardado/borrado del ingreso: solo loguea si falla.
    const syncProductStockForIncome = async (incomeId: string, services: any[] | undefined, tutorId?: string) => {
        if (!clinicId) return
        try {
            const location = await inventoryService.getActiveForSalesLocation(clinicId)
            await inventoryService.syncIncomeProductMovements({
                clinicId,
                incomeId,
                // Se pasan TODOS los ítems: los servicios vinculados a un producto
                // de inventario también descuentan stock (ej. una vacuna).
                items: services ?? [],
                tutorId: tutorId ?? null,
                locationId: location?.id ?? null,
            })
        } catch (error) {
            console.warn('No se pudo sincronizar el stock para este ingreso:', error)
        }
    }

    const handleAddIncome = async (incomeData: { description: string, amount: number, discount?: number, discount_reason?: string, iva_amount?: number, category: string, date: string, tutor_id?: string, services?: any[], notes?: string, payment_method?: string }) => {
        if (!clinicId) { toast.error('No se pudo identificar la clínica'); return }
        try {
            const created = await financeService.addIncome({
                clinic_id:       clinicId,
                description:     incomeData.description,
                amount:          incomeData.amount,
                discount:        incomeData.discount ?? 0,
                discount_reason: incomeData.discount_reason,
                iva_amount:      incomeData.iva_amount,
                category:        incomeData.category as any,
                date:            incomeData.date,
                tutor_id:        incomeData.tutor_id,
                services:        incomeData.services,
                notes:           incomeData.notes,
                payment_method:  incomeData.payment_method,
            } as any)
            if (created?.id) await syncProductStockForIncome(created.id, incomeData.services, incomeData.tutor_id)
            toast.success('Ingreso registrado')
            setShowIncomeModal(false)
            loadData()
        } catch (error) {
            console.error('Error adding income:', error)
            toast.error('Error al registrar el ingreso')
        }
    }

    const handleUpdateIncome = async (incomeData: { description: string, amount: number, discount?: number, discount_reason?: string, iva_amount?: number, category: string, date: string, tutor_id?: string, services?: any[], notes?: string, payment_method?: string }) => {
        if (!editingIncome?.id) return
        try {
            await financeService.updateIncome(editingIncome.id, {
                description:     incomeData.description,
                amount:          incomeData.amount,
                discount:        incomeData.discount ?? 0,
                discount_reason: incomeData.discount_reason,
                iva_amount:      incomeData.iva_amount,
                category:        incomeData.category as any,
                date:            incomeData.date,
                tutor_id:        incomeData.tutor_id,
                services:        incomeData.services,
                notes:           incomeData.notes,
                payment_method:  incomeData.payment_method,
            } as any)
            await syncProductStockForIncome(editingIncome.id, incomeData.services, incomeData.tutor_id)
            toast.success('Ingreso actualizado')
            setEditingIncome(null)
            loadData()
        } catch (error) {
            console.error('Error updating income:', error)
            toast.error('Error al actualizar el ingreso')
        }
    }

    const handleDeleteIncome = async (incomeId: string, description: string) => {
        if (!confirm(`¿Eliminar el ingreso "${description}"?`)) return
        // Actualización optimista: quitamos el ingreso de la vista al instante.
        // No dependemos de loadData() para reflejar el borrado — si alguna de sus
        // queries en paralelo falla, el Promise.all cae al catch y la lista quedaría
        // con datos viejos hasta refrescar la página.
        const prevIncomes = incomes
        setIncomes(curr => curr.filter(i => i.id !== incomeId))
        try {
            // Revertir el stock ANTES de borrar — al borrar el ingreso, el FK de
            // inventory_movements.income_id (ON DELETE SET NULL) desvincularía los
            // movimientos y ya no podríamos encontrarlos para revertirlos.
            await syncProductStockForIncome(incomeId, [])
            await financeService.deleteIncome(incomeId)
            toast.success('Ingreso eliminado')
            loadData() // re-sincroniza totales y cajas en segundo plano
        } catch (error) {
            console.error('Error deleting income:', error)
            toast.error('Error al eliminar el ingreso')
            setIncomes(prevIncomes) // revertir si el borrado falló
        }
    }

    // ── Mini calendario de rango ──────────────────────────────────────────
    function MiniCalendar() {
        const [calMonth, setCalMonth] = useState(() => customRange?.start ?? new Date())
        const [selecting, setSelecting] = useState<Date | null>(customRange?.start ?? null)
        const [hovered, setHovered] = useState<Date | null>(null)

        const days = useMemo(() => {
            const first = startOfMonth(calMonth)
            const last  = endOfMonth(calMonth)
            const pad   = (getDay(first) + 6) % 7
            const grid: (Date | null)[] = Array(pad).fill(null)
            let d = new Date(first)
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
        const isEnd   = (d: Date) => !!rangeEnd && isSameDay(d, rangeEnd)
        const isToday = (d: Date) => isSameDay(d, new Date())

        const handleDay = (d: Date) => {
            if (!selecting) {
                setSelecting(d)
            } else {
                const [s, e] = isBefore(d, selecting) ? [d, selecting] : [selecting, d]
                setCustomRange({ start: s, end: e })
                setFilterType('custom')
                setShowDatePicker(false)
            }
        }

        const weekDays = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

        return (
            <div className="p-3 w-72">
                <div className="flex items-center justify-between mb-3">
                    <button onClick={() => setCalMonth(m => subMonths(m, 1))} className="p-1 hover:bg-silk-beige rounded-lg transition-colors">
                        <ChevronLeft className="w-4 h-4 text-charcoal/60" />
                    </button>
                    <span className="text-sm font-bold text-charcoal capitalize">
                        {dateFnsFormat(calMonth, 'MMMM yyyy', { locale: esLocale })}
                    </span>
                    <button onClick={() => setCalMonth(m => addMonths(m, 1))} className="p-1 hover:bg-silk-beige rounded-lg transition-colors">
                        <ChevronRight className="w-4 h-4 text-charcoal/60" />
                    </button>
                </div>
                <div className="grid grid-cols-7 mb-1">
                    {weekDays.map((w, i) => (
                        <div key={i} className="text-center text-[10px] font-bold text-charcoal/30 py-1">{w}</div>
                    ))}
                </div>
                <div className="grid grid-cols-7">
                    {days.map((d, i) => {
                        if (!d) return <div key={i} />
                        const start = isStart(d)
                        const end   = isEnd(d)
                        const range = inRange(d)
                        const today = isToday(d)
                        return (
                            <button
                                key={i}
                                onMouseEnter={() => selecting && setHovered(d)}
                                onMouseLeave={() => setHovered(null)}
                                onClick={() => handleDay(d)}
                                className={`
                                    relative h-8 text-xs font-medium transition-colors
                                    ${start || end ? 'bg-primary-500 text-white rounded-lg z-10' : ''}
                                    ${range && !start && !end ? 'bg-primary-100 text-primary-700' : ''}
                                    ${!start && !end && !range ? 'hover:bg-silk-beige text-charcoal rounded-lg' : ''}
                                    ${today && !start && !end ? 'font-extrabold' : ''}
                                `}
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

    // Fecha de hoy en la zona horaria de la clínica (no UTC)
    const todayLocalStr = new Date().toLocaleDateString('sv-SE', { timeZone: timezone || 'America/Santiago' })

    // ── Agrupar ingresos manuales y gastos por fecha para la vista de Cajas ──
    // Las citas (appointments) NO se procesan aquí: la caja solo refleja ingresos manuales.
    const cajasByDate = useMemo(() => {
        const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: timezone || 'America/Santiago' })
        const map: Record<string, { incomes: typeof incomes; expenses: typeof expenses }> = {}

        for (const inc of incomes) {
            const d = inc.date?.split('T')[0] ?? inc.date
            if (!d || d > todayStr) continue
            if (!map[d]) map[d] = { incomes: [], expenses: [] }
            map[d].incomes.push(inc)
        }
        for (const exp of expenses) {
            const d = (exp.date as string)?.split('T')[0] ?? (exp.date as string)
            if (!d || d > todayStr) continue
            if (!map[d]) map[d] = { incomes: [], expenses: [] }
            map[d].expenses.push(exp)
        }

        // Incluir toda caja registrada en la DB aunque no tenga movimientos
        for (const cr of cashRegisters) {
            const d = cr.date?.split('T')[0] ?? cr.date
            if (!d || d > todayStr) continue
            if (!map[d]) map[d] = { incomes: [], expenses: [] }
        }

        // Siempre mostrar la caja de hoy aunque esté vacía
        if (!map[todayStr]) {
            map[todayStr] = { incomes: [], expenses: [] }
        }

        return Object.entries(map).sort(([a], [b]) => b.localeCompare(a))
    }, [incomes, expenses, cashRegisters, timezone])

    const handleCloseCaja = async (date: string, notes: string) => {
        if (!clinicId || !user?.id) return
        setClosingCaja(true)
        try {
            const result = await financeService.closeCaja(clinicId, date, notes, user.id)
            setCashRegisters(prev => {
                const filtered = prev.filter(c => c.date !== date)
                return [...filtered, result]
            })
            setCajaToClose(null)
            toast.success('Caja cerrada correctamente')
        } catch (err) {
            console.error('Error cerrando caja:', err)
            toast.error('No se pudo cerrar la caja')
        } finally {
            setClosingCaja(false)
        }
    }

    const handleReopenCaja = async (date: string) => {
        if (!clinicId) return
        if (!confirm(`¿Reabrir la caja del ${date}? Podrás volver a editar sus ingresos y gastos.`)) return
        setReopeningCaja(date)
        try {
            const result = await financeService.reopenCaja(clinicId, date)
            setCashRegisters(prev => prev.map(c => c.date === date ? result : c))
            toast.success('Caja reabierta')
        } catch (err) {
            console.error('Error reabriendo caja:', err)
            toast.error('No se pudo reabrir la caja')
        } finally {
            setReopeningCaja(null)
        }
    }

    const handleAddExpenseFromCaja = async (expenseData: {
        description: string; amount: number; category: string
        payment_method: string | null; receipt_url: string | null; date: string
    }) => {
        if (!clinicId) return
        try {
            await financeService.addExpense({
                clinic_id:      clinicId,
                description:    expenseData.description,
                amount:         expenseData.amount,
                category:       expenseData.category as Expense['category'],
                date:           expenseData.date,
                payment_method: expenseData.payment_method,
                receipt_url:    expenseData.receipt_url,
            })
            toast.success('Gasto registrado')
            setShowCajaExpenseModal(false)
            loadData()
        } catch (err) {
            console.error('Error registrando gasto:', err)
            toast.error('No se pudo registrar el gasto')
        }
    }

    const handleSetOpeningBalance = async (date: string, amount: number) => {
        if (!clinicId || !user?.id) return
        try {
            await financeService.updateOpeningBalance(clinicId, date, amount, user.id)
            // Actualizar el estado local sin recargar todo
            setCashRegisters(prev => {
                const existing = prev.find(c => c.date === date)
                if (existing) {
                    return prev.map(c => c.date === date ? { ...c, opening_balance: amount } : c)
                }
                // Si no existe en el estado, crear un registro temporal
                return [...prev, {
                    id: `temp-${date}`, clinic_id: clinicId, date, status: 'open' as const,
                    opening_balance: amount, total_cobrado: 0, total_pendiente: 0,
                    total_efectivo: 0, total_transferencia: 0, total_tarjeta: 0, total_debito: 0,
                    total_gastos: 0, income_count: 0, notes: null, closed_by: null, closed_at: null,
                    reopened_by: null, reopened_at: null,
                    created_at: new Date().toISOString(),
                }]
            })
            toast.success('Saldo inicial guardado')
        } catch (err) {
            console.error('Error guardando saldo inicial:', err)
            toast.error('No se pudo guardar el saldo inicial')
        }
    }

    const handleViewReceipt = async (storagePath: string) => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data, error } = await (supabase as any).storage
                .from('expense-receipts')
                .createSignedUrl(storagePath, 3600)
            if (error || !data?.signedUrl) throw new Error('No se pudo generar el enlace')
            window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
        } catch (err) {
            console.error('Error generando URL firmada:', err)
            toast.error('No se pudo abrir la boleta')
        }
    }

    const handleDownloadCajaReport = (date: string) => {
        const entry = cajasByDate.find(([d]) => d === date)
        const cashReg = cashRegisters.find(c => c.date === date)
        const dayLabel = (() => {
            try {
                return new Date(date + 'T12:00:00').toLocaleDateString('es-CL', {
                    weekday: 'long', day: 'numeric', month: 'short', year: 'numeric'
                })
            } catch { return date }
        })()
        printCajaReport({
            clinicName,
            date,
            dateLabel: dayLabel,
            currency: '$',
            openingBalance: cashReg?.opening_balance ?? 0,
            incomes: entry ? entry[1].incomes : [],
            expenses: entry ? entry[1].expenses : [],
            notes: cashReg?.notes,
            closedAt: cashReg?.closed_at,
        })
    }

    // ── Render ──
    return (
        <div className="space-y-6">
            {/* Banner */}
            <div className="bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-2xl overflow-hidden shadow-soft-md">
                <div className="p-5 sm:p-8">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
                        <div className="flex-1 min-w-0">
                            <p className="text-xs font-black uppercase tracking-widest text-emerald-200 mb-1.5">Clínica</p>
                            <h1 className="text-xl sm:text-3xl font-extrabold tracking-tight text-white">Finanzas</h1>
                            <p className="text-xs sm:text-sm text-emerald-100/80 font-light mt-1">Ingresos, gastos y rentabilidad de tu clínica.</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 flex-wrap">
                            <button
                                onClick={() => setShowExportModal(true)}
                                className="flex items-center gap-1.5 bg-white/15 hover:bg-white/25 text-white font-bold text-sm px-3 py-2 rounded-xl transition-colors"
                            >
                                <Download className="w-4 h-4" />
                                <span className="hidden sm:inline">Exportar</span>
                            </button>
                            <button
                                onClick={() => setShowExpenseModal(true)}
                                className="flex items-center gap-1.5 bg-white/15 hover:bg-white/25 text-white font-bold text-sm px-3 py-2 rounded-xl transition-colors"
                            >
                                <Plus className="w-4 h-4" />
                                <span>Gasto</span>
                            </button>
                            <button
                                onClick={() => { setIncomeDefaultDate(todayLocalStr); setShowIncomeModal(true) }}
                                className="flex items-center gap-1.5 bg-white text-emerald-700 font-bold text-sm px-3 py-2 rounded-xl hover:bg-emerald-50 transition-colors shadow-sm"
                            >
                                <Plus className="w-4 h-4" />
                                Ingreso
                            </button>
                            <div className="hidden sm:flex w-12 h-12 bg-white/15 rounded-2xl items-center justify-center shrink-0">
                                <DollarSign className="w-6 h-6 text-white" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <GuideBox 
                title="Guía: Salud Financiera" 
                summary="Aprende a interpretar tus ingresos vs gastos y el flujo de caja de tu clínica."
            >
                <p>El control financiero es el corazón de tu negocio. Aquí puedes ver cómo interactúan tus egresos con las ventas generadas por el equipo.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                    <div className="bg-white/50 p-3.5 rounded-soft border border-silk-beige/30">
                        <p className="font-bold text-emerald-700 text-[11px] mb-1.5 flex items-center gap-1.5 uppercase tracking-wider">
                            <TrendingUp className="w-3.5 h-3.5" /> Ingresos vs Gastos:
                        </p>
                        <p className="text-[11px] leading-relaxed text-charcoal/70">
                            Mantén tus gastos generales (nómina, alquiler, insumos) controlados. Una ganancia neta saludable suele estar por encima del 20-30% tras cubrir todos los costos operativos.
                        </p>
                    </div>
                    <div className="bg-white/50 p-3.5 rounded-soft border border-silk-beige/30">
                        <p className="font-bold text-emerald-700 text-[11px] mb-1.5 flex items-center gap-1.5 uppercase tracking-wider">
                            <CreditCard className="w-3.5 h-3.5" /> Cajas diarias:
                        </p>
                        <p className="text-[11px] leading-relaxed text-charcoal/70">
                            Registra cada cobro como ingreso manual en la caja del día. Al cerrar la caja obtienes el resumen exacto de lo cobrado, los gastos y el saldo final de la jornada.
                        </p>
                    </div>
                </div>
                <p className="text-[11px] text-charcoal/70 mt-3 italic flex items-center gap-1.5 bg-ivory/50 p-2 rounded-soft border border-silk-beige/20">
                    <Lightbulb className="w-3.5 h-3.5 text-accent-600" /> <b>Tip:</b> Registra cada ingreso manual (ej: venta de cremas o productos) para que tus reportes de exportación sean 100% precisos al final del mes.
                </p>
            </GuideBox>

            {/* Date filter pills & Date display */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="text-sm text-charcoal/50 capitalize font-medium flex items-center gap-2 bg-white px-3 py-1.5 rounded-full border border-silk-beige w-fit">
                    <Calendar className="w-4 h-4 text-primary-500" />
                    {getFilterLabel()}
                </div>

                <div className="flex items-center gap-2">
                    <div className="bg-white border border-silk-beige p-1 rounded-xl flex gap-1">
                        {([
                            { id: 'day',   label: 'Hoy' },
                            { id: 'week',  label: 'Sem.' },
                            { id: 'month', label: 'Mes' },
                            { id: 'year',  label: 'Año' },
                        ] as const).map((r) => (
                            <button
                                key={r.id}
                                onClick={() => { setFilterType(r.id); setShowDatePicker(false) }}
                                className={cn(
                                    "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200",
                                    filterType === r.id
                                        ? "bg-primary-500 text-white shadow-sm"
                                        : "text-charcoal/50 hover:text-charcoal hover:bg-zinc-50"
                                )}
                            >
                                {r.label}
                            </button>
                        ))}
                    </div>

                    {/* Selector de rango personalizado */}
                    <div className="relative" ref={datePickerRef}>
                        <button
                            onClick={() => setShowDatePicker(v => !v)}
                            className={cn(
                                "flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all duration-200",
                                filterType === 'custom'
                                    ? "bg-primary-500 text-white border-primary-500 shadow-sm"
                                    : "bg-white border-silk-beige text-charcoal/50 hover:text-charcoal"
                            )}
                        >
                            <CalendarRange className="w-3.5 h-3.5" />
                            {filterType === 'custom' && customRange
                                ? `${dateFnsFormat(customRange.start, 'd MMM', { locale: esLocale })} – ${dateFnsFormat(customRange.end, 'd MMM', { locale: esLocale })}`
                                : 'Rango'
                            }
                            {filterType === 'custom' && customRange && (
                                <span
                                    onClick={(e) => { e.stopPropagation(); setFilterType('month'); setCustomRange(null) }}
                                    className="ml-0.5 hover:opacity-70"
                                >
                                    <X className="w-3 h-3" />
                                </span>
                            )}
                        </button>

                        {showDatePicker && (
                            <div className="absolute right-0 top-full mt-2 bg-white border border-silk-beige rounded-2xl shadow-xl z-50">
                                <MiniCalendar />
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="card-soft p-4 flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                        <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
                            <TrendingUp className="w-5 h-5 text-emerald-600" />
                        </div>
                    </div>
                    <p className="text-sm text-charcoal/60">Ingresos ({getFilterLabel()})</p>
                    {can('finance_metrics') ? (
                        <p className="text-2xl font-bold text-charcoal mt-1">
                            {loading ? '...' : formatCurrency(stats?.total_income || 0)}
                        </p>
                    ) : (
                        <p className="text-sm text-charcoal/40 italic mt-2">No disponible</p>
                    )}
                </div>

                <div className="card-soft p-4 flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                        <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                            <TrendingDown className="w-5 h-5 text-red-600" />
                        </div>
                    </div>
                    <p className="text-sm text-charcoal/60">Gastos ({getFilterLabel()})</p>
                    {can('finance_metrics') ? (
                        <p className="text-2xl font-bold text-charcoal mt-1">
                            {loading ? '...' : formatCurrency(stats?.total_expenses || 0)}
                        </p>
                    ) : (
                        <p className="text-sm text-charcoal/40 italic mt-2">No disponible</p>
                    )}
                </div>

                <div className="card-soft p-4 flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                        <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                            <DollarSign className="w-5 h-5 text-blue-600" />
                        </div>
                        <span className="text-xs font-medium text-charcoal/40 bg-silk-beige px-2 py-1 rounded-full">
                            Neto
                        </span>
                    </div>
                    <p className="text-sm text-charcoal/60">Ganancia Neta</p>
                    {can('finance_metrics') ? (
                        <p className={cn(
                            "text-2xl font-bold mt-1",
                            (stats?.net_profit || 0) >= 0 ? "text-emerald-600" : "text-red-600"
                        )}>
                            {loading ? '...' : formatCurrency(stats?.net_profit || 0)}
                        </p>
                    ) : (
                        <p className="text-sm text-charcoal/40 italic mt-2">No disponible</p>
                    )}
                </div>

            </div>

            {/* Tabs */}
            <div className="bg-white rounded-soft border-b border-silk-beige px-6 sticky top-0 z-10">
                <div className="flex items-center gap-6 overflow-x-auto no-scrollbar">
                    <button
                        onClick={() => setActiveTab('dashboard')}
                        className={cn(
                            "py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
                            activeTab === 'dashboard'
                                ? "border-emerald-500 text-emerald-600"
                                : "border-transparent text-charcoal/60 hover:text-charcoal"
                        )}
                    >
                        Resumen
                    </button>
                    <button
                        onClick={() => setActiveTab('cajas')}
                        className={cn(
                            "py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
                            activeTab === 'cajas'
                                ? "border-emerald-500 text-emerald-600"
                                : "border-transparent text-charcoal/60 hover:text-charcoal"
                        )}
                    >
                        Cajas
                    </button>
                    <button
                        onClick={() => setActiveTab('expenses')}
                        className={cn(
                            "py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
                            activeTab === 'expenses'
                                ? "border-emerald-500 text-emerald-600"
                                : "border-transparent text-charcoal/60 hover:text-charcoal"
                        )}
                    >
                        Gastos
                    </button>
                    <button
                        onClick={() => setActiveTab('incomes')}
                        className={cn(
                            "py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
                            activeTab === 'incomes'
                                ? "border-emerald-500 text-emerald-600"
                                : "border-transparent text-charcoal/60 hover:text-charcoal"
                        )}
                    >
                        Ingresos
                    </button>
                    <button
                        onClick={() => setActiveTab('analysis')}
                        className={cn(
                            "py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
                            activeTab === 'analysis'
                                ? "border-emerald-500 text-emerald-600"
                                : "border-transparent text-charcoal/60 hover:text-charcoal"
                        )}
                    >
                        Análisis
                    </button>
                </div>
            </div>

            {/* Content Area */}
            <div className="space-y-6">
                {activeTab === 'dashboard' && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Ingresos vs Gastos */}
                        <div className="lg:col-span-2 card-soft p-6">
                            <div className="flex items-baseline justify-between mb-4 gap-3 flex-wrap">
                                <h3 className="font-semibold text-charcoal">Ingresos vs Gastos</h3>
                                <span className="text-xs text-charcoal/40">{getFilterLabel()}</span>
                            </div>
                            {!can('finance_metrics') ? (
                                <div className="h-64 flex items-center justify-center">
                                    <p className="text-charcoal/40 text-sm italic">No disponible</p>
                                </div>
                            ) : loading ? (
                                <div className="h-64 flex items-center justify-center">
                                    <p className="text-charcoal/40 text-sm">Cargando…</p>
                                </div>
                            ) : !hasChartData ? (
                                <div className="h-64 flex items-center justify-center">
                                    <p className="text-charcoal/40 text-sm">Sin movimientos en este período</p>
                                </div>
                            ) : (
                                <div className="h-64">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={chartData} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                                            <CartesianGrid vertical={false} stroke="#ece9e4" />
                                            <XAxis
                                                dataKey="label"
                                                axisLine={false}
                                                tickLine={false}
                                                tick={{ fontSize: 11, fill: '#9b9691' }}
                                            />
                                            <YAxis
                                                axisLine={false}
                                                tickLine={false}
                                                tick={{ fontSize: 11, fill: '#9b9691' }}
                                                tickFormatter={formatAxisAmount}
                                            />
                                            <RechartsTooltip
                                                cursor={{ fill: 'rgba(0,0,0,0.035)' }}
                                                formatter={(value: any, name: any) => [formatCurrency(Number(value)), name]}
                                                contentStyle={{
                                                    borderRadius: 12,
                                                    border: '1px solid #ece9e4',
                                                    fontSize: 12,
                                                    boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
                                                }}
                                            />
                                            {/* El texto de la leyenda va en tinta, no en el color de la
                                                serie: el swatch ya carga la identidad y un texto de color
                                                claro es ilegible sobre fondo blanco. */}
                                            <Legend
                                                iconSize={10}
                                                iconType="circle"
                                                wrapperStyle={{ fontSize: 12, paddingTop: 4 }}
                                                formatter={(value) => <span style={{ color: '#4a4642' }}>{value}</span>}
                                            />
                                            <Bar dataKey="ingresos" name="Ingresos" fill={CHART_INCOME_COLOR} radius={[4, 4, 0, 0]} maxBarSize={22} />
                                            <Bar dataKey="gastos"   name="Gastos"   fill={CHART_EXPENSE_COLOR} radius={[4, 4, 0, 0]} maxBarSize={22} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                        </div>

                        {/* Recent Incomes Mini List */}
                        <div className="card-soft p-6">
                            <h3 className="font-semibold text-charcoal mb-4">Recientes</h3>
                            <div className="space-y-4">
                                {incomes.slice(0, 5).map((inc) => (
                                    <div key={inc.id} className="flex items-center justify-between text-sm">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600">
                                                <DollarSign className="w-4 h-4" />
                                            </div>
                                            <div>
                                                <p className="font-medium text-charcoal truncate max-w-[180px]">{inc.description}</p>
                                                <p className="text-xs text-charcoal/50 truncate max-w-[180px]">
                                                    {inc.tutor_name ? `${inc.tutor_name} · ` : ''}{formatInTz(inc.date, 'd MMM')}
                                                </p>
                                            </div>
                                        </div>
                                        <span className="font-medium text-emerald-600">
                                            +{formatCurrency(inc.amount || 0)}
                                        </span>
                                    </div>
                                ))}
                                {incomes.length === 0 && (
                                    <p className="text-sm text-charcoal/50 text-center py-4">No hay ingresos recientes</p>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'cajas' && (
                    <div className="space-y-3">
                        {loading ? (
                            <div className="card-soft p-8 text-center text-charcoal/40">Cargando cajas...</div>
                        ) : cajasByDate.length === 0 ? (
                            <div className="card-soft p-10 text-center">
                                <p className="text-charcoal/50 font-medium">No hay ingresos en este período</p>
                                <p className="text-sm text-charcoal/30 mt-1">Las cajas aparecen cuando hay ingresos registrados en el período seleccionado</p>
                            </div>
                        ) : (
                            cajasByDate.map(([date, { incomes: dayInc, expenses: dayExp }]) => {
                                const cashReg = cashRegisters.find(c => c.date === date) ?? null
                                const dayLabel = (() => {
                                    try {
                                        return new Date(date + 'T12:00:00').toLocaleDateString('es-CL', {
                                            weekday: 'long', day: 'numeric', month: 'short', year: 'numeric'
                                        })
                                    } catch { return date }
                                })()
                                return (
                                    <CajaDelDia
                                        key={date}
                                        date={date}
                                        dateLabel={dayLabel}
                                        todayStr={todayLocalStr}
                                        incomes={dayInc}
                                        expenses={dayExp}
                                        cashRegister={cashReg}
                                        currency={currencySymbol}
                                        onCloseCaja={(d) => setCajaToClose(d)}
                                        onAddIncome={(d) => {
                                            setIncomeDefaultDate(d)
                                            setShowIncomeModal(true)
                                        }}
                                        onAddExpense={(d) => {
                                            setExpenseDefaultDate(d)
                                            setShowCajaExpenseModal(true)
                                        }}
                                        onSetOpeningBalance={handleSetOpeningBalance}
                                        onDownloadReport={handleDownloadCajaReport}
                                        onViewReceipt={handleViewReceipt}
                                        onEditIncome={(incomeId) => {
                                            const inc = incomes.find(i => i.id === incomeId)
                                            if (inc) setEditingIncome(inc)
                                        }}
                                        onDeleteIncome={handleDeleteIncome}
                                        onEditExpense={(expenseId) => {
                                            const exp = expenses.find(e => e.id === expenseId)
                                            if (exp) setEditingExpense(exp)
                                        }}
                                        onDeleteExpense={handleDeleteExpense}
                                        onReopenCaja={handleReopenCaja}
                                        canReopen={isOwner}
                                        isClosing={closingCaja && cajaToClose === date}
                                        isReopening={reopeningCaja === date}
                                    />
                                )
                            })
                        )}
                    </div>
                )}

                {/* ── TAB GASTOS ── */}
                {activeTab === 'expenses' && (
                    <div className="card-soft overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-silk-beige/30 text-charcoal/70 uppercase text-xs">
                                    <tr>
                                        <th className="px-6 py-3 font-medium">Fecha</th>
                                        <th className="px-6 py-3 font-medium">Descripción</th>
                                        <th className="px-6 py-3 font-medium">Categoría</th>
                                        <th className="px-6 py-3 font-medium text-right">Monto</th>
                                        <th className="px-6 py-3 font-medium text-right">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-silk-beige">
                                    {expenses.map((expense) => (
                                        <tr key={expense.id} className="hover:bg-ivory/50">
                                            <td className="px-6 py-3 text-charcoal/80">
                                                {formatInTz(expense.date, 'dd/MM/yyyy')}
                                            </td>
                                            <td className="px-6 py-3 font-medium text-charcoal">
                                                {expense.description}
                                            </td>
                                            <td className="px-6 py-3">
                                                <span className="bg-silk-beige text-charcoal/70 px-2 py-1 rounded text-xs capitalize">
                                                    {translateCategoryExpense(expense.category)}
                                                </span>
                                            </td>
                                            <td className="px-6 py-3 font-medium text-right text-red-600">
                                                -{formatCurrency(expense.amount)}
                                            </td>
                                            <td className="px-6 py-3 text-right">
                                                <div className="inline-flex items-center gap-3">
                                                    <button
                                                        onClick={() => setEditingExpense(expense)}
                                                        className="text-primary-600 hover:underline inline-flex items-center gap-1 text-xs font-medium"
                                                    >
                                                        <Pencil className="w-3 h-3" /> Editar
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteExpense(expense.id, expense.description)}
                                                        className="text-red-500 hover:underline inline-flex items-center gap-1 text-xs font-medium"
                                                    >
                                                        <Trash2 className="w-3 h-3" /> Eliminar
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                    {expenses.length === 0 && (
                                        <tr>
                                            <td colSpan={5} className="px-6 py-8 text-center text-charcoal/50">
                                                No hay gastos registrados en este período
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* ── TAB INGRESOS ── */}
                {activeTab === 'incomes' && (
                    <div className="card-soft overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-silk-beige/30 text-charcoal/70 uppercase text-xs">
                                    <tr>
                                        <th className="px-6 py-3 font-medium">Fecha</th>
                                        <th className="px-6 py-3 font-medium">Descripción</th>
                                        <th className="px-6 py-3 font-medium">Tutor</th>
                                        <th className="px-6 py-3 font-medium">Categoría</th>
                                        <th className="px-6 py-3 font-medium">Método de pago</th>
                                        <th className="px-6 py-3 font-medium text-right">Monto</th>
                                        <th className="px-6 py-3 font-medium text-right">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-silk-beige">
                                    {incomes.map((income) => (
                                        <tr key={income.id} className="hover:bg-ivory/50">
                                            <td className="px-6 py-3 text-charcoal/80">
                                                {formatInTz(income.date, 'dd/MM/yyyy')}
                                            </td>
                                            <td className="px-6 py-3 font-medium text-charcoal">
                                                {income.description}
                                            </td>
                                            <td className="px-6 py-3 text-charcoal/70">
                                                {income.tutor_name || <span className="italic text-charcoal/40">Sin tutor</span>}
                                            </td>
                                            <td className="px-6 py-3">
                                                <span className="bg-silk-beige text-charcoal/70 px-2 py-1 rounded text-xs capitalize">
                                                    {translateCategoryIncome(income.category)}
                                                </span>
                                            </td>
                                            <td className="px-6 py-3 text-charcoal/70">
                                                {translatePaymentMethod(income.payment_method)}
                                            </td>
                                            <td className="px-6 py-3 font-medium text-right text-emerald-600">
                                                {formatCurrency(income.amount)}
                                            </td>
                                            <td className="px-6 py-3 text-right">
                                                <div className="inline-flex items-center gap-3">
                                                    <button
                                                        onClick={() => setEditingIncome(income)}
                                                        className="text-primary-600 hover:underline inline-flex items-center gap-1 text-xs font-medium"
                                                    >
                                                        <Pencil className="w-3 h-3" /> Editar
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteIncome(income.id, income.description)}
                                                        className="text-red-500 hover:underline inline-flex items-center gap-1 text-xs font-medium"
                                                    >
                                                        <Trash2 className="w-3 h-3" /> Eliminar
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                    {incomes.length === 0 && (
                                        <tr>
                                            <td colSpan={7} className="px-6 py-8 text-center text-charcoal/50">
                                                No hay ingresos registrados en este período
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* ── TAB ANÁLISIS ── */}
                {activeTab === 'analysis' && (
                    <div className="space-y-6">
                        {/* Métricas avanzadas — todo calculado sobre los ingresos del período */}
                        {saleMetrics && (
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <div className="card-soft p-4">
                                    <p className="text-xs text-charcoal/50 uppercase tracking-wider font-bold">Ticket promedio</p>
                                    <p className="text-2xl font-extrabold text-charcoal mt-1">
                                        {formatCurrency(saleMetrics.avg_ticket ?? 0)}
                                    </p>
                                    <p className="text-xs text-charcoal/40 mt-0.5">
                                        sobre {saleMetrics.total_sales ?? 0} {(saleMetrics.total_sales ?? 0) === 1 ? 'venta' : 'ventas'}
                                    </p>
                                </div>
                                <div className="card-soft p-4">
                                    <p className="text-xs text-charcoal/50 uppercase tracking-wider font-bold">Ventas con productos</p>
                                    <p className="text-2xl font-extrabold text-charcoal mt-1">
                                        {saleMetrics.sales_with_products ?? 0}
                                        <span className="text-sm font-normal text-charcoal/40 ml-1">
                                            / {saleMetrics.total_sales ?? 0}
                                        </span>
                                    </p>
                                    <p className="text-xs text-charcoal/40 mt-0.5">
                                        {saleMetrics.total_sales
                                            ? Math.round((saleMetrics.sales_with_products / saleMetrics.total_sales) * 100)
                                            : 0}% incluyó algún producto
                                    </p>
                                </div>
                                <div className="card-soft p-4">
                                    <p className="text-xs text-charcoal/50 uppercase tracking-wider font-bold">Ingresos por tipo</p>
                                    {(itemMetrics?.by_type ?? []).map((t: any) => (
                                        <div key={t.item_type} className="flex justify-between items-center mt-1.5">
                                            <span className={cn(
                                                "text-xs px-2 py-0.5 rounded-full font-semibold",
                                                ITEM_TYPE_STYLES[t.item_type as string] ?? ITEM_TYPE_STYLES.custom
                                            )}>
                                                {/* Fallback al nombre crudo, nunca a otra etiqueta: un tipo
                                                    nuevo mal etiquetado (dos veces "Productos") es peor que
                                                    uno sin traducir. */}
                                                {ITEM_TYPE_LABELS[t.item_type as string] ?? t.item_type}
                                            </span>
                                            <span className="text-sm font-bold text-charcoal">{formatCurrency(t.total_revenue)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Top servicios y productos */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* Top servicios */}
                            <div className="card-soft overflow-hidden">
                                <div className="p-5 border-b border-silk-beige">
                                    <h3 className="font-bold text-charcoal">Top Servicios</h3>
                                    <p className="text-xs text-charcoal/50">Por ingresos en el período</p>
                                </div>
                                {(itemMetrics?.top_services ?? []).length === 0 ? (
                                    <div className="py-8 text-center text-charcoal/40 text-sm">Sin datos aún</div>
                                ) : (
                                    <div className="divide-y divide-silk-beige/40">
                                        {(itemMetrics?.top_services ?? []).map((s: any, i: number) => (
                                            <div key={i} className="flex items-center justify-between px-5 py-3">
                                                <div className="flex items-center gap-3">
                                                    <span className="w-6 h-6 rounded-full bg-primary-100 text-primary-600 text-xs font-black flex items-center justify-center">{i + 1}</span>
                                                    <span className="text-sm font-medium text-charcoal">{s.name}</span>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-sm font-bold text-charcoal">{formatCurrency(s.revenue)}</p>
                                                    <p className="text-xs text-charcoal/40">{s.units} unid.</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Top productos */}
                            <div className="card-soft overflow-hidden">
                                <div className="p-5 border-b border-silk-beige">
                                    <h3 className="font-bold text-charcoal">Top Productos</h3>
                                    <p className="text-xs text-charcoal/50">Por ingresos en el período</p>
                                </div>
                                {(itemMetrics?.top_products ?? []).length === 0 ? (
                                    <div className="py-8 text-center text-charcoal/40 text-sm">Sin ventas de productos en el período</div>
                                ) : (
                                    <div className="divide-y divide-silk-beige/40">
                                        {(itemMetrics?.top_products ?? []).map((p: any, i: number) => (
                                            <div key={i} className="flex items-center justify-between px-5 py-3">
                                                <div className="flex items-center gap-3">
                                                    <span className="w-6 h-6 rounded-full bg-violet-100 text-violet-600 text-xs font-black flex items-center justify-center">{i + 1}</span>
                                                    <span className="text-sm font-medium text-charcoal">{p.name}</span>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-sm font-bold text-charcoal">{formatCurrency(p.revenue)}</p>
                                                    <p className="text-xs text-charcoal/40">{p.units} unid.</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Ítems libres — ventas escritas a mano, sin catálogo.
                            Solo se muestra si existen: verlas acá es la señal de que
                            conviene crearlas como servicio o producto del catálogo. */}
                        {(itemMetrics?.top_custom ?? []).length > 0 && (
                            <div className="card-soft overflow-hidden">
                                <div className="p-5 border-b border-silk-beige">
                                    <h3 className="font-bold text-charcoal">Top Ítems Libres</h3>
                                    <p className="text-xs text-charcoal/50">
                                        Escritos a mano, fuera del catálogo. Crearlos como servicio o producto los
                                        hace medibles y permite descontar stock.
                                    </p>
                                </div>
                                <div className="divide-y divide-silk-beige/40">
                                    {(itemMetrics?.top_custom ?? []).map((c: any, i: number) => (
                                        <div key={i} className="flex items-center justify-between px-5 py-3">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <span className="w-6 h-6 shrink-0 rounded-full bg-amber-100 text-amber-700 text-xs font-black flex items-center justify-center">{i + 1}</span>
                                                <span className="text-sm font-medium text-charcoal truncate">{c.name}</span>
                                            </div>
                                            <div className="text-right shrink-0 ml-3">
                                                <p className="text-sm font-bold text-charcoal">{formatCurrency(c.revenue)}</p>
                                                <p className="text-xs text-charcoal/40">{c.units} unid.</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {loading && (
                            <div className="text-center py-8 text-charcoal/40 text-sm">Cargando métricas...</div>
                        )}
                        {!loading && !itemMetrics && (
                            <div className="text-center py-8 text-charcoal/40 text-sm">
                                Las métricas por ítem estarán disponibles cuando registres ventas usando el modal de cierre de visita.
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Modal de Gastos */}
            {showExpenseModal && (
                <div className="fixed inset-0 bg-charcoal/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-soft w-full max-w-md p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold text-charcoal">Registrar Nuevo Gasto</h3>
                            <button onClick={() => setShowExpenseModal(false)}>
                                <X className="w-5 h-5 text-charcoal/50 hover:text-charcoal" />
                            </button>
                        </div>

                        <form onSubmit={handleAddExpense} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-charcoal mb-1">Descripción</label>
                                <input
                                    name="description"
                                    required
                                    className="w-full px-3 py-2 border border-silk-beige rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                                    placeholder="Ej. Compra de insumos"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-charcoal mb-1">Monto</label>
                                    <input
                                        name="amount"
                                        type="number"
                                        required
                                        min="0"
                                        step="0.01"
                                        className="w-full px-3 py-2 border border-silk-beige rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                                        placeholder="0.00"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-charcoal mb-1">Fecha</label>
                                    <input
                                        name="date"
                                        type="date"
                                        required
                                        defaultValue={todayLocalStr}
                                        className="w-full px-3 py-2 border border-silk-beige rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-charcoal mb-1">Categoría</label>
                                <select
                                    name="category"
                                    required
                                    className="w-full px-3 py-2 border border-silk-beige rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                                >
                                    {(Object.entries(CATEGORY_LABELS_EXPENSE)).map(([val, label]) => (
                                        <option key={val} value={val}>{label}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="flex justify-end gap-2 mt-6">
                                <button
                                    type="button"
                                    onClick={() => setShowExpenseModal(false)}
                                    className="btn-secondary"
                                >
                                    Cancelar
                                </button>
                                <button type="submit" className="btn-primary">
                                    Guardar Gasto
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal nuevo ingreso */}
            {showIncomeModal && clinicId && (
                <NewIncomeForm
                    clinicId={clinicId}
                    defaultDate={incomeDefaultDate}
                    onClose={() => { setShowIncomeModal(false); setIncomeDefaultDate(undefined) }}
                    onSuccess={handleAddIncome}
                />
            )}

            {/* Modal editar ingreso */}
            {editingIncome && clinicId && (
                <NewIncomeForm
                    clinicId={clinicId}
                    editingIncome={editingIncome}
                    onClose={() => setEditingIncome(null)}
                    onSuccess={handleUpdateIncome}
                />
            )}

            {/* Modal de exportación */}
            {showExportModal && clinicId && (
                <ExportModal
                    clinicId={clinicId}
                    clinicName={clinicName}
                    currency={currencySymbol}
                    timezone={timezone}
                    onClose={() => setShowExportModal(false)}
                />
            )}

            {/* Modal gasto desde caja */}
            {(showCajaExpenseModal || editingExpense) && clinicId && user?.id && (editingExpense?.date ?? expenseDefaultDate) && (
                <CajaExpenseModal
                    clinicId={clinicId}
                    date={editingExpense?.date ?? expenseDefaultDate!}
                    dateLabel={(() => {
                        const d = editingExpense?.date ?? expenseDefaultDate!
                        try {
                            return new Date(d + 'T12:00:00').toLocaleDateString('es-CL', {
                                weekday: 'long', day: 'numeric', month: 'short', year: 'numeric'
                            })
                        } catch { return d }
                    })()}
                    currency={currencySymbol}
                    userId={user.id}
                    editingExpense={editingExpense}
                    onSave={editingExpense ? handleUpdateExpense : handleAddExpenseFromCaja}
                    onCancel={() => { setShowCajaExpenseModal(false); setEditingExpense(null); setExpenseDefaultDate(undefined) }}
                />
            )}

            {/* Modal cerrar caja */}
            {cajaToClose && (() => {
                const dayIncForModal = incomes.filter(i => (i.date?.split('T')[0] ?? i.date) === cajaToClose)
                const dayExpForModal = expenses.filter(e => (e.date as string)?.split('T')[0] === cajaToClose)
                const totalCobrado = dayIncForModal.reduce((s: number, i: any) => s + (i.amount ?? 0), 0)
                const totalGastos = dayExpForModal.reduce((s: number, e: any) => s + (e.amount ?? 0), 0)
                const cashReg = cashRegisters.find(c => c.date === cajaToClose)
                const openingBalance = cashReg?.opening_balance ?? 0
                const byMethod: Record<string, number> = {}
                for (const i of dayIncForModal as any[]) {
                    const k = (i.payment_method ?? 'otro').toLowerCase()
                    byMethod[k] = (byMethod[k] ?? 0) + (i.amount ?? 0)
                }
                const label = (() => {
                    try {
                        return new Date(cajaToClose + 'T12:00:00').toLocaleDateString('es-CL', {
                            weekday: 'long', day: 'numeric', month: 'short', year: 'numeric'
                        })
                    } catch { return cajaToClose }
                })()
                return (
                    <CloseCajaModal
                        date={cajaToClose}
                        dateLabel={label}
                        openingBalance={openingBalance}
                        totalCobrado={totalCobrado}
                        totalGastos={totalGastos}
                        byMethod={byMethod}
                        citasAtendidas={dayIncForModal.length}
                        gastosList={dayExpForModal.map((e: any) => ({ description: e.description, amount: e.amount, payment_method: e.payment_method }))}
                        currency={currencySymbol}
                        loading={closingCaja}
                        onConfirm={(notes) => handleCloseCaja(cajaToClose, notes)}
                        onCancel={() => setCajaToClose(null)}
                        onDownloadReport={() => handleDownloadCajaReport(cajaToClose)}
                    />
                )
            })()}
        </div>
    )
}

export default Finance
