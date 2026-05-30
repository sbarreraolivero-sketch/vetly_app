import { useState, useRef, useCallback } from 'react'
import {
    X, Upload, Loader2, Sparkles, Package,
    CheckCircle2, AlertCircle, Trash2, FileText,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { inventoryService } from '@/services/inventoryService'
import { cn } from '@/lib/utils'
import { toast } from 'react-hot-toast'

const MAX_PAGES   = 5
const CREDIT_COST = 20

const CATEGORY_LABELS: Record<string, string> = {
    medication: 'Medicamento', vaccine: 'Vacuna', antiparasitic: 'Antiparasitario',
    anesthetic: 'Anestésico', antibiotic: 'Antibiótico', anti_inflammatory: 'Antiinflamatorio',
    vitamin: 'Vitamina / Suplemento', disinfectant: 'Desinfectante', surgical: 'Mat. quirúrgico',
    food: 'Alimento', accessory: 'Accesorio', supply: 'Insumo', other: 'Otro',
}

export interface ExtractedProduct {
    name: string
    quantity: number
    unit_price: number
    category: string
    sku: string
    selected: boolean
}

interface Props {
    clinicId: string
    currency: string
    onClose: () => void
    onSuccess: () => void
}

// Renderiza cada página de un PDF a JPEG base64 (máx MAX_PAGES páginas)
async function pdfToImages(file: File): Promise<{ images: string[]; totalPages: number }> {
    // Importación dinámica — solo se carga cuando se usa PDF
    const pdfjsLib = await import('pdfjs-dist')
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
    ).toString()

    const arrayBuffer = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
    const totalPages = pdf.numPages
    const pagesToProcess = Math.min(totalPages, MAX_PAGES)
    const images: string[] = []

    for (let i = 1; i <= pagesToProcess; i++) {
        const page = await pdf.getPage(i)
        const viewport = page.getViewport({ scale: 2 })   // 2x para mejor legibilidad
        const canvas = document.createElement('canvas')
        canvas.width  = viewport.width
        canvas.height = viewport.height
        const ctx = canvas.getContext('2d')!
        await page.render({ canvasContext: ctx, viewport, canvas }).promise
        images.push(canvas.toDataURL('image/jpeg', 0.92).split(',')[1])
    }

    return { images, totalPages }
}

