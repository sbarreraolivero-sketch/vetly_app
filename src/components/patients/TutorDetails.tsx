import { useState, useEffect } from 'react'
import {
    Phone, Mail, MapPin,
    Plus, Edit2, Trash2, ArrowLeft,
    Dog, ChevronRight, Info, DollarSign, FileText, CreditCard
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Tutor, Patient } from '@/types/database'
import { useAuth } from '@/contexts/AuthContext'
import { formatPhoneNumber, cn } from '@/lib/utils'
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
    const [notesBuffer, setNotesBuffer] = useState(tutor?.notes || '')
    const [savingNotes, setSavingNotes] = useState(false)

    useEffect(() => {
        window.scrollTo(0, 0)
    }, [])

    useEffect(() => {
        if (tutor?.notes !== undefined) {
            setNotesBuffer(tutor.notes || '')
        }
    }, [tutor?.notes])

    useEffect(() => {
        if (profile?.clinic_id && tutor?.id) {
            fetchPatients()
            fetchFinances()
        }
    }, [profile?.clinic_id, tutor?.id])

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
            // Citas por tutor_id (directo) — también fallback por patient_id para citas antiguas
            const [apptByTutor, patientDataRaw] = await Promise.all([
                (supabase as any)
                    .from('appointments')
                    .select('id, appointment_date, service, price, discount, payment_status, payment_method, patient_name, tutor_name')
                    .eq('tutor_id', tutor.id)
                    .in('payment_status', ['paid', 'partial', 'pending'])
                    .order('appointment_date', { ascending: false }),
                (supabase as any)
                    .from('patients')
                    .select('id, name')
                    .eq('tutor_id', tutor.id),
            ])

            const apptByTutorIds = new Set((apptByTutor.data || []).map((a: any) => a.id))

            // Fallback: citas vinculadas via patient_id que no estén ya incluidas
            let fallbackAppts: any[] = []
            const patientIds = ((patientDataRaw.data as any[]) || []).map((p: any) => p.id)
            if (patientIds.length > 0) {
                const { data: apptByPatient } = await (supabase as any)
                    .from('appointments')
                    .select('id, appointment_date, service, price, discount, payment_status, payment_method, patient_name, tutor_name')
                    .in('patient_id', patientIds)
                    .in('payment_status', ['paid', 'partial', 'pending'])
                    .order('appointment_date', { ascending: false })
                fallbackAppts = (apptByPatient || []).filter((a: any) => !apptByTutorIds.has(a.id))
            }

            const allAppts: any[] = [...(apptByTutor.data || []), ...fallbackAppts]

            // Cargar appointment_items para todas las citas en una sola query
            let itemsByAppt: Record<string, any[]> = {}
            if (allAppts.length > 0) {
                const apptIds = allAppts.map((a: any) => a.id)
                const { data: itemsData } = await (supabase as any)
                    .from('appointment_items')
                    .select('appointment_id, item_type, name, quantity, unit_price, subtotal')
                    .in('appointment_id', apptIds)
                    .order('item_type', { ascending: false }) // services first
                ;(itemsData || []).forEach((item: any) => {
                    if (!itemsByAppt[item.appointment_id]) itemsByAppt[item.appointment_id] = []
                    itemsByAppt[item.appointment_id].push(item)
                })
            }

            const appts = allAppts.map((a: any) => {
                const items = itemsByAppt[a.id] ?? []
                const hasItems = items.length > 0
                return {
                    id: a.id,
                    date: a.appointment_date,
                    description: `Visita: ${a.patient_name || 'Mascota'} — ${a.service || 'Servicio General'}`,
                    amount: a.price || 0,
                    discount: a.discount || 0,
                    type: 'visita',
                    status: a.payment_status,
                    payment_method: a.payment_method,
                    // Si hay items detallados los usamos; si no, caemos back al servicio principal
                    services: hasItems
                        ? items.map((i: any) => ({ name: i.name, price: i.subtotal, quantity: i.quantity, type: i.item_type }))
                        : [{ name: a.service || 'Servicio General', price: a.price || 0, quantity: 1, type: 'service' }],
                }
            })

            // Ingresos manuales
            const { data: incomeData } = await (supabase as any)
                .from('incomes')
                .select('*')
                .eq('tutor_id', tutor.id)
                .order('date', { ascending: false })

            const incomes = ((incomeData as any[]) || []).map((inc: any) => ({
                id: inc.id,
                date: inc.date,
                description: inc.description,
                amount: inc.amount,
                discount: inc.discount || 0,
                type: 'ingreso_manual',
                status: 'paid',
                payment_method: null,
                services: Array.isArray(inc.services) ? inc.services : [],
            }))

            const merged = [...appts, ...incomes].sort((a, b) =>
                (b.date ? new Date(b.date).getTime() : 0) - (a.date ? new Date(a.date).getTime() : 0)
            )
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
            {/* Page Banner */}
            <div className="bg-gradient-to-br from-primary-500 to-primary-700 rounded-2xl overflow-hidden shadow-soft-md">
                <div className="p-6 sm:p-8">
                    <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                            <button
                                onClick={onBack}
                                className="flex items-center gap-1.5 text-xs font-black text-primary-200 hover:text-white uppercase tracking-widest transition-colors bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-full mb-4"
                            >
                                <ArrowLeft className="w-3 h-3" />
                                Tutores
                            </button>
                            <p className="text-xs font-black uppercase tracking-widest text-primary-200 mb-1">Clínica / Tutores</p>
                            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">{tutor.name}</h1>
                        </div>
                        <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center shrink-0">
                            <span className="text-2xl font-black text-white">{tutor.name?.charAt(0).toUpperCase()}</span>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-4 mt-6 pt-5 border-t border-white/10">
                        <div className="flex flex-wrap items-center gap-5">
                            <div className="flex items-center gap-2">
                                <Phone className="w-3.5 h-3.5 text-primary-200" />
                                <span className="text-sm font-bold text-white">{formatPhoneNumber(tutor.phone_number) || '—'}</span>
                            </div>
                            {tutor.email && (
                                <div className="flex items-center gap-2">
                                    <Mail className="w-3.5 h-3.5 text-primary-200" />
                                    <span className="text-sm font-bold text-white">{tutor.email}</span>
                                </div>
                            )}
                        </div>
                        <div className="flex items-center gap-5">
                            <div className="text-right">
                                <p className="text-2xl font-black text-white">{patients.length}</p>
                                <p className="text-xs font-black text-primary-200 uppercase tracking-widest">Mascotas</p>
                            </div>
                            <div className="w-px h-8 bg-white/15" />
                            <div className="text-right">
                                <p className="text-2xl font-black text-white">{tutor.total_appointments || 0}</p>
                                <p className="text-xs font-black text-primary-200 uppercase tracking-widest">Citas</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex items-center border-b border-silk-beige overflow-x-auto no-scrollbar bg-white rounded-t-soft h-14">
                {([
                    { id: 'patients', label: 'Mascotas' },
                    { id: 'info', label: 'Info Adicional' },
                    { id: 'finances', label: 'Historial Financiero' },
                ] as const).map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={cn(
                            "px-6 h-full text-xs font-black uppercase tracking-widest transition-all relative border-r border-silk-beige whitespace-nowrap",
                            activeTab === tab.id ? "text-primary-700 bg-primary-50/30" : "text-charcoal/40 hover:text-charcoal/60 hover:bg-ivory"
                        )}
                    >
                        {tab.label}
                        {activeTab === tab.id && <div className="absolute bottom-0 left-0 right-0 h-1 bg-primary-600" />}
                    </button>
                ))}
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
                                    <div key={n} className="h-44 bg-silk-beige/20 animate-pulse rounded-2xl" />
                                ))}
                            </div>
                        ) : patients.length === 0 ? (
                            <div className="text-center py-20 bg-ivory rounded-2xl border border-dashed border-silk-beige">
                                <Dog className="w-12 h-12 text-charcoal/20 mx-auto mb-3" />
                                <h4 className="text-charcoal font-bold uppercase tracking-tight">Sin mascotas registradas</h4>
                                <p className="text-charcoal/50 text-sm mt-1">Este tutor aún no tiene pacientes asociados</p>
                                <button onClick={() => setShowPetForm(true)} className="mt-4 text-primary-600 font-bold text-sm hover:underline">
                                    + Registrar Mascota
                                </button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {patients.map(pet => (
                                    <div
                                        key={pet.id}
                                        className="group bg-white rounded-2xl border border-silk-beige hover:border-primary-200 hover:shadow-soft-md transition-all cursor-pointer overflow-hidden"
                                        onClick={() => { window.location.href = `/app/patients/${pet.id}` }}
                                    >
                                        {/* Card header strip */}
                                        <div className="bg-primary-50 px-5 py-4 flex items-center justify-between border-b border-primary-100/50">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center border border-primary-200 shadow-sm">
                                                    <Dog className="w-5 h-5 text-primary-600" />
                                                </div>
                                                <div>
                                                    <h4 className="font-extrabold text-charcoal uppercase tracking-tight text-sm group-hover:text-primary-700 transition-colors">
                                                        {pet.name}
                                                    </h4>
                                                    <p className="text-xs text-charcoal/50">{pet.species} · {pet.breed || 'Sin raza'}</p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                                                <span className={cn(
                                                    "px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest border",
                                                    pet.status === 'alive' ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-ivory text-charcoal/40 border-silk-beige"
                                                )}>
                                                    {pet.status === 'alive' ? 'Vivo' : 'Difunto'}
                                                </span>
                                                <button
                                                    onClick={() => { setEditingPet(pet); setShowPetForm(true) }}
                                                    className="p-1.5 hover:bg-white rounded-lg text-charcoal/40 hover:text-primary-600 transition-colors opacity-0 group-hover:opacity-100"
                                                >
                                                    <Edit2 className="w-3.5 h-3.5" />
                                                </button>
                                                <button
                                                    onClick={() => handleDeletePet(pet.id, pet.name)}
                                                    className="p-1.5 hover:bg-red-50 rounded-lg text-charcoal/40 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </div>

                                        {/* Card body */}
                                        <div className="px-5 py-4">
                                            <div className="grid grid-cols-2 gap-3">
                                                <div>
                                                    <p className="text-[10px] font-black text-charcoal/30 uppercase tracking-widest mb-0.5">Sexo</p>
                                                    <p className="text-sm font-bold text-charcoal">{getSexLabel(pet.sex)}</p>
                                                </div>
                                                <div>
                                                    <p className="text-[10px] font-black text-charcoal/30 uppercase tracking-widest mb-0.5">Edad</p>
                                                    <p className="text-sm font-bold text-charcoal">
                                                        {pet.dob ? (() => {
                                                            const dob = new Date(pet.dob)
                                                            const now = new Date()
                                                            let years = now.getFullYear() - dob.getFullYear()
                                                            let months = now.getMonth() - dob.getMonth()
                                                            if (now.getDate() < dob.getDate()) months--
                                                            if (months < 0) { years--; months += 12 }
                                                            if (years > 0) return `${years} ${years === 1 ? 'año' : 'años'}`
                                                            if (months > 0) return `${months} ${months === 1 ? 'mes' : 'meses'}`
                                                            return '< 1 mes'
                                                        })() : 'N/A'}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="mt-4 pt-3 border-t border-silk-beige/50 flex items-center justify-between">
                                                <span className="text-xs font-black text-primary-600 uppercase tracking-widest">Ver Ficha Clínica</span>
                                                <ChevronRight className="w-4 h-4 text-primary-600 group-hover:translate-x-0.5 transition-transform" />
                                            </div>
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
                            <div className="px-6 py-4 border-b border-silk-beige flex justify-between items-center bg-ivory/50">
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
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <h4 className="font-bold text-charcoal">{f.description}</h4>
                                                        {f.status === 'paid' && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 uppercase">Pagado</span>}
                                                        {f.status === 'pending' && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 uppercase">Pendiente</span>}
                                                        {f.type === 'visita' && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary-50 text-primary-600 uppercase">Visita</span>}
                                                        {f.type === 'ingreso_manual' && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-50 text-violet-600 uppercase">Ingreso</span>}
                                                    </div>
                                                    <p className="text-xs text-charcoal/50 mt-1">
                                                        {new Date(f.date).toLocaleDateString('es-CL')}
                                                        {f.payment_method && <span> • {f.payment_method.charAt(0).toUpperCase() + f.payment_method.slice(1)}</span>}
                                                    </p>
                                                </div>
                                                <div className="text-right shrink-0">
                                                    {f.discount > 0 && (
                                                        <p className="text-xs text-emerald-600 font-semibold">Desc. {formatCurrency(f.discount)}</p>
                                                    )}
                                                    <p className="font-bold text-charcoal text-lg">{formatCurrency(f.amount)}</p>
                                                </div>
                                            </div>
                                            {f.services && f.services.length > 0 && (
                                                <div className="mt-3 pt-3 border-t border-silk-beige/30 ml-4 pl-4 border-l-2 border-primary-100">
                                                    <p className="text-xs font-medium text-charcoal/60 uppercase mb-2">Detalle</p>
                                                    <div className="space-y-1">
                                                        {f.services.map((svc: any, idx: number) => (
                                                            <div key={idx} className="flex items-center justify-between text-sm gap-2">
                                                                <div className="flex items-center gap-1.5 min-w-0">
                                                                    <span className={cn(
                                                                        "text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0",
                                                                        svc.type === 'service' ? "bg-primary-100 text-primary-600" : "bg-violet-100 text-violet-600"
                                                                    )}>
                                                                        {svc.type === 'service' ? 'Serv.' : 'Prod.'}
                                                                    </span>
                                                                    <span className="text-charcoal/70 truncate">{svc.name}</span>
                                                                    {svc.quantity > 1 && <span className="text-charcoal/40 shrink-0">×{svc.quantity}</span>}
                                                                </div>
                                                                <span className="text-charcoal font-medium shrink-0">{formatCurrency(svc.price)}</span>
                                                            </div>
                                                        ))}
                                                        {f.discount > 0 && (
                                                            <div className="flex justify-between text-sm pt-1 border-t border-silk-beige/30">
                                                                <span className="text-emerald-600">Descuento aplicado</span>
                                                                <span className="text-emerald-600 font-semibold">−{formatCurrency(f.discount)}</span>
                                                            </div>
                                                        )}
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
