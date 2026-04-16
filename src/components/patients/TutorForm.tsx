import { useState, useEffect } from 'react'
import { X, Loader2, Save, MapPin, UserCheck } from 'lucide-react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Database, Tutor } from '@/types/database'

interface TutorFormProps {
    tutor?: Tutor | null
    onClose: () => void
    onSave: (tutor?: Tutor) => void
}

export function TutorForm({ tutor, onClose, onSave }: TutorFormProps) {
    const { profile } = useAuth()
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const [formData, setFormData] = useState({
        name: '',
        phone_number: '',
        email: '',
        address: '',
        notes: ''
    })

    useEffect(() => {
        if (tutor) {
            setFormData({
                name: tutor.name || '',
                phone_number: tutor.phone,
                email: tutor.email || '',
                address: tutor.address || '',
                notes: tutor.notes || ''
            })
        }
    }, [tutor])

    const formatPhoneNumber = (value: string) => {
        return value.replace(/\D/g, '')
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!profile?.clinic_id) return

        setLoading(true)
        setError(null)

        try {
            const cleanPhone = formatPhoneNumber(formData.phone_number)

            if (cleanPhone.length < 10) {
                throw new Error('El número de teléfono debe tener al menos 10 dígitos')
            }

            const tutorData: Database['public']['Tables']['tutors']['Insert'] = {
                clinic_id: profile.clinic_id,
                name: formData.name,
                phone: cleanPhone,
                email: formData.email || null,
                address: formData.address || null,
                notes: formData.notes || null,
            }

            let savedTutor: Tutor | null = null

            if (tutor?.id) {
                const { data, error: updateError } = await (supabase as any)
                    .from('tutors')
                    .update(tutorData)
                    .eq('id', tutor.id)
                    .eq('clinic_id', profile.clinic_id)
                    .select()
                    .single()

                if (updateError) throw updateError
                savedTutor = data
            } else {
                const { data: existing } = await (supabase as any)
                    .from('tutors')
                    .select('id')
                    .eq('clinic_id', profile.clinic_id)
                    .eq('phone', cleanPhone)
                    .maybeSingle()

                if (existing) {
                    throw new Error('Ya existe un tutor con este número de teléfono')
                }

                const { data, error: createError } = await (supabase as any)
                    .from('tutors')
                    .insert([tutorData])
                    .select()
                    .single()

                if (createError) throw createError
                savedTutor = data
            }

            onSave(savedTutor || undefined)
            onClose()
        } catch (err) {
            console.error('Error saving tutor:', err)
            setError(err instanceof Error ? err.message : 'Error al guardar el tutor')
        } finally {
            setLoading(false)
        }
    }

    return createPortal(
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[99999] animate-fade-in p-4 backdrop-blur-sm">
            <div className="bg-white rounded-soft w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
                <div className="p-6 border-b border-silk-beige flex items-center justify-between bg-primary-50/50 rounded-t-soft">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
                            <UserCheck className="w-5 h-5 text-primary-600" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-charcoal uppercase tracking-tight">
                                {tutor ? 'Actualizar Tutor' : 'Registro de Tutor'}
                            </h2>
                            <p className="text-[10px] text-charcoal/60 uppercase tracking-widest font-bold">Datos del Propietario</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-silk-beige rounded-full transition-colors"
                    >
                        <X className="w-5 h-5 text-charcoal/60" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-8 overflow-y-auto flex-1 space-y-6 bg-white scrollbar-soft">
                    {error && (
                        <div className="p-4 bg-red-50 text-red-600 text-sm rounded-soft flex items-center gap-2 border border-red-100 font-bold">
                            <X className="w-4 h-4" /> {error}
                        </div>
                    )}

                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-charcoal/60 uppercase tracking-widest mb-2 ml-1">
                                Nombre Completo <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                required
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                className="input-soft font-bold"
                                placeholder="Ej: Maria Perez"
                            />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-charcoal/60 uppercase tracking-widest mb-2 ml-1">
                                    Teléfono (WhatsApp) <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="tel"
                                    required
                                    value={formData.phone_number}
                                    onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })}
                                    className="input-soft font-bold"
                                    placeholder="Ej: 521234567890"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-charcoal/60 uppercase tracking-widest mb-2 ml-1">
                                    Email
                                </label>
                                <input
                                    type="email"
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    className="input-soft font-bold"
                                    placeholder="ejemplo@correo.com"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-charcoal/60 uppercase tracking-widest mb-2 ml-1 flex items-center justify-between">
                                <span className="flex items-center gap-1.5">
                                    <MapPin className="w-3.5 h-3.5 text-primary-500" />
                                    Dirección de Residencia
                                </span>
                            </label>
                            <input
                                type="text"
                                value={formData.address}
                                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                className="input-soft font-bold"
                                placeholder="Ej: Av. Principal 123, Colonia, Ciudad"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-charcoal/60 uppercase tracking-widest mb-2 ml-1">
                                Notas Internas / Observaciones
                            </label>
                            <textarea
                                value={formData.notes}
                                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                className="input-soft min-h-[100px] resize-none text-sm font-medium"
                                placeholder="Datos relevantes sobre el tutor, trato preferencial, etc."
                            />
                        </div>
                    </div>
                </form>

                <div className="p-6 border-t border-silk-beige flex justify-end gap-3 bg-gray-50/50 rounded-b-soft">
                    <button
                        type="button"
                        onClick={onClose}
                        className="btn-ghost text-xs font-bold uppercase tracking-widest"
                        disabled={loading}
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={loading}
                        className="btn-primary flex items-center gap-3 py-3 px-8 shadow-premium text-xs font-bold uppercase tracking-widest"
                    >
                        {loading ? (
                            <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</>
                        ) : (
                            <><Save className="w-5 h-5" /> Guardar Tutor</>
                        )}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    )
}
