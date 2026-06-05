import { useState, useRef } from 'react'
import {
    X,
    Banknote,
    ArrowRightLeft,
    CreditCard,
    Paperclip,
    FileText,
    Image,
    Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'

interface CajaExpenseModalProps {
    clinicId: string
    date: string                // 'YYYY-MM-DD'
    dateLabel: string
    currency: string
    userId: string
    onSave: (expense: {
        description: string
        amount: number
        category: string
        payment_method: string | null
        receipt_url: string | null
        date: string
    }) => void
    onCancel: () => void
}

const CATEGORIES = [
    { value: 'supplies',  label: 'Insumos' },
    { value: 'other',     label: 'Combustible / Traslado' },
    { value: 'utilities', label: 'Alimentación' },
    { value: 'rent',      label: 'Alquiler / Espacio' },
    { value: 'payroll',   label: 'Personal' },
    { value: 'marketing', label: 'Marketing' },
]

const PAYMENT_METHODS = [
    { value: 'efectivo',      label: 'Efectivo',    icon: <Banknote className="w-3.5 h-3.5" /> },
    { value: 'transferencia', label: 'Transferencia', icon: <ArrowRightLeft className="w-3.5 h-3.5" /> },
    { value: 'tarjeta',       label: 'Tarjeta cré.', icon: <CreditCard className="w-3.5 h-3.5" /> },
    { value: 'debito',        label: 'Débito',      icon: <CreditCard className="w-3.5 h-3.5" /> },
]

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
const ACCEPTED_TYPES = 'image/jpeg,image/png,image/webp,image/heic,application/pdf'
const ACCEPTED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']

// Deriva extensión del MIME type, nunca del nombre de archivo (evita path traversal)
const MIME_TO_EXT: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
    'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf',
}

