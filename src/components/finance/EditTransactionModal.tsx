import { useState, useEffect } from 'react'
import { X, Search, Plus, Trash2, Tag, Percent, CreditCard } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { toast } from 'react-hot-toast'
import { financeService } from '@/services/financeService'

interface Item {
    id: string
    item_type: 'service' | 'product'
    name: string
    quantity: number
    unit_price: number
    subtotal: number
    product_id?: string | null
}

interface ServiceOption { id: string; name: string; price: number }
interface ProductOption  { id: string; name: string; price: number }

interface Props {
    transaction: {
        id: string
        patient_name?: string
        appointment_date: string
        service?: string
        price?: number
        payment_method?: string
        discount?: number
    }
    clinicId: string
    onClose: () => void
    onSuccess: () => void
}

const PAYMENT_LABELS = [
    { value: 'efectivo',       label: 'Efectivo' },
    { value: 'transferencia',  label: 'Transferencia' },
    { value: 'tarjeta',        label: 'Tarjeta de crédito' },
    { value: 'debito',         label: 'Tarjeta de débito' },
]

export function EditTransactionModal({ transaction: tx, clinicId, onClose, onSuccess }: Props) {
    const [items, setItems]             = useState<Item[]>([])
    const [currency, setCurrency]       = useState('CLP')
    const [paymentMethod, setPaymentMethod] = useState(tx.payment_method ?? '')
    const [discountType, setDiscountType]   = useState<'fixed' | 'percentage'>('fixed')
    const [discountValue, setDiscountValue] = useState<number>(tx.discount ?? 0)
    const [discountReason, setDiscountReason] = useState<string>((tx as any).discount_reason ?? '')
    const [ivaEnabled, setIvaEnabled]    = useState(false)
    const [ivaRate, setIvaRate]          = useState(19)
    const [saving, setSaving]           = useState(false)

    const [services, setServices]       = useState<ServiceOption[]>([])
    const [products, setProducts]       = useState<ProductOption[]>([])
    const [filteredProducts, setFilteredProducts] = useState<ProductOption[]>([])
    const [productSearch, setProductSearch] = useState('')
    const [showServiceDrop, setShowServiceDrop]   = useState(false)
    const [showProductDrop, setShowProductDrop]   = useState(false)

    const formatMoney = (n: number) =>
        new Intl.NumberFormat('es-CL', { style: 'currency', currency, maximumFractionDigits: currency === 'CLP' ? 0 : 2 }).format(n)

    useEffect(() => {
        const load = async () => {
            const [txItems, svcRes, prodRes, clinicRes] = await Promise.all([
                financeService.getTransactionItems(tx.id).catch(() => []),
                (supabase as any).from('clinic_services').select('id,name,price').eq('clinic_id', clinicId).order('name'),
                (supabase as any).from('inventory_products').select('id,name,sale_price').eq('clinic_id', clinicId).eq('is_active', true).order('name'),
                (supabase as any).from('clinic_settings').select('currency, iva_enabled, iva_rate').eq('id', clinicId).single(),
            ])

            // Si no hay ítems, crear sintético desde el servicio de la cita
            if (txItems.length > 0) {
                setItems(txItems.map((i: any) => ({ ...i, quantity: Number(i.quantity), unit_price: Number(i.unit_price), subtotal: Number(i.subtotal) })))
            } else if (tx.service) {
                setItems([{ id: 'svc-0', item_type: 'service', name: tx.service, quantity: 1, unit_price: tx.price ?? 0, subtotal: tx.price ?? 0, product_id: null }])
            }

            if (svcRes.data) setServices(svcRes.data.map((s: any) => ({ id: s.id, name: s.name, price: Number(s.price) })))
            if (prodRes.data) {
                const p = prodRes.data.map((r: any) => ({ id: r.id, name: r.name, price: Number(r.sale_price ?? 0) }))
                setProducts(p); setFilteredProducts(p)
            }
            if (clinicRes.data?.currency) setCurrency(clinicRes.data.currency)
            setIvaEnabled(clinicRes.data?.iva_enabled ?? false)
            setIvaRate(clinicRes.data?.iva_rate ?? 19)
        }
        load()
    }, [])

    useEffect(() => {
        const lower = productSearch.toLowerCase()
        setFilteredProducts(lower ? products.filter(p => p.name.toLowerCase().includes(lower)) : products)
    }, [productSearch, products])

    const subtotal = items.reduce((s, i) => s + i.subtotal, 0)
    const discountAmount = discountType === 'percentage'
        ? Math.round(subtotal * discountValue / 100)
        : Math.min(discountValue, subtotal)
    const finalTotal = Math.max(0, subtotal - discountAmount)
    const ivaAmount = ivaEnabled && finalTotal > 0
        ? Math.round(finalTotal * ivaRate / (100 + ivaRate))
        : 0
    const netAmount = finalTotal - ivaAmount

    const updateQty = (idx: number, qty: number) => {
        setItems(prev => prev.map((it, i) => i === idx
            ? { ...it, quantity: qty, subtotal: qty * it.unit_price }
            : it))
    }

    const updatePrice = (idx: number, price: number) => {
        setItems(prev => prev.map((it, i) => i === idx
            ? { ...it, unit_price: price, subtotal: it.quantity * price }
            : it))
    }

    const addService = (svc: ServiceOption) => {
        setItems(prev => [...prev, { id: `svc-${Date.now()}`, item_type: 'service', name: svc.name, quantity: 1, unit_price: svc.price, subtotal: svc.price, product_id: null }])
        setShowServiceDrop(false)
    }

    const addProduct = (prod: ProductOption) => {
        setItems(prev => [...prev, { id: `prod-${Date.now()}`, item_type: 'product', name: prod.name, quantity: 1, unit_price: prod.price, subtotal: prod.price, product_id: prod.id }])
        setProductSearch(''); setShowProductDrop(false)
    }

    const removeItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx))

    const handleSave = async () => {
        if (items.length === 0) { toast.error('Agrega al menos un servicio o producto'); return }
        setSaving(true)
        try {
            await financeService.saveTransactionItems(tx.id, clinicId, items, finalTotal, discountAmount, paymentMethod || null, discountReason.trim() || null, ivaAmount || null)
            toast.success('Transacción actualizada')
            onSuccess()
            onClose()
        } catch (e: any) {
            toast.error(e.message ?? 'Error al guardar')
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="fixed inset-0 bg-charcoal/50 z-50 flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white rounded-soft w-full max-w-lg shadow-xl flex flex-col max-h-[90vh]">

                <div className="flex items-center justify-between p-6 border-b border-silk-beige">
                    <div>
                        <h3 className="text-lg font-bold text-charcoal">Editar transacción</h3>
                        <p className="text-xs text-charcoal/50 mt-0.5">{tx.patient_name ?? '—'}</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-silk-beige rounded-soft transition-colors">
                        <X className="w-5 h-5 text-charcoal/50" />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto flex-1 space-y-5">

                    {/* Lista de ítems */}
                    {items.length > 0 && (
                        <div className="space-y-2">
                            {items.map((item, idx) => (
                                <div key={item.id} className={cn(
                                    "flex items-center gap-2 px-3 py-2 rounded-lg text-sm",
                                    item.item_type === 'service' ? 'bg-primary-50' : 'bg-violet-50'
                                )}>
                                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0",
                                        item.item_type === 'service' ? "bg-primary-100 text-primary-600" : "bg-violet-100 text-violet-600"
                                    )}>
                                        {item.item_type === 'service' ? 'Serv.' : 'Prod.'}
                                    </span>
                                    <span className="flex-1 text-charcoal font-medium truncate">{item.name}</span>
                                    <input type="number" min="1" value={item.quantity}
                                        onChange={e => updateQty(idx, Math.max(1, Number(e.target.value)))}
                                        className="w-12 text-center border border-silk-beige rounded-md px-1 py-0.5 text-xs"
                                    />
                                    <span className="text-charcoal/40 text-xs">×</span>
                                    <input type="number" min="0" value={item.unit_price || ''}
                                        onChange={e => updatePrice(idx, Number(e.target.value) || 0)}
                                        className="w-20 text-right border border-silk-beige rounded-md px-1 py-0.5 text-xs font-medium"
                                    />
                                    <span className="text-xs font-semibold text-charcoal w-20 text-right shrink-0">
                                        {formatMoney(item.subtotal)}
                                    </span>
                                    <button onClick={() => removeItem(idx)} className="text-red-400 hover:text-red-500 shrink-0">
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Agregar servicio */}
                    <div className="relative">
                        <button type="button" onClick={() => setShowServiceDrop(!showServiceDrop)}
                            className="w-full text-left input-soft flex justify-between items-center text-sm text-charcoal/50">
                            <span>+ Agregar servicio...</span>
                            <Plus className="w-4 h-4 text-primary-500" />
                        </button>
                        {showServiceDrop && (
                            <div className="absolute z-10 w-full mt-1 bg-white border border-silk-beige rounded-soft shadow-lg max-h-40 overflow-y-auto">
                                {services.map(s => (
                                    <div key={s.id} onClick={() => addService(s)}
                                        className="px-4 py-2 hover:bg-silk-beige cursor-pointer text-sm text-charcoal flex justify-between">
                                        <span>{s.name}</span>
                                        <span className="text-primary-600 font-medium">{formatMoney(s.price)}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Agregar producto */}
                    <div className="relative">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal/40" />
                            <input type="text" value={productSearch}
                                onChange={e => { setProductSearch(e.target.value); setShowProductDrop(true) }}
                                onFocus={() => setShowProductDrop(true)}
                                className="input-soft pl-9 text-sm"
                                placeholder="Buscar producto del inventario..." />
                        </div>
                        {showProductDrop && filteredProducts.length > 0 && (
                            <div className="absolute z-10 w-full mt-1 bg-white border border-silk-beige rounded-soft shadow-lg max-h-40 overflow-y-auto">
                                {filteredProducts.slice(0, 15).map(p => (
                                    <div key={p.id} onClick={() => addProduct(p)}
                                        className="px-4 py-2 hover:bg-silk-beige cursor-pointer text-sm text-charcoal flex justify-between">
                                        <span>{p.name}</span>
                                        <span className="text-violet-600 font-medium">{formatMoney(p.price)}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Descuento */}
                    <div className="bg-ivory rounded-xl p-4 border border-silk-beige space-y-2">
                        <div className="flex items-center gap-2">
                            <Tag className="w-4 h-4 text-charcoal/40" />
                            <span className="text-sm font-medium text-charcoal">Descuento (opcional)</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="flex bg-white border border-silk-beige rounded-lg p-0.5 text-xs shrink-0">
                                <button type="button" onClick={() => { setDiscountType('fixed'); setDiscountValue(0) }}
                                    className={cn("px-2.5 py-1 rounded-md font-semibold transition-all",
                                        discountType === 'fixed' ? "bg-primary-500 text-white" : "text-charcoal/50")}
                                >{currency}</button>
                                <button type="button" onClick={() => { setDiscountType('percentage'); setDiscountValue(0) }}
                                    className={cn("px-2.5 py-1 rounded-md font-semibold transition-all flex items-center",
                                        discountType === 'percentage' ? "bg-primary-500 text-white" : "text-charcoal/50")}
                                ><Percent className="w-3 h-3" /></button>
                            </div>
                            <input type="number" min="0" max={discountType === 'percentage' ? 100 : undefined}
                                value={discountValue || ''} placeholder="0"
                                onChange={e => setDiscountValue(Math.max(0, Number(e.target.value)))}
                                className="flex-1 input-soft text-right" />
                            {discountAmount > 0 && (
                                <span className="text-sm font-semibold text-emerald-600 shrink-0">−{formatMoney(discountAmount)}</span>
                            )}
                        </div>
                        {discountAmount > 0 && (
                            <input
                                type="text"
                                maxLength={80}
                                className="w-full text-sm border border-emerald-200 bg-emerald-50 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-300 placeholder:text-emerald-400 text-emerald-800"
                                placeholder='Motivo (ej: "cliente frecuente", "alianza Petshop X")'
                                value={discountReason}
                                onChange={e => setDiscountReason(e.target.value)}
                            />
                        )}
                        {subtotal > 0 && (
                            <div className="pt-2 border-t border-silk-beige text-sm space-y-1">
                                {discountAmount > 0 && (
                                    <>
                                        <div className="flex justify-between text-charcoal/50"><span>Subtotal</span><span>{formatMoney(subtotal)}</span></div>
                                        <div className="flex justify-between text-emerald-600"><span>Descuento</span><span>−{formatMoney(discountAmount)}</span></div>
                                    </>
                                )}
                                <div className="flex justify-between font-bold text-charcoal">
                                    <span>Total</span>
                                    <span className="text-primary-600">{formatMoney(finalTotal)}</span>
                                </div>
                                {ivaEnabled && ivaAmount > 0 && (
                                    <div className="mt-1 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 space-y-1">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-amber-500">Desglose IVA incluido</p>
                                        <div className="flex justify-between text-xs text-charcoal/70"><span>Neto</span><span>{formatMoney(netAmount)}</span></div>
                                        <div className="flex justify-between text-xs text-amber-700 font-semibold"><span>IVA ({ivaRate}%)</span><span>{formatMoney(ivaAmount)}</span></div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Método de pago */}
                    <div>
                        <label className="block text-sm font-medium text-charcoal mb-1 flex items-center gap-1.5">
                            <CreditCard className="w-3.5 h-3.5 text-charcoal/40" />
                            Método de pago
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                            {PAYMENT_LABELS.map(opt => (
                                <button key={opt.value} type="button"
                                    onClick={() => setPaymentMethod(paymentMethod === opt.value ? '' : opt.value)}
                                    className={cn(
                                        "py-2 px-3 rounded-lg border text-sm font-medium transition-all",
                                        paymentMethod === opt.value
                                            ? "bg-primary-500 text-white border-primary-500"
                                            : "bg-white border-silk-beige text-charcoal/70 hover:border-primary-300"
                                    )}
                                >{opt.label}</button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="p-6 border-t border-silk-beige flex justify-end gap-3 bg-ivory rounded-b-soft">
                    <button onClick={onClose} className="btn-ghost">Cancelar</button>
                    <button onClick={handleSave} disabled={saving || items.length === 0}
                        className="btn-primary disabled:opacity-50">
                        {saving ? 'Guardando...' : 'Guardar cambios'}
                    </button>
                </div>
            </div>

            {(showServiceDrop || showProductDrop) && (
                <div className="fixed inset-0 z-0"
                    onClick={() => { setShowServiceDrop(false); setShowProductDrop(false) }} />
            )}
        </div>
    )
}
