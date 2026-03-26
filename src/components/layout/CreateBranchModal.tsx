import { useState } from 'react'
import { X, Building2, MapPin, Loader2 } from 'lucide-react'
import { teamService } from '@/services/teamService'
import { useAuth } from '@/contexts/AuthContext'

interface CreateBranchModalProps {
    isOpen: boolean
    onClose: () => void
    onSuccess: () => void
}

export default function CreateBranchModal({ isOpen, onClose, onSuccess }: CreateBranchModalProps) {
    const { switchClinic } = useAuth()
    const [name, setName] = useState('')
    const [address, setAddress] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    if (!isOpen) return null

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError(null)

        try {
            const newClinicId = await teamService.createBranch(name, address)

            // Switch to the new clinic immediately
            await switchClinic(newClinicId as unknown as string)

            onSuccess()
            onClose()
        } catch (err: any) {
            console.error('Error creating branch:', err)
            setError(err.message || 'Error al crear la sucursal')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-charcoal/50 backdrop-blur-sm">
            <div className="bg-white rounded-soft w-full max-w-md shadow-soft-xl animate-in fade-in zoom-in duration-200">
                <div className="flex items-center justify-between p-6 border-b border-silk-beige">
                    <h3 className="text-lg font-semibold text-charcoal">Nueva Sucursal</h3>
                    <button onClick={onClose} className="text-charcoal/40 hover:text-charcoal transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    {error && (
                        <div className="p-3 bg-red-50 text-red-600 text-sm rounded-soft">
                            {error}
                        </div>
                    )}

                    <div>
                        <label className="label-text mb-1.5 flex items-center gap-2">
                            <Building2 className="w-4 h-4 text-charcoal/50" />
                            Nombre de la Sucursal
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Ej. Sucursal Norte"
                            className="input-field w-full"
                            required
                        />
                    </div>

                    <div>
                        <label className="label-text mb-1.5 flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-charcoal/50" />
                            Dirección (Opcional)
                        </label>
                        <input
                            type="text"
                            value={address}
                            onChange={(e) => setAddress(e.target.value)}
                            placeholder="Ej. Av. Libertador 1234"
                            className="input-field w-full"
                        />
                    </div>

                    <div className="pt-4 flex justify-end gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="btn-ghost"
                            disabled={loading}
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            className="btn-primary flex items-center gap-2"
                            disabled={loading || !name}
                        >
                            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                            Crear Sucursal
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}
