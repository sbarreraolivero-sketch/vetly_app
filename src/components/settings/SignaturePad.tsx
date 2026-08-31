import { useEffect, useRef, useState } from 'react'
import { Eraser, Check } from 'lucide-react'

interface SignaturePadProps {
    onSave: (blob: Blob) => void
    saving?: boolean
    disabled?: boolean
}

/**
 * Pad de firma para dibujar con mouse / dedo / lápiz. Exporta un PNG con
 * fondo transparente y trazo oscuro, listo para estampar sobre un documento
 * blanco (la receta pública). Sin dependencias — canvas + pointer events.
 */
export function SignaturePad({ onSave, saving, disabled }: SignaturePadProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const drawingRef = useRef(false)
    const lastRef = useRef<{ x: number; y: number } | null>(null)
    const [hasContent, setHasContent] = useState(false)

    // Ajusta la resolución interna del canvas al tamaño en pantalla × DPR.
    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const resize = () => {
            const rect = canvas.getBoundingClientRect()
            const dpr = window.devicePixelRatio || 1
            canvas.width = Math.round(rect.width * dpr)
            canvas.height = Math.round(rect.height * dpr)
            const ctx = canvas.getContext('2d')
            if (ctx) {
                ctx.scale(dpr, dpr)
                ctx.lineJoin = 'round'
                ctx.lineCap = 'round'
                ctx.lineWidth = 2.2
                ctx.strokeStyle = '#1a1a1a'
            }
        }
        resize()
        window.addEventListener('resize', resize)
        return () => window.removeEventListener('resize', resize)
    }, [])

    const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const rect = e.currentTarget.getBoundingClientRect()
        return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }

    const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (disabled) return
        e.currentTarget.setPointerCapture(e.pointerId)
        drawingRef.current = true
        lastRef.current = pos(e)
    }

    const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!drawingRef.current) return
        const ctx = canvasRef.current?.getContext('2d')
        const last = lastRef.current
        if (!ctx || !last) return
        const p = pos(e)
        ctx.beginPath()
        ctx.moveTo(last.x, last.y)
        ctx.lineTo(p.x, p.y)
        ctx.stroke()
        lastRef.current = p
        if (!hasContent) setHasContent(true)
    }

    const end = () => {
        drawingRef.current = false
        lastRef.current = null
    }

    const clear = () => {
        const canvas = canvasRef.current
        const ctx = canvas?.getContext('2d')
        if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
        setHasContent(false)
    }

    const save = () => {
        const canvas = canvasRef.current
        if (!canvas || !hasContent) return
        canvas.toBlob(blob => { if (blob) onSave(blob) }, 'image/png')
    }

    return (
        <div className="space-y-3">
            <canvas
                ref={canvasRef}
                onPointerDown={start}
                onPointerMove={move}
                onPointerUp={end}
                onPointerLeave={end}
                onPointerCancel={end}
                className="w-full h-40 bg-white border border-silk-beige rounded-xl touch-none cursor-crosshair"
            />
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={clear}
                    disabled={disabled || !hasContent}
                    className="btn-ghost text-xs uppercase font-bold tracking-widest flex items-center gap-1.5 disabled:opacity-40"
                >
                    <Eraser className="w-3.5 h-3.5" /> Limpiar
                </button>
                <button
                    type="button"
                    onClick={save}
                    disabled={disabled || !hasContent || saving}
                    className="btn-primary py-1.5 px-4 text-xs uppercase font-bold tracking-widest flex items-center gap-1.5 disabled:opacity-40"
                >
                    <Check className="w-3.5 h-3.5" /> {saving ? 'Guardando...' : 'Usar esta firma'}
                </button>
            </div>
        </div>
    )
}
