
import { useState, useEffect } from 'react'
import { Plus, Loader2, Tag as TagIcon, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'

interface Tag {
    id: string
    name: string
    color: string
}

const PRESET_COLORS = [
    '#EF4444', // Red
    '#F97316', // Orange
    '#F59E0B', // Amber
    '#10B981', // Emerald
    '#06B6D4', // Cyan
    '#3B82F6', // Blue
    '#6366F1', // Indigo
    '#8B5CF6', // Violet
    '#EC4899', // Pink
    '#6B7280', // Gray
]

export function TagManager() {
    const { profile } = useAuth()
    const [tags, setTags] = useState<Tag[]>([])
    const [loading, setLoading] = useState(true)
    const [newTagName, setNewTagName] = useState('')
    const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[5])
    const [creating, setCreating] = useState(false)

    useEffect(() => {
        fetchTags()
    }, [profile?.clinic_id])

    const fetchTags = async () => {
        if (!profile?.clinic_id) return
        try {
            const { data, error } = await supabase
                .from('tags')
                .select('*')
                .eq('clinic_id', profile.clinic_id)
                .order('name')

            if (error) throw error
            setTags(data || [])
        } catch (error) {
            console.error('Error fetching tags:', error)
        } finally {
            setLoading(false)
        }
    }

    const handleCreateTag = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!newTagName.trim() || !profile?.clinic_id) return

        setCreating(true)
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data, error } = await (supabase as any)
                .from('tags')
                .insert([{
                    clinic_id: profile.clinic_id,
                    name: newTagName.trim(),
                    color: selectedColor
                }])
                .select()
                .single()

            if (error) throw error
            setTags([...tags, data])
            setNewTagName('')
        } catch (error) {
            console.error('Error creating tag:', error)
            alert('Error al crear la etiqueta')
        } finally {
            setCreating(false)
        }
    }

    const handleDeleteTag = async (id: string) => {
        if (!confirm('¿Estás seguro de eliminar esta etiqueta? Se quitará de todos los pacientes.')) return

        try {
            const { error } = await supabase
                .from('tags')
                .delete()
                .eq('id', id)

            if (error) throw error
            setTags(tags.filter(t => t.id !== id))
        } catch (error) {
            console.error('Error deleting tag:', error)
            alert('Error al eliminar la etiqueta')
        }
    }

    return (
        <div className="bg-white rounded-soft border border-silk-beige p-6 space-y-6">
            <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600">
                    <TagIcon className="w-5 h-5" />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-charcoal">Etiquetas de Pacientes</h2>
                    <p className="text-sm text-charcoal/60">Gestiona las etiquetas para segmentar a tus clientes (ej: VIP, Piel Sensible).</p>
                </div>
            </div>

            {/* Create Form */}
            <form onSubmit={handleCreateTag} className="flex flex-col sm:flex-row gap-4 items-end bg-gray-50 p-4 rounded-soft border border-dashed border-gray-200">
                <div className="w-full sm:flex-1">
                    <label className="block text-xs font-medium text-charcoal/60 mb-1 uppercase">Nombre de etiqueta</label>
                    <input
                        type="text"
                        value={newTagName}
                        onChange={(e) => setNewTagName(e.target.value)}
                        placeholder="Ej: Cliente Frecuente"
                        className="input-soft w-full h-10"
                        maxLength={30}
                    />
                </div>
                <div className="w-full sm:w-auto mt-2 sm:mt-0">
                    <label className="block text-xs font-medium text-charcoal/60 mb-2 uppercase">Color</label>
                    <div className="flex flex-wrap gap-3 items-center">
                        {PRESET_COLORS.map(color => (
                            <button
                                key={color}
                                type="button"
                                onClick={() => setSelectedColor(color)}
                                className={`w-6 h-6 rounded-full transition-transform ${selectedColor === color ? 'scale-125 ring-2 ring-offset-2 ring-gray-300' : 'hover:scale-110'}`}
                                style={{ backgroundColor: color }}
                                aria-label={`Select color ${color}`}
                            />
                        ))}
                    </div>
                </div>
                <button
                    type="submit"
                    disabled={creating || !newTagName.trim()}
                    className="btn-primary flex items-center justify-center gap-2 w-full sm:w-auto min-w-[120px] mt-4 sm:mt-0 py-2.5"
                >
                    {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Crear
                </button>
            </form>

            {/* List */}
            <div className="space-y-2">
                {loading ? (
                    <div className="text-center py-8 text-charcoal/40">Cargando etiquetas...</div>
                ) : tags.length === 0 ? (
                    <div className="text-center py-8 text-charcoal/40 italic bg-gray-50 rounded-soft">
                        No hay etiquetas creadas aún.
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                        {tags.map(tag => (
                            <div key={tag.id} className="flex items-center justify-between p-3 bg-white border border-silk-beige rounded-soft hover:shadow-sm transition-shadow group">
                                <div className="flex items-center gap-3">
                                    <span
                                        className="w-4 h-4 rounded-full flex-shrink-0"
                                        style={{ backgroundColor: tag.color }}
                                    />
                                    <span className="font-medium text-charcoal">{tag.name}</span>
                                </div>
                                <button
                                    onClick={() => handleDeleteTag(tag.id)}
                                    className="p-1.5 text-charcoal/40 hover:text-red-500 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                                    title="Eliminar etiqueta"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
