import React, { useState, useEffect } from 'react'
import { X, Search, Plus, Trash2, Calculator } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface ServiceOption {
    id: string;
    name: string;
    price: number;
}

interface TutorOption {
    id: string;
    name: string;
}

interface NewIncomeFormProps {
    clinicId: string;
    onClose: () => void;
    onSuccess: (incomeData: {
        description: string;
        amount: number;
        category: string;
        date: string;
        tutor_id?: string;
        services?: any[];
    }) => void;
}

export function NewIncomeForm({ clinicId, onClose, onSuccess }: NewIncomeFormProps) {
    const [description, setDescription] = useState('')
    const [amount, setAmount] = useState<string>('')
    const [category, setCategory] = useState('service')
    const [date, setDate] = useState(new Date().toISOString().split('T')[0])

    const [tutors, setTutors] = useState<TutorOption[]>([])
    const [filteredTutors, setFilteredTutors] = useState<TutorOption[]>([])
    const [searchTerm, setSearchTerm] = useState('')
    const [selectedTutor, setSelectedTutor] = useState<TutorOption | null>(null)
    const [showTutorDropdown, setShowTutorDropdown] = useState(false)

    const [availableServices, setAvailableServices] = useState<ServiceOption[]>([])
    const [selectedServices, setSelectedServices] = useState<ServiceOption[]>([])
    const [showServiceDropdown, setShowServiceDropdown] = useState(false)

    useEffect(() => {
        const loadData = async () => {
            if (!clinicId) return;

            // Load Tutors
            const { data: tutorsData } = await supabase
                .from('tutors')
                .select('id, name')
                .eq('clinic_id', clinicId)
                .order('name', { ascending: true })
            if (tutorsData) {
                setTutors(tutorsData as TutorOption[])
                setFilteredTutors(tutorsData as TutorOption[])
            }

            // Load Services
            const { data: servicesData } = await supabase
                .from('services')
                .select('id, name, price')
                .eq('clinic_id', clinicId)
                .order('name', { ascending: true })
            if (servicesData) {
                setAvailableServices(servicesData as ServiceOption[])
            }
        }
        loadData()
    }, [clinicId])

    useEffect(() => {
        if (searchTerm.trim() === '') {
            setFilteredTutors(tutors)
        } else {
            const lower = searchTerm.toLowerCase()
            setFilteredTutors(tutors.filter(t => t.name.toLowerCase().includes(lower)))
        }
    }, [searchTerm, tutors])

    const handleSelectTutor = (tutor: TutorOption) => {
        setSelectedTutor(tutor)
        setSearchTerm(tutor.name)
        setShowTutorDropdown(false)
        if (!description) {
            setDescription(`Pago de ${tutor.name}`)
        }
    }

    const clearTutor = () => {
        setSelectedTutor(null)
        setSearchTerm('')
    }

    const addService = (service: ServiceOption) => {
        setSelectedServices([...selectedServices, service])
        setShowServiceDropdown(false)
        
        // Auto-sum amount
        const currentSum = selectedServices.reduce((sum, s) => sum + Number(s.price || 0), 0)
        const newTotal = currentSum + Number(service.price || 0)
        setAmount(newTotal.toString())
        
        if (!description || description.startsWith('Pago de')) {
            const names = [...selectedServices, service].map(s => s.name).join(', ')
            setDescription(`Servicios: ${names}`)
        }
    }

    const removeService = (index: number) => {
        const newServices = [...selectedServices]
        newServices.splice(index, 1)
        setSelectedServices(newServices)
        
        const currentSum = newServices.reduce((sum, s) => sum + Number(s.price || 0), 0)
        setAmount(currentSum > 0 ? currentSum.toString() : '')
        
        if (newServices.length > 0) {
            setDescription(`Servicios: ${newServices.map(s => s.name).join(', ')}`)
        } else if (selectedTutor) {
            setDescription(`Pago de ${selectedTutor.name}`)
        } else {
            setDescription('')
        }
    }

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        if (!amount || Number(amount) <= 0) return

        onSuccess({
            description,
            amount: Number(amount),
            category,
            date,
            tutor_id: selectedTutor?.id,
            services: selectedServices.length > 0 ? selectedServices.map(s => ({ id: s.id, name: s.name, price: s.price })) : undefined
        })
    }

    return (
        <div className="fixed inset-0 bg-charcoal/50 z-50 flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white rounded-soft w-full max-w-lg shadow-xl flex flex-col max-h-[90vh]">
                <div className="flex items-center justify-between p-6 border-b border-silk-beige">
                    <h3 className="text-xl font-bold text-charcoal flex items-center gap-2">
                        <Calculator className="w-5 h-5 text-primary-500" />
                        Registrar Nuevo Ingreso
                    </h3>
                    <button onClick={onClose} className="p-2 hover:bg-silk-beige rounded-soft transition-colors">
                        <X className="w-5 h-5 text-charcoal/50 hover:text-charcoal" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 overflow-y-auto flex-1 space-y-5">
                    
                    {/* Tutor Selector */}
                    <div className="relative">
                        <label className="block text-sm font-medium text-charcoal mb-1">Tutor Asociado (Opcional)</label>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal/40" />
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(e) => {
                                    setSearchTerm(e.target.value)
                                    setShowTutorDropdown(true)
                                    if (!e.target.value) setSelectedTutor(null)
                                }}
                                onFocus={() => setShowTutorDropdown(true)}
                                className="input-soft pl-9"
                                placeholder="Buscar tutor por nombre..."
                            />
                            {selectedTutor && (
                                <button type="button" onClick={clearTutor} className="absolute right-3 top-1/2 -translate-y-1/2">
                                    <X className="w-4 h-4 text-charcoal/40 hover:text-red-500" />
                                </button>
                            )}
                        </div>
                        {showTutorDropdown && filteredTutors.length > 0 && (
                            <div className="absolute z-10 w-full mt-1 bg-white border border-silk-beige rounded-soft shadow-lg max-h-48 overflow-y-auto">
                                {filteredTutors.map(tutor => (
                                    <div
                                        key={tutor.id}
                                        onClick={() => handleSelectTutor(tutor)}
                                        className="px-4 py-2 hover:bg-silk-beige cursor-pointer text-sm text-charcoal transition-colors"
                                    >
                                        {tutor.name}
                                    </div>
                                ))}
                            </div>
                        )}
                        {showTutorDropdown && filteredTutors.length === 0 && searchTerm && (
                            <div className="absolute z-10 w-full mt-1 bg-white border border-silk-beige rounded-soft shadow-lg p-4 text-sm text-charcoal/50 text-center">
                                No se encontraron tutores.
                            </div>
                        )}
                    </div>

                    {/* Services Accumulator */}
                    <div>
                        <label className="block text-sm font-medium text-charcoal mb-1">Servicios Consumidos</label>
                        <div className="relative">
                            <button
                                type="button"
                                onClick={() => setShowServiceDropdown(!showServiceDropdown)}
                                className="w-full text-left input-soft flex justify-between items-center"
                            >
                                <span className="text-charcoal/50">Agregar servicio al total...</span>
                                <Plus className="w-4 h-4 text-primary-500" />
                            </button>
                            
                            {showServiceDropdown && (
                                <div className="absolute z-10 w-full mt-1 bg-white border border-silk-beige rounded-soft shadow-lg max-h-48 overflow-y-auto">
                                    {availableServices.map(service => (
                                        <div
                                            key={service.id}
                                            onClick={() => addService(service)}
                                            className="px-4 py-2 hover:bg-silk-beige cursor-pointer text-sm text-charcoal flex justify-between transition-colors"
                                        >
                                            <span>{service.name}</span>
                                            <span className="font-medium text-primary-600">${service.price}</span>
                                        </div>
                                    ))}
                                    {availableServices.length === 0 && (
                                        <div className="p-4 text-sm text-charcoal/50 text-center">
                                            No hay servicios registrados en la clínica.
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {selectedServices.length > 0 && (
                            <div className="mt-3 space-y-2">
                                {selectedServices.map((service, idx) => (
                                    <div key={idx} className="flex items-center justify-between bg-silk-beige/30 px-3 py-2 rounded-md text-sm">
                                        <span className="text-charcoal">{service.name}</span>
                                        <div className="flex items-center gap-3">
                                            <span className="font-medium">${service.price}</span>
                                            <button type="button" onClick={() => removeService(idx)} className="text-red-400 hover:text-red-500">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="pt-4 border-t border-silk-beige">
                        <label className="block text-sm font-medium text-charcoal mb-1">Descripción <span className="text-red-500">*</span></label>
                        <input
                            required
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="input-soft"
                            placeholder="Ej. Venta de accesorios"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-charcoal mb-1">Total ($) <span className="text-red-500">*</span></label>
                            <input
                                type="number"
                                required
                                min="0"
                                step="0.01"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                className="input-soft font-semibold text-primary-700"
                                placeholder="0.00"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-charcoal mb-1">Fecha <span className="text-red-500">*</span></label>
                            <input
                                type="date"
                                required
                                value={date}
                                onChange={(e) => setDate(e.target.value)}
                                className="input-soft"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-charcoal mb-1">Categoría</label>
                        <select
                            value={category}
                            onChange={(e) => setCategory(e.target.value)}
                            className="input-soft"
                        >
                            <option value="service">Servicio</option>
                            <option value="product">Producto</option>
                            <option value="adjustment">Ajuste</option>
                            <option value="other">Otro</option>
                        </select>
                    </div>

                </form>

                <div className="p-6 border-t border-silk-beige flex justify-end gap-3 bg-gray-50 rounded-b-soft">
                    <button
                        type="button"
                        onClick={onClose}
                        className="btn-ghost"
                    >
                        Cancelar
                    </button>
                    <button type="button" onClick={handleSubmit} className="btn-primary">
                        Registrar Ingreso
                    </button>
                </div>
            </div>
            
            {/* Click outside to close dropdowns constraint */}
            {(showTutorDropdown || showServiceDropdown) && (
                <div 
                    className="fixed inset-0 z-0" 
                    onClick={() => { setShowTutorDropdown(false); setShowServiceDropdown(false); }}
                />
            )}
        </div>
    )
}
