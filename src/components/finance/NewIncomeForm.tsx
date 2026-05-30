import React, { useState, useEffect } from 'react'
import { X, Search, Plus, Trash2, Calculator, Percent, Tag, Package, FileText } from 'lucide-react'
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

interface NewIncomeFormProps {
    clinicId: string
    onClose: () => void
    onSuccess: (incomeData: {
        description: string
        amount: number
        discount: number
        category: string
        date: string
        tutor_id?: string
        services?: any[]
        notes?: string
    }) => void
}

export function NewIncomeForm({ clinicId, onClose, onSuccess }: NewIncomeFormProps) {
    const [description, setDescription] = useState('')
    const [date, setDate] = useState(new Date().toISOString().split('T')[0])
    const [currency, setCurrency] = useState('CLP')
    const [notes, setNotes] = useState('')

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

    // Monto manual (cuando no hay ítems seleccionados)
    const [manualAmount, setManualAmount] = useState<string>('')

    // Descuento
    const [discountType, setDiscountType] = useState<'fixed' | 'percentage'>('fixed')
    const [discountValue, setDiscountValue] = useState<number>(0)

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
                (supabase as any).from('clinic_settings').select('currency').eq('id', clinicId).single(),
            ])
            if (tutorsRes.data) { setTutors(tutorsRes.data as TutorOption[]); setFilteredTutors(tutorsRes.data as TutorOption[]) }
            if (servicesRes.data) setAvailableServices(servicesRes.data as ServiceOption[])
            if (productsRes.data) {
                const prods = productsRes.data.map((p: any) => ({ id: p.id, name: p.name, price: p.sale_price ?? 0 }))
                setAvailableProducts(prods)
                setFilteredProducts(prods)
            }
            if (clinicRes.data?.currency) setCurrency(clinicRes.data.currency)
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
    const hasItems = selectedServices.length > 0 || selectedProducts.length > 0
    const subtotal = hasItems ? serviceSubtotal + productSubtotal : Number(manualAmount || 0)
    const discountAmount = discountType === 'percentage'
        ? Math.round(subtotal * discountValue / 100)
        : Math.min(discountValue, subtotal)
    const finalAmount = Math.max(0, subtotal - discountAmount)

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

    const updateDescription = (services: ServiceOption[], products: ProductOption[]) => {
        const allItems = [...services.map(s => s.name), ...products.map(p => p.name)]
        if (allItems.length > 0) {
            setDescription(allItems.join(', '))
        } else if (selectedTutor) {
            setDescription(`Pago de ${selectedTutor.name}`)
        } else {
            setDescription('')
        }
    }

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        if (finalAmount <= 0 && subtotal <= 0) return
        const allServices = [
            ...selectedServices.map(s => ({ id: s.id, name: s.name, price: s.price, type: 'service' })),
            ...selectedProducts.map(p => ({ id: p.id, name: p.name, price: p.price, type: 'product' })),
        ]
        onSuccess({
            description,
            amount: finalAmount,
            discount: discountAmount,
            category: autoCategory,
            date,
            tutor_id: selectedTutor?.id,
            services: allServices.length > 0 ? allServices : undefined,
            notes: notes.trim() || undefined,
        })
    }

    return (
        <div className="fixed inset-0 bg-charcoal/50 z-50 flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white rounded-soft w-full max-w-lg shadow-xl flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-silk-beige">
                    <h3 className="text-xl font-bold text-charcoal flex items-center gap-2">
                        <Calculator className="w-5 h-5 text-primary-500" />
                        Registrar Nuevo Ingreso
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
                                    {formatMoney(serviceSubtotal + productSubtotal)}
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
                            </div>
                        )}
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
                            placeholder="Observaciones, método de pago, referencias..."
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
                        Registrar Ingreso
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
