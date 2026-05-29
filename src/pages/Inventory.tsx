import { useState, useEffect, useCallback } from 'react'
import {
    Package, Plus, Search,
    BarChart2, ArrowDownCircle, RefreshCw,
    Edit2, Archive, X, Boxes,
    FlaskConical, Syringe, Apple, Tag,
    Wrench, Clock, CheckCircle2,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { inventoryService, type InventoryProduct, type InventoryMovement } from '@/services/inventoryService'
import type { AbcProduct, NoRotationProduct } from '@/services/inventoryService'
import { cn } from '@/lib/utils'
import { toast } from 'react-hot-toast'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

// ── Helpers ─────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
    medication:       'Medicamento',
    vaccine:          'Vacuna',
    antiparasitic:    'Antiparasitario',
    anesthetic:       'Anestésico',
    antibiotic:       'Antibiótico',
    anti_inflammatory:'Antiinflamatorio',
    vitamin:          'Vitamina / Suplemento',
    disinfectant:     'Desinfectante',
    surgical:         'Material quirúrgico',
    food:             'Alimento',
    accessory:        'Accesorio',
    supply:           'Insumo',
    other:            'Otro',
}
const UNIT_LABELS: Record<string, string> = {
    ml: 'ml', mg: 'mg', unit: 'unidad', tablet: 'comprimido',
    box: 'caja', vial: 'vial', kg: 'kg', g: 'g', dose: 'dosis',
}
const MOVEMENT_LABELS: Record<string, string> = {
    purchase: 'Compra', sale: 'Venta', adjustment: 'Ajuste',
    waste: 'Baja', return: 'Devolución',
}
const MOVEMENT_COLORS: Record<string, string> = {
    purchase: 'text-emerald-600 bg-emerald-50',
    sale: 'text-primary-600 bg-primary-50',
    adjustment: 'text-amber-600 bg-amber-50',
    waste: 'text-red-600 bg-red-50',
    return: 'text-violet-600 bg-violet-50',
}
const ABC_COLORS: Record<string, string> = {
    A: 'bg-emerald-100 text-emerald-700',
    B: 'bg-amber-100 text-amber-700',
    C: 'bg-red-100 text-red-600',
}
const CATEGORY_ICONS: Record<string, any> = {
    medication:        FlaskConical,
    vaccine:           Syringe,
    antiparasitic:     FlaskConical,
    anesthetic:        Syringe,
    antibiotic:        FlaskConical,
    anti_inflammatory: FlaskConical,
    vitamin:           Apple,
    disinfectant:      Wrench,
    surgical:          Wrench,
    food:              Apple,
    accessory:         Tag,
    supply:            Wrench,
    other:             Package,
}

const formatCLP = (n: number) =>
    new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n)

const EMPTY_PRODUCT: Omit<InventoryProduct, 'id' | 'created_at' | 'updated_at'> = {
    clinic_id: '',
    name: '', sku: '', category: 'other', description: '',
    unit: 'unit', purchase_price: 0, sale_price: 0,
    stock_quantity: 0, min_stock_alert: 5,
    batch_number: '', expiry_date: null, is_active: true,
}

