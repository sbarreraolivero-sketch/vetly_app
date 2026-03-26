
import { useState, useRef } from 'react'
import { Upload, X } from 'lucide-react'

interface PhotoUploadProps {
    onFileSelect: (file: File) => void
    selectedFile: File | null
    onClear: () => void
}

export function PhotoUpload({ onFileSelect, selectedFile, onClear }: PhotoUploadProps) {
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0]

            // Validate file type
            if (!file.type.startsWith('image/')) {
                alert('Por favor selecciona un archivo de imagen válido')
                return
            }

            // Validate file size (e.g. 5MB)
            if (file.size > 5 * 1024 * 1024) {
                alert('La imagen no debe superar los 5MB')
                return
            }

            onFileSelect(file)
            setPreviewUrl(URL.createObjectURL(file))
        }
    }

    const handleClear = () => {
        onClear()
        setPreviewUrl(null)
        if (fileInputRef.current) {
            fileInputRef.current.value = ''
        }
    }

    return (
        <div className="space-y-2">
            <label className="block text-sm font-medium text-charcoal">Adjuntar Foto</label>

            {!selectedFile ? (
                <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-silk-beige rounded-soft p-4 flex flex-col items-center justify-center cursor-pointer hover:bg-gray-50 transition-colors h-32"
                >
                    <input
                        type="file"
                        ref={fileInputRef}
                        className="hidden"
                        accept="image/*"
                        onChange={handleFileChange}
                    />
                    <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 mb-2">
                        <Upload className="w-5 h-5" />
                    </div>
                    <p className="text-xs text-charcoal/60 text-center">
                        <span className="font-medium text-primary-600">Sube una foto</span> o arrastra y suelta
                    </p>
                    <p className="text-xs font-bold text-charcoal/40 mt-1">PNG, JPG hasta 5MB</p>
                </div>
            ) : (
                <div className="relative rounded-soft overflow-hidden border border-silk-beige h-48 group">
                    {previewUrl && (
                        <img
                            src={previewUrl}
                            alt="Preview"
                            className="w-full h-full object-cover"
                        />
                    )}
                    <button
                        type="button"
                        onClick={handleClear}
                        className="absolute top-2 right-2 p-1.5 bg-white/90 text-charcoal/60 hover:text-red-500 rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-all"
                    >
                        <X className="w-4 h-4" />
                    </button>
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/50 to-transparent p-2">
                        <p className="text-xs text-white truncate px-1">{selectedFile.name}</p>
                    </div>
                </div>
            )}
        </div>
    )
}
