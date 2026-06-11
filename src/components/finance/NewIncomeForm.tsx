import React, { useState, useEffect } from 'react'
import { X, Search, Plus, Trash2, Calculator, Percent, Tag, Package, FileText, CreditCard, PenLine } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

interface ServiceOption {
    id: string
    name: string
    price: number
}

interface ProductOption {
    id: string
    name: string
    price: number  // sale_price
}

interface TutorOption {
    id: string
    name: string
}

const PAYMENT_OPTIONS = [
    { value: 'efectivo',      label: 'Efectivo' },
    { value: 'transferencia', label: 'Transferencia' },
    { value: 'tarjeta',       label: 'Tarjeta crédito' },
    { value: 'debito',        label: 'Tarjeta débito' },
]

interface EditingIncome {
    id: string
    description: string
    amount: number
    discount?: number
    discount_reason?: string | null
    date: string
    tutor_id?: string | null
    services?: any[] | null
    notes?: string | null
    payment_method?: string | null
}

interface NewIncomeFormProps {
    clinicId: string
    onClose: () => void
    editingIncome?: EditingIncome
    defaultDate?: string
    onSuccess: (incomeData: {
        description: string
        amount: number
        discount: number
        discount_reason?: string
        iva_amount?: number
        category: string
        date: string
        tutor_id?: string
        services?: any[]
        notes?: string
        payment_method?: string
    }) => void
}

