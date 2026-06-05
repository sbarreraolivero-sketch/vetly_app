import { useState, useEffect, useCallback, useMemo } from 'react'
import {
    Package, Plus, Search,
    BarChart2, ArrowDownCircle, ArrowUpCircle, RefreshCw,
    Edit2, Trash2, X, Boxes,
    FlaskConical, Syringe, Apple, Tag,
    Wrench, Clock, CheckCircle2, Sparkles,
    Truck, Warehouse, Settings, ArrowLeftRight, ChevronRight,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
    inventoryService,
    type InventoryProduct, type InventoryMovement, type InventoryLocation,
} from '@/services/inventoryService'
import type { AbcProduct, NoRotationProduct } from '@/services/inventoryService'
import { InvoiceAnalysisModal } from '@/components/inventory/InvoiceAnalysisModal'
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
    purchase:      'Compra',
    sale:          'Venta',
    adjustment:    'Ajuste',
    waste:         'Baja',
    return:        'Devolución',
    transfer_in:   'Traspaso entrada',
    transfer_out:  'Traspaso salida',
}
const MOVEMENT_COLORS: Record<string, string> = {
    purchase:     'text-emerald-600 bg-emerald-50',
    sale:         'text-primary-600 bg-primary-50',
    adjustment:   'text-amber-600 bg-amber-50',
    waste:        'text-red-600 bg-red-50',
    return:       'text-violet-600 bg-violet-50',
    transfer_in:  'text-sky-600 bg-sky-50',
    transfer_out: 'text-sky-600 bg-sky-50',
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
    batch_number: '', expiry_date: null, is_active: true, is_for_sale: true,
}

