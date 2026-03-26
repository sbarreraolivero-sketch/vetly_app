import React, { useState, useEffect, useRef } from 'react'
import { FileText, Upload, Trash2, Search, Loader2, AlertCircle, File, Eye, X, Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { toast } from 'react-hot-toast'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'

interface PatientFilesProps {
    patientId: string
}

interface PatientFile {
    id: string
    file_name: string
    file_type: string
    file_url: string
    size_bytes: number
    storage_path: string
    title?: string
    description?: string
    created_at: string
}

export function PatientFiles({ patientId }: PatientFilesProps) {
    const { profile } = useAuth()
    const [files, setFiles] = useState<PatientFile[]>([])
    const [loading, setLoading] = useState(true)
    const [uploading, setUploading] = useState(false)
    const [searchTerm, setSearchTerm] = useState('')
    
    // Modal & New File State
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [selectedFile, setSelectedFile] = useState<File | null>(null)
    const [fileTitle, setFileTitle] = useState('')
    const [fileDescription, setFileDescription] = useState('')

    // Ref for file input to avoid delays
    const fileInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (patientId) {
            fetchFiles()
        }
    }, [patientId])

    const fetchFiles = async () => {
        try {
            setLoading(true)
            const { data, error } = await (supabase as any)
                .from('patient_files')
                .select('*')
                .eq('patient_id', patientId)
                .order('created_at', { ascending: false })

            if (error) {
                console.error('Error fetching files:', error)
                if (error.code === '42P01') {
                    setFiles([])
                    return
                }
                throw error
            }

            setFiles(data || [])
        } catch (error) {
            console.error('Error fetching files:', error)
            toast.error('Error al cargar los archivos.')
        } finally {
            setLoading(false)
        }
    }

    const resetUploadForm = () => {
        setSelectedFile(null)
        setFileTitle('')
        setFileDescription('')
        setIsModalOpen(false)
    }

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        if (file.size > 10 * 1024 * 1024) { // Increase to 10MB
            toast.error('El archivo es demasiado grande (máximo 10MB)')
            return
        }

        setSelectedFile(file)
        setFileTitle(file.name.split('.')[0])
        // Reset input value to allow selecting the same file again
        if (e.target) e.target.value = ''
    }

    const handleUpload = async () => {
        if (!selectedFile || !profile?.clinic_id) {
            toast.error('Selecciona un archivo primero')
            return
        }

        try {
            setUploading(true)
            const fileExt = selectedFile.name.split('.').pop()
            const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${fileExt}`
            const filePath = `${profile.clinic_id}/${patientId}/${fileName}`

            const { error: uploadError } = await supabase.storage
                .from('patient-documents')
                .upload(filePath, selectedFile)

            if (uploadError) throw new Error('Error al subir el archivo al almacenamiento')

            const { data: { publicUrl } } = supabase.storage
                .from('patient-documents')
                .getPublicUrl(filePath)

            const { error: dbError } = await (supabase as any)
                .from('patient_files')
                .insert({
                    patient_id: patientId,
                    clinic_id: profile.clinic_id,
                    file_name: selectedFile.name,
                    file_type: selectedFile.type,
                    file_url: publicUrl,
                    storage_path: filePath,
                    size_bytes: selectedFile.size,
                    title: fileTitle || selectedFile.name,
                    description: fileDescription
                })

            if (dbError) {
                await supabase.storage.from('patient-documents').remove([filePath])
                throw new Error('Error al registrar el archivo en la base de datos')
            }

            toast.success('Archivo subido con éxito')
            resetUploadForm()
            fetchFiles()
        } catch (error: any) {
            toast.error(error.message || 'Error al procesar la subida')
        } finally {
            setUploading(false)
        }
    }

    const handleDeleteFile = async (file: PatientFile) => {
        if (!confirm('¿Estás seguro de que deseas eliminar este archivo?')) return

        try {
            await supabase.storage.from('patient-documents').remove([file.storage_path])
            const { error: dbError } = await (supabase as any)
                .from('patient_files')
                .delete()
                .eq('id', file.id)

            if (dbError) throw dbError
            toast.success('Archivo eliminado')
            fetchFiles()
        } catch (error) {
            toast.error('Error al eliminar el archivo')
        }
    }

    const formatFileSize = (bytes: number) => {
        if (bytes === 0) return '0 Bytes'
        const k = 1024
        const sizes = ['Bytes', 'KB', 'MB']
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
    }

    const getFileTypeName = (type: string) => {
        const t = type.toLowerCase()
        if (t.includes('pdf')) return 'PDF'
        if (t.includes('image') || t.includes('png') || t.includes('jpg') || t.includes('jpeg')) return 'Imagen'
        if (t.includes('word') || t.includes('officedocument') || t.includes('docx')) return 'Word'
        if (t.includes('sheet') || t.includes('excel') || t.includes('csv')) return 'Excel'
        return t.split('/')[1]?.toUpperCase() || 'Archivo'
    }

    const filteredFiles = files.filter(f => 
        f.file_name.toLowerCase().includes(searchTerm.toLowerCase()) || 
        f.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        f.description?.toLowerCase().includes(searchTerm.toLowerCase())
    )

    return (
        <div className="space-y-6 animate-fade-in relative">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h3 className="text-xl font-black text-charcoal uppercase tracking-tighter">Archivos y Exámenes</h3>
                    <p className="text-charcoal/50 text-sm font-medium">Sube y gestiona documentos, resultados de laboratorio o radiografías.</p>
                </div>
                <button
                    onClick={() => setIsModalOpen(true)}
                    className="btn-primary flex items-center gap-2 shadow-premium bg-emerald-600 hover:bg-emerald-700 active:scale-95 transition-all py-2.5 px-6"
                >
                    <Plus className="w-5 h-5" />
                    <span>Subir Documento</span>
                </button>
            </div>

            {isModalOpen && (
                <div className="fixed inset-0 bg-charcoal/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-softer shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="p-6 border-b border-silk-beige flex justify-between items-center bg-ivory/50">
                            <div>
                                <h4 className="text-lg font-black text-charcoal uppercase tracking-tighter">Subir Nuevo Archivo</h4>
                                <p className="text-xs text-charcoal/50 font-bold uppercase tracking-widest mt-1">Completa los detalles del documento</p>
                            </div>
                            <button onClick={resetUploadForm} className="p-2 hover:bg-silk-beige rounded-full transition-colors text-charcoal/40">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-6 space-y-6">
                            {!selectedFile ? (
                                <div 
                                    onClick={() => fileInputRef.current?.click()}
                                    className="border-2 border-dashed border-silk-beige rounded-soft p-10 text-center hover:border-emerald-300 transition-colors group cursor-pointer"
                                >
                                    <input
                                        type="file"
                                        ref={fileInputRef}
                                        className="hidden"
                                        onChange={handleFileSelect}
                                        accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                                    />
                                    <div className="w-16 h-16 bg-ivory rounded-full flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                                        <Upload className="w-8 h-8 text-emerald-500" />
                                    </div>
                                    <p className="text-charcoal font-bold">Haz clic para seleccionar un archivo</p>
                                    <p className="text-xs text-charcoal/40 mt-1 font-medium italic">Sugeridos: PDF, JPG, PNG, DOCX (Máx 10MB)</p>
                                </div>
                            ) : (
                                <div className="bg-ivory/50 p-4 rounded-soft border border-silk-beige flex items-center gap-4">
                                    <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center text-emerald-600">
                                        <FileText className="w-6 h-6" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-bold text-charcoal truncate">{selectedFile.name}</p>
                                        <p className="text-[10px] text-charcoal/40 uppercase font-black">{formatFileSize(selectedFile.size)}</p>
                                    </div>
                                    <button onClick={() => setSelectedFile(null)} className="p-2 text-red-400 hover:text-red-600 font-bold text-xs uppercase px-3 hover:bg-red-50 rounded-soft transition-colors">
                                        Cambiar
                                    </button>
                                </div>
                            )}

                            <div className="space-y-4">
                                <div>
                                    <label className="text-[10px] font-black text-charcoal/40 uppercase tracking-widest block mb-1.5 ml-1">Título del Documento</label>
                                    <input
                                        type="text"
                                        placeholder="Ej: Radiografía de Cadera..."
                                        value={fileTitle}
                                        onChange={(e) => setFileTitle(e.target.value)}
                                        className="input-soft"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-charcoal/40 uppercase tracking-widest block mb-1.5 ml-1">Descripción (Opcional)</label>
                                    <textarea
                                        placeholder="Detalles adicionales..."
                                        value={fileDescription}
                                        onChange={(e) => setFileDescription(e.target.value)}
                                        className="input-soft min-h-[80px] resize-none"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="p-6 bg-ivory/30 border-t border-silk-beige flex gap-3">
                            <button onClick={resetUploadForm} className="flex-1 py-3 border border-silk-beige font-black text-charcoal/40 hover:bg-white rounded-soft uppercase tracking-widest text-sm transition-all">
                                Cancelar
                            </button>
                            <button
                                onClick={handleUpload}
                                disabled={!selectedFile || uploading}
                                className="flex-1 btn-primary py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2 group shadow-premium"
                            >
                                {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5 transition-transform group-hover:rotate-90" />}
                                <span className="font-black text-sm uppercase tracking-widest">
                                    {uploading ? 'Subiendo...' : 'Confirmar Subida'}
                                </span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal/30" />
                <input
                    type="text"
                    placeholder="Buscar archivos por nombre, título o descripción..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="input-soft pl-12 w-full focus:ring-2 focus:ring-emerald-100 transition-all"
                />
            </div>

            {loading ? (
                <div className="flex flex-col items-center justify-center py-24 bg-white rounded-softer border border-silk-beige">
                    <Loader2 className="w-10 h-10 animate-spin text-emerald-500 mb-4" />
                    <p className="text-charcoal/40 font-bold uppercase tracking-widest text-xs">Cargando expediente...</p>
                </div>
            ) : filteredFiles.length === 0 ? (
                <div className="bg-white rounded-softer border-2 border-dashed border-silk-beige p-20 text-center">
                    <FileText className="w-12 h-12 text-charcoal/10 mx-auto mb-6" />
                    <h4 className="text-xl font-black text-charcoal uppercase tracking-tighter">Sin documentos</h4>
                    <p className="text-charcoal/50 text-sm mt-2 max-w-xs mx-auto font-medium">Sube exámenes o radiografías para centralizar el historial.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredFiles.map((file) => (
                        <div key={file.id} className="bg-white rounded-soft border border-silk-beige shadow-sm hover:shadow-soft-lg transition-all group relative flex flex-col h-full overflow-hidden hover:border-emerald-200">
                            <div className="p-5 flex-1">
                                <div className="flex items-start gap-4 mb-3">
                                    <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 shrink-0 group-hover:scale-105 transition-transform">
                                        <File className="w-6 h-6" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h4 className="font-black text-charcoal uppercase tracking-tighter truncate leading-tight" title={file.title || file.file_name}>
                                            {file.title || file.file_name}
                                        </h4>
                                        <p className="text-[10px] text-charcoal/40 uppercase font-black tracking-widest mt-1">
                                            {formatFileSize(file.size_bytes)} • {new Date(file.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}
                                        </p>
                                    </div>
                                </div>
                                {file.description && (
                                    <p className="text-xs text-charcoal/60 font-medium italic mb-4 line-clamp-3">"{file.description}"</p>
                                )}
                                <div className="flex items-center gap-2 mt-auto">
                                    <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 py-1 px-2 rounded-full uppercase">
                                        {getFileTypeName(file.file_type)}
                                    </span>
                                    <span className="text-[10px] font-bold text-charcoal/30 truncate flex-1">{file.file_name}</span>
                                </div>
                            </div>

                            <div className="absolute top-4 right-4 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all translate-y-2 group-hover:translate-y-0">
                                <a
                                    href={file.file_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="p-2.5 bg-white shadow-soft-md hover:bg-emerald-50 rounded-soft text-charcoal/60 hover:text-emerald-600 border border-silk-beige transition-colors"
                                    title="Ver Documento"
                                >
                                    <Eye className="w-4 h-4" />
                                </a>
                                <button
                                    onClick={() => handleDeleteFile(file)}
                                    className="p-2.5 bg-white shadow-soft-md hover:bg-red-50 rounded-soft text-charcoal/60 hover:text-red-600 border border-silk-beige transition-colors"
                                    title="Eliminar"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <div className="bg-white rounded-softer p-6 border border-silk-beige shadow-sm flex flex-col md:flex-row gap-6 items-center">
                <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center shrink-0 border border-amber-100">
                    <AlertCircle className="w-8 h-8 text-amber-500" />
                </div>
                <div className="flex-1">
                    <p className="text-sm font-black text-charcoal uppercase tracking-tighter mb-1">Central de Documentación Segura</p>
                    <p className="text-xs text-charcoal/50 leading-relaxed font-medium">Los archivos son cifrados y solo accesibles por tu clínica. Usa títulos descriptivos para mejorar la búsqueda.</p>
                </div>
            </div>
        </div>
    )
}


