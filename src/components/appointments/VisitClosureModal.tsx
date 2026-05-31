import { useState, useEffect, useRef } from 'react'
import {
    X, Plus, Trash2, Search, Package, ShoppingCart,
    CreditCard, Banknote, Smartphone, CheckCircle2, Percent, Tag,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { inventoryService, type InventoryProduct, type VisitItem } from '@/services/inventoryService'
import { cn } from '@/lib/utils'
import { toast } from 'react-hot-toast'

interface VisitClosureModalProps {
    appointment: {
        id: string
        patient_name?: string
        tutor_name?: string
        phone_number?: string
        service?: string
        price?: number
        tutor_id?: string | null
    }
    clinicId: string
    onSaved: (appointmentId: string) => void
    onCancel: () => void
}

const PAYMENT_METHODS = [
    { value: 'efectivo', label: 'Efectivo', icon: Banknote },
    { value: 'transferencia', label: 'Transferencia', icon: Smartphone },
    { value: 'tarjeta', label: 'Tarjeta', icon: CreditCard },
    { value: 'debito', label: 'Débito', icon: CreditCard },
]

const VisitClosureModal = ({ appointment, clinicId, onSaved, onCancel }: VisitClosureModalProps) => {
    const [items, setItems] = useState<VisitItem[]>([])
    const [products, setProducts] = useState<InventoryProduct[]>([])
    const [paymentMethod, setPaymentMethod] = useState('efectivo')
    const [paymentStatus, setPaymentStatus] = useState<'paid' | 'pending'>('paid')
    const [showProductSearch, setShowProductSearch] = useState(false)
    const [productSearch, setProductSearch] = useState('')
    const [saving, setSaving] = useState(false)
    const [currency, setCurrency] = useState('CLP')
    const [activeLocationId, setActiveLocationId] = useState<string | null>(null)
    // Descuento
    const [discountType, setDiscountType] = useState<'fixed' | 'percentage'>('fixed')
    const [discountValue, setDiscountValue] = useState<number>(0)
    const [discountReason, setDiscountReason] = useState<string>('')
    const searchRef = useRef<HTMLDivElement>(null)

    const formatMoney = (n: number) =>
        new Intl.NumberFormat('es-CL', {
            style: 'currency',
            currency,
            maximumFractionDigits: currency === 'CLP' ? 0 : 2,
        }).format(n)

    // Carga productos, servicio pre-cargado y moneda de la clínica
    useEffect(() => {
        inventoryService.getProducts(clinicId).catch(() => {}).then(p => { if (p) setProducts(p) })

        // Ubicación activa para ventas (para descontar el inventario correcto)
        inventoryService.getActiveForSalesLocation(clinicId)
            .then(loc => { if (loc) setActiveLocationId(loc.id) })
            .catch(() => {})

        // Moneda de la clínica
        ;(supabase as any)
            .from('clinic_settings')
            .select('currency')
            .eq('id', clinicId)
            .single()
            .then(({ data }: any) => { if (data?.currency) setCurrency(data.currency) })

        if (appointment.service) {
            setItems([{
                id: crypto.randomUUID(),
                item_type: 'service',
                name: appointment.service,
                quantity: 1,
                unit_price: appointment.price ?? 0,
                subtotal: appointment.price ?? 0,
            }])
        }
    }, [clinicId, appointment.service, appointment.price])

    // Cierra el buscador al hacer clic fuera
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
                setShowProductSearch(false)
            }
        }
        if (showProductSearch) document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [showProductSearch])

    const subtotal = items.reduce((sum, i) => sum + i.subtotal, 0)
    const discountAmount = discountType === 'percentage'
        ? Math.round(subtotal * discountValue / 100)
        : discountValue
    const finalTotal = Math.max(0, subtotal - discountAmount)

    // ── Item handlers ──────────────────────────────────────────────────

    const updateItem = (id: string, field: keyof VisitItem, value: any) => {
        setItems(prev => prev.map(item => {
            if (item.id !== id) return item
            const updated = { ...item, [field]: value }
            if (field === 'quantity' || field === 'unit_price') {
                updated.subtotal = Number(updated.quantity) * Number(updated.unit_price)
            }
            return updated
        }))
    }

    const removeItem = (id: string) => setItems(prev => prev.filter(i => i.id !== id))

    const addProduct = (product: InventoryProduct) => {
        const existing = items.find(i => i.product_id === product.id)
        if (existing) {
            updateItem(existing.id, 'quantity', existing.quantity + 1)
        } else {
            setItems(prev => [...prev, {
                id: crypto.randomUUID(),
                item_type: 'product',
                name: product.name,
                quantity: 1,
                unit_price: product.sale_price,
                subtotal: product.sale_price,
                product_id: product.id,
            }])
        }
        setProductSearch('')
        setShowProductSearch(false)
    }

    // ── Save ───────────────────────────────────────────────────────────

    const handleSave = async () => {
        if (items.length === 0) {
            toast.error('Agrega al menos un servicio o producto')
            return
        }
        setSaving(true)
        try {
            await inventoryService.closeVisit({
                appointmentId:  appointment.id,
                clinicId,
                items,
                discount:       discountAmount,
                discountReason: discountReason.trim() || undefined,
                finalTotal,
                paymentMethod,
                paymentStatus,
                tutorId:        appointment.tutor_id ?? null,
                locationId:     activeLocationId,
            })
            toast.success(paymentStatus === 'paid' ? '¡Visita cerrada y cobro registrado!' : 'Visita cerrada — pago pendiente')
            onSaved(appointment.id)
        } catch (e: any) {
            toast.error(e.message ?? 'Error al guardar')
        } finally {
            setSaving(false)
        }
    }

    const filteredProducts = products.filter(p =>
        !productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase())
    ).slice(0, 8)

    // ── Render ─────────────────────────────────────────────────────────

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-silk-beige shrink-0">
                    <div>
                        <h2 className="text-lg font-bold text-charcoal">Cierre de visita</h2>
                        <p className="text-sm text-charcoal/50 mt-0.5">
                            {appointment.patient_name}
                            {appointment.tutor_name && <span> — {appointment.tutor_name}</span>}
                        </p>
                    </div>
                    <button onClick={onCancel} className="p-1.5 hover:bg-silk-beige rounded-lg transition-colors">
                        <X className="w-5 h-5 text-charcoal/60" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-5 space-y-5">

                    {/* Items */}
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-bold text-charcoal uppercase tracking-wider">Servicios y productos</h3>
                            <div ref={searchRef} className="relative">
                                <button
                                    onClick={() => setShowProductSearch(v => !v)}
                                    className="flex items-center gap-1.5 text-xs font-semibold text-primary-600 hover:text-primary-700 bg-primary-50 hover:bg-primary-100 px-3 py-1.5 rounded-lg transition-colors"
                                >
                                    <Plus className="w-3.5 h-3.5" /> Agregar producto
                                </button>
                                {showProductSearch && (
                                    <div className="absolute right-0 top-full mt-1 w-72 bg-white border border-silk-beige rounded-xl shadow-xl z-50">
                                        <div className="p-2 border-b border-silk-beige">
                                            <div className="relative">
                                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-charcoal/40" />
                                                <input
                                                    autoFocus
                                                    className="w-full pl-8 pr-3 py-1.5 text-sm bg-ivory border border-silk-beige rounded-lg focus:outline-none"
                                                    placeholder="Buscar producto..."
                                                    value={productSearch}
                                                    onChange={e => setProductSearch(e.target.value)}
                                                />
                                            </div>
                                        </div>
                                        <div className="max-h-48 overflow-y-auto">
                                            {filteredProducts.length === 0 ? (
                                                <p className="text-xs text-charcoal/40 text-center py-4">Sin productos en el catálogo</p>
                                            ) : filteredProducts.map(p => (
                                                <button
                                                    key={p.id}
                                                    onClick={() => addProduct(p)}
                                                    className="w-full flex items-center justify-between px-3 py-2 hover:bg-ivory text-left transition-colors"
                                                >
                                                    <div>
                                                        <p className="text-sm font-medium text-charcoal">{p.name}</p>
                                                        <p className="text-xs text-charcoal/40">
                                                            Stock: {p.stock_quantity}
                                                            {p.stock_quantity <= p.min_stock_alert && (
                                                                <span className="ml-1 text-amber-500">⚠ bajo</span>
                                                            )}
                                                        </p>
                                                    </div>
                                                    <span className="text-sm font-semibold text-primary-600">{formatMoney(p.sale_price)}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="space-y-2">
                            {items.length === 0 && (
                                <div className="text-center py-8 border-2 border-dashed border-silk-beige rounded-xl">
                                    <ShoppingCart className="w-8 h-8 text-charcoal/20 mx-auto mb-2" />
                                    <p className="text-sm text-charcoal/40">No hay ítems. Agrega el servicio realizado.</p>
                                </div>
                            )}
                            {items.map(item => (
                                <div
                                    key={item.id}
                                    className={cn(
                                        "flex items-center gap-3 p-3 rounded-xl border",
                                        item.item_type === 'service'
                                            ? "bg-primary-50/50 border-primary-100"
                                            : "bg-violet-50/50 border-violet-100"
                                    )}
                                >
                                    <div className={cn(
                                        "w-7 h-7 rounded-lg flex items-center justify-center shrink-0",
                                        item.item_type === 'service' ? "bg-primary-100" : "bg-violet-100"
                                    )}>
                                        {item.item_type === 'service'
                                            ? <CheckCircle2 className="w-4 h-4 text-primary-600" />
                                            : <Package className="w-4 h-4 text-violet-600" />
                                        }
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-charcoal truncate">{item.name}</p>
                                        <span className={cn(
                                            "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                                            item.item_type === 'service' ? "bg-primary-100 text-primary-600" : "bg-violet-100 text-violet-600"
                                        )}>
                                            {item.item_type === 'service' ? 'Servicio' : 'Producto'}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <div className="flex items-center gap-1">
                                            <span className="text-xs text-charcoal/40">Cant.</span>
                                            <input
                                                type="number" min="1"
                                                className="w-14 text-center text-sm border border-silk-beige rounded-lg px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary-300"
                                                value={item.quantity}
                                                onChange={e => updateItem(item.id, 'quantity', Math.max(1, Number(e.target.value)))}
                                            />
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <span className="text-xs text-charcoal/40">$</span>
                                            <input
                                                type="number" min="0"
                                                className="w-24 text-right text-sm border border-silk-beige rounded-lg px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary-300"
                                                value={item.unit_price}
                                                onChange={e => updateItem(item.id, 'unit_price', Number(e.target.value))}
                                            />
                                        </div>
                                        <span className="text-sm font-bold text-charcoal w-20 text-right">{formatMoney(item.subtotal)}</span>
                                        <button
                                            onClick={() => removeItem(item.id)}
                                            className="p-1 hover:bg-red-50 text-charcoal/30 hover:text-red-400 rounded-lg transition-colors"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Subtotal + descuento + total */}
                        <div className="mt-3 pt-3 border-t border-silk-beige space-y-2">
                            {/* Fila subtotal */}
                            <div className="flex justify-between items-center text-sm text-charcoal/60">
                                <span>Subtotal</span>
                                <span className="font-medium">{formatMoney(subtotal)}</span>
                            </div>

                            {/* Fila descuento */}
                            <div className="flex items-center gap-2">
                                <Tag className="w-4 h-4 text-charcoal/40 shrink-0" />
                                <span className="text-sm text-charcoal/60 w-24 shrink-0">Descuento</span>
                                {/* Toggle fijo / porcentaje */}
                                <div className="flex bg-silk-beige/40 rounded-lg p-0.5 text-xs">
                                    <button
                                        onClick={() => { setDiscountType('fixed'); setDiscountValue(0) }}
                                        className={cn(
                                            "px-2 py-1 rounded-md font-semibold transition-all",
                                            discountType === 'fixed'
                                                ? "bg-white text-primary-600 shadow-sm"
                                                : "text-charcoal/40 hover:text-charcoal"
                                        )}
                                    >
                                        {currency}
                                    </button>
                                    <button
                                        onClick={() => { setDiscountType('percentage'); setDiscountValue(0) }}
                                        className={cn(
                                            "px-2 py-1 rounded-md font-semibold transition-all flex items-center gap-0.5",
                                            discountType === 'percentage'
                                                ? "bg-white text-primary-600 shadow-sm"
                                                : "text-charcoal/40 hover:text-charcoal"
                                        )}
                                    >
                                        <Percent className="w-3 h-3" />
                                    </button>
                                </div>
                                <input
                                    type="number"
                                    min="0"
                                    max={discountType === 'percentage' ? 100 : undefined}
                                    step={discountType === 'percentage' ? 1 : 100}
                                    className="flex-1 text-right text-sm border border-silk-beige rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-300"
                                    placeholder="0"
                                    value={discountValue || ''}
                                    onChange={e => setDiscountValue(Math.max(0, Number(e.target.value)))}
                                />
                                {discountAmount > 0 && (
                                    <span className="text-sm font-semibold text-emerald-600 w-20 text-right shrink-0">
                                        −{formatMoney(discountAmount)}
                                    </span>
                                )}
                            </div>

                            {discountAmount > 0 && (
                                <input
                                    type="text"
                                    maxLength={80}
                                    className="w-full text-sm border border-emerald-200 bg-emerald-50 rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-emerald-300 placeholder:text-emerald-400 text-emerald-800"
                                    placeholder='Motivo (ej: "cliente frecuente", "alianza Petshop X")'
                                    value={discountReason}
                                    onChange={e => setDiscountReason(e.target.value)}
                                />
                            )}

                            {/* Total final */}
                            <div className="flex justify-between items-center pt-1 border-t border-silk-beige">
                                <span className="font-bold text-charcoal">Total a cobrar</span>
                                <p className="text-2xl font-extrabold text-charcoal">{formatMoney(finalTotal)}</p>
                            </div>
                        </div>
                    </div>

                    {/* Pago */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-bold text-charcoal uppercase tracking-wider">Pago</h3>
                        <div>
                            <p className="text-xs text-charcoal/60 mb-2">Método de pago</p>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                {PAYMENT_METHODS.map(m => (
                                    <button
                                        key={m.value}
                                        onClick={() => setPaymentMethod(m.value)}
                                        className={cn(
                                            "flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs font-semibold transition-all",
                                            paymentMethod === m.value
                                                ? "border-primary-400 bg-primary-50 text-primary-700"
                                                : "border-silk-beige bg-white text-charcoal/50 hover:border-charcoal/20"
                                        )}
                                    >
                                        <m.icon className="w-4 h-4" />
                                        {m.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div>
                            <p className="text-xs text-charcoal/60 mb-2">Estado del cobro</p>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setPaymentStatus('paid')}
                                    className={cn(
                                        "flex-1 py-2.5 rounded-xl border text-sm font-semibold transition-all",
                                        paymentStatus === 'paid'
                                            ? "border-emerald-400 bg-emerald-50 text-emerald-700"
                                            : "border-silk-beige text-charcoal/50 hover:border-charcoal/20"
                                    )}
                                >
                                    ✓ Cobrado
                                </button>
                                <button
                                    onClick={() => setPaymentStatus('pending')}
                                    className={cn(
                                        "flex-1 py-2.5 rounded-xl border text-sm font-semibold transition-all",
                                        paymentStatus === 'pending'
                                            ? "border-amber-400 bg-amber-50 text-amber-700"
                                            : "border-silk-beige text-charcoal/50 hover:border-charcoal/20"
                                    )}
                                >
                                    ⏳ Pendiente
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between p-5 border-t border-silk-beige shrink-0 gap-3">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2.5 text-sm font-semibold text-charcoal/60 hover:text-charcoal border border-silk-beige rounded-xl transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving || items.length === 0}
                        className={cn(
                            "flex-1 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-50",
                            paymentStatus === 'paid'
                                ? "bg-emerald-500 hover:bg-emerald-600 text-white"
                                : "bg-amber-500 hover:bg-amber-600 text-white"
                        )}
                    >
                        {saving
                            ? 'Guardando...'
                            : paymentStatus === 'paid'
                                ? `Cerrar y cobrar ${formatMoney(finalTotal)}`
                                : 'Cerrar sin cobrar'}
                    </button>
                </div>
            </div>
        </div>
    )
}

export default VisitClosureModal
