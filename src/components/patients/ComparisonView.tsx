import { useState, useRef, useEffect } from 'react'
import { X, ArrowLeftRight } from 'lucide-react'

interface ComparisonViewProps {
    beforeImage: { url: string; date: string; treatment: string }
    afterImage: { url: string; date: string; treatment: string }
    onClose: () => void
}

export function ComparisonView({ beforeImage, afterImage, onClose }: ComparisonViewProps) {
    const [sliderPosition, setSliderPosition] = useState(50)
    const [isDragging, setIsDragging] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)

    const handleMove = (clientX: number) => {
        if (!containerRef.current) return

        const rect = containerRef.current.getBoundingClientRect()
        const x = Math.max(0, Math.min(clientX - rect.left, rect.width))
        const percent = (x / rect.width) * 100

        setSliderPosition(percent)
    }

    const handleMouseDown = () => setIsDragging(true)
    const handleTouchStart = () => setIsDragging(true)

    const handleMouseUp = () => setIsDragging(false)
    const handleTouchEnd = () => setIsDragging(false)

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDragging) return
        handleMove(e.clientX)
    }

    const handleTouchMove = (e: React.TouchEvent) => {
        if (!isDragging) return
        handleMove(e.touches[0].clientX)
    }

    useEffect(() => {
        if (isDragging) {
            window.addEventListener('mouseup', handleMouseUp)
            window.addEventListener('touchend', handleTouchEnd)
        } else {
            window.removeEventListener('mouseup', handleMouseUp)
            window.removeEventListener('touchend', handleTouchEnd)
        }
        return () => {
            window.removeEventListener('mouseup', handleMouseUp)
            window.removeEventListener('touchend', handleTouchEnd)
        }
    }, [isDragging])

    return (
        <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4 animate-fade-in">
            {/* Header */}
            <div className="w-full max-w-5xl flex justify-between items-center mb-4 text-white">
                <div>
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <ArrowLeftRight className="w-5 h-5" />
                        Comparación Antes / Después
                    </h2>
                    <p className="text-sm opacity-70">Desliza para ver la diferencia</p>
                </div>
                <button
                    onClick={onClose}
                    className="p-2 hover:bg-white/10 rounded-full transition-colors"
                >
                    <X className="w-6 h-6" />
                </button>
            </div>

            {/* Comparison Container */}
            <div
                ref={containerRef}
                className="relative w-full max-w-4xl aspect-[4/3] md:aspect-[16/9] bg-black rounded-lg overflow-hidden select-none cursor-ew-resize shadow-2xl"
                onMouseMove={handleMouseMove}
                onTouchMove={handleTouchMove}
            >
                {/* AFTER Image (Background) */}
                <div className="absolute inset-0">
                    <img
                        src={afterImage.url}
                        alt="Después"
                        className="w-full h-full object-contain"
                    />
                    <div className="absolute top-4 right-4 bg-black/60 px-3 py-1 rounded text-white text-sm font-medium backdrop-blur-sm pointer-events-none">
                        Después ({new Date(afterImage.date).toLocaleDateString()})
                        <div className="text-xs opacity-70">{afterImage.treatment}</div>
                    </div>
                </div>

                {/* BEFORE Image (Foreground - Clipped) */}
                <div
                    className="absolute inset-0 overflow-hidden border-r-2 border-white/50"
                    style={{ width: `${sliderPosition}%` }}
                >
                    <img
                        src={beforeImage.url}
                        alt="Antes"
                        className="absolute top-0 left-0 max-w-none h-full"
                        style={{ width: containerRef.current?.offsetWidth || '100%' }}
                    />
                    <div className="absolute top-4 left-4 bg-black/60 px-3 py-1 rounded text-white text-sm font-medium backdrop-blur-sm pointer-events-none">
                        Antes ({new Date(beforeImage.date).toLocaleDateString()})
                        <div className="text-xs opacity-70">{beforeImage.treatment}</div>
                    </div>
                </div>

                {/* Slider Handle */}
                <div
                    className="absolute top-0 bottom-0 w-1 bg-white cursor-ew-resize flex items-center justify-center drop-shadow-md"
                    style={{ left: `${sliderPosition}%` }}
                    onMouseDown={handleMouseDown}
                    onTouchStart={handleTouchStart}
                >
                    <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shadow-lg -ml-[1px]">
                        <ArrowLeftRight className="w-4 h-4 text-primary-600" />
                    </div>
                </div>
            </div>

            {/* Hint */}
            <div className="mt-6 flex items-center gap-8 text-white/60 text-sm">
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-white/20" />
                    <span>Antes: {new Date(beforeImage.date).toLocaleDateString()}</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-white/80" />
                    <span>Después: {new Date(afterImage.date).toLocaleDateString()}</span>
                </div>
            </div>
        </div>
    )
}
