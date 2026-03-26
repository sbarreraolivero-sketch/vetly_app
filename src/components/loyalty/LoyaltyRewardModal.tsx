
import { useState } from 'react'
import { X, Loader2, Save, ShoppingBag, DollarSign, Percent } from 'lucide-react'
import { loyaltyService } from '@/services/loyaltyService'
import { toast } from 'react-hot-toast'

interface LoyaltyRewardModalProps {
    clinicId: string
    onClose: () => void
    onSave: () => void
    pointsName?: string
}

export function LoyaltyRewardModal({ clinicId, onClose, onSave, pointsName = 'Puntos' }: LoyaltyRewardModalProps) {
    const [loading, setLoading] = useState(false)
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        points_cost: 1000,
        reward_type: 'money' as 'money' | 'percentage' | 'gift' | 'treatment',
        reward_value: 0
    })

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        try {
            await loyaltyService.createReward({
                clinic_id: clinicId,
                ...formData
            })
            toast.success('Recompensa creada correctamente')
            onSave()
            onClose()
        } catch (error) {
            console.error('Error creating reward:', error)
            toast.error('Error al crear la recompensa')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-charcoal/30 backdrop-blur-md animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-lg rounded-softer shadow-soft-xl overflow-hidden border border-silk-beige animate-in zoom-in-95 duration-200">
                <div className="p-6 border-b border-silk-beige flex items-center justify-between bg-ivory shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-gradient-to-br from-primary-500 to-primary-600 text-white rounded-soft shadow-soft-sm">
                            <ShoppingBag className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-charcoal tracking-tight">Nueva Recompensa</h2>
                            <p className="text-xs text-primary-500/60 font-black uppercase tracking-widest">Configuración Canjeable</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-silk-beige rounded-full transition-colors">
                        <X className="w-5 h-5 text-charcoal/40" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-8 space-y-6">
                    <div className="space-y-4">
                        <div>
                            <label className="text-xs font-bold font-black text-charcoal uppercase tracking-widest mb-1.5 block px-1">Nombre del Beneficio</label>
                            <input
                                required
                                type="text"
                                placeholder="Ej: $10.000 de descuento"
                                value={formData.name}
                                onChange={e => setFormData({ ...formData, name: e.target.value })}
                                className="w-full h-11 px-4 bg-ivory border border-silk-beige rounded-soft text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary-100 placeholder:text-charcoal/20"
                            />
                        </div>

                        <div>
                            <label className="text-xs font-bold font-black text-charcoal uppercase tracking-widest mb-1.5 block px-1">Descripción (Opcional)</label>
                            <textarea
                                placeholder="Válido para cualquier tratamiento..."
                                value={formData.description}
                                onChange={e => setFormData({ ...formData, description: e.target.value })}
                                className="w-full p-4 bg-ivory border border-silk-beige rounded-soft text-sm focus:outline-none focus:ring-2 focus:ring-primary-100 min-h-[80px]"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs font-black text-charcoal uppercase tracking-widest mb-1.5 block px-1 flex items-center gap-1.5">
                                    Costo en {pointsName}
                                    <span className="text-xs font-bold text-primary-500 normal-case font-bold">(Meta necesaria para canje)</span>
                                </label>
                                <input
                                    required
                                    type="number"
                                    value={formData.points_cost}
                                    onChange={e => setFormData({ ...formData, points_cost: parseInt(e.target.value) })}
                                    className="w-full h-11 px-4 bg-ivory border border-silk-beige rounded-soft text-sm font-black focus:outline-none focus:ring-2 focus:ring-primary-100"
                                />
                                <p className="text-xs font-bold text-charcoal/40 mt-1 pl-1 italic">Monto que el paciente debe juntar para canjear.</p>
                            </div>
                            <div>
                                <label className="text-xs font-black text-charcoal uppercase tracking-widest mb-1.5 block px-1">Tipo de Recompensa</label>
                                <select
                                    value={formData.reward_type}
                                    onChange={e => setFormData({ ...formData, reward_type: e.target.value as any })}
                                    className="w-full h-11 px-4 bg-ivory border border-silk-beige rounded-soft text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary-100"
                                >
                                    <option value="money">Dinero ($)</option>
                                    <option value="percentage">Porcentaje (%)</option>
                                    <option value="treatment">Tratamiento / Producto</option>
                                </select>
                                <p className="text-xs font-bold text-charcoal/40 mt-1 pl-1 italic">Elige "Tratamiento" para que sea gratis.</p>
                            </div>
                        </div>

                        {formData.reward_type !== 'treatment' && (
                            <div>
                                <label className="text-xs font-black text-charcoal uppercase tracking-widest mb-1.5 block px-1">Valor de la Recompensa</label>
                                <div className="relative">
                                    <input
                                        required
                                        type="number"
                                        value={formData.reward_value}
                                        onChange={e => setFormData({ ...formData, reward_value: parseFloat(e.target.value) })}
                                        className="w-full h-11 pl-12 pr-4 bg-ivory border border-silk-beige rounded-soft text-sm font-black focus:outline-none focus:ring-2 focus:ring-primary-100"
                                    />
                                    <div className="absolute left-4 top-1/2 -translate-y-1/2">
                                        {formData.reward_type === 'money' ? <DollarSign className="w-4 h-4 text-charcoal/30" /> : <Percent className="w-4 h-4 text-charcoal/30" />}
                                    </div>
                                </div>
                                <p className="text-xs font-bold text-charcoal/40 mt-1.5 pl-1 italic">Ej: Si es dinero, ¿cuánto saldo se carga al monedero luego del canje?</p>
                            </div>
                        )}
                    </div>

                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 h-12 rounded-full text-sm font-black text-charcoal/40 hover:bg-silk-beige transition-all uppercase tracking-widest"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="flex-[2] h-12 bg-primary-500 text-white rounded-full text-sm font-black shadow-md hover:bg-primary-600 transition-all flex items-center justify-center gap-2 uppercase tracking-widest"
                        >
                            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                            Crear Recompensa
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}
