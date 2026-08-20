import React, { useState, useEffect } from 'react'
import { X, Search, Plus, Minus, Trash2, Calculator, Percent, Tag, Package, FileText, CreditCard, PenLine, Gift, Sparkles } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

// `price` es SIEMPRE el precio unitario (el del catálogo) dentro del componente.
// El total de la línea se deriva multiplicando por `quantity`, y recién al guardar
// se persiste ya multiplicado — ver handleSubmit.
interface ServiceOption {
    id: string
    name: string
    price: number
    quantity: number
}

interface ProductOption {
    id: string
    name: string
    price: number  // sale_price unitario
    quantity: number
}

interface TutorOption {
    id: string
    name: string
    loyalty_points: number
    referred_by: string | null
}

interface LoyaltyConfig {
    enabled: boolean
    earnPercentage: number
    welcomeBonus: number
    welcomeBonusType: 'fixed' | 'percentage'
    referralBonus: number
    pointsName: string
    symbol: string
}

// Motivos de descuento predefinidos. Antes era un texto libre opcional y el
// resultado fue 0 de 39 descuentos con motivo: sin esto, el reporte muestra
// cuánto se regaló pero nunca por qué. Un clic tiene fricción casi nula.
const DISCOUNT_REASONS = [
    'Promoción / pack',
    'Cliente frecuente',
    'Convenio',
    'Caso social',
    'Ajuste de cobro',
    'Otro',
] as const

const PAYMENT_OPTIONS = [
    { value: 'efectivo',      label: 'Efectivo' },
    { value: 'transferencia', label: 'Transferencia' },
    { value: 'tarjeta',       label: 'Tarjeta crédito' },
    { value: 'debito',        label: 'Tarjeta débito' },
]

