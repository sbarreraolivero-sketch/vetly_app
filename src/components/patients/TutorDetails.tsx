import { useState, useEffect } from 'react'
import {
    Phone, Mail, MapPin, Calendar,
    Plus, Edit2, Trash2, ArrowLeft,
    Dog, ChevronRight, Info, DollarSign, FileText, CreditCard
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Tutor, Patient } from '@/types/database'
import { useAuth } from '@/contexts/AuthContext'
import { formatPhoneNumber } from '@/lib/utils'
import { PetForm } from './PetForm'

interface TutorDetailsProps {
    tutor: Tutor
    onBack: () => void
    onUpdate: () => Promise<void> | void
}

const getSexLabel = (sex: string | null | undefined) => {
    if (!sex) return 'N/A'
    const s = sex.toUpperCase()
    if (s === 'M' || s === 'MN') return 'Macho'
    if (s === 'F' || s === 'FN' || s === 'H') return 'Hembra'
    return sex
}

export function TutorDetails({ tutor, onBack, onUpdate }: TutorDetailsProps) {
    const { profile } = useAuth()
    const [activeTab, setActiveTab] = useState<'patients' | 'info' | 'finances'>('patients')
    const [patients, setPatients] = useState<Patient[]>([])
    const [loadingPatients, setLoadingPatients] = useState(false)
    const [showPetForm, setShowPetForm] = useState(false)
    const [editingPet, setEditingPet] = useState<Patient | null>(null)
    const [finances, setFinances] = useState<any[]>([])
    const [loadingFinances, setLoadingFinances] = useState(false)

    // Notes editing state
    const [isEditingNotes, setIsEditingNotes] = useState(false)
    const [notesBuffer, setNotesBuffer] = useState(tutor.notes || '')
    const [savingNotes, setSavingNotes] = useState(false)

    useEffect(() => {
        window.scrollTo(0, 0)
    }, [])

    useEffect(() => {
        setNotesBuffer(tutor.notes || '')
    }, [tutor.notes])

    useEffect(() => {
        if (profile?.clinic_id && tutor.id) {
            fetchPatients()
            fetchFinances()
        }
    }, [profile?.clinic_id, tutor.id])

    const fetchPatients = async () => {
        setLoadingPatients(true)
        try {
            const { data, error } = await supabase
                .from('patients')
                .select('*')
                .eq('tutor_id', tutor.id)
                .is('death_date', null)
                .order('name')

            if (error) throw error
            setPatients(data || [])
        } catch (error) {
            console.error('Error fetching patients:', error)
        } finally {
            setLoadingPatients(false)
        }
    }

    const handleDeletePet = async (id: string, name: string) => {
        if (!confirm(`¿Estás seguro de eliminar a ${name}?`)) return
        try {
            const { error } = await supabase.from('patients').delete().eq('id', id)
            if (error) throw error
            fetchPatients()
        } catch (error) {
            console.error('Error deleting pet:', error)
            alert('Error al eliminar mascota')
        }
    }

    const fetchFinances = async () => {
        setLoadingFinances(true)
        try {
            const { data: patientData } = await supabase.from('patients').select('id, name').eq('tutor_id', tutor.id)
            const patientIds = (patientData || []).map(p => p.id)

            let appts: any[] = []
            if (patientIds.length > 0) {
                const { data: apptData } = await supabase.from('appointments')
                    .select('id, appointment_date, service, price, payment_status, patient_id')
                    .in('patient_id', patientIds)
                    .in('payment_status', ['paid', 'partial', 'pending'])
                    .order('appointment_date', { ascending: false })
                
                if (apptData) {
                    appts = apptData.map((a: any) => ({
                        id: a.id,
                        date: a.appointment_date,
                        description: `Visita ${patientData?.find(p => p.id === a.patient_id)?.name || 'Mascota'} - ${a.service || 'Servicio General'}`,
                        amount: a.price || 0,
                        type: 'visita',
                        status: a.payment_status,
                        services: [{ name: a.service || 'Servicio', price: a.price || 0 }]
                    }))
                }
            }

            const { data: incomeData } = await supabase.from('incomes')
                .select('*')
                .eq('tutor_id', tutor.id)
                .order('date', { ascending: false })

            const incomes = (incomeData || []).map((inc: any) => ({
                id: inc.id,
                date: inc.date,
                description: inc.description,
                amount: inc.amount,
                type: 'ingreso_manual',
                status: 'paid',
                services: Array.isArray(inc.services) ? inc.services : []
            }))

            const merged = [...appts, ...incomes].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            setFinances(merged)
        } catch (error) {
            console.error('Error fetching finances:', error)
        } finally {
            setLoadingFinances(false)
        }
    }

    const formatCurrency = (val: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(val)
    const totalSpent = finances.filter(f => f.status === 'paid').reduce((sum, f) => sum + f.amount, 0)
    const totalPending = finances.filter(f => f.status === 'pending').reduce((sum, f) => sum + f.amount, 0)

    const handleSaveNotes = async () => {
        setSavingNotes(true)
        try {
            const { error } = await (supabase.from('tutors') as any)
                .update({ notes: notesBuffer })
                .eq('id', tutor.id)

            if (error) throw error
            if (onUpdate) await onUpdate()
            setIsEditingNotes(false)
        } catch (error) {
            console.error('Error updating notes:', error)
            alert('Error al guardar las notas')
        } finally {
            setSavingNotes(false)
        }
    }

    return (
        <div className="space-y-6 animate-fade-in relative pb-20">
            {/* Header / Navigation */}
            <div className="flex flex-col gap-4">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onBack}
                        className="p-2 hover:bg-silk-beige rounded-full text-charcoal/60 hover:text-charcoal transition-colors"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    <div>
                        <h1 className="text-2xl font-bold text-charcoal uppercase tracking-tight">{tutor.name}</h1>
                        <p className="text-charcoal/60 text-sm">Perfil del Tutor</p>
                    </div>
                </div>
            </div>

            {/* Quick Stats / Info Card */}
            <div className="card-soft p-6 bg-white shadow-sm border border-silk-beige">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center text-primary-600">
                            <Phone className="w-5 h-5" />
                        </div>
                        <div>
                            <p className="text-xs text-charcoal/50 uppercase font-medium">Teléfono</p>
                            <p className="text-charcoal">{formatPhoneNumber(tutor.phone_number)}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-silk-beige flex items-center justify-center text-charcoal/60">
                            <Mail className="w-5 h-5" />
                        </div>
                        <div>
                            <p className="text-xs text-charcoal/50 uppercase font-medium">Email</p>
                            <p className="text-charcoal">{tutor.email || 'N/A'}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-silk-beige flex items-center justify-center text-charcoal/60">
                            <Calendar className="w-5 h-5" />
                        </div>
                        <div>
                            <p className="text-xs text-charcoal/50 uppercase font-medium">Total Citas</p>
                            <p className="text-charcoal">{tutor.total_appointments}</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="border-b border-silk-beige">
                <div className="flex gap-6">
                    <button
                        onClick={() => setActiveTab('patients')}
                        className={`pb-3 text-sm font-medium transition-colors relative ${activeTab === 'patients'
                            ? 'text-primary-600'
                            : 'text-charcoal/60 hover:text-charcoal'
                            }`}
                    >
                        Mascotas (Pacientes)
                        {activeTab === 'patients' && (
                            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-600 rounded-t-full" />
                        )}
                    </button>
                    <button
                        onClick={() => setActiveTab('info')}
                        className={`pb-3 text-sm font-medium transition-colors relative ${activeTab === 'info'
                            ? 'text-primary-600'
                            : 'text-charcoal/60 hover:text-charcoal'
                            }`}
                    >
                        Información Adicional
                        {activeTab === 'info' && (
                            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-600 rounded-t-full" />
                        )}
                    </button>
                    <button
                        onClick={() => setActiveTab('finances')}
                        className={`pb-3 text-sm font-medium transition-colors relative ${activeTab === 'finances'
                            ? 'text-primary-600'
                            : 'text-charcoal/60 hover:text-charcoal'
                            }`}
                    >
                        Historial Financiero
                        {activeTab === 'finances' && (
                            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-600 rounded-t-full" />
                        )}
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="min-h-[400px]">
                {activeTab === 'patients' && (
                    <div className="space-y-6 animate-fade-in">
                        <div className="flex justify-between items-center">
                            <h3 className="text-lg font-medium text-charcoal">Mascotas Registradas</h3>
                            <button
                                onClick={() => {
                                    setEditingPet(null)
                                    setShowPetForm(true)
                                }}
                                className="btn-primary flex items-center gap-2"
                            >
                                <Plus className="w-4 h-4" />
                                Nueva Mascota
                            </button>
                        </div>

                        {loadingPatients ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {[1, 2].map(n => (
                                    <div key={n} className="h-40 bg-silk-beige/20 animate-pulse rounded-soft" />
                                ))}
                            </div>
                        ) : patients.length === 0 ? (
                            <div className="text-center py-20 bg-ivory rounded-soft border border-dashed border-silk-beige">
                                <Dog className="w-12 h-12 text-charcoal/20 mx-auto mb-3" />
                                <h4 className="text-charcoal font-medium">Sin mascotas registradas</h4>
                                <p className="text-charcoal/50 text-sm mt-1">Este tutor aún no tiene pacientes asociados</p>
                                <button
                                    onClick={() => setShowPetForm(true)}
                                    className="mt-4 text-primary-600 font-medium text-sm hover:underline"
                                >
                                    + Registrar Mascota
                                </button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {patients.map(pet => (
                                    <div
                                        key={pet.id}
                                        className="group bg-white p-5 rounded-soft border border-silk-beige hover:border-primary-200 hover:shadow-premium transition-all cursor-pointer relative"
                                        onClick={() => {
                                            window.location.href = `/app/patients/${pet.id}`
                                        }}
                                    >
                                        <div className="flex justify-between items-start">
                                            <div className="flex items-center gap-3">
                                                <div className="w-12 h-12 rounded-full bg-primary-50 flex items-center justify-center border border-primary-100">
                                                    <Dog className="w-6 h-6 text-primary-600" />
                                                </div>
                                                <div>
                                                    <h4 className="font-bold text-charcoal group-hover:text-primary-700 transition-colors uppercase tracking-tight">
                                                        {pet.name}
                                                    </h4>
                                                    <p className="text-xs text-charcoal/50">{pet.species} • {pet.breed || 'Raza no especificada'}</p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                                                <button
                                                    onClick={() => {
                                                        setEditingPet(pet)
                                                        setShowPetForm(true)
                                                    }}
                                                    className="p-1.5 hover:bg-silk-beige rounded text-charcoal/60"
                                                >
                                                    <Edit2 className="w-3.5 h-3.5" />
                                                </button>
                                                <button
                                                    onClick={() => handleDeletePet(pet.id, pet.name)}
                                                    className="p-1.5 hover:bg-red-50 text-charcoal/60 hover:text-red-500 rounded"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </div>

                                        <div className="mt-4 grid grid-cols-2 gap-2">
                                            <div className="p-2 bg-ivory rounded text-xs font-bold font-medium text-charcoal/60">
                                                SEXO: <span className="text-charcoal font-bold">{getSexLabel(pet.sex)}</span>
                                            </div>
                                            <div className="p-2 bg-ivory rounded text-xs font-bold font-medium text-charcoal/60">
                                                EDAD: <span className="text-charcoal font-bold">
                                                    {pet.dob ? `${new Date().getFullYear() - new Date(pet.dob).getFullYear()} años` : 'N/A'}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="mt-4 flex items-center justify-between text-xs font-bold text-primary-600 uppercase tracking-widest pt-4 border-t border-silk-beige/50">
                                            <span>Ver Ficha Clínica</span>
                                            <ChevronRight className="w-4 h-4" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'info' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-fade-in">
                        <div className="bg-white p-6 rounded-soft border border-silk-beige space-y-4">
                            <h3 className="font-medium text-charcoal mb-4 flex items-center gap-2">
                                <Info className="w-4 h-4 text-primary-500" />
                                Datos de Contacto
                            </h3>
                            <div className="space-y-4">
                                <div>
                                    <label className="text-xs text-charcoal/50 uppercase font-medium">Dirección</label>
                                    <div className="flex items-start gap-2 mt-1">
                                        <MapPin className="w-4 h-4 text-charcoal/40 mt-0.5" />
                                        <p className="text-charcoal">{tutor.address || 'No especificada'}</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white p-6 rounded-soft border border-silk-beige space-y-4">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="font-medium text-charcoal">Notas Generales</h3>
                                {!isEditingNotes && (
                                    <button
                                        onClick={() => {
                                            setNotesBuffer(tutor.notes || '')
                                            setIsEditingNotes(true)
                                        }}
                                        className="p-1.5 hover:bg-silk-beige rounded text-charcoal/60 transition-colors"
                                    >
                                        <Edit2 className="w-4 h-4" />
                                    </button>
                                )}
                            </div>

                            {isEditingNotes ? (
                                <div className="space-y-3">
                                    <textarea
                                        value={notesBuffer}
                                        onChange={(e) => setNotesBuffer(e.target.value)}
                                        className="w-full min-h-[120px] p-3 rounded-soft border border-silk-beige bg-white focus:outline-none focus:ring-2 focus:ring-primary-200 resize-none text-sm text-charcoal"
                                        placeholder="Escribe notas importantes sobre el dueño..."
                                        autoFocus
                                    />
                                    <div className="flex justify-end gap-2">
                                        <button
                                            onClick={() => setIsEditingNotes(false)}
                                            className="px-3 py-1.5 text-xs font-medium text-charcoal/60 hover:text-charcoal hover:bg-silk-beige/50 rounded transition-colors"
                                            disabled={savingNotes}
                                        >
                                            Cancelar
                                        </button>
                                        <button
                                            onClick={handleSaveNotes}
                                            disabled={savingNotes}
                                            className="px-3 py-1.5 text-xs font-medium bg-primary-600 text-white rounded hover:bg-primary-700 transition-colors flex items-center gap-1"
                                        >
                                            {savingNotes ? 'Guardando...' : 'Guardar'}
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="bg-ivory/50 p-4 rounded-soft border border-silk-beige/50 min-h-[100px]">
                                    {tutor.notes ? (
                                        <p className="text-charcoal whitespace-pre-wrap text-sm">{tutor.notes}</p>
                                    ) : (
                                        <p className="text-charcoal/40 italic text-sm">Sin notas generales</p>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === 'finances' && (
                    <div className="space-y-6 animate-fade-in pb-10">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="bg-white p-5 rounded-soft border border-silk-beige shadow-sm flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-charcoal/50 uppercase font-medium">Total Gastado</p>
                                    <p className="text-2xl font-bold text-emerald-600">{formatCurrency(totalSpent)}</p>
                                </div>
                                <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center">
                                    <DollarSign className="w-6 h-6 text-emerald-500" />
                                </div>
                            </div>
                            <div className="bg-white p-5 rounded-soft border border-silk-beige shadow-sm flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-charcoal/50 uppercase font-medium">Deuda Pendiente</p>
                                    <p className="text-2xl font-bold text-amber-600">{formatCurrency(totalPending)}</p>
                                </div>
                                <div className="w-12 h-12 bg-amber-50 rounded-full flex items-center justify-center">
                                    <CreditCard className="w-6 h-6 text-amber-500" />
                                </div>
                            </div>
                        </div>

                        <div className="bg-white rounded-soft border border-silk-beige shadow-sm overflow-hidden">
                            <div className="px-6 py-4 border-b border-silk-beige flex justify-between items-center bg-gray-50/50">
                                <h3 className="font-bold text-charcoal">Historial de Transacciones</h3>
                            </div>
                            
                            {loadingFinances ? (
                                <div className="p-8 text-center text-charcoal/50">Cargando historial...</div>
                            ) : finances.length === 0 ? (
                                <div className="p-12 text-center text-charcoal/50 flex flex-col items-center">
                                    <FileText className="w-12 h-12 text-silk-beige mb-3" />
                                    <p>No hay registros financieros para este tutor</p>
                                </div>
                            ) : (
                                <div className="divide-y divide-silk-beige/50">
                                    {finances.map((f, i) => (
                                        <div key={i} className="p-4 sm:p-6 hover:bg-silk-beige/20 transition-colors">
                                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <h4 className="font-bold text-charcoal">{f.description}</h4>
                                                        {f.status === 'paid' && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 uppercase">Pagado</span>}
                                                        {f.status === 'pending' && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 uppercase">Pendiente</span>}
                                                    </div>
                                                    <p className="text-xs text-charcoal/50 mt-1">
                                                        {new Date(f.date).toLocaleDateString()} • {f.type === 'visita' ? 'Consulta Médica' : 'Ingreso Externo'}
                                                    </p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="font-bold text-charcoal text-lg">{formatCurrency(f.amount)}</p>
                                                    {f.services && f.services.length > 0 && (
                                                        <p className="text-xs text-charcoal/40 mt-1">
                                                            {f.services.length} servicio(s)
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                            {f.services && f.services.length > 0 && (
                                                <div className="mt-4 pt-4 border-t border-silk-beige/30 ml-4 pl-4 border-l-2 border-primary-100">
                                                    <p className="text-xs font-medium text-charcoal/60 uppercase mb-2">Detalle de items</p>
                                                    <div className="space-y-1">
                                                        {f.services.map((svc: any, idx: number) => (
                                                            <div key={idx} className="flex justify-between text-sm">
                                                                <span className="text-charcoal/70">{svc.name}</span>
                                                                <span className="text-charcoal font-medium">{formatCurrency(svc.price)}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {showPetForm && (
                <PetForm
                    tutorId={tutor.id}
                    pet={editingPet}
                    onClose={() => {
                        setShowPetForm(false)
                        setEditingPet(null)
                    }}
                    onSave={() => {
                        fetchPatients()
                    }}
                />
            )}
        </div>
    )
}