// ── Main Component ───────────────────────────────────────────────────
const Inventory = () => {
    const { profile, member } = useAuth()
    const clinicId = member?.clinic_id || profile?.clinic_id

    const [activeTab, setActiveTab] = useState<'catalog' | 'movements' | 'analysis'>('catalog')
    const [products, setProducts] = useState<InventoryProduct[]>([])
    const [movements, setMovements] = useState<(InventoryMovement & { product_name?: string })[]>([])
    const [abcData, setAbcData] = useState<AbcProduct[]>([])
    const [noRotation, setNoRotation] = useState<NoRotationProduct[]>([])
    const [stats, setStats] = useState({ total: 0, lowStock: 0, expiringSoon: 0, totalValue: 0 })
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')
    const [categoryFilter, setCategoryFilter] = useState<string>('all')
    const [movTypeFilter, setMovTypeFilter] = useState<string>('all')
    const [noRotDays, setNoRotDays] = useState(30)
    const [abcDays, setAbcDays] = useState(90)

    // Modal states
    const [showProductModal, setShowProductModal] = useState(false)
    const [editingProduct, setEditingProduct] = useState<InventoryProduct | null>(null)
    const [productForm, setProductForm] = useState(EMPTY_PRODUCT)
    const [showRestockModal, setShowRestockModal] = useState(false)
    const [restockProduct, setRestockProduct] = useState<InventoryProduct | null>(null)
    const [restockQty, setRestockQty] = useState(1)
    const [restockCost, setRestockCost] = useState(0)
    const [restockNotes, setRestockNotes] = useState('')
    const [saving, setSaving] = useState(false)

    // ── Load data ──────────────────────────────────────────────────────

    const loadProducts = useCallback(async () => {
        if (!clinicId) return
        const [prods, statsData] = await Promise.all([
            inventoryService.getAllProducts(clinicId),
            inventoryService.getInventoryStats(clinicId),
        ])
        setProducts(prods)
        setStats(statsData)
    }, [clinicId])

    const loadMovements = useCallback(async () => {
        if (!clinicId) return
        const data = await inventoryService.getMovements(clinicId, {
            type: movTypeFilter !== 'all' ? movTypeFilter : undefined,
        })
        setMovements(data)
    }, [clinicId, movTypeFilter])

    const loadAnalysis = useCallback(async () => {
        if (!clinicId) return
        const [abc, noRot] = await Promise.all([
            inventoryService.getAbcClassification(clinicId, abcDays),
            inventoryService.getNoRotationProducts(clinicId, noRotDays),
        ])
        setAbcData(abc)
        setNoRotation(noRot)
    }, [clinicId, abcDays, noRotDays])

    useEffect(() => {
        if (!clinicId) return
        let cancelled = false
        const load = async () => {
            setLoading(true)
            try {
                await loadProducts()
                if (!cancelled) {
                    if (activeTab === 'movements') await loadMovements()
                    if (activeTab === 'analysis') await loadAnalysis()
                }
            } catch (e) {
                console.error(e)
                toast.error('Error cargando inventario')
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        load()
        return () => { cancelled = true }
    }, [clinicId, activeTab])

    useEffect(() => {
        if (activeTab === 'movements' && clinicId) loadMovements()
    }, [movTypeFilter])

    useEffect(() => {
        if (activeTab === 'analysis' && clinicId) loadAnalysis()
    }, [noRotDays, abcDays])

    // ── Filtered products ──────────────────────────────────────────────

    const filteredProducts = products.filter(p => {
        const matchSearch = !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (p.sku ?? '').toLowerCase().includes(searchQuery.toLowerCase())
        const matchCat = categoryFilter === 'all' || p.category === categoryFilter
        return matchSearch && matchCat
    })

    // ── Handlers ───────────────────────────────────────────────────────

    const openCreate = () => {
        setEditingProduct(null)
        setProductForm({ ...EMPTY_PRODUCT, clinic_id: clinicId ?? '' })
        setShowProductModal(true)
    }

    const openEdit = (p: InventoryProduct) => {
        setEditingProduct(p)
        setProductForm({ ...p })
        setShowProductModal(true)
    }

    const openRestock = (p: InventoryProduct) => {
        setRestockProduct(p)
        setRestockQty(1)
        setRestockCost(p.purchase_price)
        setRestockNotes('')
        setShowRestockModal(true)
    }

    const handleSaveProduct = async () => {
        if (!productForm.name.trim()) return toast.error('El nombre es obligatorio')
        setSaving(true)
        try {
            if (editingProduct) {
                await inventoryService.updateProduct(editingProduct.id, productForm)
                toast.success('Producto actualizado')
            } else {
                await inventoryService.createProduct({ ...productForm, clinic_id: clinicId! })
                toast.success('Producto creado')
            }
            setShowProductModal(false)
            await loadProducts()
        } catch (e: any) {
            toast.error(e.message ?? 'Error al guardar')
        } finally {
            setSaving(false)
        }
    }

    const handleRestock = async () => {
        if (!restockProduct || restockQty <= 0) return
        setSaving(true)
        try {
            await inventoryService.addMovement({
                clinic_id: clinicId!,
                product_id: restockProduct.id,
                type: 'purchase',
                quantity: restockQty,
                unit_cost: restockCost,
                unit_price: null,
                appointment_id: null,
                tutor_id: null,
                notes: restockNotes || null,
                created_by: null,
            })
            toast.success(`+${restockQty} ${UNIT_LABELS[restockProduct.unit]}(s) registrados`)
            setShowRestockModal(false)
            await loadProducts()
            if (activeTab === 'movements') await loadMovements()
        } catch (e: any) {
            toast.error(e.message ?? 'Error al registrar ingreso')
        } finally {
            setSaving(false)
        }
    }

    const handleArchive = async (p: InventoryProduct) => {
        if (!confirm(`¿Archivar "${p.name}"? No aparecerá en el catálogo activo.`)) return
        try {
            await inventoryService.archiveProduct(p.id)
            toast.success('Producto archivado')
            await loadProducts()
        } catch (e: any) {
            toast.error(e.message ?? 'Error al archivar')
        }
    }

    // ── Stock badge ────────────────────────────────────────────────────

    const StockBadge = ({ p }: { p: InventoryProduct }) => {
        const today = new Date()
        const in30 = new Date(); in30.setDate(in30.getDate() + 30)
        const expiry = p.expiry_date ? new Date(p.expiry_date) : null
        const expired = expiry && expiry < today
        const expSoon = expiry && expiry >= today && expiry <= in30

        if (!p.is_active) return <span className="text-[10px] px-2 py-0.5 rounded-full bg-charcoal/10 text-charcoal/40">Archivado</span>
        if (expired)      return <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-600 font-bold">Vencido</span>
        if (p.stock_quantity <= 0) return <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-600 font-bold">Sin stock</span>
        if (p.stock_quantity <= p.min_stock_alert) return <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">Bajo stock</span>
        if (expSoon)      return <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">Vence pronto</span>
        return <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600">OK</span>
    }

    // ── Render ─────────────────────────────────────────────────────────

    return (
        <div className="space-y-6 animate-fade-in">

            {/* Banner */}
            <div className="bg-gradient-to-br from-primary-500 to-primary-700 rounded-2xl overflow-hidden shadow-soft-md">
                <div className="p-6 text-white flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <p className="text-xs font-black uppercase tracking-widest text-primary-200 mb-1">Clínica</p>
                        <h1 className="text-2xl font-extrabold tracking-tight text-white">Inventario</h1>
                        <p className="text-sm text-primary-200 mt-1">Gestión de productos, stock y movimientos</p>
                    </div>
                    <div className="flex items-center gap-6 text-center">
                        <div>
                            <p className="text-2xl font-extrabold">{stats.total}</p>
                            <p className="text-xs text-primary-200">Productos</p>
                        </div>
                        <div className="w-px h-8 bg-white/20" />
                        <div>
                            <p className={cn("text-2xl font-extrabold", stats.lowStock > 0 ? "text-amber-300" : "text-white")}>{stats.lowStock}</p>
                            <p className="text-xs text-primary-200">Bajo stock</p>
                        </div>
                        <div className="w-px h-8 bg-white/20" />
                        <div>
                            <p className={cn("text-2xl font-extrabold", stats.expiringSoon > 0 ? "text-amber-300" : "text-white")}>{stats.expiringSoon}</p>
                            <p className="text-xs text-primary-200">Vencen en 30d</p>
                        </div>
                        <div className="w-px h-8 bg-white/20" />
                        <div>
                            <p className="text-lg font-extrabold">{formatCLP(stats.totalValue)}</p>
                            <p className="text-xs text-primary-200">Valor stock</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-silk-beige/40 p-1 rounded-xl border border-silk-beige w-fit">
                {([
                    { id: 'catalog', label: 'Catálogo', icon: Boxes },
                    { id: 'movements', label: 'Movimientos', icon: ArrowDownCircle },
                    { id: 'analysis', label: 'Análisis', icon: BarChart2 },
                ] as const).map(t => (
                    <button
                        key={t.id}
                        onClick={() => setActiveTab(t.id)}
                        className={cn(
                            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all",
                            activeTab === t.id
                                ? "bg-white text-primary-600 shadow-sm border border-silk-beige/50"
                                : "text-charcoal/50 hover:text-charcoal"
                        )}
                    >
                        <t.icon className="w-4 h-4" />
                        {t.label}
                    </button>
                ))}
            </div>

            {/* ── TAB: CATÁLOGO ── */}
            {activeTab === 'catalog' && (
                <div className="space-y-4">
                    {/* Toolbar */}
                    <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
                        <div className="flex gap-2 flex-1">
                            <div className="relative flex-1 max-w-sm">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal/40" />
                                <input
                                    className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-silk-beige rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-300"
                                    placeholder="Buscar por nombre o SKU..."
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                />
                            </div>
                            <select
                                value={categoryFilter}
                                onChange={e => setCategoryFilter(e.target.value)}
                                className="text-sm bg-white border border-silk-beige rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-300"
                            >
                                <option value="all">Todas las categorías</option>
                                {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                                    <option key={k} value={k}>{v}</option>
                                ))}
                            </select>
                        </div>
                        <button
                            onClick={openCreate}
                            className="flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-xl text-sm font-semibold hover:bg-primary-600 transition-colors shrink-0"
                        >
                            <Plus className="w-4 h-4" /> Nuevo producto
                        </button>
                    </div>

                    {/* Tabla */}
                    {loading ? (
                        <div className="flex items-center justify-center py-16 text-charcoal/40">
                            <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Cargando...
                        </div>
                    ) : filteredProducts.length === 0 ? (
                        <div className="text-center py-16">
                            <Package className="w-10 h-10 text-charcoal/20 mx-auto mb-3" />
                            <p className="text-charcoal/40 text-sm">
                                {searchQuery ? 'No hay productos que coincidan' : 'Agrega tu primer producto al catálogo'}
                            </p>
                        </div>
                    ) : (
                        <div className="bg-white rounded-2xl border border-silk-beige overflow-hidden">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-silk-beige bg-ivory">
                                        <th className="text-left px-4 py-3 text-xs font-black uppercase tracking-wider text-charcoal/40">Producto</th>
                                        <th className="text-left px-4 py-3 text-xs font-black uppercase tracking-wider text-charcoal/40">Categoría</th>
                                        <th className="text-right px-4 py-3 text-xs font-black uppercase tracking-wider text-charcoal/40">Stock</th>
                                        <th className="text-right px-4 py-3 text-xs font-black uppercase tracking-wider text-charcoal/40">P. Venta</th>
                                        <th className="text-left px-4 py-3 text-xs font-black uppercase tracking-wider text-charcoal/40">Vencimiento</th>
                                        <th className="text-left px-4 py-3 text-xs font-black uppercase tracking-wider text-charcoal/40">Estado</th>
                                        <th className="px-4 py-3" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-silk-beige/40">
                                    {filteredProducts.map(p => {
                                        const Icon = CATEGORY_ICONS[p.category] ?? Package
                                        return (
                                            <tr key={p.id} className="hover:bg-ivory/50 transition-colors">
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center shrink-0">
                                                            <Icon className="w-4 h-4 text-primary-500" />
                                                        </div>
                                                        <div>
                                                            <p className="font-semibold text-charcoal">{p.name}</p>
                                                            {p.sku && <p className="text-xs text-charcoal/40">SKU: {p.sku}</p>}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className="text-xs px-2 py-0.5 rounded-full bg-charcoal/5 text-charcoal/60">
                                                        {CATEGORY_LABELS[p.category]}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-right">
                                                    <span className={cn(
                                                        "font-bold",
                                                        p.stock_quantity <= 0 ? "text-red-500" :
                                                        p.stock_quantity <= p.min_stock_alert ? "text-amber-600" : "text-charcoal"
                                                    )}>
                                                        {p.stock_quantity}
                                                    </span>
                                                    <span className="text-charcoal/40 text-xs ml-1">{UNIT_LABELS[p.unit]}</span>
                                                </td>
                                                <td className="px-4 py-3 text-right font-semibold text-charcoal">
                                                    {formatCLP(p.sale_price)}
                                                </td>
                                                <td className="px-4 py-3 text-sm text-charcoal/60">
                                                    {p.expiry_date
                                                        ? format(new Date(p.expiry_date), 'dd MMM yyyy', { locale: es })
                                                        : <span className="text-charcoal/30">—</span>}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <StockBadge p={p} />
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-1 justify-end">
                                                        <button
                                                            onClick={() => openRestock(p)}
                                                            title="Registrar ingreso de stock"
                                                            className="p-1.5 hover:bg-emerald-50 text-charcoal/40 hover:text-emerald-600 rounded-lg transition-colors"
                                                        >
                                                            <ArrowDownCircle className="w-4 h-4" />
                                                        </button>
                                                        <button
                                                            onClick={() => openEdit(p)}
                                                            className="p-1.5 hover:bg-primary-50 text-charcoal/40 hover:text-primary-600 rounded-lg transition-colors"
                                                        >
                                                            <Edit2 className="w-4 h-4" />
                                                        </button>
                                                        <button
                                                            onClick={() => handleArchive(p)}
                                                            className="p-1.5 hover:bg-red-50 text-charcoal/40 hover:text-red-500 rounded-lg transition-colors"
                                                        >
                                                            <Archive className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* ── TAB: MOVIMIENTOS ── */}
            {activeTab === 'movements' && (
                <div className="space-y-4">
                    <div className="flex gap-2 items-center">
                        <select
                            value={movTypeFilter}
                            onChange={e => setMovTypeFilter(e.target.value)}
                            className="text-sm bg-white border border-silk-beige rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-300"
                        >
                            <option value="all">Todos los tipos</option>
                            {Object.entries(MOVEMENT_LABELS).map(([k, v]) => (
                                <option key={k} value={k}>{v}</option>
                            ))}
                        </select>
                        <p className="text-sm text-charcoal/40">Últimos 200 movimientos</p>
                    </div>

                    {loading ? (
                        <div className="flex items-center justify-center py-16 text-charcoal/40">
                            <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Cargando...
                        </div>
                    ) : movements.length === 0 ? (
                        <div className="text-center py-16">
                            <ArrowDownCircle className="w-10 h-10 text-charcoal/20 mx-auto mb-3" />
                            <p className="text-charcoal/40 text-sm">Sin movimientos registrados</p>
                        </div>
                    ) : (
                        <div className="bg-white rounded-2xl border border-silk-beige overflow-hidden">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-silk-beige bg-ivory">
                                        <th className="text-left px-4 py-3 text-xs font-black uppercase tracking-wider text-charcoal/40">Fecha</th>
                                        <th className="text-left px-4 py-3 text-xs font-black uppercase tracking-wider text-charcoal/40">Producto</th>
                                        <th className="text-left px-4 py-3 text-xs font-black uppercase tracking-wider text-charcoal/40">Tipo</th>
                                        <th className="text-right px-4 py-3 text-xs font-black uppercase tracking-wider text-charcoal/40">Cantidad</th>
                                        <th className="text-right px-4 py-3 text-xs font-black uppercase tracking-wider text-charcoal/40">Precio</th>
                                        <th className="text-left px-4 py-3 text-xs font-black uppercase tracking-wider text-charcoal/40">Notas</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-silk-beige/40">
                                    {movements.map(m => (
                                        <tr key={m.id} className="hover:bg-ivory/50">
                                            <td className="px-4 py-3 text-charcoal/60">
                                                {format(new Date(m.created_at), 'dd MMM, HH:mm', { locale: es })}
                                            </td>
                                            <td className="px-4 py-3 font-medium text-charcoal">{m.product_name ?? '—'}</td>
                                            <td className="px-4 py-3">
                                                <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", MOVEMENT_COLORS[m.type])}>
                                                    {MOVEMENT_LABELS[m.type]}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <span className={cn("font-bold", m.quantity > 0 ? "text-emerald-600" : "text-red-500")}>
                                                    {m.quantity > 0 ? '+' : ''}{m.quantity}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-right text-charcoal/60">
                                                {m.unit_price != null ? formatCLP(m.unit_price) : m.unit_cost != null ? formatCLP(m.unit_cost) : '—'}
                                            </td>
                                            <td className="px-4 py-3 text-charcoal/50 text-xs max-w-[200px] truncate">
                                                {m.notes ?? '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* ── TAB: ANÁLISIS ── */}
            {activeTab === 'analysis' && (
                <div className="space-y-6">
                    {/* Sección ABC */}
                    <div className="bg-white rounded-2xl border border-silk-beige overflow-hidden">
                        <div className="p-5 border-b border-silk-beige flex items-center justify-between">
                            <div>
                                <h3 className="font-bold text-charcoal">Clasificación ABC</h3>
                                <p className="text-xs text-charcoal/50 mt-0.5">
                                    A = 80% ingresos · B = 15% · C = 5%
                                </p>
                            </div>
                            <select
                                value={abcDays}
                                onChange={e => setAbcDays(Number(e.target.value))}
                                className="text-sm bg-white border border-silk-beige rounded-xl px-3 py-1.5"
                            >
                                <option value={30}>Últimos 30 días</option>
                                <option value={60}>Últimos 60 días</option>
                                <option value={90}>Últimos 90 días</option>
                                <option value={180}>Últimos 6 meses</option>
                            </select>
                        </div>
                        {loading ? (
                            <div className="py-10 text-center text-charcoal/40"><RefreshCw className="w-5 h-5 animate-spin mx-auto" /></div>
                        ) : abcData.length === 0 ? (
                            <div className="py-10 text-center text-charcoal/40 text-sm">Sin datos de ventas en el período</div>
                        ) : (
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-ivory border-b border-silk-beige">
                                        <th className="text-left px-4 py-2 text-xs font-black uppercase tracking-wider text-charcoal/40">Clase</th>
                                        <th className="text-left px-4 py-2 text-xs font-black uppercase tracking-wider text-charcoal/40">Producto</th>
                                        <th className="text-right px-4 py-2 text-xs font-black uppercase tracking-wider text-charcoal/40">Unidades</th>
                                        <th className="text-right px-4 py-2 text-xs font-black uppercase tracking-wider text-charcoal/40">Ingresos</th>
                                        <th className="text-right px-4 py-2 text-xs font-black uppercase tracking-wider text-charcoal/40">% del total</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-silk-beige/40">
                                    {abcData.map(p => (
                                        <tr key={p.product_id} className="hover:bg-ivory/50">
                                            <td className="px-4 py-2.5">
                                                <span className={cn("text-xs font-black px-2 py-0.5 rounded-full", ABC_COLORS[p.abc_class])}>
                                                    {p.abc_class}
                                                </span>
                                            </td>
                                            <td className="px-4 py-2.5">
                                                <p className="font-medium text-charcoal">{p.product_name}</p>
                                                <p className="text-xs text-charcoal/40">{CATEGORY_LABELS[p.category]}</p>
                                            </td>
                                            <td className="px-4 py-2.5 text-right text-charcoal/70">{p.total_sold} {UNIT_LABELS[p.unit]}(s)</td>
                                            <td className="px-4 py-2.5 text-right font-semibold text-charcoal">{formatCLP(p.total_revenue)}</td>
                                            <td className="px-4 py-2.5 text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    <div className="w-16 h-1.5 bg-silk-beige rounded-full overflow-hidden">
                                                        <div className="h-full bg-primary-400 rounded-full" style={{ width: `${Math.min(p.revenue_pct, 100)}%` }} />
                                                    </div>
                                                    <span className="text-xs text-charcoal/60 w-10 text-right">{p.revenue_pct}%</span>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>

                    {/* Sin rotación */}
                    <div className="bg-white rounded-2xl border border-silk-beige overflow-hidden">
                        <div className="p-5 border-b border-silk-beige flex items-center justify-between">
                            <div>
                                <h3 className="font-bold text-charcoal flex items-center gap-2">
                                    <Clock className="w-4 h-4 text-amber-500" />
                                    Productos sin rotación
                                </h3>
                                <p className="text-xs text-charcoal/50 mt-0.5">Con stock disponible pero sin movimientos de venta</p>
                            </div>
                            <select
                                value={noRotDays}
                                onChange={e => setNoRotDays(Number(e.target.value))}
                                className="text-sm bg-white border border-silk-beige rounded-xl px-3 py-1.5"
                            >
                                <option value={15}>Sin venta hace 15+ días</option>
                                <option value={30}>Sin venta hace 30+ días</option>
                                <option value={60}>Sin venta hace 60+ días</option>
                                <option value={90}>Sin venta hace 90+ días</option>
                            </select>
                        </div>
                        {loading ? (
                            <div className="py-10 text-center text-charcoal/40"><RefreshCw className="w-5 h-5 animate-spin mx-auto" /></div>
                        ) : noRotation.length === 0 ? (
                            <div className="py-10 text-center">
                                <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                                <p className="text-charcoal/40 text-sm">¡Todo el stock está rotando en el período indicado!</p>
                            </div>
                        ) : (
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-ivory border-b border-silk-beige">
                                        <th className="text-left px-4 py-2 text-xs font-black uppercase tracking-wider text-charcoal/40">Producto</th>
                                        <th className="text-right px-4 py-2 text-xs font-black uppercase tracking-wider text-charcoal/40">Stock</th>
                                        <th className="text-left px-4 py-2 text-xs font-black uppercase tracking-wider text-charcoal/40">Último movimiento</th>
                                        <th className="text-right px-4 py-2 text-xs font-black uppercase tracking-wider text-charcoal/40">Días inactivo</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-silk-beige/40">
                                    {noRotation.map(p => (
                                        <tr key={p.product_id} className="hover:bg-ivory/50">
                                            <td className="px-4 py-2.5">
                                                <p className="font-medium text-charcoal">{p.product_name}</p>
                                                <p className="text-xs text-charcoal/40">{CATEGORY_LABELS[p.category]}</p>
                                            </td>
                                            <td className="px-4 py-2.5 text-right text-charcoal/70">{p.stock_quantity}</td>
                                            <td className="px-4 py-2.5 text-charcoal/60">
                                                {p.last_movement_at
                                                    ? format(new Date(p.last_movement_at), 'dd MMM yyyy', { locale: es })
                                                    : 'Nunca vendido'}
                                            </td>
                                            <td className="px-4 py-2.5 text-right">
                                                <span className={cn(
                                                    "text-xs font-bold px-2 py-0.5 rounded-full",
                                                    p.days_no_movement >= 60 ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-700"
                                                )}>
                                                    {p.days_no_movement}d
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            )}

            {/* ── MODAL: Crear / Editar producto ── */}
            {showProductModal && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between p-5 border-b border-silk-beige">
                            <h2 className="font-bold text-charcoal text-lg">
                                {editingProduct ? 'Editar producto' : 'Nuevo producto'}
                            </h2>
                            <button onClick={() => setShowProductModal(false)} className="p-1.5 hover:bg-silk-beige rounded-lg">
                                <X className="w-5 h-5 text-charcoal/60" />
                            </button>
                        </div>
                        <div className="p-5 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="col-span-2">
                                    <label className="text-xs font-bold text-charcoal/60 uppercase tracking-wider">Nombre *</label>
                                    <input
                                        className="mt-1 w-full px-3 py-2 border border-silk-beige rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
                                        value={productForm.name}
                                        onChange={e => setProductForm(f => ({ ...f, name: e.target.value }))}
                                        placeholder="Ej: Ivermectina 1%"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-charcoal/60 uppercase tracking-wider">SKU / Código</label>
                                    <input
                                        className="mt-1 w-full px-3 py-2 border border-silk-beige rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
                                        value={productForm.sku ?? ''}
                                        onChange={e => setProductForm(f => ({ ...f, sku: e.target.value }))}
                                        placeholder="Opcional"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-charcoal/60 uppercase tracking-wider">Lote</label>
                                    <input
                                        className="mt-1 w-full px-3 py-2 border border-silk-beige rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
                                        value={productForm.batch_number ?? ''}
                                        onChange={e => setProductForm(f => ({ ...f, batch_number: e.target.value }))}
                                        placeholder="Nº de lote"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-charcoal/60 uppercase tracking-wider">Categoría</label>
                                    <select
                                        className="mt-1 w-full px-3 py-2 border border-silk-beige rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
                                        value={productForm.category}
                                        onChange={e => setProductForm(f => ({ ...f, category: e.target.value as any }))}
                                    >
                                        {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                                            <option key={k} value={k}>{v}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-charcoal/60 uppercase tracking-wider">Unidad</label>
                                    <select
                                        className="mt-1 w-full px-3 py-2 border border-silk-beige rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
                                        value={productForm.unit}
                                        onChange={e => setProductForm(f => ({ ...f, unit: e.target.value as any }))}
                                    >
                                        {Object.entries(UNIT_LABELS).map(([k, v]) => (
                                            <option key={k} value={k}>{v}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-charcoal/60 uppercase tracking-wider">Precio de compra</label>
                                    <input
                                        type="number" min="0"
                                        className="mt-1 w-full px-3 py-2 border border-silk-beige rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
                                        value={productForm.purchase_price || ''}
                                        placeholder="0"
                                        onChange={e => setProductForm(f => ({ ...f, purchase_price: Number(e.target.value) || 0 }))}
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-charcoal/60 uppercase tracking-wider">Precio de venta</label>
                                    <input
                                        type="number" min="0"
                                        className="mt-1 w-full px-3 py-2 border border-silk-beige rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
                                        value={productForm.sale_price || ''}
                                        placeholder="0"
                                        onChange={e => setProductForm(f => ({ ...f, sale_price: Number(e.target.value) || 0 }))}
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-charcoal/60 uppercase tracking-wider">Stock actual</label>
                                    <input
                                        type="number" min="0"
                                        className="mt-1 w-full px-3 py-2 border border-silk-beige rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
                                        value={productForm.stock_quantity || ''}
                                        placeholder="0"
                                        onChange={e => setProductForm(f => ({ ...f, stock_quantity: Number(e.target.value) || 0 }))}
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-charcoal/60 uppercase tracking-wider">Alerta stock mínimo</label>
                                    <input
                                        type="number" min="0"
                                        className="mt-1 w-full px-3 py-2 border border-silk-beige rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
                                        value={productForm.min_stock_alert || ''}
                                        placeholder="5"
                                        onChange={e => setProductForm(f => ({ ...f, min_stock_alert: Number(e.target.value) || 0 }))}
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-charcoal/60 uppercase tracking-wider">Fecha de vencimiento</label>
                                    <input
                                        type="date"
                                        className="mt-1 w-full px-3 py-2 border border-silk-beige rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-300 [color-scheme:light]"
                                        value={productForm.expiry_date ?? ''}
                                        onChange={e => setProductForm(f => ({ ...f, expiry_date: e.target.value || null }))}
                                    />
                                </div>
                                <div className="col-span-2">
                                    <label className="text-xs font-bold text-charcoal/60 uppercase tracking-wider">Descripción</label>
                                    <textarea
                                        rows={2}
                                        className="mt-1 w-full px-3 py-2 border border-silk-beige rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-300 resize-none"
                                        value={productForm.description ?? ''}
                                        onChange={e => setProductForm(f => ({ ...f, description: e.target.value }))}
                                        placeholder="Descripción opcional..."
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 p-5 border-t border-silk-beige">
                            <button onClick={() => setShowProductModal(false)} className="px-4 py-2 text-sm font-semibold text-charcoal/60 hover:text-charcoal border border-silk-beige rounded-xl">
                                Cancelar
                            </button>
                            <button
                                onClick={handleSaveProduct}
                                disabled={saving}
                                className="px-5 py-2 text-sm font-semibold bg-primary-500 text-white rounded-xl hover:bg-primary-600 disabled:opacity-50"
                            >
                                {saving ? 'Guardando...' : editingProduct ? 'Actualizar' : 'Crear producto'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── MODAL: Restock ── */}
            {showRestockModal && restockProduct && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
                        <div className="flex items-center justify-between p-5 border-b border-silk-beige">
                            <h2 className="font-bold text-charcoal text-lg">Ingreso de stock</h2>
                            <button onClick={() => setShowRestockModal(false)} className="p-1.5 hover:bg-silk-beige rounded-lg">
                                <X className="w-5 h-5 text-charcoal/60" />
                            </button>
                        </div>
                        <div className="p-5 space-y-4">
                            <div className="bg-primary-50 rounded-xl p-3">
                                <p className="font-semibold text-primary-700">{restockProduct.name}</p>
                                <p className="text-sm text-primary-500">Stock actual: {restockProduct.stock_quantity} {UNIT_LABELS[restockProduct.unit]}(s)</p>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-charcoal/60 uppercase tracking-wider">Cantidad a ingresar</label>
                                <input
                                    type="number" min="1"
                                    className="mt-1 w-full px-3 py-2 border border-silk-beige rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
                                    value={restockQty || ''}
                                    placeholder="1"
                                    onChange={e => setRestockQty(Number(e.target.value) || 1)}
                                />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-charcoal/60 uppercase tracking-wider">Costo por unidad</label>
                                <input
                                    type="number" min="0"
                                    className="mt-1 w-full px-3 py-2 border border-silk-beige rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
                                    value={restockCost || ''}
                                    placeholder="0"
                                    onChange={e => setRestockCost(Number(e.target.value) || 0)}
                                />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-charcoal/60 uppercase tracking-wider">Notas</label>
                                <input
                                    className="mt-1 w-full px-3 py-2 border border-silk-beige rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
                                    value={restockNotes}
                                    onChange={e => setRestockNotes(e.target.value)}
                                    placeholder="Proveedor, factura, etc."
                                />
                            </div>
                            <div className="bg-emerald-50 rounded-xl p-3 text-sm">
                                <p className="text-emerald-700">
                                    Stock después del ingreso: <strong>{restockProduct.stock_quantity + restockQty} {UNIT_LABELS[restockProduct.unit]}(s)</strong>
                                </p>
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 p-5 border-t border-silk-beige">
                            <button onClick={() => setShowRestockModal(false)} className="px-4 py-2 text-sm font-semibold text-charcoal/60 hover:text-charcoal border border-silk-beige rounded-xl">
                                Cancelar
                            </button>
                            <button
                                onClick={handleRestock}
                                disabled={saving || restockQty <= 0}
                                className="px-5 py-2 text-sm font-semibold bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 disabled:opacity-50 flex items-center gap-2"
                            >
                                <ArrowDownCircle className="w-4 h-4" />
                                {saving ? 'Registrando...' : `Registrar +${restockQty}`}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default Inventory