// Stepper de cantidad por línea. No baja de 1: quitar la línea es el botón de
// basurero, para que un clic de más no borre sin querer una venta ya cargada.
function QtyStepper({ value, onChange, accent }: {
    value: number
    onChange: (qty: number) => void
    accent: 'primary' | 'violet'
}) {
    const atMin = value <= 1
    const btn = "w-6 h-6 flex items-center justify-center rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
    const tone = accent === 'primary'
        ? "text-primary-700 hover:bg-primary-100"
        : "text-violet-700 hover:bg-violet-100"
    return (
        <div className="flex items-center gap-0.5">
            <button
                type="button"
                onClick={() => onChange(value - 1)}
                disabled={atMin}
                className={cn(btn, tone)}
                title={atMin ? 'Usa el basurero para quitar la línea' : 'Quitar una unidad'}
                aria-label="Quitar una unidad"
            >
                <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="w-6 text-center font-bold text-charcoal tabular-nums" aria-live="polite">
                {value}
            </span>
            <button
                type="button"
                onClick={() => onChange(value + 1)}
                className={cn(btn, tone)}
                title="Agregar una unidad"
                aria-label="Agregar una unidad"
            >
                <Plus className="w-3.5 h-3.5" />
            </button>
        </div>
    )
}

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
    loyalty_redeemed?: number | null
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
        loyalty_redeemed?: number
        /** Tutor que recomendó a este cliente, elegido a mano en su primera compra. */
        referrer_id?: string
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
    // Un motivo guardado que no esté en la lista (ej. texto libre antiguo) se
    // edita como "Otro" con su texto, en vez de perderse.
    const initialReason = editingIncome?.discount_reason ?? ''
    const [reasonChoice, setReasonChoice] = useState<string>(
        !initialReason ? '' : (DISCOUNT_REASONS as readonly string[]).includes(initialReason) ? initialReason : 'Otro'
    )
    const [reasonOther, setReasonOther] = useState<string>(
        initialReason && !(DISCOUNT_REASONS as readonly string[]).includes(initialReason) ? initialReason : ''
    )
    // IVA
    const [ivaEnabled, setIvaEnabled] = useState(false)
    const [ivaRate, setIvaRate] = useState(19)

    // Fidelización
    const [loyaltyCfg, setLoyaltyCfg] = useState<LoyaltyConfig | null>(null)
    const [loyaltyRedeemed, setLoyaltyRedeemed] = useState<number>(editingIncome?.loyalty_redeemed ?? 0)
    // Escape para ventas sin cliente identificado (mostrador, cliente de paso).
    // Sin esto, exigir tutor dejaría a caja sin forma de registrar el ingreso.
    const [allowNoTutor, setAllowNoTutor] = useState(false)
    // `null` mientras se resuelve: evita anunciar el bono equivocado en el preview.
    const [tutorHasPrevious, setTutorHasPrevious] = useState<boolean | null>(null)
    // Referidor elegido a mano. La detección automática del código solo existe en
    // el canal de WhatsApp con IA; sin esto, un cliente que llega recomendado por
    // teléfono o de palabra no puede registrarse, y en el plan Core (sin IA) el
    // programa de referidos sería inalcanzable.
    const [referrerId, setReferrerId] = useState<string | null>(null)
    const [referrerSearch, setReferrerSearch] = useState('')
    const [showReferrerDropdown, setShowReferrerDropdown] = useState(false)

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
                supabase.from('tutors').select('id, name, loyalty_points, referred_by').eq('clinic_id', clinicId).order('name'),
                (supabase as any).from('clinic_services').select('id, name, price').eq('clinic_id', clinicId).order('name'),
                (supabase as any).from('inventory_products').select('id, name, sale_price').eq('clinic_id', clinicId).eq('is_active', true).order('name'),
                (supabase as any).from('clinic_settings').select(
                    'currency, iva_enabled, iva_rate, loyalty_enabled, loyalty_points_percentage, ' +
                    'loyalty_welcome_bonus, loyalty_welcome_bonus_type, loyalty_referral_bonus, ' +
                    'loyalty_points_name, loyalty_currency_symbol'
                ).eq('id', clinicId).single(),
            ])

            if (tutorsRes.data) {
                const list = (tutorsRes.data as any[]).map(t => ({
                    id: t.id,
                    name: t.name,
                    loyalty_points: t.loyalty_points ?? 0,
                    referred_by: t.referred_by ?? null,
                })) as TutorOption[]
                setTutors(list)
                setFilteredTutors(list)
                // Pre-rellenar tutor en modo edición
                if (editingIncome?.tutor_id) {
                    const found = list.find(t => t.id === editingIncome.tutor_id)
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

            if (clinicRes.data) {
                setLoyaltyCfg({
                    enabled:          clinicRes.data.loyalty_enabled ?? false,
                    earnPercentage:   Number(clinicRes.data.loyalty_points_percentage ?? 0),
                    welcomeBonus:     Number(clinicRes.data.loyalty_welcome_bonus ?? 0),
                    welcomeBonusType: (clinicRes.data.loyalty_welcome_bonus_type ?? 'fixed') as 'fixed' | 'percentage',
                    referralBonus:    Number(clinicRes.data.loyalty_referral_bonus ?? 0),
                    pointsName:       clinicRes.data.loyalty_points_name || 'Puntos',
                    symbol:           clinicRes.data.loyalty_currency_symbol || 'pts',
                })
            }

            // Pre-rellenar servicios/productos en modo edición.
            // Lo guardado trae `price` como total de línea, pero el componente trabaja
            // con precio unitario: se divide por la cantidad. Los ingresos anteriores a
            // este cambio no tienen `quantity`, así que caen a 1 y quedan idénticos —
            // no hace falta backfill de datos.
            if (editingIncome?.services && editingIncome.services.length > 0) {
                const svc = editingIncome.services.filter((s: any) => s.type === 'service')
                const prd = editingIncome.services.filter((s: any) => s.type === 'product')
                const toOption = (it: any) => {
                    const qty = Math.max(1, Number(it.quantity) || 1)
                    return { id: it.id, name: it.name, price: (Number(it.price) || 0) / qty, quantity: qty }
                }
                if (svc.length > 0) setSelectedServices(svc.map(toOption))
                if (prd.length > 0) setSelectedProducts(prd.map(toOption))
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

    // ¿El tutor ya compró antes? Define si esta venta acumula el % de recompra o
    // si es su primera (y entonces solo gana algo si llegó referido). En modo
    // edición se excluye el propio ingreso para no contarlo como compra previa.
    useEffect(() => {
        let cancelled = false
        if (!selectedTutor || !clinicId) { setTutorHasPrevious(null); return }
        ;(async () => {
            let q = (supabase as any)
                .from('incomes')
                .select('id')
                .eq('clinic_id', clinicId)
                .eq('tutor_id', selectedTutor.id)
                .limit(1)
            if (editingIncome?.id) q = q.neq('id', editingIncome.id)
            const { data, error } = await q
            if (cancelled) return
            // Ante un error de red preferimos no anunciar nada a anunciar mal:
            // `null` deja el preview oculto en vez de prometer un bono equivocado.
            setTutorHasPrevious(error ? null : (data?.length ?? 0) > 0)
        })()
        return () => { cancelled = true }
    }, [selectedTutor?.id, clinicId, editingIncome?.id])

    // Al cambiar de tutor, el canje y el referidor del anterior dejan de tener sentido.
    useEffect(() => {
        if (!selectedTutor) setLoyaltyRedeemed(0)
        setReferrerId(null)
        setReferrerSearch('')
    }, [selectedTutor?.id])

    const serviceSubtotal = selectedServices.reduce((sum, s) => sum + Number(s.price || 0) * (s.quantity || 1), 0)
    const productSubtotal = selectedProducts.reduce((sum, p) => sum + Number(p.price || 0) * (p.quantity || 1), 0)
    const customSubtotal = customItems.reduce((sum, i) => sum + Number(i.price || 0), 0)
    const hasItems = selectedServices.length > 0 || selectedProducts.length > 0 || customItems.length > 0
    const subtotal = hasItems ? serviceSubtotal + productSubtotal + customSubtotal : Number(manualAmount || 0)
    const discountAmount = discountType === 'percentage'
        ? Math.round(subtotal * discountValue / 100)
        : Math.min(discountValue, subtotal)
    const afterDiscount = Math.max(0, subtotal - discountAmount)

    // ── Canje ──────────────────────────────────────────────────────────────
    // Nunca puede superar el saldo del tutor ni el monto de la boleta. El RPC
    // vuelve a topearlo del lado del servidor; esto es solo la barrera visual.
    const loyaltyActive  = !!loyaltyCfg?.enabled
    const tutorBalance   = selectedTutor?.loyalty_points ?? 0
    const maxRedeemable  = Math.min(tutorBalance, afterDiscount)
    const redeemAmount   = loyaltyActive && selectedTutor
        ? Math.max(0, Math.min(Math.round(loyaltyRedeemed), maxRedeemable))
        : 0

    const finalAmount = Math.max(0, afterDiscount - redeemAmount)
    const ivaAmount = ivaEnabled && finalAmount > 0
        ? Math.round(finalAmount * ivaRate / (100 + ivaRate))
        : 0
    const netAmount = finalAmount - ivaAmount

    // ── Qué acumulará esta venta ───────────────────────────────────────────
    // Espeja exactamente la lógica de sync_income_loyalty: la bienvenida es
    // exclusiva de clientes referidos; el resto acumula solo desde la 2ª compra.
    // Es la primera compra y no tiene referidor registrado: el momento exacto en
    // que preguntar "¿quién te recomendó?" tiene sentido, porque es cuando se paga.
    const isFirstPurchase   = loyaltyActive && !!selectedTutor && tutorHasPrevious === false
    const canAssignReferrer = isFirstPurchase && !selectedTutor!.referred_by
    const effectiveReferrer = selectedTutor?.referred_by ?? referrerId

    const loyaltyPreview: { amount: number; label: string } | null = (() => {
        if (!loyaltyActive || !selectedTutor || finalAmount <= 0 || tutorHasPrevious === null) return null
        if (!tutorHasPrevious) {
            if (!effectiveReferrer) return null
            const amount = loyaltyCfg!.welcomeBonusType === 'percentage'
                ? Math.round(finalAmount * loyaltyCfg!.welcomeBonus / 100)
                : loyaltyCfg!.welcomeBonus
            return amount > 0 ? { amount, label: 'Bono de bienvenida por referido' } : null
        }
        const amount = Math.round(finalAmount * loyaltyCfg!.earnPercentage / 100)
        return amount > 0 ? { amount, label: `Acumulación ${loyaltyCfg!.earnPercentage}% por recompra` } : null
    })()

    // El referidor no puede ser el propio comprador ni un tutor inexistente.
    const referrerOptions = referrerSearch.trim()
        ? tutors.filter(t =>
            t.id !== selectedTutor?.id &&
            t.name.toLowerCase().includes(referrerSearch.trim().toLowerCase())
          ).slice(0, 8)
        : []
    const selectedReferrer = referrerId ? tutors.find(t => t.id === referrerId) : null

    // Con el programa activo, una venta sin tutor es saldo que el cliente
    // reclamará después y no existe. En Linares eso pasaba en 1 de cada 4 ventas.
    const tutorRequired = loyaltyActive && subtotal > 0 && !selectedTutor && !allowNoTutor

    // Motivo efectivo que se guarda: el chip elegido, o el texto libre si es "Otro".
    const effectiveDiscountReason = reasonChoice === 'Otro' ? reasonOther.trim() : reasonChoice
    // Con descuento, el motivo es obligatorio.
    const discountReasonMissing = discountAmount > 0 && !effectiveDiscountReason

    // Categoría auto-calculada
    const autoCategory = selectedProducts.length > 0 && selectedServices.length === 0 ? 'product' : 'service'

    const handleSelectTutor = (tutor: TutorOption) => {
        setSelectedTutor(tutor)
        setTutorSearch(tutor.name)
        setShowTutorDropdown(false)
        if (!description) setDescription(`Pago de ${tutor.name}`)
    }

    const clearTutor = () => { setSelectedTutor(null); setTutorSearch('') }

    // El input de tutor es de texto libre + dropdown: si el usuario escribe un
    // nombre y hace clic fuera (o presiona Enter) sin elegir una sugerencia,
    // `selectedTutor` queda en null y el ingreso se guarda sin tutor vinculado
    // aunque el campo "se vea lleno". Al perder el foco, intentamos resolver
    // el texto escrito contra la lista de tutores antes de dejarlo huérfano.
    const resolveTutorFromSearch = () => {
        if (selectedTutor || !tutorSearch.trim()) return
        const match = tutors.find(t => t.name.toLowerCase() === tutorSearch.trim().toLowerCase())
            ?? (filteredTutors.length === 1 ? filteredTutors[0] : null)
        if (match) {
            setSelectedTutor(match)
            setTutorSearch(match.name)
        }
    }

    // Delay para no pisar el click sobre una sugerencia del dropdown (el blur
    // del input dispara antes que el click del ítem que se está seleccionando).
    const handleTutorBlur = () => { setTimeout(resolveTutorFromSearch, 150) }

    const handleTutorSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault()
            if (filteredTutors.length > 0) handleSelectTutor(filteredTutors[0])
        }
    }

    const tutorNeedsResolution = !selectedTutor && tutorSearch.trim().length > 0

    // Si el servicio ya está en la venta, sube su cantidad en vez de crear una fila
    // repetida: el caso real es "3 mascotas del mismo tutor, misma vacuna", y antes
    // obligaba a rebuscar el servicio en el desplegable una vez por unidad.
    const addService = (service: Omit<ServiceOption, 'quantity'>) => {
        const existing = selectedServices.findIndex(s => s.id === service.id)
        const newList = existing >= 0
            ? selectedServices.map((s, i) => i === existing ? { ...s, quantity: s.quantity + 1 } : s)
            : [...selectedServices, { ...service, quantity: 1 }]
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

    // El stepper nunca baja de 1: quitar la línea es el botón de basurero, para que
    // un clic de más no borre sin querer una línea de varios miles.
    const setServiceQty = (index: number, qty: number) => {
        const newList = selectedServices.map((s, i) =>
            i === index ? { ...s, quantity: Math.max(1, qty) } : s)
        setSelectedServices(newList)
        updateDescription(newList, selectedProducts)
    }

    const addProduct = (product: Omit<ProductOption, 'quantity'>) => {
        const existing = selectedProducts.findIndex(p => p.id === product.id)
        const newList = existing >= 0
            ? selectedProducts.map((p, i) => i === existing ? { ...p, quantity: p.quantity + 1 } : p)
            : [...selectedProducts, { ...product, quantity: 1 }]
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

    const setProductQty = (index: number, qty: number) => {
        const newList = selectedProducts.map((p, i) =>
            i === index ? { ...p, quantity: Math.max(1, qty) } : p)
        setSelectedProducts(newList)
        updateDescription(selectedServices, newList)
    }

    const updateDescription = (services: ServiceOption[], products: ProductOption[], custom?: { name: string; price: number }[]) => {
        const used = custom ?? customItems
        // Con cantidad > 1 se sufija "(×N)" — mismo formato que ya usa el historial
        // del tutor. Como las líneas se dedupean, el nombre nunca se repite.
        const withQty = (name: string, qty: number) => qty > 1 ? `${name} (×${qty})` : name
        const allItems = [
            ...services.map(s => withQty(s.name, s.quantity || 1)),
            ...products.map(p => withQty(p.name, p.quantity || 1)),
            ...used.map(i => i.name),
        ]
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
        if (discountReasonMissing) return
        if (tutorRequired) return
        // `price` se guarda como TOTAL de la línea (unitario × cantidad), que es lo
        // que ya significaba antes de que existiera `quantity`. Así los consumidores
        // del array (prorrateo de descuentos, métricas por ítem, historial del tutor)
        // siguen sumando `price` sin enterarse del cambio. `quantity` viaja aparte
        // para quien necesite las unidades reales — hoy, el descuento de stock.
        const allServices = [
            ...selectedServices.map(s => ({
                id: s.id, name: s.name,
                price: s.price * (s.quantity || 1), quantity: s.quantity || 1, type: 'service',
            })),
            ...selectedProducts.map(p => ({
                id: p.id, name: p.name,
                price: p.price * (p.quantity || 1), quantity: p.quantity || 1, type: 'product',
            })),
            ...customItems.map(i => ({ id: `custom-${Date.now()}-${Math.random()}`, name: i.name, price: i.price, quantity: 1, type: 'custom' })),
        ]
        onSuccess({
            description,
            amount:          finalAmount,
            discount:        discountAmount,
            discount_reason: effectiveDiscountReason || undefined,
            iva_amount:      ivaAmount || undefined,
            category:        autoCategory,
            date,
            tutor_id:        selectedTutor?.id,
            services:        allServices.length > 0 ? allServices : undefined,
            notes:           notes.trim() || undefined,
            payment_method:  paymentMethod || undefined,
            loyalty_redeemed: redeemAmount || 0,
            referrer_id:      canAssignReferrer && referrerId ? referrerId : undefined,
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
                        <label className="block text-sm font-medium text-charcoal mb-1">
                            {loyaltyActive ? 'Tutor Asociado' : 'Tutor Asociado (Opcional)'}
                        </label>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal/40" />
                            <input
                                type="text"
                                value={tutorSearch}
                                onChange={e => { setTutorSearch(e.target.value); setShowTutorDropdown(true); if (!e.target.value) setSelectedTutor(null) }}
                                onFocus={() => setShowTutorDropdown(true)}
                                onBlur={handleTutorBlur}
                                onKeyDown={handleTutorSearchKeyDown}
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
                        {!showTutorDropdown && tutorNeedsResolution && (
                            <p className="text-xs text-amber-600 mt-1">
                                ⚠ Este ingreso se guardará sin tutor vinculado. Selecciona uno de la lista o borra el texto.
                            </p>
                        )}

                        {/* Sin tutor no hay a quién acreditar los pesos de la venta. */}
                        {tutorRequired && !tutorNeedsResolution && (
                            <div className="mt-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                                <p className="text-xs text-amber-700 font-semibold">
                                    Selecciona el tutor para que la venta acumule sus {loyaltyCfg?.pointsName}.
                                </p>
                                <label className="flex items-center gap-2 mt-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={allowNoTutor}
                                        onChange={e => setAllowNoTutor(e.target.checked)}
                                        className="w-3.5 h-3.5 accent-amber-500"
                                    />
                                    <span className="text-xs text-amber-700/80">
                                        Venta sin cliente registrado (no acumula)
                                    </span>
                                </label>
                            </div>
                        )}
                    </div>

                    {/* Saldo de fidelización y canje */}
                    {loyaltyActive && selectedTutor && (
                        <div className={cn(
                            "rounded-xl border px-4 py-3",
                            tutorBalance > 0
                                ? "bg-gradient-to-br from-primary-50 to-emerald-50 border-primary-200"
                                : "bg-ivory border-silk-beige"
                        )}>
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2 min-w-0">
                                    <Gift className={cn("w-4 h-4 shrink-0", tutorBalance > 0 ? "text-primary-600" : "text-charcoal/30")} />
                                    <div className="min-w-0">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-charcoal/40 leading-none">
                                            {loyaltyCfg?.pointsName} acumulados
                                        </p>
                                        <p className={cn("text-lg font-black leading-tight", tutorBalance > 0 ? "text-primary-700" : "text-charcoal/40")}>
                                            {formatMoney(tutorBalance)}
                                        </p>
                                    </div>
                                </div>
                                {tutorBalance > 0 && maxRedeemable > 0 && redeemAmount === 0 && (
                                    <button
                                        type="button"
                                        onClick={() => setLoyaltyRedeemed(maxRedeemable)}
                                        className="shrink-0 px-3 py-2 bg-primary-600 text-white rounded-lg text-xs font-bold hover:bg-primary-700 transition-colors"
                                    >
                                        Canjear {formatMoney(maxRedeemable)}
                                    </button>
                                )}
                            </div>

                            {tutorBalance > 0 && maxRedeemable > 0 && (
                                <div className="mt-3 pt-3 border-t border-primary-200/60">
                                    <label className="block text-xs font-semibold text-charcoal/70 mb-1.5">
                                        ¿Desea canjear sus {loyaltyCfg?.pointsName}?
                                    </label>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="number"
                                            min={0}
                                            max={maxRedeemable}
                                            value={loyaltyRedeemed || ''}
                                            onChange={e => setLoyaltyRedeemed(Number(e.target.value) || 0)}
                                            placeholder="0"
                                            className="input-soft flex-1"
                                        />
                                        {redeemAmount > 0 && (
                                            <button
                                                type="button"
                                                onClick={() => setLoyaltyRedeemed(0)}
                                                className="px-3 py-2 text-xs font-bold text-charcoal/50 hover:text-red-500 transition-colors"
                                            >
                                                Quitar
                                            </button>
                                        )}
                                    </div>
                                    <p className="text-[11px] text-charcoal/40 mt-1.5">
                                        Máximo canjeable en esta boleta: {formatMoney(maxRedeemable)}
                                    </p>
                                </div>
                            )}

                            {tutorBalance === 0 && !canAssignReferrer && (
                                <p className="text-xs text-charcoal/40 mt-1">Aún no tiene saldo acumulado.</p>
                            )}

                            {/* Primera compra sin referidor registrado: es el único momento
                                en que el bono de bienvenida y el premio al referidor pueden
                                pagarse, así que aquí es donde se pregunta. */}
                            {canAssignReferrer && (
                                <div className="mt-3 pt-3 border-t border-primary-200/60 relative">
                                    <label className="block text-xs font-semibold text-charcoal/70 mb-1.5">
                                        Primera visita — ¿alguien lo recomendó? <span className="font-normal text-charcoal/40">(opcional)</span>
                                    </label>

                                    {selectedReferrer ? (
                                        <div className="flex items-center justify-between gap-2 bg-white border border-primary-200 rounded-lg px-3 py-2">
                                            <span className="text-sm font-semibold text-charcoal truncate">
                                                Recomendado por {selectedReferrer.name}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => { setReferrerId(null); setReferrerSearch('') }}
                                                className="shrink-0 text-charcoal/40 hover:text-red-500 transition-colors"
                                            >
                                                <X className="w-4 h-4" />
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="relative">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal/40" />
                                            <input
                                                type="text"
                                                value={referrerSearch}
                                                onChange={e => { setReferrerSearch(e.target.value); setShowReferrerDropdown(true) }}
                                                onFocus={() => setShowReferrerDropdown(true)}
                                                className="input-soft pl-9"
                                                placeholder="Buscar quién lo recomendó..."
                                            />
                                        </div>
                                    )}

                                    {showReferrerDropdown && !selectedReferrer && referrerOptions.length > 0 && (
                                        <div className="absolute z-20 w-full mt-1 bg-white border border-silk-beige rounded-soft shadow-lg max-h-40 overflow-y-auto">
                                            {referrerOptions.map(t => (
                                                <div
                                                    key={t.id}
                                                    onClick={() => {
                                                        setReferrerId(t.id)
                                                        setReferrerSearch('')
                                                        setShowReferrerDropdown(false)
                                                    }}
                                                    className="px-4 py-2 hover:bg-silk-beige cursor-pointer text-sm text-charcoal transition-colors"
                                                >
                                                    {t.name}
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {selectedReferrer && loyaltyCfg && (
                                        <p className="text-[11px] text-charcoal/50 mt-1.5">
                                            {selectedReferrer.name} recibirá {formatMoney(loyaltyCfg.referralBonus)} al guardar esta venta.
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

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
                                    <div key={service.id} className="flex items-center justify-between bg-primary-50 px-3 py-2 rounded-md text-sm gap-2">
                                        <span className="text-charcoal min-w-0 truncate">{service.name}</span>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <QtyStepper
                                                value={service.quantity}
                                                onChange={q => setServiceQty(idx, q)}
                                                accent="primary"
                                            />
                                            <span className="font-medium text-primary-700 w-20 text-right">
                                                {formatMoney(service.price * service.quantity)}
                                            </span>
                                            <button type="button" onClick={() => removeService(idx)} className="text-red-400 hover:text-red-500" title="Quitar servicio">
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
                                    <div key={product.id} className="flex items-center justify-between bg-violet-50 px-3 py-2 rounded-md text-sm gap-2">
                                        <span className="text-charcoal min-w-0 truncate">{product.name}</span>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <QtyStepper
                                                value={product.quantity}
                                                onChange={q => setProductQty(idx, q)}
                                                accent="violet"
                                            />
                                            <span className="font-medium text-violet-700 w-20 text-right">
                                                {formatMoney(product.price * product.quantity)}
                                            </span>
                                            <button type="button" onClick={() => removeProduct(idx)} className="text-red-400 hover:text-red-500" title="Quitar producto">
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
                            <div className="pt-1">
                                <label className="block text-xs font-semibold text-charcoal mb-1.5">
                                    Motivo del descuento <span className="text-red-500">*</span>
                                </label>
                                <div className="flex flex-wrap gap-1.5">
                                    {DISCOUNT_REASONS.map(r => (
                                        <button
                                            key={r}
                                            type="button"
                                            onClick={() => setReasonChoice(reasonChoice === r ? '' : r)}
                                            className={cn(
                                                'px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all',
                                                reasonChoice === r
                                                    ? 'bg-amber-500 text-white border-amber-500 shadow-sm'
                                                    : 'bg-white border-silk-beige text-charcoal/60 hover:border-amber-300 hover:text-amber-700'
                                            )}
                                        >{r}</button>
                                    ))}
                                </div>
                                {reasonChoice === 'Otro' && (
                                    <input
                                        type="text"
                                        maxLength={80}
                                        autoFocus
                                        className="mt-2 w-full text-sm border border-amber-200 bg-amber-50 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-300 placeholder:text-amber-400 text-amber-900"
                                        placeholder="Escribe el motivo"
                                        value={reasonOther}
                                        onChange={e => setReasonOther(e.target.value)}
                                    />
                                )}
                                {discountReasonMissing && (
                                    <p className="text-xs text-amber-600 mt-1.5">
                                        Indica el motivo para poder guardar. Sirve para saber después
                                        qué descuentos conviene mantener.
                                    </p>
                                )}
                            </div>
                        )}

                        {subtotal > 0 && (
                            <div className="pt-2 space-y-1 text-sm border-t border-silk-beige">
                                {(discountAmount > 0 || redeemAmount > 0) && (
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
                                {redeemAmount > 0 && (
                                    <div className="flex justify-between text-primary-600">
                                        <span>{loyaltyCfg?.pointsName} canjeados</span>
                                        <span>−{formatMoney(redeemAmount)}</span>
                                    </div>
                                )}
                                <div className="flex justify-between font-bold text-charcoal">
                                    <span>Total a registrar</span>
                                    <span className="text-primary-600">{formatMoney(finalAmount)}</span>
                                </div>
                                {loyaltyPreview && (
                                    <div className="flex items-center gap-1.5 pt-1 text-xs text-emerald-700">
                                        <Sparkles className="w-3.5 h-3.5 shrink-0" />
                                        <span>
                                            Acumulará <strong>{formatMoney(loyaltyPreview.amount)}</strong> — {loyaltyPreview.label}
                                        </span>
                                    </div>
                                )}
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
                        disabled={(finalAmount <= 0 && subtotal <= 0) || discountReasonMissing || tutorRequired}
                        className="btn-primary disabled:opacity-50"
                    >
                        {isEdit ? 'Guardar cambios' : 'Registrar Ingreso'}
                    </button>
                </div>
            </div>

            {(showTutorDropdown || showServiceDropdown || showReferrerDropdown) && (
                <div className="fixed inset-0 z-0"
                    onClick={() => { setShowTutorDropdown(false); setShowServiceDropdown(false); setShowProductDropdown(false); setShowReferrerDropdown(false) }} />
            )}
        </div>
    )
}
