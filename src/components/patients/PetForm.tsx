import { useState, useEffect } from 'react'
import { X, Loader2, Save, Dog } from 'lucide-react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Database, Patient } from '@/types/database'

interface PetFormProps {
    tutorId: string
    pet?: Patient | null
    onClose: () => void
    onSave: (pet?: Patient) => void
}

const speciesOptions = ['Perro', 'Gato', 'Ave', 'Reptil', 'Conejo', 'Otro']
const sexOptions = [
    { value: 'M', label: 'Macho' },
    { value: 'F', label: 'Hembra' },
    { value: 'MN', label: 'Macho Castrado' },
    { value: 'FN', label: 'Hembra Esterilizada' }
]

export function PetForm({ tutorId, pet, onClose, onSave }: PetFormProps) {
    const { profile } = useAuth()
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const [formData, setFormData] = useState({
        name: '',
        species: 'Perro',
        breed: '',
        color: '',
        sex: 'M' as 'M' | 'F' | 'MN' | 'FN',
        dob: '',
        is_sterilized: false,
        microchip_id: '',
        notes: ''
    })

    useEffect(() => {
        if (pet) {
            setFormData({
                name: pet.name || '',
                species: pet.species || 'Perro',
                breed: pet.breed || '',
                color: pet.color || '',
                sex: (pet.sex as any) || 'M',
                dob: pet.dob ? pet.dob.split('T')[0] : '',
                is_sterilized: pet.is_sterilized || false,
                microchip_id: pet.microchip_id || '',
                notes: pet.notes || ''
            })
        }
    }, [pet])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!profile?.clinic_id || !tutorId) return

        setLoading(true)
        setError(null)

        try {
            const petData: Database['public']['Tables']['patients']['Insert'] = {
                clinic_id: profile.clinic_id,
                tutor_id: tutorId,
                name: formData.name,
                species: formData.species,
                breed: formData.breed || null,
                color: formData.color || null,
                sex: formData.sex || null,
                dob: formData.dob || null,
                is_sterilized: formData.is_sterilized,
                microchip_id: formData.microchip_id || null,
                notes: formData.notes || null,
                status: 'alive'
            }

            let savedPet: Patient | null = null

            if (pet?.id) {
                // Update
                const { data, error: updateError } = await (supabase.from('patients') as any)
                    .update(petData)
                    .eq('id', pet.id)
                    .select()
                    .single()

                if (updateError) throw updateError
                savedPet = data
            } else {
                // Create
                const { data, error: createError } = await (supabase.from('patients') as any)
                    .insert([petData])
                    .select()
                    .single()

                if (createError) throw createError
                savedPet = data
            }

            onSave(savedPet || undefined)
            onClose()
        } catch (err: any) {
            console.error('Error saving pet:', err)
            setError(err.message || 'Error al guardar la mascota')
        } finally {
            setLoading(false)
        }
    }

    return createPortal(
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[99999] animate-fade-in p-4 backdrop-blur-sm">
            <div className="bg-white rounded-soft w-full max-w-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
                <div className="p-6 border-b border-silk-beige flex items-center justify-between bg-ivory rounded-t-soft">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
                            <Dog className="w-5 h-5 text-primary-600" />
                        </div>
                        <h2 className="text-xl font-bold text-charcoal uppercase tracking-tight">
                            {pet ? `Editar a ${pet.name}` : 'Registrar Nueva Mascota'}
                        </h2>
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

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="md:col-span-2">
                            <label className="block text-xs font-bold text-charcoal/60 uppercase tracking-widest mb-2 ml-1">
                                Nombre de la Mascota <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                required
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                className="input-soft font-bold"
                                placeholder="Ej: Max, Luna, Toby..."
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-charcoal/60 uppercase tracking-widest mb-2 ml-1">
                                Especie
                            </label>
                            <select
                                value={formData.species}
                                onChange={(e) => setFormData({ ...formData, species: e.target.value })}
                                className="input-soft font-bold"
                            >
                                {speciesOptions.map(s => (
                                    <option key={s} value={s}>{s}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-charcoal/60 uppercase tracking-widest mb-2 ml-1">
                                Raza
                            </label>
                            <input
                                type="text"
                                value={formData.breed}
                                onChange={(e) => setFormData({ ...formData, breed: e.target.value })}
                                className="input-soft font-bold"
                                placeholder="Ej: Poodle, Collie, Siames..."
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-charcoal/60 uppercase tracking-widest mb-2 ml-1">
                                Sexo
                            </label>
                            <div className="flex flex-wrap gap-2">
                                {sexOptions.map(opt => (
                                    <button
                                        key={opt.value}
                                        type="button"
                                        onClick={() => {
                                            const isSterilized = opt.value === 'MN' || opt.value === 'FN'
                                            setFormData({ 
                                                ...formData, 
                                                sex: opt.value as any,
                                                is_sterilized: isSterilized
                                            })
                                        }}
                                        className={`px-3 py-2 rounded-soft text-[10px] font-bold uppercase tracking-widest transition-all border ${
                                            formData.sex === opt.value 
                                            ? 'bg-primary-600 text-white border-primary-600 shadow-sm' 
                                            : 'bg-white text-charcoal/60 border-silk-beige hover:border-primary-200'
                                        }`}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-charcoal/60 uppercase tracking-widest mb-2 ml-1">
                                Fecha de Nacimiento (Aprox)
                            </label>
                            <input
                                type="date"
                                value={formData.dob}
                                onChange={(e) => setFormData({ ...formData, dob: e.target.value })}
                                className="input-soft font-bold"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-charcoal/60 uppercase tracking-widest mb-2 ml-1">
                                Microchip ID (Opcional)
                            </label>
                            <input
                                type="text"
                                value={formData.microchip_id}
                                onChange={(e) => setFormData({ ...formData, microchip_id: e.target.value })}
                                className="input-soft font-mono font-bold"
                                placeholder="ID del transponder..."
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-charcoal/60 uppercase tracking-widest mb-2 ml-1">
                                Color / Señas Particulares
                            </label>
                            <input
                                type="text"
                                value={formData.color}
                                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                                className="input-soft font-bold"
                                placeholder="Ej: Blanco con manchas cafés..."
                            />
                        </div>

                        <div className="md:col-span-2">
                            <label className="block text-xs font-bold text-charcoal/60 uppercase tracking-widest mb-2 ml-1">
                                Notas de Interés
                            </label>
                            <textarea
                                value={formData.notes}
                                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                className="input-soft min-h-[100px] resize-none text-sm font-medium"
                                placeholder="Alergias, conducta, datos relevantes..."
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
                            <><Loader2 className="w-5 h-5 animate-spin" /> Guardando...</>
                        ) : (
                            <><Save className="w-5 h-5" /> Registrar Mascota</>
                        )}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    )
}