export function InvoiceAnalysisModal({ clinicId, currency, onClose, onSuccess }: Props) {
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [dragOver, setDragOver]         = useState(false)
    const [fileInfo, setFileInfo]         = useState<{ name: string; isPdf: boolean } | null>(null)
    const [imagePreview, setImagePreview] = useState<string | null>(null)
    const [step, setStep]     = useState<'upload' | 'analyzing' | 'review'>('upload')
    const [analyzeStatus, setAnalyzeStatus] = useState('')
    const [products, setProducts]   = useState<ExtractedProduct[]>([])
    const [invoiceMeta, setInvoiceMeta] = useState<{
        supplier?: string; invoice_number?: string; invoice_date?: string; pages_processed?: number
    }>({})
    const [saving, setSaving] = useState(false)

    const formatMoney = (n: number) =>
        new Intl.NumberFormat('es-CL', { style: 'currency', currency, maximumFractionDigits: currency === 'CLP' ? 0 : 2 }).format(n)

    const reset = () => {
        setStep('upload'); setFileInfo(null); setImagePreview(null)
        setProducts([]); setInvoiceMeta({}); setAnalyzeStatus('')
    }

    const callEdgeFunction = async (base64: string, mimeType: string) => {
        const { data, error } = await supabase.functions.invoke('analyze-invoice', {
            body: { clinic_id: clinicId, file_base64: base64, mime_type: mimeType }
        })
        if (error) throw new Error(error.message)
        if (data?.error) throw new Error(data.error)
        return data
    }

    const processFile = useCallback(async (file: File) => {
        const isPdf  = file.type === 'application/pdf'
        const isImage = file.type.startsWith('image/')

        if (!isPdf && !isImage) {
            toast.error('Solo se aceptan imágenes (JPG, PNG, WEBP) o archivos PDF.')
            return
        }
        if (file.size > 20 * 1024 * 1024) {
            toast.error('El archivo no puede superar 20 MB')
            return
        }

        setFileInfo({ name: file.name, isPdf })
        setStep('analyzing')

        try {
            let allProducts: ExtractedProduct[] = []
            let meta: typeof invoiceMeta = {}

            if (isPdf) {
                setAnalyzeStatus('Procesando PDF...')
                const { images, totalPages } = await pdfToImages(file)

                for (let i = 0; i < images.length; i++) {
                    setAnalyzeStatus(`Analizando página ${i + 1} de ${images.length}...`)
                    const data = await callEdgeFunction(images[i], 'image/jpeg')
                    const pageProducts: ExtractedProduct[] = (data.products ?? []).map((p: any) => ({
                        ...p, selected: true,
                    }))
                    allProducts = [...allProducts, ...pageProducts]
                    // Tomar meta de la primera página
                    if (i === 0) {
                        meta = {
                            supplier:       data.supplier,
                            invoice_number: data.invoice_number,
                            invoice_date:   data.invoice_date,
                            pages_processed: Math.min(totalPages, MAX_PAGES),
                        }
                        if (totalPages > MAX_PAGES) {
                            toast(`Solo se procesaron ${MAX_PAGES} de ${totalPages} páginas`, { icon: 'ℹ️' })
                        }
                    }
                }

                // Deduplicar productos por nombre (sumar cantidades si coinciden)
                const deduped = new Map<string, ExtractedProduct>()
                for (const p of allProducts) {
                    const key = p.name.toLowerCase().trim()
                    if (deduped.has(key)) {
                        const existing = deduped.get(key)!
                        deduped.set(key, { ...existing, quantity: existing.quantity + p.quantity })
                    } else {
                        deduped.set(key, p)
                    }
                }
                allProducts = Array.from(deduped.values())

                // Preview de la primera página como imagen
                setImagePreview(`data:image/jpeg;base64,${images[0]}`)
            } else {
                // Imagen normal
                setAnalyzeStatus('Analizando imagen...')
                const base64 = await new Promise<string>((resolve, reject) => {
                    const r = new FileReader()
                    r.onload = () => resolve((r.result as string).split(',')[1])
                    r.onerror = reject
                    r.readAsDataURL(file)
                })

                // Preview
                const previewUrl = await new Promise<string>((resolve) => {
                    const r = new FileReader()
                    r.onload = () => resolve(r.result as string)
                    r.readAsDataURL(file)
                })
                setImagePreview(previewUrl)

                const data = await callEdgeFunction(base64, file.type)
                allProducts = (data.products ?? []).map((p: any) => ({ ...p, selected: true }))
                meta = {
                    supplier:       data.supplier,
                    invoice_number: data.invoice_number,
                    invoice_date:   data.invoice_date,
                }
            }

            setProducts(allProducts)
            setInvoiceMeta(meta)
            setStep('review')
        } catch (err: any) {
            toast.error(err.message ?? 'Error al analizar el archivo')
            reset()
        }
    }, [clinicId])

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault(); setDragOver(false)
        const file = e.dataTransfer.files[0]
        if (file) processFile(file)
    }

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (file) processFile(file)
    }

    const toggleProduct  = (idx: number) =>
        setProducts(p => p.map((item, i) => i === idx ? { ...item, selected: !item.selected } : item))

    const updateProduct  = (idx: number, field: keyof ExtractedProduct, value: any) =>
        setProducts(p => p.map((item, i) => i === idx ? { ...item, [field]: value } : item))

    const removeProduct  = (idx: number) =>
        setProducts(p => p.filter((_, i) => i !== idx))

    const selectedProducts = products.filter(p => p.selected)

    const handleConfirm = async () => {
        if (selectedProducts.length === 0) { toast.error('Selecciona al menos un producto'); return }
        setSaving(true)
        try {
            await inventoryService.bulkReceiveProducts(clinicId, selectedProducts.map(p => ({
                name: p.name, quantity: p.quantity, purchase_price: p.unit_price,
                category: p.category, sku: p.sku,
            })))
            toast.success(`${selectedProducts.length} producto${selectedProducts.length > 1 ? 's' : ''} agregado${selectedProducts.length > 1 ? 's' : ''} al inventario`)
            onSuccess(); onClose()
        } catch (err: any) {
            toast.error(err.message ?? 'Error al guardar productos')
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="fixed inset-0 bg-charcoal/50 z-50 flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-silk-beige shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-violet-100 rounded-xl flex items-center justify-center">
                            <Sparkles className="w-5 h-5 text-violet-600" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-charcoal">Analizar Factura con IA</h3>
                            <p className="text-xs text-charcoal/50">{CREDIT_COST} créditos · hasta {MAX_PAGES} páginas por archivo</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-silk-beige rounded-soft transition-colors">
                        <X className="w-5 h-5 text-charcoal/50" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto">

                    {/* ── UPLOAD ─────────────────────────────────────── */}
                    {step === 'upload' && (
                        <div className="p-8">
                            <div
                                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                                onDragLeave={() => setDragOver(false)}
                                onDrop={handleDrop}
                                onClick={() => fileInputRef.current?.click()}
                                className={cn(
                                    "border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all",
                                    dragOver
                                        ? "border-violet-400 bg-violet-50"
                                        : "border-silk-beige hover:border-violet-300 hover:bg-violet-50/30"
                                )}
                            >
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp,application/pdf"
                                    className="hidden"
                                    onChange={handleFileChange}
                                />
                                <div className="w-16 h-16 bg-violet-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                                    <Upload className="w-8 h-8 text-violet-500" />
                                </div>
                                <p className="text-base font-bold text-charcoal mb-1">
                                    Arrastra tu factura aquí
                                </p>
                                <p className="text-sm text-charcoal/50 mb-4">
                                    o haz clic para seleccionar un archivo
                                </p>
                                <div className="flex items-center justify-center gap-3 text-xs text-charcoal/40">
                                    <span className="flex items-center gap-1">
                                        <FileText className="w-3.5 h-3.5" /> PDF
                                    </span>
                                    <span>·</span>
                                    <span>JPG / PNG / WEBP</span>
                                    <span>·</span>
                                    <span>máx. 20 MB</span>
                                </div>
                            </div>

                            <div className="mt-6 bg-violet-50 rounded-xl p-4 border border-violet-100">
                                <p className="text-xs font-bold text-violet-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                    <Sparkles className="w-3.5 h-3.5" /> Cómo funciona
                                </p>
                                <ol className="text-sm text-charcoal/70 space-y-1 list-decimal list-inside">
                                    <li>Sube el PDF o foto de tu factura de compra</li>
                                    <li>La IA extrae productos, cantidades y precios automáticamente</li>
                                    <li>Revisa y corrige los datos si es necesario</li>
                                    <li>Confirma — los productos se agregan al inventario con stock actualizado</li>
                                </ol>
                                <p className="text-xs text-violet-600 mt-2 font-medium">
                                    PDFs de múltiples páginas: se procesan las primeras {MAX_PAGES} páginas, {CREDIT_COST} créditos por archivo.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* ── ANALYZING ──────────────────────────────────── */}
                    {step === 'analyzing' && (
                        <div className="p-12 flex flex-col items-center gap-6">
                            {imagePreview && (
                                <img src={imagePreview} alt="Preview"
                                    className="max-h-40 rounded-xl object-contain border border-silk-beige shadow-sm" />
                            )}
                            {!imagePreview && fileInfo && (
                                <div className="w-20 h-20 bg-violet-50 rounded-2xl flex flex-col items-center justify-center border border-violet-100">
                                    <FileText className="w-8 h-8 text-violet-400 mb-1" />
                                    <span className="text-[10px] text-violet-400 font-bold uppercase">PDF</span>
                                </div>
                            )}
                            <div className="flex flex-col items-center gap-3">
                                <div className="w-14 h-14 bg-violet-100 rounded-2xl flex items-center justify-center">
                                    <Loader2 className="w-8 h-8 text-violet-500 animate-spin" />
                                </div>
                                <p className="text-base font-bold text-charcoal">
                                    {analyzeStatus || 'Analizando...'}
                                </p>
                                {fileInfo && (
                                    <p className="text-sm text-charcoal/40 max-w-xs truncate">{fileInfo.name}</p>
                                )}
                            </div>
                        </div>
                    )}

                    {/* ── REVIEW ─────────────────────────────────────── */}
                    {step === 'review' && (
                        <div className="p-6 space-y-4">

                            {/* Meta */}
                            <div className="flex gap-4">
                                {imagePreview && (
                                    <img src={imagePreview} alt="Factura"
                                        className="w-20 h-20 rounded-xl object-cover border border-silk-beige shadow-sm shrink-0" />
                                )}
                                {!imagePreview && fileInfo?.isPdf && (
                                    <div className="w-20 h-20 bg-violet-50 rounded-xl flex flex-col items-center justify-center border border-violet-100 shrink-0">
                                        <FileText className="w-7 h-7 text-violet-400 mb-0.5" />
                                        <span className="text-[10px] text-violet-400 font-bold uppercase">PDF</span>
                                    </div>
                                )}
                                <div className="flex-1 space-y-1 text-sm">
                                    {invoiceMeta.supplier && (
                                        <p><span className="text-charcoal/40 text-xs uppercase tracking-wider">Proveedor</span><br />
                                            <span className="font-semibold text-charcoal">{invoiceMeta.supplier}</span>
                                        </p>
                                    )}
                                    <div className="flex gap-4 flex-wrap">
                                        {invoiceMeta.invoice_number && (
                                            <p><span className="text-charcoal/40 text-xs uppercase tracking-wider">N° Factura</span><br />
                                                <span className="font-medium">{invoiceMeta.invoice_number}</span>
                                            </p>
                                        )}
                                        {invoiceMeta.invoice_date && (
                                            <p><span className="text-charcoal/40 text-xs uppercase tracking-wider">Fecha</span><br />
                                                <span className="font-medium">{invoiceMeta.invoice_date}</span>
                                            </p>
                                        )}
                                        {invoiceMeta.pages_processed && invoiceMeta.pages_processed > 1 && (
                                            <p><span className="text-charcoal/40 text-xs uppercase tracking-wider">Páginas</span><br />
                                                <span className="font-medium">{invoiceMeta.pages_processed}</span>
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-1">
                                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                                        <span className="text-xs text-emerald-600 font-medium">
                                            {products.length} producto{products.length !== 1 ? 's' : ''} detectado{products.length !== 1 ? 's' : ''} · {CREDIT_COST} créditos usados
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Tabla */}
                            <div className="border border-silk-beige rounded-xl overflow-hidden">
                                <div className="bg-silk-beige/30 px-4 py-2.5 grid grid-cols-[auto_1fr_72px_80px_100px_32px] gap-2 text-[10px] font-black uppercase tracking-wider text-charcoal/50">
                                    <span>✓</span>
                                    <span>Producto</span>
                                    <span className="text-right">Cant.</span>
                                    <span className="text-right">P. compra</span>
                                    <span>Categoría</span>
                                    <span />
                                </div>
                                <div className="divide-y divide-silk-beige/50 max-h-72 overflow-y-auto">
                                    {products.map((p, idx) => (
                                        <div key={idx} className={cn(
                                            "px-4 py-2.5 grid grid-cols-[auto_1fr_72px_80px_100px_32px] gap-2 items-center text-sm",
                                            !p.selected && "opacity-40"
                                        )}>
                                            <input type="checkbox" checked={p.selected}
                                                onChange={() => toggleProduct(idx)}
                                                className="w-4 h-4 accent-primary-500 cursor-pointer" />
                                            <input value={p.name}
                                                onChange={e => updateProduct(idx, 'name', e.target.value)}
                                                className="text-charcoal font-medium bg-transparent border-0 focus:outline-none focus:ring-1 focus:ring-primary-400 rounded px-1 -mx-1 truncate" />
                                            <input type="number" min="0" step="1"
                                                value={p.quantity || ''}
                                                onChange={e => updateProduct(idx, 'quantity', Number(e.target.value) || 1)}
                                                className="text-right text-charcoal/70 bg-transparent border border-silk-beige rounded px-1 w-full" />
                                            <input type="number" min="0"
                                                value={p.unit_price || ''}
                                                onChange={e => updateProduct(idx, 'unit_price', Number(e.target.value) || 0)}
                                                className="text-right text-charcoal/70 bg-transparent border border-silk-beige rounded px-1 w-full" />
                                            <select value={p.category}
                                                onChange={e => updateProduct(idx, 'category', e.target.value)}
                                                className="w-full text-xs text-charcoal/70 bg-transparent border border-silk-beige rounded px-1 py-0.5 cursor-pointer">
                                                {Object.entries(CATEGORY_LABELS).map(([v, l]) => (
                                                    <option key={v} value={v}>{l}</option>
                                                ))}
                                            </select>
                                            <button onClick={() => removeProduct(idx)}
                                                className="text-red-400 hover:text-red-500 flex items-center justify-center">
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Resumen */}
                            {selectedProducts.length > 0 && (
                                <div className="bg-emerald-50 rounded-xl px-4 py-3 flex items-center justify-between border border-emerald-100">
                                    <div className="flex items-center gap-2">
                                        <Package className="w-4 h-4 text-emerald-600" />
                                        <span className="text-sm font-semibold text-emerald-700">
                                            {selectedProducts.length} producto{selectedProducts.length > 1 ? 's' : ''} a agregar
                                        </span>
                                    </div>
                                    <span className="text-sm font-bold text-emerald-700">
                                        Inversión: {formatMoney(selectedProducts.reduce((s, p) => s + p.quantity * p.unit_price, 0))}
                                    </span>
                                </div>
                            )}

                            {products.length === 0 && (
                                <div className="flex items-center gap-2 p-4 bg-amber-50 rounded-xl border border-amber-100">
                                    <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                                    <p className="text-sm text-amber-700">
                                        No se detectaron productos. Intenta con una imagen más nítida o un PDF de mejor calidad.
                                    </p>
                                </div>
                            )}

                            <button onClick={reset} className="text-xs text-charcoal/40 hover:text-charcoal underline">
                                Analizar otro archivo
                            </button>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-silk-beige shrink-0 flex justify-end gap-3 bg-ivory rounded-b-2xl">
                    <button onClick={onClose} className="btn-ghost">Cancelar</button>
                    {step === 'review' && (
                        <button
                            onClick={handleConfirm}
                            disabled={saving || selectedProducts.length === 0}
                            className="btn-primary disabled:opacity-50 flex items-center gap-2"
                        >
                            {saving
                                ? <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</>
                                : <><Package className="w-4 h-4" /> Agregar {selectedProducts.length} al inventario</>
                            }
                        </button>
                    )}
                </div>
            </div>
        </div>
    )
}