export function CajaExpenseModal({
    clinicId,
    date,
    dateLabel,
    currency,
    onSave,
    onCancel,
}: CajaExpenseModalProps) {
    const [description, setDescription] = useState('')
    const [amount, setAmount] = useState<number | ''>('')
    const [category, setCategory] = useState('supplies')
    const [paymentMethod, setPaymentMethod] = useState<string | null>(null)
    const [file, setFile] = useState<File | null>(null)
    const [filePreview, setFilePreview] = useState<string | null>(null)
    const [uploading, setUploading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [dragOver, setDragOver] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const handleFile = (f: File) => {
        if (!ACCEPTED_MIME.includes(f.type)) {
            alert('Tipo de archivo no permitido. Usa JPG, PNG, WEBP, HEIC o PDF.')
            return
        }
        if (f.size > MAX_FILE_SIZE) {
            alert('El archivo no puede superar 10 MB')
            return
        }
        setFile(f)
        if (f.type.startsWith('image/')) {
            const reader = new FileReader()
            reader.onload = e => setFilePreview(e.target?.result as string)
            reader.readAsDataURL(f)
        } else {
            setFilePreview(null)
        }
    }

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        setDragOver(false)
        const f = e.dataTransfer.files[0]
        if (f) handleFile(f)
    }

    const handleSave = async () => {
        if (!description.trim() || !amount || Number(amount) <= 0) return
        setSaving(true)
        try {
            let receiptUrl: string | null = null

            if (file) {
                setUploading(true)
                const tempId = crypto.randomUUID()
                // Extensión derivada del MIME type, no del nombre (evita manipulación)
                const ext = MIME_TO_EXT[file.type] ?? 'bin'
                const storagePath = `${clinicId}/${tempId}.${ext}`
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { error: uploadError } = await (supabase as any).storage
                    .from('expense-receipts')
                    .upload(storagePath, file, { upsert: true, contentType: file.type })
                setUploading(false)
                if (uploadError) {
                    console.warn('No se pudo subir la boleta:', uploadError.message)
                    // No bloquear el guardado — el gasto se registra igual
                } else {
                    // Guardamos el PATH, no la URL pública — el bucket es privado
                    // La URL firmada se genera on-demand al visualizar
                    receiptUrl = storagePath
                }
            }

            onSave({
                description: description.trim(),
                amount: Number(amount),
                category,
                payment_method: paymentMethod,
                receipt_url: receiptUrl,
                date,
            })
        } finally {
            setSaving(false)
        }
    }

    const canSave = description.trim().length > 0 && Number(amount) > 0 && !saving

    return (
        <div className="fixed inset-0 bg-charcoal/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-sm max-h-[95vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-silk-beige shrink-0">
                    <div>
                        <h3 className="font-bold text-charcoal">Registrar gasto</h3>
                        <p className="text-xs text-charcoal/50 mt-0.5 capitalize">{dateLabel}</p>
                    </div>
                    <button onClick={onCancel} className="text-charcoal/40 hover:text-charcoal">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                    {/* Descripción */}
                    <div>
                        <label className="block text-xs font-semibold text-charcoal mb-1.5">Descripción *</label>
                        <input
                            type="text"
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder="Ej: Gasolina, jeringas, guantes..."
                            className="input-soft w-full text-sm"
                            autoFocus
                        />
                    </div>

                    {/* Monto */}
                    <div>
                        <label className="block text-xs font-semibold text-charcoal mb-1.5">Monto *</label>
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-charcoal/50 text-sm font-medium">{currency}</span>
                            <input
                                type="number"
                                min="0"
                                step="100"
                                value={amount || ''}
                                onChange={e => setAmount(Number(e.target.value) || '')}
                                placeholder="0"
                                className="input-soft w-full text-sm pl-7"
                            />
                        </div>
                    </div>

                    {/* Medio de pago */}
                    <div>
                        <label className="block text-xs font-semibold text-charcoal mb-1.5">Medio de pago</label>
                        <div className="grid grid-cols-2 gap-1.5">
                            {PAYMENT_METHODS.map(m => (
                                <button
                                    key={m.value}
                                    type="button"
                                    onClick={() => setPaymentMethod(v => v === m.value ? null : m.value)}
                                    className={cn(
                                        'flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-semibold transition-all',
                                        paymentMethod === m.value
                                            ? 'bg-rose-500 text-white border-rose-500'
                                            : 'bg-white text-charcoal/60 border-silk-beige hover:border-rose-300 hover:text-rose-600'
                                    )}
                                >
                                    {m.icon}
                                    {m.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Categoría */}
                    <div>
                        <label className="block text-xs font-semibold text-charcoal mb-1.5">Categoría</label>
                        <select
                            value={category}
                            onChange={e => setCategory(e.target.value)}
                            className="input-soft w-full text-sm"
                        >
                            {CATEGORIES.map(c => (
                                <option key={c.value} value={c.value}>{c.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* Adjuntar boleta */}
                    <div>
                        <label className="block text-xs font-semibold text-charcoal mb-1.5 flex items-center gap-1.5">
                            <Paperclip className="w-3.5 h-3.5" /> Boleta / Comprobante (opcional)
                        </label>

                        {file ? (
                            <div className="border border-silk-beige rounded-xl p-3 flex items-start gap-3">
                                {filePreview ? (
                                    <img src={filePreview} alt="preview" className="w-16 h-16 object-cover rounded-lg shrink-0" />
                                ) : (
                                    <div className="w-16 h-16 bg-rose-50 rounded-lg flex items-center justify-center shrink-0">
                                        <FileText className="w-7 h-7 text-rose-400" />
                                    </div>
                                )}
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold text-charcoal truncate">{file.name}</p>
                                    <p className="text-[11px] text-charcoal/40 mt-0.5">{(file.size / 1024).toFixed(0)} KB</p>
                                    <button
                                        onClick={() => { setFile(null); setFilePreview(null) }}
                                        className="text-[11px] text-rose-500 hover:text-rose-700 mt-1 font-medium"
                                    >
                                        Quitar archivo
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div
                                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                                onDragLeave={() => setDragOver(false)}
                                onDrop={handleDrop}
                                onClick={() => fileInputRef.current?.click()}
                                className={cn(
                                    'border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-colors',
                                    dragOver
                                        ? 'border-rose-400 bg-rose-50'
                                        : 'border-silk-beige hover:border-rose-300 hover:bg-rose-50/40'
                                )}
                            >
                                <Image className="w-6 h-6 text-charcoal/30 mx-auto mb-2" />
                                <p className="text-xs font-semibold text-charcoal/60">Arrastra una foto o</p>
                                <p className="text-xs text-charcoal/40 mt-0.5">JPG, PNG, PDF · máx 10 MB</p>
                                {/* capture="environment" permite abrir la cámara trasera en mobile */}
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept={ACCEPTED_TYPES}
                                    capture="environment"
                                    className="hidden"
                                    onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }}
                                />
                                <button
                                    type="button"
                                    className="mt-2 text-xs font-bold text-rose-600 hover:text-rose-700"
                                    onClick={e => { e.stopPropagation(); fileInputRef.current?.click() }}
                                >
                                    Elegir archivo / Tomar foto
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="flex gap-3 p-5 pt-0 shrink-0">
                    <button onClick={onCancel} className="flex-1 btn-secondary py-2 text-sm">
                        Cancelar
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={!canSave || uploading}
                        className="flex-1 bg-rose-600 text-white font-semibold py-2 rounded-lg text-sm hover:bg-rose-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {(saving || uploading) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        {uploading ? 'Subiendo...' : saving ? 'Guardando...' : 'Registrar gasto'}
                    </button>
                </div>
            </div>
        </div>
    )
}