export function NewIncomeForm({ clinicId, onClose, onSuccess, editingIncome, defaultDate }: NewIncomeFormProps) {
    const isEdit = !!editingIncome
    const [description, setDescription] = useState(editingIncome?.description ?? '')
    // Fallback en hora local de Chile, nunca UTC (toISOString desplaza la fecha después de las 20:00 CLT)
    const [date, setDate] = useState(editingIncome?.date ?? defaultDate ?? new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' }))
    const [currency, setCurrency] = useState('CLP')
    const [notes, setNotes] = useState(editingIncome?.notes ?? '')
    const [paymentMethod, setPaymentMethod] = useState(editingIncome?.payment_method ?? '')

    // Tutor
    const [tutors, setTutors] = useState<TutorOption[]>([])
    const [filteredTutors, setFilteredTutors] = useState<TutorOption[]>([])
    const [tutorSearch, setTutorSearch] = useState('')
    const [selectedTutor, setSelectedTutor] = useState<TutorOption | null>(null)
    const [showTutorDropdown, setShowTutorDropdown] = useState(false)

    // Servicios
    const [availableServices, setAvailableServices] = useState<ServiceOption[]>([])
    const [selectedServices, setSelectedServices] = useState<ServiceOption[]>([])
    const [showServiceDropdown, setShowServiceDropdown] = useState(false)

    // Productos del inventario
    const [availableProducts, setAvailableProducts] = useState<ProductOption[]>([])
    const [filteredProducts, setFilteredProducts] = useState<ProductOption[]>([])
    const [productSearch, setProductSearch] = useState('')
    const [selectedProducts, setSelectedProducts] = useState<ProductOption[]>([])
    const [showProductDropdown, setShowProductDropdown] = useState(false)

    // Ítems libres (servicios esporádicos sin catálogo)
    const [customItems, setCustomItems] = useState<{ name: string; price: number }[]>([])
    const [customItemName, setCustomItemName] = useState('')
    const [customItemPrice, setCustomItemPrice] = useState<string>('')

    // Monto manual (cuando no hay ítems seleccionados)
    const [manualAmount, setManualAmount] = useState<string>('')

    // Descuento
    const [discountType, setDiscountType] = useState<'fixed' | 'percentage'>('fixed')
    const [discountValue, setDiscountValue] = useState<number>(editingIncome?.discount ?? 0)
    const [discountReason, setDiscountReason] = useState<string>(editingIncome?.discount_reason ?? '')
    // IVA
    const [ivaEnabled, setIvaEnabled] = useState(false)
    const [ivaRate, setIvaRate] = useState(19)

    const formatMoney = (n: number) =>
        new Intl.NumberFormat('es-CL', {
            style: 'currency',
            currency,
            maximumFractionDigits: currency === 'CLP' ? 0 : 2,
        }).format(n)

    useEffect(() => {
        const loadData = async () => {
            if (!clinicId) return
            const [tutorsRes, servicesRes, productsRes, clinicRes] = await Promise.all([
                supabase.from('tutors').select('id, name').eq('clinic_id', clinicId).order('name'),
                (supabase as any).from('clinic_services').select('id, name, price').eq('clinic_id', clinicId).order('name'),
                (supabase as any).from('inventory_products').select('id, name, sale_price').eq('clinic_id', clinicId).eq('is_active', true).order('name'),
                (supabase as any).from('clinic_settings').select('currency, iva_enabled, iva_rate').eq('id', clinicId).single(),
            ])

            if (tutorsRes.data) {
                setTutors(tutorsRes.data as TutorOption[])
                setFilteredTutors(tutorsRes.data as TutorOption[])
                // Pre-rellenar tutor en modo edición
                if (editingIncome?.tutor_id) {
                    const found = (tutorsRes.data as TutorOption[]).find(t => t.id === editingIncome.tutor_id)
                    if (found) { setSelectedTutor(found); setTutorSearch(found.name) }
                }
            }

            if (servicesRes.data) setAvailableServices(servicesRes.data as ServiceOption[])

            if (productsRes.data) {
                const prods = productsRes.data.map((p: any) => ({ id: p.id, name: p.name, price: p.sale_price ?? 0 }))
                setAvailableProducts(prods)
                setFilteredProducts(prods)
            }

            if (clinicRes.data?.currency) setCurrency(clinicRes.data.currency)
            setIvaEnabled(clinicRes.data?.iva_enabled ?? false)
            setIvaRate(clinicRes.data?.iva_rate ?? 19)

            // Pre-rellenar servicios/productos en modo edición
            if (editingIncome?.services && editingIncome.services.length > 0) {
                const svc = editingIncome.services.filter((s: any) => s.type === 'service')
                const prd = editingIncome.services.filter((s: any) => s.type === 'product')
                if (svc.length > 0) setSelectedServices(svc.map((s: any) => ({ id: s.id, name: s.name, price: s.price })))
                if (prd.length > 0) setSelectedProducts(prd.map((p: any) => ({ id: p.id, name: p.name, price: p.price })))
            } else if (editingIncome) {
                // Sin servicios guardados — reconstruir monto bruto (amount en DB ya es neto)
                const gross = (editingIncome.amount ?? 0) + (editingIncome.discount ?? 0)
                setManualAmount(String(gross))
            }
        }
        loadData()
    }, [clinicId])

    useEffect(() => {
        const lower = tutorSearch.toLowerCase()
        setFilteredTutors(lower ? tutors.filter(t => t.name.toLowerCase().includes(lower)) : tutors)
    }, [tutorSearch, tutors])

    useEffect(() => {
        const lower = productSearch.toLowerCase()
        setFilteredProducts(lower ? availableProducts.filter(p => p.name.toLowerCase().includes(lower)) : availableProducts)
    }, [productSearch, availableProducts])

    const serviceSubtotal = selectedServices.reduce((sum, s) => sum + Number(s.price || 0), 0)
    const productSubtotal = selectedProducts.reduce((sum, p) => sum + Number(p.price || 0), 0)
    const customSubtotal = customItems.reduce((sum, i) => sum + Number(i.price || 0), 0)
    const hasItems = selectedServices.length > 0 || selectedProducts.length > 0 || customItems.length > 0
    const subtotal = hasItems ? serviceSubtotal + productSubtotal + customSubtotal : Number(manualAmount || 0)
    const discountAmount = discountType === 'percentage'
        ? Math.round(subtotal * discountValue / 100)
        : Math.min(discountValue, subtotal)
    const finalAmount = Math.max(0, subtotal - discountAmount)
    const ivaAmount = ivaEnabled && finalAmount > 0
        ? Math.round(finalAmount * ivaRate / (100 + ivaRate))
        : 0
    const netAmount = finalAmount - ivaAmount

    // Categoría auto-calculada
    const autoCategory = selectedProducts.length > 0 && selectedServices.length === 0 ? 'product' : 'service'

    const handleSelectTutor = (tutor: TutorOption) => {
        setSelectedTutor(tutor)
        setTutorSearch(tutor.name)
        setShowTutorDropdown(false)
        if (!description) setDescription(`Pago de ${tutor.name}`)
    }

    const clearTutor = () => { setSelectedTutor(null); setTutorSearch('') }

    const addService = (service: ServiceOption) => {
        const newList = [...selectedServices, service]
        setSelectedServices(newList)
        setShowServiceDropdown(false)
        updateDescription(newList, selectedProducts)
    }

    const removeService = (index: number) => {
        const newList = [...selectedServices]
        newList.splice(index, 1)
        setSelectedServices(newList)
        updateDescription(newList, selectedProducts)
    }

    const addProduct = (product: ProductOption) => {
        const newList = [...selectedProducts, product]
        setSelectedProducts(newList)
        setProductSearch('')
        setShowProductDropdown(false)
        updateDescription(selectedServices, newList)
    }

    const removeProduct = (index: number) => {
        const newList = [...selectedProducts]
        newList.splice(index, 1)
        setSelectedProducts(newList)
        updateDescription(selectedServices, newList)
    }

    const updateDescription = (services: ServiceOption[], products: ProductOption[], custom?: { name: string; price: number }[]) => {
        const used = custom ?? customItems
        const allItems = [...services.map(s => s.name), ...products.map(p => p.name), ...used.map(i => i.name)]
        if (allItems.length > 0) {
            setDescription(allItems.join(', '))
        } else if (selectedTutor) {
            setDescription(`Pago de ${selectedTutor.name}`)
        } else {
            setDescription('')
        }
    }

    const addCustomItem = () => {
        const name = customItemName.trim()
        const price = Number(customItemPrice)
        if (!name || !price || price <= 0) return
        const newList = [...customItems, { name, price }]
        setCustomItems(newList)
        setCustomItemName('')
        setCustomItemPrice('')
        updateDescription(selectedServices, selectedProducts, newList)
    }

    const removeCustomItem = (index: number) => {
        const newList = [...customItems]
        newList.splice(index, 1)
        setCustomItems(newList)
        updateDescription(selectedServices, selectedProducts, newList)
    }

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        if (finalAmount <= 0 && subtotal <= 0) return
        const allServices = [
            ...selectedServices.map(s => ({ id: s.id, name: s.name, price: s.price, type: 'service' })),
            ...selectedProducts.map(p => ({ id: p.id, name: p.name, price: p.price, type: 'product' })),
            ...customItems.map(i => ({ id: `custom-${Date.now()}-${Math.random()}`, name: i.name, price: i.price, type: 'custom' })),
        ]
        onSuccess({
            description,
            amount:          finalAmount,
            discount:        discountAmount,
            discount_reason: discountReason.trim() || undefined,
            iva_amount:      ivaAmount || undefined,
            category:        autoCategory,
            date,
            tutor_id:        selectedTutor?.id,
            services:        allServices.length > 0 ? allServices : undefined,
            notes:           notes.trim() || undefined,
            payment_method:  paymentMethod || undefined,
        })
    }

    return (
        <div className="fixed inset-0 bg-charcoal/50 z-50 flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white rounded-soft w-full max-w-lg shadow-xl flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-silk-beige">
                    <h3 className="text-xl font-bold text-charcoal flex items-center gap-2">
                        <Calculator className="w-5 h-5 text-primary-500" />
                        {isEdit ? 'Editar Ingreso' : 'Registrar Nuevo Ingreso'}
                    </h3>
                    <button onClick={onClose} className="p-2 hover:bg-silk-beige rounded-soft transition-colors">
                        <X className="w-5 h-5 text-charcoal/50 hover:text-charcoal" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 overflow-y-auto flex-1 space-y-5">

                    {/* Tutor */}
                    <div className="relative">
                        <label className="block text-sm font-medium text-charcoal mb-1">Tutor Asociado (Opcional)</label>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal/40" />
                            <input
                                type="text"
                                value={tutorSearch}
                                onChange={e => { setTutorSearch(e.target.value); setShowTutorDropdown(true); if (!e.target.value) setSelectedTutor(null) }}
                                onFocus={() => setShowTutorDropdown(true)}
                                className="input-soft pl-9"
                                placeholder="Buscar tutor por nombre..."
                            />
                            {selectedTutor && (
                                <button type="button" onClick={clearTutor} className="absolute right-3 top-1/2 -translate-y-1/2">
                                    <X className="w-4 h-4 text-charcoal/40 hover:text-red-500" />
                                </button>
                            )}
                        </div>
                        {showTutorDropdown && filteredTutors.length > 0 && (
                            <div className="absolute z-10 w-full mt-1 bg-white border border-silk-beige rounded-soft shadow-lg max-h-48 overflow-y-auto">
                                {filteredTutors.map(tutor => (
                                    <div key={tutor.id} onClick={() => handleSelectTutor(tutor)}
                                        className="px-4 py-2 hover:bg-silk-beige cursor-pointer text-sm text-charcoal transition-colors">
                                        {tutor.name}
                                    </div>
                                ))}
                            </div>
                        )}
                        {showTutorDropdown && filteredTutors.length === 0 && tutorSearch && (
                            <div className="absolute z-10 w-full mt-1 bg-white border border-silk-beige rounded-soft shadow-lg p-4 text-sm text-charcoal/50 text-center">
                                No se encontraron tutores.
                            </div>
                        )}
                    </div>

                    {/* Servicios */}
                    <div>
                        <label className="block text-sm font-medium text-charcoal mb-1">Servicios</label>
                        <div className="relative">
                            <button type="button" onClick={() => setShowServiceDropdown(!showServiceDropdown)}
                                className="w-full text-left input-soft flex justify-between items-center">
                                <span className="text-charcoal/50">Agregar servicio al total...</span>
                                <Plus className="w-4 h-4 text-primary-500" />
                            </button>
                            {showServiceDropdown && (
                                <div className="absolute z-10 w-full mt-1 bg-white border border-silk-beige rounded-soft shadow-lg max-h-48 overflow-y-auto">
                                    {availableServices.map(service => (
                                        <div key={service.id} onClick={() => addService(service)}
                                            className="px-4 py-2 hover:bg-silk-beige cursor-pointer text-sm text-charcoal flex justify-between transition-colors">
                                            <span>{service.name}</span>
                                            <span className="font-medium text-primary-600">{formatMoney(service.price)}</span>
                                        </div>
                                    ))}
                                    {availableServices.length === 0 && (
                                        <div className="p-4 text-sm text-charcoal/50 text-center">No hay servicios registrados.</div>
                                    )}
                                </div>
                            )}
                        </div>
                        {selectedServices.length > 0 && (
                            <div className="mt-2 space-y-1.5">
                                {selectedServices.map((service, idx) => (
                                    <div key={idx} className="flex items-center justify-between bg-primary-50 px-3 py-2 rounded-md text-sm">
                                        <span className="text-charcoal">{service.name}</span>
                                        <div className="flex items-center gap-3">
                                            <span className="font-medium text-primary-700">{formatMoney(service.price)}</span>
                                            <button type="button" onClick={() => removeService(idx)} className="text-red-400 hover:text-red-500">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Productos del inventario */}
                    <div>
                        <label className="block text-sm font-medium text-charcoal mb-1 flex items-center gap-1.5">
                            <Package className="w-3.5 h-3.5 text-violet-500" />
                            Productos del Inventario
                        </label>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal/40" />
                            <input
                                type="text"
                                value={productSearch}
                                onChange={e => { setProductSearch(e.target.value); setShowProductDropdown(true) }}
                                onFocus={() => setShowProductDropdown(true)}
                                className="input-soft pl-9"
                                placeholder="Buscar producto por nombre..."
                            />
                        </div>
                        {showProductDropdown && filteredProducts.length > 0 && (
                            <div className="relative z-10 w-full mt-1 bg-white border border-silk-beige rounded-soft shadow-lg max-h-48 overflow-y-auto">
                                {filteredProducts.slice(0, 20).map(product => (
                                    <div key={product.id} onClick={() => addProduct(product)}
                                        className="px-4 py-2 hover:bg-silk-beige cursor-pointer text-sm text-charcoal flex justify-between transition-colors">
                                        <span>{product.name}</span>
                                        <span className="font-medium text-violet-600">{formatMoney(product.price)}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        {showProductDropdown && filteredProducts.length === 0 && productSearch && (
                            <div className="relative z-10 w-full mt-1 bg-white border border-silk-beige rounded-soft shadow-lg p-4 text-sm text-charcoal/50 text-center">
                                No se encontraron productos.
                            </div>
                        )}
                        {selectedProducts.length > 0 && (
                            <div className="mt-2 space-y-1.5">
                                {selectedProducts.map((product, idx) => (
                                    <div key={idx} className="flex items-center justify-between bg-violet-50 px-3 py-2 rounded-md text-sm">
                                        <span className="text-charcoal">{product.name}</span>
                                        <div className="flex items-center gap-3">
                                            <span className="font-medium text-violet-700">{formatMoney(product.price)}</span>
                                            <button type="button" onClick={() => removeProduct(idx)} className="text-red-400 hover:text-red-500">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Ítems libres — servicios esporádicos */}
                    <div>
                        <label className="block text-sm font-medium text-charcoal mb-1 flex items-center gap-1.5">
                            <PenLine className="w-3.5 h-3.5 text-amber-500" />
                            Ítem libre (servicio esporádico)
                        </label>
                        <p className="text-xs text-charcoal/40 mb-2">Para servicios que no están en tu catálogo. Escribe el nombre y el monto.</p>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={customItemName}
                                onChange={e => setCustomItemName(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomItem() } }}
                                className="input-soft flex-1"
                                placeholder="Ej: Consulta de urgencia"
                            />
                            <input
                                type="number"
                                min="0"
                                step="1"
                                value={customItemPrice}
                                onChange={e => setCustomItemPrice(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomItem() } }}
                                className="input-soft w-28 text-right"
                                placeholder="Monto"
                            />
                            <button
                                type="button"
                                onClick={addCustomItem}
                                disabled={!customItemName.trim() || !customItemPrice || Number(customItemPrice) <= 0}
                                className="shrink-0 flex items-center justify-center w-10 h-10 rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                                <Plus className="w-4 h-4" />
                            </button>
                        </div>
                        {customItems.length > 0 && (
                            <div className="mt-2 space-y-1.5">
                                {customItems.map((item, idx) => (
                                    <div key={idx} className="flex items-center justify-between bg-amber-50 px-3 py-2 rounded-md text-sm">
                                        <span className="text-charcoal">{item.name}</span>
                                        <div className="flex items-center gap-3">
                                            <span className="font-medium text-amber-700">{formatMoney(item.price)}</span>
                                            <button type="button" onClick={() => removeCustomItem(idx)} className="text-red-400 hover:text-red-500">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Descripción */}
                    <div className="pt-1 border-t border-silk-beige">
                        <label className="block text-sm font-medium text-charcoal mb-1">Descripción <span className="text-red-500">*</span></label>
                        <input
                            required
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            className="input-soft"
                            placeholder="Ej. Venta de accesorios"
                        />
                    </div>

                    {/* Monto + Fecha */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-charcoal mb-1">
                                Total ({currency}) <span className="text-red-500">*</span>
                            </label>
                            {hasItems ? (
                                <div className="input-soft bg-silk-beige/30 font-semibold text-primary-700 flex items-center">
                                    {formatMoney(serviceSubtotal + productSubtotal + customSubtotal)}
                                    <span className="ml-1 text-xs text-charcoal/40">(auto)</span>
                                </div>
                            ) : (
                                <input
                                    type="number" min="0" step="1" required
                                    value={manualAmount}
                                    onChange={e => setManualAmount(e.target.value)}
                                    className="input-soft font-semibold text-primary-700"
                                    placeholder="0"
                                />
                            )}
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-charcoal mb-1">Fecha <span className="text-red-500">*</span></label>
                            <input type="date" required value={date} onChange={e => setDate(e.target.value)}
                                className="input-soft [color-scheme:light]" />
                        </div>
                    </div>

                    {/* Descuento */}
                    <div className="bg-ivory rounded-xl p-4 space-y-2 border border-silk-beige">
                        <div className="flex items-center gap-2 mb-1">
                            <Tag className="w-4 h-4 text-charcoal/40" />
                            <span className="text-sm font-medium text-charcoal">Descuento (opcional)</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="flex bg-white border border-silk-beige rounded-lg p-0.5 text-xs shrink-0">
                                <button type="button"
                                    onClick={() => { setDiscountType('fixed'); setDiscountValue(0) }}
                                    className={cn(
                                        "px-2.5 py-1 rounded-md font-semibold transition-all",
                                        discountType === 'fixed' ? "bg-primary-500 text-white shadow-sm" : "text-charcoal/50 hover:text-charcoal"
                                    )}
                                >
                                    {currency}
                                </button>
                                <button type="button"
                                    onClick={() => { setDiscountType('percentage'); setDiscountValue(0) }}
                                    className={cn(
                                        "px-2.5 py-1 rounded-md font-semibold transition-all flex items-center gap-0.5",
                                        discountType === 'percentage' ? "bg-primary-500 text-white shadow-sm" : "text-charcoal/50 hover:text-charcoal"
                                    )}
                                >
                                    <Percent className="w-3 h-3" />
                                </button>
                            </div>
                            <input
                                type="number" min="0"
                                max={discountType === 'percentage' ? 100 : undefined}
                                step={1}
                                className="flex-1 input-soft text-right"
                                placeholder="0"
                                value={discountValue || ''}
                                onChange={e => setDiscountValue(Math.max(0, Number(e.target.value)))}
                            />
                            {discountAmount > 0 && (
                                <span className="text-sm font-semibold text-emerald-600 shrink-0">
                                    −{formatMoney(discountAmount)}
                                </span>
                            )}
                        </div>

                        {discountAmount > 0 && (
                            <input
                                type="text"
                                maxLength={80}
                                className="w-full text-sm border border-emerald-200 bg-emerald-50 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-300 placeholder:text-emerald-400 text-emerald-800"
                                placeholder='Motivo del descuento (ej: "cliente frecuente", "alianza Petshop X")'
                                value={discountReason}
                                onChange={e => setDiscountReason(e.target.value)}
                            />
                        )}

                        {subtotal > 0 && (
                            <div className="pt-2 space-y-1 text-sm border-t border-silk-beige">
                                {discountAmount > 0 && (
                                    <div className="flex justify-between text-charcoal/50">
                                        <span>Subtotal</span>
                                        <span>{formatMoney(subtotal)}</span>
                                    </div>
                                )}
                                {discountAmount > 0 && (
                                    <div className="flex justify-between text-emerald-600">
                                        <span>Descuento</span>
                                        <span>−{formatMoney(discountAmount)}</span>
                                    </div>
                                )}
                                <div className="flex justify-between font-bold text-charcoal">
                                    <span>Total a registrar</span>
                                    <span className="text-primary-600">{formatMoney(finalAmount)}</span>
                                </div>
                                {ivaEnabled && ivaAmount > 0 && (
                                    <div className="mt-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 space-y-1">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-amber-500">Desglose IVA incluido</p>
                                        <div className="flex justify-between text-xs text-charcoal/70">
                                            <span>Neto</span><span>{formatMoney(netAmount)}</span>
                                        </div>
                                        <div className="flex justify-between text-xs text-amber-700 font-semibold">
                                            <span>IVA ({ivaRate}%)</span><span>{formatMoney(ivaAmount)}</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Método de pago */}
                    <div>
                        <label className="block text-sm font-medium text-charcoal mb-2 flex items-center gap-1.5">
                            <CreditCard className="w-3.5 h-3.5 text-charcoal/40" />
                            Método de pago (opcional)
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                            {PAYMENT_OPTIONS.map(opt => (
                                <button key={opt.value} type="button"
                                    onClick={() => setPaymentMethod(paymentMethod === opt.value ? '' : opt.value)}
                                    className={cn(
                                        "py-2 px-3 rounded-lg border text-sm font-medium transition-all",
                                        paymentMethod === opt.value
                                            ? "bg-primary-500 text-white border-primary-500 shadow-sm"
                                            : "bg-white border-silk-beige text-charcoal/60 hover:border-primary-300"
                                    )}
                                >{opt.label}</button>
                            ))}
                        </div>
                    </div>

                    {/* Notas */}
                    <div>
                        <label className="block text-sm font-medium text-charcoal mb-1 flex items-center gap-1.5">
                            <FileText className="w-3.5 h-3.5 text-charcoal/40" />
                            Notas (opcional)
                        </label>
                        <textarea
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            rows={2}
                            className="input-soft resize-none"
                            placeholder="Observaciones, referencias..."
                        />
                    </div>
                </form>

                <div className="p-6 border-t border-silk-beige flex justify-end gap-3 bg-ivory rounded-b-soft">
                    <button type="button" onClick={onClose} className="btn-ghost">Cancelar</button>
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={finalAmount <= 0 && subtotal <= 0}
                        className="btn-primary disabled:opacity-50"
                    >
                        {isEdit ? 'Guardar cambios' : 'Registrar Ingreso'}
                    </button>
                </div>
            </div>

            {(showTutorDropdown || showServiceDropdown) && (
                <div className="fixed inset-0 z-0"
                    onClick={() => { setShowTutorDropdown(false); setShowServiceDropdown(false); setShowProductDropdown(false) }} />
            )}
        </div>
    )
}
