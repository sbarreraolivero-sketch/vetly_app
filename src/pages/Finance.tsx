
import { useState, useEffect, useRef } from 'react'
import {
    DollarSign,
    TrendingUp,
    TrendingDown,
    CreditCard,
    Plus,
    Download,
    X,
    FileText,
    ChevronDown,
    Trash2,
    Calendar,
    Lightbulb
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useClinicTimezone } from '@/hooks/useClinicTimezone'
import { financeService, type FinanceStats, type Expense, type Income } from '@/services/financeService'
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

const CATEGORY_LABELS_INCOME: Record<string, string> = {
    service: 'Servicio',
    product: 'Producto',
    adjustment: 'Ajuste',
    other: 'Otro',
}

const STATUS_LABELS: Record<string, string> = {
    paid: 'Pagado',
    pending: 'Pendiente',
    partial: 'Parcial',
    refunded: 'Reembolsado',
}

const translateCategoryExpense = (cat: string) => CATEGORY_LABELS_EXPENSE[cat] ?? cat
const translateCategoryIncome = (cat: string) => CATEGORY_LABELS_INCOME[cat] ?? cat
const translateStatus = (st: string) => STATUS_LABELS[st] ?? st

// parseLocalDate now comes from useClinicTimezone hook

// ── Component ────────────────────────────────────────────────────────
const Finance = () => {
    const { profile, member } = useAuth()
    const clinicId = member?.clinic_id || profile?.clinic_id
    const clinicName = (member as any)?.clinic_name || (profile as any)?.clinic_name || 'Clínica'

    // Timezone-aware date utilities from clinic settings
    const {
        timezone,
        formatInTz,
        getDateRange,
        getDateRangeLabel,
    } = useClinicTimezone()

    const [stats, setStats] = useState<FinanceStats | null>(null)
    const [expenses, setExpenses] = useState<Expense[]>([])
    const [incomes, setIncomes] = useState<Income[]>([])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [transactions, setTransactions] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [activeTab, setActiveTab] = useState<'dashboard' | 'transactions' | 'expenses' | 'incomes'>('dashboard')
    const [showExpenseModal, setShowExpenseModal] = useState(false)
    const [showIncomeModal, setShowIncomeModal] = useState(false)
    const [filterType, setFilterType] = useState<'day' | 'week' | 'month' | 'year'>('month')
    const [showExportMenu, setShowExportMenu] = useState(false)

    const exportMenuRef = useRef<HTMLDivElement>(null)

    // ── Close export dropdown on click-outside ──
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
                setShowExportMenu(false)
            }
        }
        if (showExportMenu) {
            document.addEventListener('mousedown', handler)
        }
        return () => document.removeEventListener('mousedown', handler)
    }, [showExportMenu])

    const getFilterLabel = () => {
        switch (filterType) {
            case 'day': return 'Hoy'
            case 'week': return 'Semana'
            case 'month': return 'Mes'
            case 'year': return 'Año'
        }
    }

    // ── Data loading ──
    useEffect(() => {
        loadData()
    }, [clinicId, filterType, timezone])

    const loadData = async () => {
        if (!clinicId) return
        setLoading(true)
        try {
            const { start, end } = getDateRange(filterType)

            const [statsData, expensesData, incomesData, transactionsData] = await Promise.all([
                financeService.getStats(clinicId, start, end),
                financeService.getExpenses(clinicId, start, end),
                financeService.getIncomes(clinicId, start, end),
                financeService.getTransactions(clinicId, start, end)
            ])

            setStats(statsData)
            setExpenses(expensesData)
            setIncomes(incomesData)
            setTransactions(transactionsData || [])
        } catch (error) {
            console.error('Error loading finance data:', error)
        } finally {
            setLoading(false)
        }
    }

    // ── Currency formatter ──
    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('es-MX', {
            style: 'currency',
            currency: 'MXN'
        }).format(amount)
    }

    // ── Export handlers ──
    const downloadBlob = (blob: Blob, filename: string) => {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(url), 100)
    }

    const handleExport = (type: 'csv' | 'json') => {
        try {
            const periodLabel = getDateRangeLabel(filterType)
            const dateStamp = formatInTz(new Date(), 'yyyy-MM-dd')

            if (type === 'json') {
                const data = {
                    reporte: {
                        clinica: clinicName,
                        periodo: periodLabel,
                        filtro: getFilterLabel(),
                        generado: formatInTz(new Date(), 'dd/MM/yyyy HH:mm')
                    },
                    resumen: {
                        ingresos: stats?.total_income ?? 0,
                        gastos: stats?.total_expenses ?? 0,
                        ganancia_neta: stats?.net_profit ?? 0,
                        por_cobrar: stats?.pending_payments ?? 0,
                        total_citas: stats?.appointments_count ?? 0
                    },
                    transacciones: transactions.map(tx => ({
                        fecha: formatInTz(tx.appointment_date, 'dd/MM/yyyy HH:mm'),
                        paciente: tx.patient_name,
                        servicio: tx.service || '-',
                        monto: tx.price ?? 0,
                        estado: translateStatus(tx.payment_status),
                        metodo_pago: tx.payment_method || 'N/A'
                    })),
                    gastos: expenses.map(exp => ({
                        fecha: formatInTz(exp.date, 'dd/MM/yyyy'),
                        descripcion: exp.description,
                        categoria: translateCategoryExpense(exp.category),
                        monto: exp.amount
                    })),
                    ingresos_manuales: incomes.map(inc => ({
                        fecha: formatInTz(inc.date, 'dd/MM/yyyy'),
                        descripcion: inc.description,
                        categoria: translateCategoryIncome(inc.category),
                        monto: inc.amount
                    }))
                }
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
                downloadBlob(blob, `reporte_finanzas_${dateStamp}.json`)
            } else {
                // ── CSV generation ──
                const lines: string[] = []
                const sep = ','

                // Report header
                lines.push(`REPORTE FINANCIERO - ${clinicName}`)
                lines.push(`Período: ${periodLabel}`)
                lines.push(`Generado: ${formatInTz(new Date(), 'dd/MM/yyyy HH:mm')}`)
                lines.push('')

                // Summary
                lines.push('RESUMEN')
                lines.push(`Ingresos${sep}${formatCurrency(stats?.total_income ?? 0)}`)
                lines.push(`Gastos${sep}${formatCurrency(stats?.total_expenses ?? 0)}`)
                lines.push(`Ganancia Neta${sep}${formatCurrency(stats?.net_profit ?? 0)}`)
                lines.push(`Por Cobrar${sep}${formatCurrency(stats?.pending_payments ?? 0)}`)
                lines.push(`Total Citas${sep}${stats?.appointments_count ?? 0}`)
                lines.push('')

                // Transactions
                lines.push('TRANSACCIONES')
                lines.push(`Fecha${sep}Paciente${sep}Servicio${sep}Monto${sep}Estado${sep}Método de Pago`)
                if (transactions.length > 0) {
                    transactions.forEach(tx => {
                        lines.push([
                            formatInTz(tx.appointment_date, 'dd/MM/yyyy HH:mm'),
                            `"${(tx.patient_name || '').replace(/"/g, '""')}"`,
                            `"${(tx.service || '-').replace(/"/g, '""')}"`,
                            formatCurrency(tx.price ?? 0),
                            translateStatus(tx.payment_status),
                            tx.payment_method || 'N/A'
                        ].join(sep))
                    })
                } else {
                    lines.push('Sin transacciones en este período')
                }
                lines.push('')

                // Expenses
                lines.push('GASTOS')
                lines.push(`Fecha${sep}Descripción${sep}Categoría${sep}Monto`)
                if (expenses.length > 0) {
                    expenses.forEach(exp => {
                        lines.push([
                            formatInTz(exp.date, 'dd/MM/yyyy'),
                            `"${exp.description.replace(/"/g, '""')}"`,
                            translateCategoryExpense(exp.category),
                            formatCurrency(exp.amount)
                        ].join(sep))
                    })
                } else {
                    lines.push('Sin gastos en este período')
                }
                lines.push('')

                // Manual Incomes
                lines.push('INGRESOS MANUALES')
                lines.push(`Fecha${sep}Descripción${sep}Categoría${sep}Monto`)
                if (incomes.length > 0) {
                    incomes.forEach(inc => {
                        lines.push([
                            formatInTz(inc.date, 'dd/MM/yyyy'),
                            `"${inc.description.replace(/"/g, '""')}"`,
                            translateCategoryIncome(inc.category),
                            formatCurrency(inc.amount)
                        ].join(sep))
                    })
                } else {
                    lines.push('Sin ingresos manuales en este período')
                }

                const csvContent = '\uFEFF' + lines.join('\n') // BOM for Excel compatibility
                const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
                downloadBlob(blob, `reporte_finanzas_${filterType}_${dateStamp}.csv`)
            }
            setShowExportMenu(false)
            toast.success('Exportación completada')
        } catch (error) {
            console.error('Export error:', error)
            toast.error('Error al exportar datos')
        }
    }

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
            await financeService.deleteExpense(expenseId)
            toast.success('Gasto eliminado')
            loadData()
        } catch (error) {
            console.error('Error deleting expense:', error)
            toast.error('Error al eliminar el gasto')
        }
    }

    // ── Income handlers ──
    const handleAddIncome = async (incomeData: { description: string, amount: number, category: string, date: string, tutor_id?: string, services?: any[] }) => {
        if (!clinicId) {
            toast.error('No se pudo identificar la clínica')
            return
        }

        try {
            await financeService.addIncome({
                clinic_id: clinicId,
                description: incomeData.description,
                amount: incomeData.amount,
                category: incomeData.category as any,
                date: incomeData.date,
                tutor_id: incomeData.tutor_id,
                services: incomeData.services
            })
            toast.success('Ingreso registrado exitosamente')
            setShowIncomeModal(false)
            loadData()
        } catch (error) {
            console.error('Error adding income:', error)
            toast.error('Error al registrar el ingreso')
        }
    }

    const handleDeleteIncome = async (incomeId: string, description: string) => {
        if (!confirm(`¿Estás seguro de que deseas eliminar el ingreso "${description}"?`)) return

        try {
            await financeService.deleteIncome(incomeId)
            toast.success('Ingreso eliminado')
            loadData()
        } catch (error) {
            console.error('Error deleting income:', error)
            toast.error('Error al eliminar el ingreso')
        }
    }

    const handleRegisterPayment = async (appointmentId: string) => {
        try {
            await financeService.updatePaymentStatus(appointmentId, 'paid')
            toast.success('Pago registrado')
            loadData()
        } catch (error) {
            console.error('Error registering payment:', error)
            toast.error('Error al registrar el pago')
        }
    }

    const handleDeletePayment = async (appointmentId: string) => {
        if (!confirm('¿Estás seguro de que deseas eliminar este pago? La transacción volverá a estado pendiente y se descontará de los ingresos.')) return
        try {
            await financeService.updatePaymentStatus(appointmentId, 'pending')
            toast.success('Pago eliminado')
            loadData()
        } catch (error) {
            console.error('Error deleting payment:', error)
            toast.error('Error al eliminar el pago')
        }
    }

    const handleClearTransaction = async (appointmentId: string) => {
        if (!confirm('¿Estás seguro de que deseas eliminar esta transacción pendiente? Esto pondrá el precio en $0 para que no afecte tus reportes ni deudas.')) return
        try {
            setLoading(true)
            await financeService.updateTransactionPrice(appointmentId, 0)
            toast.success('Transacción eliminada de finanzas')
            loadData()
        } catch (error) {
            console.error('Error clearing transaction:', error)
            toast.error('Error al eliminar la transacción')
        } finally {
            setLoading(false)
        }
    }

    // ── Render ──
    return (
        <div className="space-y-6">
            {/* Header Banner */}
            <div className="bg-hero-gradient rounded-softer p-6 text-white shadow-soft-md relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-16 -mt-16 blur-2xl" />
                
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 bg-premium-gradient rounded-full flex items-center justify-center shadow-lg shrink-0">
                            <DollarSign className="w-7 h-7 text-charcoal" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-white tracking-tight">Finanzas</h1>
                            <p className="text-white/80 text-sm mt-1 max-w-2xl leading-relaxed">
                                📊 Gestiona los ingresos y gastos de tu clínica. Revisa la rentabilidad, los pagos por cobrar y el historial financiero detallado.
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap">
                        {/* Export dropdown */}
                        <div className="relative" ref={exportMenuRef}>
                            <button
                                onClick={() => setShowExportMenu(!showExportMenu)}
                                className="btn-gold-border bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-soft text-sm font-medium transition-all backdrop-blur-sm flex items-center gap-2"
                            >
                                <Download className="w-4 h-4" />
                                <span className="hidden sm:inline">Exportar</span>
                                <ChevronDown className={cn("w-3 h-3 transition-transform", showExportMenu && "rotate-180")} />
                            </button>

                            {showExportMenu && (
                                <div className="absolute right-0 top-full mt-2 w-52 bg-white rounded-lg shadow-xl border border-silk-beige py-1 z-50 animate-in fade-in slide-in-from-top-2">
                                    <p className="px-4 py-2 text-xs font-medium text-charcoal/40 uppercase tracking-wide">Formato de archivo</p>
                                    <button
                                        onClick={() => handleExport('csv')}
                                        className="w-full text-left px-4 py-2.5 text-sm text-charcoal hover:bg-ivory flex items-center gap-3"
                                    >
                                        <FileText className="w-4 h-4 text-emerald-600" />
                                        <div>
                                            <p className="font-medium">CSV</p>
                                            <p className="text-xs text-charcoal/50">Compatible con Excel</p>
                                        </div>
                                    </button>
                                    <button
                                        onClick={() => handleExport('json')}
                                        className="w-full text-left px-4 py-2.5 text-sm text-charcoal hover:bg-ivory flex items-center gap-3"
                                    >
                                        <FileText className="w-4 h-4 text-amber-600" />
                                        <div>
                                            <p className="font-medium">JSON</p>
                                            <p className="text-xs text-charcoal/50">Datos para analítica</p>
                                        </div>
                                    </button>
                                </div>
                            )}
                        </div>

                        <button
                            onClick={() => setShowIncomeModal(true)}
                            className="bg-premium-gradient text-charcoal px-6 py-2.5 rounded-soft text-sm font-bold transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5 active:scale-95 flex items-center gap-2 border-none"
                        >
                            <Plus className="w-5 h-5" />
                            Ingreso
                        </button>

                        <button
                            onClick={() => setShowExpenseModal(true)}
                            className="bg-white text-primary-700 hover:bg-ivory px-4 py-2 rounded-soft text-sm font-bold transition-all shadow-sm flex items-center gap-2"
                        >
                            <Plus className="w-4 h-4" />
                            <span>Gasto</span>
                        </button>
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
                        <p className="font-bold text-primary-700 text-[11px] mb-1.5 flex items-center gap-1.5 uppercase tracking-wider">
                            <TrendingUp className="w-3.5 h-3.5" /> Ingresos vs Gastos:
                        </p>
                        <p className="text-[11px] leading-relaxed text-charcoal/70">
                            Mantén tus gastos generales (nómina, alquiler, insumos) controlados. Una ganancia neta saludable suele estar por encima del 20-30% tras cubrir todos los costos operativos.
                        </p>
                    </div>
                    <div className="bg-white/50 p-3.5 rounded-soft border border-silk-beige/30">
                        <p className="font-bold text-primary-700 text-[11px] mb-1.5 flex items-center gap-1.5 uppercase tracking-wider">
                            <CreditCard className="w-3.5 h-3.5" /> Pagos por Cobrar:
                        </p>
                        <p className="text-[11px] leading-relaxed text-charcoal/70">
                            Las transacciones que aparecen como "Pendientes" son citas realizadas que aún no han sido marcadas como pagadas. Hazles seguimiento para mantener un flujo de caja positivo.
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
                    {getDateRangeLabel(filterType)}
                </div>
                
                <div className="flex bg-silk-beige/20 rounded-lg border border-silk-beige p-1 w-fit">
                    {(['day', 'week', 'month', 'year'] as const).map(f => (
                        <button
                            key={f}
                            onClick={() => setFilterType(f)}
                            className={cn(
                                "px-4 py-1.5 text-xs font-bold rounded-md transition-all",
                                filterType === f
                                    ? "bg-white text-primary-600 shadow-sm border border-silk-beige/50"
                                    : "text-charcoal/40 hover:text-charcoal"
                            )}
                        >
                            {f === 'day' ? 'Día' : f === 'week' ? 'Semana' : f === 'month' ? 'Mes' : 'Año'}
                        </button>
                    ))}
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="card-soft p-4 flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                        <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
                            <TrendingUp className="w-5 h-5 text-emerald-600" />
                        </div>
                    </div>
                    <p className="text-sm text-charcoal/60">Ingresos ({getFilterLabel()})</p>
                    <p className="text-2xl font-bold text-charcoal mt-1">
                        {loading ? '...' : formatCurrency(stats?.total_income || 0)}
                    </p>
                </div>

                <div className="card-soft p-4 flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                        <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                            <TrendingDown className="w-5 h-5 text-red-600" />
                        </div>
                    </div>
                    <p className="text-sm text-charcoal/60">Gastos ({getFilterLabel()})</p>
                    <p className="text-2xl font-bold text-charcoal mt-1">
                        {loading ? '...' : formatCurrency(stats?.total_expenses || 0)}
                    </p>
                </div>

                <div className="card-soft p-4 flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                        <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                            <DollarSign className="w-5 h-5 text-blue-600" />
                        </div>
                        <span className="text-xs font-medium text-charcoal/40 bg-gray-100 px-2 py-1 rounded-full">
                            Neto
                        </span>
                    </div>
                    <p className="text-sm text-charcoal/60">Ganancia Neta</p>
                    <p className={cn(
                        "text-2xl font-bold mt-1",
                        (stats?.net_profit || 0) >= 0 ? "text-emerald-600" : "text-red-600"
                    )}>
                        {loading ? '...' : formatCurrency(stats?.net_profit || 0)}
                    </p>
                </div>

                <div className="card-soft p-4 flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                        <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                            <CreditCard className="w-5 h-5 text-amber-600" />
                        </div>
                        <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-1 rounded-full">
                            {stats?.appointments_count || 0} Citas
                        </span>
                    </div>
                    <p className="text-sm text-charcoal/60">Por Cobrar</p>
                    <p className="text-2xl font-bold text-charcoal mt-1">
                        {loading ? '...' : formatCurrency(stats?.pending_payments || 0)}
                    </p>
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
                                ? "border-primary-500 text-primary-600"
                                : "border-transparent text-charcoal/60 hover:text-charcoal"
                        )}
                    >
                        Resumen
                    </button>
                    <button
                        onClick={() => setActiveTab('transactions')}
                        className={cn(
                            "py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
                            activeTab === 'transactions'
                                ? "border-primary-500 text-primary-600"
                                : "border-transparent text-charcoal/60 hover:text-charcoal"
                        )}
                    >
                        Transacciones
                    </button>
                    <button
                        onClick={() => setActiveTab('expenses')}
                        className={cn(
                            "py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
                            activeTab === 'expenses'
                                ? "border-primary-500 text-primary-600"
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
                                ? "border-primary-500 text-primary-600"
                                : "border-transparent text-charcoal/60 hover:text-charcoal"
                        )}
                    >
                        Otros Ingresos
                    </button>
                </div>
            </div>

            {/* Content Area */}
            <div className="space-y-6">
                {activeTab === 'dashboard' && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Chart Placeholders */}
                        <div className="lg:col-span-2 card-soft p-6">
                            <h3 className="font-semibold text-charcoal mb-4">Ingresos vs Gastos</h3>
                            <div className="h-64 flex items-center justify-center bg-gray-50 rounded-soft border border-dashed border-gray-200">
                                <p className="text-charcoal/40 text-sm">Gráfico de barras (Próximamente)</p>
                            </div>
                        </div>

                        {/* Recent Transactions Mini List */}
                        <div className="card-soft p-6">
                            <h3 className="font-semibold text-charcoal mb-4">Recientes</h3>
                            <div className="space-y-4">
                                {transactions.slice(0, 5).map((tx) => (
                                    <div key={tx.id} className="flex items-center justify-between text-sm">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-primary-50 flex items-center justify-center text-primary-600">
                                                <DollarSign className="w-4 h-4" />
                                            </div>
                                            <div>
                                                <p className="font-medium text-charcoal">{tx.patient_name}</p>
                                                <p className="text-xs text-charcoal/50">{formatInTz(tx.appointment_date, 'd MMM')}</p>
                                            </div>
                                        </div>
                                        <span className={cn(
                                            "font-medium",
                                            tx.price > 0 ? "text-emerald-600" : "text-charcoal/60"
                                        )}>
                                            +{formatCurrency(tx.price || 0)}
                                        </span>
                                    </div>
                                ))}
                                {transactions.length === 0 && (
                                    <p className="text-sm text-charcoal/50 text-center py-4">No hay transacciones recientes</p>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'transactions' && (
                    <div className="card-soft overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-silk-beige/30 text-charcoal/70 uppercase text-xs">
                                    <tr>
                                        <th className="px-6 py-3 font-medium">Fecha</th>
                                        <th className="px-6 py-3 font-medium">Paciente</th>
                                        <th className="px-6 py-3 font-medium">Servicio</th>
                                        <th className="px-6 py-3 font-medium">Monto</th>
                                        <th className="px-6 py-3 font-medium">Estado</th>
                                        <th className="px-6 py-3 font-medium text-right">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-silk-beige">
                                    {transactions.map((tx) => (
                                        <tr key={tx.id} className="hover:bg-ivory/50">
                                            <td className="px-6 py-3 text-charcoal/80">
                                                {formatInTz(tx.appointment_date, 'dd/MM/yyyy HH:mm')}
                                            </td>
                                            <td className="px-6 py-3 font-medium text-charcoal">
                                                {tx.patient_name}
                                            </td>
                                            <td className="px-6 py-3 text-charcoal/60">
                                                {tx.service || '-'}
                                            </td>
                                            <td className="px-6 py-3 font-medium text-charcoal">
                                                {formatCurrency(tx.price || 0)}
                                            </td>
                                            <td className="px-6 py-3">
                                                <span className={cn(
                                                    "px-2 py-1 rounded-full text-xs font-medium",
                                                    tx.payment_status === 'paid' ? "bg-emerald-100 text-emerald-700" :
                                                        tx.payment_status === 'pending' ? "bg-amber-100 text-amber-700" :
                                                            "bg-gray-100 text-gray-600"
                                                )}>
                                                    {translateStatus(tx.payment_status)}
                                                </span>
                                            </td>
                                            <td className="px-6 py-3 text-right">
                                                {tx.payment_status === 'pending' && (
                                                    <div className="flex flex-col items-end gap-1">
                                                        <button
                                                            className="text-xs text-primary-600 font-medium hover:underline"
                                                            onClick={() => handleRegisterPayment(tx.id)}
                                                        >
                                                            Registrar Pago
                                                        </button>
                                                        <button
                                                            className="text-xs text-red-500 font-medium hover:underline"
                                                            onClick={() => handleClearTransaction(tx.id)}
                                                        >
                                                            Eliminar
                                                        </button>
                                                    </div>
                                                )}
                                                {tx.payment_status === 'paid' && (
                                                    <button
                                                        className="text-xs text-red-600 font-medium hover:underline flex items-center gap-1 justify-end w-full"
                                                        onClick={() => handleDeletePayment(tx.id)}
                                                    >
                                                        <Trash2 className="w-3 h-3" />
                                                        Eliminar Pago
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                    {transactions.length === 0 && (
                                        <tr>
                                            <td colSpan={6} className="px-6 py-8 text-center text-charcoal/50">
                                                No se encontraron transacciones en este período
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {activeTab === 'expenses' && (
                    <div className="card-soft overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-silk-beige/30 text-charcoal/70 uppercase text-xs">
                                    <tr>
                                        <th className="px-6 py-3 font-medium">Fecha</th>
                                        <th className="px-6 py-3 font-medium">Concepto</th>
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
                                                <span className="bg-gray-100 text-charcoal/70 px-2 py-1 rounded text-xs capitalize">
                                                    {translateCategoryExpense(expense.category)}
                                                </span>
                                            </td>
                                            <td className="px-6 py-3 font-medium text-right text-red-600">
                                                -{formatCurrency(expense.amount)}
                                            </td>
                                            <td className="px-6 py-3 text-right">
                                                <button
                                                    onClick={() => handleDeleteExpense(expense.id, expense.description)}
                                                    className="text-charcoal/40 hover:text-red-500 transition-colors inline-flex items-center gap-1 text-xs"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                    Eliminar
                                                </button>
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

                {activeTab === 'incomes' && (
                    <div className="card-soft overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-silk-beige/30 text-charcoal/70 uppercase text-xs">
                                    <tr>
                                        <th className="px-6 py-3 font-medium">Fecha</th>
                                        <th className="px-6 py-3 font-medium">Concepto</th>
                                        <th className="px-6 py-3 font-medium">Categoría</th>
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
                                            <td className="px-6 py-3">
                                                <span className="bg-gray-100 text-charcoal/70 px-2 py-1 rounded text-xs capitalize">
                                                    {translateCategoryIncome(income.category)}
                                                </span>
                                            </td>
                                            <td className="px-6 py-3 font-medium text-right text-emerald-600">
                                                +{formatCurrency(income.amount)}
                                            </td>
                                            <td className="px-6 py-3 text-right">
                                                <button
                                                    onClick={() => handleDeleteIncome(income.id, income.description)}
                                                    className="text-charcoal/40 hover:text-red-500 transition-colors inline-flex items-center gap-1 text-xs"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                    Eliminar
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                    {incomes.length === 0 && (
                                        <tr>
                                            <td colSpan={5} className="px-6 py-8 text-center text-charcoal/50">
                                                No hay ingresos registrados en este período
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
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
                                    className="w-full px-3 py-2 border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
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
                                        className="w-full px-3 py-2 border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                                        placeholder="0.00"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-charcoal mb-1">Fecha</label>
                                    <input
                                        name="date"
                                        type="date"
                                        required
                                        defaultValue={new Date().toISOString().split('T')[0]}
                                        className="w-full px-3 py-2 border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-charcoal mb-1">Categoría</label>
                                <select
                                    name="category"
                                    required
                                    className="w-full px-3 py-2 border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
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

            {/* Modal de Ingresos */}
            {showIncomeModal && clinicId && (
                <NewIncomeForm
                    clinicId={clinicId}
                    onClose={() => setShowIncomeModal(false)}
                    onSuccess={handleAddIncome}
                />
            )}
        </div>
    )
}

export default Finance