// ── Main Component ───────────────────────────────────────────────────
const Inventory = () => {
    const { profile, member } = useAuth()
    const clinicId = member?.clinic_id || profile?.clinic_id

    const [activeTab, setActiveTab] = useState<'catalog' | 'movements' | 'analysis'>('catalog')
    const [catalogView, setCatalogView] = useState<'products' | 'materials'>('products')
    const [products, setProducts] = useState<InventoryProduct[]>([])
    const [movements, setMovements] = useState<(InventoryMovement & { product_name?: string; location_name?: string })[]>([])
    const [abcData, setAbcData] = useState<AbcProduct[]>([])
    const [noRotation, setNoRotation] = useState<NoRotationProduct[]>([])
    const [stats, setStats] = useState({ total: 0, lowStock: 0, expiringSoon: 0, totalValue: 0 })
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')
    const [categoryFilter, setCategoryFilter] = useState<string>('all')
    const [movTypeFilter, setMovTypeFilter] = useState<string>('all')
    const [noRotDays, setNoRotDays] = useState(30)
    const [abcDays, setAbcDays] = useState(90)

    // ── Ubicaciones ────────────────────────────────────────────────────
    const [locations, setLocations] = useState<InventoryLocation[]>([])
    const [activeLocationId, setActiveLocationId] = useState<string | null>(null)
    const [locationStockMap, setLocationStockMap] = useState<Map<string, number>>(new Map())
    const [showLocationSettings, setShowLocationSettings] = useState(false)
    const [editingLocations, setEditingLocations] = useState<InventoryLocation[]>([])
    const [savingSettings, setSavingSettings] = useState(false)
    const [newLocName, setNewLocName] = useState('Vehículo')
    const [newLocType, setNewLocType] = useState<'warehouse' | 'vehicle'>('vehicle')
    const [addingLocation, setAddingLocation] = useState(false)

    // ── Transfer modal ─────────────────────────────────────────────────
    const [showTransferModal, setShowTransferModal] = useState(false)
    const [transferSearch, setTransferSearch] = useState('')
    const [transferProduct, setTransferProduct] = useState<InventoryProduct | null>(null)
    const [transferFromId, setTransferFromId] = useState<string | null>(null)
    const [transferToId, setTransferToId] = useState<string | null>(null)
    const [transferQty, setTransferQty] = useState(1)
    const [transferNotes, setTransferNotes] = useState('')
    const [transferring, setTransferring] = useState(false)

    // ── Product modal states ───────────────────────────────────────────
    const [showInvoiceModal, setShowInvoiceModal] = useState(false)
    const [showProductModal, setShowProductModal] = useState(false)
    const [editingProduct, setEditingProduct] = useState<InventoryProduct | null>(null)
    const [productForm, setProductForm] = useState(EMPTY_PRODUCT)
    const [showRestockModal, setShowRestockModal] = useState(false)
    const [restockProduct, setRestockProduct] = useState<InventoryProduct | null>(null)
    const [restockQty, setRestockQty] = useState(0)
    const [restockCost, setRestockCost] = useState(0)
    const [restockNotes, setRestockNotes] = useState('')
    const [restockDirection, setRestockDirection] = useState<'in' | 'out'>('in')
    const [restockOutType, setRestockOutType] = useState<'waste' | 'adjustment' | 'return'>('waste')
    const [saving, setSaving] = useState(false)

    const hasMultipleLocations = locations.length > 1
    const activeLocation = locations.find(l => l.id === activeLocationId) ?? null

    // ── Stock de la ubicación activa ───────────────────────────────────
    // Si el mapa está vacío (inventory_stock sin entradas para esta ubicación),
    // cae de vuelta al stock_quantity total del producto como medida de seguridad.
    const getLocStock = (p: InventoryProduct): number => {
        if (!locationStockMap.size) return p.stock_quantity
        return locationStockMap.get(p.id) ?? 0
    }

    // ── Stats calculados desde el mapa de ubicación ────────────────────
    const displayStats = useMemo(() => {
        if (!locationStockMap.size || !hasMultipleLocations) return stats
        const today = new Date()
        const in30 = new Date(today); in30.setDate(in30.getDate() + 30)
        const active = products.filter(p => p.is_active)
        return {
            total: active.length,
            lowStock: active.filter(p => getLocStock(p) <= p.min_stock_alert).length,
            expiringSoon: active.filter(p => {
                if (!p.expiry_date) return false
                const exp = new Date(p.expiry_date)
                return exp >= today && exp <= in30
            }).length,
            totalValue: active.reduce((sum, p) => sum + getLocStock(p) * p.purchase_price, 0),
        }
    }, [products, locationStockMap, stats, hasMultipleLocations])

    // ── Loaders ────────────────────────────────────────────────────────

    const loadLocations = useCallback(async () => {
        if (!clinicId) return
        let locs = await inventoryService.getLocations(clinicId)
        // Si la clínica no tiene ninguna ubicación, crearla automáticamente
        if (locs.length === 0) {
            await inventoryService.createLocation(clinicId, 'Inventario Principal', 'warehouse')
            await inventoryService.setActiveForSales(
                (await inventoryService.getLocations(clinicId))[0].id,
                clinicId
            )
            locs = await inventoryService.getLocations(clinicId)
        }
        setLocations(locs)
        if (locs.length > 0) {
            setActiveLocationId(prev => {
                if (prev && locs.find(l => l.id === prev)) return prev
                return (locs.find(l => l.is_active_for_sales) ?? locs[0]).id
            })
        }
    }, [clinicId])

    const loadLocationStock = useCallback(async () => {
        if (!activeLocationId) return
        const map = await inventoryService.getLocationStockMap(activeLocationId)
        setLocationStockMap(map)
    }, [activeLocationId])

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
        // Enriquecer movimientos con nombre de ubicación
        const enriched = data.map(m => ({
            ...m,
            location_name: locations.find(l => l.id === (m as any).location_id)?.name ?? undefined,
        }))
        setMovements(enriched)
    }, [clinicId, movTypeFilter, locations])

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
                await Promise.all([loadLocations(), loadProducts()])
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

    useEffect(() => {
        loadLocationStock()
    }, [activeLocationId])

    // ── Filtered products ──────────────────────────────────────────────

    const filteredProducts = products.filter(p => {
        const matchView = catalogView === 'products' ? p.is_for_sale !== false : p.is_for_sale === false
        const matchSearch = !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (p.sku ?? '').toLowerCase().includes(searchQuery.toLowerCase())
        const matchCat = categoryFilter === 'all' || p.category === categoryFilter
        return matchView && matchSearch && matchCat
    })

    const transferFilteredProducts = products.filter(p =>
        p.is_active && (!transferSearch || p.name.toLowerCase().includes(transferSearch.toLowerCase()))
    )

    // ── Handlers ───────────────────────────────────────────────────────

    const openCreate = () => {
        setEditingProduct(null)
        setProductForm({
            ...EMPTY_PRODUCT,
            clinic_id: clinicId ?? '',
            is_for_sale: catalogView === 'products',
        })
        setShowProductModal(true)
    }

    const openEdit = (p: InventoryProduct) => {
        setEditingProduct(p)
        setProductForm({ ...p })
        setShowProductModal(true)
    }

    const openRestock = (p: InventoryProduct) => {
        setRestockProduct(p)
        setRestockQty(0)
        setRestockCost(p.purchase_price)
        setRestockNotes('')
        setRestockDirection('in')
        setRestockOutType('waste')
        setShowRestockModal(true)
    }

    const handleSaveProduct = async () => {
        if (!productForm.name.trim()) return toast.error('El nombre es obligatorio')
        setSaving(true)
        try {
            const initialStock = productForm.stock_quantity
            if (editingProduct) {
                await inventoryService.updateProduct(editingProduct.id, productForm)
                toast.success('Producto actualizado')
            } else {
                // Crear con stock 0, luego insertar movimiento para la ubicación activa
                const created = await inventoryService.createProduct({
                    ...productForm,
                    stock_quantity: 0,
                    clinic_id: clinicId!,
                })
                if (initialStock > 0 && activeLocationId) {
                    await inventoryService.addMovement({
                        clinic_id:      clinicId!,
                        product_id:     created.id,
                        type:           'purchase',
                        quantity:       initialStock,
                        unit_cost:      productForm.purchase_price,
                        unit_price:     null,
                        appointment_id: null,
                        tutor_id:       null,
                        notes:          'Stock inicial',
                        created_by:     null,
                        location_id:    activeLocationId,
                    })
                }
                toast.success('Producto creado')
            }
            setShowProductModal(false)
            await Promise.all([loadProducts(), loadLocationStock()])
        } catch (e: any) {
            toast.error(e.message ?? 'Error al guardar')
        } finally {
            setSaving(false)
        }
    }

    const handleRestock = async () => {
        if (!restockProduct || restockQty <= 0) return
        const isOut = restockDirection === 'out'
        const finalQty = isOut ? -restockQty : restockQty
        const movType = isOut ? restockOutType : 'purchase'
        setSaving(true)
        try {
            await inventoryService.addMovement({
                clinic_id:      clinicId!,
                product_id:     restockProduct.id,
                type:           movType,
                quantity:       finalQty,
                unit_cost:      isOut ? null : restockCost,
                unit_price:     null,
                appointment_id: null,
                tutor_id:       null,
                notes:          restockNotes || null,
                created_by:     null,
                location_id:    activeLocationId ?? null,
            })
            const label = isOut
                ? `−${restockQty} ${UNIT_LABELS[restockProduct.unit]}(s) descontados`
                : `+${restockQty} ${UNIT_LABELS[restockProduct.unit]}(s) registrados`
            toast.success(label)
            setShowRestockModal(false)
            await Promise.all([loadProducts(), loadLocationStock()])
            if (activeTab === 'movements') await loadMovements()
        } catch (e: any) {
            toast.error(e.message ?? 'Error al registrar movimiento')
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async (p: InventoryProduct) => {
        if (!confirm(`¿Eliminar "${p.name}"? Esta acción no se puede deshacer.`)) return
        try {
            await inventoryService.deleteProduct(p.id)
            toast.success('Producto eliminado')
            await loadProducts()
        } catch (e: any) {
            toast.error(e.message ?? 'Error al eliminar')
        }
    }

    // ── Handlers de ubicaciones ────────────────────────────────────────

    const openLocationSettings = () => {
        setEditingLocations(locations.map(l => ({ ...l })))
        setShowLocationSettings(true)
    }

    const handleSaveLocationSettings = async () => {
        setSavingSettings(true)
        try {
            for (const loc of editingLocations) {
                await inventoryService.updateLocation(loc.id, { name: loc.name, type: loc.type })
            }
            const activeEditing = editingLocations.find(l => l.is_active_for_sales)
            if (activeEditing) {
                await inventoryService.setActiveForSales(activeEditing.id, clinicId!)
            }
            toast.success('Inventarios actualizados')
            setShowLocationSettings(false)
            await loadLocations()
        } catch (e: any) {
            toast.error(e.message ?? 'Error al guardar')
        } finally {
            setSavingSettings(false)
        }
    }

    const handleAddLocation = async () => {
        if (!newLocName.trim()) return toast.error('El nombre es obligatorio')
        setAddingLocation(true)
        try {
            await inventoryService.createLocation(clinicId!, newLocName.trim(), newLocType)
            toast.success(`"${newLocName}" creado`)
            setNewLocName('Vehículo')
            setNewLocType('vehicle')
            setShowLocationSettings(false)
            await loadLocations()
        } catch (e: any) {
            toast.error(e.message ?? 'Error al crear')
        } finally {
            setAddingLocation(false)
        }
    }

    // ── Transfer handler ───────────────────────────────────────────────

    const openTransfer = () => {
        if (locations.length < 2) return
        setTransferProduct(null)
        setTransferSearch('')
        setTransferQty(1)
        setTransferNotes('')
        // Por defecto: from = ubicación activa, to = la otra
        const other = locations.find(l => l.id !== activeLocationId)
        setTransferFromId(activeLocationId)
        setTransferToId(other?.id ?? null)
        setShowTransferModal(true)
    }

    const handleTransfer = async () => {
        if (!transferProduct || !transferFromId || !transferToId || transferQty <= 0) return
        setTransferring(true)
        try {
            await inventoryService.transferStock({
                clinicId:       clinicId!,
                productId:      transferProduct.id,
                fromLocationId: transferFromId,
                toLocationId:   transferToId,
                quantity:       transferQty,
                notes:          transferNotes || undefined,
            })
            toast.success(`Traspaso de ${transferQty} ${UNIT_LABELS[transferProduct.unit]}(s) realizado`)
            setShowTransferModal(false)
            await Promise.all([loadProducts(), loadLocationStock()])
            if (activeTab === 'movements') await loadMovements()
        } catch (e: any) {
            toast.error(e.message ?? 'Error al traspasar')
        } finally {
            setTransferring(false)
        }
    }

    const fromLocStock = transferProduct ? getLocStock(transferProduct) : 0

    // ── Stock badge ────────────────────────────────────────────────────

    const StockBadge = ({ p, locQty }: { p: InventoryProduct; locQty: number }) => {
        const today = new Date()
        const in30 = new Date(); in30.setDate(in30.getDate() + 30)
        const expiry = p.expiry_date ? new Date(p.expiry_date) : null
        const expired = expiry && expiry < today
        const expSoon = expiry && expiry >= today && expiry <= in30

        if (!p.is_active) return <span className="text-[10px] px-2 py-0.5 rounded-full bg-charcoal/10 text-charcoal/40">Archivado</span>
        if (expired)      return <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-600 font-bold">Vencido</span>
        if (locQty <= 0)  return <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-600 font-bold">Sin stock</span>
        if (locQty <= p.min_stock_alert) return <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">Bajo stock</span>
        if (expSoon)      return <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">Vence pronto</span>
        return <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600">OK</span>
    }

    // ── Render ─────────────────────────────────────────────────────────

    return (
        <div className="space-y-6 animate-fade-in">

            {/* Banner */}
            <div className="bg-gradient-to-br from-primary-500 to-primary-700 rounded-2xl overflow-hidden shadow-soft-md">
                <div className="p-5 sm:p-6 text-white flex flex-col gap-4">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-xs font-black uppercase tracking-widest text-primary-200 mb-1">Clínica</p>
                            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-white">
                                Inventario
                                {hasMultipleLocations && activeLocation && (
                                    <span className="ml-2 text-sm sm:text-base font-semibold text-primary-200">— {activeLocation.name}</span>
                                )}
                            </h1>
                            <p className="text-xs sm:text-sm text-primary-200 mt-1">Gestión de productos, stock y movimientos</p>
                        </div>
                        <button
                            onClick={() => setShowInvoiceModal(true)}
                            className="shrink-0 inline-flex items-center gap-1.5 bg-white/15 hover:bg-white/25 text-white text-xs font-bold px-3 py-1.5 rounded-xl transition-colors"
                        >
                            <Sparkles className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Analizar Factura con IA</span>
                            <span className="sm:hidden">Factura IA</span>
                        </button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-6 text-center">
                        <div className="bg-white/10 sm:bg-transparent rounded-xl sm:rounded-none p-2 sm:p-0">
                            <p className="text-xl sm:text-2xl font-extrabold">{displayStats.total}</p>
                            <p className="text-xs text-primary-200">Productos</p>
                        </div>
                        <div className="bg-white/10 sm:bg-transparent rounded-xl sm:rounded-none p-2 sm:p-0">
                            <p className={cn("text-xl sm:text-2xl font-extrabold", displayStats.lowStock > 0 ? "text-amber-300" : "text-white")}>{displayStats.lowStock}</p>
                            <p className="text-xs text-primary-200">Bajo stock</p>
                        </div>
                        <div className="bg-white/10 sm:bg-transparent rounded-xl sm:rounded-none p-2 sm:p-0">
                            <p className={cn("text-xl sm:text-2xl font-extrabold", displayStats.expiringSoon > 0 ? "text-amber-300" : "text-white")}>{displayStats.expiringSoon}</p>
                            <p className="text-xs text-primary-200">Vencen en 30d</p>
                        </div>
                        <div className="bg-white/10 sm:bg-transparent rounded-xl sm:rounded-none p-2 sm:p-0">
                            <p className="text-base sm:text-lg font-extrabold">{formatCLP(displayStats.totalValue)}</p>
                            <p className="text-xs text-primary-200">Inversión</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Selector de ubicaciones ── */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    {hasMultipleLocations ? (
                        <div className="flex gap-1 bg-silk-beige/40 p-1 rounded-xl border border-silk-beige">
                            {locations.map(loc => {
                                const Icon = loc.type === 'vehicle' ? Truck : Warehouse
                                return (
                                    <button
                                        key={loc.id}
                                        onClick={() => setActiveLocationId(loc.id)}
                                        className={cn(
                                            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all",
                                            activeLocationId === loc.id
                                                ? "bg-white text-primary-600 shadow-sm border border-silk-beige/50"
                                                : "text-charcoal/50 hover:text-charcoal"
                                        )}
                                    >
                                        <Icon className="w-4 h-4" />
                                        {loc.name}
                                        {loc.is_active_for_sales && (
                                            <span className="text-[9px] bg-emerald-100 text-emerald-700 font-black px-1.5 py-0.5 rounded-full">VENTAS</span>
                                        )}
                                    </button>
                                )
                            })}
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 text-sm text-charcoal/50">
                            <Warehouse className="w-4 h-4" />
                            <span>{locations[0]?.name ?? 'Inventario Principal'}</span>
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {hasMultipleLocations && (
                        <button
                            onClick={openTransfer}
                            className="flex items-center gap-2 px-4 py-2 bg-sky-50 border border-sky-200 text-sky-700 rounded-xl text-sm font-semibold hover:bg-sky-100 transition-colors"
                        >
                            <ArrowLeftRight className="w-4 h-4" />
                            Traspaso
                        </button>
                    )}
                    <button
                        onClick={openLocationSettings}
                        className="flex items-center gap-2 px-3 py-2 text-charcoal/50 hover:text-charcoal border border-silk-beige bg-white rounded-xl text-sm transition-colors"
                    >
                        <Settings className="w-4 h-4" />
                        {hasMultipleLocations ? 'Configurar inventarios' : 'Agregar 2do inventario'}
                    </button>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-silk-beige/40 p-1 rounded-xl border border-silk-beige w-full sm:w-fit overflow-x-auto no-scrollbar">
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
                    {/* Toggle Productos / Materiales */}
                    <div className="flex gap-1 bg-silk-beige/40 p-1 rounded-xl border border-silk-beige w-fit">
                        <button
                            onClick={() => setCatalogView('products')}
                            className={cn(
                                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all",
                                catalogView === 'products'
                                    ? "bg-white text-primary-600 shadow-sm border border-silk-beige/50"
                                    : "text-charcoal/50 hover:text-charcoal"
                            )}
                        >
                            <Package className="w-4 h-4" />
                            Productos
                            <span className="text-[10px] bg-primary-100 text-primary-600 px-1.5 py-0.5 rounded-full font-black">
                                {products.filter(p => p.is_for_sale !== false && p.is_active).length}
                            </span>
                        </button>
                        <button
                            onClick={() => setCatalogView('materials')}
                            className={cn(
                                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all",
                                catalogView === 'materials'
                                    ? "bg-white text-amber-600 shadow-sm border border-silk-beige/50"
                                    : "text-charcoal/50 hover:text-charcoal"
                            )}
                        >
                            <Wrench className="w-4 h-4" />
                            Materiales
                            <span className="text-[10px] bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full font-black">
                                {products.filter(p => p.is_for_sale === false && p.is_active).length}
                            </span>
                        </button>
                    </div>

                    {catalogView === 'materials' && (
                        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                            <Wrench className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                            <p className="text-sm text-amber-700">
                                Los <strong>materiales</strong> son insumos operativos (pinzas, termómetros, jeringas, etc.) que no se venden a clientes.
                                Puedes trackear su stock por ubicación y hacer traspasos igual que los productos.
                            </p>
                        </div>
                    )}

                    <div className="flex flex-col gap-2">
                        <div className="flex gap-2">
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal/40" />
                                <input
                                    className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-silk-beige rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-300"
                                    placeholder={catalogView === 'materials' ? 'Buscar material...' : 'Buscar producto...'}
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                />
                            </div>
                            <button
                                onClick={openCreate}
                                className={cn(
                                    "flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-colors shrink-0",
                                    catalogView === 'materials'
                                        ? "bg-amber-500 hover:bg-amber-600 text-white"
                                        : "bg-primary-500 hover:bg-primary-600 text-white"
                                )}
                            >
                                <Plus className="w-4 h-4" />
                                <span className="hidden sm:inline">{catalogView === 'materials' ? 'Nuevo material' : 'Nuevo producto'}</span>
                                <span className="sm:hidden">Nuevo</span>
                            </button>
                        </div>
                        <select
                            value={categoryFilter}
                            onChange={e => setCategoryFilter(e.target.value)}
                            className="w-full sm:w-auto text-sm bg-white border border-silk-beige rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-300"
                        >
                            <option value="all">Todas las categorías</option>
                            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                                <option key={k} value={k}>{v}</option>
                            ))}
                        </select>
                    </div>

                    {loading ? (
                        <div className="flex items-center justify-center py-16 text-charcoal/40">
                            <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Cargando...
                        </div>
                    ) : filteredProducts.length === 0 ? (
                        <div className="text-center py-16">
                            {catalogView === 'materials'
                                ? <Wrench className="w-10 h-10 text-charcoal/20 mx-auto mb-3" />
                                : <Package className="w-10 h-10 text-charcoal/20 mx-auto mb-3" />
                            }
                            <p className="text-charcoal/40 text-sm">
                                {searchQuery
                                    ? 'No hay resultados que coincidan'
                                    : catalogView === 'materials'
                                        ? 'Agrega tus primeros materiales operativos'
                                        : 'Agrega tu primer producto al catálogo'
                                }
                            </p>
                        </div>
                    ) : (<>
                        {/* ── Vista mobile: tarjetas ── */}
                        <div className="sm:hidden space-y-2">
                            {filteredProducts.map(p => {
                                const Icon = CATEGORY_ICONS[p.category] ?? Package
                                const locQty = getLocStock(p)
                                return (
                                    <div key={p.id} className="bg-white rounded-2xl border border-silk-beige p-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className="w-9 h-9 rounded-xl bg-primary-50 flex items-center justify-center shrink-0">
                                                    <Icon className="w-4 h-4 text-primary-500" />
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="font-semibold text-charcoal truncate">{p.name}</p>
                                                    <p className="text-xs text-charcoal/40">{CATEGORY_LABELS[p.category]}{p.sku ? ` · ${p.sku}` : ''}</p>
                                                </div>
                                            </div>
                                            <StockBadge p={p} locQty={locQty} />
                                        </div>
                                        <div className="mt-3 flex items-center justify-between">
                                            <div className="flex items-center gap-4 text-sm">
                                                <div>
                                                    <p className="text-xs text-charcoal/40 mb-0.5">Stock</p>
                                                    <p className={cn("font-bold text-base", locQty <= 0 ? "text-red-500" : locQty <= p.min_stock_alert ? "text-amber-600" : "text-charcoal")}>
                                                        {locQty} <span className="text-xs font-normal text-charcoal/40">{UNIT_LABELS[p.unit]}</span>
                                                    </p>
                                                </div>
                                                {catalogView === 'products' && (
                                                    <div>
                                                        <p className="text-xs text-charcoal/40 mb-0.5">P. Venta</p>
                                                        <p className="font-semibold text-charcoal">{formatCLP(p.sale_price)}</p>
                                                    </div>
                                                )}
                                                {p.expiry_date && (
                                                    <div>
                                                        <p className="text-xs text-charcoal/40 mb-0.5">Vence</p>
                                                        <p className="text-sm text-charcoal/60">{format(new Date(p.expiry_date), 'dd MMM yy', { locale: es })}</p>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <button onClick={() => openRestock(p)} className="p-2 hover:bg-emerald-50 text-charcoal/40 hover:text-emerald-600 rounded-xl transition-colors">
                                                    <ArrowDownCircle className="w-4 h-4" />
                                                </button>
                                                <button onClick={() => openEdit(p)} className="p-2 hover:bg-primary-50 text-charcoal/40 hover:text-primary-600 rounded-xl transition-colors">
                                                    <Edit2 className="w-4 h-4" />
                                                </button>
                                                <button onClick={() => handleDelete(p)} title="Eliminar producto" className="p-2 hover:bg-red-50 text-charcoal/40 hover:text-red-500 rounded-xl transition-colors">
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>

                        {/* ── Vista desktop: tabla ── */}
                        <div className="hidden sm:block bg-white rounded-2xl border border-silk-beige overflow-hidden">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-silk-beige bg-ivory">
                                        <th className="text-left px-4 py-3 text-xs font-black uppercase tracking-wider text-charcoal/40">Producto</th>
                                        <th className="text-left px-4 py-3 text-xs font-black uppercase tracking-wider text-charcoal/40">Categoría</th>
                                        <th className="text-right px-4 py-3 text-xs font-black uppercase tracking-wider text-charcoal/40">
                                            {hasMultipleLocations ? `Stock (${activeLocation?.name ?? ''})` : 'Stock'}
                                        </th>
                                        {hasMultipleLocations && (
                                            <th className="text-right px-4 py-3 text-xs font-black uppercase tracking-wider text-charcoal/40">Total</th>
                                        )}
                                        {catalogView === 'products' && (
                                            <th className="text-right px-4 py-3 text-xs font-black uppercase tracking-wider text-charcoal/40">P. Venta</th>
                                        )}
                                        <th className="text-left px-4 py-3 text-xs font-black uppercase tracking-wider text-charcoal/40">Vencimiento</th>
                                        <th className="text-left px-4 py-3 text-xs font-black uppercase tracking-wider text-charcoal/40">Estado</th>
                                        <th className="px-4 py-3" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-silk-beige/40">
                                    {filteredProducts.map(p => {
                                        const Icon = CATEGORY_ICONS[p.category] ?? Package
                                        const locQty = getLocStock(p)
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
                                                        locQty <= 0 ? "text-red-500" :
                                                        locQty <= p.min_stock_alert ? "text-amber-600" : "text-charcoal"
                                                    )}>
                                                        {locQty}
                                                    </span>
                                                    <span className="text-charcoal/40 text-xs ml-1">{UNIT_LABELS[p.unit]}</span>
                                                </td>
                                                {hasMultipleLocations && (
                                                    <td className="px-4 py-3 text-right text-charcoal/40 text-xs">
                                                        {p.stock_quantity} {UNIT_LABELS[p.unit]}
                                                    </td>
                                                )}
                                                {catalogView === 'products' && (
                                                    <td className="px-4 py-3 text-right font-semibold text-charcoal">
                                                        {formatCLP(p.sale_price)}
                                                    </td>
                                                )}
                                                <td className="px-4 py-3 text-sm text-charcoal/60">
                                                    {p.expiry_date
                                                        ? format(new Date(p.expiry_date), 'dd MMM yyyy', { locale: es })
                                                        : <span className="text-charcoal/30">—</span>}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <StockBadge p={p} locQty={locQty} />
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
                                                            onClick={() => handleDelete(p)}
                                                            title="Eliminar producto"
                                                            className="p-1.5 hover:bg-red-50 text-charcoal/40 hover:text-red-500 rounded-lg transition-colors"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </>)}
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
                                        {hasMultipleLocations && (
                                            <th className="text-left px-4 py-3 text-xs font-black uppercase tracking-wider text-charcoal/40">Ubicación</th>
                                        )}
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
                                                <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", MOVEMENT_COLORS[m.type] ?? 'text-charcoal/60 bg-charcoal/5')}>
                                                    {MOVEMENT_LABELS[m.type] ?? m.type}
                                                </span>
                                            </td>
                                            {hasMultipleLocations && (
                                                <td className="px-4 py-3 text-xs text-charcoal/50">
                                                    {(m as any).location_name ?? '—'}
                                                </td>
                                            )}
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

                    {/* Card explicativo ABC */}
                    <div className="bg-white rounded-2xl border border-silk-beige overflow-hidden">
                        <div className="p-5 border-b border-silk-beige">
                            <h3 className="font-bold text-charcoal">¿Qué es la clasificación ABC?</h3>
                            <p className="text-xs text-charcoal/50 mt-0.5">
                                Una forma simple de saber qué productos necesitas siempre disponibles — y cuáles puedes dejar en depósito.
                            </p>
                        </div>
                        <div className="p-5 space-y-3">
                            {/* Clase A */}
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                    <span className="w-7 h-7 rounded-full bg-emerald-500 text-white text-sm font-black flex items-center justify-center shrink-0">A</span>
                                    <div className="flex-1 min-w-0">
                                        <div className="h-8 bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-xl flex items-center px-3 w-full">
                                            <span className="text-white text-xs font-bold truncate">
                                                80% de tus ingresos · ~20% del catálogo → siempre en el vehículo
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                <p className="text-sm text-charcoal/60 shrink-0 w-36 text-right">Nunca deben faltar</p>
                            </div>
                            {/* Clase B */}
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                    <span className="w-7 h-7 rounded-full bg-amber-500 text-white text-sm font-black flex items-center justify-center shrink-0">B</span>
                                    <div className="flex-1 min-w-0">
                                        <div className="h-8 bg-gradient-to-r from-amber-500 to-amber-400 rounded-xl flex items-center px-3" style={{ width: '55%' }}>
                                            <span className="text-white text-xs font-bold truncate">
                                                15% · Stock razonable
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                <p className="text-sm text-charcoal/60 shrink-0 w-36 text-right">Llevar según agenda</p>
                            </div>
                            {/* Clase C */}
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                    <span className="w-7 h-7 rounded-full bg-red-400 text-white text-sm font-black flex items-center justify-center shrink-0">C</span>
                                    <div className="flex-1 min-w-0">
                                        <div className="h-8 bg-gradient-to-r from-red-400 to-red-300 rounded-xl flex items-center px-3" style={{ width: '20%' }}>
                                            <span className="text-white text-xs font-bold">5%</span>
                                        </div>
                                    </div>
                                </div>
                                <p className="text-sm text-charcoal/60 shrink-0 w-36 text-right">Guardar en sede</p>
                            </div>

                            <p className="text-xs text-charcoal/40 pt-1 border-t border-silk-beige mt-3">
                                💡 <strong>Cómo usarlo:</strong> los productos A y B conviene tenerlos en el vehículo.
                                Los C pueden quedarse en la sede y llevarse solo si hay una cita que los requiera.
                            </p>
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl border border-silk-beige overflow-hidden">
                        <div className="p-5 border-b border-silk-beige flex items-center justify-between">
                            <div>
                                <h3 className="font-bold text-charcoal">Clasificación ABC</h3>
                                <p className="text-xs text-charcoal/50 mt-0.5">A = 80% ingresos · B = 15% · C = 5%</p>
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

            {/* ══════════════════════════════════════════════════════════
                MODAL: Configurar inventarios
            ══════════════════════════════════════════════════════════ */}
            {showLocationSettings && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
                        <div className="flex items-center justify-between p-5 border-b border-silk-beige">
                            <h2 className="font-bold text-charcoal text-lg">Configurar inventarios</h2>
                            <button onClick={() => setShowLocationSettings(false)} className="p-1.5 hover:bg-silk-beige rounded-lg">
                                <X className="w-5 h-5 text-charcoal/60" />
                            </button>
                        </div>

                        <div className="p-5 space-y-4">
                            {/* Ubicaciones existentes */}
                            {editingLocations.map((loc, idx) => {
                                const LocIcon = loc.type === 'vehicle' ? Truck : Warehouse
                                return (
                                    <div key={loc.id} className="border border-silk-beige rounded-xl p-4 space-y-3">
                                        <div className="flex items-center gap-2">
                                            <LocIcon className="w-4 h-4 text-charcoal/50" />
                                            <span className="text-xs font-black uppercase tracking-wider text-charcoal/40">
                                                {idx === 0 ? 'Inventario principal' : 'Inventario secundario'}
                                            </span>
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-charcoal/60 uppercase tracking-wider">Nombre</label>
                                            <input
                                                className="mt-1 w-full px-3 py-2 border border-silk-beige rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
                                                value={loc.name}
                                                onChange={e => setEditingLocations(prev =>
                                                    prev.map(l => l.id === loc.id ? { ...l, name: e.target.value } : l)
                                                )}
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-charcoal/60 uppercase tracking-wider">Tipo</label>
                                            <div className="flex gap-2 mt-1">
                                                {([
                                                    { value: 'warehouse', label: 'Bodega / Sede', icon: Warehouse },
                                                    { value: 'vehicle', label: 'Vehículo', icon: Truck },
                                                ] as const).map(opt => (
                                                    <button
                                                        key={opt.value}
                                                        onClick={() => setEditingLocations(prev =>
                                                            prev.map(l => l.id === loc.id ? { ...l, type: opt.value } : l)
                                                        )}
                                                        className={cn(
                                                            "flex-1 flex items-center justify-center gap-2 py-2 rounded-xl border text-sm font-semibold transition-all",
                                                            loc.type === opt.value
                                                                ? "border-primary-400 bg-primary-50 text-primary-700"
                                                                : "border-silk-beige text-charcoal/50 hover:border-charcoal/20"
                                                        )}
                                                    >
                                                        <opt.icon className="w-4 h-4" />
                                                        {opt.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-between pt-1">
                                            <div>
                                                <p className="text-sm font-semibold text-charcoal">Activo para ventas</p>
                                                <p className="text-xs text-charcoal/50">Los productos se descuentan de este inventario al cerrar una visita</p>
                                            </div>
                                            <button
                                                onClick={() => setEditingLocations(prev =>
                                                    prev.map(l => ({ ...l, is_active_for_sales: l.id === loc.id }))
                                                )}
                                                className={cn(
                                                    "relative w-12 h-6 rounded-full transition-colors shrink-0",
                                                    loc.is_active_for_sales ? "bg-emerald-500" : "bg-charcoal/20"
                                                )}
                                            >
                                                <span className={cn(
                                                    "absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform",
                                                    loc.is_active_for_sales ? "translate-x-6" : "translate-x-0.5"
                                                )} />
                                            </button>
                                        </div>
                                    </div>
                                )
                            })}

                            {/* Agregar 2do inventario (solo si hay 1) */}
                            {editingLocations.length < 2 && (
                                <div className="border border-dashed border-silk-beige rounded-xl p-4 space-y-3">
                                    <p className="text-sm font-bold text-charcoal flex items-center gap-2">
                                        <Plus className="w-4 h-4" /> Agregar 2do inventario
                                    </p>
                                    <div>
                                        <label className="text-xs font-bold text-charcoal/60 uppercase tracking-wider">Nombre</label>
                                        <input
                                            className="mt-1 w-full px-3 py-2 border border-silk-beige rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
                                            value={newLocName}
                                            onChange={e => setNewLocName(e.target.value)}
                                            placeholder="Ej: Vehículo, Maletín, Sucursal 2"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-charcoal/60 uppercase tracking-wider">Tipo</label>
                                        <div className="flex gap-2 mt-1">
                                            {([
                                                { value: 'warehouse', label: 'Bodega / Sede', icon: Warehouse },
                                                { value: 'vehicle', label: 'Vehículo', icon: Truck },
                                            ] as const).map(opt => (
                                                <button
                                                    key={opt.value}
                                                    onClick={() => setNewLocType(opt.value)}
                                                    className={cn(
                                                        "flex-1 flex items-center justify-center gap-2 py-2 rounded-xl border text-sm font-semibold transition-all",
                                                        newLocType === opt.value
                                                            ? "border-primary-400 bg-primary-50 text-primary-700"
                                                            : "border-silk-beige text-charcoal/50 hover:border-charcoal/20"
                                                    )}
                                                >
                                                    <opt.icon className="w-4 h-4" />
                                                    {opt.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <button
                                        onClick={handleAddLocation}
                                        disabled={addingLocation || !newLocName.trim()}
                                        className="w-full py-2.5 bg-primary-500 text-white rounded-xl text-sm font-semibold hover:bg-primary-600 disabled:opacity-50 transition-colors"
                                    >
                                        {addingLocation ? 'Creando...' : `Crear "${newLocName || 'inventario'}"`}
                                    </button>
                                </div>
                            )}

                            {editingLocations.length >= 2 && (
                                <p className="text-xs text-charcoal/40 text-center">
                                    Límite: máximo 2 inventarios por clínica
                                </p>
                            )}
                        </div>

                        {editingLocations.length > 0 && (
                            <div className="flex justify-end gap-3 p-5 border-t border-silk-beige">
                                <button onClick={() => setShowLocationSettings(false)} className="px-4 py-2 text-sm font-semibold text-charcoal/60 border border-silk-beige rounded-xl">
                                    Cancelar
                                </button>
                                <button
                                    onClick={handleSaveLocationSettings}
                                    disabled={savingSettings}
                                    className="px-5 py-2 text-sm font-semibold bg-primary-500 text-white rounded-xl hover:bg-primary-600 disabled:opacity-50"
                                >
                                    {savingSettings ? 'Guardando...' : 'Guardar cambios'}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ══════════════════════════════════════════════════════════
                MODAL: Traspaso entre inventarios
            ══════════════════════════════════════════════════════════ */}
            {showTransferModal && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
                        <div className="flex items-center justify-between p-5 border-b border-silk-beige">
                            <h2 className="font-bold text-charcoal text-lg flex items-center gap-2">
                                <ArrowLeftRight className="w-5 h-5 text-sky-500" />
                                Traspaso de inventario
                            </h2>
                            <button onClick={() => setShowTransferModal(false)} className="p-1.5 hover:bg-silk-beige rounded-lg">
                                <X className="w-5 h-5 text-charcoal/60" />
                            </button>
                        </div>
                        <div className="p-5 space-y-4">

                            {/* Dirección del traspaso */}
                            <div>
                                <label className="text-xs font-bold text-charcoal/60 uppercase tracking-wider">Dirección</label>
                                <div className="mt-1 flex items-center gap-3">
                                    <select
                                        className="flex-1 px-3 py-2 border border-silk-beige rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                                        value={transferFromId ?? ''}
                                        onChange={e => {
                                            const fromId = e.target.value
                                            setTransferFromId(fromId)
                                            setTransferToId(locations.find(l => l.id !== fromId)?.id ?? null)
                                        }}
                                    >
                                        {locations.map(l => (
                                            <option key={l.id} value={l.id}>{l.name}</option>
                                        ))}
                                    </select>
                                    <ChevronRight className="w-5 h-5 text-charcoal/40 shrink-0" />
                                    <div className="flex-1 px-3 py-2 border border-silk-beige rounded-xl text-sm bg-ivory text-charcoal/70">
                                        {locations.find(l => l.id === transferToId)?.name ?? '—'}
                                    </div>
                                </div>
                            </div>

                            {/* Búsqueda de producto */}
                            <div>
                                <label className="text-xs font-bold text-charcoal/60 uppercase tracking-wider">Producto</label>
                                {transferProduct ? (
                                    <div className="mt-1 flex items-center justify-between bg-sky-50 border border-sky-200 rounded-xl px-3 py-2">
                                        <div>
                                            <p className="font-semibold text-sky-800 text-sm">{transferProduct.name}</p>
                                            <p className="text-xs text-sky-600">
                                                Stock en origen: {fromLocStock} {UNIT_LABELS[transferProduct.unit]}(s)
                                            </p>
                                        </div>
                                        <button onClick={() => setTransferProduct(null)} className="text-sky-400 hover:text-sky-600">
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>
                                ) : (
                                    <div className="mt-1 relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal/40" />
                                        <input
                                            className="w-full pl-9 pr-3 py-2 border border-silk-beige rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                                            placeholder="Buscar producto..."
                                            value={transferSearch}
                                            onChange={e => setTransferSearch(e.target.value)}
                                        />
                                        {transferSearch && (
                                            <div className="absolute top-full mt-1 left-0 right-0 bg-white border border-silk-beige rounded-xl shadow-lg z-10 max-h-48 overflow-y-auto">
                                                {transferFilteredProducts.length === 0 ? (
                                                    <p className="px-4 py-3 text-sm text-charcoal/40">Sin resultados</p>
                                                ) : transferFilteredProducts.map(p => (
                                                    <button
                                                        key={p.id}
                                                        onClick={() => {
                                                            setTransferProduct(p)
                                                            setTransferSearch('')
                                                            setTransferQty(1)
                                                        }}
                                                        className="w-full text-left px-4 py-2.5 hover:bg-sky-50 flex items-center justify-between"
                                                    >
                                                        <span className="text-sm font-medium text-charcoal">{p.name}</span>
                                                        <span className="text-xs text-charcoal/40">
                                                            {locationStockMap.get(p.id) ?? 0} {UNIT_LABELS[p.unit]}
                                                        </span>
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Cantidad */}
                            <div>
                                <label className="text-xs font-bold text-charcoal/60 uppercase tracking-wider">Cantidad a traspasar</label>
                                <input
                                    type="number" min="1"
                                    max={fromLocStock || undefined}
                                    className="mt-1 w-full px-3 py-2 border border-silk-beige rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                                    value={transferQty || ''}
                                    placeholder="1"
                                    onChange={e => setTransferQty(Number(e.target.value) || 1)}
                                />
                                {transferProduct && transferQty > fromLocStock && (
                                    <p className="text-xs text-red-500 mt-1">⚠ Stock insuficiente en origen ({fromLocStock} disponible)</p>
                                )}
                            </div>

                            {/* Notas */}
                            <div>
                                <label className="text-xs font-bold text-charcoal/60 uppercase tracking-wider">Notas (opcional)</label>
                                <input
                                    className="mt-1 w-full px-3 py-2 border border-silk-beige rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                                    value={transferNotes}
                                    onChange={e => setTransferNotes(e.target.value)}
                                    placeholder="Motivo del traspaso..."
                                />
                            </div>

                            {/* Preview */}
                            {transferProduct && (
                                <div className="bg-sky-50 border border-sky-200 rounded-xl p-3 text-sm">
                                    <p className="text-sky-700 font-medium">
                                        {fromLocStock >= transferQty
                                            ? `Quedarán ${fromLocStock - transferQty} ${UNIT_LABELS[transferProduct.unit]}(s) en ${locations.find(l => l.id === transferFromId)?.name}`
                                            : '⚠ Stock insuficiente para realizar el traspaso'
                                        }
                                    </p>
                                </div>
                            )}
                        </div>

                        <div className="flex justify-end gap-3 p-5 border-t border-silk-beige">
                            <button onClick={() => setShowTransferModal(false)} className="px-4 py-2 text-sm font-semibold text-charcoal/60 border border-silk-beige rounded-xl">
                                Cancelar
                            </button>
                            <button
                                onClick={handleTransfer}
                                disabled={transferring || !transferProduct || !transferFromId || !transferToId || transferQty <= 0 || transferQty > fromLocStock}
                                className="px-5 py-2 text-sm font-semibold bg-sky-500 text-white rounded-xl hover:bg-sky-600 disabled:opacity-50 flex items-center gap-2"
                            >
                                <ArrowLeftRight className="w-4 h-4" />
                                {transferring ? 'Traspasando...' : 'Confirmar traspaso'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ══════════════════════════════════════════════════════════
                MODAL: Crear / Editar producto
            ══════════════════════════════════════════════════════════ */}
            {showProductModal && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between p-5 border-b border-silk-beige">
                            <div>
                                <h2 className="font-bold text-charcoal text-lg">
                                    {editingProduct ? 'Editar producto' : 'Nuevo producto'}
                                </h2>
                                {!editingProduct && activeLocation && (
                                    <p className="text-xs text-charcoal/50 mt-0.5">
                                        El stock inicial se asignará a: <strong>{activeLocation.name}</strong>
                                    </p>
                                )}
                            </div>
                            <button onClick={() => setShowProductModal(false)} className="p-1.5 hover:bg-silk-beige rounded-lg">
                                <X className="w-5 h-5 text-charcoal/60" />
                            </button>
                        </div>
                        <div className="p-5 space-y-4">
                            {/* Toggle Producto / Material */}
                            {!editingProduct && (
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setProductForm(f => ({ ...f, is_for_sale: true }))}
                                        className={cn(
                                            "flex-1 py-2.5 rounded-xl border text-sm font-semibold transition-all flex items-center justify-center gap-2",
                                            productForm.is_for_sale !== false
                                                ? "border-primary-400 bg-primary-50 text-primary-700"
                                                : "border-silk-beige text-charcoal/50 hover:border-charcoal/20"
                                        )}
                                    >
                                        <Package className="w-4 h-4" /> Producto (para venta)
                                    </button>
                                    <button
                                        onClick={() => setProductForm(f => ({ ...f, is_for_sale: false }))}
                                        className={cn(
                                            "flex-1 py-2.5 rounded-xl border text-sm font-semibold transition-all flex items-center justify-center gap-2",
                                            productForm.is_for_sale === false
                                                ? "border-amber-400 bg-amber-50 text-amber-700"
                                                : "border-silk-beige text-charcoal/50 hover:border-charcoal/20"
                                        )}
                                    >
                                        <Wrench className="w-4 h-4" /> Material operativo
                                    </button>
                                </div>
                            )}
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
                                {productForm.is_for_sale !== false && (
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
                                )}
                                <div>
                                    <label className="text-xs font-bold text-charcoal/60 uppercase tracking-wider">
                                        {editingProduct ? 'Stock actual' : `Stock inicial (en ${activeLocation?.name ?? 'inventario'})`}
                                    </label>
                                    <input
                                        type="number" min="0"
                                        className="mt-1 w-full px-3 py-2 border border-silk-beige rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
                                        value={productForm.stock_quantity || ''}
                                        placeholder="0"
                                        onChange={e => setProductForm(f => ({ ...f, stock_quantity: Number(e.target.value) || 0 }))}
                                        readOnly={!!editingProduct}
                                        title={editingProduct ? 'Usa el botón Ajuste de stock para modificar el stock' : undefined}
                                    />
                                    {editingProduct && (
                                        <p className="text-[11px] text-charcoal/40 mt-0.5">Para ajustar stock usa el botón ↓ Ajuste en el catálogo</p>
                                    )}
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

            {/* ══════════════════════════════════════════════════════════
                MODAL: Ajuste de stock
            ══════════════════════════════════════════════════════════ */}
            {showRestockModal && restockProduct && (() => {
                const isOut = restockDirection === 'out'
                const currentLocStock = getLocStock(restockProduct)
                const stockAfter = currentLocStock + (isOut ? -restockQty : restockQty)
                const belowZero = stockAfter < 0
                const belowMin = stockAfter >= 0 && stockAfter <= restockProduct.min_stock_alert
                return (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
                        <div className="flex items-center justify-between p-5 border-b border-silk-beige">
                            <div>
                                <h2 className="font-bold text-charcoal text-lg">Ajuste de stock</h2>
                                {activeLocation && (
                                    <p className="text-xs text-charcoal/50">En: {activeLocation.name}</p>
                                )}
                            </div>
                            <button onClick={() => setShowRestockModal(false)} className="p-1.5 hover:bg-silk-beige rounded-lg">
                                <X className="w-5 h-5 text-charcoal/60" />
                            </button>
                        </div>
                        <div className="p-5 space-y-4">
                            <div className={cn("rounded-xl p-3", isOut ? "bg-red-50" : "bg-primary-50")}>
                                <p className={cn("font-semibold", isOut ? "text-red-700" : "text-primary-700")}>{restockProduct.name}</p>
                                <p className={cn("text-sm", isOut ? "text-red-500" : "text-primary-500")}>
                                    Stock actual: <strong>{currentLocStock}</strong> {UNIT_LABELS[restockProduct.unit]}(s)
                                    {hasMultipleLocations && <span className="text-xs opacity-70"> (en {activeLocation?.name})</span>}
                                </p>
                            </div>

                            <div>
                                <label className="text-xs font-bold text-charcoal/60 uppercase tracking-wider mb-2 block">Tipo de movimiento</label>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        onClick={() => setRestockDirection('in')}
                                        className={cn(
                                            "flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-semibold transition-all",
                                            !isOut ? "border-emerald-400 bg-emerald-50 text-emerald-700" : "border-silk-beige text-charcoal/50 hover:border-charcoal/20"
                                        )}
                                    >
                                        <ArrowDownCircle className="w-4 h-4" /> Ingreso (+)
                                    </button>
                                    <button
                                        onClick={() => setRestockDirection('out')}
                                        className={cn(
                                            "flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-semibold transition-all",
                                            isOut ? "border-red-400 bg-red-50 text-red-700" : "border-silk-beige text-charcoal/50 hover:border-charcoal/20"
                                        )}
                                    >
                                        <ArrowUpCircle className="w-4 h-4" /> Baja (−)
                                    </button>
                                </div>
                            </div>

                            {isOut && (
                                <div>
                                    <label className="text-xs font-bold text-charcoal/60 uppercase tracking-wider">Motivo de baja</label>
                                    <select
                                        className="mt-1 w-full px-3 py-2 border border-silk-beige rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
                                        value={restockOutType}
                                        onChange={e => setRestockOutType(e.target.value as any)}
                                    >
                                        <option value="waste">Merma / Vencimiento</option>
                                        <option value="adjustment">Ajuste de inventario</option>
                                        <option value="return">Devolución a proveedor</option>
                                    </select>
                                </div>
                            )}

                            <div>
                                <label className="text-xs font-bold text-charcoal/60 uppercase tracking-wider">
                                    {isOut ? 'Cantidad a descontar' : 'Cantidad a ingresar'}
                                </label>
                                <input
                                    type="number" min="1"
                                    className={cn(
                                        "mt-1 w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2",
                                        isOut ? "border-red-200 focus:ring-red-300" : "border-silk-beige focus:ring-primary-300"
                                    )}
                                    value={restockQty || ''}
                                    placeholder="0"
                                    onChange={e => setRestockQty(Number(e.target.value) || 0)}
                                />
                            </div>

                            {!isOut && (
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
                            )}

                            <div>
                                <label className="text-xs font-bold text-charcoal/60 uppercase tracking-wider">Notas</label>
                                <input
                                    className="mt-1 w-full px-3 py-2 border border-silk-beige rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
                                    value={restockNotes}
                                    onChange={e => setRestockNotes(e.target.value)}
                                    placeholder={isOut ? "Motivo, lote afectado, etc." : "Proveedor, factura, etc."}
                                />
                            </div>

                            <div className={cn(
                                "rounded-xl p-3 text-sm",
                                belowZero ? "bg-red-100" : belowMin ? "bg-amber-50" : isOut ? "bg-red-50" : "bg-emerald-50"
                            )}>
                                <p className={cn(
                                    "font-medium",
                                    belowZero ? "text-red-700" : belowMin ? "text-amber-700" : isOut ? "text-red-700" : "text-emerald-700"
                                )}>
                                    Stock después del movimiento:{' '}
                                    <strong>{stockAfter} {UNIT_LABELS[restockProduct.unit]}(s)</strong>
                                    {belowZero && ' ⚠ Stock quedaría negativo'}
                                    {belowMin && !belowZero && ' ⚠ Por debajo del mínimo'}
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
                                className={cn(
                                    "px-5 py-2 text-sm font-semibold text-white rounded-xl disabled:opacity-50 flex items-center gap-2",
                                    isOut ? "bg-red-500 hover:bg-red-600" : "bg-emerald-500 hover:bg-emerald-600"
                                )}
                            >
                                {isOut ? <ArrowUpCircle className="w-4 h-4" /> : <ArrowDownCircle className="w-4 h-4" />}
                                {saving ? 'Registrando...' : isOut ? `Descontar −${restockQty}` : `Registrar +${restockQty}`}
                            </button>
                        </div>
                    </div>
                </div>
                )
            })()}

            {/* Modal análisis de factura IA */}
            {showInvoiceModal && clinicId && (
                <InvoiceAnalysisModal
                    clinicId={clinicId}
                    currency="CLP"
                    onClose={() => setShowInvoiceModal(false)}
                    onSuccess={() => Promise.all([loadProducts(), loadLocationStock()])}
                />
            )}
        </div>
    )
}

export default Inventory
